const { app, BrowserWindow, session, globalShortcut, screen, ipcMain, nativeImage, systemPreferences, nativeTheme, shell } = require('electron')
const path   = require('path')
const fs     = require('fs')
const net    = require('net')
const https  = require('https')
const { exec, spawn } = require('child_process')
const { getStore, setStore, deleteStore } = require('./store')

const PANEL_GAP = 10   // px gap between window edge and screen; window is inset so the gap shows raw desktop
const PANEL_BACKGROUND_MATERIAL = 'none' // Native acrylic shifts tint when the window loses focus.
const PANEL_COLUMNS = ['left', 'monitor', 'mid', 'feed', 'right', 'aux']
const PANEL_DEFAULT_COL_WIDTHS = { left: 220, monitor: 220, mid: 240, feed: 260, right: 260, aux: 260 }
const PANEL_DIVIDER_WIDTH = 4
const PANEL_RESIZE_HANDLE_WIDTH = 5

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')

const isDev  = !!process.env.VITE_DEV
// Native binaries (brave-host.exe, taskbar-btn.exe, taskbar-hook.dll, panel.path)
// live next to main.js in dev, but are unpacked to resources/ in the
// installer (see electron-builder.json `extraResources`).
const NATIVE_BIN = app.isPackaged
  ? path.join(process.resourcesPath, 'native', 'bin')
  : path.join(__dirname, 'native', 'bin')
const LOG_SRC = path.join(NATIVE_BIN, 'electron.log')
// Fallback to userData in case __dirname is inside a read-only asar
let LOG = LOG_SRC
try { fs.writeFileSync(LOG_SRC, '') }  // works in dev / unpackaged
catch {
  LOG = path.join(app.getPath('userData'), 'electron.log')
  try { fs.writeFileSync(LOG, '') } catch {}
}
function log(...args) {
  const line = `[${new Date().toISOString()}] ${args.join(' ')}\n`
  try { fs.appendFileSync(LOG, line) } catch {}
  console.log(...args)
}

function storeLogValue(key, value) {
  if (/auth|token|password|credential|secret/i.test(String(key || ''))) return '"[redacted]"'
  try { return JSON.stringify(value) }
  catch { return '"[unserializable]"' }
}

const WORKSTATION_PIPE = '\\\\.\\pipe\\WorkstationMonitorTelemetry'
let workstationSocket = null
let workstationBuffer = ''
let workstationPending = []
let workstationHeartbeat = null
let workstationConnecting = null

function resetWorkstationSocket() {
  if (workstationHeartbeat) clearInterval(workstationHeartbeat)
  workstationHeartbeat = null
  workstationConnecting = null
  workstationBuffer = ''
  workstationPending.splice(0).forEach(({ resolve }) => resolve(null))
  if (workstationSocket) {
    try { workstationSocket.destroy() } catch {}
  }
  workstationSocket = null
}

function handleWorkstationLine(line) {
  const pending = workstationPending.shift()
  if (!pending) return
  clearTimeout(pending.timer)
  try { pending.resolve(JSON.parse(line)) }
  catch { pending.resolve(null) }
}

function workstationRequest(payload, timeout = 1600) {
  return new Promise(resolve => {
    if (!workstationSocket || workstationSocket.destroyed) return resolve(null)
    const timer = setTimeout(() => {
      const index = workstationPending.findIndex(item => item.resolve === resolve)
      if (index >= 0) workstationPending.splice(index, 1)
      resolve(null)
    }, timeout)
    workstationPending.push({ resolve, timer })
    try { workstationSocket.write(JSON.stringify(payload) + '\n') }
    catch {
      clearTimeout(timer)
      workstationPending.pop()
      resolve(null)
    }
  })
}

async function ensureWorkstationConnected() {
  if (workstationSocket && !workstationSocket.destroyed) return true
  if (workstationConnecting) return workstationConnecting

  workstationConnecting = new Promise(resolve => {
    const socket = net.createConnection({ path: WORKSTATION_PIPE })
    const failTimer = setTimeout(() => {
      try { socket.destroy() } catch {}
      resetWorkstationSocket()
      resolve(false)
    }, 1200)

    socket.on('connect', async () => {
      clearTimeout(failTimer)
      workstationSocket = socket
      const registered = await workstationRequest({ type: 'register', clientName: 'widget-panel' }, 1200)
      if (!registered || registered.type !== 'registered') {
        resetWorkstationSocket()
        return resolve(false)
      }
      workstationHeartbeat = setInterval(() => {
        try { workstationSocket?.write(JSON.stringify({ type: 'heartbeat' }) + '\n') }
        catch { resetWorkstationSocket() }
      }, 2000)
      resolve(true)
    })

    socket.on('data', chunk => {
      workstationBuffer += chunk.toString('utf8')
      let idx
      while ((idx = workstationBuffer.indexOf('\n')) >= 0) {
        const line = workstationBuffer.slice(0, idx).trim()
        workstationBuffer = workstationBuffer.slice(idx + 1)
        if (line) handleWorkstationLine(line)
      }
    })
    socket.on('error', () => resetWorkstationSocket())
    socket.on('close', () => resetWorkstationSocket())
  })

  const ok = await workstationConnecting
  workstationConnecting = null
  return ok
}

let win              = null
let isPinned         = false
let lastToggleTime   = 0
let isHiding         = false  // prevents double-hide (blur + toggle arriving together)
let modalOpen        = false  // renderer signals when a settings/manage modal is open
let zoomContentOpen  = false  // renderer signals when a zoomed reader/browser card is active
let lastModalClose   = 0     // timestamp of last modal close — grace period before blur-hide
let coldStart        = true   // true until first successful IPC connection
let rendererReady    = false  // true once renderer has registered its panel listeners
let _showAnimating   = false  // true while showPanel() pre-send is in flight
let g_fadeIv         = null   // active opacity-fade interval — cancel before starting a new one
let panelOnlyWidth      = parseInt(getStore('wp-width')) || 720  // panel width before browser was embedded
let browserEmbedded     = false  // whether brave window is currently embedded in win
let _showStateTimeout   = null   // ID of the 350ms post-show notifyHelperState timer
let panelGeometryLockUntil = 0

// ── Single instance lock ──────────────────────────────────────────────────────
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) { app.quit() }
else {
  app.on('second-instance', () => { if (win) { win.show(); win.focus() } })
}

// ── Disable native Windows Widgets ────────────────────────────────────────────
function disableNativeWidgets() {
  const psStatements = [
    `Set-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced' -Name 'TaskbarDa' -Value 0 -Type DWord -Force`,
    `Set-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced' -Name 'TaskbarAl' -Value 1 -Type DWord -Force`,
  ].join('; ')
  exec(`powershell -NoProfile -NonInteractive -Command "try { ${psStatements} } catch {}"`, () => {})
  exec('reg add "HKLM\\SOFTWARE\\Policies\\Microsoft\\Dsh" /v AllowNewsAndInterests /t REG_DWORD /d 0 /f', () => {})
}

// ── Named Pipe server for C++ taskbar-btn helper ──────────────────────────────
// Protocol (newline-delimited JSON):
//   Electron → helper   {"type":"badge","count":N}
//                       {"type":"state","visible":true|false}
//   Helper  → Electron  {"type":"toggle"}
//                       {"type":"ready"}

let pipeServer = null
let pipeSocket = null   // one client (the taskbar-btn process)
let lastBrowserOpenTime = 0   // debounce blur after opening a browser link

function broadcastToHelper(obj) {
  if (!pipeSocket || pipeSocket.destroyed) return
  try { pipeSocket.write(JSON.stringify(obj) + '\n') } catch {}
}

function createPipeServer() {
  // Use TCP on localhost — no integrity-level restrictions unlike named pipes.
  // Port 47321 is our fixed IPC port (widget-panel).
  const PORT = 47321

  function onSocket(socket) {
    console.log('[ipc] taskbar-btn connected')
    pipeSocket = socket
    broadcastToHelper({ type: 'state', visible: win ? win.isVisible() : true })

    socket.on('data', chunk => {
      const lines = chunk.toString().split('\n').filter(l => l.trim())
      for (const line of lines) {
        try {
          const msg = JSON.parse(line)
          if (msg.type === 'ready') {
            log('[tcp] ready received, win=', !!win, 'coldStart=', coldStart)
            if (!win) return
            if (coldStart) {
              // First ever connection after Electron was launched by the button
              coldStart = false
              lastToggleTime = Date.now()
              log('[tcp] coldStart → win.show(), isVisible=', win.isVisible())
              if (!win.isVisible()) { showPanel() }
            }
            notifyHelperState(win.isVisible())
          }
          else if (msg.type === 'clickoutside') {
            if (!isPinned) {
              setTimeout(() => {
                if (modalOpen)                         { log('[clickoutside] modal open — skip'); return }
                if (zoomContentOpen)                    { log('[clickoutside] zoom content open — skip'); return }
                if (Date.now() - lastModalClose < 400) { log('[clickoutside] modal just closed — skip'); return }
                log('[clickoutside] → hidePanel()'); hidePanel()
              }, 150)
            } else { log('[clickoutside] pinned — ignored') }
          }
          else if (msg.type === 'toggle') {
            if (!win) return
            lastToggleTime = Date.now()
            log('[toggle] isVisible=', win.isVisible())
            if (win.isVisible()) { hidePanel() }
            else { showPanel() }
            // Do NOT broadcastToHelper here — hidePanel/showPanel manage state via
            // their async callbacks and win.on('hide'/'show'). Broadcasting now would
            // send stale visible:true while the 260ms fade is still in progress.
          }
        } catch {}
      }
    })
    socket.on('end',   () => { pipeSocket = null })
    socket.on('error', () => { pipeSocket = null })
  }

  pipeServer = net.createServer(onSocket)
  pipeServer.on('error', err => {
    console.error('[ipc] server error:', err.code, err.message)
    if (err.code === 'EADDRINUSE') {
      setTimeout(createPipeServer, 1000)
    }
  })
  pipeServer.listen(PORT, '127.0.0.1', () =>
    console.log('[ipc] server listening on TCP 127.0.0.1:' + PORT))
}

// Animate window-level opacity (DWM) — cancels any in-progress fade before starting
function fadeOpacity(from, to, ms, onDone) {
  if (g_fadeIv) { clearInterval(g_fadeIv); g_fadeIv = null }
  win.setOpacity(from)
  const steps = Math.round(ms / 16)
  let i = 0
  g_fadeIv = setInterval(() => {
    i++
    const t = i / steps
    win.setOpacity(from + (to - from) * t)
    if (i >= steps) { clearInterval(g_fadeIv); g_fadeIv = null; win.setOpacity(to); onDone?.() }
  }, 16)
}

// Show panel: window starts invisible, fades in while CSS slides in — no DWM ghost
function showPanel() {
  if (!win || win.isVisible() || _showAnimating) return
  _showAnimating = true
  win.setOpacity(0)
  win.show()
  if (!isPinned) setTimeout(() => win.focus(), 150)
  // Always send panel-show regardless of rendererReady — the renderer has already
  // registered its listener after the first load; panel-renderer-ready handles cold-start.
  // Guarding on rendererReady here caused silent failures when did-start-loading fired
  // spuriously (e.g. from iframes) and left rendererReady=false.
  win.webContents.send('panel-show')
  fadeOpacity(0, isPinned ? pinnedWinOpacity() : 1, 120, () => { _showAnimating = false })
}

// Initiate slide-out: fade window to invisible first so DWM ghost never shows
function hidePanel(opts = {}) {
  if (!win || !win.isVisible() || isHiding) return
  if (!opts.force && Date.now() < panelGeometryLockUntil) {
    log('[hidePanel] geometry lock - skip')
    return
  }
  log('[hidePanel] called, browserEmbedded=', browserEmbedded, new Error().stack.split('\n')[2]?.trim())
  // Cancel the post-show notifyHelperState timer — if hide completes before it fires
  // (hide=260ms < timer=350ms), the timer would send stale visible:true → g_panelOn stuck.
  if (_showStateTimeout) { clearTimeout(_showStateTimeout); _showStateTimeout = null }
  modalOpen = false
  isHiding = true
  if (browserEmbedded) {
    sendToBrave({ type: 'close' })
    browserEmbedded = false
    win.webContents.send('browser-pane-hide')
    const { workArea } = screen.getPrimaryDisplay()
    win.setBounds({ x: PANEL_GAP, y: workArea.y + PANEL_GAP, width: panelOnlyWidth, height: workArea.height - PANEL_GAP * 2 })
  }
  win.webContents.send('panel-hide')
  fadeOpacity(win.getOpacity(), 0, 260, () => {
    win.hide()
    win.setOpacity(1)
    notifyHelperState(false)
    isHiding = false
  })
}

// Send badge count to C++ helper (and to Electron's own overlay icon)
function sendBadge(count) {
  broadcastToHelper({ type: 'badge', count })
  setTaskbarOverlay(count)
}


// Send visibility state to the C++ helper button
function notifyHelperState(visible) {
  broadcastToHelper({ type: 'state', visible })
}

function getPanelHwnd() {
  if (!win || win.isDestroyed()) return 0
  return Number(win.getNativeWindowHandle().readBigInt64LE(0))
}

// Send panel HWND to the DLL so the mouse hook can call GetWindowRect directly.
function notifyHelperHwnds() {
  if (!win || win.isDestroyed()) return
  const panelHwnd = getPanelHwnd()
  log('[notifyHelperHwnds] panel=', panelHwnd, 'isPinned=', isPinned)
  broadcastToHelper({ type: 'hwnd', panel: panelHwnd, brave: 0 })
  sendToBrave({ type: 'round-corners', hwnd: panelHwnd })
  // When the browser is embedded the shell is HWND_TOPMOST above the panel —
  // skip z-order adjustment so Brave content remains visible above Electron.
  if (!browserEmbedded) {
    sendToBrave({ type: isPinned ? 'z-bottom' : 'z-top', hwnd: panelHwnd })
  }
}

// ── Spawn taskbar-btn.exe ─────────────────────────────────────────────────────
function spawnTaskbarBtn() {
  // Installed build output: native/bin/taskbar-btn.exe
  const helperPath = path.join(NATIVE_BIN, 'taskbar-btn.exe')
  if (!fs.existsSync(helperPath)) {
    console.log('[taskbar-btn] not built yet — run: cd native/taskbar-btn && powershell -File build.ps1')
    return
  }
  const child = spawn(helperPath, [], {
    detached: false,
    stdio:    'ignore',
  })
  child.on('exit', code => console.log(`[taskbar-btn] exited (${code})`))
  app.on('before-quit', () => { try { child.kill() } catch {} })
}

// ── Create window ─────────────────────────────────────────────────────────────
function createWindow() {
  const { workArea } = screen.getPrimaryDisplay()
  const panelW = getStore('wp-width') || 720

  win = new BrowserWindow({
    width:           panelW,
    height:          workArea.height - PANEL_GAP * 2,
    x:               -(panelW + PANEL_GAP),  // start off-screen; animation slides it in
    y:               workArea.y + PANEL_GAP,
    frame:           false,
    backgroundMaterial: PANEL_BACKGROUND_MATERIAL,
    backgroundColor: '#00000000',
    alwaysOnTop:     true,
    skipTaskbar:     true,
    resizable:       false,            // we handle resize ourselves via drag handle
    show:            false,
    webPreferences: {
      preload:          path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration:  false,
      webviewTag:       true,
    },
  })

  win.webContents.setBackgroundThrottling(false)

  if (isDev) {
    win.loadURL('http://localhost:5173')
    win.webContents.openDevTools({ mode: 'detach' })
  } else {
    win.loadFile(path.join(__dirname, 'renderer', 'dist', 'index.html'))
  }

  // Reset flags on each new window
  coldStart     = true
  rendererReady = false
  win.webContents.on('did-start-loading', () => {
    log('[webContents] did-start-loading — rendererReady reset')
    rendererReady = false
  })

  win.on('close', (e) => {
    if (process.platform === 'win32') {
      e.preventDefault()
      win.hide()
      notifyHelperState(false)
    }
  })

  // Hide when user clicks outside the panel (unless pinned)
  // Debounce: ignore blur within 300ms of a toggle to avoid the W button
  // click briefly focusing Explorer and immediately hiding the panel.
  win.on('blur', () => {
    const dt        = Date.now() - lastToggleTime
    const dtBrowser = Date.now() - lastBrowserOpenTime
    log('[blur] isPinned=', isPinned, 'isVisible=', win.isVisible(), 'dt=', dt, 'dtBrowser=', dtBrowser)
    if (!isPinned && win.isVisible()) {
      if (dt < 200)        { log('[blur] debounced (toggle)'); return }
      if (dtBrowser < 500) { log('[blur] debounced (browser-open)'); return }
      if (browserEmbedded) { log('[blur] browserEmbedded — skip hide'); return }
      // Delay 150ms: lets in-flight modal-open IPC land and lets Windows
      // finish any momentary focus transfer caused by the click itself.
      setTimeout(() => {
        if (!win || !win.isVisible() || isPinned) return
        if (win.isFocused()) { log('[blur/delay] focus returned — skip'); return }
        if (modalOpen)                           { log('[blur/delay] modal open — skip'); return }
        if (zoomContentOpen)                     { log('[blur/delay] zoom content open — skip'); return }
        if (Date.now() - lastModalClose < 400)   { log('[blur/delay] modal just closed — skip'); return }
        log('[blur/delay] → hidePanel() modalOpen=', modalOpen, 'lastModalClose=', lastModalClose)
        hidePanel()
      }, 150)
    }
  })


  win.on('show', () => {
    lastToggleTime = Date.now()
    const { workArea } = screen.getPrimaryDisplay()
    const targetW = browserEmbedded ? win.getSize()[0] : panelOnlyWidth
    win.setBounds({ x: PANEL_GAP, y: workArea.y + PANEL_GAP, width: targetW, height: workArea.height - PANEL_GAP * 2 })
    // Delay so the strip WM_LBUTTONDOWN passes through the hook before g_panelOn=true.
    _showStateTimeout = setTimeout(() => {
      _showStateTimeout = null
      notifyHelperState(true)
      notifyHelperHwnds()
    }, 350)
    log('[win] show — rendererReady=', rendererReady, '_showAnimating=', _showAnimating)
    if (!_showAnimating) {
      // Fallback: if show wasn't triggered via showPanel() (e.g. second-instance), send now
      win.webContents.send('panel-show')
    }
  })
  win.on('hide', () => {
    // Move off-screen left of the strip so next show starts slide-in from translateX(-100%)
    const w = win.getSize()[0]
    win.setPosition(-w, win.getPosition()[1])
    if (_showStateTimeout) { clearTimeout(_showStateTimeout); _showStateTimeout = null }
    notifyHelperState(false)
    isHiding = false
  })
}

// ── Pin / unpin ───────────────────────────────────────────────────────────────
function pinnedWinOpacity() { return parseFloat(getStore('wp-pinned-opacity') || '0.25') }

function togglePin(forceTo) {
  isPinned = forceTo !== undefined ? forceTo : !isPinned
  // While embedded, alwaysOnTop is forced false so the Brave shell wins
  // z-order. Don't re-promote Electron on unpin or we cover Brave again.
  if (!browserEmbedded) {
    if (isPinned) {
      win.setAlwaysOnTop(false)
    } else {
      win.setAlwaysOnTop(true, 'floating')
    }
  }
  if (win.isVisible()) {
    const panelHwnd = getPanelHwnd()
    sendToBrave({ type: isPinned ? 'z-bottom' : 'z-top', hwnd: panelHwnd })
    fadeOpacity(win.getOpacity(), isPinned ? pinnedWinOpacity() : 1, 300)
  } else if (isPinned) {
    showPanel()
  }
  win.webContents.send('pin-state', isPinned)
}

// ── Taskbar overlay icon (Electron's own button) ──────────────────────────────
function setTaskbarOverlay(count) {
  if (!win) return
  if (count === 0) { win.setOverlayIcon(null, ''); return }
  const { createCanvas } = (() => { try { return require('canvas') } catch { return {} } })()
  if (!createCanvas) return
  const c = createCanvas(16, 16)
  const ctx = c.getContext('2d')
  ctx.fillStyle = '#f74f7e'
  ctx.beginPath(); ctx.arc(8, 8, 7, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = '#fff'; ctx.font = 'bold 9px sans-serif'
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  ctx.fillText(count > 9 ? '9+' : String(count), 8, 8)
  win.setOverlayIcon(nativeImage.createFromBuffer(c.toBuffer('image/png')), `${count} unread`)
}

// ── IPC handlers ──────────────────────────────────────────────────────────────
// Returns the Windows accent color as #rrggbb
ipcMain.handle('system-accent-color', () => {
  const raw = systemPreferences.getAccentColor() // 'rrggbbaa'
  return '#' + raw.slice(0, 6)
})

function getThemeWindowColor() {
  return nativeTheme.shouldUseDarkColors ? '#1f1f1f' : '#f3f3f3'
}

ipcMain.handle('system-window-color', () => getThemeWindowColor())

nativeTheme.on('updated', () => {
  if (win) win.webContents.send('system-color-updated', getThemeWindowColor())
})

ipcMain.on('modal-open',  () => { modalOpen = true;  log('[modal-open] modalOpen=true') })
ipcMain.on('modal-close', () => { modalOpen = false; lastModalClose = Date.now(); log('[modal-close] grace period started') })
ipcMain.on('reader-zoom-active', (_e, active) => {
  zoomContentOpen = !!active
  log('[reader-zoom-active]', zoomContentOpen)
})

ipcMain.handle('store-get',    (_e, key)       => getStore(key))
ipcMain.handle('store-set',    (_e, key, value) => { log('[store-set]', key, '=', storeLogValue(key, value)); setStore(key, value) })
ipcMain.handle('store-delete', (_e, key)       => deleteStore(key))
ipcMain.on('renderer-log',     (_e, ...args)   => log('[renderer]', ...args))

ipcMain.handle('set-window-opacity', (_e, value) => {
  setStore('wp-opacity', String(Math.max(0.1, Math.min(1, value))))
  // Transparency is now CSS-based (body/panel background rgba); no win.setOpacity() needed.
})

ipcMain.handle('pin-toggle', () => { togglePin(); return isPinned })
ipcMain.handle('pin-get',    () => isPinned)

ipcMain.on('badge-update', (_e, count) => sendBadge(count))

ipcMain.handle('workstation-connect', async () => ensureWorkstationConnected())
ipcMain.handle('workstation-disconnect', async () => {
  if (workstationSocket && !workstationSocket.destroyed) {
    try { workstationSocket.write(JSON.stringify({ type: 'unregister' }) + '\n') } catch {}
  }
  resetWorkstationSocket()
  return true
})
ipcMain.handle('workstation-snapshot', async () => {
  const connected = await ensureWorkstationConnected()
  if (!connected) return null
  return workstationRequest({ type: 'snapshot' }, 1600)
})

ipcMain.handle('autostart-get', () => app.getLoginItemSettings().openAtLogin)
ipcMain.handle('autostart-set', (_e, enabled) => {
  app.setLoginItemSettings({ openAtLogin: enabled })
  return enabled
})

function fullPanelWidth() {
  const { workArea } = screen.getPrimaryDisplay()
  return Math.max(320, workArea.width - PANEL_GAP * 2)
}

function basePanelWidth(baseColumnCount = 3, colWidths = {}) {
  const count = Math.max(3, Math.min(PANEL_COLUMNS.length, Number(baseColumnCount) || 3))
  const widths = { ...PANEL_DEFAULT_COL_WIDTHS, ...(colWidths || {}) }
  const cols = PANEL_COLUMNS.slice(0, count)
  const columnsWidth = cols.reduce((sum, col) => sum + Math.max(150, Math.min(900, Number(widths[col]) || PANEL_DEFAULT_COL_WIDTHS[col] || 220)), 0)
  const dividersWidth = Math.max(0, count - 1) * PANEL_DIVIDER_WIDTH
  return Math.max(320, Math.min(fullPanelWidth(), columnsWidth + dividersWidth + PANEL_RESIZE_HANDLE_WIDTH + 22))
}

function setPanelGeometryForMode(mode = 'base', baseColumnCount = 3, colWidths = {}) {
  if (!win) return { ok: false, error: 'window unavailable' }
  const { workArea } = screen.getPrimaryDisplay()
  const targetMode = String(mode || 'base')
  const stageMode = targetMode !== 'base'
  const width = stageMode ? fullPanelWidth() : basePanelWidth(baseColumnCount, colWidths)
  panelGeometryLockUntil = Date.now() + 700
  if (!stageMode) {
    panelOnlyWidth = width
    setStore('wp-width', width)
  }
  win.setBounds({ x: PANEL_GAP, y: workArea.y + PANEL_GAP, width, height: workArea.height - PANEL_GAP * 2 })
  lastToggleTime = Date.now()
  notifyHelperHwnds()
  log('[panel-fit-mode]', `mode=${targetMode}`, `stage=${stageMode}`, `width=${width}`, `baseColumns=${baseColumnCount}`)
  return { ok: true, mode: targetMode, width, fullWidth: fullPanelWidth(), stageMode }
}

ipcMain.handle('panel-fit-mode', async (_e, options = {}) => {
  const result = setPanelGeometryForMode(options.mode, options.baseColumnCount, options.colWidths)
  await new Promise(resolve => setTimeout(resolve, 48))
  return result
})

// Panel resize — main process polls cursor so dragging past the window edge works
let resizeInterval  = null
let resizeStartX    = 0
let resizeStartW    = 0

ipcMain.on('panel-resize-start', (_e, startX, startW) => {
  if (!win || browserEmbedded) return   // don't resize panel while browser is embedded
  resizeStartX = startX
  resizeStartW = startW
  if (resizeInterval) clearInterval(resizeInterval)

  resizeInterval = setInterval(() => {
    if (!win) { clearInterval(resizeInterval); resizeInterval = null; return }
    const { x: curX } = screen.getCursorScreenPoint()
    const { workArea } = screen.getPrimaryDisplay()
    const newW = Math.max(320, Math.min(resizeStartW + (curX - resizeStartX), workArea.width - 40))
    win.setBounds({ x: PANEL_GAP, y: workArea.y + PANEL_GAP, width: newW, height: workArea.height - PANEL_GAP * 2 })
  }, 16)
})

ipcMain.on('panel-resize-end', () => {
  if (resizeInterval) { clearInterval(resizeInterval); resizeInterval = null }
  if (win) {
    const w = win.getSize()[0]
    setStore('wp-width', w)
    if (!browserEmbedded) panelOnlyWidth = w
  }
})

// Renderer signals it has registered listeners — send panel-show if window is already visible
ipcMain.on('panel-renderer-ready', () => {
  rendererReady = true
  log('[ipc] panel-renderer-ready — isVisible=', win && win.isVisible())
  if (win && win.isVisible()) {
    setTimeout(() => { log('[ipc] sending panel-show'); win.webContents.send('panel-show') }, 50)
  }
})

// panel-hide-done is handled inline in hidePanel() via ipcMain.once

// ── Yahoo Finance handler (no CORS restrictions in main process) ────────────────
ipcMain.handle('yahoo-chart', async (_e, ticker) => {
  return new Promise((resolve) => {
    // Intraday 5-minute candles for today (or the most recent trading day on
    // weekends/holidays — Yahoo falls back automatically). Crypto returns 24h
    // of candles. ~78 points for a US session, plenty for an iOS-Stocks-style
    // sparkline; ~288 for crypto.
    // encodeURIComponent so raw index symbols like ^GSPC, ^N225 survive the
    // URL — Yahoo accepts %5E for the caret.
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=1d&interval=5m`;
    const options = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    };
    https.get(url, options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const meta = json?.chart?.result?.[0]?.meta;
          const closes = json?.chart?.result?.[0]?.indicators?.quote?.[0]?.close?.filter(Boolean) || [];
          if (meta) {
            const price = meta.regularMarketPrice;
            const prev = meta.chartPreviousClose ?? meta.regularMarketPreviousClose ?? meta.previousClose;
            const pp = closes.length >= 2 ? closes[closes.length - 2] : null;
            resolve({
              price, prev,
              change: price - prev, pct: (price - prev) / prev * 100,
              prevChange: pp != null ? prev - pp : null,
              prevPct: pp != null ? (prev - pp) / pp * 100 : null,
              name: meta.longName || meta.shortName || '',
              date: new Date((meta.regularMarketTime || Date.now()/1000) * 1000),
              closes: closes,
            });
          } else {
            resolve(null);
          }
        } catch (e) {
          log('[yahoo-chart] parse error for', ticker, ':', e.message);
          resolve(null);
        }
      });
    }).on('error', (e) => {
      log('[yahoo-chart] error for', ticker, ':', e.message);
      resolve(null);
    });
  });
});

function yahooJson(url) {
  return new Promise((resolve) => {
    const options = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json,text/plain,*/*',
      },
    };
    https.get(url, options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve(null); }
      });
    }).on('error', () => resolve(null));
  });
}

function asDateFromYahoo(value) {
  if (!value) return null;
  const raw = Array.isArray(value) ? value[0] : value;
  const seconds = raw?.raw ?? raw;
  const n = Number(seconds);
  if (Number.isFinite(n)) return new Date(n * 1000).toISOString();
  const text = raw?.fmt ?? raw?.date ?? raw?.value ?? raw;
  if (!text) return null;
  const parsed = new Date(String(text));
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function asNumberFromYahoo(value) {
  const n = Number(value?.raw ?? value);
  return Number.isFinite(n) ? n : null;
}

function normalizeYahooTicker(ticker) {
  return String(ticker || '')
    .trim()
    .replace(/^.*:/, '')
    .replace(/\//g, '-');
}

function eventSortTime(value) {
  const time = new Date(value || '').getTime();
  return Number.isFinite(time) ? time : Number.MAX_SAFE_INTEGER;
}

ipcMain.handle('market-events', async (_e, tickers = []) => {
  const cleanTickers = Array.from(new Set((tickers || [])
    .map(normalizeYahooTicker)
    .filter(Boolean)))
    .slice(0, 24);
  const earnings = [];
  await Promise.all(cleanTickers.map(async ticker => {
    const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ticker)}?modules=calendarEvents,price`;
    const json = await yahooJson(url);
    const result = json?.quoteSummary?.result?.[0];
    const events = result?.calendarEvents;
    const date = asDateFromYahoo(events?.earnings?.earningsDate);
    if (!date) return;
    earnings.push({
      ticker,
      name: result?.price?.shortName || result?.price?.longName || '',
      date,
      revenueAverage: asNumberFromYahoo(events?.earnings?.revenueAverage),
      revenueLow: asNumberFromYahoo(events?.earnings?.revenueLow),
      revenueHigh: asNumberFromYahoo(events?.earnings?.revenueHigh),
    });
  }));

  const today = new Date();
  const end = new Date(today.getTime() + 30 * 86400000);
  const fmt = d => d.toISOString().slice(0, 10);
  const ipoUrl = `https://query1.finance.yahoo.com/v1/finance/calendar/ipo?from=${fmt(today)}&to=${fmt(end)}`;
  const ipoJson = await yahooJson(ipoUrl);
  const documents = ipoJson?.finance?.result?.[0]?.documents || ipoJson?.ipoCalendar?.result || [];
  const ipos = documents.slice(0, 12).map(item => ({
    name: item.companyName || item.name || item.company || item.symbol || 'IPO',
    symbol: item.symbol || item.ticker || '',
    date: asDateFromYahoo(item.expectedDate || item.pricingDate || item.date || item.startDate) || '',
    exchange: item.exchange || '',
    priceLow: asNumberFromYahoo(item.priceLow),
    priceHigh: asNumberFromYahoo(item.priceHigh),
  })).filter(item => item.name || item.symbol);

  earnings.sort((a, b) => eventSortTime(a.date) - eventSortTime(b.date));
  ipos.sort((a, b) => eventSortTime(a.date) - eventSortTime(b.date));
  return { ok: true, earnings: earnings.slice(0, 12), ipos, updatedAt: Date.now() };
});

// ── Brave host TCP server (port 47322) ────────────────────────────────────────
let braveServer    = null
let braveSocket    = null
let currentUrl     = ''
let navLoadTimer   = null   // auto-clears the loading spinner if brave-host never acks
const TOOLBAR_H = 42

// Clear the brave-loading spinner after a timeout in case brave-host doesn't
// send 'ready' after navigation. 12s aligns with brave-host's 15s CDP /json
// poll budget so the spinner stays visible long enough for a slow first-
// post-open navigate to land.
function armNavLoadTimer() {
  if (navLoadTimer) clearTimeout(navLoadTimer)
  navLoadTimer = setTimeout(() => {
    navLoadTimer = null
    if (win && !win.isDestroyed() && browserEmbedded) win.webContents.send('brave-loading', false)
  }, 12000)
}

function sendToBrave(obj) {
  if (!braveSocket || braveSocket.destroyed) {
    log('[brave-tcp] sendToBrave: no socket', JSON.stringify(obj))
    return
  }
  log('[brave-tcp] sendToBrave:', JSON.stringify(obj))
  try { braveSocket.write(JSON.stringify(obj) + '\n') } catch (e) { log('[brave-tcp] write error:', e.message) }
}

function createBraveServer() {
  braveServer = net.createServer(socket => {
    log('[brave-tcp] client connected')
    // Close stale connection before adopting new one
    if (braveSocket && !braveSocket.destroyed) {
      log('[brave-tcp] closing previous socket')
      braveSocket.destroy()
    }
    braveSocket = socket

    socket.on('data', chunk => {
      chunk.toString().split('\n').filter(l => l.trim()).forEach(line => {
        try {
          const msg = JSON.parse(line)
          if (msg.type === 'ready' && browserEmbedded) {
            if (navLoadTimer) { clearTimeout(navLoadTimer); navLoadTimer = null }
            win.webContents.send('brave-loading', false)
            win.webContents.send('brave-url', currentUrl)
            // Shell is HWND_TOPMOST and positioned below the toolbar — do not call
            // win.moveTop() here as it would promote Electron above the shell and
            // cover Brave content.
          }
        } catch {}
      })
    })
    // Guard: only clear braveSocket if this closure's socket is still the active one
    socket.on('end',   () => { log('[brave-tcp] client disconnected (end)');   if (braveSocket === socket) braveSocket = null })
    socket.on('error', (e) => { log('[brave-tcp] client error:', e.message);   if (braveSocket === socket) braveSocket = null })
  })
  braveServer.on('error', err => {
    if (err.code === 'EADDRINUSE') setTimeout(createBraveServer, 1000)
  })
  braveServer.listen(47322, '127.0.0.1', () => log('[brave-tcp] listening on 47322'))
}

function spawnBraveHost() {
  const helperPath = path.join(NATIVE_BIN, 'brave-host.exe')
  if (!fs.existsSync(helperPath)) { log('[brave-host] not built yet'); return }
  const child = spawn(helperPath, [], { detached: false, stdio: 'ignore' })
  child.on('exit', code => log(`[brave-host] exited (${code})`))
  app.on('before-quit', () => { try { child.kill() } catch {} })
}

function openBraveInPanel(url) {
  const { workArea, bounds, scaleFactor: sf } = screen.getPrimaryDisplay()
  const panelW = win.getSize()[0]
  if (!browserEmbedded) panelOnlyWidth = panelW

  // Panel window is inset PANEL_GAP from the left; Brave starts right after the panel at screen x=PANEL_GAP+panelW
  // Window also leaves PANEL_GAP on the right side, matching the panel's left gap to the screen
  const panelScreenRight = PANEL_GAP + panelW   // screen x where panel ends (physical = *sf)
  const physPanelRight  = Math.round(panelScreenRight * sf)
  const physScreenRight = Math.round(bounds.width * sf)
  const physRightGap    = Math.round(PANEL_GAP * sf)
  const braveW = Math.floor((physScreenRight - physPanelRight - physRightGap) / sf)
  const totalW = panelW + braveW
  const braveH = workArea.height - PANEL_GAP * 2

  currentUrl = url
  lastBrowserOpenTime = Date.now()

  win.setBounds({ x: PANEL_GAP, y: workArea.y + PANEL_GAP, width: totalW, height: braveH })
  browserEmbedded = true

  // Drop Electron out of HWND_TOPMOST while embedded so the Brave shell
  // (which sets itself HWND_TOPMOST after reparent) wins z-order. Otherwise
  // the panel's acrylic-transparent DOM paints in front of Brave.
  win.setAlwaysOnTop(false)

  win.webContents.send('browser-pane-show', { url, braveX: panelW })
  win.webContents.send('brave-loading', true)
  win.webContents.send('brave-url', url)

  // BRAVE_M: margin around the shell, so the panel-color backdrop is visible as a frame
  const BRAVE_M = 8
  sendToBrave({ type: 'open', hwnd: 0,
    x: Math.round((panelScreenRight + BRAVE_M) * sf),
    y: Math.round((workArea.y + PANEL_GAP + TOOLBAR_H) * sf),
    w: Math.round((braveW - BRAVE_M * 2) * sf),
    h: Math.round((braveH - TOOLBAR_H - BRAVE_M) * sf),
    url })
  notifyHelperHwnds()
}

function closeBraveInPanel() {
  sendToBrave({ type: 'close' })
  browserEmbedded = false
  currentUrl = ''
  win.webContents.send('browser-pane-hide')
  const { workArea } = screen.getPrimaryDisplay()
  if (panelOnlyWidth > 0) win.setBounds({ x: PANEL_GAP, y: workArea.y + PANEL_GAP, width: panelOnlyWidth, height: workArea.height - PANEL_GAP * 2 })
  // Restore alwaysOnTop (dropped during embed) — respect current pin state.
  if (!isPinned) win.setAlwaysOnTop(true, 'floating')
  notifyHelperHwnds()
}

ipcMain.on('browser-open', (_e, url) => {
  log('[browser-open] url=', url, 'browserEmbedded=', browserEmbedded, 'socket=', !!braveSocket)
  if (browserEmbedded) {
    // Navigate existing embedded window to the new article
    currentUrl = url
    win.webContents.send('brave-loading', true)
    win.webContents.send('brave-url', url)
    sendToBrave({ type: 'navigate', url })
    armNavLoadTimer()
  } else {
    openBraveInPanel(url)
  }
})

ipcMain.on('browser-navigate', (_e, url) => {
  if (!browserEmbedded) { openBraveInPanel(url); return }
  currentUrl = url
  win.webContents.send('brave-loading', true)
  win.webContents.send('brave-url', url)
  sendToBrave({ type: 'navigate', url })
  armNavLoadTimer()
})

ipcMain.on('browser-close', () => { log('[ipc] browser-close received'); closeBraveInPanel() })

// Renderer requests click-through when mouse is over the Brave content area.
// forward:true still delivers synthetic mousemove events so we can detect when
// the cursor leaves the content area and restore normal input.
ipcMain.on('set-ignore-mouse-events', (_, ignore) => {
  win.setIgnoreMouseEvents(ignore, { forward: true })
})

// Toolbar buttons (from preload.js browser object)
ipcMain.on('brave-close',         () => { closeBraveInPanel() })
ipcMain.on('brave-open-external', () => {
  if (!currentUrl) return
  shell.openExternal(currentUrl)
  // Send "detach" so brave-host unparents the embedded window and releases the
  // process handle WITHOUT killing Brave — the externally-opened tab lives on.
  sendToBrave({ type: 'detach' })
  browserEmbedded = false
  win.setBackgroundMaterial(PANEL_BACKGROUND_MATERIAL)
  win.webContents.send('browser-pane-hide')
  const { workArea } = screen.getPrimaryDisplay()
  if (panelOnlyWidth > 0) win.setBounds({ x: PANEL_GAP, y: workArea.y + PANEL_GAP, width: panelOnlyWidth, height: workArea.height - PANEL_GAP * 2 })
  // Restore alwaysOnTop (dropped during embed) — respect current pin state.
  if (!isPinned) win.setAlwaysOnTop(true, 'floating')
  currentUrl = ''
  notifyHelperHwnds()
  // Slide the panel away after detaching
  setTimeout(() => hidePanel(), 300)
})

// ── Write launch path for the DLL to find us ─────────────────────────────────
// The DLL reads native/bin/panel.path and ShellExecutes it when clicked
// while Electron isn't running.
function writeLaunchPath() {
  let launchPath
  if (app.isPackaged) {
    launchPath = process.execPath
  } else {
    // electron.exe lives in node_modules/electron/dist/ — no cmd window
    const electronExe = path.join(__dirname, 'node_modules', 'electron', 'dist', 'electron.exe')
    launchPath = `"${electronExe}" "${__dirname}"`
  }
  const pathFile = path.join(NATIVE_BIN, 'panel.path')
  try { fs.writeFileSync(pathFile, launchPath, 'utf8') } catch {}
}

// ── Self-signed cert allowance for the local Security Center camera webview.
// Scope is host-restricted: only securitycenter.local is auto-accepted.
//
// Two layers because Electron's network stack rejects unknown CAs before the
// certificate-error event has a chance to override:
//   1. setCertificateVerifyProc on the camera webview's session — this runs
//      at the verification layer and is the actual fix.
//   2. app.on('certificate-error') as a backstop for any other surface that
//      might hit the same host.
app.on('certificate-error', (event, _webContents, url, _error, _certificate, callback) => {
  try {
    const u = new URL(url)
    if (u.hostname === 'securitycenter.local') {
      event.preventDefault()
      callback(true)
      return
    }
  } catch {}
  callback(false)
})

function configureCameraSession() {
  // Webview partition (legacy fallback if we ever go back to webview).
  const camSession = session.fromPartition('persist:cameras')
  camSession.setCertificateVerifyProc((request, callback) => {
    callback(request.hostname === 'securitycenter.local' ? 0 : -3)
  })
  // Main renderer also needs this — direct XPMobileSDK integration loads the
  // SDK script and opens streams over HTTPS to securitycenter.local.
  session.defaultSession.setCertificateVerifyProc((request, callback) => {
    callback(request.hostname === 'securitycenter.local' ? 0 : -3)
  })
}

// Header overrides for embedded/SDK-backed surfaces.
//
// Electron's webRequest API allows one onHeadersReceived listener per session,
// so keep these host-specific tweaks together instead of registering competing
// listeners in each widget integration.
function configureResponseHeaderOverrides() {
  const filter = { urls: ['*://*.bloomberg.com/*', 'https://securitycenter.local:8082/*'] }
  session.defaultSession.webRequest.onHeadersReceived(filter, (details, callback) => {
    const headers = {}
    for (const [key, value] of Object.entries(details.responseHeaders || {})) {
      const lk = key.toLowerCase()
      if (details.url.includes('bloomberg.com') && lk === 'x-frame-options') continue
      if (details.url.includes('bloomberg.com') && (lk === 'content-security-policy' || lk === 'content-security-policy-report-only')) {
        const arr = Array.isArray(value) ? value : [value]
        headers[key] = arr.map(v =>
          v.split(';')
           .filter(d => !/^\s*frame-ancestors\b/i.test(d))
           .join(';')
        )
        continue
      }
      headers[key] = value
    }

    try {
      const url = new URL(details.url)
      if (url.hostname === 'securitycenter.local') {
        // XPMobileSDK is served by the Mobile Server, but its XHRs originate
        // from the panel's localhost/file origin. The server answers OPTIONS
        // without CORS headers, which makes Chromium surface the SDK connect
        // failure as an empty `{}`. Patch only this trusted local host.
        headers['Access-Control-Allow-Origin'] = ['*']
        headers['Access-Control-Allow-Methods'] = ['GET, POST, OPTIONS']
        headers['Access-Control-Allow-Headers'] = ['content-type, authorization, x-requested-with']
        headers['Access-Control-Allow-Private-Network'] = ['true']
        headers['Access-Control-Expose-Headers'] = ['content-type, content-length']
      }
    } catch {}

    callback({ responseHeaders: headers })
  })
}

// ── App ready ─────────────────────────────────────────────────────────────────
const LIVE_FEED_PARTITIONS = [
  'persist:bloomberg',
  'persist:live-bloomberg',
  'persist:live-radio-canada',
  'persist:live-france24',
  'persist:live-cbc',
  'persist:live-lcn',
]
const LIVE_FEED_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

function setRequestHeader(headers, name, value, overwrite = false) {
  const existing = Object.keys(headers).find(key => key.toLowerCase() === name.toLowerCase())
  if (existing) {
    if (overwrite) headers[existing] = value
    return
  }
  headers[name] = value
}

function configureLiveFeedSessions() {
  const filter = {
    urls: [
      '*://*.youtube.com/*',
      '*://youtube.com/*',
      '*://*.youtube-nocookie.com/*',
      '*://gem.cbc.ca/*',
      '*://*.cbc.ca/*',
      '*://cbc.ca/*',
    ],
  }

  for (const partition of LIVE_FEED_PARTITIONS) {
    const liveSession = session.fromPartition(partition)
    liveSession.setUserAgent(LIVE_FEED_USER_AGENT)
    liveSession.webRequest.onBeforeSendHeaders(filter, (details, callback) => {
      const headers = { ...(details.requestHeaders || {}) }
      setRequestHeader(headers, 'User-Agent', LIVE_FEED_USER_AGENT, true)

      try {
        const host = new URL(details.url).hostname.toLowerCase()
        const isYouTube = host === 'youtube.com' || host.endsWith('.youtube.com') || host.endsWith('.youtube-nocookie.com')
        const isCbc = host === 'cbc.ca' || host.endsWith('.cbc.ca') || host === 'gem.cbc.ca'
        if (isYouTube) {
          setRequestHeader(headers, 'Accept-Language', 'en-US,en;q=0.9,fr-CA;q=0.8,fr;q=0.7', false)
        } else if (isCbc) {
          setRequestHeader(headers, 'Referer', 'https://gem.cbc.ca/', true)
          setRequestHeader(headers, 'Origin', 'https://gem.cbc.ca', false)
        }
      } catch {}

      callback({ requestHeaders: headers })
    })
    liveSession.setPermissionRequestHandler((_webContents, permission, callback) => {
      callback(['media', 'fullscreen', 'pointerLock'].includes(permission))
    })
    if (liveSession.setPermissionCheckHandler) {
      liveSession.setPermissionCheckHandler((_webContents, permission) => {
        return ['media', 'fullscreen', 'pointerLock'].includes(permission)
      })
    }
  }
}

app.whenReady().then(() => {
  configureCameraSession()
  configureResponseHeaderOverrides()
  configureLiveFeedSessions()
  disableNativeWidgets()
  writeLaunchPath()
  createPipeServer()   // taskbar-btn IPC on port 47321
  createBraveServer()  // brave-host IPC on port 47322
  app.setAppUserModelId('com.widgetpanel.app')  // suppress default "Electron" window title
  createWindow()
  spawnTaskbarBtn()
  spawnBraveHost()

  const savedPin = getStore('wp-pinned')
  if (savedPin) togglePin(true)

  // Enable startup by default on first run so the panel is always pre-loaded.
  // The strip's cold-launch path (ShellExecute) takes 3-5s; keeping Electron
  // running in the background makes every subsequent click instant.
  const autostartInitialized = getStore('wp-autostart-initialized')
  if (!autostartInitialized) {
    app.setLoginItemSettings({ openAtLogin: true })
    setStore('wp-autostart-initialized', '1')
    setStore('wp-autostart', '1')
    log('[autostart] enabled by default on first run')
  } else {
    const savedAutoStart = getStore('wp-autostart')
    if (savedAutoStart) app.setLoginItemSettings({ openAtLogin: true })
  }

  globalShortcut.register('Super+W', () => {
    if (!win) return
    if (win.isVisible()) { hidePanel() }
    else { lastToggleTime = Date.now(); win.show(); setTimeout(() => win.focus(), 150) }
  })
})

// ── Microsoft Graph proxy (avoids CORS in renderer) ──────────────────────────

function httpsRequest(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, res => {
      let data = ''
      res.on('data', chunk => data += chunk)
      res.on('end', () => {
        if (!data) { resolve({ status: res.statusCode, body: null }); return }
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }) }
        catch  { resolve({ status: res.statusCode, body: data }) }
      })
    })
    req.on('error', reject)
    if (body) req.write(body)
    req.end()
  })
}

ipcMain.handle('ms-graph-fetch', async (_e, url, accessToken) => {
  const u = new URL(url)
  return httpsRequest({ hostname: u.hostname, path: u.pathname + u.search,
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json',
      Prefer: 'outlook.timezone="UTC"' } })
})

ipcMain.handle('ms-graph-patch', async (_e, url, accessToken, patchBody) => {
  const u = new URL(url)
  const body = JSON.stringify(patchBody)
  return httpsRequest({
    hostname: u.hostname, path: u.pathname + u.search, method: 'PATCH',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json',
               'Content-Length': Buffer.byteLength(body) }
  }, body)
})

function rssFetch(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) { reject(new Error('too many redirects')); return }
    const u = new URL(url)
    const mod = u.protocol === 'http:' ? require('http') : require('https')
    const req = mod.request({
      hostname: u.hostname, path: u.pathname + u.search,
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/rss+xml, application/xml, text/xml, */*',
                 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' }
    }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume()
        resolve(rssFetch(new URL(res.headers.location, url).href, redirects + 1))
        return
      }
      let data = ''
      res.on('data', chunk => data += chunk)
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve({ ok: true, status: res.statusCode, text: data })
        else resolve({ ok: false, status: res.statusCode, error: `HTTP ${res.statusCode}` })
      })
    })
    req.on('error', reject)
    req.end()
  })
}

ipcMain.handle('rss-fetch', async (_e, url) => {
  try { return await rssFetch(url) }
  catch (e) { return { ok: false, error: e.message } }
})

function extractYouTubeVideoId(input = '') {
  try {
    const url = new URL(input)
    const host = url.hostname.replace(/^www\./i, '').toLowerCase()
    if (host === 'youtu.be') return url.pathname.split('/').filter(Boolean)[0] || ''
    if (host === 'youtube.com' || host.endsWith('.youtube.com')) {
      if (url.searchParams.get('v')) return url.searchParams.get('v')
      const parts = url.pathname.split('/').filter(Boolean)
      const marker = parts.findIndex(part => ['embed', 'live', 'shorts'].includes(part))
      if (marker >= 0 && parts[marker + 1]) return parts[marker + 1]
    }
  } catch {}
  const match = String(input).match(/(?:v=|youtu\.be\/|embed\/|live\/)([A-Za-z0-9_-]{6,})/i)
  return match?.[1] || ''
}

function extractBalancedJson(text = '', marker = '') {
  const markerIndex = text.indexOf(marker)
  if (markerIndex < 0) return ''
  const start = text.indexOf('{', markerIndex)
  if (start < 0) return ''
  let depth = 0
  let inString = false
  let escape = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (escape) {
        escape = false
      } else if (ch === '\\') {
        escape = true
      } else if (ch === '"') {
        inString = false
      }
      continue
    }
    if (ch === '"') {
      inString = true
    } else if (ch === '{') {
      depth++
    } else if (ch === '}') {
      depth--
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return ''
}

function extractYouTubePlayerResponse(html = '') {
  const json = extractBalancedJson(html, 'ytInitialPlayerResponse')
  if (json) {
    try { return JSON.parse(json) } catch {}
  }
  const match = html.match(/"hlsManifestUrl"\s*:\s*"([^"]+)"/)
  if (!match) return null
  try {
    return { streamingData: { hlsManifestUrl: JSON.parse(`"${match[1]}"`) } }
  } catch {
    return { streamingData: { hlsManifestUrl: match[1].replace(/\\u0026/g, '&') } }
  }
}

async function resolveYouTubeHls(url) {
  const videoId = extractYouTubeVideoId(url)
  const watchUrl = videoId
    ? `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&bpctr=9999999999&has_verified=1`
    : url
  log('[live-youtube-hls] request', `videoId=${videoId || 'unknown'}`, `url=${url}`)
  const page = await readerFetchText(watchUrl)
  log('[live-youtube-hls] page', `videoId=${videoId || 'unknown'}`, `status=${page.status || '--'}`, `ok=${!!page.ok}`, `bytes=${page.text?.length || 0}`)
  if (!page.ok || !page.text) {
    log('[live-youtube-hls] page-failed', `videoId=${videoId || 'unknown'}`, page.error || `HTTP ${page.status}`)
    return { ok: false, status: page.status, videoId, error: page.error || `HTTP ${page.status}` }
  }
  const response = extractYouTubePlayerResponse(page.text)
  const hlsUrl = response?.streamingData?.hlsManifestUrl || ''
  if (!hlsUrl) {
    const playable = response?.playabilityStatus || {}
    log('[live-youtube-hls] no-manifest', `videoId=${videoId || 'unknown'}`, `playerStatus=${playable.status || '--'}`, `reason=${playable.reason || '--'}`, `hasPlayerResponse=${!!response}`)
    return {
      ok: false,
      status: page.status,
      videoId,
      playerStatus: playable.status || '',
      error: playable.reason || 'No HLS manifest exposed by YouTube',
    }
  }
  let manifestHost = ''
  try { manifestHost = new URL(hlsUrl).hostname } catch {}
  log('[live-youtube-hls] manifest', `videoId=${videoId || 'unknown'}`, `host=${manifestHost || '--'}`, `chars=${hlsUrl.length}`, `playerStatus=${response?.playabilityStatus?.status || '--'}`)
  return {
    ok: true,
    videoId,
    hlsUrl,
    playerStatus: response?.playabilityStatus?.status || '',
  }
}

ipcMain.handle('live-youtube-hls', async (_e, url) => {
  try { return await resolveYouTubeHls(url) }
  catch (e) {
    log('[live-youtube-hls] exception', e.message || String(e))
    return { ok: false, error: e.message || String(e) }
  }
})

function stripTags(value = '') {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
}

function decodeHtml(value = '') {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/\s+/g, ' ')
    .trim()
}

function absolutizeUrl(value, baseUrl) {
  if (!value) return ''
  try { return new URL(value, baseUrl).href } catch { return value }
}

function getMetaContent(html, property) {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>|<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escaped}["'][^>]*>`, 'i')
  const match = html.match(re)
  return decodeHtml(match?.[1] || match?.[2] || '')
}

function extractFirst(html, tag) {
  const match = html.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'))
  return match ? decodeHtml(stripTags(match[1])) : ''
}

const READER_CONTENT_ATTR = '(?:article[-_ ]?(?:body|content|text)?|body[-_ ]?content|content[-_ ]?(?:body|main|post)?|entry[-_ ]?content|main[-_ ]?content|post[-_ ]?(?:body|content|text)|story[-_ ]?(?:body|content))'
const READER_NOISE_ATTR = '(?:ad-|ads?|advert|author-bio|breadcrumb|comment|comments|featured|footer|login|most-popular|newsletter|outbrain|partner|popular|promo|recommend|related|share|sharing|sidebar|signup|social|sponsor|syndication|tag-list|widget)'
const READER_HARD_STOP = /^(?:about the author|add your comment|featured on|follow\b|main sections|more from|most popular|popular features|post a comment|read also|read next|related articles|related stories|share this article|subscribe to|techspot account|top downloads)\b/i
const READER_INLINE_MODULE = /^(?:advertisement|from our partners|partner content|promoted content|recommended content|sponsored content|sponsored by)\b/i
const READER_SKIP_TEXT = /cookie|subscribe|newsletter|advertisement|sign up|log in|login|all rights reserved|share this|read more|serving tech enthusiasts|techspot means tech analysis|create your free account|already have an account|partner content|promoted content|sponsored content/i
const READER_LINE_SKIP = /^(?:about|advertise|all|analytics|articles|by\s+[\w\s.,&-]+|comments?|contact|cookies?|copyright|download|events?|follow|home|login|menu|newsletter|podcasts?|privacy|register|resources?|search|share|subscribe|terms|topics|view all)$/i
const READER_MARKDOWN_STOP = /^(?:#{1,6}\s*)?(?:0\s+comments?|add your comment|all contents are copyright|aspencore network|connect with us|featured techpaper|for advertisers|leave a reply|more from|popular features|read also|read next|related articles|related stories|related topics|share this|subscribe today)\b/i
const READER_MARKDOWN_SKIP = /^(?:\*\*)?(?:advertisement|analytics|applications|automotive|business|community|contact|design|download|events?|featured|home|image|input your search keywords|login|markets?|menu|news|newsletter|podcasts?|privacy|register|resources?|search|semiconductors?|sign in|submit|subscribe|terms|topics|view all|webinars?|white papers?)(?:\*\*)?$/i
const READER_MAX_CHARS = 18000
const READER_MAX_BLOCKS = 60

function stripReaderNoise(html) {
  let cleaned = html
  const attrBlock = new RegExp(`<((?:div|section|aside|nav|footer|ul|ol))\\b[^>]*(?:class|id|role)=["'][^"']*${READER_NOISE_ATTR}[^"']*["'][^>]*>[\\s\\S]*?<\\/\\1>`, 'gi')
  for (let i = 0; i < 4; i++) cleaned = cleaned.replace(attrBlock, ' ')
  cleaned = cutAfterReaderStopMarker(cleaned)
  return cleaned
}

function cutAfterReaderStopMarker(html) {
  const markerRe = /<(h[1-6]|p|div|section|span)\b[^>]*>([\s\S]*?)<\/\1>/gi
  let match
  while ((match = markerRe.exec(html))) {
    const text = decodeHtml(stripTags(match[2]))
    if (/^(?:read also|read next|related articles|related stories)\s*:?\s*$/i.test(text)) {
      return html.slice(0, match.index)
    }
  }
  return html
}

function collectReadableCandidates(html) {
  const candidates = []
  const add = (html, priority) => {
    if (!html) return
    const paragraphCount = html.match(/<p[\s>]/gi)?.length || 0
    const textLength = stripTags(html).length
    if (paragraphCount || textLength > 450) candidates.push({ html, priority, paragraphCount, textLength })
  }
  const contentRe = new RegExp(`<((?:article|main|section|div))\\b[^>]*(?:class|id)=["'][^"']*${READER_CONTENT_ATTR}[^"']*["'][^>]*>([\\s\\S]*?)<\\/\\1>`, 'gi')
  let match
  while ((match = contentRe.exec(html)) && candidates.length < 12) add(match[2], 3)
  add(html.match(/<article[^>]*>([\s\S]*?)<\/article>/i)?.[1], 4)
  add(html.match(/<main[^>]*>([\s\S]*?)<\/main>/i)?.[1], 2)
  add(html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1], 1)
  add(html, 0)
  return candidates
}

function chooseReadableHtml(html) {
  const withoutChrome = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<(nav|header|footer|aside|form|button|iframe|canvas|figure)[\s\S]*?<\/\1>/gi, ' ')
  const withoutNoise = stripReaderNoise(withoutChrome)
  const candidates = collectReadableCandidates(withoutNoise)
  candidates.sort((a, b) => {
    const aUsable = a.paragraphCount >= 3 || a.textLength > 1200
    const bUsable = b.paragraphCount >= 3 || b.textLength > 1200
    if (aUsable !== bUsable) return bUsable - aUsable
    if (a.priority !== b.priority) return b.priority - a.priority
    return b.paragraphCount - a.paragraphCount || b.textLength - a.textLength
  })
  return candidates[0]?.html || withoutNoise
}

function extractParagraphs(articleHtml) {
  const blocks = []
  const re = /<(p|h2|h3|h4|h5|h6|li)[^>]*>([\s\S]*?)<\/\1>/gi
  let match
  let skipRelatedItems = 0
  let skipInlineModule = 0
  while ((match = re.exec(articleHtml))) {
    const tag = match[1].toLowerCase()
    const text = decodeHtml(stripTags(match[2]))
    if (READER_INLINE_MODULE.test(text)) {
      skipInlineModule = 10
      continue
    }
    if (skipInlineModule > 0) {
      if (tag === 'p' && text.length > 140 && /[.!?]"?$/.test(text) && !/^by\b/i.test(text)) {
        skipInlineModule = 0
      } else {
        skipInlineModule -= 1
        continue
      }
    }
    if (/^(?:\/\/\s*)?related stories\b/i.test(text)) {
      skipRelatedItems = 8
      continue
    }
    if (READER_HARD_STOP.test(text)) {
      if (blocks.length > 0) break
      continue
    }
    if (skipRelatedItems > 0 && tag === 'li') {
      skipRelatedItems -= 1
      continue
    }
    if (tag !== 'li') skipRelatedItems = 0
    if (!text || text.length < 35) continue
    if (/^by\s+[\w\s.,&-]+$/i.test(text)) continue
    if (READER_SKIP_TEXT.test(text)) continue
    if ((tag === 'li' || /^h[4-6]$/.test(tag)) && !/[.!?]"?$/.test(text)) continue
    if (blocks.includes(text)) continue
    blocks.push(text)
    if (blocks.join(' ').length > READER_MAX_CHARS || blocks.length >= READER_MAX_BLOCKS) break
  }
  return blocks
}

function lineKey(text = '') {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function htmlToReadableLines(html) {
  const lineBreak = ' __WP_READER_LINE_BREAK__ '
  const withBreaks = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<br\b[^>]*>/gi, '\n')
    .replace(/<(?:p|div|h[1-6]|li|article|section|main|blockquote)\b[^>]*>/gi, '\n')
    .replace(/<\/(?:p|div|h[1-6]|li|article|section|main|blockquote)>/gi, '\n')
  return decodeHtml(stripTags(withBreaks).replace(/\n+/g, lineBreak))
    .split(lineBreak.trim())
    .map(line => line.trim())
    .filter(Boolean)
}

function extractTextParagraphs(html, title = '') {
  const lines = htmlToReadableLines(cutAfterReaderStopMarker(stripReaderNoise(html)))
  const titleKey = lineKey(title)
  let startIndex = -1
  if (titleKey) {
    startIndex = lines.findIndex(line => lineKey(line).includes(titleKey) || titleKey.includes(lineKey(line)))
  }
  const blocks = []
  let skipInlineModule = 0
  let seenArticleLikeText = false
  for (const line of lines.slice(Math.max(0, startIndex + 1))) {
    const text = line.replace(/\s+/g, ' ').trim()
    if (!text) continue
    if (READER_HARD_STOP.test(text)) {
      if (blocks.length > 0) break
      continue
    }
    if (READER_INLINE_MODULE.test(text)) {
      skipInlineModule = 10
      continue
    }
    if (skipInlineModule > 0) {
      if (text.length > 140 && /[.!?]"?$/.test(text) && !/^by\b/i.test(text)) {
        skipInlineModule = 0
      } else {
        skipInlineModule -= 1
        continue
      }
    }
    if (text.length < 55) continue
    if (!/[.!?]"?$/.test(text)) continue
    if (READER_LINE_SKIP.test(text) || READER_SKIP_TEXT.test(text)) continue
    if (!seenArticleLikeText && /^(?:by|author|date|image|source)\b/i.test(text)) continue
    seenArticleLikeText = true
    if (!blocks.includes(text)) blocks.push(text)
    if (blocks.join(' ').length > READER_MAX_CHARS || blocks.length >= READER_MAX_BLOCKS) break
  }
  return blocks
}

function extractImages(html, baseUrl, hero) {
  const images = []
  if (hero) images.push(hero)
  const re = /<img[^>]+(?:src|data-src|data-original)=["']([^"']+)["'][^>]*>/gi
  let match
  while ((match = re.exec(html)) && images.length < 5) {
    const url = absolutizeUrl(decodeHtml(match[1]), baseUrl)
    if (!/^https?:/i.test(url)) continue
    if (/logo|icon|avatar|sprite|tracking|pixel|spacer/i.test(url)) continue
    if (!images.includes(url)) images.push(url)
  }
  return images
}

function articleTextLength(article) {
  return (article?.paragraphs || []).join(' ').length
}

function readerAttempt(source, response, article, extra = {}) {
  return {
    source,
    status: response?.status,
    bytes: response?.text?.length || 0,
    paragraphs: article?.paragraphs?.length || 0,
    chars: article ? articleTextLength(article) : 0,
    ...extra,
  }
}

function jinaReaderUrls(url) {
  const clean = String(url || '').trim()
  if (!clean) return []
  return Array.from(new Set([
    `https://r.jina.ai/http://${clean}`,
    `https://r.jina.ai/http://r.jina.ai/http://${clean}`,
  ]))
}

function markdownBody(markdown = '') {
  const marker = markdown.search(/^Markdown Content:\s*$/im)
  return marker >= 0 ? markdown.slice(marker).replace(/^Markdown Content:\s*/i, '') : markdown
}

function cleanMarkdownText(value = '') {
  return decodeHtml(value)
    .replace(/!\[[^\]]*\]\([^)]+\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/^#{1,6}\s*/, '')
    .replace(/^[-*]\s+/, '')
    .replace(/^\|+|\|+$/g, ' ')
    .replace(/\*\*/g, '')
    .replace(/[_`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function markdownHeader(markdown = '', name = '') {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = markdown.match(new RegExp(`^${escaped}:\\s*(.+)$`, 'im'))
  return cleanMarkdownText(match?.[1] || '')
}

function markdownTitle(markdown = '', fallback = '') {
  const headerTitle = markdownHeader(markdown, 'Title')
  if (headerTitle) return headerTitle
  const body = markdownBody(markdown)
  const h1 = body.match(/^#\s+(.+)$/m)
  return cleanMarkdownText(h1?.[1] || fallback)
}

function extractMarkdownImages(markdown = '', baseUrl = '', hero = '') {
  const images = []
  if (hero) images.push(hero)
  const re = /!\[[^\]]*\]\(([^)]+)\)/g
  let match
  while ((match = re.exec(markdown)) && images.length < 5) {
    const url = absolutizeUrl(decodeHtml(match[1]).trim(), baseUrl)
    if (!/^https?:/i.test(url)) continue
    if (/logo|icon|avatar|sprite|tracking|pixel|spacer/i.test(url)) continue
    if (!images.includes(url)) images.push(url)
  }
  return images
}

function isMarkdownArticleMarker(text = '') {
  return /^by\s+.{2,80}$/i.test(text)
    || /^By\s*[A-Z][A-Za-z .'-]{1,80}\d{1,2}[./-]\d{1,2}[./-]\d{2,4}(?:\s+\d+)?$/.test(text)
    || /^(?:published|updated|posted)\b/i.test(text)
    || /^(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2},\s+\d{4}\b/i.test(text)
    || /^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b/.test(text)
}

function extractMarkdownParagraphs(markdown = '', title = '') {
  const body = markdownBody(markdown)
  const lines = body.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  const titleKey = lineKey(title)
  let startIndex = lines.findIndex(line => /^#\s+/.test(line))
  if (startIndex < 0 && titleKey) {
    startIndex = lines.findIndex(line => {
      const key = lineKey(cleanMarkdownText(line))
      return key && (key.includes(titleKey) || titleKey.includes(key))
    })
  }
  const markerIndex = lines.findIndex((raw, index) => index > startIndex && isMarkdownArticleMarker(cleanMarkdownText(raw)))
  const readFrom = markerIndex >= 0 ? markerIndex + 1 : startIndex + 1
  const blocks = []
  let seenArticleLikeText = false
  for (const raw of lines.slice(Math.max(0, readFrom))) {
    const markdownLinkCount = raw.match(/\]\(/g)?.length || 0
    if (/^\*\s+\[/.test(raw) || raw.includes('![') || markdownLinkCount > 3) continue
    if (READER_MARKDOWN_STOP.test(raw) || READER_HARD_STOP.test(cleanMarkdownText(raw))) {
      if (blocks.length > 0) break
      continue
    }
    if (/^!\[[^\]]*\]\([^)]+\)$/.test(raw)) continue
    const isHeading = /^#{2,6}\s+/.test(raw) || /^\*\*[^*]{14,100}\*\*$/.test(raw)
    const text = cleanMarkdownText(raw)
    if (!text) continue
    if (READER_MARKDOWN_STOP.test(text)) {
      if (blocks.length > 0) break
      continue
    }
    if (READER_MARKDOWN_SKIP.test(text) || READER_LINE_SKIP.test(text) || READER_SKIP_TEXT.test(text)) continue
    if (/^(?:by|author|date|published|updated|source|url source)\b/i.test(text)) continue
    if (/^\d+\s*\/\s*\d+$/.test(text) || /^[\d:., -]+$/.test(text)) continue
    if (!seenArticleLikeText && /\b(?:aspencore|datasheets\.com|edn\.com|eetimes\.com|embedded\.com|electronics-tutorials|electroda|powerelectronicsnews|transim\.com)\b/i.test(text)) continue

    if (isHeading) {
      if (seenArticleLikeText && text.length >= 24 && !blocks.includes(text)) blocks.push(text)
      continue
    }
    if (text.length < 55) continue
    if (!/[.!?]"?$/.test(text)) continue
    seenArticleLikeText = true
    if (!blocks.includes(text)) blocks.push(text)
    if (blocks.join(' ').length > READER_MAX_CHARS || blocks.length >= READER_MAX_BLOCKS) break
  }
  return blocks
}

function parseJinaMarkdown(markdown, finalUrl, requestedUrl, hero = '') {
  const source = (() => { try { return new URL(requestedUrl).hostname.replace(/^www\./, '') } catch { return '' } })()
  const title = markdownTitle(markdown, source)
  const date = markdownHeader(markdown, 'Published Time')
  const paragraphs = extractMarkdownParagraphs(markdown, title)
  const images = extractMarkdownImages(markdownBody(markdown), finalUrl, hero)

  return {
    ok: paragraphs.length > 0,
    url: requestedUrl,
    finalUrl,
    source,
    sourceLabel: 'jina',
    title,
    description: paragraphs[0] || '',
    date,
    image: images[0] || hero || '',
    images,
    paragraphs,
    excerpt: paragraphs.slice(0, 2).join(' '),
  }
}

function parseArticleHtml(html, finalUrl, requestedUrl, sourceLabel = 'direct') {
  const source = (() => { try { return new URL(requestedUrl).hostname.replace(/^www\./, '') } catch { return '' } })()
  const title = getMetaContent(html, 'og:title')
    || getMetaContent(html, 'twitter:title')
    || extractFirst(html, 'h1')
    || extractFirst(html, 'title')
    || source
  const description = getMetaContent(html, 'og:description') || getMetaContent(html, 'description')
  const date = getMetaContent(html, 'article:published_time') || getMetaContent(html, 'date')
  const hero = absolutizeUrl(getMetaContent(html, 'og:image') || getMetaContent(html, 'twitter:image'), finalUrl)
  const readable = chooseReadableHtml(html)
  let paragraphs = extractParagraphs(readable)
  if (paragraphs.join(' ').length < 450) {
    const fallbackParagraphs = extractTextParagraphs(html, title)
    if (fallbackParagraphs.join(' ').length > paragraphs.join(' ').length) paragraphs = fallbackParagraphs
  }
  const images = extractImages(readable, finalUrl, hero)

  return {
    ok: paragraphs.length > 0,
    url: requestedUrl,
    finalUrl,
    source,
    sourceLabel,
    title,
    description,
    date,
    image: images[0] || '',
    images,
    paragraphs,
    excerpt: paragraphs.slice(0, 2).join(' '),
  }
}

function detectPaywall(html) {
  const sample = decodeHtml(stripTags(html)).slice(0, 24000)
  return /subscribe to continue|subscription required|already a subscriber|sign in to continue|register to continue|create an account to continue|to continue reading|this article is reserved|premium content|paywall|metered paywall|become a subscriber|subscriber-only/i.test(sample)
    || /class=["'][^"']*(paywall|subscriber|subscription|premium-content|regwall)[^"']*["']/i.test(html)
}

function detectBotChallenge(text = '') {
  const sample = decodeHtml(stripTags(text)).slice(0, 12000)
  return /cf-mitigated:\s*challenge|checking your browser|cloudflare|captcha|performing security verification|protect against malicious bots|verify you are not a bot|returned error 403:\s*forbidden/i.test(sample)
}

function readerFetchText(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) { reject(new Error('too many redirects')); return }
    const u = new URL(url)
    const mod = u.protocol === 'http:' ? require('http') : require('https')
    const req = mod.request({
      hostname: u.hostname,
      path: u.pathname + u.search,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9,fr;q=0.8',
      },
    }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume()
        resolve(readerFetchText(new URL(res.headers.location, url).href, redirects + 1))
        return
      }
      const chunks = []
      res.on('data', chunk => chunks.push(chunk))
      res.on('end', () => resolve({
        ok: res.statusCode >= 200 && res.statusCode < 300,
        status: res.statusCode,
        url,
        finalUrl: url,
        text: Buffer.concat(chunks).toString('utf8'),
      }))
    })
    req.on('error', reject)
    req.setTimeout(12000, () => req.destroy(new Error('reader timeout')))
    req.end()
  })
}

function waybackReplayUrl(timestamp, originalUrl) {
  return timestamp && originalUrl ? `https://web.archive.org/web/${timestamp}id_/${originalUrl}` : ''
}

function waybackLookupVariants(url) {
  const variants = []
  const add = value => {
    if (value && !variants.includes(value)) variants.push(value)
  }
  add(url)
  try {
    const parsed = new URL(url)
    parsed.hash = ''
    add(parsed.href)
    parsed.search = ''
    add(parsed.href)

    const hosts = new Set([parsed.hostname])
    if (parsed.hostname.startsWith('www.')) hosts.add(parsed.hostname.slice(4))
    else hosts.add(`www.${parsed.hostname}`)

    const protocols = new Set([parsed.protocol, parsed.protocol === 'https:' ? 'http:' : 'https:'])
    for (const protocol of protocols) {
      for (const hostname of hosts) {
        const variant = new URL(parsed.href)
        variant.protocol = protocol
        variant.hostname = hostname
        add(variant.href)
      }
    }

    if (/(^|\.)ft\.com$/i.test(parsed.hostname)) {
      const contentMatch = parsed.pathname.match(/^\/content\/([^/?#]+)/i)
      if (contentMatch) {
        const canonical = `https://www.ft.com/content/${contentMatch[1]}`
        add(canonical)
        add(`http://www.ft.com/content/${contentMatch[1]}`)
      }
    }
  } catch {}
  return variants
}

async function waybackAvailabilityUrl(url) {
  const apiUrl = 'https://archive.org/wayback/available?url=' + encodeURIComponent(url)
  const res = await readerFetchText(apiUrl)
  if (!res.ok) return ''
  try {
    const data = JSON.parse(res.text)
    const snapshot = data?.archived_snapshots?.closest
    if (!snapshot?.available || !snapshot.url) return ''
    const match = snapshot.url.match(/\/web\/(\d+)\//)
    return match ? waybackReplayUrl(match[1], url) : snapshot.url
  } catch {
    return ''
  }
}

async function waybackCdxUrl(url) {
  const params = new URLSearchParams()
  params.set('url', url)
  params.set('output', 'json')
  params.set('fl', 'timestamp,original,statuscode,mimetype,digest')
  params.append('filter', 'statuscode:200')
  params.append('filter', 'mimetype:text/html')
  params.set('collapse', 'digest')
  params.set('limit', '-8')
  const query = params.toString()
  for (const endpoint of ['https://web.archive.org/cdx', 'https://web.archive.org/cdx/search/cdx']) {
    const res = await readerFetchText(`${endpoint}?${query}`)
    if (!res.ok || !res.text) continue
    try {
      const rows = JSON.parse(res.text)
      if (!Array.isArray(rows) || rows.length < 2) continue
      const dataRows = rows.slice(1).filter(row => Array.isArray(row) && row[0])
      const row = dataRows[dataRows.length - 1]
      if (row) return waybackReplayUrl(row[0], row[1] || url)
    } catch {}
  }
  return ''
}

async function latestWaybackUrl(url) {
  const variants = waybackLookupVariants(url)
  for (const candidate of variants) {
    try {
      const available = await waybackAvailabilityUrl(candidate)
      if (available) return available
    } catch {}
  }
  for (const candidate of variants) {
    try {
      const archived = await waybackCdxUrl(candidate)
      if (archived) return archived
    } catch {}
  }
  return ''
}

const PUBLISHER_FEED_FALLBACKS = [
  {
    host: /(^|\.)bloomberg\.com$/i,
    source: 'bloomberg.com',
    sourceLabel: 'feed',
    feeds: [
      'https://feeds.bloomberg.com/markets/news.rss',
    ],
  },
]

function comparableUrl(value = '') {
  try {
    const url = new URL(value)
    url.hash = ''
    url.search = ''
    return url.href.replace(/\/$/, '')
  } catch {
    return String(value || '').trim().replace(/[?#].*$/, '').replace(/\/$/, '')
  }
}

function cleanXmlText(value = '') {
  return decodeHtml(String(value)
    .replace(/^<!\[CDATA\[/, '')
    .replace(/\]\]>$/, '')
    .replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
}

function extractXmlTag(xml = '', tag = '') {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = xml.match(new RegExp(`<${escaped}\\b[^>]*>([\\s\\S]*?)<\\/${escaped}>`, 'i'))
  return cleanXmlText(match?.[1] || '')
}

function extractXmlAttr(xml = '', tag = '', attr = '') {
  const escapedTag = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const escapedAttr = attr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = xml.match(new RegExp(`<${escapedTag}\\b[^>]*\\b${escapedAttr}=["']([^"']+)["'][^>]*>`, 'i'))
  return cleanXmlText(match?.[1] || '')
}

async function fetchPublisherFeedFallback(url) {
  let parsed
  try { parsed = new URL(url) } catch { return null }
  const config = PUBLISHER_FEED_FALLBACKS.find(item => item.host.test(parsed.hostname))
  if (!config) return null

  const target = comparableUrl(url)
  for (const feedUrl of config.feeds) {
    try {
      const res = await readerFetchText(feedUrl)
      if (!res.ok || !res.text) continue
      const items = Array.from(res.text.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)).map(match => match[1])
      for (const item of items) {
        const link = extractXmlTag(item, 'link') || extractXmlTag(item, 'guid')
        if (comparableUrl(link) !== target) continue
        const description = extractXmlTag(item, 'description')
        if (!description) return null
        const image = extractXmlAttr(item, 'media:content', 'url') || extractXmlAttr(item, 'media:thumbnail', 'url')
        const title = extractXmlTag(item, 'title') || parsed.hostname.replace(/^www\./, '')
        const author = extractXmlTag(item, 'dc:creator')
        const date = extractXmlTag(item, 'pubDate')
        return {
          ok: true,
          url,
          finalUrl: link || url,
          source: config.source,
          sourceLabel: config.sourceLabel,
          title,
          description: author ? `Publisher feed preview by ${author}` : 'Publisher feed preview',
          date,
          image,
          images: image ? [image] : [],
          paragraphs: [description],
          excerpt: description,
        }
      }
    } catch {}
  }
  return null
}

async function fetchReaderArticle(url) {
  const attempts = []
  let directArticle = null
  let paywallFallback = null
  try {
    const direct = await readerFetchText(url)
    if (direct.ok && direct.text) {
      const article = parseArticleHtml(direct.text, direct.finalUrl || url, url, 'direct')
      directArticle = article
      attempts.push(readerAttempt('direct', direct, article, { challenge: detectBotChallenge(direct.text) || undefined }))
      if (detectPaywall(direct.text) && article.paragraphs.join(' ').length < 450) {
        paywallFallback = {
          ...article,
          ok: false,
          paywall: true,
          paragraphs: article.description ? [article.description] : article.paragraphs,
          attempts,
          error: 'This article appears to require a subscription or sign-in.',
        }
      } else if (article.ok && article.paragraphs.join(' ').length > 450) {
        return { ...article, attempts }
      }
    } else {
      attempts.push({
        source: 'direct',
        status: direct.status,
        bytes: direct.text?.length || 0,
        challenge: direct.text ? detectBotChallenge(direct.text) || undefined : undefined,
      })
    }
  } catch (e) {
    attempts.push({ source: 'direct', error: e.message })
  }

  for (const readerUrl of jinaReaderUrls(url)) {
    try {
      const res = await readerFetchText(readerUrl)
      if (res.ok && res.text) {
        if (detectBotChallenge(res.text)) {
          attempts.push({ source: 'reader proxy', status: res.status, bytes: res.text.length, challenge: true })
          continue
        }
        const article = parseJinaMarkdown(res.text, res.finalUrl || readerUrl, url, directArticle?.image || '')
        attempts.push(readerAttempt('reader proxy', res, article))
        if (article.ok && articleTextLength(article) > 450) return { ...article, attempts }
      } else {
        attempts.push({ source: 'reader proxy', status: res.status, bytes: res.text?.length || 0, challenge: res.text ? detectBotChallenge(res.text) || undefined : undefined })
      }
    } catch (e) {
      attempts.push({ source: 'reader proxy', error: e.message })
    }
  }

  try {
    const archived = await latestWaybackUrl(url)
    if (archived) {
      const res = await readerFetchText(archived)
      if (res.ok && res.text) {
        const article = parseArticleHtml(res.text, archived, url, 'archive.org')
        attempts.push(readerAttempt('archive.org', res, article))
        if (article.ok) return { ...article, attempts }
      }
    }
  } catch (e) {
    attempts.push({ source: 'archive.org', error: e.message })
  }

  try {
    const feedFallback = await fetchPublisherFeedFallback(url)
    if (feedFallback) {
      attempts.push({
        source: 'publisher feed',
        status: 200,
        paragraphs: feedFallback.paragraphs.length,
        chars: articleTextLength(feedFallback),
      })
      if (articleTextLength(feedFallback) > 450) return { ...feedFallback, attempts }
      return {
        ...feedFallback,
        ok: false,
        attempts,
        error: 'The publisher feed only provided a short preview, so the article was not treated as a complete reader view.',
      }
    }
  } catch (e) {
    attempts.push({ source: 'publisher feed', error: e.message })
  }

  if (paywallFallback) return { ...paywallFallback, attempts }

  return {
    ok: false,
    url,
    source: (() => { try { return new URL(url).hostname.replace(/^www\./, '') } catch { return '' } })(),
    sourceLabel: attempts.some(a => a.source === 'reader proxy') ? 'jina' : attempts.some(a => a.source === 'archive.org') ? 'archive.org' : 'direct',
    title: 'Reader view unavailable',
    description: '',
    image: '',
    images: [],
    paragraphs: [],
    attempts,
    error: attempts.some(a => a.challenge)
      ? 'The source returned a bot verification page, so reader extraction could not access the article text automatically.'
      : 'The article could not be purified automatically.',
  }
}

async function fetchArchivedReaderArticle(url) {
  const attempts = []
  try {
    const archived = await latestWaybackUrl(url)
    if (!archived) {
      return {
        ok: false,
        url,
        source: (() => { try { return new URL(url).hostname.replace(/^www\./, '') } catch { return '' } })(),
        sourceLabel: 'archive.org',
        title: 'Archive unavailable',
        description: '',
        image: '',
        images: [],
        paragraphs: [],
        attempts,
        error: 'No archive.org snapshot is available yet.',
      }
    }

    const res = await readerFetchText(archived)
    if (res.ok && res.text) {
      const article = parseArticleHtml(res.text, archived, url, 'archive.org')
      attempts.push(readerAttempt('archive.org', res, article))
      if (article.ok) return { ...article, attempts }
      return {
        ...article,
        ok: false,
        attempts,
        error: 'The archive.org snapshot could not be purified automatically.',
      }
    }

    attempts.push({ source: 'archive.org', status: res.status, bytes: res.text?.length || 0 })
    return {
      ok: false,
      url,
      source: (() => { try { return new URL(url).hostname.replace(/^www\./, '') } catch { return '' } })(),
      sourceLabel: 'archive.org',
      title: 'Archive unavailable',
      description: '',
      image: '',
      images: [],
      paragraphs: [],
      attempts,
      error: 'The archive.org snapshot could not be loaded.',
    }
  } catch (e) {
    attempts.push({ source: 'archive.org', error: e.message })
    return {
      ok: false,
      url,
      source: (() => { try { return new URL(url).hostname.replace(/^www\./, '') } catch { return '' } })(),
      sourceLabel: 'archive.org',
      title: 'Archive unavailable',
      description: '',
      image: '',
      images: [],
      paragraphs: [],
      attempts,
      error: e.message || 'Archive.org could not be reached.',
    }
  }
}

ipcMain.handle('reader-fetch', async (_e, url) => {
  try { return await fetchReaderArticle(url) }
  catch (e) { return { ok: false, url, title: 'Reader view unavailable', paragraphs: [], images: [], error: e.message } }
})

ipcMain.handle('reader-fetch-archive', async (_e, url) => {
  try { return await fetchArchivedReaderArticle(url) }
  catch (e) { return { ok: false, url, title: 'Archive unavailable', paragraphs: [], images: [], error: e.message } }
})

ipcMain.handle('reader-open-external', async (_e, url) => {
  if (!url) return false
  await shell.openExternal(url)
  return true
})

// ── TradingView auth ──────────────────────────────────────────────────────────
function tvRequest(method, url, headers, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const opts = {
      hostname: u.hostname, path: u.pathname + (u.search || ''), method,
      headers: body ? { ...headers, 'Content-Length': Buffer.byteLength(body) } : headers,
    }
    const req = https.request(opts, res => {
      const chunks = []
      res.on('data', d => chunks.push(d))
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }))
    })
    req.on('error', reject)
    if (body) req.write(body)
    req.end()
  })
}

// Opens a real BrowserWindow so the user can log in through TradingView's UI.
// Uses Chrome DevTools Protocol to intercept TV's own API responses AFTER login,
// and also tries extracting from localStorage once the main page loads.
ipcMain.handle('tv-browser-login', async () => {
  // Don't clear wp-tv-raw-lists here — tv-watchlists will refresh it via hidden window

  return new Promise(resolve => {
    const authWin = new BrowserWindow({
      width: 1000, height: 720,
      title: 'Sign in to TradingView',
      autoHideMenuBar: true,
      webPreferences: { contextIsolation: true, nodeIntegration: false },
    })

    let resolved      = false
    let authenticated = false  // only capture data after session cookie is confirmed
    const pendReqs    = {}

    // ── CDP: intercept network responses (only after login) ───────────────────
    const dbg = authWin.webContents.debugger
    try {
      dbg.attach('1.3')
      dbg.sendCommand('Network.enable').catch(() => {})

      dbg.on('message', async (_evt, method, params) => {
        if (method === 'Network.requestWillBeSent') {
          pendReqs[params.requestId] = params.request.url
        }
        if (method === 'Network.loadingFinished') {
          const url = pendReqs[params.requestId]
          delete pendReqs[params.requestId]
          if (!url?.includes('tradingview.com') || !authenticated) return
          try {
            const resp = await dbg.sendCommand('Network.getResponseBody', { requestId: params.requestId })
            const text = resp.base64Encoded
              ? Buffer.from(resp.body, 'base64').toString('utf8')
              : (resp.body || '')
            if (!text) return
            if (/\/(api|pine|user|data|watchlist)/i.test(url))
              log('[tv-cdp]', url.split('?')[0], 'len=', text.length, text.slice(0, 300))
            if (!text.startsWith('{') && !text.startsWith('[')) return
            let json; try { json = JSON.parse(text) } catch { return }
            const candidates = [json, json?.lists, json?.data, json?.watchlists,
                                 json?.activeLists, json?.payload, json?.results]
            for (const c of candidates) {
              if (!Array.isArray(c) || !c.length) continue
              if (c[0]?.symbols !== undefined || (c[0]?.name && c[0]?.id !== undefined)) {
                log('[tv-cdp] watchlists captured from', url.split('?')[0], 'count=', c.length)
                setStore('wp-tv-raw-lists', JSON.stringify(c))
                break
              }
            }
          } catch {}
        }
      })
    } catch (e) { log('[tv-browser-login] CDP attach failed:', e.message) }

    authWin.loadURL('https://www.tradingview.com/accounts/signin/')

    async function finish() {
      if (resolved) return
      const cookies = await session.defaultSession.cookies.get({ domain: '.tradingview.com' })
      const sessionCookie = cookies.find(c => c.name === 'sessionid')
      if (!sessionCookie) { resolved = true; resolve({ ok: false, error: 'Login cancelled' }); return }
      resolved = true
      const cookieStr = cookies.map(c => `${c.name}=${c.value}`).join('; ')
      const csrfToken = cookies.find(c => c.name === 'csrftoken')?.value || ''
      const username  = cookies.find(c => c.name === 'username')?.value  || ''
      setStore('wp-tv-cookies', cookieStr)
      setStore('wp-tv-session', sessionCookie.value)
      setStore('wp-tv-csrf',    csrfToken)
      setStore('wp-tv-user',    username)
      log('[tv-browser-login] ok session=', sessionCookie.value.slice(0,20), '...')
      resolve({ ok: true, username })
    }

    // Post-login: set authenticated flag, extract from localStorage, then close
    authWin.webContents.on('did-navigate', async (_e, url) => {
      if (!/^https:\/\/www\.tradingview\.com\/(chart\/)?(\?|$)/.test(url)) return
      const cookies = await session.defaultSession.cookies.get({ domain: '.tradingview.com' })
      if (!cookies.find(c => c.name === 'sessionid')) return
      authenticated = true  // CDP will now capture API responses

      // Wait for page JS to initialize, then extract watchlists from localStorage
      setTimeout(async () => {
        try {
          const raw = await authWin.webContents.executeJavaScript(`
            (() => {
              for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                try {
                  const v = JSON.parse(localStorage.getItem(key));
                  if (Array.isArray(v) && v.length && v[0]?.symbols !== undefined)
                    return JSON.stringify(v);
                  if (v?.lists && Array.isArray(v.lists) && v.lists[0]?.symbols !== undefined)
                    return JSON.stringify(v.lists);
                } catch {}
              }
              return null;
            })()
          `)
          if (raw) {
            log('[tv-js] extracted watchlists from localStorage, len=', raw.length)
            setStore('wp-tv-raw-lists', raw)
          }
        } catch (e) { log('[tv-js] failed:', e.message) }
        setTimeout(() => { if (!authWin.isDestroyed()) authWin.close() }, 500)
      }, 3000)
    })

    authWin.on('closed', finish)
  })
})

// Normalise any TV symbol format to {s, d} objects
function normSymbols(raw) {
  if (!Array.isArray(raw)) {
    if (typeof raw?.content === 'string') raw = raw.content.trim().split(/[\n,]+/)
    else return null
  }
  return raw
    .map(s => {
      if (typeof s === 'string') { const t = s.trim(); return t ? { s: t, d: t.split(':')[1] || t } : null }
      const sym = s.id || s.s || s.symbol || ''
      return sym ? { s: sym, d: s.description || s.d || s.name || sym.split(':')[1] || sym } : null
    })
    .filter(Boolean)
}

function normLists(arr) {
  return arr
    .map(l => ({
      id:      l.id      || l.listId || '',
      name:    l.name    || l.listName || 'Watchlist',
      symbols: normSymbols(l.symbols) || [],
    }))
    .filter(l => l.symbols.length)
}

// Fetch a single watchlist by ID via session.defaultSession.fetch (auto-includes cookies).
// Returns normalised {id, name, symbols} or null.
async function fetchWatchlistById(id, name) {
  try {
    const res = await session.defaultSession.fetch(
      `https://www.tradingview.com/api/v1/symbols_list/custom/${id}/`,
      { headers: { 'X-Requested-With': 'XMLHttpRequest', 'Referer': 'https://www.tradingview.com/' } }
    )
    if (!res.ok) { log('[tv-api] watchlist', id, 'status=', res.status); return null }
    const json = await res.json()
    // Response: {"symbols": ["NASDAQ:AAPL", "###Section", ...]}
    const rawSyms = json?.symbols
    if (!Array.isArray(rawSyms) || !rawSyms.length) return null
    const symbols = rawSyms
      .filter(s => typeof s === 'string' && !s.startsWith('###'))
      .map(s => ({ s, d: s.includes(':') ? s.split(':')[1] : s }))
    if (!symbols.length) return null
    log('[tv-api] watchlist', id, 'symbols=', symbols.length)
    return { id, name: name || `Watchlist ${id}`, symbols }
  } catch (e) { log('[tv-api] fetch error', id, e.message); return null }
}

const TV_HDR = { 'X-Requested-With': 'XMLHttpRequest', 'Referer': 'https://www.tradingview.com/' }

// Fetch a colored list by name. Returns {id, name, symbols} or null.
async function fetchColoredList(color) {
  try {
    const res = await session.defaultSession.fetch(
      `https://www.tradingview.com/api/v1/symbols_list/colored/${color}/`, { headers: TV_HDR }
    )
    if (!res.ok) return null
    const json = await res.json()
    const rawSyms = json?.symbols
    if (!Array.isArray(rawSyms) || !rawSyms.length) return null
    const symbols = rawSyms
      .filter(s => typeof s === 'string' && !s.startsWith('###'))
      .map(s => ({ s, d: s.includes(':') ? s.split(':')[1] : s }))
    if (!symbols.length) return null
    // TradingView allows renaming a colored list; prefer the user's name if present.
    const userName = (typeof json?.name === 'string' && json.name.trim()) || (typeof json?.title === 'string' && json.title.trim())
    const fallback = color.charAt(0).toUpperCase() + color.slice(1)
    const name = userName || fallback
    log('[tv-api] colored/', color, 'name=', name, 'symbols=', symbols.length)
    return { id: `colored_${color}`, name, symbols }
  } catch (e) { log('[tv-api] colored error', color, e.message); return null }
}

// Try TV's REST endpoints that return watchlists + colored lists.
async function fetchWatchlistIndex() {
  const hdrs = TV_HDR
  const lists = []

  // ── Custom watchlists ─────────────────────────────────────────────────────
  try {
    const res = await session.defaultSession.fetch(
      'https://www.tradingview.com/api/v1/symbols_list/custom/', { headers: hdrs }
    )
    const text = await res.text()
    log('[tv-index] custom status=', res.status, 'body=', text.slice(0, 200))
    if (res.ok && (text.startsWith('{') || text.startsWith('['))) {
      const json = JSON.parse(text)
      const arr = Array.isArray(json) ? json : (json?.lists || json?.data || json?.results || [])
      arr.forEach(l => {
        if (!l?.id) return
        const rawSyms = l.symbols || []
        const symbols = rawSyms
          .filter(s => typeof s === 'string' && !s.startsWith('###'))
          .map(s => ({ s, d: s.includes(':') ? s.split(':')[1] : s }))
        if (symbols.length) lists.push({ id: String(l.id), name: l.name || `Watchlist ${l.id}`, symbols })
      })
    }
  } catch (e) { log('[tv-index] custom error', e.message) }

  // ── Colored lists (red, orange, yellow, green, blue, purple, aqua, gray) ──
  const colors = ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'aqua', 'gray']
  const colored = await Promise.all(colors.map(fetchColoredList))
  colored.forEach(l => { if (l) lists.push(l) })

  if (lists.length) {
    log('[tv-index] total lists=', lists.length)
    return lists
  }
  return null
}

ipcMain.handle('tv-watchlists', async (_event, options = {}) => {
  const sessionId = getStore('wp-tv-session')
  if (!sessionId) return { ok: false, error: 'Not logged in' }
  const force = options === true || !!options?.force
  const cacheTtlMs = Number(options?.cacheTtlMs) > 0 ? Number(options.cacheTtlMs) : 120000

  // ── 1. Serve from cache ───────────────────────────────────────────────────
  const cached = getStore('wp-tv-lists-cache')
  const cachedAt = Number(getStore('wp-tv-lists-cache-at') || 0)
  if (!force && cached && Date.now() - cachedAt <= cacheTtlMs) {
    try {
      const lists = JSON.parse(cached)
      if (Array.isArray(lists) && lists.length) {
        log('[tv-watchlists] served', lists.length, 'lists from fresh cache')
        return { ok: true, data: lists }
      }
    } catch {}
  }

  // ── 2. Fetch fresh — custom watchlists + colored lists ────────────────────
  log('[tv-watchlists] fetching fresh lists')
  const lists = await fetchWatchlistIndex()
  if (lists?.length) {
    setStore('wp-tv-lists-cache', JSON.stringify(lists))
    setStore('wp-tv-lists-cache-at', String(Date.now()))
    return { ok: true, data: lists }
  }

  if (cached) {
    try {
      const lists = JSON.parse(cached)
      if (Array.isArray(lists) && lists.length) {
        log('[tv-watchlists] fresh fetch empty; served', lists.length, 'cached lists')
        return { ok: true, data: lists }
      }
    } catch {}
  }

  return { ok: true, data: [] }
})

ipcMain.handle('tv-logout', async () => {
  setStore('wp-tv-session',       '')
  setStore('wp-tv-cookies',       '')
  setStore('wp-tv-csrf',          '')
  setStore('wp-tv-user',          '')
  setStore('wp-tv-raw-lists',     '')
  setStore('wp-tv-watchlist-ids', '')
  setStore('wp-tv-lists-cache',   '')
  setStore('wp-tv-lists-cache-at','')
  return { ok: true }
})

ipcMain.handle('ms-graph-post', async (_e, url, accessToken, postBody) => {
  const u = new URL(url)
  const body = JSON.stringify(postBody)
  return httpsRequest({
    hostname: u.hostname, path: u.pathname + u.search, method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json',
               'Content-Length': Buffer.byteLength(body) }
  }, body)
})

// Auth code + PKCE flow — opens the real browser so MFA / conditional access work.
// Fixed callback port so the redirect URI is predictable (register it in Azure once).
const MS_AUTH_PORT = 47340

ipcMain.handle('ms-auth-pkce', async (_e, clientId, scopes) => {
  const crypto = require('crypto')
  const http   = require('http')

  return new Promise((resolve, reject) => {
    const codeVerifier  = crypto.randomBytes(32).toString('base64url')
    const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url')
    const redirectUri   = `http://localhost:${MS_AUTH_PORT}/callback`

    const authUrl = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize'
      + `?client_id=${encodeURIComponent(clientId)}`
      + `&response_type=code`
      + `&redirect_uri=${encodeURIComponent(redirectUri)}`
      + `&scope=${encodeURIComponent(scopes.join(' '))}`
      + `&code_challenge=${codeChallenge}`
      + `&code_challenge_method=S256`
      + `&prompt=select_account`

    const server = http.createServer((req, res) => {
      if (!req.url?.startsWith('/callback')) { res.end(); return }
      const params = new URL(req.url, `http://localhost:${MS_AUTH_PORT}`).searchParams
      const code   = params.get('code')
      const error  = params.get('error')

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(`<!DOCTYPE html><html><head><meta charset=utf-8><title>Widget Panel</title></head>
        <body style="font-family:system-ui;background:#0a0a0c;color:#aaa;display:flex;align-items:center;
          justify-content:center;height:100vh;margin:0;flex-direction:column;gap:14px">
          <div style="font-size:32px">${error ? '✗' : '✓'}</div>
          <div style="font-size:14px">${error
            ? 'Authentication failed: ' + error
            : 'Authentication complete — vous pouvez fermer le navigateur.'}</div>
        </body></html>`)

      server.close()

      if (error) { reject(new Error(error)); return }
      if (!code)  { reject(new Error('no code in callback')); return }

      const body = `client_id=${encodeURIComponent(clientId)}`
        + `&grant_type=authorization_code`
        + `&code=${encodeURIComponent(code)}`
        + `&redirect_uri=${encodeURIComponent(redirectUri)}`
        + `&code_verifier=${encodeURIComponent(codeVerifier)}`

      httpsRequest({
        hostname: 'login.microsoftonline.com', path: '/common/oauth2/v2.0/token', method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) }
      }, body).then(resolve).catch(reject)
    })

    server.on('error', err => reject(err))
    server.listen(MS_AUTH_PORT, '127.0.0.1', () => {
      log('[ms-auth] callback server ready on', MS_AUTH_PORT, '— opening embedded Brave')
      // Use the panel's embedded Brave instance instead of shell.openExternal
      // or an internal BrowserWindow:
      //   - The panel sits HWND_TOPMOST, so a freshly-launched external Brave
      //     window would render behind it and look like nothing happened.
      //   - An internal BrowserWindow has isolated cookies and would force a
      //     fresh Microsoft login even if Brave is already signed in.
      //   - Embedded Brave reuses the user's main profile (no --user-data-dir
      //     override per the brave-host architecture), so existing Outlook/MS
      //     cookies make the consent prompt frictionless.
      if (browserEmbedded) {
        sendToBrave({ type: 'navigate', url: authUrl })
      } else {
        openBraveInPanel(authUrl)
      }
    })

    const timeout = setTimeout(() => { server.close(); reject(new Error('auth timeout')) }, 5 * 60 * 1000)
    server.on('close', () => clearTimeout(timeout))
  })
})

// Opens a full BrowserWindow for third-party login (e.g. TradingView).
// Uses session.defaultSession so cookies are shared with renderer iframes.
// Returns true once the window is closed.
ipcMain.handle('open-auth-window', (_e, url, title) => {
  return new Promise(resolve => {
    const authWin = new BrowserWindow({
      width: 820, height: 720,
      title: title || 'Login',
      autoHideMenuBar: true,
      webPreferences: { contextIsolation: true, nodeIntegration: false },
    })
    authWin.loadURL(url)
    authWin.on('closed', () => resolve(true))
  })
})

ipcMain.handle('ms-token-refresh', async (_e, clientId, refreshToken) => {
  const body = `client_id=${encodeURIComponent(clientId)}&grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}`
  return httpsRequest({
    hostname: 'login.microsoftonline.com', path: '/common/oauth2/v2.0/token', method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) }
  }, body)
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  if (pipeServer) pipeServer.close()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') return
})
