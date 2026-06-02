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
    accentColor:       () => ipcRenderer.invoke('system-accent-color'),
    windowColor:       () => ipcRenderer.invoke('system-window-color'),
    onWindowColorChange: (cb) => ipcRenderer.on('system-color-updated', (_e, c) => cb(c)),
  },

  msGraph: {
    fetch:        (url, token)        => ipcRenderer.invoke('ms-graph-fetch',  url, token),
    patch:        (url, token, body)  => ipcRenderer.invoke('ms-graph-patch',  url, token, body),
    post:         (url, token, body)  => ipcRenderer.invoke('ms-graph-post',   url, token, body),
    authPkce:     (clientId, scopes)  => ipcRenderer.invoke('ms-auth-pkce',    clientId, scopes),
    tokenRefresh: (clientId, rt)      => ipcRenderer.invoke('ms-token-refresh', clientId, rt),
    onAuthUrl:    (cb) => {
      const handler = (_e, payload) => cb(payload)
      ipcRenderer.on('ms-auth-url', handler)
      return () => ipcRenderer.removeListener('ms-auth-url', handler)
    },
    onAuthComplete: (cb) => {
      const handler = (_e, payload) => cb(payload)
      ipcRenderer.on('ms-auth-complete', handler)
      return () => ipcRenderer.removeListener('ms-auth-complete', handler)
    },
  },

  rss: {
    fetch: (url) => ipcRenderer.invoke('rss-fetch', url),
  },

  starvis: {
    status:    ()       => ipcRenderer.invoke('starvis-status'),
    configure: (config) => ipcRenderer.invoke('starvis-configure', config),
    chat:      (body)   => ipcRenderer.invoke('starvis-chat', body),
    briefing:  (body)   => ipcRenderer.invoke('starvis-briefing', body),
    speech:    (body)   => ipcRenderer.invoke('starvis-speech', body),
    capabilities: ()    => ipcRenderer.invoke('starvis-capabilities'),
    actions:   ()       => ipcRenderer.invoke('starvis-actions'),
    approveAction: (id) => ipcRenderer.invoke('starvis-action-approve', id),
    rejectAction:  (id) => ipcRenderer.invoke('starvis-action-reject', id),
    updateContext: (body) => ipcRenderer.send('starvis-context-update', body),
    context:   ()       => ipcRenderer.invoke('starvis-context'),
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

  reader: {
    fetch:        (url, seed) => ipcRenderer.invoke('reader-fetch', url, seed),
    fetchArchive: (url) => ipcRenderer.invoke('reader-fetch-archive', url),
    openExternal: (url) => ipcRenderer.invoke('reader-open-external', url),
    setZoomActive: (active) => ipcRenderer.send('reader-zoom-active', active),
  },

  live: {
    hls: (feed) => ipcRenderer.invoke('live-hls', feed),
    youtubeHls: (url) => ipcRenderer.invoke('live-youtube-hls', url),
  },

  auth: {
    openWindow: (url, title) => ipcRenderer.invoke('open-auth-window', url, title),
  },

  tv: {
    browserLogin: ()      => ipcRenderer.invoke('tv-browser-login'),
    watchlists:   (options) => ipcRenderer.invoke('tv-watchlists', options),
    logout:       ()      => ipcRenderer.invoke('tv-logout'),
    chart:        (ticker)     => ipcRenderer.invoke('yahoo-chart', ticker),
    events:       (options)    => ipcRenderer.invoke('market-events', options),
  },

  workstation: {
    connect:    () => ipcRenderer.invoke('workstation-connect'),
    disconnect: () => ipcRenderer.invoke('workstation-disconnect'),
    snapshot:   () => ipcRenderer.invoke('workstation-snapshot'),
  },

  log: (...args) => ipcRenderer.send('renderer-log', ...args),

  modal: {
    open:  () => ipcRenderer.send('modal-open'),
    close: () => ipcRenderer.send('modal-close'),
  },

  panel: {
    ready:       ()               => ipcRenderer.send('panel-renderer-ready'),
    onShow:      (cb)             => ipcRenderer.on('panel-show', cb),
    onHide:      (cb)             => ipcRenderer.on('panel-hide', cb),
    // Renderer calls this after slide-out animation finishes — main hides window
    hideDone:    ()               => ipcRenderer.send('panel-hide-done'),
    resizeStart: (startX, startW) => ipcRenderer.send('panel-resize-start', startX, startW),
    resizeEnd:   ()               => ipcRenderer.send('panel-resize-end'),
    setOpacity:  (v)              => ipcRenderer.invoke('set-window-opacity', v),
    fitMode:     (options)        => ipcRenderer.invoke('panel-fit-mode', options),
  },
})
