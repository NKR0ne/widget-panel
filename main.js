const { app, BrowserWindow, globalShortcut, screen, ipcMain, nativeImage, systemPreferences, shell } = require('electron')
const path   = require('path')
const fs     = require('fs')
const net    = require('net')
const { exec, spawn } = require('child_process')
const { getStore, setStore, deleteStore } = require('./store')

const isDev  = !!process.env.VITE_DEV
const LOG    = path.join(__dirname, 'native', 'bin', 'electron.log')
function log(...args) {
  const line = `[${new Date().toISOString()}] ${args.join(' ')}\n`
  try { fs.appendFileSync(LOG, line) } catch {}
  console.log(...args)
}
try { fs.writeFileSync(LOG, '') } catch {}  // clear on startup

let win              = null
let isPinned         = false
let lastToggleTime   = 0
let isHiding         = false  // prevents double-hide (blur + toggle arriving together)
let coldStart        = true   // true until first successful IPC connection
let rendererReady    = false  // true once renderer has registered its panel listeners
let panelOnlyWidth   = 0      // panel width before browser was embedded
let browserEmbedded  = false  // whether brave window is currently embedded in win

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
              if (!win.isVisible()) { win.show(); setTimeout(() => win.focus(), 150) }
            }
            notifyHelperState(win.isVisible())
          }
          else if (msg.type === 'clickoutside') {
            if (!isPinned) { log('[clickoutside] → hidePanel()'); hidePanel() }
            else { log('[clickoutside] pinned — ignored') }
          }
          else if (msg.type === 'toggle') {
            if (!win) return
            lastToggleTime = Date.now()
            log('[toggle] isVisible=', win.isVisible())
            if (win.isVisible()) { hidePanel() }
            else { win.show(); setTimeout(() => win.focus(), 150) }
            broadcastToHelper({ type: 'state', visible: win.isVisible() })
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

// Initiate slide-out: renderer animates then calls panel-hide-done → win.hide()
function hidePanel(opts = {}) {
  if (!win || !win.isVisible() || isHiding) return
  isHiding = true
  if (browserEmbedded) {
    // Kill brave immediately so the native child doesn't linger during the slide animation
    sendToBrave({ type: 'close' })
    browserEmbedded = false
    win.webContents.send('browser-pane-hide')
    const { workArea } = screen.getPrimaryDisplay()
    win.setBounds({ x: 0, y: workArea.y, width: panelOnlyWidth, height: workArea.height })
  }
  win.webContents.send('panel-hide')
  // Fallback: if renderer doesn't respond in 600ms, hide anyway
  const t = setTimeout(() => { win.hide(); notifyHelperState(false); isHiding = false }, 600)
  ipcMain.once('panel-hide-done', () => { clearTimeout(t); win.hide(); notifyHelperState(false); isHiding = false })
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

// Send panel HWND to the DLL so the mouse hook can call GetWindowRect directly.
// Brave is now a child of win, so win's rect covers the full panel+browser area.
// Win32 GetWindowRect always returns physical coords — no DPI math needed.
function notifyHelperHwnds() {
  if (!win || win.isDestroyed()) return
  const panelHwnd = Number(win.getNativeWindowHandle().readBigInt64LE(0))
  log('[notifyHelperHwnds] panel=', panelHwnd)
  broadcastToHelper({ type: 'hwnd', panel: panelHwnd, brave: 0 })
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
    height:          workArea.height,
    x:               -panelW,            // start off-screen; animation slides it in
    y:               workArea.y,
    frame:           false,
    transparent:     false,             // must be false — WS_EX_LAYERED is incompatible with SetParent + DXGI
    backgroundColor: '#0a0a0c',
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
  win.webContents.on('did-start-loading', () => { rendererReady = false })

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
      if (dt < 200) { log('[blur] debounced (toggle)'); return }
      // Debounce for 500ms after a browser-open — the Win32 SetParent can
      // fire blur before the child window has finished attaching.
      if (dtBrowser < 500) { log('[blur] debounced (browser-open)'); return }
      // Brave is a child of win — interacting with its content causes blur on win
      // because the HWND focus moves to the child. Skip hide when browser is embedded.
      if (browserEmbedded) { log('[blur] browserEmbedded — skip hide'); return }
      log('[blur] → hidePanel()')
      hidePanel()
    }
  })

  win.on('show', () => {
    lastToggleTime = Date.now()
    const { workArea } = screen.getPrimaryDisplay()
    // When browser is embedded, win is already at full width — preserve it.
    // Otherwise restore to panel-only size.
    const targetW = browserEmbedded ? win.getSize()[0] : (panelOnlyWidth || win.getSize()[0])
    win.setBounds({ x: 0, y: workArea.y, width: targetW, height: workArea.height })
    // Delay so the strip WM_LBUTTONDOWN passes through the hook before g_panelOn=true.
    setTimeout(() => { notifyHelperState(true); notifyHelperHwnds() }, 350)
    log('[win] show — rendererReady=', rendererReady)
    if (rendererReady) {
      setTimeout(() => { log('[win] sending panel-show'); win.webContents.send('panel-show') }, 50)
    }
  })
  win.on('hide', () => {
    // Move off-screen left of the strip so next show starts slide-in from translateX(-100%)
    const w = win.getSize()[0]
    win.setPosition(-w, win.getPosition()[1])
    notifyHelperState(false)
    isHiding = false
  })
}

// ── Pin / unpin ───────────────────────────────────────────────────────────────
function togglePin(forceTo) {
  isPinned = forceTo !== undefined ? forceTo : !isPinned
  win.setAlwaysOnTop(true, isPinned ? 'desktop' : 'floating')
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

ipcMain.handle('store-get',    (_e, key)       => getStore(key))
ipcMain.handle('store-set',    (_e, key, value) => setStore(key, value))
ipcMain.handle('store-delete', (_e, key)       => deleteStore(key))

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
    win.setBounds({ x: 0, y: workArea.y, width: newW, height: workArea.height })
  }, 16)
})

ipcMain.on('panel-resize-end', () => {
  if (resizeInterval) { clearInterval(resizeInterval); resizeInterval = null }
  if (win) setStore('wp-width', win.getSize()[0])
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
            // Brave may steal focus when reparented — restore focus to panel
            if (win && win.isVisible()) setTimeout(() => win.focus(), 150)
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

  // Compute brave width in physical pixels to avoid DPI rounding overflow on right edge
  const physPanelRight  = Math.round(panelW * sf)
  const physScreenRight = Math.round(bounds.width * sf)
  const braveW = Math.floor((physScreenRight - physPanelRight - 2) / sf)
  const totalW = panelW + braveW
  const braveH = workArea.height

  currentUrl = url
  lastBrowserOpenTime = Date.now()

  // Expand win to cover full screen width (panel + browser area)
  win.setBounds({ x: 0, y: workArea.y, width: totalW, height: braveH })
  browserEmbedded = true

  win.webContents.send('browser-pane-show', { url, braveX: panelW })
  win.webContents.send('brave-loading', true)
  win.webContents.send('brave-url', url)

  // Tell brave-host to launch/reparent Brave as a child of win at offset (panelW, TOOLBAR_H)
  const panelHwnd = Number(win.getNativeWindowHandle().readBigInt64LE(0))
  sendToBrave({ type: 'open', hwnd: panelHwnd, x: panelW, y: TOOLBAR_H, w: braveW, h: braveH, url })
  notifyHelperHwnds()
}

function closeBraveInPanel() {
  sendToBrave({ type: 'close' })
  browserEmbedded = false
  currentUrl = ''
  win.webContents.send('browser-pane-hide')
  const { workArea } = screen.getPrimaryDisplay()
  if (panelOnlyWidth > 0) win.setBounds({ x: 0, y: workArea.y, width: panelOnlyWidth, height: workArea.height })
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

ipcMain.on('browser-close', () => { closeBraveInPanel() })

// Toolbar buttons (from preload.js browser object)
ipcMain.on('brave-close',         () => { closeBraveInPanel() })
ipcMain.on('brave-open-external', () => {
  if (!currentUrl) return
  shell.openExternal(currentUrl)
  // Send "detach" so brave-host unparents the embedded window and releases the
  // process handle WITHOUT killing Brave — the externally-opened tab lives on.
  sendToBrave({ type: 'detach' })
  browserEmbedded = false
  win.webContents.send('browser-pane-hide')
  const { workArea } = screen.getPrimaryDisplay()
  if (panelOnlyWidth > 0) win.setBounds({ x: 0, y: workArea.y, width: panelOnlyWidth, height: workArea.height })
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
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' } })
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
