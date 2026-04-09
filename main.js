const { app, BrowserWindow, globalShortcut, Tray, Menu, screen, ipcMain } = require('electron')
const path   = require('path')
const { exec } = require('child_process')
const { getStore, setStore, deleteStore } = require('./store')

const isDev  = !app.isPackaged
let win      = null
let tray     = null

// ── Single instance lock ─────────────────────────────
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) { app.quit() }
else {
  app.on('second-instance', () => { if (win) { win.show(); win.focus() } })
}

// ── Disable native Windows Widgets ───────────────────
function disableNativeWidgets() {
  const cmd = 'reg add "HKLM\\SOFTWARE\\Policies\\Microsoft\\Dsh" /v AllowNewsAndInterests /t REG_DWORD /d 0 /f'
  exec(cmd, (err) => {
    if (err) console.log('Note: registry write failed (run as admin to suppress native Widgets):', err.message)
    else console.log('Native Widgets panel disabled via registry.')
  })
}

// ── Create window ────────────────────────────────────
function createWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize

  win = new BrowserWindow({
    width:          720,
    height:         height,
    x:              width - 720,
    y:              0,
    frame:          false,
    alwaysOnTop:    true,
    skipTaskbar:    true,
    resizable:      false,
    backgroundColor:'#111114',
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

  // Minimize to tray on close (Windows)
  win.on('close', (e) => {
    if (process.platform === 'win32') {
      e.preventDefault()
      win.hide()
    }
  })
}

// ── Tray ─────────────────────────────────────────────
function createTray() {
  const iconPath = path.join(__dirname, 'assets', 'tray-icon.png')
  tray = new Tray(iconPath)
  tray.setToolTip('Widget Panel')

  const menu = Menu.buildFromTemplate([
    { label: 'Show / Hide', click: () => { win.isVisible() ? win.hide() : win.show() } },
    { type:  'separator' },
    { label: 'Quit',        click: () => { app.exit(0) } },
  ])

  tray.setContextMenu(menu)
  tray.on('double-click', () => { win.isVisible() ? win.hide() : win.show() })
}

// ── IPC handlers for electron-store ──────────────────
ipcMain.handle('store-get',    (_e, key)        => getStore(key))
ipcMain.handle('store-set',    (_e, key, value)  => setStore(key, value))
ipcMain.handle('store-delete', (_e, key)         => deleteStore(key))

// ── App ready ────────────────────────────────────────
app.whenReady().then(() => {
  disableNativeWidgets()
  createWindow()
  createTray()

  // Win+W toggles the panel
  globalShortcut.register('Super+W', () => {
    if (!win) return
    win.isVisible() ? win.hide() : win.show()
  })
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})

// macOS: don't quit when all windows closed
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') return
})
