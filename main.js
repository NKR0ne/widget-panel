const { app, BrowserWindow, globalShortcut, Tray, Menu, screen, ipcMain, nativeImage } = require('electron')
const path   = require('path')
const { exec } = require('child_process')
const { getStore, setStore, deleteStore } = require('./store')

const isDev  = !app.isPackaged
let win      = null
let tray     = null
let isPinned = false   // true = desktop layer (behind windows), false = always-on-top

// ── Single instance lock ─────────────────────────────
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) { app.quit() }
else {
  app.on('second-instance', () => { if (win) { win.show(); win.focus() } })
}

// ── Disable native Windows Widgets (requires admin for HKLM write) ───────────
function disableNativeWidgets() {
  // HKCU write works without admin and is per-user
  const cmds = [
    'reg add "HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced" /v TaskbarDa /t REG_DWORD /d 0 /f',
    'reg add "HKLM\\SOFTWARE\\Policies\\Microsoft\\Dsh" /v AllowNewsAndInterests /t REG_DWORD /d 0 /f',
  ]
  cmds.forEach(cmd => exec(cmd, err => {
    if (err) console.log('registry:', err.message)
  }))
}

// ── Create window ────────────────────────────────────
function createWindow() {
  const { height } = screen.getPrimaryDisplay().workAreaSize

  win = new BrowserWindow({
    width:           720,
    height:          height,
    x:               0,          // ← left edge
    y:               0,
    frame:           false,
    alwaysOnTop:     true,
    skipTaskbar:     true,
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
    // DevTools detached — comment out if noisy
    win.webContents.openDevTools({ mode: 'detach' })
  } else {
    win.loadFile(path.join(__dirname, 'renderer', 'dist', 'index.html'))
  }

  // Minimize to tray on close
  win.on('close', (e) => {
    if (process.platform === 'win32') {
      e.preventDefault()
      win.hide()
    }
  })
}

// ── Tray ─────────────────────────────────────────────
function buildTrayMenu() {
  return Menu.buildFromTemplate([
    { label: 'Show / Hide',  click: () => { win.isVisible() ? win.hide() : win.show() } },
    { label: isPinned ? 'Unpin (float)' : 'Pin to desktop', click: () => togglePin() },
    { type:  'separator' },
    { label: 'Start with Windows', type: 'checkbox', checked: app.getLoginItemSettings().openAtLogin,
      click: (item) => { app.setLoginItemSettings({ openAtLogin: item.checked }) } },
    { type:  'separator' },
    { label: 'Quit', click: () => { app.exit(0) } },
  ])
}

function createTray() {
  const iconPath = path.join(__dirname, 'assets', 'tray-icon.png')
  tray = new Tray(iconPath)
  tray.setToolTip('Widget Panel')
  tray.setContextMenu(buildTrayMenu())
  tray.on('double-click', () => { win.isVisible() ? win.hide() : win.show() })
}

function refreshTrayMenu() {
  if (tray) tray.setContextMenu(buildTrayMenu())
}

// ── Pin / unpin ───────────────────────────────────────
// Pinned   → alwaysOnTop 'desktop' level (sits on wallpaper, behind all apps)
// Unpinned → alwaysOnTop 'floating' (floats above normal windows)
function togglePin(forceTo) {
  isPinned = forceTo !== undefined ? forceTo : !isPinned
  if (isPinned) {
    win.setAlwaysOnTop(true, 'desktop')
  } else {
    win.setAlwaysOnTop(true, 'floating')
  }
  win.webContents.send('pin-state', isPinned)
  refreshTrayMenu()
}

// ── Taskbar overlay badge (notification dot) ──────────────────────────────────
// Call with count=0 to clear, count>0 to show a red dot with number
function setTaskbarBadge(count) {
  if (!win) return
  if (count === 0) {
    win.setOverlayIcon(null, '')
    return
  }
  // Draw badge on a 16x16 canvas via nativeImage
  const { createCanvas } = (() => { try { return require('canvas') } catch { return {} } })()
  if (!createCanvas) {
    // canvas not installed — use a pre-built red dot PNG from assets if present
    const dot = path.join(__dirname, 'assets', 'badge-dot.png')
    try { win.setOverlayIcon(nativeImage.createFromPath(dot), `${count} unread`) } catch {}
    return
  }
  const c = createCanvas(16, 16)
  const ctx = c.getContext('2d')
  ctx.fillStyle = '#f74f7e'
  ctx.beginPath(); ctx.arc(8, 8, 7, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = '#fff'
  ctx.font = 'bold 9px sans-serif'
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  ctx.fillText(count > 9 ? '9+' : String(count), 8, 8)
  const img = nativeImage.createFromBuffer(c.toBuffer('image/png'))
  win.setOverlayIcon(img, `${count} unread`)
}

// ── IPC handlers ──────────────────────────────────────
ipcMain.handle('store-get',    (_e, key)        => getStore(key))
ipcMain.handle('store-set',    (_e, key, value)  => setStore(key, value))
ipcMain.handle('store-delete', (_e, key)         => deleteStore(key))

// Pin toggle from renderer
ipcMain.handle('pin-toggle', () => { togglePin(); return isPinned })
ipcMain.handle('pin-get',    () => isPinned)

// Badge update from renderer: count of unread items
ipcMain.on('badge-update', (_e, count) => setTaskbarBadge(count))

// Auto-start toggle from renderer
ipcMain.handle('autostart-get', () => app.getLoginItemSettings().openAtLogin)
ipcMain.handle('autostart-set', (_e, enabled) => {
  app.setLoginItemSettings({ openAtLogin: enabled })
  refreshTrayMenu()
  return enabled
})

// ── App ready ────────────────────────────────────────
app.whenReady().then(() => {
  disableNativeWidgets()
  createWindow()
  createTray()

  // Restore pin state
  const savedPin = getStore('wp-pinned')
  if (savedPin) togglePin(true)

  // Restore auto-start preference
  const savedAutoStart = getStore('wp-autostart')
  if (savedAutoStart) app.setLoginItemSettings({ openAtLogin: true })

  // Win+W toggles the panel (replaces native Widgets shortcut)
  globalShortcut.register('Super+W', () => {
    if (!win) return
    win.isVisible() ? win.hide() : win.show()
  })
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') return
})
