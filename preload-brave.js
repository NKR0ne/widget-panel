const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  brave: {
    onUrl:      (cb) => ipcRenderer.on('brave-url',     (_e, u) => cb(u)),
    onLoading:  (cb) => ipcRenderer.on('brave-loading', (_e, v) => cb(v)),
    openExternal: () => ipcRenderer.send('brave-open-external'),
    close:        () => ipcRenderer.send('brave-close'),
  },
})
