import { useCallback, useEffect, useRef, useState } from 'react';
import { DEFAULT_EURONEWS_HEIGHT, EURONEWS_HLS_URL, MIN_EURONEWS_HEIGHT } from './euronews.constants.js';
import { loadEuronewsHeight, loadHlsJs, saveEuronewsHeight } from './euronews.service.js';

export default function EuronewsWidget({ expanded = true } = {}) {
  const [cardHeight, setCardHeight] = useState(DEFAULT_EURONEWS_HEIGHT);
  const [errMsg, setErrMsg] = useState('');
  const [muted, setMuted] = useState(true);
  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const stallRef = useRef({ time: 0, since: Date.now() });

  useEffect(() => {
    let alive = true;
    loadEuronewsHeight().then((height) => {
      if (alive) setCardHeight(height);
    });
    return () => { alive = false; };
  }, []);

  const attachStream = useCallback(() => {
    const video = videoRef.current;
    if (!video || !window.Hls) return;
    const Hls = window.Hls;

    if (hlsRef.current) {
      try { hlsRef.current.destroy(); } catch {}
      hlsRef.current = null;
    }

    const hls = new Hls({ lowLatencyMode: true });
    hlsRef.current = hls;
    hls.attachMedia(video);
    hls.on(Hls.Events.MEDIA_ATTACHED, () => {
      hls.loadSource(EURONEWS_HLS_URL);
    });
    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      video.play().catch(() => {});
      setErrMsg('');
    });
    hls.on(Hls.Events.ERROR, (_event, data) => {
      if (!data.fatal) return;
      console.error('[euronews] fatal hls error', data);
      setErrMsg((data.type || 'error') + ': ' + (data.details || ''));
      if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
        try { hls.startLoad(); } catch {}
      } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
        try { hls.recoverMediaError(); } catch {}
      } else {
        setTimeout(() => attachStream(), 2000);
      }
    });
    stallRef.current = { time: video.currentTime, since: Date.now() };
  }, []);

  useEffect(() => {
    if (!expanded) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const video = videoRef.current;
        if (!video) return;
        const Hls = await loadHlsJs();
        if (cancelled) return;
        if (!Hls?.isSupported?.()) {
          if (video.canPlayType('application/vnd.apple.mpegurl')) {
            video.src = EURONEWS_HLS_URL;
            video.play().catch(() => {});
            setErrMsg('');
            return;
          }
          setErrMsg('HLS not supported');
          return;
        }
        attachStream();
      } catch (error) {
        if (cancelled) return;
        console.error('[euronews]', error);
        setErrMsg(error.message || String(error));
      }
    })();
    return () => {
      cancelled = true;
      if (hlsRef.current) {
        try { hlsRef.current.destroy(); } catch {}
        hlsRef.current = null;
      }
    };
  }, [attachStream, expanded]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const timer = setInterval(() => {
      if (!expanded) return;
      if (video.paused || video.ended) return;
      const now = Date.now();
      if (video.currentTime !== stallRef.current.time) {
        stallRef.current = { time: video.currentTime, since: now };
        return;
      }
      if (now - stallRef.current.since > 15000) {
        console.warn('[euronews] stalled > 15s, reloading stream');
        stallRef.current.since = now;
        attachStream();
      }
    }, 3000);
    return () => clearInterval(timer);
  }, [attachStream, expanded]);

  const onResizeMouseDown = (event) => {
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = cardHeight;
    let currentHeight = startHeight;
    const onMove = (moveEvent) => {
      currentHeight = Math.max(MIN_EURONEWS_HEIGHT, startHeight + (moveEvent.clientY - startY));
      setCardHeight(currentHeight);
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      saveEuronewsHeight(currentHeight);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const toggleMute = (event) => {
    event?.stopPropagation?.();
    const video = videoRef.current;
    if (!video) return;
    const next = !video.muted;
    video.muted = next;
    setMuted(next);
    if (!next && video.paused) video.play().catch(() => {});
  };

  const toggleFullscreen = () => {
    const video = videoRef.current;
    if (!video) return;
    if (document.fullscreenElement) {
      document.exitFullscreen?.();
    } else {
      video.requestFullscreen?.();
    }
  };

  return {
    color: '#1e4ba8',
    title: 'Euronews',
    sub: 'Live',
    badge: (
      <button onClick={(event) => { event.stopPropagation(); attachStream(); }} title="Reload stream" style={iconButtonStyle}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
          <path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z" />
        </svg>
      </button>
    ),
    content: (
      <div>
        <div style={{ position: 'relative' }}>
          <video
            ref={videoRef}
            muted
            autoPlay
            playsInline
            onDoubleClick={toggleFullscreen}
            title="Double-click for fullscreen"
            style={{
              width: '100%',
              height: cardHeight,
              display: 'block',
              borderRadius: 6,
              background: '#000',
              objectFit: 'cover',
              cursor: 'pointer',
            }}
          />
          <button onClick={toggleMute} title={muted ? 'Enable sound' : 'Mute'} style={muteButtonStyle}>
            {muted ? <MutedIcon /> : <SoundIcon />}
          </button>
        </div>
        {errMsg && <div style={{ fontSize: 10, color: '#ef5350', marginTop: 4 }}>{errMsg}</div>}
        <div onMouseDown={onResizeMouseDown} style={resizeHandleStyle}>
          <div style={{ width: 28, height: 2, borderRadius: 1, background: 'rgba(255,255,255,0.1)' }} />
        </div>
      </div>
    ),
  };
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

const iconButtonStyle = {
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  color: '#c4c4d4',
  padding: 2,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const muteButtonStyle = {
  position: 'absolute',
  bottom: 8,
  right: 8,
  width: 30,
  height: 30,
  borderRadius: '50%',
  border: 'none',
  background: 'rgba(0,0,0,0.55)',
  color: '#fff',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 0,
  backdropFilter: 'blur(4px)',
};

const resizeHandleStyle = {
  height: 6,
  marginTop: 2,
  marginLeft: -14,
  marginRight: -14,
  cursor: 'ns-resize',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  userSelect: 'none',
};
