import { useEffect, useRef, useState } from 'react';
import { C } from '../../ui/theme.js';
import { HEATMAP_TAB, MARKETS_OVERVIEW_LIST } from './stocks.constants.js';
import {
  fetchChart,
  fetchMarketEvents,
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
import { publishStarvisContext } from '../../services/starvisContext.service.js';

const STOCKS_SHELL = 'acrylic';
const STOCKS_SHELL_PROPS = { stableBackground: true };
const STOCKS_CLIENT_STYLE = {
  background: 'rgba(2,8,18,0.28)',
  border: '1px solid rgba(247,250,255,0.10)',
  borderRadius: 6,
  padding: '6px 6px 4px',
  margin: '0 -4px',
};
const EARNINGS_EVENTS_TAB = { id: 'wp-market-events-earnings', name: 'Revenus', kind: 'earnings' };
const IPO_EVENTS_TAB = { id: 'wp-market-events-ipos', name: 'IPOs', kind: 'ipos' };
const DEFAULT_WATCHLIST_NAMES = new Set(['liste de surveillance']);
const SURVEILLANCE_LIST_NAMES = new Set(['surveillance', 'liste de surveillance', 'watchlist']);

function normalizeListName(name) {
  return String(name || '').trim().toLowerCase();
}

function isDefaultWatchlist(list) {
  return DEFAULT_WATCHLIST_NAMES.has(normalizeListName(list?.name));
}

function isSurveillanceList(list) {
  return SURVEILLANCE_LIST_NAMES.has(normalizeListName(list?.name));
}

function getSurveillanceList(lists) {
  return lists.find(isSurveillanceList) || lists.find(list => (list?.symbols || []).length) || null;
}

function toTradingViewSymbol(item) {
  const symbol = item?.s || '';
  if (symbol.includes(':')) return symbol;
  return '';
}

function HeaderKeyButton({ onClick, title = 'Se d\u00e9connecter' }) {
  return (
    <button
      type="button"
      title={title}
      onClick={(event) => {
        event.stopPropagation();
        onClick?.();
      }}
      style={{
        width: 19,
        height: 19,
        borderRadius: 5,
        border: '1px solid rgba(238,248,255,0.32)',
        background: 'rgba(31,111,255,0.12)',
        color: 'rgba(255,255,255,0.88)',
        cursor: 'pointer',
        padding: 0,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxShadow: '0 0 10px rgba(31,111,255,0.18), inset 0 0 0 1px rgba(255,255,255,0.05)',
      }}
    >
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="7.5" cy="15.5" r="4.2" />
        <path d="M10.6 12.4 21 2" />
        <path d="m15.5 7.5 2.1 2.1" />
        <path d="m18.2 4.8 2.1 2.1" />
      </svg>
    </button>
  );
}

function formatEventDate(value) {
  if (!value) return '--';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  return date.toLocaleDateString('fr-CA', { month: 'short', day: '2-digit' });
}

function formatRevenue(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return '';
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(0)}M`;
  return `$${new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(n)}`;
}

function formatIpoPrice(item) {
  const low = Number(item?.priceLow);
  const high = Number(item?.priceHigh);
  if (Number.isFinite(low) && Number.isFinite(high) && low > 0 && high > 0) return `$${low}-${high}`;
  if (Number.isFinite(low) && low > 0) return `$${low}`;
  if (Number.isFinite(high) && high > 0) return `$${high}`;
  return item?.exchange || '';
}

function EventMiniRow({ primary, secondary, detail }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'minmax(0,1fr) auto',
      gap: 6,
      alignItems: 'baseline',
      padding: '3px 0',
      borderTop: '1px solid rgba(247,250,255,0.045)',
      fontVariantNumeric: 'tabular-nums',
    }}>
      <div style={{ minWidth: 0 }}>
        <div style={{
          color: '#fff',
          fontSize: 9,
          lineHeight: 1.15,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>{primary}</div>
        {detail && (
          <div style={{
            color: 'rgba(247,250,255,0.48)',
            fontSize: 8,
            lineHeight: 1.25,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            marginTop: 1,
          }}>{detail}</div>
        )}
      </div>
      <div style={{
        color: 'rgba(247,250,255,0.72)',
        fontSize: 9,
        lineHeight: 1.2,
        textAlign: 'right',
        whiteSpace: 'nowrap',
      }}>{secondary}</div>
    </div>
  );
}

function MarketEventsPanel({ events, loading }) {
  const earnings = events?.earnings || [];
  const ipos = events?.ipos || [];
  const hasEvents = earnings.length || ipos.length;
  if (!hasEvents && !loading) return null;
  return (
    <div style={{
      marginTop: 6,
      padding: '7px 7px 6px',
      border: '1px solid rgba(247,250,255,0.08)',
      borderRadius: 6,
      background: 'linear-gradient(180deg, rgba(4,10,22,0.30), rgba(2,6,16,0.20))',
      boxShadow: 'inset 0 0 0 1px rgba(31,111,255,0.035)',
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 5,
      }}>
        <div style={{ color: 'rgba(247,250,255,0.74)', fontSize: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>
          Calendrier marche
        </div>
        <div style={{ color: loading ? '#fff' : 'rgba(247,250,255,0.42)', fontSize: 8, fontFamily: 'DM Mono,monospace' }}>
          {loading ? 'MAJ...' : events?.updatedAt ? formatEventDate(events.updatedAt) : ''}
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 8 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 8, color: 'rgba(247,250,255,0.56)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 }}>
            Revenus
          </div>
          {earnings.length ? earnings.slice(0, 4).map(item => (
            <EventMiniRow
              key={`${item.ticker}-${item.date}`}
              primary={item.ticker}
              secondary={formatEventDate(item.date)}
              detail={formatRevenue(item.revenueAverage) || item.name || 'Publication'}
            />
          )) : (
            <div style={{ color: 'rgba(247,250,255,0.34)', fontSize: 9, paddingTop: 5 }}>Aucune date</div>
          )}
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 8, color: 'rgba(247,250,255,0.56)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 }}>
            Upcoming IPOs
          </div>
          {ipos.length ? ipos.slice(0, 4).map(item => (
            <EventMiniRow
              key={`${item.symbol || item.name}-${item.date}`}
              primary={item.symbol || item.name}
              secondary={formatEventDate(item.date)}
              detail={item.symbol ? item.name : formatIpoPrice(item)}
            />
          )) : (
            <div style={{ color: 'rgba(247,250,255,0.34)', fontSize: 9, paddingTop: 5 }}>Aucune IPO</div>
          )}
        </div>
      </div>
    </div>
  );
}

function MarketEventsTabView({ type, events, loading }) {
  const rows = type === 'ipos' ? (events?.ipos || []) : (events?.earnings || []);
  const empty = type === 'ipos' ? 'Aucune IPO a venir' : 'Aucune date de revenus';
  return (
    <div style={{
      minHeight: 180,
      padding: '2px 0 0',
      color: '#fff',
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        margin: '0 2px 6px',
        paddingBottom: 5,
        borderBottom: '1px solid rgba(247,250,255,0.075)',
      }}>
        <div style={{ fontSize: 8, color: 'rgba(247,250,255,0.58)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
          {type === 'ipos' ? 'Upcoming IPOs' : 'Publications de revenus'}
        </div>
        <div style={{ color: loading ? '#fff' : 'rgba(247,250,255,0.42)', fontSize: 8, fontFamily: 'DM Mono,monospace' }}>
          {loading ? 'MAJ...' : events?.updatedAt ? formatEventDate(events.updatedAt) : ''}
        </div>
      </div>
      {rows.length ? rows.slice(0, 10).map(item => (
        <EventMiniRow
          key={type === 'ipos' ? `${item.symbol || item.name}-${item.date}` : `${item.ticker}-${item.date}`}
          primary={type === 'ipos' ? (item.symbol || item.name) : item.ticker}
          secondary={formatEventDate(item.date)}
          detail={type === 'ipos'
            ? (item.symbol ? item.name : formatIpoPrice(item))
            : (formatRevenue(item.revenueAverage) || item.name || 'Publication')}
        />
      )) : (
        <div style={{ color: 'rgba(247,250,255,0.40)', fontSize: 10, padding: '12px 2px' }}>
          {loading ? 'Chargement...' : empty}
        </div>
      )}
    </div>
  );
}

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

export default function StocksWidget({ onOpenWebContent } = {}) {
  const [auth,      setAuth]      = useState(null); // null=loading, false=anon, {username}=ok
  const [lists,     setLists]     = useState([]);
  const [listIdx,   setListIdx]   = useState(0);
  const [quotes,    setQuotes]    = useState({});
  const [lastFetch, setLastFetch] = useState(null);
  const [err,       setErr]       = useState('');
  const [busy,      setBusy]      = useState(false);
  const [listHeight, setListHeight] = useState(380);
  const [marketEvents, setMarketEvents] = useState({ earnings: [], ipos: [] });
  const [marketEventsLoading, setMarketEventsLoading] = useState(false);

  useEffect(() => {
    (async () => {
      const session = await getTradingViewSession();
      if (session) {
        const r = await fetchTradingViewWatchlists({ force: true });
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
    ...lists.filter(l => !isDefaultWatchlist(l)),
    EARNINGS_EVENTS_TAB,
    IPO_EVENTS_TAB,
    HEATMAP_TAB,
  ];
  const symbols = effectiveLists[listIdx]?.symbols || [];
  const listIdxRef = useRef(listIdx);
  const effectiveListsRef = useRef(effectiveLists);

  useEffect(() => { listIdxRef.current = listIdx; }, [listIdx]);
  useEffect(() => { effectiveListsRef.current = effectiveLists; }, [effectiveLists]);

  useEffect(() => {
    if (!auth || auth === false) return;
    let cancelled = false;
    const refreshListMetadata = async () => {
      const activeId = effectiveListsRef.current[listIdxRef.current]?.id;
      const r = await fetchTradingViewWatchlists({ force: true });
      if (cancelled || !r.ok || !r.data?.length) return;
      const nextUserLists = r.data;
      const nextEffectiveLists = [
        MARKETS_OVERVIEW_LIST,
        ...nextUserLists.filter(l => !isDefaultWatchlist(l)),
        EARNINGS_EVENTS_TAB,
        IPO_EVENTS_TAB,
        HEATMAP_TAB,
      ];
      setLists(nextUserLists);
      if (activeId) {
        const nextIndex = nextEffectiveLists.findIndex(item => item.id === activeId);
        if (nextIndex >= 0 && nextIndex !== listIdxRef.current) {
          listIdxRef.current = nextIndex;
          setListIdx(nextIndex);
          saveListIndex(nextIndex);
        }
      }
    };
    const timer = setInterval(refreshListMetadata, 60_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [auth]);

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

  useEffect(() => {
    if (!auth || auth === false) return;
    const surveillance = getSurveillanceList(lists);
    const earningsSymbols = Array.from(new Set((surveillance?.symbols || [])
      .map(toTradingViewSymbol)
      .filter(Boolean)))
      .slice(0, 48);
    let cancelled = false;
    const refreshMarketEvents = async () => {
      setMarketEventsLoading(true);
      try {
        const result = await fetchMarketEvents({ earningsSymbols });
        if (cancelled || !result?.ok) return;
        setMarketEvents({
          earnings: result.earnings || [],
          ipos: result.ipos || [],
          updatedAt: result.updatedAt || Date.now(),
        });
      } catch {
        // Keep the last successful market-event snapshot visible.
      } finally {
        if (!cancelled) setMarketEventsLoading(false);
      }
    };
    refreshMarketEvents();
    const refreshTimer = setInterval(refreshMarketEvents, 6 * 60 * 60 * 1000);
    return () => {
      cancelled = true;
      clearInterval(refreshTimer);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth, listIdx, lists.map(list => `${list.id || list.name}:${(list.symbols || []).map(x => x.s).join(',')}`).join('|')]);

  const doBrowserLogin = async () => {
    setBusy(true); setErr('');
    setModalOpen(true);
    const res = await loginTradingView();
    setModalOpen(false);
    if (res.ok) {
      const wl = await fetchTradingViewWatchlists({ force: true });
      if (wl.ok && wl.data?.length) { setLists(wl.data); setAuth({ username: res.username || '' }); }
      else { setAuth({ username: res.username || '' }); setErr('Signed in — no watchlists found'); }
    } else { setErr(res.error || 'Login cancelled'); }
    setBusy(false);
  };

  const doLogout = async () => { await logoutTradingView(); setAuth(false); setLists([]); setQuotes({}); setLastFetch(null); };
  const logoutBadge = <HeaderKeyButton onClick={doLogout} />;

  const fmtP   = n => n == null ? '–' : n.toLocaleString('en-US', { minimumFractionDigits:2, maximumFractionDigits:2 });
  const fmtChg = n => n == null ? '' : (n >= 0 ? '+' : '') + n.toFixed(2);
  const fmtPct = n => n == null ? '' : (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
  const clr    = n => (n ?? 0) >= 0 ? '#4caf73' : '#ef5350';
  const fmtDate = d => d ? `${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}` : '';
  const activeTab = effectiveLists[listIdx];

  useEffect(() => {
    if (!symbols.length && !marketEvents?.earnings?.length && !marketEvents?.ipos?.length) return;
    const rows = symbols.slice(0, 12).map(({ s, d, y }) => {
      const ticker = y || (s.includes(':') ? s.split(':')[1] : s);
      const q = quotes[ticker];
      return {
        ticker,
        name: q?.name || d || ticker,
        price: q?.price,
        change: q?.change,
        pct: q?.pct,
      };
    });
    publishStarvisContext('stocks', {
      title: 'Markets',
      summary: rows.length
        ? `Markets: ${rows.slice(0, 5).map(row => `${row.ticker} ${row.price ?? '--'} ${row.pct != null ? `${row.pct.toFixed(2)}%` : ''}`).join(' | ')}`
        : 'Markets calendar available.',
      data: {
        activeList: activeTab?.name || '',
        quotes: rows,
        earnings: (marketEvents?.earnings || []).slice(0, 6),
        ipos: (marketEvents?.ipos || []).slice(0, 6),
        updatedAt: lastFetch,
      },
    });
  }, [activeTab?.name, lastFetch, marketEvents, quotes, symbols]);

  if (auth === false) return { shell: STOCKS_SHELL, shellProps: STOCKS_SHELL_PROPS, color:'#5cc8a8', title:'Marchés', sub:'TradingView',
    content:(
      <div style={{...STOCKS_CLIENT_STYLE,paddingTop:8}}>
        <div style={{fontSize:11,color:'#666',marginBottom:12}}>Sign in to load your TradingView watchlists</div>
        {err&&<div style={{fontSize:10,color:'#ef5350',marginBottom:8}}>{err}</div>}
        <button onClick={doBrowserLogin} disabled={busy} style={{...C.btn,width:'100%',opacity:busy?0.6:1}}>
          {busy?'Opening browser…':'Sign in to TradingView'}
        </button>
      </div>
    )
  };

  if (auth === null) return { shell: STOCKS_SHELL, shellProps: STOCKS_SHELL_PROPS, color:'#5cc8a8', title:'Marchés', sub:'TradingView',
    content:<div style={{...STOCKS_CLIENT_STYLE,color:'#d0d0e0',fontSize:11}}>Loading…</div>
  };

  const updatedAt = lastFetch
    ? new Date(lastFetch).toLocaleTimeString('en-CA',{hour:'2-digit',minute:'2-digit',hour12:false})
    : '';

  const openChartWebContent = (symbol, event) => {
    if (onOpenWebContent) {
      onOpenWebContent({
        url: `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(symbol)}`,
        title: symbol,
        source: 'TradingView',
        partition: 'persist:tradingview',
      }, event);
    } else {
      openTradingViewChart(symbol);
    }
  };
  const openActiveWebContent = activeTab?.url && onOpenWebContent
    ? (event) => onOpenWebContent({
        url: activeTab.url,
        title: activeTab.name || 'Market content',
        source: activeTab.kind === 'heatmap' ? 'TradingView' : 'Markets',
        partition: activeTab.kind === 'heatmap' ? 'persist:tradingview' : 'persist:bloomberg',
      }, event)
    : null;

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

  // Future kind === 'video' tabs can still render through the same webview path.
  const webZoomButton = openActiveWebContent && (activeTab?.kind === 'video' || activeTab?.kind === 'heatmap') && (
    <button onClick={openActiveWebContent} title="Open in zoom card"
      style={{float:'right',marginTop:-30,marginBottom:6,width:24,height:22,borderRadius:5,
        border:'1px solid rgba(238,248,255,0.32)',background:'rgba(31,111,255,0.12)',
        color:'#fff',cursor:'pointer',fontSize:12,lineHeight:1}}>
      ↗
    </button>
  );

  if (activeTab?.kind === 'earnings' || activeTab?.kind === 'ipos') {
    return { shell: STOCKS_SHELL, shellProps: STOCKS_SHELL_PROPS, color:'#5cc8a8', title:'Marchés', sub: activeTab.name, badge: logoutBadge,
      content:(
        <div style={STOCKS_CLIENT_STYLE}>
          {tabs}
          <MarketEventsTabView
            type={activeTab.kind === 'ipos' ? 'ipos' : 'earnings'}
            events={marketEvents}
            loading={marketEventsLoading}
          />
        </div>
      )
    };
  }

  // inside an Electron <webview> instead of an <iframe> so we can inject CSS
  // into the cross-origin Bloomberg DOM and hide everything that isn't the
  // video player itself (header nav, Subscribe button, sidebars).
  if (activeTab?.kind === 'video') {
    return { shell: STOCKS_SHELL, shellProps: STOCKS_SHELL_PROPS, color:'#5cc8a8', title:'Marchés', sub: activeTab.name, badge: logoutBadge,
      content:(
        <div>
          {tabs}
          {webZoomButton}
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
    return { shell: STOCKS_SHELL, shellProps: STOCKS_SHELL_PROPS, color:'#5cc8a8', title:'Marchés', sub: activeTab.name, badge: logoutBadge,
      content:(
        <div>
          {tabs}
          {webZoomButton}
          <VideoEmbed key={activeTab.id} url={activeTab.url} isolate={false}
            storeKey="wp-heatmap-height" partition="persist:tradingview"
            defaultHeight={400}/>
        </div>
      )
    };
  }

  return { shell: STOCKS_SHELL, shellProps: STOCKS_SHELL_PROPS, color:'#5cc8a8', title: 'Marchés', sub: updatedAt ? `Last updated: ${updatedAt}` : 'TradingView',
    badge: logoutBadge,
    lastUpdated: lastFetch || undefined,
    content:(
      <div style={STOCKS_CLIENT_STYLE}>
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
                onClick={(event)=>openChartWebContent(s, event)}>

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
                    <polyline points={sparklinePoints} fill="none" stroke={sparklineColor} strokeOpacity="1" strokeWidth="0.75" vectorEffect="non-scaling-stroke"/>
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
      </div>
    )
  };
}

// ── Calendar widget (year/month navigation) ──────────────────────────────────
