const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,

  // electron-store persistence
  store: {
    get:    (key)        => ipcRenderer.invoke('store-get',    key),
    set:    (key, value) => ipcRenderer.invoke('store-set',    key, value),
    delete: (key)        => ipcRenderer.invoke('store-delete', key),
  },

  // Pin / unpin to desktop layer
  pin: {
    toggle: ()        => ipcRenderer.invoke('pin-toggle'),
    get:    ()        => ipcRenderer.invoke('pin-get'),
    // listen for pin state pushed from main (e.g. tray menu change)
    onChange: (cb)    => ipcRenderer.on('pin-state', (_e, state) => cb(state)),
  },

  // Taskbar overlay badge (unread count)
  badge: {
    set: (count) => ipcRenderer.send('badge-update', count),
  },

  // Auto-start on Windows login
  autostart: {
    get: ()        => ipcRenderer.invoke('autostart-get'),
    set: (enabled) => ipcRenderer.invoke('autostart-set', enabled),
  },
})
