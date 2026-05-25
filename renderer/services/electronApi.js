function createBrowserPreviewApi() {
  const store = {
    get(key) {
      if (key === 'wp-config' && !localStorage.getItem(key)) {
        return Promise.resolve(JSON.stringify({
          categories: [{ label: 'Preview', feeds: [] }],
          activeIds: ['starvis'],
          columns: { starvis: 'right' },
          apiKeys: {},
        }));
      }
      return Promise.resolve(localStorage.getItem(key));
    },
    set(key, value) {
      if (value == null) localStorage.removeItem(key);
      else localStorage.setItem(key, String(value));
      return Promise.resolve();
    },
    delete(key) {
      localStorage.removeItem(key);
      return Promise.resolve();
    },
  };

  return {
    store,
    log: (...args) => console.debug('[preview]', ...args),
    badge: { set: () => {} },
    modal: { open: () => {}, close: () => {} },
    pin: {
      get: () => Promise.resolve(false),
      toggle: () => Promise.resolve(false),
      onChange: () => {},
    },
    panel: {
      ready: () => window.setTimeout(() => window.dispatchEvent(new Event('wp-preview-ready')), 0),
      onShow: callback => {
        window.setTimeout(callback, 0);
        return () => {};
      },
      onHide: () => {},
      hideDone: () => {},
      fitMode: () => Promise.resolve(),
      resizeStart: () => {},
      resizeEnd: () => {},
    },
    reader: {
      setZoomActive: () => {},
      fetch: () => Promise.resolve(null),
      fetchArchive: () => Promise.resolve(null),
      openExternal: url => window.open(url, '_blank', 'noopener,noreferrer'),
    },
    starvis: {
      status: () => Promise.resolve({
        configured: false,
        provider: 'openai',
        model: 'gpt-5.5',
        temperature: 0.8,
        maxTokens: 900,
        reasoning: 'medium',
        keySource: '',
        baseUrl: 'https://api.openai.com/v1',
        voiceOn: true,
      }),
      configure: config => Promise.resolve({
        configured: !!config?.apiKey,
        provider: config?.provider || 'openai',
        model: config?.model || 'gpt-5.5',
        temperature: config?.temperature ?? 0.8,
        maxTokens: config?.maxTokens ?? 900,
        keySource: config?.apiKey ? 'preview' : '',
        baseUrl: config?.baseUrl || 'https://api.openai.com/v1',
        voiceOn: config?.voiceOn ?? true,
      }),
      chat: body => Promise.resolve({
        ok: true,
        response: `Preview channel only. In Electron, I will send this through gpt-5.5 with medium reasoning: "${body?.message || ''}"`,
        model: 'gpt-5.5',
        latencyMs: 180,
        usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
      }),
      updateContext: () => {},
      context: () => Promise.resolve([]),
    },
    browser: {
      open: url => window.open(url, '_blank', 'noopener,noreferrer'),
      openExternal: () => {},
      close: () => {},
    },
    autostart: {
      get: () => Promise.resolve(false),
      set: () => Promise.resolve(false),
    },
    system: {
      accentColor: () => Promise.resolve('#62e6ff'),
      windowColor: () => Promise.resolve('#101820'),
      onWindowColorChange: () => {},
    },
    workstation: {
      snapshot: () => Promise.resolve(null),
      connect: () => Promise.resolve(),
      disconnect: () => {},
    },
    msGraph: {
      onAuthUrl: () => () => {},
      onAuthComplete: () => () => {},
    },
    live: {},
    tv: {
      watchlists: () => Promise.resolve([]),
      browserLogin: () => Promise.resolve(),
      logout: () => Promise.resolve(),
      chart: () => Promise.resolve(null),
      events: () => Promise.resolve([]),
    },
  };
}

export const api = window.electronAPI || createBrowserPreviewApi();
