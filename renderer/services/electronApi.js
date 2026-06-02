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
        maxTokens: 1800,
        reasoning: 'medium',
        keySource: '',
        baseUrl: 'https://api.openai.com/v1',
        voiceOn: true,
        voiceEngine: 'openai',
        ttsModel: 'gpt-4o-mini-tts',
        ttsVoice: 'cedar',
        ttsSpeed: 0.96,
        ttsInstructions: 'Speak with a composed, warm, low-key technical assistant voice.',
      }),
      configure: config => Promise.resolve({
        configured: !!config?.apiKey,
        provider: config?.provider || 'openai',
        model: config?.model || 'gpt-5.5',
        temperature: config?.temperature ?? 0.8,
        maxTokens: config?.maxTokens ?? 1800,
        keySource: config?.apiKey ? 'preview' : '',
        baseUrl: config?.baseUrl || 'https://api.openai.com/v1',
        voiceOn: config?.voiceOn ?? true,
        voiceEngine: config?.voiceEngine || 'openai',
        ttsModel: config?.ttsModel || 'gpt-4o-mini-tts',
        ttsVoice: config?.ttsVoice || 'cedar',
        ttsSpeed: config?.ttsSpeed ?? 0.96,
        ttsInstructions: config?.ttsInstructions || 'Speak with a composed, warm, low-key technical assistant voice.',
      }),
      speech: body => Promise.resolve({
        ok: false,
        fallback: true,
        error: `Preview speech fallback for ${body?.voice || 'cedar'}.`,
      }),
      chat: body => Promise.resolve({
        ok: true,
        response: `Preview channel only. In Electron, I will send this through ${body?.mode === 'agent' ? 'agent mode' : 'chat mode'} on gpt-5.5 with medium reasoning: "${body?.message || ''}"`,
        model: 'gpt-5.5',
        latencyMs: 180,
        usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
        toolCalls: body?.mode === 'agent' ? [{ name: 'starvis_git_status', ok: true }] : [],
        pendingActions: body?.mode === 'agent' ? [{
          id: 'preview-action',
          actionType: 'command',
          title: 'Preview gated action',
          summary: 'Electron will show approval requests here before running local actions.',
          risk: 'Preview only.',
          command: 'npm',
          args: ['run', 'build'],
          detail: 'npm run build',
          policy: { allowed: true, reason: 'Allowed npm script command. Review the script name before approving.', severity: 'review' },
          requiresSecondApproval: false,
          confirmationArmed: false,
          status: 'pending',
        }] : [],
      }),
      briefing: () => Promise.resolve({
        ok: true,
        response: 'Systems report: preview mode is online. Widget context will be summarized in Electron once cards publish their data. Normal chat is ready; agent mode is gated.',
        model: 'gpt-5.5',
        latencyMs: 90,
      }),
      capabilities: () => Promise.resolve({
        configured: false,
        contextItems: 0,
        normalMode: ['ChatGPT-style conversation', 'Widget context summaries'],
        briefingMode: ['Launch systems report'],
        agentMode: ['Agent planning preview', 'Read-only workspace tool preview'],
        agentTools: ['starvis_list_files', 'starvis_search_repo', 'starvis_read_file', 'starvis_git_status', 'starvis_git_diff', 'starvis_request_approval'],
        pendingActions: 0,
        recentActions: [],
        unavailable: ['Ungated mutation in preview'],
      }),
      actions: () => Promise.resolve([]),
      approveAction: id => Promise.resolve({ ok: true, action: { id, status: 'completed', result: { ok: true, output: 'Preview approved.' } } }),
      rejectAction: id => Promise.resolve({ ok: true, action: { id, status: 'rejected', result: { ok: true, output: 'Preview rejected.' } } }),
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
