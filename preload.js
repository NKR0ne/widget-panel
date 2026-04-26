const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,

  store: {
    get:    (key)        => ipcRenderer.invoke('store-get',    key),
    set:    (key, value) => ipcRenderer.invoke('store-set',    key, value),
    delete: (key)        => ipcRenderer.invoke('store-delete', key),
  },

  pin: {
    toggle:   ()     => ipcRenderer.invoke('pin-toggle'),
    get:      ()     => ipcRenderer.invoke('pin-get'),
    onChange: (cb)   => ipcRenderer.on('pin-state', (_e, state) => cb(state)),
  },

  badge: {
    set: (count) => ipcRenderer.send('badge-update', count),
  },

  autostart: {
    get: ()        => ipcRenderer.invoke('autostart-get'),
    set: (enabled) => ipcRenderer.invoke('autostart-set', enabled),
  },

  system: {
    accentColor: () => ipcRenderer.invoke('system-accent-color'),
  },

  msGraph: {
    fetch:        (url, token)        => ipcRenderer.invoke('ms-graph-fetch',  url, token),
    patch:        (url, token, body)  => ipcRenderer.invoke('ms-graph-patch',  url, token, body),
    post:         (url, token, body)  => ipcRenderer.invoke('ms-graph-post',   url, token, body),
    authPkce:     (clientId, scopes)  => ipcRenderer.invoke('ms-auth-pkce',    clientId, scopes),
    tokenRefresh: (clientId, rt)      => ipcRenderer.invoke('ms-token-refresh', clientId, rt),
  },

  rss: {
    fetch: (url) => ipcRenderer.invoke('rss-fetch', url),
  },

  browser: {
    open:                (url)    => ipcRenderer.send('browser-open',            url),
    navigate:            (url)    => ipcRenderer.send('browser-navigate',        url),
    close:               ()       => ipcRenderer.send('browser-close'),
    openExternal:        ()       => ipcRenderer.send('brave-open-external'),
    setIgnoreMouseEvents:(ignore) => ipcRenderer.send('set-ignore-mouse-events', ignore),
    onPaneShow:          (cb)     => ipcRenderer.on('browser-pane-show',  (_e, d) => cb(d)),
    onPaneHide:          (cb)     => ipcRenderer.on('browser-pane-hide',  cb),
    onLoading:           (cb)     => ipcRenderer.on('brave-loading',      (_e, v) => cb(v)),
    onUrl:               (cb)     => ipcRenderer.on('brave-url',          (_e, u) => cb(u)),
  },

  log: (...args) => ipcRenderer.send('renderer-log', ...args),

  panel: {
    ready:       ()               => ipcRenderer.send('panel-renderer-ready'),
    onShow:      (cb)             => ipcRenderer.on('panel-show', cb),
    onHide:      (cb)             => ipcRenderer.on('panel-hide', cb),
    // Renderer calls this after slide-out animation finishes — main hides window
    hideDone:    ()               => ipcRenderer.send('panel-hide-done'),
    resizeStart: (startX, startW) => ipcRenderer.send('panel-resize-start', startX, startW),
    resizeEnd:   ()               => ipcRenderer.send('panel-resize-end'),
    setOpacity:  (v)              => ipcRenderer.invoke('set-window-opacity', v),
  },
})
