import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../services/electronApi.js';

const PROVIDERS = {
  openai: ['gpt-5.5', 'gpt-5.5-2026-04-23', 'gpt-5.4', 'gpt-5.4-mini'],
  claude: ['claude-3-7-sonnet', 'claude-3-5-haiku', 'claude-3-opus'],
  llama: ['llama-3.3-local', 'qwen2.5-coder', 'mistral-nemo'],
  copilot: ['copilot-chat', 'copilot-workspace'],
};

const STARVIS_BOOT_BRIEFING_KEY = 'starvis.bootBriefingAt';
const STARVIS_BOOT_BRIEFING_COOLDOWN_MS = 30 * 60 * 1000;
const STARVIS_RUNTIME = {
  audio: null,
  bootStarted: false,
  speechToken: 0,
};

function stopStarvisRuntimeSpeech() {
  STARVIS_RUNTIME.speechToken += 1;
  if (STARVIS_RUNTIME.audio) {
    try {
      STARVIS_RUNTIME.audio.pause();
      STARVIS_RUNTIME.audio.src = '';
    } catch {}
    STARVIS_RUNTIME.audio = null;
  }
  try { window?.speechSynthesis?.cancel?.(); } catch {}
  return STARVIS_RUNTIME.speechToken;
}

function recentBootBriefingAt() {
  if (typeof window === 'undefined') return 0;
  return Number(window.sessionStorage?.getItem(STARVIS_BOOT_BRIEFING_KEY) || 0) || 0;
}

function hasRecentBootBriefing() {
  const last = recentBootBriefingAt();
  return last > 0 && Date.now() - last < STARVIS_BOOT_BRIEFING_COOLDOWN_MS;
}

function markBootBriefingStarted() {
  STARVIS_RUNTIME.bootStarted = true;
  if (typeof window === 'undefined') return;
  try { window.sessionStorage?.setItem(STARVIS_BOOT_BRIEFING_KEY, String(Date.now())); } catch {}
}

function initialStarvisText() {
  return STARVIS_RUNTIME.bootStarted || hasRecentBootBriefing()
    ? 'Starvis is running. Ask anything, or click Brief for a fresh systems report.'
    : 'Collecting widget context for the launch report.';
}

export default function StarvisWidget() {
  const firstText = initialStarvisText();
  const [messages, setMessages] = useState([
    { role: 'assistant', text: firstText },
  ]);
  const [draft, setDraft] = useState('');
  const [displayText, setDisplayText] = useState(firstText);
  const [mode, setMode] = useState('chat');
  const [typing, setTyping] = useState(false);
  const [listening, setListening] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [voiceOn, setVoiceOn] = useState(true);
  const [provider, setProvider] = useState('openai');
  const [model, setModel] = useState(PROVIDERS.openai[0]);
  const [temperature, setTemperature] = useState(0.8);
  const [maxTokens, setMaxTokens] = useState(1800);
  const [apiKeyDraft, setApiKeyDraft] = useState('');
  const [baseUrl, setBaseUrl] = useState('https://api.openai.com/v1');
  const [backendStatus, setBackendStatus] = useState({ configured: false, model: 'gpt-5.5', keySource: '', reasoning: 'medium' });
  const [voiceEngine, setVoiceEngine] = useState('openai');
  const [ttsModel, setTtsModel] = useState('gpt-4o-mini-tts');
  const [ttsVoice, setTtsVoice] = useState('cedar');
  const [ttsSpeed, setTtsSpeed] = useState(0.96);
  const [ttsInstructions, setTtsInstructions] = useState('Speak with a composed, warm, low-key technical assistant voice. Natural pacing, clear consonants, no theatrical performance.');
  const [capabilities, setCapabilities] = useState(null);
  const [lastToolCalls, setLastToolCalls] = useState([]);
  const [pendingActions, setPendingActions] = useState([]);
  const [recentActions, setRecentActions] = useState([]);
  const [configMessage, setConfigMessage] = useState('');
  const [allowInternet, setAllowInternet] = useState(false);
  const [pendingInternetRequest, setPendingInternetRequest] = useState(null);
  const [voiceStatus, setVoiceStatus] = useState('idle');
  const [voicePlayback, setVoicePlayback] = useState({ engine: 'idle', model: '', voice: '', error: '' });
  const [metrics, setMetrics] = useState({ load: 42, tokens: 2.3, latency: 145, temp: 0.8 });
  const typeTimerRef = useRef(null);
  const synthRef = useRef(null);
  const audioRef = useRef(null);
  const voiceRef = useRef(null);
  const speechRunRef = useRef(0);
  const bootBriefingRef = useRef(false);
  const configLoadedRef = useRef(false);
  const mountedRef = useRef(false);
  const voiceConfigRef = useRef(null);
  const particles = useMemo(() => Array.from({ length: 26 }, (_, index) => ({
    id: index,
    left: `${(index * 37) % 100}%`,
    top: `${(index * 61) % 100}%`,
    delay: `${(index % 9) * 0.27}s`,
    duration: `${8 + (index % 7)}s`,
  })), []);

  useEffect(() => {
    mountedRef.current = true;
    synthRef.current = typeof window !== 'undefined' ? window.speechSynthesis : null;
    const loadVoices = () => {
      const voices = synthRef.current?.getVoices?.() || [];
      voiceRef.current = selectJarvisVoice(voices);
    };
    loadVoices();
    if (synthRef.current) synthRef.current.onvoiceschanged = loadVoices;
    api.starvis?.status?.().then(status => {
      if (!status) return;
      setBackendStatus(status);
      if (status.capabilities) setCapabilities(status.capabilities);
      if (status.provider && PROVIDERS[status.provider]) setProvider(status.provider);
      if (status.model) setModel(status.model);
      if (Number.isFinite(Number(status.temperature))) setTemperature(Number(status.temperature));
      if (Number.isFinite(Number(status.maxTokens))) setMaxTokens(Number(status.maxTokens));
      if (status.baseUrl) setBaseUrl(status.baseUrl);
      if (typeof status.voiceOn === 'boolean') setVoiceOn(status.voiceOn);
      if (status.voiceEngine) setVoiceEngine(status.voiceEngine);
      if (status.ttsModel) setTtsModel(status.ttsModel);
      if (status.ttsVoice) setTtsVoice(status.ttsVoice);
      if (Number.isFinite(Number(status.ttsSpeed))) setTtsSpeed(Number(status.ttsSpeed));
      if (status.ttsInstructions) setTtsInstructions(status.ttsInstructions);
      configLoadedRef.current = true;
    }).catch(() => {
      configLoadedRef.current = true;
    });
    api.starvis?.capabilities?.().then(report => {
      if (report) setCapabilities(report);
    }).catch(() => {});
    refreshActions();
    const briefingTimer = window.setTimeout(() => {
      if (!bootBriefingRef.current && !STARVIS_RUNTIME.bootStarted && !hasRecentBootBriefing()) {
        markBootBriefingStarted();
        runBriefing({ boot: true });
      }
    }, 3200);
    return () => {
      mountedRef.current = false;
      window.clearTimeout(briefingTimer);
      window.clearInterval(typeTimerRef.current);
      if (synthRef.current) synthRef.current.onvoiceschanged = null;
    };
  }, []);

  useEffect(() => {
    if (!configLoadedRef.current) return undefined;
    const timer = window.setTimeout(async () => {
      try {
        const status = await api.starvis?.configure?.({
          provider,
          model,
          temperature,
          maxTokens,
          baseUrl,
          voiceOn,
          voiceEngine,
          ttsModel,
          ttsVoice,
          ttsSpeed,
          ttsInstructions,
        });
        if (!status) return;
        setBackendStatus(current => ({ ...current, ...status }));
        if (status.ttsModel && status.ttsModel !== ttsModel) setTtsModel(status.ttsModel);
        if (status.ttsVoice && status.ttsVoice !== ttsVoice) setTtsVoice(status.ttsVoice);
        if (status.voiceEngine && status.voiceEngine !== voiceEngine) setVoiceEngine(status.voiceEngine);
        if (typeof status.voiceOn === 'boolean' && status.voiceOn !== voiceOn) setVoiceOn(status.voiceOn);
        if (Number.isFinite(Number(status.ttsSpeed)) && Number(status.ttsSpeed) !== ttsSpeed) setTtsSpeed(Number(status.ttsSpeed));
        if (status.ttsInstructions && status.ttsInstructions !== ttsInstructions) setTtsInstructions(status.ttsInstructions);
      } catch {}
    }, 450);
    return () => window.clearTimeout(timer);
  }, [baseUrl, maxTokens, model, provider, temperature, ttsInstructions, ttsModel, ttsSpeed, ttsVoice, voiceEngine, voiceOn]);

  useEffect(() => {
    voiceConfigRef.current = {
      baseUrl,
      configured: backendStatus.configured,
      engine: voiceEngine,
      instructions: ttsInstructions,
      model: ttsModel,
      speed: ttsSpeed,
      voice: ttsVoice,
    };
  }, [backendStatus.configured, baseUrl, ttsInstructions, ttsModel, ttsSpeed, ttsVoice, voiceEngine]);

  useEffect(() => {
    const id = window.setInterval(() => {
      setMetrics(current => ({
        load: settle(current.load, 34 + Math.random() * 36),
        tokens: settle(current.tokens, 1.9 + Math.random() * 1.8),
        latency: settle(current.latency, 92 + Math.random() * 112),
        temp: temperature,
      }));
    }, 2200);
    return () => window.clearInterval(id);
  }, [temperature]);

  function selectProvider(nextProvider) {
    setProvider(nextProvider);
    setModel(PROVIDERS[nextProvider][0]);
  }

  function stopSpeech() {
    speechRunRef.current = stopStarvisRuntimeSpeech();
    audioRef.current = null;
    setVoiceStatus('idle');
    setVoicePlayback(current => ({ ...current, engine: 'idle', error: '' }));
  }

  function handleVoiceButton() {
    if (voiceOn || voiceStatus !== 'idle') {
      stopSpeech();
      setVoiceOn(false);
    } else {
      setVoiceOn(true);
    }
  }

  async function speak(text) {
    if (!voiceOn) return;
    const spoken = prepareSpeechText(text);
    if (!spoken) return;
    const voiceConfig = voiceConfigRef.current || {
      baseUrl,
      configured: backendStatus.configured,
      engine: voiceEngine,
      instructions: ttsInstructions,
      model: ttsModel,
      speed: ttsSpeed,
      voice: ttsVoice,
    };
    const canUseNeuralVoice = voiceConfig.engine === 'openai' && voiceConfig.configured;
    setVoiceStatus(canUseNeuralVoice ? 'neural' : 'system');
    setVoicePlayback({
      engine: canUseNeuralVoice ? 'openai-pending' : 'system',
      model: voiceConfig.model,
      voice: voiceConfig.voice,
      error: '',
    });
    const runId = stopStarvisRuntimeSpeech();
    speechRunRef.current = runId;
    audioRef.current = null;

    if (canUseNeuralVoice) {
      try {
        const result = await api.starvis?.speech?.({
          input: spoken,
          model: voiceConfig.model,
          voice: voiceConfig.voice,
          speed: voiceConfig.speed,
          instructions: voiceConfig.instructions,
          baseUrl: voiceConfig.baseUrl,
        });
        if (speechRunRef.current !== runId || STARVIS_RUNTIME.speechToken !== runId) return;
        if (result?.ok && result.dataUrl) {
          if (mountedRef.current) {
            setVoicePlayback({
              engine: 'openai',
              model: result.model || voiceConfig.model,
              voice: result.voice || voiceConfig.voice,
              error: '',
            });
          }
          const audio = new Audio(result.dataUrl);
          audioRef.current = audio;
          STARVIS_RUNTIME.audio = audio;
          audio.onended = () => {
            if (audioRef.current === audio) audioRef.current = null;
            if (STARVIS_RUNTIME.audio === audio) STARVIS_RUNTIME.audio = null;
            if (mountedRef.current) setVoiceStatus('idle');
          };
          audio.onerror = () => {
            if (audioRef.current === audio) audioRef.current = null;
            if (STARVIS_RUNTIME.audio === audio) STARVIS_RUNTIME.audio = null;
            if (mountedRef.current) {
              setVoiceStatus('fallback');
              setVoicePlayback({
                engine: 'fallback',
                model: voiceConfig.model,
                voice: voiceConfig.voice,
                error: 'Audio playback failed.',
              });
            }
            speakWithSystemVoice(spoken, runId);
          };
          await audio.play();
          return;
        }
        if (mountedRef.current) {
          setVoicePlayback({
            engine: 'fallback',
            model: voiceConfig.model,
            voice: voiceConfig.voice,
            error: result?.error || 'OpenAI speech did not return audio.',
          });
        }
      } catch (error) {
        if (mountedRef.current) {
          setVoicePlayback({
            engine: 'fallback',
            model: voiceConfig.model,
            voice: voiceConfig.voice,
            error: error?.message || 'OpenAI speech request failed.',
          });
        }
      }
    }

    if (mountedRef.current) setVoiceStatus(canUseNeuralVoice ? 'fallback' : 'system');
    if (!canUseNeuralVoice) {
      if (mountedRef.current) {
        setVoicePlayback({
          engine: 'system',
          model: voiceConfig.model,
          voice: voiceConfig.voice,
          error: '',
        });
      }
    }
    speakWithSystemVoice(spoken, runId);
  }

  function speakWithSystemVoice(spoken, runId = speechRunRef.current + 1) {
    if (!synthRef.current || typeof SpeechSynthesisUtterance === 'undefined') return;
    const chunks = splitSpeechText(spoken);
    if (!chunks.length) return;
    speechRunRef.current = runId;
    synthRef.current.cancel();

    const speakChunk = (index = 0) => {
      if (speechRunRef.current !== runId || STARVIS_RUNTIME.speechToken !== runId || !chunks[index]) return;
      const utterance = new SpeechSynthesisUtterance(chunks[index]);
      if (voiceRef.current) utterance.voice = voiceRef.current;
      const question = /\?$/.test(chunks[index]);
      const shortPhrase = chunks[index].length < 80;
      utterance.rate = question ? 0.9 : shortPhrase ? 0.92 : 0.88;
      utterance.pitch = question ? 1.02 : shortPhrase ? 0.98 : 0.95;
      utterance.volume = 0.94;
      utterance.onend = () => window.setTimeout(() => speakChunk(index + 1), question ? 130 : 90);
      utterance.onerror = () => window.setTimeout(() => speakChunk(index + 1), 90);
      if (index === chunks.length - 1) {
        const done = utterance.onend;
        utterance.onend = () => {
          done?.();
          window.setTimeout(() => {
            if (mountedRef.current) setVoiceStatus('idle');
          }, 180);
        };
      }
      synthRef.current.speak(utterance);
    };

    speakChunk();
  }

  function typeMessage(text, { silent = false } = {}) {
    window.clearInterval(typeTimerRef.current);
    setTyping(true);
    setDisplayText('');
    let index = 0;
    typeTimerRef.current = window.setInterval(() => {
      index += 1;
      setDisplayText(text.slice(0, index));
      if (index >= text.length) {
        window.clearInterval(typeTimerRef.current);
        setTyping(false);
        if (!silent) speak(text);
      }
    }, 18);
  }

  async function runBriefing({ boot = false } = {}) {
    bootBriefingRef.current = true;
    setLastToolCalls([]);
    setMode(boot ? 'chat' : 'briefing');
    typeMessage('Preparing systems report from local widget context...', { silent: true });
    try {
      const result = await api.starvis?.briefing?.({
        model,
        baseUrl,
        waitForFreshMs: boot ? 4200 : 1800,
      });
      const response = result?.response || 'Systems report unavailable. Normal chat is ready.';
      setMessages(current => {
        const withoutBootPlaceholder = boot
          ? current.filter(message => message.text !== 'Collecting widget context for the launch report.')
          : current;
        return [...withoutBootPlaceholder, { role: 'assistant', text: response }];
      });
      setBackendStatus(current => ({
        ...current,
        configured: result?.ok ? current.configured : current.configured,
        model: result?.model || model,
      }));
      setMetrics(current => ({
        ...current,
        load: settle(current.load, 38),
        latency: result?.latencyMs || current.latency,
        tokens: usageToTokens(result?.usage, current.tokens),
      }));
      api.starvis?.capabilities?.().then(report => {
        if (report) setCapabilities(report);
      }).catch(() => {});
      refreshActions();
      typeMessage(response, { silent: boot && !voiceOn });
    } catch (error) {
      const response = `Systems report unavailable: ${error?.message || String(error)}`;
      setMessages(current => [...current, { role: 'assistant', text: response }]);
      typeMessage(response);
    }
  }

  async function submitMessage({ text, appendUser = true, forceInternet = false, priorMessages = null } = {}) {
    text = String(text || '').trim();
    if (!text) {
      if (mode === 'briefing') runBriefing();
      return;
    }
    const nextMessages = appendUser
      ? [...(priorMessages || messages), { role: 'user', text }]
      : [...(priorMessages || messages)];
    setPendingInternetRequest(null);
    setLastToolCalls([]);
    if (appendUser) setDraft('');
    setMessages(nextMessages);
    typeMessage(provider === 'openai'
      ? (mode === 'agent' ? 'Planning with GPT-5.5 agent mode...' : 'Thinking with GPT-5.5...')
      : 'Processing command stream...', { silent: true });
    setMetrics(current => ({
      load: Math.min(98, current.load + 24),
      tokens: current.tokens + 0.4,
      latency: current.latency + 58,
      temp: temperature,
    }));

    try {
      const result = provider === 'openai'
        ? await api.starvis?.chat?.({
          message: text,
          messages: nextMessages,
          model,
          temperature,
          maxTokens,
          baseUrl,
          mode,
          allowInternet: forceInternet || allowInternet,
        })
        : { ok: false, error: `${provider.toUpperCase()} routing is not connected yet. OpenAI GPT-5.5 is active.` };
      const response = result?.ok
        ? result.response
        : `Backend notice: ${result?.error || 'Starvis backend is unavailable.'}`;
      if (result?.internetPermissionRequired) {
        setPendingInternetRequest({
          text,
          messages: nextMessages,
          reason: result.internetPermissionReason || response,
        });
      }
      setLastToolCalls(Array.isArray(result?.toolCalls) ? result.toolCalls : []);
      if (Array.isArray(result?.pendingActions)) setPendingActions(result.pendingActions);
      if (Array.isArray(result?.recentActions)) setRecentActions(result.recentActions);
      setMessages(current => [...current, { role: 'assistant', text: response }]);
      setBackendStatus(current => ({
        ...current,
        configured: result?.ok ? true : current.configured,
        model: result?.model || model,
      }));
      setMetrics(current => ({
        load: settle(current.load, result?.ok ? 46 : 28),
        tokens: usageToTokens(result?.usage, current.tokens),
        latency: result?.latencyMs || current.latency,
        temp: temperature,
      }));
      api.starvis?.capabilities?.().then(report => {
        if (report) setCapabilities(report);
      }).catch(() => {});
      refreshActions();
      typeMessage(response);
    } catch (error) {
      const response = `Backend notice: ${error?.message || String(error)}`;
      setMessages(current => [...current, { role: 'assistant', text: response }]);
      typeMessage(response);
    }
  }

  function sendMessage() {
    submitMessage({ text: draft, appendUser: true });
  }

  async function refreshActions() {
    try {
      const actions = await api.starvis?.actions?.();
      if (!Array.isArray(actions)) return;
      setPendingActions(actions.filter(action => action.status === 'pending'));
      setRecentActions(actions.filter(action => action.status !== 'pending').slice(0, 8));
    } catch {}
  }

  async function handleActionDecision(action, approved) {
    const verb = approved ? 'Approving' : 'Rejecting';
    typeMessage(`${verb} ${action.title || action.actionType}...`, { silent: true });
    try {
      const result = approved
        ? await api.starvis?.approveAction?.(action.id)
        : await api.starvis?.rejectAction?.(action.id);
      await refreshActions();
      const next = result?.action || action;
      const output = next.result?.output || next.result?.error || (approved ? 'Action approved.' : 'Action rejected.');
      const response = result?.confirmationRequired
        ? `Confirmation required: ${output}`
        : `${next.status || (approved ? 'approved' : 'rejected')}: ${output}`;
      setMessages(current => [...current, { role: 'assistant', text: response }]);
      typeMessage(response);
    } catch (error) {
      const response = `Action gate error: ${error?.message || String(error)}`;
      setMessages(current => [...current, { role: 'assistant', text: response }]);
      typeMessage(response);
    }
  }

  function allowInternetOnce() {
    if (!pendingInternetRequest) return;
    const { text, messages: permittedMessages } = pendingInternetRequest;
    setPendingInternetRequest(null);
    submitMessage({
      text,
      appendUser: false,
      forceInternet: true,
      priorMessages: permittedMessages,
    });
  }

  function denyInternetOnce() {
    setPendingInternetRequest(null);
    const response = 'Understood. I will stay with local context only.';
    setMessages(current => [...current, { role: 'assistant', text: response }]);
    typeMessage(response);
  }

  async function saveBackendConfig() {
    setConfigMessage('Saving...');
    try {
      const status = await api.starvis?.configure?.({
        apiKey: apiKeyDraft,
        provider,
        model,
        temperature,
        maxTokens,
        baseUrl,
        voiceOn,
        voiceEngine,
        ttsModel,
        ttsVoice,
        ttsSpeed,
        ttsInstructions,
      });
      setBackendStatus(current => ({ ...current, ...status }));
      if (status?.voiceEngine) setVoiceEngine(status.voiceEngine);
      if (status?.ttsModel) setTtsModel(status.ttsModel);
      if (status?.ttsVoice) setTtsVoice(status.ttsVoice);
      if (Number.isFinite(Number(status?.ttsSpeed))) setTtsSpeed(Number(status.ttsSpeed));
      if (status?.ttsInstructions) setTtsInstructions(status.ttsInstructions);
      if (typeof status?.voiceOn === 'boolean') setVoiceOn(status.voiceOn);
      setApiKeyDraft('');
      setConfigMessage(status?.configured ? 'Starvis settings saved.' : 'Settings saved. API key still needed.');
    } catch (error) {
      setConfigMessage(error?.message || 'Could not save backend config.');
    }
  }

  function toggleListening() {
    setListening(value => !value);
    if (!listening) {
      setDisplayText('Voice channel armed. Listening for command phrase...');
    } else {
      const heard = 'Hey Starvis, prepare the daily briefing.';
      setDraft(heard);
      setDisplayText(`Voice capture ready: "${heard}"`);
      setMessages(current => [...current, { role: 'user', text: '[voice] prepare the daily briefing' }]);
    }
  }

  const content = (
    <div className="starvis-card">
      <style>{`
        .starvis-card{position:relative;min-height:468px;overflow:hidden;border-radius:8px;background:linear-gradient(180deg,rgba(4,11,20,.52),rgba(3,8,16,.22));font-family:'DM Sans',system-ui,sans-serif}
        .starvis-card ::-webkit-scrollbar{width:5px;height:5px}.starvis-card ::-webkit-scrollbar-thumb{background:rgba(144,223,255,.22);border-radius:999px}.starvis-card ::-webkit-scrollbar-track{background:transparent}
        .starvis-card *{box-sizing:border-box}
        .starvis-particle{position:absolute;width:2px;height:2px;border-radius:50%;background:#62e6ff;opacity:.34;animation:starvisFloat var(--duration) ease-in-out infinite;animation-delay:var(--delay)}
        @keyframes starvisFloat{0%,100%{transform:translate3d(0,0,0);opacity:.12}50%{transform:translate3d(7px,-12px,0);opacity:.48}}
        .starvis-top{position:relative;z-index:2;display:flex;align-items:center;justify-content:space-between;padding:10px 0 8px;border-bottom:1px solid rgba(144,223,255,.16)}
        .starvis-status{display:flex;align-items:center;gap:7px;min-width:0;color:rgba(238,249,255,.82);font-size:9px;font-family:'DM Mono',monospace;text-transform:uppercase}
        .starvis-status span:last-child{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .starvis-dot{width:7px;height:7px;border-radius:50%;background:#52f0c5;box-shadow:0 0 13px rgba(82,240,197,.82);animation:starvisPulse 1.8s ease-in-out infinite}
        @keyframes starvisPulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.52;transform:scale(.78)}}
        .starvis-actions{display:flex;gap:5px}
        .starvis-icon-btn{width:28px;height:28px;display:grid;place-items:center;border-radius:6px;border:1px solid rgba(144,223,255,.28);background:rgba(8,24,39,.58);color:#d9f8ff;cursor:pointer;font-size:13px;line-height:1}
        .starvis-icon-btn.is-active{border-color:rgba(83,240,197,.74);color:#53f0c5;box-shadow:0 0 14px rgba(83,240,197,.18)}
        .starvis-icon-btn.is-speaking{border-color:rgba(255,207,112,.64);color:#ffd98a;background:rgba(74,45,7,.48);box-shadow:0 0 14px rgba(255,207,112,.16)}
        .starvis-mode-row{position:relative;z-index:2;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:5px;margin:8px 0 4px}
        .starvis-mode-btn{height:26px;border-radius:6px;border:1px solid rgba(144,223,255,.18);background:rgba(255,255,255,.035);color:rgba(238,249,255,.70);font-size:9px;font-family:'DM Mono',monospace;text-transform:uppercase;cursor:pointer}
        .starvis-mode-btn.is-active{border-color:rgba(83,240,197,.48);background:rgba(83,240,197,.12);color:#9ffff0;box-shadow:inset 0 0 0 1px rgba(255,255,255,.04)}
        .starvis-capability-strip{position:relative;z-index:2;display:flex;gap:6px;align-items:center;justify-content:space-between;min-height:24px;border:1px solid rgba(144,223,255,.12);border-radius:6px;background:rgba(255,255,255,.025);padding:5px 7px;color:rgba(213,240,248,.68);font-size:8px;font-family:'DM Mono',monospace;text-transform:uppercase}
        .starvis-capability-strip strong{color:#dffcff;font-weight:500}
        .starvis-agent-note{position:relative;z-index:2;margin-top:7px;border:1px solid rgba(255,207,112,.20);border-radius:7px;background:rgba(80,48,6,.18);padding:6px 7px;color:rgba(255,238,198,.78);font-size:8px;line-height:1.3;font-family:'DM Mono',monospace}
        .starvis-tool-strip{position:relative;z-index:2;margin-top:6px;display:flex;gap:5px;flex-wrap:wrap}
        .starvis-tool-pill{border:1px solid rgba(83,240,197,.22);border-radius:999px;background:rgba(83,240,197,.08);padding:3px 6px;color:rgba(198,255,242,.76);font-size:8px;font-family:'DM Mono',monospace;text-transform:uppercase}
        .starvis-tool-pill.is-error{border-color:rgba(255,110,110,.26);background:rgba(255,110,110,.08);color:rgba(255,216,216,.78)}
        .starvis-tool-pill.is-idle{border-color:rgba(144,223,255,.16);background:rgba(255,255,255,.035);color:rgba(213,240,248,.56)}
        .starvis-action-queue{position:relative;z-index:2;margin-top:7px;display:grid;gap:5px}
        .starvis-action-card{border:1px solid rgba(255,207,112,.22);border-radius:7px;background:rgba(36,27,9,.40);padding:7px;display:grid;gap:5px}
        .starvis-action-card.is-high{border-color:rgba(255,145,95,.38);background:rgba(62,25,12,.45)}
        .starvis-action-card.is-blocked{border-color:rgba(255,110,110,.32);background:rgba(56,12,16,.38)}
        .starvis-action-title{display:flex;justify-content:space-between;gap:8px;color:rgba(255,246,221,.92);font-size:9px;font-family:'DM Mono',monospace;text-transform:uppercase}
        .starvis-action-title span:first-child{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .starvis-action-type{flex:0 0 auto;color:rgba(255,207,112,.76)}
        .starvis-action-text{color:rgba(238,249,255,.74);font-size:9px;line-height:1.28;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
        .starvis-action-detail{border:1px solid rgba(144,223,255,.12);border-radius:6px;background:rgba(4,14,24,.46);padding:5px;color:rgba(213,240,248,.72);font-size:8px;line-height:1.25;font-family:'DM Mono',monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .starvis-action-risk{color:rgba(255,208,208,.76);font-size:8px;line-height:1.25;font-family:'DM Mono',monospace;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
        .starvis-action-actions{display:flex;gap:5px}
        .starvis-action-btn{height:24px;border-radius:6px;border:1px solid rgba(83,240,197,.42);background:rgba(83,240,197,.12);color:#9ffff0;padding:0 8px;font-size:8px;font-family:'DM Mono',monospace;cursor:pointer;text-transform:uppercase}
        .starvis-action-btn.is-reject{border-color:rgba(255,110,110,.26);background:rgba(255,110,110,.08);color:rgba(255,216,216,.82)}
        .starvis-audit-strip{position:relative;z-index:2;margin-top:6px;color:rgba(213,240,248,.54);font-size:8px;font-family:'DM Mono',monospace;text-transform:uppercase;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .starvis-orb-zone{position:relative;height:190px;display:grid;place-items:center}
        .starvis-ring{position:absolute;border-radius:50%;border:1px solid rgba(98,230,255,.28);box-shadow:inset 0 0 24px rgba(98,230,255,.05)}
        .starvis-ring.one{width:188px;height:188px;animation:starvisSpin 18s linear infinite}
        .starvis-ring.two{width:138px;height:138px;border-style:dashed;animation:starvisSpinReverse 23s linear infinite}
        .starvis-ring.three{width:92px;height:92px;border-color:rgba(83,240,197,.28);animation:starvisSpin 28s linear infinite}
        @keyframes starvisSpin{to{transform:rotate(360deg)}}@keyframes starvisSpinReverse{to{transform:rotate(-360deg)}}
        .starvis-orb{position:relative;z-index:1;width:72px;height:72px;border-radius:50%;display:grid;place-items:center;background:radial-gradient(circle at 50% 35%,rgba(116,244,255,.34),rgba(7,36,51,.84));border:1px solid rgba(178,247,255,.52);box-shadow:0 0 24px rgba(98,230,255,.34),inset 0 0 18px rgba(98,230,255,.18);color:#e8fdff;font-size:30px;font-weight:700}
        .starvis-orb.is-speaking{animation:starvisOrbSpeak .62s ease-in-out infinite}
        @keyframes starvisOrbSpeak{50%{transform:scale(1.06);box-shadow:0 0 34px rgba(83,240,197,.42),inset 0 0 20px rgba(98,230,255,.24)}}
        .starvis-metric{position:absolute;width:56px;height:48px;border:1px solid rgba(144,223,255,.22);border-radius:7px;background:rgba(5,20,33,.62);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px}
        .starvis-metric strong{font-size:13px;color:#effdff;font-family:'DM Mono',monospace;font-weight:600}
        .starvis-metric span{font-size:8px;color:rgba(184,229,240,.68);text-transform:uppercase;letter-spacing:.08em}
        .starvis-metric.m1{top:16px;left:50%;transform:translateX(-50%)}.starvis-metric.m2{right:4px;top:82px}.starvis-metric.m3{bottom:14px;left:50%;transform:translateX(-50%)}.starvis-metric.m4{left:4px;top:82px}
        .starvis-readout{position:relative;z-index:2;min-height:78px;max-height:132px;overflow:auto;border:1px solid rgba(144,223,255,.22);border-radius:8px;background:rgba(5,18,30,.58);padding:10px;color:#bbf5ff;font-size:11px;line-height:1.45;font-family:'DM Mono',monospace;box-shadow:inset 0 0 18px rgba(98,230,255,.05);overflow-wrap:anywhere}
        .starvis-voice-state{position:relative;z-index:2;margin-top:5px;display:flex;justify-content:flex-end;color:rgba(213,240,248,.46);font-size:8px;font-family:'DM Mono',monospace;text-transform:uppercase}
        .starvis-cursor{display:inline-block;width:2px;height:12px;margin-left:3px;background:#7defff;vertical-align:-2px;animation:starvisBlink 1s steps(1,end) infinite}
        @keyframes starvisBlink{50%{opacity:0}}
        .starvis-history{position:relative;z-index:2;display:grid;gap:5px;margin-top:8px;max-height:98px;overflow:auto}
        .starvis-log{display:grid;grid-template-columns:58px minmax(0,1fr);gap:8px;align-items:start;border-bottom:1px solid rgba(144,223,255,.09);padding-bottom:5px;font-size:10px;line-height:1.32}
        .starvis-role{font-family:'DM Mono',monospace;color:#53f0c5;text-transform:uppercase;font-size:8px;letter-spacing:.08em}.starvis-log.is-user .starvis-role{color:#8fb7ff}
        .starvis-log-text{color:rgba(238,249,255,.76);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}
        .starvis-permission{position:relative;z-index:2;margin-top:8px;border:1px solid rgba(83,240,197,.28);border-radius:8px;background:rgba(5,24,32,.62);padding:9px;display:grid;gap:8px}
        .starvis-permission-text{font-size:10px;line-height:1.35;color:rgba(238,249,255,.80);font-family:'DM Mono',monospace}
        .starvis-permission-actions{display:flex;gap:6px;align-items:center}
        .starvis-permission-btn{height:28px;border-radius:6px;border:1px solid rgba(83,240,197,.42);background:rgba(83,240,197,.12);color:#9ffff0;padding:0 9px;font-size:9px;font-family:'DM Mono',monospace;cursor:pointer;text-transform:uppercase}
        .starvis-permission-btn.is-quiet{border-color:rgba(144,223,255,.20);background:rgba(255,255,255,.04);color:rgba(238,249,255,.66)}
        .starvis-input-row{position:relative;z-index:2;display:flex;gap:6px;margin-top:10px}
        .starvis-input{min-width:0;flex:1;height:32px;border-radius:6px;border:1px solid rgba(144,223,255,.22);background:rgba(4,14,24,.78);color:#f3fbff;font-size:11px;padding:0 9px;outline:none;font-family:'DM Mono',monospace}
        .starvis-input:focus{border-color:rgba(125,239,255,.7);box-shadow:0 0 16px rgba(98,230,255,.18)}
        .starvis-send{width:34px;height:32px;border-radius:6px;border:1px solid rgba(83,240,197,.46);background:rgba(83,240,197,.12);color:#7fffe0;cursor:pointer;font-size:13px}
        .starvis-wave{display:flex;align-items:center;gap:2px;height:16px}.starvis-wave i{display:block;width:2px;border-radius:2px;background:#53f0c5;animation:starvisWave .62s ease-in-out infinite}.starvis-wave i:nth-child(2){animation-delay:.1s}.starvis-wave i:nth-child(3){animation-delay:.2s}.starvis-wave i:nth-child(4){animation-delay:.3s}
        @keyframes starvisWave{0%,100%{height:4px}50%{height:15px}}
        .starvis-settings{position:absolute;z-index:4;inset:48px 0 auto 0;max-height:386px;overflow:auto;border:1px solid rgba(144,223,255,.28);border-radius:8px;background:rgba(4,12,22,.96);box-shadow:0 16px 36px rgba(0,0,0,.38),0 0 28px rgba(98,230,255,.12);padding:12px;display:grid;gap:10px}
        .starvis-settings-title{display:flex;align-items:center;justify-content:space-between;color:#eefcff;font-size:10px;text-transform:uppercase;letter-spacing:.12em;font-family:'DM Mono',monospace}
        .starvis-field{display:grid;gap:5px}.starvis-field label{font-size:9px;color:rgba(213,240,248,.68);text-transform:uppercase;letter-spacing:.08em;font-family:'DM Mono',monospace}
        .starvis-field input,.starvis-field select{width:100%;height:30px;border-radius:6px;border:1px solid rgba(144,223,255,.22);background:rgba(255,255,255,.05);color:#f4fbff;padding:0 8px;font-size:11px;outline:none}
        .starvis-field input[type=range]{height:auto;padding:0;accent-color:#53f0c5}
        .starvis-range-line{display:flex;justify-content:space-between;color:rgba(238,249,255,.76);font-size:10px;font-family:'DM Mono',monospace}
        .starvis-config-row{display:flex;gap:6px;align-items:center}
        .starvis-text-btn{height:30px;border-radius:6px;border:1px solid rgba(83,240,197,.42);background:rgba(83,240,197,.12);color:#9ffff0;padding:0 9px;font-size:10px;font-family:'DM Mono',monospace;cursor:pointer;text-transform:uppercase}
        .starvis-hint{font-size:9px;line-height:1.35;color:rgba(213,240,248,.62);font-family:'DM Mono',monospace}
        #starvis-tts-instructions{height:42px}
        .starvis-check{display:flex;align-items:center;gap:8px;font-size:10px;color:rgba(238,249,255,.78);font-family:'DM Mono',monospace}
        .starvis-check input{width:14px;height:14px;accent-color:#53f0c5}
        @media (max-width:230px){.starvis-log{grid-template-columns:1fr}.starvis-role{display:none}.starvis-metric{width:50px}.starvis-card{min-height:500px}}
      `}</style>

      {particles.map(particle => (
        <span
          key={particle.id}
          className="starvis-particle"
          style={{ left: particle.left, top: particle.top, '--delay': particle.delay, '--duration': particle.duration }}
        />
      ))}

      <div className="starvis-top">
        <div className="starvis-status">
          <span className="starvis-dot" />
          <span>{listening ? 'Listening' : typing ? 'Processing' : backendStatus.configured ? `${backendStatus.model || model} avg` : 'Key needed'}</span>
        </div>
        <div className="starvis-actions">
          <button className={`starvis-icon-btn${listening ? ' is-active' : ''}`} type="button" onClick={toggleListening} title="Voice input" aria-label="Voice input">
            {listening ? <span className="starvis-wave"><i /><i /><i /><i /></span> : <IconMic />}
          </button>
          <button
            className={`starvis-icon-btn${voiceOn ? ' is-active' : ''}${voiceStatus !== 'idle' ? ' is-speaking' : ''}`}
            type="button"
            onClick={handleVoiceButton}
            title={voiceStatus !== 'idle' ? 'Stop voice output' : voiceOn ? 'Disable voice output' : 'Enable voice output'}
            aria-label={voiceStatus !== 'idle' ? 'Stop voice output' : 'Voice output'}
          >
            {voiceStatus !== 'idle' ? <IconStop /> : voiceOn ? <IconVolume /> : <IconVolumeOff />}
          </button>
          <button className={`starvis-icon-btn${settingsOpen ? ' is-active' : ''}`} type="button" onClick={() => setSettingsOpen(value => !value)} title="Settings" aria-label="Settings">
            <IconSettings />
          </button>
        </div>
      </div>

      <div className="starvis-mode-row" aria-label="Starvis mode">
        <button className={`starvis-mode-btn${mode === 'chat' ? ' is-active' : ''}`} type="button" onClick={() => setMode('chat')}>Chat</button>
        <button className={`starvis-mode-btn${mode === 'briefing' ? ' is-active' : ''}`} type="button" onClick={() => runBriefing()}>Brief</button>
        <button className={`starvis-mode-btn${mode === 'agent' ? ' is-active' : ''}`} type="button" onClick={() => setMode('agent')}>Agent</button>
      </div>

      <div className="starvis-capability-strip">
        <span><strong>{capabilities?.contextItems ?? backendStatus.contextCount ?? 0}</strong> context</span>
        <span><strong>{backendStatus.reasoning || 'medium'}</strong> reasoning</span>
        <span><strong>{mode === 'agent' ? `${pendingActions.length} gate` : allowInternet ? 'web on' : 'local'}</strong></span>
      </div>

      {mode === 'agent' && (
        <div className="starvis-agent-note">
          Agent mode can inspect the workspace read-only and queue gated actions for approval. Browser automation requests are audited until a safe automation backend is wired.
        </div>
      )}

      {mode === 'agent' && (
        <div className="starvis-tool-strip" aria-label="Last agent tools used">
          {lastToolCalls.length > 0
            ? lastToolCalls.slice(0, 5).map((tool, index) => (
              <span className={`starvis-tool-pill${tool.ok ? '' : ' is-error'}`} key={`${tool.name}-${index}`}>
                {tool.name.replace(/^starvis_/, '').replace(/_/g, ' ')}
              </span>
            ))
            : <span className="starvis-tool-pill is-idle">tools ready</span>}
        </div>
      )}

      {mode === 'agent' && pendingActions.length > 0 && (
        <div className="starvis-action-queue" aria-label="Pending Starvis actions">
          {pendingActions.slice(0, 2).map(action => (
            <div className={`starvis-action-card${action.policy?.severity === 'high' ? ' is-high' : ''}${action.policy?.severity === 'blocked' ? ' is-blocked' : ''}`} key={action.id}>
              <div className="starvis-action-title">
                <span>{action.title || 'Approval request'}</span>
                <span className="starvis-action-type">{action.actionType}</span>
              </div>
              <div className="starvis-action-text">{action.summary || action.command || action.path || action.url}</div>
              <div className="starvis-action-detail">{action.detail || action.command || action.path || action.url || action.message}</div>
              <div className="starvis-action-risk">{action.policy?.reason || action.risk || 'Review before approving.'}</div>
              <div className="starvis-action-actions">
                <button className="starvis-action-btn" type="button" onClick={() => handleActionDecision(action, true)}>
                  {action.confirmationArmed ? 'Confirm' : action.requiresSecondApproval ? 'Approve 1/2' : 'Approve'}
                </button>
                <button className="starvis-action-btn is-reject" type="button" onClick={() => handleActionDecision(action, false)}>Reject</button>
              </div>
            </div>
          ))}
          {pendingActions.length > 2 && (
            <div className="starvis-audit-strip">{pendingActions.length - 2} more pending actions</div>
          )}
        </div>
      )}

      {mode === 'agent' && pendingActions.length === 0 && recentActions.length > 0 && (
        <div className="starvis-audit-strip">
          Last action: {recentActions[0].status} {recentActions[0].title || recentActions[0].actionType}
        </div>
      )}

      {settingsOpen && (
        <div className="starvis-settings">
          <div className="starvis-settings-title">
            <span>Configuration</span>
            <button className="starvis-icon-btn" type="button" onClick={() => setSettingsOpen(false)} title="Close settings" aria-label="Close settings"><IconClose /></button>
          </div>
          <div className="starvis-field">
            <label htmlFor="starvis-provider">API Provider</label>
            <select id="starvis-provider" value={provider} onChange={event => selectProvider(event.target.value)}>
              <option value="openai">OpenAI</option>
              <option value="claude">Claude</option>
              <option value="llama">Llama Studio</option>
              <option value="copilot">Copilot</option>
            </select>
          </div>
          <div className="starvis-field">
            <label htmlFor="starvis-key">API Key</label>
            <div className="starvis-config-row">
              <input
                id="starvis-key"
                type="password"
                value={apiKeyDraft}
                onChange={event => setApiKeyDraft(event.target.value)}
                placeholder={backendStatus.keySource ? `Using ${backendStatus.keySource} key` : 'sk-...'}
              />
              <button className="starvis-text-btn" type="button" onClick={saveBackendConfig}>Save</button>
            </div>
            <div className="starvis-hint">{configMessage || (backendStatus.configured ? `Backend configured via ${backendStatus.keySource || 'OpenAI key'}.` : 'Saved in Electron, never sent from the browser UI to OpenAI directly.')}</div>
          </div>
          <div className="starvis-field">
            <label htmlFor="starvis-model">Model</label>
            <select id="starvis-model" value={model} onChange={event => setModel(event.target.value)}>
              {PROVIDERS[provider].map(option => <option key={option} value={option}>{option}</option>)}
            </select>
          </div>
          <div className="starvis-field">
            <div className="starvis-range-line">
              <label htmlFor="starvis-temperature">Temperature</label>
              <span>{model.startsWith('gpt-5') ? 'n/a' : temperature.toFixed(1)}</span>
            </div>
            <input
              id="starvis-temperature"
              type="range"
              min="0"
              max="2"
              step="0.1"
              value={temperature}
              disabled={model.startsWith('gpt-5')}
              onChange={event => setTemperature(parseFloat(event.target.value))}
            />
          </div>
          <div className="starvis-field">
            <div className="starvis-range-line"><label htmlFor="starvis-tokens">Max tokens</label><span>{maxTokens}</span></div>
            <input id="starvis-tokens" type="range" min="512" max="8192" step="128" value={maxTokens} onChange={event => setMaxTokens(parseInt(event.target.value, 10))} />
          </div>
          <div className="starvis-field">
            <label htmlFor="starvis-base-url">Custom base URL</label>
            <input id="starvis-base-url" value={baseUrl} onChange={event => setBaseUrl(event.target.value)} placeholder="https://api.openai.com/v1" />
          </div>
          <div className="starvis-field">
            <label htmlFor="starvis-voice-engine">Voice Engine</label>
            <select id="starvis-voice-engine" value={voiceEngine} onChange={event => setVoiceEngine(event.target.value)}>
              <option value="openai">OpenAI neural</option>
              <option value="system">Windows system</option>
            </select>
          </div>
          <div className="starvis-field">
            <label htmlFor="starvis-tts-model">Speech Model</label>
            <select id="starvis-tts-model" value={ttsModel} onChange={event => setTtsModel(event.target.value)}>
              <option value="gpt-4o-mini-tts">gpt-4o-mini-tts</option>
              <option value="gpt-4o-mini-tts-2025-12-15">gpt-4o-mini-tts-2025-12-15</option>
              <option value="tts-1-hd">tts-1-hd</option>
              <option value="tts-1">tts-1</option>
            </select>
          </div>
          <div className="starvis-field">
            <label htmlFor="starvis-tts-voice">Voice</label>
            <select id="starvis-tts-voice" value={ttsVoice} onChange={event => setTtsVoice(event.target.value)}>
              {['cedar', 'marin', 'onyx', 'echo', 'ash', 'ballad', 'verse', 'sage', 'alloy', 'coral', 'fable', 'nova', 'shimmer'].map(option => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </div>
          <div className="starvis-field">
            <div className="starvis-range-line"><label htmlFor="starvis-tts-speed">Speech speed</label><span>{ttsSpeed.toFixed(2)}</span></div>
            <input id="starvis-tts-speed" type="range" min="0.7" max="1.2" step="0.01" value={ttsSpeed} onChange={event => setTtsSpeed(parseFloat(event.target.value))} />
          </div>
          <div className="starvis-field">
            <label htmlFor="starvis-tts-instructions">Voice direction</label>
            <input id="starvis-tts-instructions" value={ttsInstructions} onChange={event => setTtsInstructions(event.target.value)} />
          </div>
          <label className="starvis-check" htmlFor="starvis-internet">
            <input id="starvis-internet" type="checkbox" checked={allowInternet} onChange={event => setAllowInternet(event.target.checked)} />
            Always allow web search for Starvis replies
          </label>
          <div className="starvis-hint">Voice preferences save automatically. Click Save after changing chat model, token limit, base URL, or key.</div>
          <div className="starvis-hint">Local card reports use a contained widget context API. If this is off, Starvis asks before fetching live web data.</div>
          <div className="starvis-hint">OpenAI mode uses medium reasoning effort, the average setting. Temperature is omitted for GPT-5 models.</div>
          <div className="starvis-hint">OpenAI neural voice uses the Audio Speech API and falls back to Windows system speech if unavailable.</div>
          </div>
      )}

      <div className="starvis-orb-zone" aria-label="Starvis holographic metrics">
        <div className="starvis-ring one" />
        <div className="starvis-ring two" />
        <div className="starvis-ring three" />
        <div className={`starvis-orb${typing || listening ? ' is-speaking' : ''}`}>S</div>
        <Metric className="m1" label="Load" value={`${Math.round(metrics.load)}%`} />
        <Metric className="m2" label="Temp" value={metrics.temp.toFixed(1)} />
        <Metric className="m3" label="Tokens" value={`${metrics.tokens.toFixed(1)}K`} />
        <Metric className="m4" label="Latency" value={`${Math.round(metrics.latency)}`} />
      </div>

      <div className="starvis-readout">
        {displayText}
        <span className="starvis-cursor" />
      </div>

      {voiceOn && (
        <div className="starvis-voice-state">
          {voiceStatus === 'neural'
            ? `voice ${voicePlayback.model || ttsModel} ${voicePlayback.voice || ttsVoice}`
            : voiceStatus === 'fallback'
              ? `voice fallback ${voicePlayback.voice || ttsVoice}${voicePlayback.error ? `: ${voicePlayback.error.slice(0, 60)}` : ''}`
              : voiceEngine === 'openai'
                ? `voice ${ttsModel} ${ttsVoice}`
                : 'voice system'}
        </div>
      )}

      {pendingInternetRequest && (
        <div className="starvis-permission">
          <div className="starvis-permission-text">{pendingInternetRequest.reason || 'May I fetch live data from the web for this request?'}</div>
          <div className="starvis-permission-actions">
            <button className="starvis-permission-btn" type="button" onClick={allowInternetOnce}>Allow once</button>
            <button className="starvis-permission-btn is-quiet" type="button" onClick={denyInternetOnce}>Local only</button>
          </div>
        </div>
      )}

      <div className="starvis-history" aria-label="Session history">
        {messages.slice(-4).map((message, index) => (
          <div key={`${message.role}-${index}-${message.text}`} className={`starvis-log${message.role === 'user' ? ' is-user' : ''}`}>
            <span className="starvis-role">{message.role === 'user' ? 'You' : 'Starvis'}</span>
            <span className="starvis-log-text">{message.text}</span>
          </div>
        ))}
      </div>

      <div className="starvis-input-row">
        <input
          className="starvis-input"
          value={draft}
          onChange={event => setDraft(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter') sendMessage();
          }}
          placeholder={mode === 'agent' ? 'Ask for a plan, diagnosis, or gated agent task...' : mode === 'briefing' ? 'Press enter for a fresh systems report...' : 'Ask Starvis anything...'}
        />
        <button className="starvis-send" type="button" onClick={sendMessage} title="Send command" aria-label="Send command"><IconSend /></button>
      </div>
    </div>
  );

  return {
    color: '#62e6ff',
    title: 'Starvis',
    sub: provider === 'openai' ? 'GPT-5.5 AVG' : provider.toUpperCase(),
    badge: <span style={{ fontSize: 9, color: '#53f0c5', fontFamily: 'DM Mono,monospace' }}>{backendStatus.configured ? 'LIVE' : 'SETUP'}</span>,
    content,
    shellProps: {
      stableBackground: true,
      softText: false,
    },
  };
}

function Metric({ className, label, value }) {
  return (
    <div className={`starvis-metric ${className}`}>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function IconMic() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 14.5a3.5 3.5 0 0 0 3.5-3.5V6a3.5 3.5 0 0 0-7 0v5a3.5 3.5 0 0 0 3.5 3.5Z" stroke="currentColor" strokeWidth="1.8" /><path d="M5.5 10.5a6.5 6.5 0 0 0 13 0M12 17v3.5M8.5 20.5h7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>;
}

function IconVolume() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 9.5v5h4l5 4.5V5L8 9.5H4Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /><path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>;
}

function IconVolumeOff() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 9.5v5h4l5 4.5V5L8 9.5H4Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /><path d="m17 9 4 4m0-4-4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>;
}

function IconStop() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.9" /></svg>;
}

function IconSettings() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4Z" stroke="currentColor" strokeWidth="1.8" /><path d="m19 13.4 1.2.9-1.8 3.1-1.5-.6a7 7 0 0 1-1.7 1l-.2 1.6H9l-.2-1.6a7 7 0 0 1-1.7-1l-1.5.6-1.8-3.1 1.2-.9a7.6 7.6 0 0 1 0-2.8l-1.2-.9 1.8-3.1 1.5.6a7 7 0 0 1 1.7-1L9 4.6h6l.2 1.6a7 7 0 0 1 1.7 1l1.5-.6 1.8 3.1-1.2.9a7.6 7.6 0 0 1 0 2.8Z" stroke="currentColor" strokeWidth="1.45" strokeLinejoin="round" /></svg>;
}

function IconClose() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m6.5 6.5 11 11m0-11-11 11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>;
}

function IconSend() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 12 20 4l-4.2 16-3.2-6.6L4 12Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /><path d="m12.6 13.4 3.2-3.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>;
}

function usageToTokens(usage, fallback) {
  const total = Number(usage?.total_tokens || 0);
  if (!Number.isFinite(total) || total <= 0) return fallback;
  return Math.max(0.1, Math.round((total / 1000) * 10) / 10);
}

function prepareSpeechText(text) {
  return String(text || '')
    .replace(/^Backend notice:\s*/i, 'A quick backend note: ')
    .replace(/```[\s\S]*?```/g, ' I have included a code block on screen. ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*]\([^)]+\)/g, ' ')
    .replace(/\[([^\]]+)]\((https?:\/\/[^)]+)\)/g, '$1')
    .replace(/https?:\/\/\S+/g, ' link available on screen ')
    .replace(/^[ \t]*#{1,6}[ \t]*/gm, '')
    .replace(/(^|\s)#([A-Za-z0-9_]+)/g, '$1$2')
    .replace(/^[ \t]*[-*+]\s+/gm, '')
    .replace(/^[ \t]*\d+[.)]\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/[_~]{1,2}/g, '')
    .replace(/[{}[\]<>|\\]/g, ' ')
    .replace(/[`*_#]/g, '')
    .replace(/\b(\d{1,2}):00\s*([AP])\.?M\.?\s*(ET|EST|EDT|CT|CST|CDT|MT|MST|MDT|PT|PST|PDT)\b/gi, (_match, hour, meridiem, zone) => {
      return `${Number(hour)} ${meridiem.toUpperCase()}M ${spokenTimeZone(zone)}`;
    })
    .replace(/\b(\d{1,2}):([0-5]\d)\s*([AP])\.?M\.?\s*(ET|EST|EDT|CT|CST|CDT|MT|MST|MDT|PT|PST|PDT)\b/gi, (_match, hour, minute, meridiem, zone) => {
      return `${Number(hour)} ${minute === '30' ? 'thirty' : minute} ${meridiem.toUpperCase()}M ${spokenTimeZone(zone)}`;
    })
    .replace(/\b(\d{1,2})\s*([AP])\.?M\.?\s*(ET|EST|EDT|CT|CST|CDT|MT|MST|MDT|PT|PST|PDT)\b/gi, (_match, hour, meridiem, zone) => {
      return `${Number(hour)} ${meridiem.toUpperCase()}M ${spokenTimeZone(zone)}`;
    })
    .replace(/\bGPT[-\s]?5\.5\b/gi, 'GPT five point five')
    .replace(/\bGPT[-\s]?5\.4\b/gi, 'GPT five point four')
    .replace(/\bAPI\b/g, 'A P I')
    .replace(/\bCPU\b/g, 'C P U')
    .replace(/\bGPU\b/g, 'G P U')
    .replace(/\bRAM\b/g, 'memory')
    .replace(/\bURL\b/g, 'link')
    .replace(/(\d+(?:\.\d+)?)%/g, '$1 percent')
    .replace(/(\d+(?:\.\d+)?)\s*ms\b/gi, '$1 milliseconds')
    .replace(/\s+[–—-]\s+/g, ', ')
    .replace(/:\s+/g, ': ')
    .replace(/\s+([.,!?;:])/g, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{2,}/g, '. ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 760);
}

function spokenTimeZone(zone = '') {
  const normalized = String(zone).toUpperCase();
  if (['ET', 'EST', 'EDT'].includes(normalized)) return 'Eastern time';
  if (['CT', 'CST', 'CDT'].includes(normalized)) return 'Central time';
  if (['MT', 'MST', 'MDT'].includes(normalized)) return 'Mountain time';
  if (['PT', 'PST', 'PDT'].includes(normalized)) return 'Pacific time';
  return normalized.split('').join(' ');
}

function splitSpeechText(text) {
  const normalized = String(text || '')
    .replace(/\s*;\s*/g, '. ')
    .replace(/\s*:\s*/g, ': ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return [];

  const sentences = normalized.match(/[^.!?]+[.!?]?/g) || [normalized];
  const chunks = [];
  for (const sentence of sentences) {
    const clean = sentence.trim();
    if (!clean) continue;
    if (clean.length <= 170) {
      chunks.push(clean);
      continue;
    }
    const phrases = clean.split(/,\s+/);
    let current = '';
    for (const phrase of phrases) {
      const next = current ? `${current}, ${phrase}` : phrase;
      if (next.length > 155 && current) {
        chunks.push(current);
        current = phrase;
      } else {
        current = next;
      }
    }
    if (current) chunks.push(current);
  }
  return chunks.slice(0, 8);
}

function selectJarvisVoice(voices) {
  if (!voices?.length) return null;
  const ranked = voices.map(voice => {
    const haystack = `${voice.name} ${voice.lang} ${voice.voiceURI}`.toLowerCase();
    let score = 0;
    if (/natural|neural|online/.test(haystack)) score += 10;
    if (/en[-_](gb|uk)/.test(haystack)) score += 8;
    if (/en[-_]us/.test(haystack)) score += 4;
    if (/english/.test(haystack)) score += 3;
    if (/male|guy|man|masculine/.test(haystack)) score += 7;
    if (/george|ryan|james|daniel|oliver|arthur|william|thomas|andrew|brian|guy/.test(haystack)) score += 7;
    if (/david|mark/.test(haystack)) score += 2;
    if (/aria|jenny|zira|hazel|susan|samantha|female|woman/.test(haystack)) score -= 8;
    if (/desktop|legacy/.test(haystack)) score -= 3;
    if (/microsoft/.test(haystack)) score += 2;
    return { voice, score };
  }).sort((a, b) => b.score - a.score);
  return ranked[0]?.voice || voices[0];
}

function settle(current, target) {
  return Math.round((current + (target - current) * 0.34) * 10) / 10;
}
