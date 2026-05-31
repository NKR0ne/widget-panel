import { useEffect, useRef, useState } from 'react';
import { api } from '../../services/electronApi.js';
import { EURONEWS_HLS_URL } from '../euronews/euronews.constants.js';
import { loadHlsJs } from '../euronews/euronews.service.js';

const LIVE_ASPECT = '16 / 9';
const LIVE_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const YOUTUBE_EMBEDDER_ORIGIN = 'https://widget-panel.local';
let liveAudioOwnerId = '';
const liveAudioOwnerListeners = new Set();
const liveAudioMountCounts = new Map();

function liveLog(...args) {
  try { api.log?.('[live]', ...args.map(value => typeof value === 'string' ? value : JSON.stringify(value))); } catch {}
  try { console.log('[live]', ...args); } catch {}
}

function setLiveAudioOwnerId(nextOwnerId = '') {
  const cleanOwnerId = nextOwnerId || '';
  if (liveAudioOwnerId === cleanOwnerId) return;
  liveAudioOwnerId = cleanOwnerId;
  liveAudioOwnerListeners.forEach(listener => listener(liveAudioOwnerId));
}

export function useLiveAudioOwner(feedId = '') {
  const [ownerId, setOwnerId] = useState(liveAudioOwnerId);

  useEffect(() => {
    const listener = nextOwnerId => setOwnerId(nextOwnerId);
    liveAudioOwnerListeners.add(listener);
    return () => liveAudioOwnerListeners.delete(listener);
  }, []);

  useEffect(() => {
    if (!feedId) return undefined;
    liveAudioMountCounts.set(feedId, (liveAudioMountCounts.get(feedId) || 0) + 1);
    return () => {
      const nextCount = Math.max(0, (liveAudioMountCounts.get(feedId) || 0) - 1);
      if (nextCount) liveAudioMountCounts.set(feedId, nextCount);
      else liveAudioMountCounts.delete(feedId);
    };
  }, [feedId]);

  return [ownerId, setLiveAudioOwnerId];
}

function youtubeWatch(id) {
  return `https://www.youtube.com/watch?v=${id}`;
}

function extractYouTubeVideoId(input = '') {
  try {
    const url = new URL(input);
    const host = url.hostname.replace(/^www\./i, '').toLowerCase();
    if (host === 'youtu.be') return url.pathname.split('/').filter(Boolean)[0] || '';
    if (host === 'youtube.com' || host.endsWith('.youtube.com')) {
      if (url.searchParams.get('v')) return url.searchParams.get('v');
      const parts = url.pathname.split('/').filter(Boolean);
      const marker = parts.findIndex(part => ['embed', 'live', 'shorts'].includes(part));
      if (marker >= 0 && parts[marker + 1]) return parts[marker + 1];
    }
  } catch {}
  const match = String(input).match(/(?:v=|youtu\.be\/|embed\/|live\/)([A-Za-z0-9_-]{6,})/i);
  return match?.[1] || '';
}

function youtubeEmbed(input = '') {
  const id = extractYouTubeVideoId(input);
  if (!id) return input;
  const commandOrigin = /^https?:\/\//i.test(window.location?.origin || '') ? window.location.origin : '';
  const params = new URLSearchParams({
    autoplay: '1',
    mute: '1',
    controls: '0',
    playsinline: '1',
    rel: '0',
    modestbranding: '1',
    iv_load_policy: '3',
    disablekb: '1',
    fs: '0',
    enablejsapi: '1',
    widget_referrer: `${YOUTUBE_EMBEDDER_ORIGIN}/`,
  });
  if (commandOrigin) params.set('origin', commandOrigin);
  return `https://www.youtube.com/embed/${encodeURIComponent(id)}?${params}`;
}

export const YOUTUBE_PLAYER_CSS = `
  ytd-app, ytd-page-manager, ytd-watch-flexy, ytd-watch-flexy #primary,
  #primary, #primary-inner, #columns, #content, #page-manager {
    transform:none!important; filter:none!important;
    perspective:none!important; contain:none!important;
    will-change:auto!important; clip-path:none!important;
    overflow:visible!important;
  }
  ytd-masthead, #masthead-container, #masthead,
  ytd-mini-guide-renderer, tp-yt-app-drawer, ytd-guide-renderer,
  #secondary, #related, #comments, #chat, #chat-container,
  ytd-watch-metadata, #below, #info, #info-contents, #meta, #meta-contents,
  #top-row, #bottom-row, #description, #description-inline-expander,
  ytd-merch-shelf-renderer, ytd-popup-container, ytd-toast,
  ytd-engagement-panel-section-list-renderer,
  ytd-live-chat-frame, .ytp-pause-overlay, .ytp-ce-element, .ytp-endscreen-content,
  ytd-watch-next-secondary-results-renderer,
  ytd-comments, ytd-comments-header-renderer,
  ytd-promoted-sparkles-web-renderer,
  ytd-banner-promo-renderer,
  ytd-mealbar-promo-renderer,
  ytd-consent-bump-v2-lightbox { display:none!important; }
  html, body, ytd-app, ytd-page-manager, ytd-watch-flexy, #primary, #primary-inner {
    background:#000!important; overflow:hidden!important;
    margin:0!important; padding:0!important;
    width:100vw!important; height:100vh!important;
    max-width:none!important; max-height:none!important;
  }
  #player, #player-container, #player-container-outer, #player-container-inner,
  #player-theater-container, #player-full-bleed-container,
  #player.ytd-watch-flexy, #player-wide-container,
  ytd-player, .html5-video-player, #movie_player {
    position:fixed!important; top:0!important; left:0!important;
    right:0!important; bottom:0!important;
    width:100vw!important; height:100vh!important;
    max-width:none!important; max-height:none!important;
    min-width:0!important; min-height:0!important;
    z-index:2147483647!important; background:#000!important;
    transform:none!important;
  }
  .html5-video-container {
    width:100%!important; height:100%!important;
  }
  video.html5-main-video, video {
    width:100%!important; height:100%!important;
    object-fit:contain!important; background:#000!important;
  }
`;

export const YOUTUBE_PLAYER_DIAG_JS = `
  (function () {
    setTimeout(function () {
      var v = document.querySelector('video');
      var p = document.querySelector('#player');
      var pcs = p && getComputedStyle(p);
      var vcs = v && getComputedStyle(v);
      console.log('[wp-live-yt] diag: video=' + !!v +
        ' #player=' + !!p +
        (p ? ' playerDisplay=' + pcs.display + ' playerPosition=' + pcs.position : '') +
        (v ? ' videoDisplay=' + vcs.display + ' videoSize=' +
            Math.round(v.getBoundingClientRect().width) + 'x' +
            Math.round(v.getBoundingClientRect().height) +
            ' videoReady=' + v.readyState +
            ' videoPaused=' + v.paused : ''));
    }, 5000);
  })();
`;

export const YOUTUBE_PLAYER_LAYOUT_JS = `
  (() => {
    function forceRect(el, fixed) {
      if (!el || !el.style) return;
      el.style.setProperty('position', fixed ? 'fixed' : 'absolute', 'important');
      el.style.setProperty('top', '0', 'important');
      el.style.setProperty('left', '0', 'important');
      el.style.setProperty('right', 'auto', 'important');
      el.style.setProperty('bottom', 'auto', 'important');
      el.style.setProperty('width', '100vw', 'important');
      el.style.setProperty('height', '100vh', 'important');
      el.style.setProperty('min-width', '0', 'important');
      el.style.setProperty('min-height', '0', 'important');
      el.style.setProperty('max-width', 'none', 'important');
      el.style.setProperty('max-height', 'none', 'important');
      el.style.setProperty('margin', '0', 'important');
      el.style.setProperty('padding', '0', 'important');
      el.style.setProperty('transform', 'none', 'important');
      el.style.setProperty('translate', 'none', 'important');
      el.style.setProperty('scale', 'none', 'important');
      el.style.setProperty('background', '#000', 'important');
      el.style.setProperty('overflow', 'hidden', 'important');
    }

    function apply() {
      const rootSelectors = [
        'html', 'body', 'ytd-app', 'ytd-page-manager', 'ytd-watch-flexy',
        '#primary', '#primary-inner', '#columns', '#content', '#page-manager'
      ];
      for (const selector of rootSelectors) {
        for (const el of document.querySelectorAll(selector)) forceRect(el, false);
      }

      const playerSelectors = [
        '#player', '#player-container', '#player-container-outer', '#player-container-inner',
        '#player-theater-container', '#player-full-bleed-container',
        '#player.ytd-watch-flexy', '#player-wide-container',
        'ytd-player', '.html5-video-player', '#movie_player'
      ];
      for (const selector of playerSelectors) {
        for (const el of document.querySelectorAll(selector)) {
          forceRect(el, true);
          el.style.setProperty('z-index', '2147483646', 'important');
        }
      }

      for (const el of document.querySelectorAll('.html5-video-container, .video-stream.html5-main-video')) {
        forceRect(el, true);
        el.style.setProperty('z-index', '2147483647', 'important');
      }

      for (const video of document.querySelectorAll('video.html5-main-video, video')) {
        forceRect(video, true);
        video.style.setProperty('z-index', '2147483647', 'important');
        video.style.setProperty('object-fit', 'contain', 'important');
        video.style.setProperty('display', 'block', 'important');
      }
    }

    if (!window.__wpLiveYouTubeLayoutInstalled) {
      window.__wpLiveYouTubeLayoutInstalled = true;
      window.__wpLiveYouTubeLayout = apply;
      window.addEventListener('resize', apply, { passive: true });
      new MutationObserver(() => requestAnimationFrame(apply))
        .observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'] });
      setInterval(apply, 700);
    }

    apply();
    requestAnimationFrame(apply);
    setTimeout(apply, 120);
    setTimeout(apply, 500);
    setTimeout(apply, 1400);
  })();
`;

export const LIVE_FEEDS = [
  {
    id: 'live-bloomberg',
    title: 'Bloomberg Live',
    source: 'YouTube',
    url: youtubeWatch('iEpJwprxDdk'),
    embedUrl: youtubeWatch('iEpJwprxDdk'),
    partition: 'persist:bloomberg',
    youtube: true,
  },
  {
    id: 'live-radio-canada',
    title: 'Radio-Canada.info',
    source: 'YouTube',
    url: youtubeWatch('oacvZh5Rmcg'),
    embedUrl: youtubeWatch('oacvZh5Rmcg'),
    partition: 'persist:live-radio-canada',
    youtube: true,
  },
  {
    id: 'live-france24',
    title: 'France 24',
    source: 'YouTube',
    url: youtubeWatch('HvZt-nh9sGg'),
    embedUrl: youtubeWatch('HvZt-nh9sGg'),
    partition: 'persist:live-france24',
    youtube: true,
  },
  {
    id: 'live-cbc-news',
    title: 'CBC News',
    source: 'YouTube',
    url: youtubeWatch('5vfaDsMhCF4'),
    embedUrl: youtubeWatch('5vfaDsMhCF4'),
    partition: 'persist:live-cbc',
    youtube: true,
  },
  {
    id: 'live-lcn',
    title: 'LCN',
    source: 'Teleon',
    url: 'https://tvalive.akamaized.net/hls/live/2014213/tvan01/tvan01.m3u8',
    embedUrl: 'https://tvalive.akamaized.net/hls/live/2014213/tvan01/tvan01.m3u8',
    partition: 'persist:live-lcn',
    referrer: 'https://player.teleon.tv/',
    hls: true,
  },
  {
    id: 'euronews',
    title: 'Euronews',
    source: 'HLS',
    url: EURONEWS_HLS_URL,
    embedUrl: EURONEWS_HLS_URL,
    partition: 'persist:live-euronews',
    hls: true,
  },
];

export const LIVE_FEED_IDS = LIVE_FEEDS.map(feed => feed.id);

export function getLiveFeed(id) {
  return LIVE_FEEDS.find(feed => feed.id === id) || null;
}

function OpenIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M7 17 17 7" />
      <path d="M9 7h8v8" />
    </svg>
  );
}

function applyWebviewAudioState(webview, muted) {
  if (!webview) return;
  try { webview.setAudioMuted?.(!!muted); } catch {}
  try {
    webview.executeJavaScript(`
      (() => {
        const muted = ${muted ? 'true' : 'false'};
        for (const media of document.querySelectorAll('video,audio')) {
          media.muted = muted;
          media.volume = muted ? 0 : Math.max(media.volume || 0, 0.72);
          media.play && media.play().catch(() => {});
        }
      })();
    `, true);
  } catch {}
}

function scheduleAudioSync(apply, delays = [0, 160, 450, 1000, 2200, 4200]) {
  const timers = delays.map(delay => setTimeout(() => {
    try { apply(); } catch {}
  }, delay));
  return () => timers.forEach(timer => clearTimeout(timer));
}

function applyVideoAudioState(video, muted) {
  if (!video) return;
  video.muted = !!muted;
  video.volume = muted ? 0 : Math.max(video.volume || 0, 0.72);
  if (!muted) video.play?.().catch(() => {});
}

export function LiveHlsTile({ src = EURONEWS_HLS_URL, muted, objectFit = 'cover', label = 'hls', onReady, onFatal }) {
  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const onReadyRef = useRef(onReady);
  const onFatalRef = useRef(onFatal);

  useEffect(() => {
    onReadyRef.current = onReady;
    onFatalRef.current = onFatal;
  }, [onReady, onFatal]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const video = videoRef.current;
      if (!video) return;
      const Hls = await loadHlsJs();
      if (cancelled || !video) return;
      if (Hls?.isSupported?.()) {
        const hls = new Hls({
          lowLatencyMode: true,
          backBufferLength: 30,
          manifestLoadingTimeOut: 12000,
          levelLoadingTimeOut: 12000,
          fragLoadingTimeOut: 16000,
        });
        hlsRef.current = hls;
        hls.attachMedia(video);
        hls.on(Hls.Events.MEDIA_ATTACHED, () => {
          liveLog('hls-media-attached', label);
          hls.loadSource(src);
        });
        hls.on(Hls.Events.MANIFEST_PARSED, (_event, data) => {
          liveLog('hls-manifest-parsed', label, `levels=${data?.levels?.length ?? '--'}`);
          video.play().then(() => onReadyRef.current?.()).catch(error => {
            liveLog('hls-play-rejected', label, error?.message || String(error));
          });
        });
        hls.on(Hls.Events.LEVEL_LOADED, (_event, data) => {
          liveLog('hls-level-loaded', label, `level=${data?.level ?? '--'}`, `live=${!!data?.details?.live}`);
        });
        hls.on(Hls.Events.ERROR, (_event, data) => {
          liveLog('hls-error', label, `type=${data?.type || '--'}`, `details=${data?.details || '--'}`, `fatal=${!!data?.fatal}`, data?.response?.code ? `code=${data.response.code}` : '');
          if (!data?.fatal) return;
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
            try { hls.startLoad(); } catch {}
          } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
            try { hls.recoverMediaError(); } catch {}
          } else {
            onFatalRef.current?.(data);
          }
        });
      } else {
        video.src = src;
        video.play().then(() => onReadyRef.current?.()).catch(error => {
          liveLog('native-hls-play-rejected', label, error?.message || String(error));
        });
      }
    })();
    return () => {
      cancelled = true;
      if (hlsRef.current) {
        try { hlsRef.current.destroy(); } catch {}
        hlsRef.current = null;
      }
    };
  }, [src, label]);

  useEffect(() => {
    return scheduleAudioSync(() => applyVideoAudioState(videoRef.current, muted));
  }, [muted]);

  return (
    <video
      ref={videoRef}
      muted={muted}
      autoPlay
      playsInline
      crossOrigin="anonymous"
      onLoadedData={() => onReadyRef.current?.()}
      onPlaying={() => onReadyRef.current?.()}
      style={{ width: '100%', height: '100%', display: 'block', objectFit, background: '#000' }}
    />
  );
}

function postYouTubeCommand(iframe, func, args = []) {
  try {
    const message = JSON.stringify({ event: 'command', func, args });
    iframe?.contentWindow?.postMessage(message, 'https://www.youtube.com');
    iframe?.contentWindow?.postMessage(message, '*');
  } catch {}
}

function applyYouTubeAudioState(iframe, muted) {
  if (!iframe) return;
  postYouTubeCommand(iframe, 'playVideo');
  postYouTubeCommand(iframe, muted ? 'mute' : 'unMute');
  if (!muted) postYouTubeCommand(iframe, 'setVolume', [72]);
}

export function LiveYouTubeEmbedTile({ feed, muted, iframeRef: externalIframeRef, onReady }) {
  const iframeRef = useRef(null);
  const src = youtubeEmbed(feed.embedUrl || feed.url);
  const setIframeRef = (node) => {
    iframeRef.current = node;
    if (externalIframeRef) externalIframeRef.current = node;
  };

  useEffect(() => {
    return scheduleAudioSync(() => applyYouTubeAudioState(iframeRef.current, muted), [0, 180, 500, 1100, 2400, 4800, 7200]);
  }, [muted]);

  const handleLoad = () => {
    scheduleAudioSync(() => applyYouTubeAudioState(iframeRef.current, muted), [0, 250, 800, 1600, 3200, 5600]);
    onReady?.();
  };

  return (
    <iframe
      ref={setIframeRef}
      src={src}
      title={feed.title}
      allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
      allowFullScreen={false}
      referrerPolicy="strict-origin-when-cross-origin"
      onLoad={handleLoad}
      style={{ width: '100%', height: '100%', display: 'block', border: 0, background: '#000' }}
    />
  );
}

function LiveFeedTile({ feed, onOpenWebContent, showHeader = true, allowWebviewFallback = true }) {
  const webviewRef = useRef(null);
  const youtubeIframeRef = useRef(null);
  const mutedRef = useRef(true);
  const revealTimerRef = useRef(null);
  const hlsResolveTimerRef = useRef(null);
  const hlsPlaybackTimerRef = useRef(null);
  const revealedRef = useRef(false);
  const [loading, setLoading] = useState(true);
  const [audioOwnerId, setAudioOwnerId] = useLiveAudioOwner(feed.id);
  const [resolvedHlsUrl, setResolvedHlsUrl] = useState(feed.hls ? feed.embedUrl : '');
  const [hlsFailed, setHlsFailed] = useState(false);
  const muted = audioOwnerId !== feed.id;

  const openZoomCard = (event) => {
    event?.stopPropagation?.();
    onOpenWebContent?.({
      url: feed.embedUrl || feed.url,
      title: feed.title,
      source: feed.source,
      partition: feed.partition,
      referrer: feed.referrer,
      userAgent: LIVE_USER_AGENT,
      flavor: 'live',
      hlsUrl: nativeHlsUrl || undefined,
      hls: feed.hls,
      youtube: feed.youtube,
      liveFeed: feed,
    }, event);
  };

  useEffect(() => {
    let cancelled = false;
    if (hlsResolveTimerRef.current) clearTimeout(hlsResolveTimerRef.current);
    setHlsFailed(false);
    setResolvedHlsUrl(feed.hls ? feed.embedUrl : '');
    if (feed.hls || feed.youtube) return () => { cancelled = true; };

    setLoading(true);
    liveLog('hls-resolve-start', feed.id, feed.title, feed.url);
    hlsResolveTimerRef.current = setTimeout(() => {
      if (cancelled) return;
      liveLog('hls-resolve-timeout', feed.id);
      setResolvedHlsUrl('');
      setHlsFailed(true);
      setLoading(false);
    }, 9000);
    const resolveHls = api.live?.hls || (feed.youtube ? api.live?.youtubeHls : null);
    if (!resolveHls) {
      liveLog('hls-resolve-api-missing', feed.id);
      setHlsFailed(true);
      setLoading(false);
      return () => { cancelled = true; };
    }
    resolveHls(api.live?.hls ? feed : feed.url).then(result => {
      if (cancelled) return;
      if (hlsResolveTimerRef.current) clearTimeout(hlsResolveTimerRef.current);
      if (result?.ok && result.hlsUrl) {
        liveLog('hls-resolve-ok', feed.id, `provider=${result.provider || '--'}`, `videoId=${result.videoId || '--'}`, `status=${result.playerStatus || '--'}`);
        setResolvedHlsUrl(result.hlsUrl);
      } else {
        liveLog('hls-resolve-failed', feed.id, result?.error || result?.playerStatus || result);
        console.warn('[wp-live] HLS unavailable', feed.title, result?.error || result?.playerStatus || result);
        setHlsFailed(true);
        setLoading(false);
      }
    }).catch(error => {
      if (cancelled) return;
      if (hlsResolveTimerRef.current) clearTimeout(hlsResolveTimerRef.current);
      liveLog('hls-resolve-exception', feed.id, error?.message || String(error));
      console.warn('[wp-live] HLS resolve failed', feed.title, error);
      setHlsFailed(true);
      setLoading(false);
    });

    return () => {
      cancelled = true;
      if (hlsResolveTimerRef.current) clearTimeout(hlsResolveTimerRef.current);
    };
  }, [feed]);

  const nativeHlsUrl = feed.hls ? feed.embedUrl : (!feed.youtube && !hlsFailed ? resolvedHlsUrl : '');
  const waitingForNativeHls = !feed.hls && !feed.youtube && !nativeHlsUrl && !hlsFailed;
  const shouldUseWebview = allowWebviewFallback && !nativeHlsUrl && !waitingForNativeHls;

  useEffect(() => {
    if (hlsPlaybackTimerRef.current) clearTimeout(hlsPlaybackTimerRef.current);
    if (feed.hls || !nativeHlsUrl) return undefined;
    setLoading(true);
    liveLog('hls-playback-start', feed.id);
    hlsPlaybackTimerRef.current = setTimeout(() => {
      liveLog('hls-playback-timeout', feed.id);
      setResolvedHlsUrl('');
      setHlsFailed(true);
      setLoading(false);
    }, 16000);
    return () => {
      if (hlsPlaybackTimerRef.current) clearTimeout(hlsPlaybackTimerRef.current);
    };
  }, [feed.hls, feed.id, nativeHlsUrl]);

  useEffect(() => {
    mutedRef.current = muted;
    const wv = webviewRef.current;
    if (!allowWebviewFallback || !wv || feed.hls) return;
    return scheduleAudioSync(() => applyWebviewAudioState(wv, muted), [0, 200, 650, 1400, 3000, 5200]);
  }, [allowWebviewFallback, feed.hls, muted]);

  useEffect(() => {
    const wv = webviewRef.current;
    if (!allowWebviewFallback || !wv || feed.hls || nativeHlsUrl || waitingForNativeHls) return;
    revealedRef.current = false;
    setLoading(true);
    const clearRevealTimer = () => {
      if (revealTimerRef.current) {
        clearTimeout(revealTimerRef.current);
        revealTimerRef.current = null;
      }
    };
    const reveal = () => {
      clearRevealTimer();
      revealedRef.current = true;
      liveLog('webview-reveal', feed.id, wv.getURL?.() || feed.embedUrl);
      applyWebviewAudioState(wv, mutedRef.current);
      setLoading(false);
    };
    const start = () => {
      liveLog('webview-start-loading', feed.id, wv.getURL?.() || feed.embedUrl);
      applyWebviewAudioState(wv, mutedRef.current);
      if (revealedRef.current) return;
      setLoading(true);
      if (!revealTimerRef.current) revealTimerRef.current = setTimeout(reveal, 1400);
    };
    const enforceAudio = () => applyWebviewAudioState(wv, mutedRef.current);
    const onFail = event => liveLog('webview-fail-load', feed.id, event?.errorCode, event?.errorDescription, event?.validatedURL);
    const onConsole = event => {
      if (typeof event?.message !== 'string') return;
      if (/^\[(wp-live-yt|wp-yt|live)\]/i.test(event.message)) liveLog('webview-console', feed.id, event.message);
    };
    wv.addEventListener('did-start-loading', start);
    wv.addEventListener('dom-ready', reveal);
    wv.addEventListener('did-stop-loading', reveal);
    wv.addEventListener('did-finish-load', reveal);
    wv.addEventListener('did-fail-load', onFail);
    wv.addEventListener('did-navigate', enforceAudio);
    wv.addEventListener('did-navigate-in-page', enforceAudio);
    wv.addEventListener('media-started-playing', enforceAudio);
    wv.addEventListener('console-message', onConsole);
    start();
    return () => {
      clearRevealTimer();
      wv.removeEventListener('did-start-loading', start);
      wv.removeEventListener('dom-ready', reveal);
      wv.removeEventListener('did-stop-loading', reveal);
      wv.removeEventListener('did-finish-load', reveal);
      wv.removeEventListener('did-fail-load', onFail);
      wv.removeEventListener('did-navigate', enforceAudio);
      wv.removeEventListener('did-navigate-in-page', enforceAudio);
      wv.removeEventListener('media-started-playing', enforceAudio);
      wv.removeEventListener('console-message', onConsole);
    };
  }, [allowWebviewFallback, feed.hls, feed.embedUrl, feed.id, nativeHlsUrl, waitingForNativeHls]);

  useEffect(() => {
    const wv = webviewRef.current;
    if (!allowWebviewFallback || !wv || !feed.youtube || nativeHlsUrl || waitingForNativeHls) return;
    const apply = () => {
      liveLog('youtube-legacy-css-apply', feed.id);
      try { wv.insertCSS(YOUTUBE_PLAYER_CSS); } catch {}
    };
    const onReady = () => {
      apply();
      liveLog('youtube-legacy-ready', feed.id, wv.getURL?.() || feed.embedUrl);
      try { wv.executeJavaScript(YOUTUBE_PLAYER_DIAG_JS, true); } catch {}
      setTimeout(apply, 120);
      setTimeout(apply, 500);
      setTimeout(apply, 1500);
      setTimeout(apply, 4000);
      setTimeout(apply, 10000);
    };
    wv.addEventListener('dom-ready', onReady);
    wv.addEventListener('did-stop-loading', apply);
    wv.addEventListener('did-finish-load', apply);
    wv.addEventListener('did-navigate', apply);
    wv.addEventListener('did-navigate-in-page', apply);
    wv.addEventListener('media-started-playing', apply);
    return () => {
      wv.removeEventListener('dom-ready', onReady);
      wv.removeEventListener('did-stop-loading', apply);
      wv.removeEventListener('did-finish-load', apply);
      wv.removeEventListener('did-navigate', apply);
      wv.removeEventListener('did-navigate-in-page', apply);
      wv.removeEventListener('media-started-playing', apply);
    };
  }, [allowWebviewFallback, feed.youtube, feed.embedUrl, feed.id, nativeHlsUrl, waitingForNativeHls]);

  useEffect(() => {
    return () => {
      if (hlsResolveTimerRef.current) clearTimeout(hlsResolveTimerRef.current);
      if (hlsPlaybackTimerRef.current) clearTimeout(hlsPlaybackTimerRef.current);
      if (revealTimerRef.current) clearTimeout(revealTimerRef.current);
      const wv = webviewRef.current;
      if (!wv) return;
      try { wv.stop?.(); } catch {}
      try { wv.loadURL?.('about:blank'); } catch {}
      try { wv.src = 'about:blank'; } catch {}
    };
  }, []);

  const toggleMute = (event) => {
    event.stopPropagation();
    const next = !muted;
    setAudioOwnerId(next ? '' : feed.id);
    if (feed.youtube) {
      liveLog('youtube-audio-toggle', feed.id, next ? 'muted' : 'sound');
      applyYouTubeAudioState(youtubeIframeRef.current, next);
      return;
    }
    const wv = webviewRef.current;
    if (!allowWebviewFallback || !wv || feed.hls) return;
    applyWebviewAudioState(wv, next);
    if (!next) {
      try {
        wv.executeJavaScript(`
          (() => {
            for (const video of document.querySelectorAll('video')) {
              video.muted = false;
              video.volume = Math.max(video.volume || 0, 0.72);
              video.play && video.play().catch(() => {});
            }
            const button = [...document.querySelectorAll('button')].find(el => /unmute|muted|activer le son|son/i.test(el.getAttribute('aria-label') || el.title || ''));
            if (button) button.click();
          })();
        `, true);
      } catch {}
    }
  };

  return (
    <div style={{
      minWidth: 0,
      minHeight: 0,
      width: '100%',
      height: '100%',
      borderRadius: 8,
      overflow: 'hidden',
      border: '1px solid rgba(238,248,255,0.44)',
      background: 'linear-gradient(145deg, rgba(8,14,28,0.40), rgba(3,7,16,0.34))',
      boxShadow: '0 0 0 1px rgba(31,111,255,0.16), 0 0 22px rgba(31,111,255,0.12), inset 0 1px 0 rgba(255,255,255,0.12)',
      display: 'flex',
      flexDirection: 'column',
      isolation: 'isolate',
      contain: 'paint',
    }}>
      {showHeader && <div style={{
        height: 34,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '0 8px',
        borderBottom: '1px solid rgba(238,248,255,0.13)',
        background: 'linear-gradient(180deg, rgba(31,111,255,0.13), rgba(2,7,16,0.08))',
      }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#1f6fff', boxShadow: '0 0 9px rgba(31,111,255,0.9)' }} />
        <span style={{ flex: 1, minWidth: 0, color: '#fff', fontSize: 11, letterSpacing: 0.35, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {feed.title}
        </span>
        <span style={{ color: 'rgba(247,250,255,0.58)', fontSize: 9, fontFamily: 'DM Mono,monospace' }}>{feed.source}</span>
        <button
          type="button"
          title="Open in zoom card"
          onClick={openZoomCard}
          style={tileIconButtonStyle}
        >
          <OpenIcon />
        </button>
      </div>}
      <div style={{ position: 'relative', flex: 1, minHeight: 0, background: '#000' }}>
        {loading && !feed.hls && (
          <div style={{
            position: 'absolute',
            inset: 0,
            display: 'grid',
            placeItems: 'center',
            color: 'rgba(247,250,255,0.62)',
            fontSize: 10,
            background: 'linear-gradient(180deg, rgba(0,0,0,0.34), transparent 54%)',
            zIndex: 1,
            pointerEvents: 'none',
          }}>
            <span style={{
              alignSelf: 'start',
              justifySelf: 'start',
              margin: 8,
              padding: '3px 7px',
              borderRadius: 999,
              border: '1px solid rgba(238,248,255,0.18)',
              background: 'rgba(0,0,0,0.34)',
              color: 'rgba(247,250,255,0.70)',
              fontFamily: 'DM Mono,monospace',
              fontSize: 8,
            }}>
              Loading
            </span>
          </div>
        )}
        {feed.youtube ? (
          <LiveYouTubeEmbedTile
            feed={feed}
            muted={muted}
            iframeRef={youtubeIframeRef}
            onReady={() => {
              liveLog('youtube-embed-ready', feed.id);
              setLoading(false);
            }}
          />
        ) : nativeHlsUrl ? (
          <LiveHlsTile
            src={nativeHlsUrl}
            muted={muted}
            objectFit="cover"
            label={feed.id}
            onReady={() => {
              if (hlsPlaybackTimerRef.current) clearTimeout(hlsPlaybackTimerRef.current);
              liveLog('hls-playback-ready', feed.id);
              setLoading(false);
            }}
            onFatal={() => {
              if (!feed.hls) {
                liveLog('hls-playback-fatal', feed.id);
                setResolvedHlsUrl('');
                setHlsFailed(true);
                setLoading(false);
              }
            }}
          />
        ) : waitingForNativeHls ? (
          <div style={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center', background: '#000', color: 'rgba(247,250,255,0.58)', fontSize: 10, fontFamily: 'DM Mono, monospace' }}>
            Resolving pure feed
          </div>
        ) : shouldUseWebview ? (
          <webview
            ref={webviewRef}
            src={feed.embedUrl}
            partition={feed.partition}
            httpreferrer={feed.referrer || undefined}
            useragent={LIVE_USER_AGENT}
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            allowpopups="true"
            webpreferences="contextIsolation=yes,nodeIntegration=no"
            onDidFinishLoad={() => setLoading(false)}
            onDomReady={() => setLoading(false)}
            style={{ width: '100%', height: '100%', display: 'block', background: '#000' }}
          />
        ) : (
          <LiveFeedOpenOnly feed={feed} onOpen={openZoomCard} />
        )}
        <button type="button" onClick={toggleMute} title={muted ? 'Enable sound' : 'Mute'} style={muteButtonStyle}>
          {muted ? <MutedIcon /> : <SoundIcon />}
        </button>
      </div>
    </div>
  );
}

export function LiveFeedWidget({ id, expanded = true, onOpenWebContent }) {
  const feed = getLiveFeed(id);
  if (!feed) return null;
  const zoomBadge = onOpenWebContent ? (
    <button
      type="button"
      title="Open in zoom card"
      onClick={(event) => {
        event.stopPropagation();
        onOpenWebContent({
          url: feed.embedUrl || feed.url,
          title: feed.title,
          source: feed.source,
          partition: feed.partition,
          referrer: feed.referrer,
          userAgent: LIVE_USER_AGENT,
          flavor: 'live',
          hls: feed.hls,
          youtube: feed.youtube,
          liveFeed: feed,
        }, event);
      }}
      style={{
        width: 19,
        height: 19,
        borderRadius: 5,
        border: '1px solid rgba(238,248,255,0.32)',
        background: 'rgba(31,111,255,0.12)',
        color: '#fff',
        cursor: 'pointer',
        padding: 0,
        lineHeight: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxShadow: '0 0 10px rgba(31,111,255,0.18)',
      }}
    >
      <OpenIcon />
    </button>
  ) : null;
  return {
    shell: 'acrylic',
    shellProps: { stableBackground: true },
    color: '#2f6dff',
    title: feed.title,
    sub: feed.source,
    badge: zoomBadge,
    content: expanded ? (
      <div style={{ width: '100%', aspectRatio: LIVE_ASPECT, minHeight: 0 }}>
        <LiveFeedTile feed={feed} onOpenWebContent={onOpenWebContent} showHeader={false} />
      </div>
    ) : null,
  };
}

export default function LiveFeedGrid({ onOpenWebContent }) {
  return (
    <div style={{
      flex: 1,
      minWidth: 0,
      minHeight: 0,
      padding: '0 10px 12px 6px',
      display: 'grid',
      gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
      gridAutoRows: 'auto',
      gap: 8,
      alignContent: 'start',
      overflow: 'auto',
    }}>
      {LIVE_FEEDS.map(feed => (
        <div key={feed.id} style={{ width: '100%', aspectRatio: LIVE_ASPECT, minWidth: 0 }}>
          <LiveFeedTile feed={feed} onOpenWebContent={onOpenWebContent} allowWebviewFallback={false} />
        </div>
      ))}
    </div>
  );
}

function LiveFeedOpenOnly({ feed, onOpen }) {
  return (
    <div style={{
      width: '100%',
      height: '100%',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexDirection: 'column',
      gap: 9,
      background: '#000',
      color: 'rgba(247,250,255,0.56)',
      fontSize: 10,
      fontFamily: 'DM Mono, monospace',
      textAlign: 'center',
      padding: 14,
    }}>
      <button type="button" onClick={onOpen} style={startButtonStyle}>
        Open feed
      </button>
      <span>{feed.source} pure feed unavailable</span>
    </div>
  );
}

function MutedIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z" />
    </svg>
  );
}

function SoundIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
    </svg>
  );
}

const muteButtonStyle = {
  position: 'absolute',
  bottom: 8,
  right: 8,
  width: 30,
  height: 30,
  borderRadius: '50%',
  border: '1px solid rgba(238,248,255,0.22)',
  background: 'rgba(0,0,0,0.58)',
  color: '#fff',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 0,
  backdropFilter: 'blur(4px)',
  boxShadow: '0 0 14px rgba(31,111,255,0.18)',
  zIndex: 2,
};

const tileIconButtonStyle = {
  width: 22,
  height: 22,
  borderRadius: 5,
  border: '1px solid rgba(238,248,255,0.34)',
  background: 'rgba(31,111,255,0.14)',
  color: '#fff',
  cursor: 'pointer',
  lineHeight: 1,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 0,
  boxShadow: '0 0 10px rgba(31,111,255,0.18)',
  padding: 0,
};

const startButtonStyle = {
  border: '1px solid rgba(238,248,255,0.30)',
  background: 'rgba(31,111,255,0.18)',
  color: '#fff',
  cursor: 'pointer',
  borderRadius: 6,
  padding: '6px 11px',
  fontSize: 10,
  fontFamily: 'DM Mono, monospace',
  boxShadow: '0 0 14px rgba(31,111,255,0.18)',
};
