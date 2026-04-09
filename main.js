const { app, BrowserWindow, globalShortcut, Tray, Menu, screen, ipcMain, nativeImage } = require('electron')
const path   = require('path')
const fs     = require('fs')
const net    = require('net')
const { exec, spawn } = require('child_process')
const { getStore, setStore, deleteStore } = require('./store')

const isDev  = !app.isPackaged
let win      = null
let tray     = null
let isPinned = false

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

function broadcastToHelper(obj) {
  if (!pipeSocket || pipeSocket.destroyed) return
  try { pipeSocket.write(JSON.stringify(obj) + '\n') } catch {}
}

function createPipeServer() {
  const PIPE = '\\\\.\\pipe\\widget-panel'

  pipeServer = net.createServer(socket => {
    console.log('[pipe] taskbar-btn connected')
    pipeSocket = socket

    // Send current state immediately
    broadcastToHelper({ type: 'state', visible: win ? win.isVisible() : true })

    socket.on('data', chunk => {
      const lines = chunk.toString().split('\n').filter(l => l.trim())
      for (const line of lines) {
        try {
          const msg = JSON.parse(line)
          if (msg.type === 'toggle') {
            win ? (win.isVisible() ? win.hide() : win.show()) : null
            broadcastToHelper({ type: 'state', visible: win?.isVisible() ?? false })
          }
        } catch {}
      }
    })

    socket.on('end',   () => { pipeSocket = null })
    socket.on('error', () => { pipeSocket = null })
  })

  pipeServer.on('error', err => {
    // EADDRINUSE: stale pipe from a crashed previous session — delete and retry
    if (err.code === 'EADDRINUSE') {
      try { fs.unlinkSync(PIPE) } catch {}
      setTimeout(createPipeServer, 500)
    }
  })

  pipeServer.listen(PIPE, () => console.log('[pipe] server listening'))
}

// Send badge count to C++ helper (and to Electron's own overlay icon)
function sendBadge(count) {
  broadcastToHelper({ type: 'badge', count })
  setTaskbarOverlay(count)
}

// Send visibility state to C++ helper whenever panel show/hide changes
function notifyHelperState(visible) {
  broadcastToHelper({ type: 'state', visible })
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
  const { height } = screen.getPrimaryDisplay().workAreaSize

  win = new BrowserWindow({
    width:           720,
    height:          height,
    x:               0,
    y:               0,
    frame:           false,
    alwaysOnTop:     true,
    skipTaskbar:     false,
    resizable:       false,
    backgroundColor: '#111114',
    webPreferences: {
      preload:          path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration:  false,
    },
  })

  if (isDev) {
    win.loadURL('http://localhost:5173')
    win.webContents.openDevTools({ mode: 'detach' })
  } else {
    win.loadFile(path.join(__dirname, 'renderer', 'dist', 'index.html'))
  }

  win.on('close', (e) => {
    if (process.platform === 'win32') {
      e.preventDefault()
      win.hide()
      notifyHelperState(false)
    }
  })

  win.on('show', () => notifyHelperState(true))
  win.on('hide', () => notifyHelperState(false))
}

// ── Tray ──────────────────────────────────────────────────────────────────────
function buildTrayMenu() {
  return Menu.buildFromTemplate([
    { label: 'Show / Hide', click: () => {
        const v = !win.isVisible(); v ? win.show() : win.hide(); notifyHelperState(v)
    }},
    { label: isPinned ? 'Unpin (float)' : 'Pin to desktop', click: () => togglePin() },
    { type: 'separator' },
    { label: 'Start with Windows', type: 'checkbox',
      checked: app.getLoginItemSettings().openAtLogin,
      click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked }) },
    { type: 'separator' },
    { label: 'Quit', click: () => app.exit(0) },
  ])
}

function createTray() {
  const iconPath = path.join(__dirname, 'assets', 'tray-icon.png')
  tray = new Tray(iconPath)
  tray.setToolTip('Widget Panel')
  tray.setContextMenu(buildTrayMenu())
  tray.on('double-click', () => { win.isVisible() ? win.hide() : win.show() })
}

function refreshTrayMenu() { if (tray) tray.setContextMenu(buildTrayMenu()) }

// ── Pin / unpin ───────────────────────────────────────────────────────────────
function togglePin(forceTo) {
  isPinned = forceTo !== undefined ? forceTo : !isPinned
  win.setAlwaysOnTop(true, isPinned ? 'desktop' : 'floating')
  win.webContents.send('pin-state', isPinned)
  refreshTrayMenu()
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
ipcMain.handle('store-get',    (_e, key)       => getStore(key))
ipcMain.handle('store-set',    (_e, key, value) => setStore(key, value))
ipcMain.handle('store-delete', (_e, key)       => deleteStore(key))

ipcMain.handle('pin-toggle', () => { togglePin(); return isPinned })
ipcMain.handle('pin-get',    () => isPinned)

ipcMain.on('badge-update', (_e, count) => sendBadge(count))

ipcMain.handle('autostart-get', () => app.getLoginItemSettings().openAtLogin)
ipcMain.handle('autostart-set', (_e, enabled) => {
  app.setLoginItemSettings({ openAtLogin: enabled })
  refreshTrayMenu()
  return enabled
})

// ── App ready ─────────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  disableNativeWidgets()
  createPipeServer()   // start pipe before spawning helper
  createWindow()
  createTray()
  spawnTaskbarBtn()

  const savedPin = getStore('wp-pinned')
  if (savedPin) togglePin(true)

  const savedAutoStart = getStore('wp-autostart')
  if (savedAutoStart) app.setLoginItemSettings({ openAtLogin: true })

  globalShortcut.register('Super+W', () => {
    if (!win) return
    const v = !win.isVisible(); v ? win.show() : win.hide(); notifyHelperState(v)
  })
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  if (pipeServer) pipeServer.close()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') return
})
