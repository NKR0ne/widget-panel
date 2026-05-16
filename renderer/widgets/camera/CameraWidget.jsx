import { useCallback, useEffect, useRef, useState } from 'react';
import { SK_CAMERA_AUTH, SK_CAMERA_HEIGHT, SK_CAMERA_ID } from '../../config/storageKeys.js';
import { C } from '../../ui/theme.js';
import { api } from '../../services/electronApi.js';

const CAMERA_BASE_URL    = "https://securitycenter.local:8082";
const CAMERA_SDK_URL     = `${CAMERA_BASE_URL}/XPMobileSDK/XPMobileSDK.js`;
const CAMERA_ID          = "11ae9771-dcc4-430b-b47c-20caa6175566";
const CAMERA_NAME_HINT   = "HikVision";  // substring of the desired camera name
const LOGIN_AUTO         = 'auto';
const LOGIN_DEFAULT      = 'default';
const CAMERA_LOGIN_TYPES = [
  { value: LOGIN_AUTO, label: 'Auto' },
  { value: 'Windows', label: 'Windows / AD' },
  { value: 'Basic', label: 'Basic' },
  { value: LOGIN_DEFAULT, label: 'SDK default' },
];

function loginAttemptsFor(preferredType) {
  if (preferredType && preferredType !== LOGIN_AUTO) return [preferredType];
  return ['Windows', 'Basic', LOGIN_DEFAULT];
}

function loginTypeLabel(type) {
  return CAMERA_LOGIN_TYPES.find(t => t.value === type)?.label || type || 'SDK default';
}

function isInvalidCredentialsError(error) {
  return String(error?.message || error || '').includes('"code":15');
}

// Camera widget - direct XPMobileSDK integration. Credentials are stored in
// SK_CAMERA_AUTH for subsequent sessions.
function CameraWidget() {
  const [cardHeight, setCardHeight] = useState(300);
  const [status, setStatus] = useState('init');   // 'init' | 'login' | 'connecting' | 'streaming' | 'error'
  const [errMsg, setErrMsg] = useState('');
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [loginType, setLoginType] = useState(LOGIN_AUTO);
  const imgRef = useRef(null);
  const streamRef = useRef(null);
  const lastBlobUrlRef = useRef(null);
  const lastFrameAtRef = useRef(0);
  const watchdogRef = useRef(null);
  const reconnectTimerRef = useRef(null);
  const credsRef = useRef({ u: '', p: '', loginType: LOGIN_AUTO });
  const pendingFrameRef = useRef(null);   // buffers a frame that arrives before <img> mounts
  const debugObsRef = useRef(null);       // holds the diagnostic observer so reconnect can remove it
  const STALE_FRAME_MS = 30000;       // no frame for 30s → reconnect
  const RECONNECT_DELAY_MS = 5000;    // backoff before reconnect attempt

  useEffect(() => {
    api.store.get(SK_CAMERA_HEIGHT).then(v => {
      const h = parseInt(v || '0');
      if (h >= 150) setCardHeight(h);
    });
  }, []);

  // Frame handler — replaces the <img> src and revokes the previous blob URL.
  // XPMobileSDK's VideoHeaderParser delivers frames as objects with .blob
  // (the JPEG payload). Older paths may give a raw Blob/ArrayBuffer/string.
  const onFrame = useCallback((frame) => {
    lastFrameAtRef.current = Date.now();
    let url;
    if (frame instanceof Blob) {
      url = URL.createObjectURL(frame);
    } else if (frame?.blob instanceof Blob) {
      url = URL.createObjectURL(frame.blob);
    } else if (typeof frame?.imageURL === 'string') {
      url = frame.imageURL;
    } else if (frame instanceof ArrayBuffer) {
      url = URL.createObjectURL(new Blob([frame], { type: 'image/jpeg' }));
    } else if (frame?.data instanceof ArrayBuffer || ArrayBuffer.isView(frame?.data)) {
      url = URL.createObjectURL(new Blob([frame.data], { type: 'image/jpeg' }));
    } else if (typeof frame === 'string') {
      url = frame;
    } else {
      console.warn('[camera] unexpected frame type', frame);
      return;
    }
    // If <img> isn't mounted yet (status switched to streaming this tick but
    // React hasn't committed), buffer the frame for when it appears.
    if (!imgRef.current) {
      pendingFrameRef.current = url;
      return;
    }
    imgRef.current.src = url;
    if (lastBlobUrlRef.current && lastBlobUrlRef.current.startsWith('blob:')) {
      try { URL.revokeObjectURL(lastBlobUrlRef.current); } catch {}
    }
    lastBlobUrlRef.current = url;
  }, []);

  // Drain the pending frame once <img> mounts (status === 'streaming').
  useEffect(() => {
    if (status !== 'streaming' || !imgRef.current || !pendingFrameRef.current) return;
    imgRef.current.src = pendingFrameRef.current;
    lastBlobUrlRef.current = pendingFrameRef.current;
    pendingFrameRef.current = null;
  }, [status]);

  // Schedule a reconnect using the stored credentials. Coalesces multiple
  // triggers (lost-connection event + stale-frame watchdog) into a single
  // attempt with a small backoff.
  function scheduleReconnect() {
    if (reconnectTimerRef.current) return;
    reconnectTimerRef.current = setTimeout(async () => {
      reconnectTimerRef.current = null;
      const { u, p, loginType: savedLoginType } = credsRef.current;
      if (!u || !p) { console.warn('[camera] no creds for reconnect'); return; }
      console.log('[camera] reconnecting…');
      try {
        if (streamRef.current) { try { streamRef.current.close(); } catch {} streamRef.current = null; }
        await connectAndStream(u, p, savedLoginType || LOGIN_AUTO);
      } catch (e) {
        console.error('[camera] reconnect failed', e);
        scheduleReconnect(); // try again
      }
    }, RECONNECT_DELAY_MS);
  }

  // Watchdog — if the last frame is older than STALE_FRAME_MS while we're in
  // the streaming state, the upstream stopped (camera/equipment reset). Drop
  // the dead stream and reconnect.
  useEffect(() => {
    if (status !== 'streaming') return;
    lastFrameAtRef.current = Date.now();
    watchdogRef.current = setInterval(() => {
      if (Date.now() - lastFrameAtRef.current > STALE_FRAME_MS) {
        console.warn('[camera] no frames for', STALE_FRAME_MS, 'ms — reconnecting');
        clearInterval(watchdogRef.current); watchdogRef.current = null;
        scheduleReconnect();
      }
    }, 5000);
    return () => { if (watchdogRef.current) { clearInterval(watchdogRef.current); watchdogRef.current = null; } };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  async function loadSdk() {
    // MobileServerURL must be set BEFORE the SDK script runs its initialize().
    // Connection.js does `self.server = XPMobileSDKSettings.MobileServerURL ||
    // window.location.origin` once during init and caches it. If we set the
    // URL afterward, every XHR goes to localhost:5173 (or wherever the panel
    // is loaded from) and fails with "Invalid URL".
    window.XPMobileSDKSettings = window.XPMobileSDKSettings || {};
    window.XPMobileSDKSettings.MobileServerURL = CAMERA_BASE_URL;

    if (!window.XPMobileSDK) {
      await new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = CAMERA_SDK_URL;
        s.async = true;
        s.onload  = () => resolve();
        s.onerror = () => reject(new Error('SDK script load failed: ' + CAMERA_SDK_URL));
        document.head.appendChild(s);
      });
    }
    // Belt-and-suspenders: re-apply in case the SDK's own defaults overwrote it.
    window.XPMobileSDKSettings.MobileServerURL = CAMERA_BASE_URL;

    if (window.XPMobileSDK.isLoaded?.()) return;
    await new Promise((resolve) => {
      const prev = window.XPMobileSDK.onLoad;
      window.XPMobileSDK.onLoad = function () {
        try { prev && prev(); } catch {}
        resolve();
      };
    });
  }

  // Bridge an observer-pattern SDK method to a Promise. Resolves on the first
  // success-event method, rejects on the first error-event method or timeout.
  function eventToPromise(sdk, successNames, errorNames, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      const obs = {};
      let timer;
      const cleanup = () => { try { sdk.removeObserver(obs); } catch {} clearTimeout(timer); };
      timer = setTimeout(() => { cleanup(); reject(new Error('Timeout waiting for ' + successNames.join('/'))); }, timeoutMs);
      successNames.forEach(name => {
        obs[name] = (...args) => { console.log('[camera obs]', name, args); cleanup(); resolve(args[0]); };
      });
      errorNames.forEach(name => {
        obs[name] = (...args) => {
          console.error('[camera obs]', name, args);
          cleanup();
          const payload = JSON.stringify(args[0] || {});
          const server = window.XPMobileSDK?.library?.Connection?.server || CAMERA_BASE_URL;
          reject(new Error(`${name}: ${payload} (server: ${server})`));
        };
      });
      sdk.addObserver(obs);
    });
  }

  async function connectAndStream(username, password, preferredLoginType = loginType) {
    setStatus('connecting'); setErrMsg('');
    try {
      await loadSdk();
      const sdk = window.XPMobileSDK;

      // ── Cleanup any prior session before a fresh connect ────────────────
      // Without this, a reconnect attempt stacks a new login on top of the old
      // session, which the Mobile Server rejects with SecurityError on
      // subsequent commands.
      if (streamRef.current) {
        try { streamRef.current.close(); } catch {}
        streamRef.current = null;
      }
      if (lastBlobUrlRef.current && lastBlobUrlRef.current.startsWith('blob:')) {
        try { URL.revokeObjectURL(lastBlobUrlRef.current); } catch {}
        lastBlobUrlRef.current = null;
      }
      if (debugObsRef.current) {
        try { sdk.removeObserver(debugObsRef.current); } catch {}
        debugObsRef.current = null;
      }
      if (sdk.library?.Connection?.connectionId) {
        try { sdk.disconnect?.(); } catch (e) { console.warn('[camera] disconnect failed', e); }
      }
      if (sdk.library?.VideoConnectionPool) {
        try { sdk.library.VideoConnectionPool.pool = {}; } catch {}
      }

      // Belt-and-suspenders: force the Connection's cached server URL even if
      // settings.MobileServerURL got overwritten by the SDK's defaults during
      // its own var-redeclaration.
      window.XPMobileSDKSettings.MobileServerURL = CAMERA_BASE_URL;
      if (sdk.library?.Connection) sdk.library.Connection.server = CAMERA_BASE_URL;
      console.log('[camera] Connection.server =', sdk.library?.Connection?.server);
      console.log('[camera] settings.MobileServerURL =', window.XPMobileSDKSettings.MobileServerURL);

      // Stop the auto-RequestChallenges loop (server rejects with error 23)
      // without breaking login itself. Login uses DH (separate from CHAP);
      // only the auto-refresh observer needs to be neutered.
      if (sdk.requestChallenges) sdk.requestChallenges = () => {};
      if (window.XPMobileSDK?.requestChallenges) window.XPMobileSDK.requestChallenges = () => {};

      // Diagnostic observer — names taken straight from
      // XPMobileSDK.interfaces.ConnectionObserver in the SDK source.
      // Also include request-level events so we see when post-login commands
      // (RequestStream, LiveMessage, etc.) succeed or fail.
      const debugObs = {};
      [
        'connectionStateChanged',
        'connectionDidConnect','connectionFailedToConnect',
        'connectionDidConnectWithId','connectionFailedToConnectWithId',
        'connectionRequiresCode','connectionCodeError',
        'connectionDidLogIn','connectionFailedToLogIn',
        'connectionLostConnection','connectionProcessingDisconnect','connectionDidDisconnect',
        'connectionRequestSucceeded','connectionRequestFailed',
        'connectionVideoStreamStarted','connectionVideoStreamFailed','connectionVideoStreamEnded',
      ].forEach(n => debugObs[n] = (...a) => console.log('[camera evt]', n, a));
      sdk.addObserver(debugObs);
      debugObsRef.current = debugObs;

      // Auto-reconnect on lost connection (overnight equipment resets, etc).
      const reconnectObs = {
        connectionLostConnection: () => {
          console.warn('[camera] connection lost — scheduling reconnect');
          scheduleReconnect();
        },
      };
      sdk.addObserver(reconnectObs);

      // ── Connect ──────────────────────────────────────────────────────────
      const connectP = eventToPromise(sdk, ['connectionDidConnect'], ['connectionFailedToConnect']);
      console.log('[camera] sdk.connect(', CAMERA_BASE_URL, ')');
      sdk.connect(CAMERA_BASE_URL);
      await connectP;
      console.log('[camera] connected');

      // ── Login (positional args!) ─────────────────────────────────────────
      // loginType: 'Windows' — 'Basic' was rejected with InvalidCredentials,
      // and the default (undefined) authenticated but the resulting session
      // had zero rights (every subsequent command returned SecurityError 19).
      // The user can log in successfully through the Web Client UI, so the
      // account is most likely a Windows/AD user.
      let acceptedLoginType = null;
      let lastLoginError = null;
      const attempts = loginAttemptsFor(preferredLoginType);

      for (const attemptType of attempts) {
        if (lastLoginError) {
          try { sdk.disconnect?.(); } catch (error) { console.warn('[camera] disconnect before login retry failed', error); }
          if (sdk.library?.Connection) {
            sdk.library.Connection.connectionId = null;
            sdk.library.Connection.server = CAMERA_BASE_URL;
          }
          const retryConnectP = eventToPromise(sdk, ['connectionDidConnect'], ['connectionFailedToConnect']);
          console.log('[camera] reconnect for login type', loginTypeLabel(attemptType));
          sdk.connect(CAMERA_BASE_URL);
          await retryConnectP;
        }

        const loginP = eventToPromise(sdk, ['connectionDidLogIn'], ['connectionFailedToLogIn'], 30000);
        const label = loginTypeLabel(attemptType);
        console.log('[camera] sdk.login(username, password,', label, ')');
        if (attemptType === LOGIN_DEFAULT) sdk.login(username, password);
        else sdk.login(username, password, attemptType);

        try {
          await loginP;
          acceptedLoginType = attemptType;
          console.log('[camera] logged in with', label);
          break;
        } catch (error) {
          lastLoginError = error;
          console.warn('[camera] login failed with', label, error);
          if (preferredLoginType !== LOGIN_AUTO || !isInvalidCredentialsError(error)) throw error;
        }
      }

      if (!acceptedLoginType) {
        throw lastLoginError || new Error('Camera login failed');
      }

      await api.store.set(SK_CAMERA_AUTH, JSON.stringify({ u: username, p: password, loginType: acceptedLoginType }));
      credsRef.current = { u: username, p: password, loginType: acceptedLoginType };
      setLoginType(acceptedLoginType);

      // ── Discover cameras the account actually has access to ─────────────
      // The hardcoded GUID hit SecurityError 19 (insufficient rights). Picking
      // from getAllCameras gives us a GUID we know is accessible.
      console.log('[camera] sdk.getAllCameras()');
      const cameras = await new Promise((resolve, reject) => {
        sdk.getAllCameras(
          (cams) => resolve(cams),
          (err)  => reject(new Error('getAllCameras failed: ' + JSON.stringify(err)))
        );
      });
      console.log('[camera] cameras', cameras);
      const savedCamId = await api.store.get(SK_CAMERA_ID);
      const camList = Array.isArray(cameras) ? cameras : (cameras?.items || cameras?.cameras || []);
      // GetItems returns a hierarchy (groups → sub-groups → cameras). Recurse
      // and keep only Type==='Camera' leaves so we don't pick a group GUID.
      const flatten = (items, acc = []) => {
        for (const it of items || []) {
          if (it && it.Type === 'Camera' && it.Id) acc.push(it);
          if (Array.isArray(it?.Items)) flatten(it.Items, acc);
        }
        return acc;
      };
      const allCams = flatten(camList);
      console.log('[camera] flat list (', allCams.length, ' cameras)', allCams);
      // Pick the camera by name match first — different accounts have rights
      // to different cameras, and allCams[0] often picks one we can't stream
      // (which manifests as SecurityError 19 on requestStream). Match the
      // configured CAMERA_NAME_HINT (case-insensitive substring) before
      // falling back to ID/index.
      const nameMatch = (c) =>
        CAMERA_NAME_HINT && (c.Name || '').toLowerCase().includes(CAMERA_NAME_HINT.toLowerCase());
      const pick = allCams.find(c => c.Id === savedCamId)
                || allCams.find(nameMatch)
                || allCams.find(c => c.Id === CAMERA_ID)
                || allCams[0];
      if (!pick) throw new Error('No cameras available to this account (flatten found 0 of type=Camera)');
      const camId = pick.Id;
      console.log('[camera] using camera', pick.Name || camId, camId);
      await api.store.set(SK_CAMERA_ID, camId);

      // ── RequestStream in Pull mode ──────────────────────────────────────
      // The high-level sdk.requestStream() forces MethodType:'Push' which
      // opens wss://.../XProtectMobile/Video/<id>/ — that handshake fails
      // with HTTP 400 on this server. Use the low-level sdk.RequestStream
      // with MethodType:'Pull' so the SDK routes via PullConnection (AJAX)
      // instead of PushConnection (WebSocket).
      console.log('[camera] sdk.RequestStream Pull(', camId, pick.Name, ')');
      const videoStream = await new Promise((resolve, reject) => {
        sdk.RequestStream(
          {
            CameraId: camId,
            DestWidth: 800,
            DestHeight: 450,
            SignalType: 'Live',
            MethodType: 'Pull',
            Fps: 10,
            ComprLevel: 70,
            KeyFramesOnly: 'No',
            RequestSize: 'Yes',
            StreamType: 'Transcoded',
          },
          (vs)  => resolve(vs),
          (err) => reject(new Error('RequestStream failed: ' + JSON.stringify(err)))
        );
      });
      console.log('[camera] VideoStream from SDK', videoStream);
      if (!videoStream) throw new Error('RequestStream succeeded with null VideoStream');

      // ── The trap we just escaped ─────────────────────────────────────────
      // sdk.RequestStream's success callback returns an `XPMobileSDK.library`
      // VideoStream (the NEW class, defined in Lib/VideoStream.js). That class
      // wraps a <video-connection> custom element which ALWAYS opens a
      // WebSocket — regardless of MethodType. So calling videoStream.open()
      // here with our MethodType:'Pull' params would still try wss:// and
      // fail with HTTP 400 → black card.
      //
      // Workaround: there's an OLDER class XPMobileSDK.library.VideoConnection
      // (Lib/VideoConnection.js) that honors `request.parameters.MethodType`
      // and internally constructs a PullConnection (AJAX) for 'Pull'. We
      // extract the SDK-prepared request/response from the returned VideoStream
      // and feed it to VideoConnection manually. Do NOT call open() on the
      // discarded VideoStream — that would still kick off a WebSocket.
      const VC = sdk.library?.VideoConnection;
      if (typeof VC !== 'function') {
        throw new Error('XPMobileSDK.library.VideoConnection unavailable on this SDK build');
      }
      const fakeReq = {
        params:   videoStream.request?.parameters,
        options:  videoStream.request?.options,
        response: { outputParameters: videoStream.response?.parameters },
      };
      console.log('[camera] reconstructing VideoConnection from', fakeReq);
      const videoConnection = new VC(videoStream.videoId, fakeReq);
      console.log('[camera] VideoConnection', videoConnection,
        'isPush=', videoConnection.isPush);

      const vcObs = {
        videoConnectionReceivedFrame: (frame) => {
          // Only log frame metadata, not the binary blob itself.
          if (lastFrameAtRef.current === 0) {
            console.log('[camera vc] first frame', {
              hasBlob: !!frame?.blob,
              blobSize: frame?.blob?.size,
              keys: frame && Object.keys(frame),
            });
          }
          onFrame(frame);
        },
        videoConnectionFailed:           (...a) => console.error('[camera vc] failed', a),
        videoConnectionTemporaryDown:    (...a) => console.warn('[camera vc] temporaryDown', a),
        videoConnectionRecovered:        (...a) => console.log('[camera vc] recovered', a),
        videoConnectionChangedState:     (...a) => console.log('[camera vc] stateChanged', a),
        videoConnectionStreamingError:   (...a) => console.error('[camera vc] streamingError', a),
      };
      videoConnection.addObserver(vcObs);
      streamRef.current = videoConnection;
      setStatus('streaming');
      // Wait one animation frame so React commits the streaming-state render
      // (the <img> element) before frames start arriving.
      await new Promise(resolve => requestAnimationFrame(resolve));
      console.log('[camera] videoConnection.open()');
      videoConnection.open();

      // First-frame watchdog: if the stream opens but no frames arrive within
      // 8 seconds, dump the live state so we can see whether the channel is
      // running, closed, or stuck.
      const t0 = Date.now();
      setTimeout(() => {
        if (lastFrameAtRef.current >= t0) return;
        console.warn('[camera] no frames within 8s of open()');
        try {
          console.warn('[camera] post-open VC state', {
            videoId: videoConnection?.videoId,
            cameraId: videoConnection?.cameraId,
            isPush: videoConnection?.isPush,
            communication: videoConnection?.communication?.constructor?.name,
          });
        } catch (e) { console.warn('[camera] post-open inspect failed', e); }
      }, 8000);
    } catch (e) {
      console.error('[camera] error', e);
      setErrMsg(String(e?.message || e));
      // SDK error code 15 = InvalidCredentials. Clear the stored creds so the
      // login form shows blank inputs instead of auto-retrying bad creds.
      const msg = String(e?.message || '');
      if (msg.includes('"code":15')) {
        await api.store.delete(SK_CAMERA_AUTH);
        setUser(''); setPass('');
      }
      setStatus('login');
    }
  }

  // Auto-attempt login if credentials are stored.
  useEffect(() => {
    api.store.get(SK_CAMERA_AUTH).then(saved => {
      if (saved) {
        try {
          const c = JSON.parse(saved);
          if (c.u && c.p) {
            const savedLoginType = c.loginType || LOGIN_AUTO;
            setUser(c.u); setPass(c.p);
            setLoginType(savedLoginType);
            credsRef.current = { u: c.u, p: c.p, loginType: savedLoginType };
            connectAndStream(c.u, c.p, savedLoginType);
            return;
          }
        } catch {}
      }
      setStatus('login');
    });
    // Cleanup the stream on unmount.
    return () => {
      if (streamRef.current) { try { streamRef.current.close(); } catch {} streamRef.current = null; }
      if (lastBlobUrlRef.current && lastBlobUrlRef.current.startsWith('blob:')) {
        try { URL.revokeObjectURL(lastBlobUrlRef.current); } catch {}
      }
    };
  }, []);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!user || !pass) return;
    connectAndStream(user, pass, loginType);
  };

  const handleLogout = async () => {
    if (streamRef.current) { try { streamRef.current.close(); } catch {} streamRef.current = null; }
    await api.store.delete(SK_CAMERA_AUTH);
    setUser(''); setPass(''); setLoginType(LOGIN_AUTO); setStatus('login'); setErrMsg('');
  };

  const onResizeMouseDown = (e) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = cardHeight;
    let cur = startH;
    const onMove = (ev) => {
      cur = Math.max(150, startH + (ev.clientY - startY));
      setCardHeight(cur);
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      api.store.set(SK_CAMERA_HEIGHT, String(cur));
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  let body;
  if (status === 'init' || status === 'connecting') {
    body = <div style={{height:cardHeight,display:'flex',alignItems:'center',justifyContent:'center',color:'#888',fontSize:11,background:'#000',borderRadius:6}}>
      {status === 'connecting' ? 'Connexion…' : 'Initialisation…'}
    </div>;
  } else if (status === 'login') {
    body = (
      <form onSubmit={handleSubmit} style={{display:'flex',flexDirection:'column',gap:8,padding:'8px 0'}}>
        <input value={user} onChange={e=>setUser(e.target.value)}
               placeholder="Username" autoComplete="username" style={{...C.inp}} />
        <input type="password" value={pass} onChange={e=>setPass(e.target.value)}
               placeholder="Password" autoComplete="current-password" style={{...C.inp}} />
        <select value={loginType} onChange={e=>setLoginType(e.target.value)} style={{...C.inp}}>
          {CAMERA_LOGIN_TYPES.map(type => (
            <option key={type.value} value={type.value} style={{background:'#18181c'}}>
              {type.label}
            </option>
          ))}
        </select>
        {errMsg && <div style={{fontSize:10,color:'#ef5350'}}>{errMsg}</div>}
        <button type="submit" style={{...C.btn}}>Connect</button>
      </form>
    );
  } else {
    body = <img ref={imgRef} alt="" style={{width:'100%',height:cardHeight,display:'block',borderRadius:6,background:'#000',objectFit:'cover'}} />;
  }

  const logoutBtn = streamRef.current
    ? <button onClick={e=>{ e.stopPropagation(); handleLogout(); }}
        title="Sign out"
        style={{background:"none",border:"none",color:"#444",fontSize:10,cursor:"pointer",padding:"0 2px",lineHeight:1}}>×</button>
    : null;

  return { color:"#5e8af5", title:"Caméra", badge: logoutBtn,
    content:(
      <div>
        {body}
        <div onMouseDown={onResizeMouseDown}
          style={{height:6,marginTop:2,marginLeft:-14,marginRight:-14,cursor:'ns-resize',
            display:'flex',alignItems:'center',justifyContent:'center',userSelect:'none'}}>
          <div style={{width:28,height:2,borderRadius:1,background:'rgba(255,255,255,0.1)'}}/>
        </div>
      </div>
    )
  };
}

export default CameraWidget;
