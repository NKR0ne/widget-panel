import { useEffect, useRef, useState } from 'react';
import { C } from '../../ui/theme.js';
import { BLOOMBERG_LIVE_TAB, HEATMAP_TAB, MARKETS_OVERVIEW_LIST } from './stocks.constants.js';
import {
  fetchChart,
  fetchTradingViewWatchlists,
  getSavedCardHeight,
  getSavedListIndex,
  getStoredWidgetHeight,
  getTradingViewSession,
  getTradingViewUser,
  loginTradingView,
  logoutTradingView,
  openTradingViewChart,
  saveCardHeight,
  saveListIndex,
  saveStoredWidgetHeight,
  setModalOpen,
} from './stocks.service.js';

const STOCKS_SHELL = 'acrylic';

function VideoEmbed({ url, storeKey = 'wp-video-embed-height', isolate = false, partition = 'persist:bloomberg', defaultHeight = 320 }) {
  const wvRef = useRef(null);
  const [cardHeight, setCardHeight] = useState(defaultHeight);

  // Load persisted height.
  useEffect(() => {
    getStoredWidgetHeight(storeKey).then(h => {
      if (h >= 160) setCardHeight(h);
    });
  }, [storeKey]);

  const onResizeMouseDown = (e) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = cardHeight;
    let cur = startH;
    const onMove = (ev) => {
      cur = Math.max(160, startH + (ev.clientY - startY));
      setCardHeight(cur);
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      saveStoredWidgetHeight(storeKey, cur);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  useEffect(() => {
    const wv = wvRef.current;
    if (!wv || !isolate) return;

    // YouTube is a React SPA that re-renders aggressively. DOM-mutation
    // isolation fights React and ends up blinking-then-blanking. Targeted
    // CSS injection sidesteps the conflict because it doesn't touch the
    // DOM — React happily re-renders elements that are still display:none
    // because of our stylesheet.
    const isYouTube = /(^|\.)youtube\.com$/i.test(new URL(url).hostname);
    const youtubeCSS = `
      /* Neutralize containing-block triggers on YouTube's layout containers,
         otherwise our position:fixed on #player ends up relative to whichever
         transformed ancestor wraps it (which is animated -> black flash). */
      ytd-app, ytd-page-manager, ytd-watch-flexy, ytd-watch-flexy #primary,
      #primary, #primary-inner, #columns, #content, #page-manager {
        transform:none!important; filter:none!important;
        perspective:none!important; contain:none!important;
        will-change:auto!important; clip-path:none!important;
        overflow:visible!important;
      }
      /* Hide everything around the player. */
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
      /* Stretch every plausible player wrapper to viewport. Multiple
         selectors because YouTube swaps between layouts (theater, default,
         minimized) and class names change with A/B tests. */
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
      }
      .html5-video-container { width:100%!important; height:100%!important; }
      video.html5-main-video, video {
        width:100%!important; height:100%!important;
        object-fit:contain!important; background:#000!important;
      }
    `;
    // Diagnostic dump 5s after the page loads — if it stays black we can
    // tell why (no <video>, transformed ancestor, hidden #player, etc.).
    const diagJS = `
      (function () {
        setTimeout(function () {
          var v = document.querySelector('video');
          var p = document.querySelector('#player');
          var pcs = p && getComputedStyle(p);
          var vcs = v && getComputedStyle(v);
          console.log('[wp-yt] diag: video=' + !!v +
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
    if (isYouTube) {
      const apply = () => {
        try { wv.insertCSS(youtubeCSS); } catch {}
      };
      const onReady = () => {
        apply();
        try { wv.executeJavaScript(diagJS, true); } catch {}
        // Re-apply on a few delayed ticks — handles late-rendered states
        // (preroll ad finishes, layout flips, etc.).
        setTimeout(apply, 1500);
        setTimeout(apply, 4000);
        setTimeout(apply, 10000);
      };
      wv.addEventListener('dom-ready', onReady);
      wv.addEventListener('did-finish-load', apply);
      wv.addEventListener('did-navigate', apply);
      wv.addEventListener('did-navigate-in-page', apply);
      return () => {
        wv.removeEventListener('dom-ready', onReady);
        wv.removeEventListener('did-finish-load', apply);
        wv.removeEventListener('did-navigate', apply);
        wv.removeEventListener('did-navigate-in-page', apply);
      };
    }


    // Source of the page-side isolation script. Runs inside the webview's
    // origin via wv.executeJavaScript(). Two-phase: first wait for a <video>
    // to exist (handles cookie consent + lazy player init), then neutralize
    // ancestor transforms, hide elements outside the video's ancestor chain,
    // and fullscreen-fix the <video> itself.
    const isolateJS = `
      (function () {
        if (window.__wpIsolating) return;
        window.__wpIsolating = true;

        // Recursive querySelector that descends into open shadow roots AND
        // same-origin iframes.
        function deepQuery(sel, root) {
          root = root || document;
          var hit = root.querySelector ? root.querySelector(sel) : null;
          if (hit) return hit;
          var hosts = root.querySelectorAll ? root.querySelectorAll('*') : [];
          for (var i = 0; i < hosts.length; i++) {
            if (hosts[i].shadowRoot) {
              var deep = deepQuery(sel, hosts[i].shadowRoot);
              if (deep) return deep;
            }
            if (hosts[i].tagName === 'IFRAME') {
              try {
                var doc = hosts[i].contentDocument;
                if (doc) {
                  var ihit = deepQuery(sel, doc);
                  if (ihit) return ihit;
                }
              } catch (e) { /* cross-origin */ }
            }
          }
          return null;
        }

        // Returns the <video> element if reachable, OR the iframe whose
        // (cross-origin) content most likely hosts the player.
        function findVideoOrPlayerFrame() {
          var v = deepQuery('video');
          if (v) { console.log('[wp-bb] found <video>', v); return v; }
          // Cross-origin iframes — can't inspect, target the iframe wrapper.
          var iframes = document.querySelectorAll('iframe');
          var best = null, bestArea = 0;
          for (var i = 0; i < iframes.length; i++) {
            var r = iframes[i].getBoundingClientRect();
            var area = r.width * r.height;
            // Player iframes are video-shaped (>=240x140) and visible.
            if (area > bestArea && r.width >= 240 && r.height >= 140) {
              best = iframes[i]; bestArea = area;
            }
          }
          if (best) console.log('[wp-bb] no <video>, using iframe', best.src, bestArea);
          return best;
        }

        // Heuristic activator: Bloomberg shows a clickable poster image
        // ("Bloomberg Television" overlay) that turns into the live <video>
        // when clicked. Try a few candidates in order of specificity.
        function tryActivate() {
          var candidates = [
            'button[aria-label*="play" i]',
            'button[aria-label*="watch" i]',
            '[class*="WatchLive" i]',
            '[class*="watch-live" i]',
            '[class*="LiveThumb" i]',
            '[class*="VideoPoster" i]',
            '[class*="play-button" i]',
            '[data-component*="live" i]'
          ];
          for (var i = 0; i < candidates.length; i++) {
            var el = deepQuery(candidates[i]);
            if (el) {
              console.log('[wp-bb] activating via', candidates[i], el);
              try { el.click(); return true; } catch (e) { console.warn(e); }
            }
          }
          // Fallback: click the largest image/figure in the viewport — most
          // likely the live thumbnail.
          // Require a real video-shaped rect — the Bloomberg header logo is
          // ~200px wide but only ~30px tall, so filter on height too.
          var imgs = document.querySelectorAll('img, figure, [role="img"], [class*="Thumb" i], [class*="thumb" i]');
          var best = null, bestArea = 0;
          for (var j = 0; j < imgs.length; j++) {
            var r = imgs[j].getBoundingClientRect();
            var area = r.width * r.height;
            if (area > bestArea && r.width >= 240 && r.height >= 140 &&
                r.top >= 0 && r.top < 800) {
              best = imgs[j]; bestArea = area;
            }
          }
          if (best) {
            console.log('[wp-bb] fallback click on largest image', best, bestArea);
            try { best.click(); return true; } catch (e) { console.warn(e); }
          }
          return false;
        }

        var mo = null;
        var loggedOnce = false;
        function isolate() {
          var target = findVideoOrPlayerFrame();
          if (!target) return false;
          if (mo) try { mo.disconnect(); } catch (e) {}
          // 1. Clear transform/filter/perspective on every ancestor — those
          //    properties create a containing block that makes position:fixed
          //    relative to the ancestor instead of the viewport. Without
          //    this, fixing the video doesn't actually fullscreen it.
          var anc = target.parentElement;
          while (anc && anc !== document.documentElement) {
            anc.style.setProperty('transform',   'none', 'important');
            anc.style.setProperty('filter',      'none', 'important');
            anc.style.setProperty('perspective', 'none', 'important');
            anc.style.setProperty('contain',     'none', 'important');
            anc.style.setProperty('will-change', 'auto', 'important');
            anc.style.setProperty('clip-path',   'none', 'important');
            anc.style.setProperty('overflow',    'visible', 'important');
            anc = anc.parentElement;
          }
          // 2. Build a set of all of <video>'s ancestors so we can hide
          //    everything OUTSIDE that chain (top-down).
          var chain = new Set();
          var n = target;
          while (n) { chain.add(n); n = n.parentElement; }
          // 3. Recursively hide every element that isn't in the chain AND
          //    isn't a descendant of the chain (which keeps the video's
          //    controls and overlay visible).
          function hideOutside(parent) {
            Array.prototype.forEach.call(parent.children, function (child) {
              if (chain.has(child)) {
                hideOutside(child); // still in chain — recurse to hide its non-video siblings
              } else if (child !== target) {
                child.style.setProperty('display', 'none', 'important');
              }
            });
          }
          hideOutside(document.body);
          // 4. Fullscreen-fix the <video> element directly.
          if (target.tagName === 'VIDEO') {
            target.style.cssText = 'position:fixed!important;top:0!important;left:0!important;' +
              'right:0!important;bottom:0!important;width:100vw!important;height:100vh!important;' +
              'margin:0!important;padding:0!important;border:0!important;' +
              'object-fit:contain!important;background:#000!important;z-index:2147483647!important;';
            try { target.play && target.play(); } catch (e) {}
          } else if (target.tagName === 'IFRAME') {
            target.style.cssText = 'position:fixed!important;top:0!important;left:0!important;' +
              'right:0!important;bottom:0!important;width:100vw!important;height:100vh!important;' +
              'border:0!important;background:#000!important;z-index:2147483647!important;';
          }
          // 5. Lock document so the page beneath can't scroll.
          document.documentElement.style.cssText = 'margin:0;padding:0;overflow:hidden;background:#000;';
          document.body.style.cssText = 'margin:0;padding:0;overflow:hidden;background:#000;';
          if (mo) {
            try { mo.observe(document.body, { childList:true, subtree:true }); }
            catch (e) {}
          }
          if (!loggedOnce) {
            console.log('[wp-bb] isolated', target.tagName,
              'bodyChildren=' + document.body.children.length,
              'chainSize=' + chain.size);
            loggedOnce = true;
          }
          return true;
        }

        // Diagnostic dump 5s after script start — tells us if the player is
        // a <video>, an iframe (and from where), or something else entirely.
        setTimeout(function () {
          var ifs = document.querySelectorAll('iframe');
          console.log('[wp-bb] dump: location=' + location.href);
          console.log('[wp-bb] dump: <video> count=' + document.querySelectorAll('video').length);
          console.log('[wp-bb] dump: iframe count=' + ifs.length);
          for (var i = 0; i < ifs.length; i++) {
            var r = ifs[i].getBoundingClientRect();
            console.log('[wp-bb] dump iframe', i,
              (ifs[i].src || '(no src)').slice(0, 120),
              Math.round(r.width) + 'x' + Math.round(r.height));
          }
        }, 5000);

        if (isolate()) return;
        var tries = 0;
        var activated = false;
        var poll = setInterval(function () {
          tries++;
          if (isolate()) { clearInterval(poll); return; }
          // After 1.5s of no <video>, try to programmatically activate the
          // live player. Don't loop activations — one shot per poll cycle.
          if (!activated && tries === 3) {
            activated = tryActivate();
          }
          // After 6s, try activating again in case the first attempt missed.
          if (tries === 12) tryActivate();
          if (tries > 120) clearInterval(poll); // 60s ceiling
        }, 500);

        mo = new MutationObserver(function () { isolate(); });
        try { mo.observe(document.body, { childList:true, subtree:true }); } catch (e) {}
        // Belt-and-suspenders polling: every 2s, force a re-isolate in case
        // the MutationObserver missed a re-render or got disconnected by
        // Bloomberg replacing document.body.
        setInterval(function () { isolate(); }, 2000);
      })();
    `;

    const run = () => { try { wv.executeJavaScript(isolateJS, true); } catch {} };
    // Forward webview console messages so [wp-bb] logs surface in the panel's
    // own devtools instead of being trapped in the webview's separate one.
    const onConsole = (e) => {
      if (typeof e.message === 'string' && e.message.startsWith('[wp-bb]')) {
        console.log('[bloomberg webview]', e.message);
      }
    };
    wv.addEventListener('dom-ready', run);
    wv.addEventListener('did-finish-load', run);
    wv.addEventListener('did-navigate', run);
    wv.addEventListener('did-navigate-in-page', run);
    wv.addEventListener('console-message', onConsole);
    return () => {
      wv.removeEventListener('dom-ready', run);
      wv.removeEventListener('did-finish-load', run);
      wv.removeEventListener('did-navigate', run);
      wv.removeEventListener('did-navigate-in-page', run);
      wv.removeEventListener('console-message', onConsole);
    };
  }, []);

  return (
    <div>
      <div style={{width:'100%',height:cardHeight,borderRadius:8,
        overflow:'hidden',background:'#000',position:'relative'}}>
        <webview ref={wvRef} src={url}
          partition={partition}
          style={{width:'100%',height:'100%',display:'inline-flex'}}/>
      </div>
      <div onMouseDown={onResizeMouseDown}
        style={{height:6,marginTop:2,marginLeft:-14,marginRight:-14,cursor:'ns-resize',
          display:'flex',alignItems:'center',justifyContent:'center',userSelect:'none'}}>
        <div style={{width:28,height:2,borderRadius:1,background:'rgba(255,255,255,0.1)'}}/>
      </div>
    </div>
  );
}

export default function StocksWidget() {
  const [auth,      setAuth]      = useState(null); // null=loading, false=anon, {username}=ok
  const [lists,     setLists]     = useState([]);
  const [listIdx,   setListIdx]   = useState(0);
  const [quotes,    setQuotes]    = useState({});
  const [lastFetch, setLastFetch] = useState(null);
  const [err,       setErr]       = useState('');
  const [busy,      setBusy]      = useState(false);
  const [listHeight, setListHeight] = useState(380);

  useEffect(() => {
    (async () => {
      const session = await getTradingViewSession();
      if (session) {
        const r = await fetchTradingViewWatchlists();
        if (r.ok && r.data?.length) {
          setLists(r.data);
          setAuth({ username: await getTradingViewUser() || '' });
          const savedIdx = await getSavedListIndex();
          if (savedIdx > 0 && savedIdx < r.data.length) setListIdx(savedIdx);
        } else { setAuth(false); }
      } else { setAuth(false); }
      const savedH = await getSavedCardHeight();
      if (savedH >= 80) setListHeight(savedH);
    })();
  }, []);

  const onResizeMouseDown = (e) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = listHeight;
    let cur = startH;
    const onMove = (ev) => {
      cur = Math.max(80, startH + (ev.clientY - startY));
      setListHeight(cur);
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      saveCardHeight(cur);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  // Build the effective list set: prepend the built-in "Marchés" overview and
  // drop TV's default "Liste de surveillance" entry (the user's renamed lists
  // pass through unchanged).
  const effectiveLists = [
    MARKETS_OVERVIEW_LIST,
    ...lists.filter(l => (l?.name || '').trim().toLowerCase() !== 'liste de surveillance'),
    BLOOMBERG_LIVE_TAB,
    HEATMAP_TAB,
  ];
  const symbols = effectiveLists[listIdx]?.symbols || [];

  useEffect(() => {
    if (!symbols.length) return;
    let cancelled = false;
    const fetchQ = async () => {
      const results = {};
      await Promise.all(symbols.map(async ({ s, y }) => {
        const ticker = y || (s.includes(':') ? s.split(':')[1] : s);
        try {
          const q = await fetchChart(ticker);
          if (q) results[ticker] = q;
        } catch {}
      }));
      if (!cancelled) { setQuotes(results); setLastFetch(Date.now()); }
    };
    fetchQ();
    const id = setInterval(fetchQ, 60_000);
    return () => { cancelled = true; clearInterval(id); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbols.map(x=>x.s).join(',')]);

  const doBrowserLogin = async () => {
    setBusy(true); setErr('');
    setModalOpen(true);
    const res = await loginTradingView();
    setModalOpen(false);
    if (res.ok) {
      const wl = await fetchTradingViewWatchlists();
      if (wl.ok && wl.data?.length) { setLists(wl.data); setAuth({ username: res.username || '' }); }
      else { setAuth({ username: res.username || '' }); setErr('Signed in — no watchlists found'); }
    } else { setErr(res.error || 'Login cancelled'); }
    setBusy(false);
  };

  const doLogout = async () => { await logoutTradingView(); setAuth(false); setLists([]); setQuotes({}); setLastFetch(null); };

  const fmtP   = n => n == null ? '–' : n.toLocaleString('en-US', { minimumFractionDigits:2, maximumFractionDigits:2 });
  const fmtChg = n => n == null ? '' : (n >= 0 ? '+' : '') + n.toFixed(2);
  const fmtPct = n => n == null ? '' : (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
  const clr    = n => (n ?? 0) >= 0 ? '#4caf73' : '#ef5350';
  const fmtDate = d => d ? `${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}` : '';

  if (auth === false) return { shell: STOCKS_SHELL, color:'#5cc8a8', title:'Marchés', sub:'TradingView',
    content:(
      <div style={{paddingTop:4}}>
        <div style={{fontSize:11,color:'#666',marginBottom:12}}>Sign in to load your TradingView watchlists</div>
        {err&&<div style={{fontSize:10,color:'#ef5350',marginBottom:8}}>{err}</div>}
        <button onClick={doBrowserLogin} disabled={busy} style={{...C.btn,width:'100%',opacity:busy?0.6:1}}>
          {busy?'Opening browser…':'Sign in to TradingView'}
        </button>
      </div>
    )
  };

  if (auth === null) return { shell: STOCKS_SHELL, color:'#5cc8a8', title:'Marchés', sub:'TradingView',
    content:<div style={{color:'#444',fontSize:11,paddingTop:8}}>Loading…</div>
  };

  const updatedAt = lastFetch
    ? new Date(lastFetch).toLocaleTimeString('en-CA',{hour:'2-digit',minute:'2-digit',hour12:false})
    : '';

  const tabs = effectiveLists.length > 1 && (
    <div style={{display:'flex',gap:4,marginBottom:8,overflowX:'auto'}}>
      {effectiveLists.map((l,i) => (
        <button key={l.id||i} onClick={()=>{ setListIdx(i); saveListIndex(i); }}
          style={{background:i===listIdx?'rgba(255,255,255,0.1)':'none',border:'none',
            borderRadius:5,color:i===listIdx?'#e4e4f4':'#555',
            fontSize:10,padding:'3px 8px',cursor:'pointer',whiteSpace:'nowrap',flexShrink:0}}>
          {l.name}
        </button>
      ))}
    </div>
  );

  // Bloomberg Live (or any future kind === 'video' tab) — render the page
  // inside an Electron <webview> instead of an <iframe> so we can inject CSS
  // into the cross-origin Bloomberg DOM and hide everything that isn't the
  // video player itself (header nav, Subscribe button, sidebars).
  const activeTab = effectiveLists[listIdx];
  if (activeTab?.kind === 'video') {
    return { shell: STOCKS_SHELL, color:'#5cc8a8', title:'Marchés', sub: activeTab.name,
      content:(
        <div>
          {tabs}
          {/* key=activeTab.id forces React to unmount + remount when switching
              tabs. Without this, swapping between video/heatmap tabs mutates
              the same <webview>'s src + partition attributes mid-load and
              triggers ERR_ABORTED (-3) inside Electron. */}
          <VideoEmbed key={activeTab.id} url={activeTab.url} isolate={!!activeTab.isolate}/>
        </div>
      )
    };
  }
  if (activeTab?.kind === 'heatmap') {
    return { shell: STOCKS_SHELL, color:'#5cc8a8', title:'Marchés', sub: activeTab.name,
      content:(
        <div>
          {tabs}
          <VideoEmbed key={activeTab.id} url={activeTab.url} isolate={false}
            storeKey="wp-heatmap-height" partition="persist:tradingview"
            defaultHeight={400}/>
        </div>
      )
    };
  }

  return { shell: STOCKS_SHELL, color:'#5cc8a8', title: 'Marchés', sub: updatedAt ? `Last updated: ${updatedAt}` : 'TradingView',
    lastUpdated: lastFetch || undefined,
    content:(
      <div>
        {tabs}
        <div style={{height:listHeight,overflowY:'auto',marginRight:-4,paddingRight:4}}>
          {symbols.map(({ s, d, y }) => {
            const ticker = y || (s.includes(':') ? s.split(':')[1] : s);
            const q = quotes[ticker];
            const change = q?.change ?? 0;
            const pct = q?.pct ?? 0;
            const sparklineColor = '#1f6fff';
            const deltaColor = change > 0 ? '#4caf73' : change < 0 ? '#ef5350' : '#888';
            const arrow = change >= 0 ? '▲' : '▼';

            // Intraday sparkline: now ~78 5-min candles for US sessions, ~288
            // for crypto. Include the previous close in the y-axis range so
            // the reference line stays inside the viewBox.
            const points = q?.closes || [];
            const prevClose = q?.prev ?? null;
            const allY = prevClose != null ? [...points, prevClose] : points;
            const minPrice = allY.length ? Math.min(...allY) : q?.price ?? 0;
            const maxPrice = allY.length ? Math.max(...allY) : q?.price ?? 0;
            const range = Math.max(maxPrice - minPrice, 0.01);
            const sparklinePoints = points.map((p, i) => {
              const x = (i / Math.max(points.length - 1, 1)) * 100;
              const y = 20 - ((p - minPrice) / range) * 20;
              return `${x},${y}`;
            }).join(' ');
            // y-position of the previous close — drawn as a dashed reference
            // line so each row visually anchors to "yesterday".
            const prevY = prevClose != null
              ? 20 - ((prevClose - minPrice) / range) * 20
              : null;

            return (
              <div key={s} style={{display:'flex',alignItems:'center',gap:8,
                padding:'3px 0',cursor:'pointer',fontVariantNumeric:'tabular-nums'}}
                onClick={()=>openTradingViewChart(s)}>

                {/* Left: name only on the Marchés overview tab (the indices
                    have descriptive names — the ^GSPC-style ticker codes are
                    noise). On user watchlists, keep the ticker + company name
                    two-line layout. */}
                <div style={{flex:1,minWidth:0}}>
                  {listIdx === 0 ? (
                    <div style={{fontSize:11,fontWeight:700,color:'#fff',lineHeight:1.1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                      {d || q?.name || ticker}
                    </div>
                  ) : (
                    <>
                      <div style={{fontSize:11,fontWeight:700,color:'#fff',lineHeight:1.1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                        {ticker}
                      </div>
                      <div style={{fontSize:8,color:'#888',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',lineHeight:1.1,marginTop:1}}>
                        {q?.name || d}
                      </div>
                    </>
                  )}
                </div>

                {/* Center: Sparkline */}
                {sparklinePoints ? (
                  <svg width="64" height="20" viewBox="0 0 100 24" preserveAspectRatio="none" style={{flexShrink:0}}>
                    <defs>
                      <linearGradient id={`grad-${ticker}`} x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" stopColor={sparklineColor} stopOpacity="0.14"/>
                        <stop offset="100%" stopColor={sparklineColor} stopOpacity="0.015"/>
                      </linearGradient>
                    </defs>
                    <polyline points={sparklinePoints + ' 100,24 0,24'} fill={`url(#grad-${ticker})`}/>
                    {prevY != null && (
                      <line x1="0" y1={prevY} x2="100" y2={prevY}
                        stroke="rgba(255,255,255,0.22)" strokeWidth="0.6"
                        strokeDasharray="2 2" vectorEffect="non-scaling-stroke"/>
                    )}
                    <polyline points={sparklinePoints} fill="none" stroke={sparklineColor} strokeOpacity="0.48" strokeWidth="1.2" vectorEffect="non-scaling-stroke"/>
                  </svg>
                ) : (
                  <div style={{width:64,height:20,flexShrink:0}}/>
                )}

                {/* Right: Price + delta (text color encodes direction) */}
                <div style={{display:'flex',flexDirection:'column',alignItems:'flex-end',gap:1,minWidth:60,flexShrink:0}}>
                  <div style={{fontSize:11,color:'#fff',whiteSpace:'nowrap',lineHeight:1.1}}>
                    {fmtP(q?.price)}
                  </div>
                  {q?.change!=null && (
                    <div style={{fontSize:9,color:deltaColor,whiteSpace:'nowrap',lineHeight:1.2}}>
                      {change>0?'+':''}{fmtP(change)}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          {!symbols.length&&(
            <div style={{color:'#444',fontSize:11,padding:'12px 0',textAlign:'center'}}>
              {lists.length?'Empty watchlist':'No watchlists found'}
            </div>
          )}
        </div>
        <div onMouseDown={onResizeMouseDown}
          style={{height:6,marginTop:2,marginLeft:-14,marginRight:-14,cursor:'ns-resize',
            display:'flex',alignItems:'center',justifyContent:'center',userSelect:'none'}}>
          <div style={{width:28,height:2,borderRadius:1,background:'rgba(255,255,255,0.1)'}}/>
        </div>
        <button onClick={doLogout}
          style={{marginTop:8,background:'none',border:'none',color:'#333',fontSize:10,cursor:'pointer',padding:0}}>
          Sign out
        </button>
      </div>
    )
  };
}

// ── Calendar widget (year/month navigation) ──────────────────────────────────
