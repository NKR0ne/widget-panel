const { app, BrowserWindow, session, globalShortcut, screen, ipcMain, nativeImage, systemPreferences, nativeTheme, shell } = require('electron')
const path   = require('path')
const fs     = require('fs')
const net    = require('net')
const { exec, spawn } = require('child_process')
const { getStore, setStore, deleteStore } = require('./store')

const PANEL_GAP = 10   // px gap between window edge and screen; window is inset so the gap shows raw desktop

const isDev  = !!process.env.VITE_DEV
const LOG_SRC = path.join(__dirname, 'native', 'bin', 'electron.log')
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

let win              = null
let isPinned         = false
let lastToggleTime   = 0
let isHiding         = false  // prevents double-hide (blur + toggle arriving together)
let modalOpen        = false  // renderer signals when a settings/manage modal is open
let lastModalClose   = 0     // timestamp of last modal close — grace period before blur-hide
let coldStart        = true   // true until first successful IPC connection
let rendererReady    = false  // true once renderer has registered its panel listeners
let _showAnimating   = false  // true while showPanel() pre-send is in flight
let g_fadeIv         = null   // active opacity-fade interval — cancel before starting a new one
let panelOnlyWidth      = parseInt(getStore('wp-width')) || 720  // panel width before browser was embedded
let browserEmbedded     = false  // whether brave window is currently embedded in win
let _showStateTimeout   = null   // ID of the 350ms post-show notifyHelperState timer

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
  sendToBrave({ type: isPinned ? 'z-bottom' : 'z-top', hwnd: panelHwnd })
}

// ── Spawn taskbar-btn.exe ─────────────────────────────────────────────────────
function spawnTaskbarBtn() {
  // Installed build output: native/bin/taskbar-btn.exe
  const helperPath = path.join(__dirname, 'native', 'bin', 'taskbar-btn.exe')
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
    backgroundMaterial: 'acrylic',
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
  if (isPinned) {
    win.setAlwaysOnTop(false)
  } else {
    win.setAlwaysOnTop(true, 'floating')
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

ipcMain.handle('store-get',    (_e, key)       => getStore(key))
ipcMain.handle('store-set',    (_e, key, value) => { log('[store-set]', key, '=', JSON.stringify(value)); setStore(key, value) })
ipcMain.handle('store-delete', (_e, key)       => deleteStore(key))
ipcMain.on('renderer-log',     (_e, ...args)   => log('[renderer]', ...args))

ipcMain.handle('set-window-opacity', (_e, value) => {
  setStore('wp-opacity', String(Math.max(0.1, Math.min(1, value))))
  // Transparency is now CSS-based (body/panel background rgba); no win.setOpacity() needed.
})

ipcMain.handle('pin-toggle', () => { togglePin(); return isPinned })
ipcMain.handle('pin-get',    () => isPinned)

ipcMain.on('badge-update', (_e, count) => sendBadge(count))

ipcMain.handle('autostart-get', () => app.getLoginItemSettings().openAtLogin)
ipcMain.handle('autostart-set', (_e, enabled) => {
  app.setLoginItemSettings({ openAtLogin: enabled })
  return enabled
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

// ── Brave host TCP server (port 47322) ────────────────────────────────────────
let braveServer    = null
let braveSocket    = null
let currentUrl     = ''
let navLoadTimer   = null   // auto-clears the loading spinner if brave-host never acks
const TOOLBAR_H = 41

// Clear the brave-loading spinner after a timeout in case brave-host doesn't
// send 'ready' after navigation.
function armNavLoadTimer() {
  if (navLoadTimer) clearTimeout(navLoadTimer)
  navLoadTimer = setTimeout(() => {
    navLoadTimer = null
    if (win && !win.isDestroyed() && browserEmbedded) win.webContents.send('brave-loading', false)
  }, 5000)
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
            // brave-host's plain Win32 shell owns keyboard focus — no Chromium competing.
            // Ensure win (toolbar) remains Z-top above the shell window.
            win.moveTop()
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
  const helperPath = path.join(__dirname, 'native', 'bin', 'brave-host.exe')
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
  const panelScreenRight = PANEL_GAP + panelW   // screen x where panel ends (physical = *sf)
  const physPanelRight  = Math.round(panelScreenRight * sf)
  const physScreenRight = Math.round(bounds.width * sf)
  const braveW = Math.floor((physScreenRight - physPanelRight - 2) / sf)
  const totalW = panelW + braveW
  const braveH = workArea.height - PANEL_GAP * 2

  currentUrl = url
  lastBrowserOpenTime = Date.now()

  win.setBounds({ x: PANEL_GAP, y: workArea.y + PANEL_GAP, width: totalW, height: braveH })
  browserEmbedded = true

  win.setBackgroundMaterial('none')   // disable acrylic so Brave shows through the transparent area
  win.webContents.send('browser-pane-show', { url, braveX: panelW })
  win.webContents.send('brave-loading', true)
  win.webContents.send('brave-url', url)

  const CARD_M = 8
  sendToBrave({ type: 'open', hwnd: 0,
    x: Math.round((panelScreenRight + CARD_M) * sf),
    y: Math.round((workArea.y + PANEL_GAP + TOOLBAR_H + CARD_M) * sf),
    w: Math.round((braveW - CARD_M * 2) * sf),
    h: Math.round((braveH - TOOLBAR_H - CARD_M * 2) * sf),
    url })
  notifyHelperHwnds()
}

function closeBraveInPanel() {
  sendToBrave({ type: 'close' })
  browserEmbedded = false
  currentUrl = ''
  win.setBackgroundMaterial('acrylic')  // re-enable frosted glass
  win.webContents.send('browser-pane-hide')
  const { workArea } = screen.getPrimaryDisplay()
  if (panelOnlyWidth > 0) win.setBounds({ x: PANEL_GAP, y: workArea.y + PANEL_GAP, width: panelOnlyWidth, height: workArea.height - PANEL_GAP * 2 })
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
  win.setBackgroundMaterial('acrylic')
  win.webContents.send('browser-pane-hide')
  const { workArea } = screen.getPrimaryDisplay()
  if (panelOnlyWidth > 0) win.setBounds({ x: PANEL_GAP, y: workArea.y + PANEL_GAP, width: panelOnlyWidth, height: workArea.height - PANEL_GAP * 2 })
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
  const pathFile = path.join(__dirname, 'native', 'bin', 'panel.path')
  try { fs.writeFileSync(pathFile, launchPath, 'utf8') } catch {}
}

// ── App ready ─────────────────────────────────────────────────────────────────
app.whenReady().then(() => {
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
const https = require('https')

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
    log('[tv-api] colored/', color, 'symbols=', symbols.length)
    return { id: `colored_${color}`, name: color.charAt(0).toUpperCase() + color.slice(1), symbols }
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

ipcMain.handle('tv-watchlists', async () => {
  const sessionId = getStore('wp-tv-session')
  if (!sessionId) return { ok: false, error: 'Not logged in' }

  // ── 1. Serve from cache ───────────────────────────────────────────────────
  const cached = getStore('wp-tv-lists-cache')
  if (cached) {
    try {
      const lists = JSON.parse(cached)
      if (Array.isArray(lists) && lists.length) {
        log('[tv-watchlists] served', lists.length, 'lists from cache')
        return { ok: true, data: lists }
      }
    } catch {}
  }

  // ── 2. Fetch fresh — custom watchlists + colored lists ────────────────────
  log('[tv-watchlists] fetching fresh lists')
  const lists = await fetchWatchlistIndex()
  if (lists?.length) {
    setStore('wp-tv-lists-cache', JSON.stringify(lists))
    return { ok: true, data: lists }
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
            : 'Authentication complete — you can close this tab.'}</div>
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
      log('[ms-auth] callback server ready on', MS_AUTH_PORT, '— opening browser')
      shell.openExternal(authUrl)
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
