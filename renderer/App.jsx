import { useState, useEffect, useRef, useCallback } from "react";
import WidgetFrame from "./ui/WidgetFrame.jsx";
import { C } from "./ui/theme.js";
import {
  SK_AUTOSTART,
  SK_BASE_COLUMNS,
  SK_CARD_OPACITY,
  SK_COLW,
  SK_EXPANDED,
  SK_LOCATION,
  SK_NEWS_CAROUSEL,
  SK_NEWS_CAROUSEL_MS,
  SK_OPACITY,
  SK_PINNED,
  SK_PINNED_OPACITY,
  SK_TV_SYMBOLS,
} from "./config/storageKeys.js";
import { SYS, SYSTEM_WIDGET_ID_SET, WORKSTATION_WIDGET_IDS, WORKSTATION_WIDGET_ID_SET, defaultColumns, getColumnForWidget, isKnownWidgetId } from "./config/widgets.js";
import { api } from "./services/electronApi.js";
import { playCardCollapseSound, playCardExpandSound, playPanelInSound, playPanelOutSound } from "./services/sound.service.js";
import { storageLoad, storageSave } from "./services/storage.service.js";
import CalendarWidget from "./widgets/calendar/CalendarWidget.jsx";
import CameraWidget from "./widgets/camera/CameraWidget.jsx";
import ClockWidget from "./widgets/clock/ClockWidget.jsx";
import EuronewsWidget from "./widgets/euronews/EuronewsWidget.jsx";
import LiveFeedGrid, { LiveFeedWidget, LiveHlsTile, LiveYouTubeEmbedTile, useLiveAudioOwner, YOUTUBE_PLAYER_CSS, YOUTUBE_PLAYER_DIAG_JS } from "./widgets/live/LiveFeedGrid.jsx";
import { AgendaWidget, MailWidget, TodoWidget } from "./widgets/microsoft/MicrosoftWidgets.jsx";
import NewsWidget from "./widgets/news/NewsWidget.jsx";
import { parseOPML } from "./widgets/news/news.service.js";
import { getNewsCategoryColor } from "./widgets/news/news.theme.js";
import PressReaderCatalog from "./widgets/pressreader/PressReaderCatalog.jsx";
import { pressReaderSlug } from "./widgets/pressreader/pressreader.categories.js";
import StocksWidget from "./widgets/stocks/StocksWidget.jsx";
import { DEFAULT_TV_SYMBOLS } from "./widgets/stocks/stocks.constants.js";
import StarvisWidget from "./widgets/starvis/StarvisWidget.jsx";
import TrafficWidget from "./widgets/traffic/TrafficWidget.jsx";
import WeatherWidget from "./widgets/weather/WeatherWidget.jsx";
import { CpuWidget, DiskWidget, GpuWidget, NetworkWidget, RamWidget } from "./widgets/workstation/WorkstationWidgets.jsx";
import { DEFAULT_LOC } from "./widgets/weather/weather.constants.js";

function hexToRgb(hex) {
  const h = hex.replace('#','')
  return `${parseInt(h.slice(0,2),16)},${parseInt(h.slice(2,4),16)},${parseInt(h.slice(4,6),16)}`
}

function opacityRange(value, min, max) {
  const n = Math.max(0, Math.min(1, Number(value) || 0));
  return min + (max - min) * n;
}

// ── API endpoints ────────────────────────────────────────────────────────────
const PRESSREADER_URL = "https://www.pressreader.com.ezproxy.bibliothequedequebec.qc.ca/fr/catalog/featured";
const PRESSREADER_CATALOG_URL = "https://www.pressreader.com.ezproxy.bibliothequedequebec.qc.ca/fr/catalog";
const PRESSREADER_PROXY_ORIGIN = "https://www.pressreader.com.ezproxy.bibliothequedequebec.qc.ca";
const SK_PRESSREADER_AUTH = 'wp-pressreader-auth';
const SK_PRESSREADER_CATALOG_INDEX = 'wp-pressreader-catalog-index';
const SK_PRESSREADER_CATEGORY_SELECTION = 'wp-pressreader-category-selection';
const SK_PRESSREADER_GUARDRAIL = 'wp-pressreader-guardrail';
const PRESSREADER_INDEX_TTL_MS = 24 * 60 * 60 * 1000;
const PRESSREADER_AUTH_COOLDOWN_MS = 2 * 60 * 1000;
const PRESSREADER_CRAWL_INTERVAL_MS = 9000;
const PRESSREADER_CRAWL_MAX_CATEGORIES = 4;
const PRESSREADER_BOOTSTRAP_MAX_STEPS = 6;
const PRESSREADER_ACTUALITES_MAGAZINE_CIDS = ['6532', 'f59r', '9yxp', '9vyf', '9534', '000c', '9vxx', '9vxy', '9be8', '9486', '9wap', '2572', '9fc6'];
const PRESSREADER_CATEGORY_IDS = {
  news: 1124,
  businessFinance: 1069,
  sports: 1075,
  newspapers: 142606336,
  magazines: 150994944,
};
const PRESSREADER_NEWSPAPERS_SOURCE_URL = 'https://www.pressreader.com.ezproxy.bibliothequedequebec.qc.ca/fr/newspapers';
const PRESSREADER_CANADIAN_NEWSPAPER_PATTERN = /canada|qu[eé]bec|montreal|montr[eé]al|toronto|ottawa|vancouver|calgary|edmonton|winnipeg|gazette|devoir|presse|soleil|journal de|globe and mail|national post|star|province|citizen|leader-post|chronicle herald/i;
const PRESSREADER_BUSINESS_NEWSPAPER_PATTERN = /business|finance|financial|affaires|économie|economie|economist|bloomberg|wall street|investor|cinco d[ií]as|les affaires/i;
const PRESSREADER_DAILY_NEWSPAPER_PATTERN = /daily|journal|times|post|gazette|guardian|globe|mail|mirror|express|telegraph|independent|record|sun|observer|herald|press|standard|courier|tribune|star|today|morning|evening|le monde|le temps|lib[eé]ration|el pa[ií]s/i;
const PRESSREADER_SUNDAY_NEWSPAPER_PATTERN = /sunday|dimanche/i;
const PRESSREADER_LOCAL_NEWSPAPER_PATTERN = /qu[eé]bec|montreal|montr[eé]al|ottawa|toronto|vancouver|calgary|edmonton|winnipeg|gazette|devoir|presse|soleil|journal de|globe and mail|cbc|radio-canada|echos vedettes|local|regional/i;
const DEFAULT_COL_WIDTHS = { left: 220, monitor: 220, mid: 240, feed: 260, right: 260, aux: 260 };
const PANEL_MODES = ['base', 'news', 'monitor', 'live'];
const BASE_COLUMN_ORDER = ['left', 'monitor', 'mid', 'feed', 'right', 'aux'];
const DEFAULT_BASE_COLUMN_COUNT = 6;
const PANEL_SLIDE_MS = 390;
const EXPAND_DIAG_ENABLED = false;
const EXPAND_DIAG_DELAYS = [0, 16, 80, 180, 260, 420, 700];
const WEB_ISLAND_DIAG_ENABLED = true;
const WEB_ISLAND_DIAG_DELAYS = [0, 60, 180, 420, 900, 1800, 3600, 7200, 12000];
const READER_CLIENT_TIMEOUT_MS = 5200;
const WORKSTATION_MODE_COLUMNS = {
  'workstation-cpu': 'monitor',
  'workstation-disk': 'monitor',
  'workstation-gpu': 'mid',
  'workstation-ram': 'feed',
  'workstation-network': 'feed',
};

function shortCss(value = '') {
  const text = String(value || '');
  if (!text || text === 'none') return text || '';
  return text.length > 180 ? `${text.slice(0, 180)}...` : text;
}

function roundPx(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 10) / 10 : null;
}

function rectSummary(el) {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return {
    x: roundPx(r.x),
    y: roundPx(r.y),
    w: roundPx(r.width),
    h: roundPx(r.height),
    top: roundPx(r.top),
    bottom: roundPx(r.bottom),
  };
}

function cssAlpha(value = '') {
  const rgba = String(value).match(/rgba?\(([^)]+)\)/i);
  if (!rgba) {
    if (String(value).trim().toLowerCase() === 'transparent') return 0;
    return null;
  }
  const parts = rgba[1].split(',').map(part => part.trim());
  if (parts.length < 4) return 1;
  const alpha = Number(parts[3]);
  return Number.isFinite(alpha) ? alpha : null;
}

function styleSummary(el) {
  if (!el) return null;
  const s = window.getComputedStyle(el);
  return {
    bg: s.backgroundColor,
    bgAlpha: cssAlpha(s.backgroundColor),
    bgImage: shortCss(s.backgroundImage),
    opacity: s.opacity,
    filter: s.filter,
    backdrop: s.backdropFilter || s.webkitBackdropFilter || '',
    mixBlend: s.mixBlendMode,
    transform: s.transform,
    contain: s.contain,
    isolation: s.isolation,
    overflow: `${s.overflow}/${s.overflowY}`,
    position: s.position,
    zIndex: s.zIndex,
  };
}

function sizeSummary(el) {
  if (!el) return null;
  return {
    rect: rectSummary(el),
    client: { w: el.clientWidth || 0, h: el.clientHeight || 0 },
    scroll: { w: el.scrollWidth || 0, h: el.scrollHeight || 0 },
    offset: { w: el.offsetWidth || 0, h: el.offsetHeight || 0 },
    style: styleSummary(el),
  };
}

function nodeNameSummary(el) {
  if (!el) return '';
  const tag = el.tagName?.toLowerCase() || 'node';
  const id = el.id ? `#${el.id}` : '';
  const cls = String(el.className || '').trim().split(/\s+/).filter(Boolean).slice(0, 3).join('.');
  return `${tag}${id}${cls ? `.${cls}` : ''}`;
}

function transparentLayers(root) {
  if (!root) return [];
  return Array.from(root.querySelectorAll('*')).map((el) => {
    const rect = el.getBoundingClientRect();
    const area = rect.width * rect.height;
    if (area < 1800) return null;
    const style = window.getComputedStyle(el);
    const opacity = Number(style.opacity);
    const bgAlpha = cssAlpha(style.backgroundColor);
    const hasGradient = style.backgroundImage && style.backgroundImage !== 'none';
    const hasBackdrop = (style.backdropFilter || style.webkitBackdropFilter || 'none') !== 'none';
    const isInteresting = opacity < 0.99
      || (bgAlpha !== null && bgAlpha > 0 && bgAlpha < 0.99)
      || hasGradient
      || hasBackdrop
      || style.mixBlendMode !== 'normal';
    if (!isInteresting) return null;
    return {
      node: nodeNameSummary(el),
      rect: rectSummary(el),
      area: Math.round(area),
      opacity: style.opacity,
      bg: style.backgroundColor,
      bgAlpha,
      bgImage: shortCss(style.backgroundImage),
      backdrop: style.backdropFilter || style.webkitBackdropFilter || '',
      mixBlend: style.mixBlendMode,
      position: style.position,
      zIndex: style.zIndex,
    };
  }).filter(Boolean).sort((a, b) => b.area - a.area).slice(0, 10);
}

const WEB_ISLAND_GUEST_DIAG_JS = `
(() => {
  const round = value => {
    const n = Number(value);
    return Number.isFinite(n) ? Math.round(n * 10) / 10 : null;
  };
  const rect = el => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: round(r.x), y: round(r.y), w: round(r.width), h: round(r.height), top: round(r.top), bottom: round(r.bottom) };
  };
  const style = el => {
    if (!el) return null;
    const s = getComputedStyle(el);
    return {
      display: s.display,
      visibility: s.visibility,
      opacity: s.opacity,
      overflow: s.overflow + '/' + s.overflowY,
      position: s.position,
      transform: s.transform,
      height: s.height,
      minHeight: s.minHeight,
      maxHeight: s.maxHeight,
      bg: s.backgroundColor,
    };
  };
  const name = el => {
    if (!el) return null;
    const cls = String(el.className || '').trim().split(/\\s+/).filter(Boolean).slice(0, 4).join('.');
    const text = (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 90);
    return {
      node: el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (cls ? '.' + cls : ''),
      rect: rect(el),
      style: style(el),
      text,
    };
  };
  const atPoint = (x, y) => {
    try {
      return name(document.elementFromPoint(Math.max(0, Math.min(innerWidth - 1, x)), Math.max(0, Math.min(innerHeight - 1, y))));
    } catch {
      return null;
    }
  };
  const candidates = [
    document.querySelector('[role="main"]'),
    document.querySelector('main'),
    document.querySelector('[data-app-section]'),
    document.querySelector('[aria-label*="message" i]'),
    document.querySelector('[class*="ReadingPane" i]'),
    document.querySelector('[class*="mail" i]'),
    document.body,
  ].filter(Boolean);
  const unique = [];
  for (const el of candidates) {
    if (!unique.includes(el)) unique.push(el);
  }
  return {
    href: location.href,
    title: document.title,
    readyState: document.readyState,
    active: name(document.activeElement),
    viewport: {
      inner: { w: innerWidth, h: innerHeight },
      visual: window.visualViewport ? {
        w: round(visualViewport.width),
        h: round(visualViewport.height),
        scale: round(visualViewport.scale),
        offsetTop: round(visualViewport.offsetTop),
      } : null,
      scroll: { x: round(scrollX), y: round(scrollY) },
      dpr: round(devicePixelRatio),
    },
    document: {
      html: {
        client: { w: document.documentElement.clientWidth, h: document.documentElement.clientHeight },
        scroll: { w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight },
        rect: rect(document.documentElement),
        style: style(document.documentElement),
      },
      body: {
        client: { w: document.body?.clientWidth || 0, h: document.body?.clientHeight || 0 },
        scroll: { w: document.body?.scrollWidth || 0, h: document.body?.scrollHeight || 0 },
        rect: rect(document.body),
        style: style(document.body),
        textLength: (document.body?.innerText || '').length,
      },
    },
    probes: [
      atPoint(innerWidth * 0.5, 24),
      atPoint(innerWidth * 0.5, Math.max(80, innerHeight * 0.18)),
      atPoint(innerWidth * 0.5, innerHeight * 0.5),
      atPoint(innerWidth * 0.5, Math.max(0, innerHeight - 48)),
    ],
    candidates: unique.slice(0, 8).map(name),
  };
})()
`;

function findWidgetNode(id) {
  return Array.from(document.querySelectorAll('[data-widget-id]'))
    .find(node => node.dataset.widgetId === id) || null;
}

function categoryDiagnostics(id, categories = []) {
  if (!id?.startsWith?.('cat:')) return null;
  const label = id.slice(4);
  const category = categories.find(item => item.label === label);
  return {
    label,
    feedCount: category?.feeds?.length || 0,
    feeds: (category?.feeds || []).map(feed => {
      try {
        const url = new URL((feed.url || '').trim());
        return `${url.hostname}${url.pathname}`;
      } catch {
        return String(feed.url || '').trim();
      }
    }),
  };
}

function logExpandDiagnosticSnapshot({ id, phase, fromExpanded, toExpanded, categories, panelBgRef }) {
  if (!EXPAND_DIAG_ENABLED) return;
  const wrapper = findWidgetNode(id);
  const shell = wrapper?.querySelector('.wp-acrylic-shell') || wrapper?.firstElementChild || null;
  const body = wrapper?.querySelector('.wp-acrylic-body') || null;
  const content = body?.firstElementChild || null;
  const panel = panelBgRef.current;
  const images = Array.from(wrapper?.querySelectorAll('img') || []).slice(0, 5).map(img => ({
    rect: rectSummary(img),
    complete: img.complete,
    natural: `${img.naturalWidth || 0}x${img.naturalHeight || 0}`,
    currentSrc: (() => {
      try {
        const url = new URL(img.currentSrc || img.src || '');
        return `${url.hostname}${url.pathname.slice(0, 80)}`;
      } catch {
        return '';
      }
    })(),
    style: styleSummary(img),
  }));

  const payload = {
    id,
    phase,
    fromExpanded,
    toExpanded,
    at: Math.round(performance.now()),
    windowFocused: document.hasFocus(),
    category: categoryDiagnostics(id, categories),
    panel: { rect: rectSummary(panel), style: styleSummary(panel) },
    wrapper: { rect: rectSummary(wrapper), style: styleSummary(wrapper), dataset: { ...wrapper?.dataset } },
    shell: { rect: rectSummary(shell), style: styleSummary(shell) },
    body: { rect: rectSummary(body), style: styleSummary(body) },
    content: { rect: rectSummary(content), style: styleSummary(content) },
    imageCount: wrapper?.querySelectorAll('img')?.length || 0,
    images,
    panelLayers: transparentLayers(panel),
    widgetLayers: transparentLayers(wrapper),
  };
  api.log?.('[expand-diagnostic]', JSON.stringify(payload));
}

const PRESSREADER_PROBE_JS = `
  (() => {
    const visible = el => {
      if (!el) return false;
      const box = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return box.width > 1 && box.height > 1 && style.display !== 'none' && style.visibility !== 'hidden';
    };
    const attr = el => [el.id, el.name, el.autocomplete, el.placeholder, el.getAttribute('aria-label')]
      .filter(Boolean).join(' ').toLowerCase();
    const inputs = [...document.querySelectorAll('input')].filter(visible);
    const password = inputs.find(input => (input.type || '').toLowerCase() === 'password' || /pass|mot/.test(attr(input)));
    const textInputs = inputs.filter(input => {
      const type = (input.type || 'text').toLowerCase();
      return !['hidden', 'password', 'submit', 'button', 'checkbox', 'radio'].includes(type);
    });
    const user = textInputs.find(input => /user|usager|card|barcode|client|login|name|identifiant|dossier|numero|no/.test(attr(input))) || textInputs[0];
    const body = (document.body?.innerText || '').slice(0, 3200);
    const hasLogin = !!password && (!!user || /connexion|connecter|mot de passe|no d[' ]?usager/i.test(body));
    const rejectionWords = '(?:invalid|incorrect|rejected|refus(?:e|\\u00e9)?|erreur|failed|bloqu(?:e|\\u00e9)|locked|suspendu|too many|trop de|invalide|erron(?:e|\\u00e9)|non valide)';
    const credentialWords = '(?:password|pass|login|connexion|usager|card|barcode|identifiant|mot de passe)';
    const authRejected = new RegExp(rejectionWords + '.{0,120}' + credentialWords + '|' + credentialWords + '.{0,120}' + rejectionWords, 'i').test(body);
    const controls = [...document.querySelectorAll('button, a, input[type="button"], input[type="submit"]')].filter(visible);
    const startReading = controls.find(el => /start reading now|commencer( la lecture)?|lire maintenant/i.test((el.innerText || el.value || el.getAttribute('aria-label') || '').trim()));
    const lastUserClick = Number(window.__wpPressReaderLastUserClick || 0);
    const unavailable = /publication n(?:['\\u2019])?est pas disponible|publication is not available|not available|d(?:e|\\u00e9)sol(?:e|\\u00e9)s, mais cette publication/i.test(body);
    return {
      hasLogin,
      hasStartReading: !!startReading,
      unavailable,
      authRejected,
      user: user?.value || '',
      passwordPresent: !!password,
      lastUserClick,
      recentUserClick: lastUserClick > 0 && Date.now() - lastUserClick < 9000,
      readyState: document.readyState,
      href: location.href,
      title: document.title || '',
    };
  })();
`;

function buildPressReaderLoginScript(auth) {
  const user = JSON.stringify(auth?.u || '');
  const pass = JSON.stringify(auth?.p || '');
  return `
    (() => {
      const username = ${user};
      const passwordValue = ${pass};
      const visible = el => {
        if (!el) return false;
        const box = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return box.width > 1 && box.height > 1 && style.display !== 'none' && style.visibility !== 'hidden';
      };
      const attr = el => [el.id, el.name, el.autocomplete, el.placeholder, el.getAttribute('aria-label')]
        .filter(Boolean).join(' ').toLowerCase();
      const setValue = (el, value) => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        try { el.focus?.(); } catch {}
        if (setter) setter.call(el, value);
        else el.value = value;
        el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'a' }));
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'a' }));
        try { el.blur?.(); } catch {}
      };
      const inputs = [...document.querySelectorAll('input')].filter(visible);
      const password = inputs.find(input => (input.type || '').toLowerCase() === 'password' || /pass|mot/.test(attr(input)));
      const textInputs = inputs.filter(input => {
        const type = (input.type || 'text').toLowerCase();
        return !['hidden', 'password', 'submit', 'button', 'checkbox', 'radio'].includes(type);
      });
      const userInput = textInputs.find(input => /user|usager|card|barcode|client|login|name|identifiant|dossier|numero|no/.test(attr(input))) || textInputs[0];
      if (!userInput || !password) return { ok:false, error:'Login fields not found' };
      setValue(userInput, username);
      setValue(password, passwordValue);
      const controls = [
        ...document.querySelectorAll('button, input[type="submit"], input[type="button"], input[type="image"], a, [role="button"]'),
      ].filter(visible);
      const label = el => (el.innerText || el.value || el.getAttribute('aria-label') || el.getAttribute('title') || '').trim();
      const submit = controls.find(el => /connexion|connecter|se connecter|login|log in|sign in|submit|soumettre|valider|continue|continuer|ok/i.test(label(el)))
        || password.form?.querySelector('button[type="submit"], input[type="submit"], input[type="image"]')
        || controls.find(el => /submit|button/i.test(el.type || '') && !el.disabled)
        || controls.find(el => !el.disabled);
      setTimeout(() => {
        try {
          if (submit) {
            submit.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, view: window }));
            submit.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, view: window }));
            submit.click();
          } else if (password.form?.requestSubmit) {
            password.form.requestSubmit();
          } else if (password.form) {
            password.form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }));
            password.form.submit?.();
          } else {
            password.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter', code: 'Enter' }));
            password.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Enter', code: 'Enter' }));
          }
        } catch {}
      }, 260);
      return { ok:true, userField: attr(userInput), passwordField: attr(password), submit: submit ? label(submit) || submit.tagName : '' };
    })();
  `;
}

const PRESSREADER_START_READING_JS = `
  (() => {
    const visible = el => {
      if (!el) return false;
      const box = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return box.width > 1 && box.height > 1 && style.display !== 'none' && style.visibility !== 'hidden';
    };
    const controls = [...document.querySelectorAll('button, a, [role="button"], input[type="button"], input[type="submit"]')].filter(visible);
    const target = controls.find(el => /start reading now|commencer( la lecture)?|lire maintenant/i.test((el.innerText || el.value || el.getAttribute('aria-label') || '').trim()));
    if (!target) return { ok:false, error:'Start reading button not found' };
    const text = (target.innerText || target.value || target.getAttribute('aria-label') || '').trim();
    const box = target.getBoundingClientRect();
    const key = [location.href, text, Math.round(box.left), Math.round(box.top), Math.round(box.width), Math.round(box.height)].join('|');
    const last = window.__wpPressReaderStartReadingLast || { key: '', at: 0 };
    const now = Date.now();
    if (last.key === key && now - last.at < 10000) return { ok:true, skipped:true };
    window.__wpPressReaderStartReadingLast = { key, at: now };
    setTimeout(() => {
      try {
        target.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, view: window }));
        target.click();
      } catch {}
    }, 80);
    return { ok:true };
  })();
`;
const PRESSREADER_AUTO_START_READING = true;

const PRESSREADER_INTERACTION_TRACKER_JS = `
  (() => {
    if (window.__wpPressReaderInteractionTrackerActive) return { ok:true, active:true };
    window.__wpPressReaderInteractionTrackerActive = true;
    document.addEventListener('click', event => {
      if (!event.isTrusted) return;
      const target = event.target?.closest?.('button, a, [role="button"], article, figure, img, [class*="publication"], [class*="Publication"], [class*="cover"], [class*="Cover"], [class*="issue"], [class*="Issue"], [class*="tile"], [class*="Tile"], [class*="card"], [class*="Card"]');
      if (!target) return;
      const text = (target.innerText || target.value || target.getAttribute?.('aria-label') || target.getAttribute?.('title') || '').trim();
      const signature = [target.tagName, target.className, target.id, text].filter(Boolean).join(' ').toLowerCase();
      const isChrome = /menu|search|se connecter|sign in|inscrivez|mon dossier|calendar|filter|sort|commentaires/.test(signature) && !/lire|read/.test(signature);
      const isPublicationLike = /lire maintenant|start reading|read now|publication|cover|issue|newspaper|magazine|thumbnail|tile|card/.test(signature)
        || target.tagName === 'IMG'
        || !!target.closest?.('article, figure');
      if (isChrome || !isPublicationLike) return;
      window.__wpPressReaderLastUserClick = Date.now();
      try { console.log('[wp-pressreader-user-click]'); } catch {}
    }, true);
    return { ok:true, active:true };
  })();
`;

const PRESSREADER_PUBLICATION_PREFETCH_JS = `
  (() => {
    const state = window.__wpPressReaderPublicationPrefetch || {
      href: '',
      urls: new Set(),
      inflight: new Set(),
      done: new Set(),
      timer: 0,
      scans: 0,
    };
    window.__wpPressReaderPublicationPrefetch = state;

    const href = location.href || '';
    if (state.href !== href) {
      state.href = href;
      state.urls = new Set();
      state.inflight = new Set();
      state.done = new Set();
      state.scans = 0;
      if (state.timer) clearInterval(state.timer);
      state.timer = 0;
    }

    const absoluteUrl = value => {
      const raw = String(value || '').trim();
      if (!raw || raw.startsWith('data:') || raw.startsWith('blob:')) return '';
      try { return new URL(raw, location.href).href; } catch { return ''; }
    };
    const add = value => {
      const url = absoluteUrl(value);
      if (!url) return;
      if (!/^https?:/i.test(url)) return;
      if (!/(pressreader|newspaperdirect|ndcdn|page|pages|issue|image|img|thumbnail|jpg|jpeg|png|webp|avif|pdf)/i.test(url)) return;
      state.urls.add(url);
    };
    const addSrcset = value => {
      String(value || '').split(',').forEach(part => add(part.trim().split(/\\s+/)[0]));
    };
    const harvestUrlsFromText = text => {
      const body = String(text || '').slice(0, 300000);
      for (const match of body.matchAll(/https?:\\\\?\\/\\\\?\\/[^"'\\s<>]+/gi)) {
        add(match[0].replace(/\\\\\\//g, '/').replace(/\\\\u0026/g, '&'));
      }
      for (const match of body.matchAll(/["']((?:\\/|\\.\\/|\\.\\.\\/)[^"']*(?:page|issue|image|img|jpg|jpeg|png|webp|avif|pdf)[^"']*)["']/gi)) {
        add(match[1]);
      }
    };
    const harvestPerformance = () => {
      try {
        for (const entry of performance.getEntriesByType('resource') || []) add(entry.name);
      } catch {}
    };

    const attrs = [
      'src', 'href', 'poster',
      'data-src', 'data-original', 'data-lazy-src', 'data-url', 'data-href',
      'data-image', 'data-image-url', 'data-full', 'data-full-url',
      'data-page', 'data-page-url', 'data-thumb', 'data-thumbnail',
      'content',
    ];
    const srcsetAttrs = ['srcset', 'data-srcset', 'data-lazy-srcset'];

    const scanRoot = root => {
      const doc = root?.ownerDocument || document;
      const nodes = [...doc.querySelectorAll('img,source,link,a,[style],[data-src],[data-url],[data-page],[data-image],[data-full],[data-thumb]')];
      for (const el of nodes) {
        for (const attr of attrs) add(el.getAttribute?.(attr));
        for (const attr of srcsetAttrs) addSrcset(el.getAttribute?.(attr));
        const style = el.getAttribute?.('style') || '';
        const bgMatches = style.matchAll(/url\\((['"]?)(.*?)\\1\\)/gi);
        for (const match of bgMatches) add(match[2]);
        if (el.tagName === 'IMG') {
          try {
            add(el.currentSrc || el.src);
          } catch {}
        }
      }
      for (const script of [...doc.scripts || []]) {
        const text = script.src || script.textContent || '';
        harvestUrlsFromText(text);
      }
      for (const sheet of [...doc.styleSheets || []]) {
        let rules = [];
        try { rules = [...(sheet.cssRules || [])]; } catch {}
        for (const rule of rules) {
          const matches = String(rule.cssText || '').matchAll(/url\\((['"]?)(.*?)\\1\\)/gi);
          for (const match of matches) add(match[2]);
        }
      }
    };

    const startOne = url => {
      if (state.done.has(url) || state.inflight.has(url)) return;
      state.inflight.add(url);
      try {
        const preload = document.createElement('link');
        preload.rel = 'preload';
        preload.as = 'image';
        preload.href = url;
        preload.crossOrigin = 'anonymous';
        document.head?.appendChild(preload);
      } catch {}
      try {
        const image = new Image();
        image.decoding = 'async';
        image.loading = 'eager';
        image.onload = image.onerror = () => {
          state.inflight.delete(url);
          state.done.add(url);
        };
        image.src = url;
      } catch {
        state.inflight.delete(url);
        state.done.add(url);
      }
    };

    const pump = () => {
      state.scans += 1;
      scanRoot(document);
      harvestPerformance();
      const queue = [...state.urls].filter(url => !state.done.has(url) && !state.inflight.has(url));
      queue.slice(0, Math.max(3, 10 - state.inflight.size)).forEach(startOne);
      return {
        ok: true,
        href,
        discovered: state.urls.size,
        inflight: state.inflight.size,
        done: state.done.size,
        scans: state.scans,
      };
    };

    const result = pump();
    try { console.log('[wp-pressreader-prefetch]', JSON.stringify(result)); } catch {}
    return result;
  })();
`;

const PRESSREADER_CATALOG_EXTRACT_JS = `
  (() => {
    const elementStyleOk = el => {
      if (!el) return false;
      const style = getComputedStyle(el);
      return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0.05;
    };
    const hasUsableCoverSize = (el, box) => {
      const naturalWidth = Number(el?.naturalWidth || 0);
      const naturalHeight = Number(el?.naturalHeight || 0);
      return (box && box.width > 24 && box.height > 30) || (naturalWidth > 48 && naturalHeight > 58);
    };
    const absoluteUrl = value => {
      const raw = String(value || '').trim();
      if (!raw || raw.startsWith('data:') || raw.startsWith('blob:')) return '';
      try { return new URL(raw, location.href).href; } catch { return ''; }
    };
    const clean = value => String(value || '')
      .replace(/\\s+/g, ' ')
      .replace(/^(read|lire|ouvrir|open|view|voir)\\s+/i, '')
      .trim();
    const rejectText = value => {
      const text = clean(value).toLowerCase();
      return !text
        || text.length < 3
        || text.length > 96
        || /^(menu|search|catalog|catalogue|home|accueil|sign in|connexion|start reading now|commencer|filter|sort|share|close|next|prev|previous|back|retour)$/i.test(text);
    };
    const bestText = (node, img, link) => {
      const candidates = [
        img?.alt,
        img?.title,
        img?.getAttribute?.('aria-label'),
        link?.title,
        link?.getAttribute?.('aria-label'),
        node?.title,
        node?.getAttribute?.('aria-label'),
      ];
      const body = clean(node?.innerText || '');
      if (body) {
        body.split(/[\\r\\n]+| {2,}|\\|/).map(clean).filter(Boolean).forEach(line => candidates.push(line));
        candidates.push(body.slice(0, 92));
      }
      return clean(candidates.find(value => !rejectText(value)) || '');
    };
    const imageUrlFor = el => {
      if (!el) return '';
      const tag = String(el.tagName || '').toUpperCase();
      if (tag === 'IMG' || tag === 'SOURCE') {
        const src = el.currentSrc || el.src || el.getAttribute('src') || el.getAttribute('data-src') || el.getAttribute('data-original') || '';
        const srcset = el.srcset || el.getAttribute('srcset') || el.getAttribute('data-srcset') || '';
        const fromSrcset = String(srcset || '').split(',').map(part => part.trim().split(/\\s+/)[0]).find(Boolean);
        return absoluteUrl(src || fromSrcset);
      }
      const style = getComputedStyle(el);
      const match = String(style.backgroundImage || '').match(/url\\((['"]?)(.*?)\\1\\)/i);
      return absoluteUrl(match?.[2] || '');
    };
    const isCoverLike = (url, box, el) => {
      if (!url) return false;
      if (/sprite|logo|avatar|icon|flag|spinner|loader|blank|placeholder/i.test(url)) return false;
      if (!/(pressreader|newspaperdirect|prcdn|ndcdn|\\/img\\?|jpg|jpeg|png|webp|avif)/i.test(url)) return false;
      if (box && (box.width < 24 || box.height < 30) && !hasUsableCoverSize(el, box)) return false;
      return true;
    };
    const issueDateFrom = url => {
      const match = String(url || '').match(/(?:\\/|date=)(20\\d{6})(?:\\D|$)/);
      if (!match) return '';
      return match[1].replace(/^(\\d{4})(\\d{2})(\\d{2})$/, '$1-$2-$3');
    };
    const publicationKeyFrom = url => {
      try {
        const parsed = new URL(url, location.href);
        return parsed.pathname.replace(/\\/page\\/\\d+.*$/i, '').replace(/\\/\\d{12,}.*$/i, '').replace(/\\/$/, '');
      } catch {
        return String(url || '').split(/[?#]/)[0];
      }
    };
    const categoryIdFrom = url => {
      try {
        const parsed = new URL(url, location.href);
        const path = parsed.pathname.replace(/\\/$/, '');
        const parts = path.split('/').filter(Boolean);
        const index = parts.findIndex(part => part.toLowerCase() === 'catalog');
        const tail = index >= 0 ? parts.slice(index + 1).join('/') : parts.slice(-2).join('/');
        return (tail || 'featured').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'featured';
      } catch {
        return String(url || 'featured').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 80) || 'featured';
      }
    };
    const categoryTitleReject = value => {
      const text = clean(value);
      return rejectText(text)
        || /^(voir tout|tout voir|see all|view all|show all|afficher tout)$/i.test(text)
        || /\b(voir tout|tout voir|see all|view all|show all|afficher tout)\b/i.test(text);
    };
    const seeAllPattern = /\b(voir tout|tout voir|see all|view all|show all|afficher tout|toutes les publications|all publications)\b/i;
    const linkLabel = link => clean([
      link?.innerText,
      link?.textContent,
      link?.title,
      link?.getAttribute?.('aria-label'),
    ].filter(Boolean).join(' '));
    const nearestCatalogSection = link => {
      let node = link?.parentElement || null;
      for (let depth = 0; node && depth < 8; depth += 1, node = node.parentElement) {
        const hasHeading = !!node.querySelector?.('h1,h2,h3,h4,[role="heading"]');
        const coverCount = node.querySelectorAll?.('img,source,[style*="background"],[data-src],[data-original],[data-image],[data-thumbnail],[data-thumb]').length || 0;
        if (hasHeading && coverCount >= 1) return node;
        if (coverCount >= 3) return node;
      }
      return link?.closest?.('section,article,[role="region"],[class*="section"],[class*="Section"],[class*="shelf"],[class*="Shelf"],[class*="carousel"],[class*="Carousel"],[class*="row"],[class*="Row"]') || link?.parentElement;
    };
    const sectionTitleFor = (section, link) => {
      const headingSelectors = 'h1,h2,h3,h4,[role="heading"],[class*="title"],[class*="Title"],[class*="heading"],[class*="Heading"]';
      const heading = [...(section?.querySelectorAll?.(headingSelectors) || [])]
        .map(node => clean(node.innerText || node.textContent || node.getAttribute?.('aria-label') || ''))
        .find(value => !categoryTitleReject(value));
      if (heading) return heading;

      let node = link?.parentElement || null;
      for (let depth = 0; node && depth < 5; depth += 1, node = node.parentElement) {
        let sibling = node.previousElementSibling;
        while (sibling) {
          const text = clean(sibling.innerText || sibling.textContent || sibling.getAttribute?.('aria-label') || '');
          if (!categoryTitleReject(text)) {
            const firstLine = text.split(/[\\r\\n]+| {2,}|\\|/).map(clean).find(value => !categoryTitleReject(value));
            if (firstLine) return firstLine;
          }
          sibling = sibling.previousElementSibling;
        }
      }

      const lines = clean(section?.innerText || '')
        .split(/[\\r\\n]+| {2,}|\\|/)
        .map(value => clean(value))
        .filter(value => !categoryTitleReject(value));
      return lines.find(value => value.length <= 56) || '';
    };
    const categoryHint = (() => {
      try { return window.__wpPressReaderCategoryHint || null; } catch { return null; }
    })();
    const hintedTitle = clean(categoryHint?.title || '');
    const hintedId = clean(categoryHint?.id || '');
    const derivedCategoryId = hintedId || categoryIdFrom(location.href);
    const rawPageCategoryTitle = clean((document.querySelector('h1,[aria-current="page"],[class*="active"],[class*="selected"]')?.innerText || document.title || '').split('|')[0]);
    const derivedCategoryTitle = derivedCategoryId === 'featured' ? 'Featured' : derivedCategoryId.replace(/-/g, ' ');
    const currentCategory = {
      id: derivedCategoryId,
      title: hintedTitle || (!categoryTitleReject(rawPageCategoryTitle) ? rawPageCategoryTitle : derivedCategoryTitle) || 'Featured',
      url: categoryHint?.url || location.href,
    };
    const categories = [];
    const seenCategories = new Set([currentCategory.id]);
    categories.push(currentCategory);
    for (const link of document.querySelectorAll('a[href]')) {
      const href = absoluteUrl(link.href || link.getAttribute('href'));
      if (!href || !/pressreader/i.test(href) || !/\\/catalog(?:\\/|$|\\?)/i.test(href)) continue;
      const label = linkLabel(link);
      if (!seeAllPattern.test(label)) continue;
      const section = nearestCatalogSection(link);
      const title = sectionTitleFor(section, link);
      const id = categoryIdFrom(href);
      if (seenCategories.has(id)) continue;
      seenCategories.add(id);
      categories.push({ id, title: title || id.replace(/-/g, ' '), url: href });
      if (categories.length >= 40) break;
    }
    for (const link of document.querySelectorAll('a[href]')) {
      const href = absoluteUrl(link.href || link.getAttribute('href'));
      if (!href || !/pressreader/i.test(href) || !/\\/catalog(?:\\/|$|\\?)/i.test(href)) continue;
      const id = categoryIdFrom(href);
      if (seenCategories.has(id) || /^(featured|prev|previous|next|back|retour)$/i.test(id)) continue;
      const label = linkLabel(link);
      const section = nearestCatalogSection(link);
      const title = sectionTitleFor(section, link) || label;
      if (categoryTitleReject(title)) continue;
      seenCategories.add(id);
      categories.push({ id, title, url: href });
      if (categories.length >= 40) break;
    }
    const candidates = [
      ...document.querySelectorAll('img,source,[style*="background"],[data-src],[data-original],[data-image],[data-thumbnail],[data-thumb]'),
    ];
    const items = [];
    const seen = new Set();
    for (const el of candidates) {
      const box = el.getBoundingClientRect?.();
      if (!elementStyleOk(el) || !hasUsableCoverSize(el, box)) continue;
      const image = imageUrlFor(el);
      if (!isCoverLike(image, box, el)) continue;
      const link = el.closest?.('a[href]') || el.parentElement?.closest?.('a[href]') || el.closest?.('article,li,section,div')?.querySelector?.('a[href]');
      const container = el.closest?.('article,li,[role="article"],[class*="publication"],[class*="Publication"],[class*="issue"],[class*="Issue"],[class*="card"],[class*="Card"],[class*="tile"],[class*="Tile"]') || link || el.parentElement;
      const href = absoluteUrl(link?.href || link?.getAttribute?.('href') || container?.querySelector?.('a[href]')?.href || '');
      const title = bestText(container, el, link);
      if (!title && !href) continue;
      const key = publicationKeyFrom(href || image) + '|' + image;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({
        title: title || 'Publication',
        url: href || '',
        image,
        issueDate: issueDateFrom(href || image),
        categoryId: currentCategory.id,
        categoryTitle: currentCategory.title,
        key,
        source: location.href,
        rect: box ? { w: Math.round(box.width), h: Math.round(box.height) } : null,
      });
    }
    items.sort((a, b) => {
      const aw = a.rect?.w || 0;
      const bw = b.rect?.w || 0;
      return (bw - aw) || a.title.localeCompare(b.title);
    });
    return {
      ok: true,
      href: location.href,
      title: document.title || '',
      currentCategory,
      categories,
      items: items.slice(0, 80),
    };
  })();
`;

const PRESSREADER_CATALOG_SCROLL_JS = `
  new Promise(resolve => {
    const sleep = ms => new Promise(done => setTimeout(done, ms));
    (async () => {
      try {
        await sleep(350);
        const maxSteps = 10;
        let steps = 0;
        const pageHeight = () => Math.max(
          document.body?.scrollHeight || 0,
          document.documentElement?.scrollHeight || 0
        );
        while (steps < maxSteps) {
          const maxY = Math.max(0, pageHeight() - window.innerHeight);
          const nextY = Math.min(maxY, Math.round((steps + 1) * window.innerHeight * 0.85));
          window.scrollTo(0, nextY);
          await sleep(420);
          steps += 1;
          if (window.scrollY >= maxY - 8) break;
        }
        await sleep(650);
        resolve({ ok: true, steps, y: Math.round(window.scrollY), height: pageHeight() });
      } catch (error) {
        resolve({ ok: false, message: error?.message || String(error) });
      }
    })();
  });
`;

const PRESSREADER_NEWSPAPERS_EXTRACT_JS = `
  new Promise(resolve => {
    const sleep = ms => new Promise(done => setTimeout(done, ms));
    (async () => {
      const absoluteUrl = value => {
        const raw = String(value || '').trim();
        if (!raw || raw.startsWith('data:') || raw.startsWith('blob:')) return '';
        try { return new URL(raw, location.href).href; } catch { return ''; }
      };
      const clean = value => String(value || '').replace(/\\s+/g, ' ').trim();
      const visible = el => {
        if (!el) return false;
        const box = el.getBoundingClientRect?.();
        const style = getComputedStyle(el);
        return (!box || (box.width > 16 && box.height > 18)) && style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0.04;
      };
      const rejectTitle = value => {
        const text = clean(value).toLowerCase();
        return !text
          || text.length < 2
          || text.length > 80
          || /^(menu|catalogue|le catalogue|pour vous|puzzles|plus|cartes cadeaux|search|rechercher|tout voir|voir tout|close|next|previous|back)$/i.test(text);
      };
      const imageUrlFor = el => {
        if (!el) return '';
        const tag = String(el.tagName || '').toUpperCase();
        if (tag === 'IMG' || tag === 'SOURCE') {
          const src = el.currentSrc || el.src || el.getAttribute('src') || el.getAttribute('data-src') || el.getAttribute('data-original') || '';
          const srcset = el.srcset || el.getAttribute('srcset') || el.getAttribute('data-srcset') || '';
          const fromSrcset = String(srcset || '').split(',').map(part => part.trim().split(/\\s+/)[0]).find(Boolean);
          return absoluteUrl(src || fromSrcset);
        }
        const style = getComputedStyle(el);
        const match = String(style.backgroundImage || '').match(/url\\((['"]?)(.*?)\\1\\)/i);
        return absoluteUrl(match?.[2] || '');
      };
      const isCoverLike = url => !!url && /(pressreader|newspaperdirect|prcdn|ndcdn|\\/img\\?|jpg|jpeg|png|webp|avif)/i.test(url) && !/sprite|logo|avatar|icon|flag|spinner|loader|blank|placeholder/i.test(url);
      const issueDateFrom = (...values) => {
        const text = values.map(value => String(value || '')).join(' ');
        const iso = text.match(/\\b(20\\d{2})[-/](\\d{2})[-/](\\d{2})\\b/);
        if (iso) return iso[1] + '-' + iso[2] + '-' + iso[3];
        const compact = text.match(/\\b(20\\d{2})(\\d{2})(\\d{2})\\b/);
        if (compact) return compact[1] + '-' + compact[2] + '-' + compact[3];
        return '';
      };
      const textFromValue = value => {
        if (value == null) return '';
        if (typeof value === 'string' || typeof value === 'number') return clean(value);
        if (Array.isArray(value)) return clean(value.map(textFromValue).find(Boolean) || '');
        if (typeof value === 'object') {
          return textFromValue(value.text)
            || textFromValue(value.name)
            || textFromValue(value.title)
            || textFromValue(value.displayName)
            || textFromValue(value.label)
            || textFromValue(value.value)
            || textFromValue(value.en)
            || textFromValue(value.fr)
            || '';
        }
        return '';
      };
      const compactIssueDate = value => {
        const match = textFromValue(value).match(/(20\\d{2})[-/]?(\\d{2})[-/]?(\\d{2})/);
        return match ? match[1] + match[2] + match[3] : '';
      };
      const displayIssueDate = value => {
        const compact = compactIssueDate(value);
        return compact ? compact.replace(/^(\\d{4})(\\d{2})(\\d{2})$/, '$1-$2-$3') : textFromValue(value);
      };
      const publicationKeyFrom = value => {
        try {
          const parsed = new URL(value, location.href);
          return parsed.pathname
            .replace(/\\/page\\/\\d+.*$/i, '')
            .replace(/\\/20\\d{6}(?:\\/.*)?$/i, '')
            .replace(/\\/$/, '');
        } catch {
          return String(value || '').split(/[?#]/)[0];
        }
      };
      const bestText = (node, img, link) => {
        const candidates = [
          img?.alt,
          img?.title,
          img?.getAttribute?.('aria-label'),
          link?.title,
          link?.getAttribute?.('aria-label'),
          node?.title,
          node?.getAttribute?.('aria-label'),
        ];
        const lines = clean(node?.innerText || node?.textContent || '')
          .split(/\\s{2,}|\\|/)
          .map(clean)
          .filter(Boolean);
        lines.forEach(line => candidates.push(line));
        return clean(candidates.find(value => {
          const text = clean(value);
          return text && text.length >= 2 && text.length <= 96 && !/^(tout voir|voir tout|read|open|ouvrir|pr[eê]t)$/i.test(text) && !/\\b20\\d{2}[-/]?\\d{2}[-/]?\\d{2}\\b/.test(text);
        }) || '');
      };
      const sectionIdFor = title => {
        const slug = clean(title).toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
        const known = {
          'en-vedette': 'featured',
          'local': 'local',
          'national': 'national',
          'international': 'international',
          'quotidien': 'daily',
          'quotidiens': 'daily',
          'hebdomadaire': 'weekly',
          'hebdomadaires': 'weekly',
          'dimanche': 'sunday',
          'aujourd-hui': 'today',
          'sports': 'sports',
          'affaires-et-actualites': 'business-current-affairs',
          'toutes-les-nouvelles': 'all-news',
          'tous-les-journaux': 'all-newspapers',
          'les-plus-populaires-journaux': 'popular-newspapers',
        };
        return known[slug] || slug;
      };
      const isKnownSectionTitle = value => {
        const id = sectionIdFor(value);
        return /^(featured|local|national|international|daily|weekly|sunday|today|sports|business-current-affairs|all-news|all-newspapers|popular-newspapers)$/.test(id);
      };
      const stateImageFor = data => {
        const issue = data?.latestIssue || data?.latest || data?.issue || data?.currentIssue || data?.lastIssue || {};
        const existing = [
          data?.thumbnailUrl,
          data?.thumbnail?.url,
          data?.image,
          data?.imageUrl,
          data?.coverUrl,
          issue?.thumbnailUrl,
          issue?.thumbnail?.url,
          issue?.image,
          issue?.imageUrl,
          issue?.coverUrl,
          issue?.firstPage?.thumbnailUrl,
          issue?.firstPage?.url,
          issue?.firstPage?.imageUrl,
        ].map(textFromValue).find(isCoverLike);
        if (existing) return absoluteUrl(existing);
        const issueKey = textFromValue(issue?.key || issue?.issueKey || data?.issueKey || data?.latestIssueKey);
        if (issueKey) return 'https://i.prcdn.co/img?file=' + encodeURIComponent(issueKey) + '&page=1&width=320';
        const cid = textFromValue(issue?.cid || data?.cid || data?.contentId || data?.publicationId || data?.id);
        const date = compactIssueDate(issue?.issueDate || data?.latestIssueDate || data?.issueDate || data?.date || data?.publicationDate);
        return cid && date ? 'https://i.prcdn.co/img?cid=' + encodeURIComponent(cid) + '&date=' + date + '&page=1&width=320' : '';
      };
      const stateUrlFor = (data, entity) => {
        const raw = textFromValue(data?.hrefSEO || data?.href || data?.url || data?.canonicalUrl || data?.seoLink);
        if (raw) {
          if (/^(newspapers|magazines|catalog)\\//i.test(raw)) return absoluteUrl('/fr/' + raw.replace(/^\\/+/, ''));
          return absoluteUrl(raw);
        }
        const slug = textFromValue(data?.slug || data?.urlSlug || data?.titleSlug);
        if (slug) return absoluteUrl('/fr/newspapers/n/' + slug);
        const issue = data?.latestIssue || data?.latest || data?.issue || data?.currentIssue || data?.lastIssue || {};
        const cid = textFromValue(issue?.cid || data?.cid || data?.contentId || data?.publicationId || entity?.id || data?.id);
        return cid ? absoluteUrl('/fr/catalog/' + encodeURIComponent(cid)) : '';
      };
      const publicationFromState = (entity, sectionTitle) => {
        const data = entity?.data && typeof entity.data === 'object' ? entity.data : entity;
        if (!data || typeof data !== 'object') return null;
        const issue = data.latestIssue || data.latest || data.issue || data.currentIssue || data.lastIssue || {};
        const title = textFromValue(data.displayName || data.title || data.name || data.publicationName || entity?.displayName || entity?.title);
        const url = stateUrlFor(data, entity);
        const image = stateImageFor(data);
        if (!title && !url && !image) return null;
        const cid = textFromValue(issue.cid || data.cid || data.contentId || data.publicationId || entity?.id || data.id);
        const issueDate = displayIssueDate(issue.issueDate || data.latestIssueDate || data.issueDate || data.date || data.publicationDate);
        return {
          key: textFromValue(issue.key || data.key) || cid || publicationKeyFrom(url || image) || title,
          title: title || 'Publication',
          image,
          thumbnailUrl: image,
          url,
          openUrl: url,
          issueDate,
          cid,
          categoryId: 'actualites',
          categoryTitle: sectionTitle || 'Actualites',
          source: location.href,
        };
      };
      const captureWebpackRequire = () => {
        if (window.__wpPressReaderWebpackRequire) return window.__wpPressReaderWebpackRequire;
        let captured = null;
        try {
          const chunks = self.webpackChunkpressreaderclient = self.webpackChunkpressreaderclient || [];
          chunks.push([[Date.now()], {}, runtime => { captured = runtime; }]);
          if (captured) window.__wpPressReaderWebpackRequire = captured;
        } catch {}
        return captured;
      };
      const looksLikeStateSection = value => {
        if (!value || typeof value !== 'object') return false;
        const entities = value.items?.entities || value.publications || value.items;
        return Array.isArray(entities) && entities.length > 0 && !!(value.title || value.displayName || value.name || value.slug || value.id);
      };
      const entitiesForStateSection = section => {
        const raw = section?.items?.entities || section?.publications || section?.items || section?.data || [];
        return Array.isArray(raw) ? raw : [];
      };
      const normalizeStateSection = (section, index = 0) => {
        const title = textFromValue(section?.title || section?.displayName || section?.name || section?.header || section?.slug || section?.id);
        if (!title || rejectTitle(title)) return null;
        const publications = unique(entitiesForStateSection(section)
          .map(entity => publicationFromState(entity, title))
          .filter(Boolean))
          .slice(0, 48);
        if (!publications.length) return null;
        return {
          id: sectionIdFor(title) || textFromValue(section?.slug || section?.id) || 'section-' + index,
          title,
          top: index,
          publications,
          items: publications,
          count: publications.length,
        };
      };
      const extractStateSections = () => {
        const req = captureWebpackRequire();
        let state = null;
        try { state = req?.(147)?.M_?.getState?.(); } catch {}
        if (!state) return [];
        const arrays = [];
        try {
          const rawSections = req?.(8806)?.M4?.(state);
          if (Array.isArray(rawSections)) arrays.push(rawSections);
        } catch {}
        const seen = new WeakSet();
        const visit = (value, depth = 0) => {
          if (!value || depth > 7 || arrays.length > 24) return;
          if (typeof value !== 'object') return;
          if (seen.has(value)) return;
          seen.add(value);
          if (Array.isArray(value)) {
            if (value.some(looksLikeStateSection)) arrays.push(value);
            value.slice(0, 80).forEach(child => visit(child, depth + 1));
            return;
          }
          Object.values(value).slice(0, 80).forEach(child => visit(child, depth + 1));
        };
        visit(state);
        const ranked = arrays
          .map(array => array.map(normalizeStateSection).filter(Boolean))
          .filter(sections => sections.length)
          .sort((a, b) => {
            const knownA = a.filter(section => isKnownSectionTitle(section.title)).length;
            const knownB = b.filter(section => isKnownSectionTitle(section.title)).length;
            const countA = a.reduce((sum, section) => sum + section.publications.length, 0);
            const countB = b.reduce((sum, section) => sum + section.publications.length, 0);
            return (knownB - knownA) || (b.length - a.length) || (countB - countA);
          });
        return ranked.find(sections => sections.some(section => isKnownSectionTitle(section.title))) || [];
      };
      const documentTop = el => {
        const box = el?.getBoundingClientRect?.();
        return box ? box.top + window.scrollY : 0;
      };
      const collectSectionHeadings = () => {
        const headings = [...document.querySelectorAll('h1,h2,h3,h4,[role="heading"],.title,[class*="title"],[class*="Title"]')]
          .map(node => {
            const text = clean(node.innerText || node.textContent || node.getAttribute?.('aria-label') || '');
            return { node, title: text, id: sectionIdFor(text), top: documentTop(node) };
          })
          .filter(item => visible(item.node) && !rejectTitle(item.title) && isKnownSectionTitle(item.title))
          .sort((a, b) => a.top - b.top);
        const seen = new Map();
        headings.forEach(item => {
          const existing = seen.get(item.id);
          if (!existing || item.top < existing.top) seen.set(item.id, item);
        });
        return [...seen.values()].sort((a, b) => a.top - b.top);
      };
      const headingForTop = (headings, top) => {
        let active = headings[0] || { id: 'featured', title: 'En vedette', top: 0 };
        for (const heading of headings) {
          if (heading.top <= top + 24) active = heading;
          else break;
        }
        return active;
      };
      const cardFor = img => img.closest?.('a[href],article,li,[role="article"],[class*="publication"],[class*="Publication"],[class*="issue"],[class*="Issue"],[class*="card"],[class*="Card"],[class*="tile"],[class*="Tile"],[class*="item"],[class*="Item"]') || img.parentElement;
      const publicationFromImage = (img, sectionTitle) => {
        const card = cardFor(img);
        const link = card?.closest?.('a[href]') || card?.querySelector?.('a[href]') || img.closest?.('a[href]');
        const image = imageUrlFor(img);
        if (!isCoverLike(image)) return null;
        const url = absoluteUrl(link?.href || link?.getAttribute?.('href') || '');
        const title = bestText(card, img, link);
        if (!title && !url) return null;
        const keyUrl = url ? url.replace(/([?#].*)$/, '') : '';
        return {
          key: keyUrl || [image, title].filter(Boolean).join('|'),
          title: title || 'Publication',
          image,
          thumbnailUrl: image,
          url,
          openUrl: url,
          issueDate: issueDateFrom(url, image, card?.innerText || ''),
          categoryId: 'actualites',
          categoryTitle: sectionTitle || 'Actualites',
          source: location.href,
        };
      };
      const unique = items => {
        const seen = new Set();
        return items.filter(item => {
          const key = item.key || item.url || item.image || item.title;
          if (!key || seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      };
      const publicationMatchKey = value => clean(value).toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').replace(/[^a-z0-9]+/g, '');
      const enhanceSectionsWithDom = (sections, domSections) => {
        if (!sections.length || !domSections.length) return sections;
        const domByKey = new Map();
        domSections.flatMap(section => section.publications || []).forEach(item => {
          [item.title, publicationKeyFrom(item.url || item.openUrl || ''), item.cid].filter(Boolean).forEach(value => {
            const key = publicationMatchKey(value);
            if (key && !domByKey.has(key)) domByKey.set(key, item);
          });
        });
        return sections.map(section => {
          const publications = unique((section.publications || []).map(item => {
            const match = domByKey.get(publicationMatchKey(item.title))
              || domByKey.get(publicationMatchKey(publicationKeyFrom(item.url || item.openUrl || '')))
              || domByKey.get(publicationMatchKey(item.cid));
            if (!match) return item;
            return {
              ...item,
              image: match.image || item.image,
              thumbnailUrl: match.thumbnailUrl || match.image || item.thumbnailUrl,
              url: match.url || item.url,
              openUrl: match.openUrl || match.url || item.openUrl,
              issueDate: item.issueDate || match.issueDate,
            };
          })).slice(0, 48);
          return { ...section, publications, items: publications, count: publications.length };
        }).filter(section => section.publications.length);
      };
      const titleForSectionNode = node => {
        const selectors = '.header-title-wrapper .title,h1,h2,h3,h4,[role="heading"],[class*="title"],[class*="Title"]';
        return [...(node?.querySelectorAll?.(selectors) || [])]
          .map(item => clean(item.innerText || item.textContent || item.getAttribute?.('aria-label') || ''))
          .find(value => !rejectTitle(value) && isKnownSectionTitle(value)) || '';
      };
      const extractContainerSections = () => {
        const nodes = [...document.querySelectorAll('section.layout-section,section.page-section,.section-scroller-stripe,[class*="section-scroller-stripe"]')];
        const sections = nodes.map((node, index) => {
          const title = titleForSectionNode(node);
          if (!title) return null;
          const imageNodes = [...node.querySelectorAll('img,source,[style*="background"],[data-src],[data-original],[data-image],[data-thumbnail],[data-thumb]')].filter(visible);
          const publications = unique(imageNodes.map(img => publicationFromImage(img, title)).filter(Boolean)).slice(0, 48);
          if (!publications.length) return null;
          return { id: sectionIdFor(title), title, top: documentTop(node) || index, publications, items: publications, count: publications.length };
        }).filter(Boolean);
        const byId = new Map();
        sections.forEach(section => {
          const existing = byId.get(section.id);
          if (!existing || section.publications.length > existing.publications.length) byId.set(section.id, section);
        });
        return [...byId.values()].sort((a, b) => a.top - b.top);
      };
      const extractHeadingSections = () => {
        const headings = collectSectionHeadings();
        const bySection = new Map();
        const images = [...document.querySelectorAll('img,source,[style*="background"],[data-src],[data-original],[data-image],[data-thumbnail],[data-thumb]')].filter(visible);
        for (const img of images) {
          const heading = headingForTop(headings, documentTop(cardFor(img) || img));
          const publication = publicationFromImage(img, heading.title);
          if (!publication) continue;
          const current = bySection.get(heading.id) || {
            id: heading.id,
            title: heading.title,
            top: heading.top,
            publications: [],
          };
          current.publications.push(publication);
          bySection.set(heading.id, current);
        }
        return [...bySection.values()]
          .sort((a, b) => a.top - b.top)
          .map(section => {
            const publications = unique(section.publications).slice(0, 48);
            return { id: section.id, title: section.title, publications, items: publications, count: publications.length };
          })
          .filter(section => section.publications.length);
      };
      const extractSections = () => {
        const domSections = extractContainerSections();
        const headingSections = domSections.length ? domSections : extractHeadingSections();
        const stateSections = extractStateSections();
        if (stateSections.length) return enhanceSectionsWithDom(stateSections, headingSections);
        return headingSections;
      };

      try {
        await sleep(900);
        const pageHeight = () => Math.max(document.body?.scrollHeight || 0, document.documentElement?.scrollHeight || 0);
        const stops = [];
        for (let i = 0; i < 7; i += 1) stops.push(Math.round(i * window.innerHeight * 0.82));
        stops.push(Math.max(0, pageHeight() - window.innerHeight));
        for (const y of stops) {
          window.scrollTo(0, Math.max(0, y));
          await sleep(520);
        }
        window.scrollTo(0, 0);
        await sleep(500);
        const sections = extractSections();
        const items = unique(sections.flatMap(section => section.publications)).slice(0, 180);
        resolve({
          ok: true,
          href: location.href,
          title: document.title || '',
          currentCategory: { id: 'actualites', title: 'Actualites', url: location.href },
          sections,
          subcategories: sections,
          items,
        });
      } catch (error) {
        resolve({ ok: false, message: error?.message || String(error), href: location.href });
      }
    })();
  });
`;

function emptyPressReaderCatalogIndex() {
  return { updatedAt: 0, categories: [] };
}

function parsePressReaderCatalogIndex(raw) {
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!parsed || !Array.isArray(parsed.categories)) return emptyPressReaderCatalogIndex();
    const rejectCategory = category => {
      const id = String(category.id || '').trim().toLowerCase();
      const title = String(category.title || '').trim().toLowerCase();
      return !id || /^(prev|previous|next|back|retour)$/.test(id) || /^(prev|previous|next|back|retour)$/.test(title);
    };
    return {
      updatedAt: Number(parsed.updatedAt) || 0,
      categories: parsed.categories.map(category => ({
        id: String(category.id || '').trim(),
        title: String(category.title || category.id || 'Category').trim(),
        url: String(category.url || '').trim(),
        enabled: category.enabled !== false,
        updatedAt: Number(category.updatedAt) || 0,
        publications: Array.isArray(category.publications) ? category.publications : [],
      })).filter(category => category.id && !rejectCategory(category)),
    };
  } catch {
    return emptyPressReaderCatalogIndex();
  }
}

function parsePressReaderCategorySelection(raw) {
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function parsePressReaderGuardrail(raw) {
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!parsed || typeof parsed !== 'object') return { blockedUntil: 0, reason: '' };
    return {
      blockedUntil: Number(parsed.blockedUntil) || 0,
      reason: String(parsed.reason || '').trim(),
    };
  } catch {
    return { blockedUntil: 0, reason: '' };
  }
}

function pressReaderCategoryFromUrl(url = '', title = '') {
  let id = 'featured';
  try {
    const parsed = new URL(url, PRESSREADER_URL);
    const parts = parsed.pathname.replace(/\/$/, '').split('/').filter(Boolean);
    const catalogIndex = parts.findIndex(part => part.toLowerCase() === 'catalog');
    const tail = catalogIndex >= 0 ? parts.slice(catalogIndex + 1).join('/') : parts.slice(-2).join('/');
    id = tail || 'featured';
  } catch {
    id = title || 'featured';
  }
  id = String(id).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'featured';
  return {
    id,
    title: String(title || id.replace(/-/g, ' ')).trim() || 'Featured',
    url,
  };
}

function mergePressReaderCatalogIndex(index, payload = {}, selection = {}) {
  const now = Date.now();
  const base = parsePressReaderCatalogIndex(index);
  const byCategory = new Map(base.categories.map(category => [category.id, {
    ...category,
    publications: Array.isArray(category.publications) ? [...category.publications] : [],
  }]));
  const payloadCategories = Array.isArray(payload.categories) ? payload.categories : [];
  const payloadCategory = payload.currentCategory || pressReaderCategoryFromUrl(payload.href || '', payload.title || '');
  const allCategories = [payloadCategory, ...payloadCategories].filter(category => category?.id);
  allCategories.forEach(category => {
    const existing = byCategory.get(category.id) || { id: category.id, publications: [] };
    byCategory.set(category.id, {
      ...existing,
      id: category.id,
      title: category.title || existing.title || category.id,
      url: category.url || existing.url || '',
      enabled: Object.prototype.hasOwnProperty.call(selection, category.id) ? selection[category.id] !== false : existing.enabled !== false,
      updatedAt: existing.updatedAt || 0,
      publications: existing.publications || [],
    });
  });

  const currentCategory = byCategory.get(payloadCategory.id) || {
    ...payloadCategory,
    enabled: Object.prototype.hasOwnProperty.call(selection, payloadCategory.id) ? selection[payloadCategory.id] !== false : true,
    publications: [],
  };
  const publicationMap = new Map((currentCategory.publications || []).map(item => [item.key || item.url || item.image || item.title, item]));
  (Array.isArray(payload.items) ? payload.items : []).forEach(item => {
    const key = item.key || item.url || item.image || item.title;
    if (!key) return;
    publicationMap.set(key, {
      ...publicationMap.get(key),
      ...item,
      categoryId: item.categoryId || currentCategory.id,
      categoryTitle: item.categoryTitle || currentCategory.title,
      harvestedAt: now,
    });
  });
  byCategory.set(currentCategory.id, {
    ...currentCategory,
    updatedAt: payload.items?.length ? now : currentCategory.updatedAt || 0,
    publications: [...publicationMap.values()]
      .sort((a, b) => (b.issueDate || '').localeCompare(a.issueDate || '') || String(a.title || '').localeCompare(String(b.title || '')))
      .slice(0, 220),
  });

  return {
    updatedAt: now,
    categories: [...byCategory.values()]
      .sort((a, b) => String(a.title || '').localeCompare(String(b.title || '')))
      .slice(0, 80),
  };
}

function flattenPressReaderIndex(index, selection = {}) {
  const parsed = parsePressReaderCatalogIndex(index);
  return parsed.categories
    .filter(category => Object.prototype.hasOwnProperty.call(selection, category.id) ? selection[category.id] !== false : category.enabled !== false)
    .flatMap(category => (category.publications || []).map(item => ({
      ...item,
      categoryId: item.categoryId || category.id,
      categoryTitle: item.categoryTitle || category.title,
    })));
}

function pressReaderText(value) {
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value).trim();
  if (Array.isArray(value)) return value.map(pressReaderText).find(Boolean) || '';
  if (typeof value === 'object') {
    return pressReaderText(value.text)
      || pressReaderText(value.name)
      || pressReaderText(value.title)
      || pressReaderText(value.displayName)
      || pressReaderText(value.label)
      || pressReaderText(value.value)
      || pressReaderText(value.en)
      || pressReaderText(value.fr)
      || '';
  }
  return '';
}

function collectPressReaderValues(value, predicate, out = [], seen = new Set()) {
  if (value == null || out.length > 160) return out;
  if (typeof value === 'object') {
    if (seen.has(value)) return out;
    seen.add(value);
  }
  if (predicate(value)) out.push(value);
  if (Array.isArray(value)) {
    value.forEach(item => collectPressReaderValues(item, predicate, out, seen));
  } else if (typeof value === 'object') {
    Object.values(value).forEach(item => collectPressReaderValues(item, predicate, out, seen));
  }
  return out;
}

function findPressReaderImageUrl(value) {
  const urls = collectPressReaderValues(value, item => (
    typeof item === 'string'
    && /^https?:\/\//i.test(item)
    && /(cover|thumbnail|image|img|jpg|jpeg|png|webp|avif|pressreader|newspaperdirect|prcdn|ndcdn)/i.test(item)
  ));
  return urls[0] || '';
}

function findPressReaderWebUrl(value) {
  const urls = collectPressReaderValues(value, item => (
    typeof item === 'string'
    && (/^https?:\/\//i.test(item) || item.startsWith('/'))
    && /pressreader\.com|^\/[a-z]{2,}(?:\/|$)|^\/catalog(?:\/|$)/i.test(item)
    && !/(jpg|jpeg|png|webp|avif|gif)(?:[?#]|$)/i.test(item)
  ));
  const raw = urls[0] || '';
  if (!raw) return '';
  return normalizePressReaderWebUrl(raw);
}

function normalizePressReaderWebUrl(raw = '') {
  if (!raw) return '';
  try {
    const parsed = new URL(raw, PRESSREADER_URL);
    const host = parsed.hostname.toLowerCase();
    if (host === 'pressreader.com' || host === 'www.pressreader.com') {
      const proxy = new URL(PRESSREADER_PROXY_ORIGIN);
      parsed.protocol = proxy.protocol;
      parsed.host = proxy.host;
    }
    return parsed.href;
  } catch {
    return raw;
  }
}

function compactPressReaderDate(value) {
  const raw = pressReaderText(value);
  if (!raw) return '';
  const ymd = raw.match(/(20\d{2})[-/]?(\d{2})[-/]?(\d{2})/);
  return ymd ? `${ymd[1]}${ymd[2]}${ymd[3]}` : '';
}

function displayPressReaderDate(value) {
  const raw = pressReaderText(value);
  const ymd = raw.match(/(20\d{2})[-/]?(\d{2})[-/]?(\d{2})/);
  return ymd ? `${ymd[1]}-${ymd[2]}-${ymd[3]}` : raw;
}

function pressReaderIssueFor(item = {}) {
  return item?.latestIssue
    || item?.latest
    || item?.issue
    || item?.currentIssue
    || item?.lastIssue
    || {};
}

function buildPressReaderThumbnailUrl(item = {}) {
  const existing = findPressReaderImageUrl(item);
  if (existing) return existing;
  const issue = pressReaderIssueFor(item);
  const issueKey = pressReaderText(issue?.key || item?.issueKey || item?.latestIssueKey);
  if (issueKey) return `https://i.prcdn.co/img?file=${encodeURIComponent(issueKey)}&page=1&width=240`;
  const cid = pressReaderText(issue?.cid || item?.cid || item?.contentId || item?.publicationId || item?.id);
  const date = compactPressReaderDate(issue?.issueDate || item?.latestIssueDate || item?.issueDate || item?.date || item?.publicationDate);
  if (cid && date) return `https://i.prcdn.co/img?cid=${encodeURIComponent(cid)}&date=${date}&page=1&width=240`;
  return '';
}

function buildPressReaderPublicationUrl(item = {}) {
  const existing = findPressReaderWebUrl(item);
  if (existing) return existing;
  const title = pressReaderText(item?.slug || item?.urlSlug || item?.titleSlug || item?.name || item?.title || item?.displayName);
  const country = pressReaderText(item?.country?.slug || item?.countrySlug || item?.country?.name || item?.countryName || item?.country);
  if (title && country) return normalizePressReaderWebUrl(`/${pressReaderSlug(country)}/${pressReaderSlug(title)}`);
  const cid = pressReaderText(item?.cid || item?.contentId || item?.publicationId || item?.id);
  if (cid) return `${PRESSREADER_CATALOG_URL}/${encodeURIComponent(cid)}`;
  return '';
}

function extractPressReaderCidTokens(value) {
  const tokens = new Set();
  const visit = (node, key = '') => {
    if (node == null) return;
    if (Array.isArray(node)) {
      node.forEach(item => visit(item, key));
      return;
    }
    if (typeof node === 'string' || typeof node === 'number') {
      if (/cid|content|category|publication|group|id/i.test(key)) {
        String(node).split(/[,\s]+/).forEach(part => {
          const clean = part.trim();
          if (/^[a-z0-9]{3,6}$/i.test(clean)) tokens.add(clean);
        });
      }
      return;
    }
    if (typeof node === 'object') {
      Object.entries(node).forEach(([childKey, childValue]) => visit(childValue, childKey));
    }
  };
  visit(value);
  return [...tokens];
}

function collectPressReaderNavNodes(value, out = [], seen = new Set()) {
  if (!value || typeof value !== 'object') return out;
  if (seen.has(value)) return out;
  seen.add(value);
  const label = pressReaderText(value);
  const cids = extractPressReaderCidTokens(value);
  if (label || cids.length) out.push({ label, cids, raw: value });
  if (Array.isArray(value)) value.forEach(item => collectPressReaderNavNodes(item, out, seen));
  else Object.values(value).forEach(item => collectPressReaderNavNodes(item, out, seen));
  return out;
}

function findPressReaderNewspaperCids(navData) {
  const nodes = collectPressReaderNavNodes(navData);
  const matches = nodes.filter(node => /journaux|newspapers?/i.test(node.label || ''));
  const preferred = matches[0];
  const cids = preferred?.cids?.length ? preferred.cids : [];
  return cids.length ? cids : PRESSREADER_ACTUALITES_MAGAZINE_CIDS;
}

function findPressReaderPublicationArray(data) {
  const arrays = collectPressReaderValues(data, item => (
    Array.isArray(item)
    && item.some(child => child && typeof child === 'object' && (pressReaderText(child.title || child.name || child.displayName) || findPressReaderImageUrl(child)))
  ));
  return arrays.sort((a, b) => b.length - a.length)[0] || [];
}

function pressReaderCatalogEndpoint({ offset = 0, limit = 30, orderBy = 'searchrank desc', filters = {} } = {}) {
  const params = new URLSearchParams();
  params.set('offset', String(Math.max(0, Number(offset) || 0)));
  params.set('limit', String(Math.max(1, Math.min(100, Number(limit) || 30))));
  if (orderBy) params.set('orderBy', orderBy);
  if (filters.has?.length) params.set('has', filters.has.join(','));
  if (filters.in?.length) params.set('in', Array.isArray(filters.in[0]) ? filters.in.map(group => group.join(',')).join('&in=') : filters.in.join(','));
  if (filters.exc?.length) params.set('exc', filters.exc.join(','));
  if (filters.cid?.length) params.set('cid', filters.cid.join(','));
  if (filters.releaseFrequency) params.set('releaseFrequency', String(filters.releaseFrequency));
  if (filters.issueDate) params.set('issueDate', String(filters.issueDate));
  return `/services/catalog/v2/publications?${params.toString().replace(/%26in%3D/g, '&in=')}`;
}

function pressReaderActualitesNewspaperEndpoints() {
  const filters = {
    has: [PRESSREADER_CATEGORY_IDS.newspapers],
  };
  return [0, 30, 60, 90, 120, 150].map(offset => pressReaderCatalogEndpoint({
    offset,
    limit: 30,
    orderBy: 'searchrank desc',
    filters,
  }));
}

function pressReaderTodayIssueDate() {
  const now = new Date();
  return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
}

function pressReaderActualitesNewspaperSectionRequests() {
  const newspaper = PRESSREADER_CATEGORY_IDS.newspapers;
  const section = (id, title, endpoints, options = {}) => ({ id, title, endpoints, ...options });
  return [
    section('featured', 'En vedette', [
      pressReaderCatalogEndpoint({ offset: 0, limit: 24, orderBy: 'searchrank desc', filters: { has: [newspaper] } }),
    ]),
    section('local', 'Local', [], {
      deriveFromAll: item => PRESSREADER_LOCAL_NEWSPAPER_PATTERN.test(pressReaderSearchText(item)),
    }),
    section('national', 'National', [], {
      deriveFromAll: item => PRESSREADER_CANADIAN_NEWSPAPER_PATTERN.test(pressReaderSearchText(item)),
    }),
    section('international', 'International', [], {
      deriveFromAll: item => !PRESSREADER_CANADIAN_NEWSPAPER_PATTERN.test(pressReaderSearchText(item)),
    }),
    section('daily', 'Quotidien', [
      pressReaderCatalogEndpoint({ offset: 0, limit: 24, orderBy: 'rank desc', filters: { has: [newspaper], releaseFrequency: 'Daily' } }),
    ]),
    section('weekly', 'Hebdomadaire', [
      pressReaderCatalogEndpoint({ offset: 0, limit: 24, orderBy: 'rank desc', filters: { has: [newspaper], releaseFrequency: 'Weekly' } }),
    ]),
    section('sunday', 'Dimanche', [
      pressReaderCatalogEndpoint({ offset: 0, limit: 24, orderBy: 'rank desc', filters: { has: [newspaper], releaseFrequency: 'Sunday' } }),
    ], {
      fallbackFromAll: item => PRESSREADER_SUNDAY_NEWSPAPER_PATTERN.test(pressReaderSearchText(item)),
    }),
    section('today', "Aujourd'hui", [
      pressReaderCatalogEndpoint({ offset: 0, limit: 24, orderBy: 'rank desc', filters: { has: [newspaper], issueDate: pressReaderTodayIssueDate() } }),
    ]),
    section('sports', 'Sports', [
      pressReaderCatalogEndpoint({ offset: 0, limit: 24, orderBy: 'rank desc', filters: { has: [newspaper, PRESSREADER_CATEGORY_IDS.sports] } }),
    ], {
      fallbackFromAll: item => /sports?|hockey|football|soccer|tennis|baseball|basketball|golf|nhl|nfl|mlb|nba/i.test(pressReaderSearchText(item)),
    }),
    section('business-current-affairs', 'Affaires et Actualités', [
      pressReaderCatalogEndpoint({ offset: 0, limit: 24, orderBy: 'rank desc', filters: { has: [newspaper, PRESSREADER_CATEGORY_IDS.businessFinance] } }),
    ], {
      fallbackFromAll: item => PRESSREADER_BUSINESS_NEWSPAPER_PATTERN.test(pressReaderSearchText(item)),
    }),
    section('all-news', 'Toutes les Nouvelles', [0, 30, 60].map(offset => pressReaderCatalogEndpoint({
      offset,
      limit: 30,
      orderBy: 'searchrank desc',
      filters: { has: [newspaper] },
    }))),
    section('popular-newspapers', 'Les Plus Populaires Journaux', [
      pressReaderCatalogEndpoint({ offset: 0, limit: 30, orderBy: 'rank desc', filters: { has: [newspaper] } }),
    ]),
  ];
}

function pressReaderActualitesFallbackEndpoints() {
  return [0, 30, 60].map(offset => pressReaderCatalogEndpoint({
    offset,
    limit: 30,
    orderBy: 'latestIssueDate desc',
    filters: { has: [PRESSREADER_CATEGORY_IDS.newspapers] },
  }));
}

function normalizePressReaderTitleForRank(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, 'and')
    .replace(/\([^)]*\)/g, '')
    .replace(/[^a-z0-9]+/gi, ' ')
    .trim()
    .toLowerCase();
}

function pressReaderMetadataText(item = {}, keys = []) {
  for (const key of keys) {
    const direct = pressReaderText(item?.[key]);
    if (direct) return direct;
  }
  const values = collectPressReaderValues(item, value => (
    value && typeof value === 'object' && keys.some(key => Object.prototype.hasOwnProperty.call(value, key))
  ));
  for (const value of values) {
    for (const key of keys) {
      const text = pressReaderText(value?.[key]);
      if (text) return text;
    }
  }
  return '';
}

function pressReaderSearchText(item = {}) {
  return [
    item.title,
    item.categoryTitle,
    item.country,
    item.language,
    item.publisher,
    item.cid,
  ].filter(Boolean).join(' ');
}

function sortPressReaderPublications(items = []) {
  return [...items].sort((a, b) => (
    (b.issueDate || '').localeCompare(a.issueDate || '')
    || String(a.title || '').localeCompare(String(b.title || ''))
  ));
}

function uniquePressReaderPublications(items = [], limit = 36) {
  const seen = new Set();
  return items.filter(item => {
    const key = item.cid || item.url || item.image || normalizePressReaderTitleForRank(item.title);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, limit);
}

function buildPressReaderNewspaperSections(items = []) {
  const sorted = sortPressReaderPublications(items);
  const sectionDefs = [
    {
      id: 'canada-quebec',
      title: 'Canada et Québec',
      matcher: item => PRESSREADER_CANADIAN_NEWSPAPER_PATTERN.test(pressReaderSearchText(item)),
    },
    {
      id: 'international',
      title: 'International',
      matcher: item => !PRESSREADER_CANADIAN_NEWSPAPER_PATTERN.test(pressReaderSearchText(item)),
    },
    {
      id: 'business',
      title: 'Affaires',
      matcher: item => PRESSREADER_BUSINESS_NEWSPAPER_PATTERN.test(pressReaderSearchText(item)),
    },
    {
      id: 'daily',
      title: 'Quotidiens',
      matcher: item => PRESSREADER_DAILY_NEWSPAPER_PATTERN.test(pressReaderSearchText(item)),
    },
  ];
  const sections = sectionDefs
    .map(section => ({
      id: section.id,
      title: section.title,
      publications: uniquePressReaderPublications(sorted.filter(section.matcher), 30),
    }))
    .filter(section => section.publications.length);
  sections.push({
    id: 'all-newspapers',
    title: 'Tous les journaux',
    publications: uniquePressReaderPublications(sorted, 48),
  });
  return sections;
}

function normalizePressReaderApiPublication(item, index = 0, category = {}) {
  const issue = pressReaderIssueFor(item);
  const title = pressReaderText(item?.title)
    || pressReaderText(item?.name)
    || pressReaderText(item?.displayName)
    || pressReaderText(item?.publicationName)
    || pressReaderText(item)
    || `Publication ${index + 1}`;
  const cid = pressReaderText(issue?.cid || item?.cid || item?.contentId || item?.publicationId || item?.id);
  const issueDate = displayPressReaderDate(issue?.issueDate || item?.latestIssueDate || item?.issueDate || item?.date || item?.publicationDate);
  const country = pressReaderMetadataText(item, ['countryName', 'country', 'regionName', 'region', 'iso']);
  const language = pressReaderMetadataText(item, ['languageName', 'language', 'lang', 'culture']);
  const publisher = pressReaderMetadataText(item, ['publisherName', 'publisher', 'providerName']);
  return {
    key: pressReaderText(issue?.key || item?.key) || cid || `${category.id || 'pressreader'}-${title}-${index}`,
    title,
    image: buildPressReaderThumbnailUrl(item),
    url: buildPressReaderPublicationUrl(item),
    issueDate,
    cid,
    country,
    language,
    publisher,
    categoryId: category.id || 'actualites',
    categoryTitle: category.title || 'Actualités',
    source: 'PressReader API',
  };
}

function summarizePressReaderApiShape(item = {}) {
  const issue = pressReaderIssueFor(item);
  return {
    keys: Object.keys(item || {}).slice(0, 30),
    issueKeys: issue && typeof issue === 'object' ? Object.keys(issue).slice(0, 20) : [],
    hasImage: !!findPressReaderImageUrl(item),
    hasDerivedImage: !!buildPressReaderThumbnailUrl(item),
    hasUrl: !!findPressReaderWebUrl(item),
    hasDerivedUrl: !!buildPressReaderPublicationUrl(item),
  };
}

function isPressReaderCatalogUrl(url = '') {
  try {
    const parsed = new URL(url, PRESSREADER_URL);
    return /\/catalog(?:\/|$)/i.test(parsed.pathname);
  } catch {
    return /\/catalog(?:\/|$|\?)/i.test(String(url || ''));
  }
}

// ── Widget renderer ──────────────────────────────────────────────────────────
function NewsWidgetCard(props) {
  const category = props.categories.find(c => c.label === props.id.slice(4));
  const data = category
    ? NewsWidget({
        category,
        colorIdx: props.colorIdx,
        onUnreadChange: props.onUnreadChange,
        onOpenUrl: props.onOpenUrl,
        carouselEnabled: props.newsCarouselEnabled,
        carouselIntervalMs: props.newsCarouselIntervalMs,
      })
    : null;
  return <WidgetFrame data={data} {...props} />;
}

function WeatherWidgetCard(props) {
  const data = WeatherWidget({ location: props.location });
  return <WidgetFrame data={data} {...props} />;
}

function StocksWidgetCard(props) {
  const data = StocksWidget({ onOpenWebContent: props.onOpenWebContent });
  return <WidgetFrame data={data} {...props} />;
}

function CalendarWidgetCard(props) {
  const data = CalendarWidget();
  return <WidgetFrame data={data} {...props} />;
}

function TrafficWidgetCard(props) {
  const data = TrafficWidget({ location: props.location, apiKey: props.apiKeys?.traffic || '' });
  return <WidgetFrame data={data} {...props} />;
}

function ClockWidgetCard(props) {
  const data = ClockWidget();
  return <WidgetFrame data={data} {...props} />;
}

function AgendaWidgetCard(props) {
  const data = AgendaWidget();
  return <WidgetFrame data={data} {...props} />;
}

function MailWidgetCard(props) {
  const data = MailWidget({ onOpenWebContent: props.onOpenWebContent });
  return <WidgetFrame data={data} {...props} />;
}

function CameraWidgetCard(props) {
  const data = CameraWidget();
  return <WidgetFrame data={data} {...props} />;
}

function TodoWidgetCard(props) {
  const data = TodoWidget();
  return <WidgetFrame data={data} {...props} />;
}

function StarvisWidgetCard(props) {
  const data = StarvisWidget();
  return <WidgetFrame data={data} {...props} />;
}

function EuronewsWidgetCard(props) {
  const data = EuronewsWidget({ expanded: props.expanded });
  return <WidgetFrame data={data} {...props} />;
}

function LiveFeedWidgetCard(props) {
  const data = LiveFeedWidget({ id: props.id, expanded: props.expanded, onOpenWebContent: props.onOpenWebContent });
  return <WidgetFrame data={data} {...props} />;
}

function CpuWidgetCard(props) {
  const data = CpuWidget();
  return <WidgetFrame data={data} {...props} />;
}

function GpuWidgetCard(props) {
  const data = GpuWidget();
  return <WidgetFrame data={data} {...props} />;
}

function RamWidgetCard(props) {
  const data = RamWidget();
  return <WidgetFrame data={data} {...props} />;
}

function DiskWidgetCard(props) {
  const data = DiskWidget();
  return <WidgetFrame data={data} {...props} />;
}

function NetworkWidgetCard(props) {
  const data = NetworkWidget();
  return <WidgetFrame data={data} {...props} />;
}

const WIDGET_CARD_COMPONENTS = {
  weather: WeatherWidgetCard,
  traffic: TrafficWidgetCard,
  stocks: StocksWidgetCard,
  calendar: CalendarWidgetCard,
  clock: ClockWidgetCard,
  agenda: AgendaWidgetCard,
  mail: MailWidgetCard,
  camera: CameraWidgetCard,
  todo: TodoWidgetCard,
  starvis: StarvisWidgetCard,
  euronews: EuronewsWidgetCard,
  'live-bloomberg': LiveFeedWidgetCard,
  'live-radio-canada': LiveFeedWidgetCard,
  'live-france24': LiveFeedWidgetCard,
  'live-cbc-news': LiveFeedWidgetCard,
  'live-lcn': LiveFeedWidgetCard,
  'workstation-cpu': CpuWidgetCard,
  'workstation-gpu': GpuWidgetCard,
  'workstation-ram': RamWidgetCard,
  'workstation-disk': DiskWidgetCard,
  'workstation-network': NetworkWidgetCard,
};

// Widget renderer
function WidgetCard(props) {
  if (props.id.startsWith('cat:')) return <NewsWidgetCard {...props} />;
  const Component = WIDGET_CARD_COMPONENTS[props.id];
  return Component ? <Component {...props} /> : null;
}

// OPML drop screen
function OPMLDrop({ onLoaded }) {
  const [dragging,setDragging]=useState(false);
  const [error,setError]=useState("");
  const fileRef=useRef(null);
  function processFile(file) {
    if(!file)return;
    const reader=new FileReader();
    reader.onload=function(ev){
      try { const cats=parseOPML(ev.target.result); if(!cats.length){setError("No categories found in OPML.");return;} onLoaded(cats); }
      catch(e){setError("Could not parse file: "+e.message);}
    };
    reader.readAsText(file);
  }
  return (
    <div style={{display:"flex",flexDirection:"column",justifyContent:"center",height:"100%",padding:24,maxWidth:380,margin:"0 auto"}}>
      <div onDragOver={e=>{e.preventDefault();setDragging(true);}} onDragLeave={()=>setDragging(false)}
        onDrop={e=>{e.preventDefault();setDragging(false);processFile(e.dataTransfer.files[0]);}}
        onClick={()=>fileRef.current?.click()}
        style={{border:"1px dashed "+(dragging?"var(--accent)":"rgba(255,255,255,0.1)"),borderRadius:12,padding:"28px 20px",textAlign:"center",cursor:"pointer",background:dragging?"color-mix(in srgb, var(--accent) 6%, transparent)":"rgba(255,255,255,0.02)",transition:"all 0.15s",marginBottom:16}}>
        <div style={{fontSize:26,marginBottom:10,opacity:0.45}}>📰</div>
        <div style={{fontSize:13,color:"#c4c4d4",fontWeight:500,marginBottom:5}}>Drop your Feedly OPML here</div>
        <div style={{fontSize:11,color:"#c4c4d4"}}>or click to browse</div>
        <input ref={fileRef} type="file" accept=".opml,.xml" style={{display:"none"}} onChange={e=>processFile(e.target.files[0])}/>
      </div>
      {error&&<div style={{fontSize:11,color:"#f77f4f",marginBottom:12}}>{error}</div>}
      <div style={{background:"rgba(255,255,255,0.03)",borderRadius:10,padding:"12px 14px"}}>
        <div style={{fontSize:10,color:"#d0d0e0",fontWeight:500,textTransform:"uppercase",letterSpacing:0.8,marginBottom:8}}>How to export from Feedly</div>
        {[["1","Go to","feedly.com"],["2","Click avatar →","Organize"],["3","Scroll down →","Export OPML"]].map(([n,a,b])=>(
          <div key={n} style={{display:"flex",gap:8,marginBottom:5}}>
            <span style={{fontSize:10,color:"#2a2a34",width:14,fontFamily:"DM Mono,monospace",flexShrink:0}}>{n}</span>
            <span style={{fontSize:11,color:"#c4c4d4"}}>{a} <span style={{color:"#dcdcec"}}>{b}</span></span>
          </div>
        ))}
        <div style={{marginTop:10,fontSize:10,color:"#282830",lineHeight:1.5}}>Also works with Inoreader, NewsBlur, or any OPML file.</div>
      </div>
    </div>
  );
}

const READER_LAUNCH_DURATION_MS = 560;

function readerPreview(reader) {
  if (!reader) return null;
  if (reader.mode === 'web') {
    return {
      title: reader.title || 'Web content',
      source: reader.source || 'Browser mode',
      detail: reader.flavor === 'pressreader' ? 'PressReader session' : reader.flavor === 'outlook' ? 'Authenticated browser' : 'Browser card',
      image: reader.seed?.image || '',
    };
  }
  const article = reader.article || {};
  const seed = reader.seed || {};
  return {
    title: article.title || seed.title || 'Reader view',
    source: article.source || seed.source || 'Reader mode',
    detail: article.description || seed.description || (reader.status === 'loading' ? 'Preparing reader view' : ''),
    image: article.image || seed.image || '',
  };
}

function useReaderLaunch(launchRect, targetRef, stageRef, key, onDone) {
  const [style, setStyle] = useState(null);
  const [launching, setLaunching] = useState(false);

  useEffect(() => {
    setStyle(null);
    setLaunching(false);
    if (!launchRect) return;

    let doneTimer = null;
    const frame = requestAnimationFrame(() => {
      const target = targetRef.current?.getBoundingClientRect();
      const stageNode = stageRef.current;
      const stage = stageNode?.getBoundingClientRect();
      if (!target) return;
      const stageStyle = stageNode ? window.getComputedStyle(stageNode) : null;
      const stageLeft = (stage?.left || 0) + (parseFloat(stageStyle?.paddingLeft || '0') || 0);
      const stageTop = (stage?.top || 0) + (parseFloat(stageStyle?.paddingTop || '0') || 0);

      const sourceCenterX = launchRect.left + launchRect.width / 2;
      const sourceCenterY = launchRect.top + launchRect.height / 2;
      const targetCenterX = target.left + target.width / 2;
      const targetCenterY = target.top + target.height / 2;
      const scale = launchRect.kind === 'point'
        ? 0.014
        : Math.max(0.08, Math.min(0.42, launchRect.width / Math.max(1, target.width), launchRect.height / Math.max(1, target.height)));

      setStyle({
        left: `${target.left - stageLeft}px`,
        top: `${target.top - stageTop}px`,
        width: `${target.width}px`,
        height: `${target.height}px`,
        '--reader-launch-x': `${sourceCenterX - targetCenterX}px`,
        '--reader-launch-y': `${sourceCenterY - targetCenterY}px`,
        '--reader-launch-scale': `${scale}`,
        '--reader-launch-duration': `${READER_LAUNCH_DURATION_MS}ms`,
      });
      setLaunching(true);
      doneTimer = setTimeout(() => {
        setLaunching(false);
        onDone?.();
      }, READER_LAUNCH_DURATION_MS);
    });

    return () => {
      cancelAnimationFrame(frame);
      if (doneTimer) clearTimeout(doneTimer);
    };
  }, [launchRect, targetRef, stageRef, key, onDone]);

  return { style, launching };
}

function ReaderLaunchGhost({ active, style, label = 'Reader', preview }) {
  if (!active || !style) return null;
  const title = preview?.title || label;
  const source = preview?.source || label;
  const detail = preview?.detail || '';
  return (
    <div className="reader-launch-ghost" style={style} aria-hidden="true">
      <div className="reader-launch-ghost-glow" />
      {preview?.image && <img className="reader-launch-ghost-image" src={preview.image} alt="" />}
      <div className="reader-launch-ghost-content">
        <div className="reader-launch-ghost-label">{source}</div>
        <div className="reader-launch-ghost-title">{title}</div>
        {detail && <div className="reader-launch-ghost-detail">{detail}</div>}
      </div>
    </div>
  );
}

function ArticleReaderCard({ reader, transition, onTransitionLanded, onClose, onOpenExternal, onOpenArchive }) {
  const [progress, setProgress] = useState(12);
  const stageRef = useRef(null);
  const cardRef = useRef(null);
  const launchRect = transition?.launchRect || reader.launchRect;
  const handleLaunchDone = useCallback(() => {
    if (transition?.key) onTransitionLanded?.(transition.key);
  }, [transition?.key, onTransitionLanded]);
  const launch = useReaderLaunch(launchRect, cardRef, stageRef, transition?.key || reader.url, transition ? handleLaunchDone : undefined);
  const selfLaunching = !transition && launch.launching;
  const ghostPreview = transition?.preview || readerPreview(reader);
  const loading = reader.status === 'loading';
  const article = reader.article || {};
  const title = loading ? (reader.seed?.title || 'Preparing reader view') : (article.title || 'Reader view');
  const source = article.source || reader.seed?.source || '';
  const sourceLabel = article.sourceLabel === 'archive.org'
    ? 'archive.org snapshot'
    : article.sourceLabel === 'jina'
      ? 'reader proxy'
      : article.sourceLabel === 'feed'
        ? 'publisher feed'
      : 'direct source';
  const paragraphs = article.paragraphs || [];
  const images = Array.from(new Set([
    ...(Array.isArray(article.images) ? article.images : []),
    article.image,
    reader.seed?.image,
  ].filter(Boolean)));
  const [imageIndex, setImageIndex] = useState(0);
  const [imageViewerOpen, setImageViewerOpen] = useState(false);
  const imageCount = images.length;
  const hero = images[Math.min(imageIndex, Math.max(0, imageCount - 1))] || '';
  const attempts = article.attempts || [];

  useEffect(() => {
    if (!loading) { setProgress(reader.status === 'ready' ? 100 : 92); return; }
    setProgress(12);
    const timer = setInterval(() => {
      setProgress(value => Math.min(88, value + Math.max(2, (90 - value) * 0.12)));
    }, 180);
    return () => clearInterval(timer);
  }, [loading, reader.url, reader.status]);

  useEffect(() => {
    setImageIndex(0);
    setImageViewerOpen(false);
  }, [reader.url]);

  useEffect(() => {
    setImageIndex(index => Math.min(index, Math.max(0, imageCount - 1)));
  }, [imageCount]);

  const browseImage = useCallback((delta, event) => {
    event?.stopPropagation();
    if (imageCount < 2) return;
    setImageIndex(index => (index + delta + imageCount) % imageCount);
  }, [imageCount]);
  const handleContentWheel = useCallback((event) => {
    const scroller = event.currentTarget;
    if (!scroller || scroller.scrollHeight <= scroller.clientHeight) return;
    const before = scroller.scrollTop;
    scroller.scrollTop += event.deltaY;
    if (scroller.scrollTop !== before) event.preventDefault();
  }, []);

  return (
    <div ref={stageRef} className="reader-stage">
      <ReaderLaunchGhost active={launch.launching} style={launch.style} label="Reader" preview={ghostPreview} />
      <article
        ref={cardRef}
        className={`reader-card${selfLaunching ? ' reader-card-pending' : reader.launchRect ? ' reader-card-settled' : ''}`}
      >
        <div className="reader-card-glow" />
        <div className="reader-topbar">
          <div className="reader-source">
            <span className="reader-dot" />
            <span>{source || 'Reader mode'}</span>
            {!loading && <span className="reader-source-mode">{sourceLabel}</span>}
          </div>
          <div className="reader-actions">
            <button className="reader-icon-button" onClick={() => onOpenExternal(reader.url)} title="Open in default browser">↗</button>
            <button className="reader-icon-button" onClick={onClose} title="Close">X</button>
          </div>
        </div>

        <div className="reader-progress-track" aria-hidden="true">
          <div className="reader-progress-fill" style={{ width: `${progress}%`, opacity: loading ? 1 : 0.55 }} />
        </div>

        <div className="reader-content" onWheel={handleContentWheel}>
          <div className="reader-copy">
            <h1>{title}</h1>
            {!loading && article.description && <p className="reader-deck">{article.description}</p>}
            {loading && (
              <div className="reader-loading">
                <div className="reader-scanline" />
                <div>
                  <div className="reader-loading-title">Fetching and purifying article content</div>
                  <div className="reader-loading-text">Removing menus, ads, trackers, duplicate links, and layout noise.</div>
                </div>
              </div>
            )}
            {!loading && reader.status === 'error' && (
              <div className="reader-error">
                <div style={{ fontWeight: 700, marginBottom: 6 }}>
                  {article.paywall ? 'Subscription required.' : 'Reader extraction could not complete.'}
                </div>
                <div>{reader.error || article.error || 'The page resisted automatic cleanup.'}</div>
                {article.paywall && paragraphs.map((paragraph, index) => (
                  <p key={index} style={{ marginTop: 12, marginBottom: 0 }}>{paragraph}</p>
                ))}
                <div className="reader-error-actions">
                  <button className="reader-open-fallback" onClick={() => onOpenExternal(reader.url)}>Open original article</button>
                  {!/web\.archive\.org/i.test(reader.url || '') && (
                    <button className="reader-open-fallback" onClick={() => onOpenArchive?.(reader.url, reader.seed)}>Try archive.org</button>
                  )}
                </div>
              </div>
            )}
            {!loading && reader.status === 'error' && attempts.length > 0 && (
              <div className="reader-debug">
                <div className="reader-debug-title">Parse attempts</div>
                {attempts.map((attempt, index) => (
                  <div className="reader-debug-row" key={`${attempt.source}-${index}`}>
                    <span>{attempt.source}</span>
                    <span>{attempt.paragraphs ?? '--'}p</span>
                    <span>{attempt.chars ?? '--'}c</span>
                    {attempt.status && <span>HTTP {attempt.status}</span>}
                    {attempt.challenge && <span>bot check</span>}
                    {attempt.error && <span>{attempt.error}</span>}
                  </div>
                ))}
              </div>
            )}
            {!loading && reader.status === 'ready' && paragraphs.map((paragraph, index) => (
              <p key={index}>{paragraph}</p>
            ))}
          </div>

          <aside className="reader-media">
            {hero ? (
              <div className="reader-image-shell">
                <img
                  src={hero}
                  alt=""
                  onClick={() => setImageViewerOpen(true)}
                  onError={event => { event.currentTarget.style.display = 'none'; }}
                />
                {imageCount > 1 && (
                  <div className="reader-image-count">{imageIndex + 1} / {imageCount}</div>
                )}
              </div>
            ) : (
              <div className="reader-image-placeholder">Reader</div>
            )}
            {!loading && (
              <div className="reader-meta">
                <div><span>Paragraphs</span><strong>{paragraphs.length || '--'}</strong></div>
                <div><span>Images</span><strong>{imageCount}</strong></div>
                <div><span>Mode</span><strong>{article.sourceLabel === 'archive.org' ? 'Archive' : article.sourceLabel === 'jina' ? 'Proxy' : article.sourceLabel === 'feed' ? 'Feed' : 'Direct'}</strong></div>
              </div>
            )}
          </aside>
        </div>
        {imageViewerOpen && hero && (
          <div className="reader-image-overlay" onClick={() => setImageViewerOpen(false)}>
            <div className="reader-image-viewer" onClick={event => event.stopPropagation()}>
              <button className="reader-image-close" onClick={() => setImageViewerOpen(false)} title="Close">X</button>
              {imageCount > 1 && (
                <>
                  <button className="reader-image-nav reader-image-prev" onClick={event => browseImage(-1, event)} title="Previous image">&lt;</button>
                  <button className="reader-image-nav reader-image-next" onClick={event => browseImage(1, event)} title="Next image">&gt;</button>
                </>
              )}
              <img src={hero} alt="" />
              <div className="reader-image-caption">{imageIndex + 1} / {imageCount}</div>
            </div>
          </div>
        )}
      </article>
    </div>
  );
}

// ── Category manager ─────────────────────────────────────────────────────────
function BrowserIslandCard({ reader, transition, onTransitionLanded, onClose, onOpenExternal, onOpenWebContent }) {
  const webviewRef = useRef(null);
  const stageRef = useRef(null);
  const cardRef = useRef(null);
  const launchRect = transition?.launchRect || reader.launchRect;
  const handleLaunchDone = useCallback(() => {
    if (transition?.key) onTransitionLanded?.(transition.key);
  }, [transition?.key, onTransitionLanded]);
  const launch = useReaderLaunch(launchRect, cardRef, stageRef, transition?.key || reader.url, transition ? handleLaunchDone : undefined);
  const selfLaunching = !transition && launch.launching;
  const ghostPreview = transition?.preview || readerPreview(reader);
  const [loading, setLoading] = useState(true);
  const [currentUrl, setCurrentUrl] = useState(reader.url);
  const [progress, setProgress] = useState(16);
  const title = reader.title || 'Web content';
  const source = reader.source || 'Browser mode';
  const isOutlook = reader.flavor === 'outlook' || /outlook\.(office|live)\.com|office\.com/i.test(reader.url || '');
  const isPressReader = reader.flavor === 'pressreader' || /pressreader\.com/i.test(reader.url || '');
  const isTradingViewHeatmap = reader.flavor === 'tradingview-heatmap';
  const heatmapHomeUrlRef = useRef(reader.url);
  const [heatmapDrilldownOpen, setHeatmapDrilldownOpen] = useState(false);
  const isLive = reader.flavor === 'live';
  const isLiveYouTube = isLive && /(^|\.)youtube\.com\//i.test(reader.url || '');
  const isLiveDirectHls = isLive && /\.m3u8(?:[?#].*)?$/i.test(reader.url || '');
  const isLiveResolvable = isLive && !isLiveYouTube && !isLiveDirectHls;
  const [showWebSignIn, setShowWebSignIn] = useState(!!reader.authUrl && !isOutlook);
  const liveFeedId = isLive ? (reader.liveFeed?.id || reader.liveFeedId || reader.url || title) : '';
  const [liveAudioOwnerId, setLiveAudioOwnerId] = useLiveAudioOwner(liveFeedId);
  const liveMuted = !liveFeedId || liveAudioOwnerId !== liveFeedId;
  const [liveHlsUrl, setLiveHlsUrl] = useState('');
  const [liveHlsFailed, setLiveHlsFailed] = useState(false);
  const liveMutedRef = useRef(true);
  const liveResolveTimerRef = useRef(0);
  const livePlaybackTimerRef = useRef(0);
  const liveAudioSyncTimersRef = useRef([]);
  const [pressAuth, setPressAuth] = useState(null);
  const [pressAuthReady, setPressAuthReady] = useState(!isPressReader);
  const [pressGate, setPressGate] = useState(isPressReader ? 'preparing' : '');
  const [pressMessage, setPressMessage] = useState('');
  const [pressForm, setPressForm] = useState({ user: '', pass: '' });
  const [pressShelfOpen, setPressShelfOpen] = useState(false);
  const [pressNativeCatalogOpen, setPressNativeCatalogOpen] = useState(isPressReader);
  const [pressManualLoginOpen, setPressManualLoginOpen] = useState(false);
  const [pressShelfItems, setPressShelfItems] = useState([]);
  const [pressShelfQuery, setPressShelfQuery] = useState('');
  const [pressShelfStatus, setPressShelfStatus] = useState('');
  const [pressShelfScanning, setPressShelfScanning] = useState(false);
  const [pressCatalogIndex, setPressCatalogIndex] = useState(emptyPressReaderCatalogIndex());
  const [pressCategorySelection, setPressCategorySelection] = useState({});
  const [pressApiGroups, setPressApiGroups] = useState([]);
  const [pressApiLoadingCategoryId, setPressApiLoadingCategoryId] = useState('');
  const [pressNewspapersSourceRequest, setPressNewspapersSourceRequest] = useState(null);
  const [pressCrawlerUrl, setPressCrawlerUrl] = useState('');
  const [pressCrawlerActive, setPressCrawlerActive] = useState(false);
  const [pressGuardrail, setPressGuardrail] = useState({ blockedUntil: 0, reason: '' });
  const [pressNetworkInspecting, setPressNetworkInspecting] = useState(false);
  const pressAuthRef = useRef(null);
  const pressAuthReadyRef = useRef(!isPressReader);
  const pressSubmittingRef = useRef(false);
  const pressSubmitTimeRef = useRef(0);
  const pressSubmitRetryRef = useRef(0);
  const pressRevealTimerRef = useRef(null);
  const pressGateRef = useRef(isPressReader ? 'preparing' : '');
  const pressManualLoginOpenRef = useRef(false);
  const pressGateSinceRef = useRef(Date.now());
  const pressStartReadingMaskUntilRef = useRef(0);
  const pressAutomationTimerRef = useRef(null);
  const pressShelfAutoOpenedRef = useRef(false);
  const pressShelfScanningRef = useRef(false);
  const pressNewspapersSourceRef = useRef(null);
  const pressCrawlerRef = useRef(null);
  const pressCrawlerQueueRef = useRef([]);
  const pressCrawlerVisitedRef = useRef(new Set());
  const pressCrawlerCategoryByUrlRef = useRef(new Map());
  const pressCrawlerStartedRef = useRef(false);
  const pressCatalogIndexRef = useRef(emptyPressReaderCatalogIndex());
  const pressCategorySelectionRef = useRef({});
  const pressGuardrailRef = useRef({ blockedUntil: 0, reason: '' });
  const webDiagSeqRef = useRef(0);
  const webDiagDomReadyRef = useRef(false);
  const liveNativeHlsUrl = isLive ? (reader.hlsUrl || liveHlsUrl || (/\.m3u8(?:[?#].*)?$/i.test(reader.url || '') ? reader.url : '')) : '';
  const liveNativePending = isLiveResolvable && !liveNativeHlsUrl && !liveHlsFailed;
  const liveUsesNativeVideo = isLive && !!liveNativeHlsUrl;
  const liveYouTubeFeed = reader.liveFeed || {
    id: `zoom-youtube-${reader.url || 'live'}`,
    title,
    source,
    url: reader.url,
    embedUrl: reader.url,
    youtube: true,
  };

  function tradingViewChartUrlFromPopup(rawUrl = '') {
    try {
      const parsed = new URL(rawUrl);
      if (!/\.?tradingview\.com$/i.test(parsed.hostname) && !/\.tradingview\.com$/i.test(parsed.hostname)) return '';
      if (/\/chart\//i.test(parsed.pathname)) return parsed.href;
      const symbolMatch = parsed.pathname.match(/\/symbols\/([A-Z0-9]+)-([A-Z0-9._-]+)\/?/i);
      if (symbolMatch) {
        const symbol = `${symbolMatch[1].toUpperCase()}:${symbolMatch[2].toUpperCase()}`;
        return `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(symbol)}`;
      }
      const symbol = parsed.searchParams.get('symbol') || parsed.hash.match(/symbol=([^&]+)/i)?.[1] || '';
      return symbol ? `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(decodeURIComponent(symbol))}` : '';
    } catch {
      return '';
    }
  }

  function openHeatmapDrilldown(nextUrl = '') {
    const chartUrl = tradingViewChartUrlFromPopup(nextUrl);
    if (!chartUrl) return false;
    try {
      const wv = webviewRef.current;
      if (!wv) return false;
      wv.src = chartUrl;
      setCurrentUrl(chartUrl);
      setHeatmapDrilldownOpen(true);
      setLoading(true);
      setProgress(18);
      return true;
    } catch {
      return false;
    }
  }

  function closeOrReturnFromBrowserCard() {
    if (isTradingViewHeatmap && heatmapDrilldownOpen) {
      const homeUrl = heatmapHomeUrlRef.current || reader.url;
      try {
        const wv = webviewRef.current;
        if (wv) wv.src = homeUrl;
        setCurrentUrl(homeUrl);
        setHeatmapDrilldownOpen(false);
        setLoading(true);
        setProgress(18);
      } catch {}
      return;
    }
    onClose();
  }

  useEffect(() => {
    if (!isTradingViewHeatmap) return undefined;
    return api.tv?.onHeatmapPopup?.((payload = {}) => {
      const nextUrl = payload?.url || '';
      if (nextUrl) openHeatmapDrilldown(nextUrl);
    }) || undefined;
  }, [isTradingViewHeatmap, reader.url]);

  function updatePressGate(nextGate, message = '') {
    if (pressGateRef.current !== nextGate) pressGateSinceRef.current = Date.now();
    pressGateRef.current = nextGate;
    setPressGate(nextGate);
    setPressMessage(message);
  }

  function queuePressAutomation(delay = 0) {
    if (pressAutomationTimerRef.current) clearTimeout(pressAutomationTimerRef.current);
    pressAutomationTimerRef.current = setTimeout(() => runPressReaderAutomation(), delay);
  }

  function prefetchPressReaderPublication({ force = false } = {}) {
    if (!isPressReader) return;
    if (pressReaderBlockedNow()) return;
    if (!force && isPressReaderSettled()) return;
    const wv = webviewRef.current;
    if (!wv) return;
    try {
      wv.executeJavaScript(PRESSREADER_PUBLICATION_PREFETCH_JS, true)
        .then(result => {
          if (result?.ok) api.log?.('[pressreader] publication-prefetch', `discovered=${result.discovered}`, `done=${result.done}`, `inflight=${result.inflight}`, `scans=${result.scans}`);
        })
        .catch(error => api.log?.('[pressreader] publication-prefetch-error', error?.message || String(error)));
    } catch (error) {
      api.log?.('[pressreader] publication-prefetch-error', error?.message || String(error));
    }
  }

  async function persistPressReaderIndex(nextIndex) {
    pressCatalogIndexRef.current = nextIndex;
    setPressCatalogIndex(nextIndex);
    setPressShelfItems(flattenPressReaderIndex(nextIndex, pressCategorySelectionRef.current));
    try { await api.store.set(SK_PRESSREADER_CATALOG_INDEX, JSON.stringify(nextIndex)); } catch {}
  }

  async function persistPressReaderSelection(nextSelection) {
    pressCategorySelectionRef.current = nextSelection;
    setPressCategorySelection(nextSelection);
    setPressShelfItems(flattenPressReaderIndex(pressCatalogIndexRef.current, nextSelection));
    try { await api.store.set(SK_PRESSREADER_CATEGORY_SELECTION, JSON.stringify(nextSelection)); } catch {}
  }

  function pressReaderBlockedNow() {
    return isPressReader && Number(pressGuardrailRef.current?.blockedUntil || 0) > Date.now();
  }

  function isPressReaderAuthGuardrail(guardrail = {}) {
    return /login rejected|account temporarily locked|login stayed|login needs an update|auth failure/i.test(String(guardrail.reason || ''));
  }

  function pressReaderGuardrailMessage() {
    const blockedUntil = Number(pressGuardrailRef.current?.blockedUntil || 0);
    if (blockedUntil <= Date.now()) return '';
    const minutes = Math.max(1, Math.ceil((blockedUntil - Date.now()) / 60000));
    return `PressReader catalog indexing paused for ${minutes} min: ${pressGuardrailRef.current.reason || 'cooldown'}.`;
  }

  async function persistPressReaderGuardrail(nextGuardrail) {
    pressGuardrailRef.current = nextGuardrail;
    setPressGuardrail(nextGuardrail);
    try { await api.store.set(SK_PRESSREADER_GUARDRAIL, JSON.stringify(nextGuardrail)); } catch {}
  }

  async function clearPressReaderGuardrail() {
    await persistPressReaderGuardrail({ blockedUntil: 0, reason: '' });
  }

  async function pausePressReaderAutomation(reason = 'auth failure', durationMs = PRESSREADER_AUTH_COOLDOWN_MS) {
    const nextGuardrail = { blockedUntil: Date.now() + durationMs, reason };
    if (pressAutomationTimerRef.current) clearTimeout(pressAutomationTimerRef.current);
    pressCrawlerQueueRef.current = [];
    pressCrawlerVisitedRef.current = new Set();
    pressCrawlerCategoryByUrlRef.current = new Map();
    setPressCrawlerActive(false);
    setPressCrawlerUrl('');
    pressShelfScanningRef.current = false;
    setPressShelfScanning(false);
    setLoading(false);
    setProgress(100);
    setPressShelfStatus(`PressReader catalog indexing paused: ${reason}.`);
    await persistPressReaderGuardrail(nextGuardrail);
    api.log?.('[pressreader] guardrail-paused', reason, `until=${new Date(nextGuardrail.blockedUntil).toISOString()}`);
  }

  function mergePressReaderExtract(result, { open = false, reason = 'manual' } = {}) {
    const incoming = Array.isArray(result?.items) ? result.items : [];
    const nextIndex = mergePressReaderCatalogIndex(pressCatalogIndexRef.current, result || {}, pressCategorySelectionRef.current);
    persistPressReaderIndex(nextIndex);
    setPressShelfStatus(incoming.length
      ? `${incoming.length} publication cover${incoming.length === 1 ? '' : 's'} indexed from ${result?.currentCategory?.title || 'this category'}.`
      : 'No publication covers found in this category yet.');
    api.log?.('[pressreader] shelf-scan', reason, `items=${incoming.length}`, result?.href || '');
    if (open || (!pressShelfAutoOpenedRef.current && flattenPressReaderIndex(nextIndex, pressCategorySelectionRef.current).length >= 4)) {
      pressShelfAutoOpenedRef.current = true;
      setPressShelfOpen(true);
    }
    return nextIndex;
  }

  function mergePressReaderPayloads(base, next) {
    if (!next?.ok) return base;
    const categoriesById = new Map((base.categories || []).map(category => [category.id, category]));
    const itemsByKey = new Map((base.items || []).map(item => [item.key || item.url || item.image || item.title, item]));
    const currentCategory = next.currentCategory || base.currentCategory;
    if (currentCategory?.id && !categoriesById.has(currentCategory.id)) categoriesById.set(currentCategory.id, currentCategory);
    (Array.isArray(next.categories) ? next.categories : []).forEach(category => {
      if (!category?.id || categoriesById.has(category.id)) return;
      categoriesById.set(category.id, category);
    });
    (Array.isArray(next.items) ? next.items : []).forEach(item => {
      const key = item?.key || item?.url || item?.image || item?.title;
      if (!key || itemsByKey.has(key)) return;
      itemsByKey.set(key, item);
    });
    return {
      ok: true,
      href: next.href || base.href,
      title: next.title || base.title,
      currentCategory,
      categories: [...categoriesById.values()],
      items: [...itemsByKey.values()],
    };
  }

  async function extractPressReaderCatalogProgressively(wv, { categoryHint = null, maxSteps = 10 } = {}) {
    let aggregate = { ok: true, categories: [], items: [] };
    for (let step = 0; step < maxSteps; step += 1) {
      if (pressReaderBlockedNow()) break;
      await new Promise(resolve => window.setTimeout(resolve, step === 0 ? 450 : 360));
      if (categoryHint) {
        try {
          await wv.executeJavaScript(`window.__wpPressReaderCategoryHint = ${JSON.stringify({
            id: categoryHint.id,
            title: categoryHint.title,
            url: categoryHint.url,
          })};`, true);
        } catch {}
      }
      try {
        const result = await wv.executeJavaScript(PRESSREADER_CATALOG_EXTRACT_JS, true);
        aggregate = mergePressReaderPayloads(aggregate, result);
      } catch {}
      let scroll = { done: true };
      try {
        scroll = await wv.executeJavaScript(`
          (() => {
            const height = Math.max(document.body?.scrollHeight || 0, document.documentElement?.scrollHeight || 0);
            const maxY = Math.max(0, height - window.innerHeight);
            const nextY = Math.min(maxY, Math.round((window.scrollY || 0) + window.innerHeight * 0.82));
            window.scrollTo(0, nextY);
            return { y: Math.round(window.scrollY || 0), maxY: Math.round(maxY), height: Math.round(height), done: nextY >= maxY - 8 };
          })();
        `, true);
      } catch {}
      if (scroll?.done) break;
    }
    return aggregate;
  }

  async function scanPressReaderShelf({ open = false, reason = 'manual' } = {}) {
    if (!isPressReader) return;
    if (pressReaderBlockedNow()) {
      setPressShelfStatus(pressReaderGuardrailMessage());
      return;
    }
    const wv = webviewRef.current;
    if (!wv || pressShelfScanningRef.current) return;
    pressShelfScanningRef.current = true;
    setPressShelfScanning(true);
    setPressShelfStatus('Scanning visible catalog...');
    try {
      const shouldStartDailyCrawl = reason === 'settled'
        && !pressCrawlerStartedRef.current
        && (!pressCatalogIndex.updatedAt || Date.now() - Number(pressCatalogIndex.updatedAt) >= PRESSREADER_INDEX_TTL_MS);
      const result = await extractPressReaderCatalogProgressively(wv, { maxSteps: PRESSREADER_BOOTSTRAP_MAX_STEPS });
      if (!result?.ok) {
        setPressShelfStatus('Catalog scan unavailable.');
        return;
      }
      const nextIndex = mergePressReaderExtract(result, { open, reason });
      if (shouldStartDailyCrawl) {
        const hasCategoryUrls = nextIndex.categories.some(category => category.url);
        if (hasCategoryUrls) window.setTimeout(() => startPressReaderCategoryCrawl({ indexOverride: nextIndex }), 900);
      }
    } catch (error) {
      setPressShelfStatus(error?.message || 'Catalog scan failed.');
      api.log?.('[pressreader] shelf-scan-error', error?.message || String(error));
    } finally {
      pressShelfScanningRef.current = false;
      setPressShelfScanning(false);
    }
  }

  function openPressShelfItem(item) {
    const url = normalizePressReaderWebUrl(item?.url || '');
    if (!url) {
      setPressShelfStatus('This cover did not expose a readable PressReader link.');
      return;
    }
    const wv = webviewRef.current;
    if (!wv) return;
    setPressShelfOpen(false);
    setPressNativeCatalogOpen(false);
    setLoading(true);
    setProgress(24);
    pressStartReadingMaskUntilRef.current = Math.max(pressStartReadingMaskUntilRef.current, Date.now() + 4500);
    updatePressGate('opening-publication', `Opening ${item.title || 'publication'}`);
    try {
      wv.loadURL?.(url);
    } catch {
      try { wv.src = url; } catch {}
    }
  }

  function startPressReaderCategoryCrawl({ force = false, indexOverride = null } = {}) {
    if (!isPressReader || pressCrawlerActive) return;
    if (pressReaderBlockedNow()) {
      setPressShelfStatus(pressReaderGuardrailMessage());
      return;
    }
    const sourceIndex = indexOverride || pressCatalogIndex;
    const ageMs = Date.now() - Number(sourceIndex.updatedAt || 0);
    if (!force && sourceIndex.updatedAt && ageMs < PRESSREADER_INDEX_TTL_MS) {
      setPressShelfStatus(`${pressShelfItems.length} cached cover${pressShelfItems.length === 1 ? '' : 's'} ready; daily index is fresh.`);
      return;
    }
    const selection = pressCategorySelectionRef.current;
    const categories = sourceIndex.categories
      .filter(category => category.url && (Object.prototype.hasOwnProperty.call(selection, category.id) ? selection[category.id] !== false : category.enabled !== false))
      .slice(0, PRESSREADER_CRAWL_MAX_CATEGORIES);
    if (!categories.length) {
      setPressShelfStatus('No PressReader categories discovered yet. Open the catalog and scan once.');
      return;
    }
    pressCrawlerQueueRef.current = categories.map(category => category.url);
    pressCrawlerVisitedRef.current = new Set();
    pressCrawlerCategoryByUrlRef.current = new Map(categories.map(category => [category.url, category]));
    pressCrawlerStartedRef.current = true;
    setPressCrawlerActive(true);
    setPressShelfStatus(`Refreshing ${categories.length} PressReader categor${categories.length === 1 ? 'y' : 'ies'} slowly in the background...`);
    setPressCrawlerUrl(pressCrawlerQueueRef.current.shift() || '');
  }

  async function extractPressReaderCrawlerPage(reason = 'crawler') {
    const wv = pressCrawlerRef.current;
    if (!wv || !pressCrawlerActive) return;
    if (pressReaderBlockedNow()) {
      setPressCrawlerActive(false);
      setPressCrawlerUrl('');
      setPressShelfStatus(pressReaderGuardrailMessage());
      return;
    }
    try {
      await new Promise(resolve => window.setTimeout(resolve, 900));
      const categoryHint = pressCrawlerCategoryByUrlRef.current.get(pressCrawlerUrl);
      const result = await extractPressReaderCatalogProgressively(wv, { categoryHint, maxSteps: PRESSREADER_BOOTSTRAP_MAX_STEPS });
      const currentScanUrl = result?.href || pressCrawlerUrl;
      if (currentScanUrl) pressCrawlerVisitedRef.current.add(currentScanUrl);
      if (pressCrawlerUrl) pressCrawlerVisitedRef.current.add(pressCrawlerUrl);
      if (result?.ok) {
        mergePressReaderExtract(result, { reason });
        const queued = new Set(pressCrawlerQueueRef.current);
        const discoveredCategories = Array.isArray(result.categories) ? result.categories : [];
        for (const category of discoveredCategories) {
          const url = String(category?.url || '').trim();
          const id = String(category?.id || '').trim();
          const selection = pressCategorySelectionRef.current;
          const enabled = Object.prototype.hasOwnProperty.call(selection, id) ? selection[id] !== false : category?.enabled !== false;
          if (!url || !enabled || pressCrawlerVisitedRef.current.has(url) || queued.has(url)) continue;
          pressCrawlerQueueRef.current.push(url);
          pressCrawlerCategoryByUrlRef.current.set(url, category);
          queued.add(url);
        }
      }
    } catch (error) {
      api.log?.('[pressreader] crawler-scan-error', error?.message || String(error));
    }
    const nextUrl = pressCrawlerQueueRef.current.shift() || '';
    if (nextUrl) {
      setPressCrawlerUrl(nextUrl);
    } else {
      setPressCrawlerActive(false);
      setPressCrawlerUrl('');
      const cachedItems = flattenPressReaderIndex(pressCatalogIndexRef.current, pressCategorySelectionRef.current);
      setPressShelfStatus(`Daily index refreshed: ${cachedItems.length} cover${cachedItems.length === 1 ? '' : 's'} cached.`);
    }
  }

  async function togglePressReaderCategory(categoryId, enabled) {
    const nextSelection = { ...pressCategorySelection, [categoryId]: !!enabled };
    await persistPressReaderSelection(nextSelection);
    const currentIndex = pressCatalogIndexRef.current;
    const nextIndex = {
      ...currentIndex,
      categories: currentIndex.categories.map(category => category.id === categoryId ? { ...category, enabled: !!enabled } : category),
    };
    await persistPressReaderIndex(nextIndex);
  }

  function showPressReaderNativeCatalog() {
    if (!isPressReader) return;
    pressManualLoginOpenRef.current = false;
    setPressManualLoginOpen(false);
    setPressNativeCatalogOpen(true);
    setPressShelfOpen(true);
    setLoading(false);
    setProgress(100);
    updatePressGate('ready', '');
  }

  function restorePressReaderNativeCatalogAfterLogin(reason = 'manual-login') {
    if (!isPressReader) return;
    pressManualLoginOpenRef.current = false;
    pressSubmittingRef.current = false;
    pressSubmitTimeRef.current = 0;
    pressStartReadingMaskUntilRef.current = 0;
    setPressManualLoginOpen(false);
    setPressNativeCatalogOpen(true);
    setPressShelfOpen(true);
    setLoading(false);
    setProgress(100);
    updatePressGate('ready', '');
    setPressShelfStatus(previous => previous || 'Signed in. Native PressReader catalog is ready.');
    api.log?.('[pressreader] manual-login-restored-native-catalog', reason);
  }

  function refreshPressReaderNativeCatalog() {
    if (!isPressReader) return;
    if (pressCatalogIndex.categories.length) {
      startPressReaderCategoryCrawl({ force: true });
      return;
    }
    scanPressReaderShelf({ open: true, reason: 'native-refresh' });
  }

  function normalizePressReaderWebItems(items = [], category = {}, fallbackTitle = category.title) {
    return items
      .map((item, index) => ({
        ...item,
        key: item.key || item.id || item.cid || item.openUrl || item.url || item.thumbnailUrl || item.image || `${category.id || 'pressreader'}-${index}`,
        image: item.image || item.thumbnailUrl || '',
        thumbnailUrl: item.thumbnailUrl || item.image || '',
        url: item.url || item.openUrl || '',
        openUrl: item.openUrl || item.url || '',
        categoryId: item.categoryId || category.id || 'actualites',
        categoryTitle: item.categoryTitle || fallbackTitle || category.title || 'Actualites',
        source: item.source || 'PressReader web catalog',
      }))
      .filter(item => item.title || item.image || item.url);
  }

  function buildPressReaderWebCatalogGroup(result = {}, category = {}) {
    const categoryInfo = {
      id: category.id || result.currentCategory?.id || 'actualites',
      title: category.title || result.currentCategory?.title || 'Actualites',
    };
    const sectionsById = new Map();
    (Array.isArray(result.subcategories) ? result.subcategories : result.sections || [])
      .map(section => ({
        id: section.id || pressReaderSlug(section.title || ''),
        title: section.title || 'Journaux',
        count: section.count,
        publications: uniquePressReaderPublications(
          normalizePressReaderWebItems(section.publications || section.items || [], categoryInfo, section.title),
          48
        ),
      }))
      .filter(section => section.id && section.publications.length)
      .forEach(section => {
        const existing = sectionsById.get(section.id);
        sectionsById.set(section.id, existing ? {
          ...existing,
          publications: uniquePressReaderPublications([...existing.publications, ...section.publications], 48),
        } : section);
      });
    const sections = [...sectionsById.values()];
    const visibleItems = uniquePressReaderPublications(
      sections.length
        ? sections.flatMap(section => section.publications)
        : normalizePressReaderWebItems(result.items || [], categoryInfo, categoryInfo.title),
      180
    );
    if (!visibleItems.length) return null;
    return {
      id: categoryInfo.id,
      title: categoryInfo.title,
      sectionLabel: 'Journaux',
      publications: visibleItems,
      sections,
      sourceUrl: result.href || PRESSREADER_NEWSPAPERS_SOURCE_URL,
      webLoaded: true,
    };
  }

  function isPressReaderNewspaperSection(section = {}) {
    const slug = pressReaderSlug(`${section.id || ''} ${section.title || ''}`);
    return /(^|-)local($|-)|(^|-)national($|-)|international|quotidien|quotidiens|daily|hebdomadaire|hebdomadaires|weekly|dimanche|sunday|aujourd-hui|today/i.test(slug);
  }

  function hasPressReaderNewspaperRows(group = {}) {
    const sections = Array.isArray(group.sections) ? group.sections.filter(section => section.publications?.length) : [];
    return sections.length > 1 && sections.some(isPressReaderNewspaperSection);
  }

  function mergePressReaderCatalogGroups(primaryGroup, fallbackGroup) {
    if (!primaryGroup) return fallbackGroup || null;
    if (!fallbackGroup) return primaryGroup;
    const sectionsById = new Map();
    const addSection = (section, source = '') => {
      if (!section?.publications?.length) return;
      const id = section.id || pressReaderSlug(section.title || '') || `section-${sectionsById.size}`;
      const existing = sectionsById.get(id);
      const publications = uniquePressReaderPublications([
        ...(existing?.publications || []),
        ...normalizePressReaderWebItems(section.publications || section.items || [], primaryGroup, section.title),
      ], 48);
      sectionsById.set(id, {
        ...(existing || section),
        id,
        title: existing?.title || section.title || id,
        source: existing?.source || source,
        publications,
        items: publications,
        count: publications.length,
      });
    };
    (primaryGroup.sections || []).forEach(section => addSection(section, 'web'));
    (fallbackGroup.sections || []).forEach(section => addSection(section, 'api'));
    const sections = [...sectionsById.values()];
    const publications = uniquePressReaderPublications([
      ...sections.flatMap(section => section.publications || []),
      ...(primaryGroup.publications || []),
      ...(fallbackGroup.publications || []),
    ], 180);
    return {
      ...fallbackGroup,
      ...primaryGroup,
      sectionLabel: primaryGroup.sectionLabel || fallbackGroup.sectionLabel || 'Journaux',
      sourceUrl: primaryGroup.sourceUrl || fallbackGroup.sourceUrl || PRESSREADER_NEWSPAPERS_SOURCE_URL,
      sections,
      publications,
      webLoaded: !!primaryGroup.webLoaded,
      apiLoaded: !!fallbackGroup.apiLoaded,
      mergedFallback: true,
    };
  }

  async function fetchPressReaderCategoryCatalogGroup(category, reason = 'web extract incomplete') {
    const categoryCatalog = api.pressReader?.categoryCatalog;
    if (!categoryCatalog) {
      return { group: null, error: 'PressReader category API is not available in this runtime.' };
    }
    const result = await categoryCatalog({
      categoryId: category.id || 'actualites',
      title: category.title || 'Actualites',
      mediaType: 'newspapers',
      locale: 'fr-CA',
    });
    if (!result?.ok) {
      return { group: null, error: result?.error || `PressReader category API failed after ${reason}.` };
    }
    const group = buildPressReaderWebCatalogGroup({
      href: result.sourceUrl || PRESSREADER_NEWSPAPERS_SOURCE_URL,
      currentCategory: result.category,
      sections: result.subcategories || result.sections || [],
      items: result.publications || result.items || [],
    }, category);
    return {
      group: group ? { ...group, apiLoaded: true, webLoaded: false } : null,
      error: group ? '' : 'PressReader category API returned no readable Journaux publications.',
    };
  }

  function startPressReaderNewspapersWebLoad(category) {
    if (!isPressReader || !category) return false;
    setPressApiLoadingCategoryId(category.id);
    setPressShelfStatus(`Loading ${category.title || 'Actualites'} from PressReader web catalog...`);
    setPressNewspapersSourceRequest({
      key: `${category.id || 'actualites'}-${Date.now()}`,
      url: PRESSREADER_NEWSPAPERS_SOURCE_URL,
      category: {
        id: category.id || 'actualites',
        title: category.title || 'Actualites',
      },
    });
    return true;
  }

  async function loadPressReaderCategoryFromApi(category) {
    if (!isPressReader || !category) return;
    const categorySlug = pressReaderSlug(category.title || category.id || '');
    if (!/actualit|news|journaux|newspaper/i.test(categorySlug)) return;
    if (startPressReaderNewspapersWebLoad(category)) return;
    const normalizeCategoryItems = (items = [], fallbackTitle = category.title) => items
      .map((item, index) => ({
        ...item,
        key: item.key || item.id || item.cid || item.openUrl || item.url || item.thumbnailUrl || item.image || `${category.id || 'pressreader'}-${index}`,
        image: item.image || item.thumbnailUrl || '',
        thumbnailUrl: item.thumbnailUrl || item.image || '',
        url: item.url || item.openUrl || '',
        openUrl: item.openUrl || item.url || '',
        categoryId: item.categoryId || category.id || 'actualites',
        categoryTitle: item.categoryTitle || fallbackTitle || category.title || 'Actualites',
      }))
      .filter(item => item.title || item.image || item.url);
    const catalogFetch = api.pressReader?.catalogFetch;
    const categoryCatalog = api.pressReader?.categoryCatalog;
    if (!catalogFetch && !categoryCatalog) {
      setPressShelfStatus('PressReader catalog API is not available in this runtime.');
      return;
    }
    setPressApiLoadingCategoryId(category.id);
    setPressShelfStatus(`Loading ${category.title || 'Actualités'} from PressReader Journaux sections...`);
    try {
      if (categoryCatalog) {
        const result = await categoryCatalog({
          categoryId: category.id || 'actualites',
          title: category.title || 'Actualites',
          mediaType: 'newspapers',
          locale: 'fr-CA',
        });
        if (!result?.ok) {
          const message = result?.error || 'PressReader category API returned no readable Journaux data.';
          setPressShelfStatus(message);
          api.log?.('[pressreader] category-api-empty', category.title || category.id, message);
          return;
        }
        const sections = (Array.isArray(result.subcategories) ? result.subcategories : result.sections || [])
          .map(section => ({
            id: section.id,
            title: section.title,
            count: section.count,
            publications: uniquePressReaderPublications(normalizeCategoryItems(section.publications || section.items || [], section.title), 30),
          }))
          .filter(section => section.publications.length);
        const visibleItems = uniquePressReaderPublications(
          normalizeCategoryItems(
            Array.isArray(result.publications) ? result.publications : result.items || sections.flatMap(section => section.publications),
            result.category?.title || category.title
          ),
          140
        );
        if (!visibleItems.length) {
          api.log?.('[pressreader] category-api-no-items', category.title || category.id);
          setPressShelfStatus(`PressReader API returned no readable Journaux publications for ${category.title || 'Actualites'}.`);
          return;
        }
        const liveGroup = {
          id: category.id || result.category?.id || 'actualites',
          title: category.title || result.category?.title || 'Actualites',
          sectionLabel: result.sectionLabel || 'Journaux',
          publications: visibleItems,
          sections,
          sourceUrl: result.sourceUrl || PRESSREADER_NEWSPAPERS_SOURCE_URL,
          apiLoaded: true,
        };
        setPressApiGroups(groups => [liveGroup, ...groups.filter(group => group.id !== liveGroup.id)]);
        setPressShelfStatus(`${visibleItems.length} PressReader newspaper${visibleItems.length === 1 ? '' : 's'} loaded from ${sections.length} Journaux subcategor${sections.length === 1 ? 'y' : 'ies'}.`);
        api.log?.('[pressreader] category-api-loaded', liveGroup.title, `items=${visibleItems.length}`, `sections=${sections.map(section => `${section.title}:${section.publications.length}`).join(', ')}`);
        return;
      }

      const sectionRequests = pressReaderActualitesNewspaperSectionRequests();
      const normalizePages = (pages = [], sectionTitle = category.title) => {
        const seenItems = new Set();
        return pages
          .flatMap(page => findPressReaderPublicationArray(page?.data))
          .map((item, index) => normalizePressReaderApiPublication(item, index, { id: category.id, title: sectionTitle || category.title }))
          .filter(item => item.title || item.image || item.url)
          .filter(item => {
            const key = item.cid || item.url || item.image || item.title;
            if (!key || seenItems.has(key)) return false;
            seenItems.add(key);
            return true;
          });
      };
      const sectionResults = await Promise.all(sectionRequests.map(async section => {
        if (!section.endpoints.length) return { section, pages: [], failed: false };
        const pages = await Promise.all(section.endpoints.map(endpoint => catalogFetch(endpoint)));
        const failed = pages.find(page => !page?.ok);
        if (failed) api.log?.('[pressreader] api-section-failed', section.title, failed?.error || 'unknown', section.endpoints.join(' | '));
        return { section, pages: failed ? [] : pages, failed: !!failed };
      }));
      const samplePage = sectionResults.flatMap(result => result.pages)[0];
      const sampleItem = findPressReaderPublicationArray(samplePage?.data)[0];
      if (sampleItem) {
        api.log?.('[pressreader] api-publication-shape', JSON.stringify(summarizePressReaderApiShape(sampleItem)));
      }
      let allItems = normalizePages(
        sectionResults.find(result => result.section.id === 'all-news')?.pages || [],
        'Toutes les Nouvelles'
      );
      if (!allItems.length) {
        const fallbackPages = await Promise.all(pressReaderActualitesFallbackEndpoints().map(endpoint => catalogFetch(endpoint)));
        const failedFallback = fallbackPages.find(page => !page?.ok);
        if (failedFallback) {
          setPressShelfStatus(failedFallback?.error || 'PressReader publications fetch failed.');
          return;
        }
        allItems = normalizePages(fallbackPages, category.title);
      }
      const sections = sectionResults
        .map(({ section, pages }) => {
          let publications = normalizePages(pages, section.title);
          if (!publications.length && section.deriveFromAll) publications = allItems.filter(section.deriveFromAll);
          if (!publications.length && section.fallbackFromAll) publications = allItems.filter(section.fallbackFromAll);
          publications = uniquePressReaderPublications(publications, 30);
          return { id: section.id, title: section.title, publications };
        })
        .filter(section => section.publications.length);
      const visibleItems = uniquePressReaderPublications(
        [...sections.flatMap(section => section.publications), ...allItems],
        140
      );
      if (!visibleItems.length) {
        api.log?.('[pressreader] api-category-empty', category.title || category.id);
        setPressShelfStatus(`PressReader API returned no readable Journaux publications for ${category.title || 'Actualités'}.`);
        return;
      }
      const liveGroup = {
        id: category.id || 'actualites',
        title: category.title || 'Actualités',
        sectionLabel: 'Journaux',
        publications: visibleItems,
        sections,
        sourceUrl: PRESSREADER_NEWSPAPERS_SOURCE_URL,
        apiLoaded: true,
      };
      setPressApiGroups(groups => [liveGroup, ...groups.filter(group => group.id !== liveGroup.id)]);
      setPressShelfStatus(`${visibleItems.length} PressReader newspaper${visibleItems.length === 1 ? '' : 's'} loaded from ${sections.length} Journaux section${sections.length === 1 ? '' : 's'}.`);
      api.log?.('[pressreader] api-category-loaded', liveGroup.title, `items=${visibleItems.length}`, `sections=${sections.map(section => `${section.title}:${section.publications.length}`).join(', ')}`);
    } catch (error) {
      const message = error?.message || String(error);
      setPressShelfStatus(`PressReader API category load failed: ${message}`);
      api.log?.('[pressreader] api-category-error', message);
    } finally {
      setPressApiLoadingCategoryId('');
    }
  }

  function summarizePressReaderNetworkSnapshot(snapshot) {
    if (!snapshot?.ok) return 'API inspect unavailable.';
    const keyState = snapshot.hasSubscriptionKeyHeader
      ? 'subscription-key header observed'
      : snapshot.hasAuthorizationHeader
        ? 'authorization header observed'
        : snapshot.hasCookieHeader
          ? 'cookie-backed session observed'
          : 'no API auth header observed';
    const top = (snapshot.top || []).slice(0, 3).map(item => {
      const status = item.statuses ? ` ${item.statuses}` : '';
      return `${item.method || 'GET'} ${item.url}${status}`;
    });
    return top.length
      ? `API inspect: ${snapshot.total || 0} requests, ${keyState}. ${top.join(' | ')}`
      : `API inspect: ${snapshot.total || 0} requests, ${keyState}. No catalog endpoint observed yet.`;
  }

  async function inspectPressReaderApi() {
    if (!isPressReader || pressNetworkInspecting) return;
    const network = api.pressReader;
    if (!network?.networkStart || !network?.networkSnapshot) {
      setPressShelfStatus('PressReader API inspector is not available in this runtime.');
      return;
    }
    const wv = webviewRef.current;
    setPressNetworkInspecting(true);
    setPressShelfStatus('Inspecting PressReader catalog network calls...');
    api.log?.('[pressreader] api-inspect-start');
    try {
      await network.networkStart({ durationMs: 45000, clear: true });
      pressManualLoginOpenRef.current = false;
      setPressManualLoginOpen(false);
      setPressNativeCatalogOpen(true);
      setLoading(false);
      setProgress(100);
      updatePressGate('ready', '');
      if (wv) {
        try { wv.loadURL?.(PRESSREADER_CATALOG_URL); }
        catch { try { wv.src = PRESSREADER_CATALOG_URL; } catch {} }
      }
      const sampleDelays = [1800, 4200, 8200, 14000, 18000];
      let snapshot = await network.networkSnapshot();
      let previousDelay = 0;
      for (const delay of sampleDelays) {
        await new Promise(resolve => window.setTimeout(resolve, delay - previousDelay));
        previousDelay = delay;
        snapshot = await network.networkSnapshot();
        setPressShelfStatus(summarizePressReaderNetworkSnapshot(snapshot));
      }
      api.log?.('[pressreader] api-inspect-summary', JSON.stringify(snapshot));
      setPressShelfStatus(summarizePressReaderNetworkSnapshot(snapshot));
    } catch (error) {
      const message = error?.message || String(error);
      setPressShelfStatus(`PressReader API inspect failed: ${message}`);
      api.log?.('[pressreader] api-inspect-error', message);
    } finally {
      setPressNetworkInspecting(false);
    }
  }

  function safeWebviewCall(fn, fallback = null) {
    try {
      const value = fn();
      return value === undefined ? fallback : value;
    } catch {
      return fallback;
    }
  }

  function safeWebviewUrl(fallback = reader.url) {
    const wv = webviewRef.current;
    if (!wv) return fallback || '';
    return safeWebviewCall(() => wv.getURL?.() || fallback || '', fallback || '');
  }

  async function logWebIslandDiagnostics(phase, extra = {}) {
    if (!WEB_ISLAND_DIAG_ENABLED || isLive) return;
    const wv = webviewRef.current;
    const frame = cardRef.current?.querySelector?.('.browser-island-frame') || null;
    const domReady = webDiagDomReadyRef.current;
    const payload = {
      phase,
      source,
      title,
      flavor: reader.flavor || '',
      readerUrl: reader.url,
      currentUrl,
      loading,
      progress,
      selfLaunching,
      hasTransition: !!transition,
      transitionKey: transition?.key || '',
      host: {
        window: { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio },
        stage: sizeSummary(stageRef.current),
        card: sizeSummary(cardRef.current),
        frame: sizeSummary(frame),
        webview: sizeSummary(wv),
        activeElement: nodeNameSummary(document.activeElement),
      },
      webviewState: wv ? {
        domReady,
        loading: safeWebviewCall(() => wv.isLoading?.(), null),
        loadingMainFrame: safeWebviewCall(() => wv.isLoadingMainFrame?.(), null),
        url: safeWebviewUrl(reader.url),
        webContentsId: domReady ? safeWebviewCall(() => wv.getWebContentsId?.(), null) : null,
      } : null,
      extra,
    };
    if (wv && domReady) {
      try {
        payload.guest = await wv.executeJavaScript(WEB_ISLAND_GUEST_DIAG_JS, true);
      } catch (error) {
        payload.guestError = error?.message || String(error);
      }
    } else if (wv) {
      payload.guestSkipped = 'waiting-for-dom-ready';
    }
    const message = JSON.stringify(payload);
    console.warn('[webdiag]', message);
    api.log?.('[webdiag]', message);
  }

  useEffect(() => {
    webDiagDomReadyRef.current = false;
    setCurrentUrl(reader.url);
    if (isPressReader) setPressNativeCatalogOpen(true);
  }, [reader.url]);

  useEffect(() => {
    if (!WEB_ISLAND_DIAG_ENABLED || isLive) return undefined;
    const seq = webDiagSeqRef.current + 1;
    webDiagSeqRef.current = seq;
    const timers = WEB_ISLAND_DIAG_DELAYS.map(delay => window.setTimeout(() => {
      if (webDiagSeqRef.current !== seq) return;
      logWebIslandDiagnostics(`timer:${delay}ms`, { seq });
    }, delay));
    return () => timers.forEach(timer => window.clearTimeout(timer));
  }, [reader.url, isLive]);

  useEffect(() => {
    setShowWebSignIn(!!reader.authUrl && !isOutlook);
  }, [reader.authUrl, isOutlook, reader.url]);

  useEffect(() => {
    let cancelled = false;
    const direct = isLiveDirectHls ? reader.url : '';
    window.clearTimeout(liveResolveTimerRef.current);
    setLiveHlsFailed(false);
    setLiveHlsUrl(reader.hlsUrl || direct || '');
    if (!isLiveResolvable || reader.hlsUrl || direct) return () => { cancelled = true; };

    setLoading(true);
    setProgress(38);
    api.log?.('[live] zoom-hls-resolve-start', reader.title || reader.url, reader.url);
    liveResolveTimerRef.current = window.setTimeout(() => {
      if (cancelled) return;
      api.log?.('[live] zoom-hls-resolve-timeout', reader.title || reader.url);
      setLiveHlsUrl('');
      setLiveHlsFailed(true);
    }, 9000);
    const resolveHls = api.live?.hls || (isLiveYouTube ? api.live?.youtubeHls : null);
    if (!resolveHls) {
      api.log?.('[live] zoom-hls-api-missing', reader.title || reader.url);
      setLiveHlsFailed(true);
      return () => { cancelled = true; };
    }
    const payload = api.live?.hls ? (reader.liveFeed || {
      url: reader.url,
      embedUrl: reader.url,
      title: reader.title,
      source: reader.source,
      referrer: reader.referrer,
      hls: reader.hls,
      youtube: reader.youtube,
    }) : reader.url;
    resolveHls(payload).then(result => {
      if (cancelled) return;
      window.clearTimeout(liveResolveTimerRef.current);
      if (result?.ok && result.hlsUrl) {
        api.log?.('[live] zoom-hls-resolve-ok', reader.title || reader.url, `provider=${result.provider || '--'}`, `videoId=${result.videoId || '--'}`, `status=${result.playerStatus || '--'}`);
        setLiveHlsUrl(result.hlsUrl);
        setProgress(78);
      } else {
        api.log?.('[live] zoom-hls-resolve-failed', reader.title || reader.url, result?.error || result?.playerStatus || JSON.stringify(result || {}));
        console.warn('[wp-live] zoom HLS unavailable', reader.title || reader.url, result?.error || result?.playerStatus || result);
        setLiveHlsFailed(true);
      }
    }).catch(error => {
      if (cancelled) return;
      window.clearTimeout(liveResolveTimerRef.current);
      api.log?.('[live] zoom-hls-resolve-exception', reader.title || reader.url, error?.message || String(error));
      console.warn('[wp-live] zoom HLS resolve failed', reader.title || reader.url, error);
      setLiveHlsFailed(true);
    });

    return () => {
      cancelled = true;
      window.clearTimeout(liveResolveTimerRef.current);
    };
  }, [isLiveDirectHls, isLiveResolvable, isLiveYouTube, reader.hlsUrl, reader.url, reader.title, reader.source, reader.referrer, reader.hls, reader.youtube, reader.liveFeed]);

  useEffect(() => {
    window.clearTimeout(livePlaybackTimerRef.current);
    if (!isLiveResolvable || !liveNativeHlsUrl) return undefined;
    api.log?.('[live] zoom-hls-playback-start', reader.title || reader.url);
    livePlaybackTimerRef.current = window.setTimeout(() => {
      api.log?.('[live] zoom-hls-playback-timeout', reader.title || reader.url);
      setLiveHlsUrl('');
      setLiveHlsFailed(true);
    }, 16000);
    return () => window.clearTimeout(livePlaybackTimerRef.current);
  }, [isLiveResolvable, liveNativeHlsUrl, reader.title, reader.url]);

  useEffect(() => {
    if (!isLive) return;
    setLoading(true);
    setProgress(42);
    const timer = setTimeout(() => {
      setLoading(false);
      setProgress(100);
    }, 950);
    return () => clearTimeout(timer);
  }, [isLive, reader.url]);

  function applyLiveAudioState(nextMuted = liveMutedRef.current) {
    const wv = webviewRef.current;
    if (!wv) return;
    try { wv.setAudioMuted?.(!!nextMuted); } catch {}
    try {
      wv.executeJavaScript(`
        (() => {
          const muted = ${nextMuted ? 'true' : 'false'};
          for (const media of document.querySelectorAll('video,audio')) {
            media.muted = muted;
            media.volume = muted ? 0 : Math.max(media.volume || 0, 0.72);
            media.play && media.play().catch(() => {});
          }
        })();
      `, true);
    } catch {}
  }

  function scheduleLiveAudioState(nextMuted = liveMutedRef.current) {
    liveAudioSyncTimersRef.current.forEach(timer => window.clearTimeout(timer));
    liveAudioSyncTimersRef.current = [0, 180, 520, 1200, 2600, 5000, 7600].map(delay => (
      window.setTimeout(() => applyLiveAudioState(nextMuted), delay)
    ));
  }

  useEffect(() => {
    liveMutedRef.current = liveMuted;
    if (!isLive) return;
    scheduleLiveAudioState(liveMuted);
  }, [isLive, liveMuted, reader.url, liveHlsFailed]);

  useEffect(() => () => {
    liveAudioSyncTimersRef.current.forEach(timer => window.clearTimeout(timer));
    liveAudioSyncTimersRef.current = [];
  }, []);

  useEffect(() => {
    if (!isLive) return;
    const wv = webviewRef.current;
    if (!wv) return;
    const apply = () => applyLiveAudioState(liveMutedRef.current);
    wv.addEventListener('dom-ready', apply);
    wv.addEventListener('did-start-loading', apply);
    wv.addEventListener('did-stop-loading', apply);
    wv.addEventListener('did-navigate', apply);
    wv.addEventListener('did-navigate-in-page', apply);
    wv.addEventListener('media-started-playing', apply);
    apply();
    return () => {
      wv.removeEventListener('dom-ready', apply);
      wv.removeEventListener('did-start-loading', apply);
      wv.removeEventListener('did-stop-loading', apply);
      wv.removeEventListener('did-navigate', apply);
      wv.removeEventListener('did-navigate-in-page', apply);
      wv.removeEventListener('media-started-playing', apply);
    };
  }, [isLive, reader.url, liveHlsFailed]);

  function toggleLiveMute(event) {
    event.stopPropagation();
    const next = !liveMuted;
    setLiveAudioOwnerId(next ? '' : liveFeedId);
    scheduleLiveAudioState(next);
    const wv = webviewRef.current;
    if (!wv) return;
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
  }

  useEffect(() => {
    pressAuthRef.current = pressAuth;
  }, [pressAuth]);

  useEffect(() => {
    pressAuthReadyRef.current = pressAuthReady;
  }, [pressAuthReady]);

  useEffect(() => {
    pressGateRef.current = pressGate;
  }, [pressGate]);

  useEffect(() => {
    pressManualLoginOpenRef.current = pressManualLoginOpen;
  }, [pressManualLoginOpen]);

  useEffect(() => {
    let cancelled = false;
    if (!isPressReader) return () => { cancelled = true; };
    Promise.all([
      api.store.get(SK_PRESSREADER_CATALOG_INDEX),
      api.store.get(SK_PRESSREADER_CATEGORY_SELECTION),
      api.store.get(SK_PRESSREADER_GUARDRAIL),
    ]).then(([rawIndex, rawSelection, rawGuardrail]) => {
      if (cancelled) return;
      const selection = parsePressReaderCategorySelection(rawSelection);
      const index = parsePressReaderCatalogIndex(rawIndex);
      let guardrail = parsePressReaderGuardrail(rawGuardrail);
      if (guardrail.blockedUntil > Date.now() && isPressReaderAuthGuardrail(guardrail)) {
        guardrail = { blockedUntil: 0, reason: '' };
        api.store.delete(SK_PRESSREADER_GUARDRAIL).catch(() => {});
        api.log?.('[pressreader] cleared-stale-auth-guardrail');
      }
      pressCategorySelectionRef.current = selection;
      pressCatalogIndexRef.current = index;
      pressGuardrailRef.current = guardrail;
      setPressCategorySelection(selection);
      setPressCatalogIndex(index);
      setPressGuardrail(guardrail);
      const items = flattenPressReaderIndex(index, selection);
      setPressShelfItems(items);
      if (guardrail.blockedUntil > Date.now()) {
        setPressShelfStatus(`PressReader catalog indexing paused: ${guardrail.reason || 'cooldown'}.`);
        return;
      }
      if (items.length) {
        const ageMs = Date.now() - Number(index.updatedAt || 0);
        setPressShelfStatus(ageMs < PRESSREADER_INDEX_TTL_MS
          ? `${items.length} cached publication cover${items.length === 1 ? '' : 's'} ready.`
          : `${items.length} cached cover${items.length === 1 ? '' : 's'} ready; refresh is due.`);
      }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [isPressReader, reader.url]);

  useEffect(() => () => {
    if (pressRevealTimerRef.current) clearTimeout(pressRevealTimerRef.current);
    if (pressAutomationTimerRef.current) clearTimeout(pressAutomationTimerRef.current);
  }, []);

  useEffect(() => {
    let alive = true;
    pressSubmittingRef.current = false;
    if (!isPressReader) {
      setPressAuth(null);
      setPressAuthReady(true);
      setPressManualLoginOpen(false);
      updatePressGate('', '');
      setPressForm({ user: '', pass: '' });
      return () => { alive = false; };
    }

    setPressAuthReady(false);
    updatePressGate('preparing', 'Preparing PressReader session');
    api.store.get(SK_PRESSREADER_AUTH).then(saved => {
      if (!alive) return;
      let parsed = null;
      try { parsed = saved ? JSON.parse(saved) : null; } catch {}
      if (parsed?.u && parsed?.p) {
        setPressAuth(parsed);
        setPressForm({ user: parsed.u, pass: '' });
        updatePressGate('preparing', 'Signing in to PressReader');
      } else {
        setPressAuth(null);
        updatePressGate('preparing', 'PressReader login setup');
      }
      setPressAuthReady(true);
    }).catch(() => {
      if (!alive) return;
      setPressAuth(null);
      setPressAuthReady(true);
      updatePressGate('setup', 'PressReader login setup');
    });
    return () => { alive = false; };
  }, [isPressReader, reader.url]);

  async function signInToWebSession() {
    if (!reader.authUrl) return;
    await api.auth?.openWindow?.(reader.authUrl, `Sign in to ${source}`);
    try { webviewRef.current?.reload?.(); } catch {}
  }

  function openPressReaderPageLogin() {
    if (!isPressReader) return;
    if (pressAutomationTimerRef.current) clearTimeout(pressAutomationTimerRef.current);
    pressSubmittingRef.current = false;
    pressSubmitTimeRef.current = 0;
    pressSubmitRetryRef.current = 0;
    pressStartReadingMaskUntilRef.current = 0;
    pressManualLoginOpenRef.current = true;
    setPressManualLoginOpen(true);
    setPressNativeCatalogOpen(false);
    setLoading(false);
    setProgress(100);
    try {
      const wv = webviewRef.current;
      const current = safeWebviewUrl(reader.url);
      if (wv && !/pressreader\.com/i.test(current || '')) wv.loadURL?.(PRESSREADER_CATALOG_URL);
    } catch {}
    updatePressGate('manual-login', 'Complete sign-in on the PressReader page.');
  }

  function updateWebAuthState(url) {
    if (!reader.authUrl) {
      setShowWebSignIn(false);
      return;
    }
    if (!isOutlook) {
      setShowWebSignIn(true);
      return;
    }
    setShowWebSignIn(/login|signin|oauth|microsoftonline\.com|live\.com/i.test(url || ''));
  }

  function isPressReaderSettled() {
    return isPressReader
      && pressAuthReadyRef.current
      && !pressSubmittingRef.current
      && (!pressGateRef.current || pressGateRef.current === 'ready');
  }

  const runPressReaderAutomation = useCallback(async () => {
    if (!isPressReader) return false;
    if (pressReaderBlockedNow()) {
      setPressShelfStatus(pressReaderGuardrailMessage());
    }
    const wv = webviewRef.current;
    if (!wv) return false;
    if (pressRevealTimerRef.current) clearTimeout(pressRevealTimerRef.current);

    if (!pressAuthReadyRef.current) {
      setLoading(true);
      updatePressGate('preparing', 'Preparing PressReader session');
      return true;
    }

    let probe = null;
    try { probe = await wv.executeJavaScript(PRESSREADER_PROBE_JS, true); } catch {}
    if (!probe) {
      if (isPressReaderSettled()) return false;
      setLoading(true);
      const activeGate = pressGateRef.current && pressGateRef.current !== 'ready';
      if (activeGate || !pressAuthReadyRef.current) {
        updatePressGate(activeGate ? pressGateRef.current : 'preparing', 'Preparing PressReader session');
      }
      return true;
    }

    if (probe.unavailable) {
    pressSubmittingRef.current = false;
    pressSubmitTimeRef.current = 0;
    pressSubmitRetryRef.current = 0;
    pressStartReadingMaskUntilRef.current = 0;
      setLoading(false);
      setProgress(100);
      updatePressGate('ready', '');
      api.log?.('[pressreader] publication-unavailable', probe.href || '', probe.title || '');
      pressRevealTimerRef.current = setTimeout(() => updatePressGate('', ''), 180);
      return false;
    }

    if (probe.hasLogin) {
      if (pressManualLoginOpenRef.current) {
        setLoading(false);
        setProgress(100);
        updatePressGate('manual-login', 'Complete sign-in on the PressReader page.');
        return false;
      }
      const saved = pressAuthRef.current;
      if (saved?.u && saved?.p) {
        if (probe.authRejected) {
          api.log?.('[pressreader] login-page-warning-ignored', probe.href || '', probe.title || '');
          await clearPressReaderGuardrail();
        }
        setLoading(true);
        setProgress(value => Math.max(value, 42));
        updatePressGate('signing-in', 'Signing in to PressReader');
        if (pressSubmittingRef.current) {
          if (Date.now() - pressSubmitTimeRef.current < 12000) {
            queuePressAutomation(2200);
            return true;
          }
          pressSubmittingRef.current = false;
          pressSubmitTimeRef.current = 0;
          if (pressSubmitRetryRef.current < 3) {
            updatePressGate('signing-in', 'Retrying PressReader sign-in');
            queuePressAutomation(500);
          } else {
            setPressForm({ user: saved.u || probe.user || '', pass: '' });
            openPressReaderPageLogin();
          }
          return true;
        }
        if (!pressSubmittingRef.current) {
          pressSubmittingRef.current = true;
          pressSubmitTimeRef.current = Date.now();
          pressSubmitRetryRef.current += 1;
          let result = null;
          try { result = await wv.executeJavaScript(buildPressReaderLoginScript(saved), true); } catch (error) {
            result = { ok: false, error: error?.message };
          }
          if (!result?.ok) {
            pressSubmittingRef.current = false;
            setPressForm({ user: saved.u || probe.user || '', pass: '' });
            openPressReaderPageLogin();
            return true;
          }
          queuePressAutomation(3600);
        }
        return true;
      }

      pressSubmittingRef.current = false;
      pressSubmitRetryRef.current = 0;
      setLoading(false);
      setProgress(100);
      updatePressGate('setup', 'Save your PressReader login once. Future opens will sign in behind the glass.');
      if (probe.user) setPressForm(form => ({ ...form, user: form.user || probe.user }));
      return true;
    }

    if (pressManualLoginOpenRef.current) {
      setLoading(false);
      setProgress(100);
      updatePressGate('manual-login', 'Complete sign-in on the PressReader page, then return to the catalog UI.');
      return false;
    }

    if (probe.hasStartReading && !PRESSREADER_AUTO_START_READING) {
      pressSubmittingRef.current = false;
      pressSubmitTimeRef.current = 0;
      setLoading(false);
      setProgress(100);
      updatePressGate('ready', '');
      api.log?.('[pressreader] start-reading-auto-disabled', probe.href || '');
      pressRevealTimerRef.current = setTimeout(() => updatePressGate('', ''), 180);
      return false;
    }

    if (probe.hasStartReading) {
      const nextGate = probe.recentUserClick || pressGateRef.current === 'opening-publication'
        ? 'opening-publication'
        : 'opening';
      pressStartReadingMaskUntilRef.current = Math.max(pressStartReadingMaskUntilRef.current, Date.now() + 4500);
      setLoading(true);
      setProgress(value => Math.max(value, 70));
      updatePressGate(nextGate, nextGate === 'opening-publication' ? 'Opening PressReader publication' : 'Opening PressReader catalog');
      let result = null;
      try { result = await wv.executeJavaScript(PRESSREADER_START_READING_JS, true); } catch (error) {
        result = { ok: false, error: error?.message };
      }
      if (!result?.ok) {
        updatePressGate('', '');
        return false;
      }
      queuePressAutomation(result.skipped ? 1200 : 900);
      return true;
    }

    pressSubmittingRef.current = false;
    pressSubmitTimeRef.current = 0;
    pressSubmitRetryRef.current = 0;
    const maskRemainingMs = probe.readyState === 'complete' ? 0 : pressStartReadingMaskUntilRef.current - Date.now();
    if (maskRemainingMs > 0) {
      setLoading(true);
      setProgress(value => Math.max(value, 86));
      updatePressGate(pressGateRef.current && pressGateRef.current !== 'ready' ? pressGateRef.current : 'opening', 'Opening PressReader catalog');
      queuePressAutomation(maskRemainingMs + 80);
      return true;
    }
    pressStartReadingMaskUntilRef.current = 0;
    const gateAge = Date.now() - pressGateSinceRef.current;
    const activeGate = pressGateRef.current;
    const minimumMaskMs = activeGate === 'opening-publication' ? 2800 : activeGate === 'opening' ? 2200 : 0;
    if (minimumMaskMs && gateAge < minimumMaskMs) {
      setLoading(true);
      queuePressAutomation(minimumMaskMs - gateAge + 80);
      return true;
    }
    setLoading(false);
    setProgress(100);
    updatePressGate('ready', '');
    prefetchPressReaderPublication({ force: true });
    pressRevealTimerRef.current = setTimeout(() => updatePressGate('', ''), 520);
    return false;
  }, [isPressReader]);

  useEffect(() => {
    if (!isPressReader || !pressAuthReady) return;
    const timer = setTimeout(() => runPressReaderAutomation(), 80);
    return () => clearTimeout(timer);
  }, [isPressReader, pressAuthReady, pressAuth?.u, pressAuth?.p, runPressReaderAutomation]);

  async function savePressReaderCredentials(event) {
    event?.preventDefault?.();
    const user = pressForm.user.trim();
    const pass = pressForm.pass;
    if (!user || !pass) {
      setPressMessage("No d'usager and password are required.");
      return;
    }
    const next = { u: user, p: pass };
    pressAuthRef.current = next;
    pressAuthReadyRef.current = true;
    pressSubmittingRef.current = false;
    pressSubmitTimeRef.current = 0;
    setPressAuth(next);
    setPressAuthReady(true);
    updatePressGate('signing-in', 'Signing in to PressReader');
    setLoading(true);
    await api.store.set(SK_PRESSREADER_AUTH, JSON.stringify(next));
    await clearPressReaderGuardrail();
    queuePressAutomation(80);
  }

  async function forgetPressReaderCredentials() {
    await api.store.delete(SK_PRESSREADER_AUTH);
    await clearPressReaderGuardrail();
    pressAuthRef.current = null;
    pressSubmittingRef.current = false;
    setPressAuth(null);
    setPressForm({ user: '', pass: '' });
    updatePressGate('setup', 'PressReader login cleared.');
    setLoading(false);
  }

  useEffect(() => {
    if (!isPressReader || !pressNewspapersSourceRequest) return undefined;
    const wv = pressNewspapersSourceRef.current;
    if (!wv) return undefined;
    let disposed = false;
    let timer = 0;
    let attempts = 0;

    const publishNewspaperGroup = (liveGroup, sourceLabel = 'the PressReader web catalog') => {
      if (disposed || !liveGroup) return;
      setPressApiGroups(groups => [liveGroup, ...groups.filter(group => group.id !== liveGroup.id)]);
      const sectionCount = liveGroup.sections?.length || 0;
      setPressShelfStatus(`${liveGroup.publications.length} PressReader newspaper${liveGroup.publications.length === 1 ? '' : 's'} loaded from ${sourceLabel}${sectionCount ? ` (${sectionCount} sections)` : ''}.`);
      api.log?.('[pressreader] web-newspapers-loaded', `items=${liveGroup.publications.length}`, `sections=${(liveGroup.sections || []).map(section => `${section.title}:${section.publications.length}`).join(', ')}`);
      setPressApiLoadingCategoryId('');
      setPressNewspapersSourceRequest(null);
    };

    const finishWithApiFallback = async (reason = 'web extract unavailable', webGroup = null) => {
      if (disposed) return;
      const category = pressNewspapersSourceRequest.category || { id: 'actualites', title: 'Actualites' };
      try {
        setPressShelfStatus(`PressReader web catalog incomplete; filling Journaux sections from catalog API...`);
        const { group: fallbackGroup, error } = await fetchPressReaderCategoryCatalogGroup(category, reason);
        const liveGroup = mergePressReaderCatalogGroups(webGroup, fallbackGroup);
        if (!liveGroup) {
          setPressShelfStatus(error || `PressReader fallback returned no readable Journaux publications.`);
          return;
        }
        publishNewspaperGroup(
          liveGroup,
          webGroup && fallbackGroup ? 'the web catalog plus API-classified rows' : fallbackGroup ? 'API fallback' : 'the PressReader web catalog'
        );
        if (error && webGroup && !fallbackGroup) api.log?.('[pressreader] api-fallback-unavailable', error);
      } catch (error) {
        setPressShelfStatus(`PressReader API fallback failed: ${error?.message || String(error)}`);
      } finally {
        setPressApiLoadingCategoryId('');
        setPressNewspapersSourceRequest(null);
      }
    };

    const scheduleExtract = (delay = 900) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(async () => {
        if (disposed) return;
        try {
          const result = await wv.executeJavaScript(PRESSREADER_NEWSPAPERS_EXTRACT_JS, true);
          const liveGroup = result?.ok
            ? buildPressReaderWebCatalogGroup(result, pressNewspapersSourceRequest.category)
            : null;
          if (liveGroup) {
            if (hasPressReaderNewspaperRows(liveGroup)) {
              publishNewspaperGroup(liveGroup, 'the PressReader web catalog');
              return;
            }
            attempts += 1;
            api.log?.('[pressreader] web-newspapers-incomplete', `attempt=${attempts}`, `sections=${(liveGroup.sections || []).map(section => `${section.title}:${section.publications.length}`).join(', ')}`);
            if (attempts < 2) {
              setPressShelfStatus('Waiting for PressReader newspaper subcategories...');
              scheduleExtract(2200);
              return;
            }
            await finishWithApiFallback('only one web shelf found', liveGroup);
            return;
          }
          attempts += 1;
          if (attempts < 2) {
            setPressShelfStatus('Waiting for PressReader web catalog shelves...');
            scheduleExtract(1800);
            return;
          }
          api.log?.('[pressreader] web-newspapers-empty', result?.message || 'empty result');
          await finishWithApiFallback(result?.message || 'no sections found');
        } catch (error) {
          attempts += 1;
          if (attempts < 2) {
            scheduleExtract(1800);
            return;
          }
          api.log?.('[pressreader] web-newspapers-error', error?.message || String(error));
          await finishWithApiFallback(error?.message || String(error));
        }
      }, delay);
    };

    const onReady = () => scheduleExtract(1000);
    const onStop = () => scheduleExtract(700);
    wv.addEventListener('dom-ready', onReady);
    wv.addEventListener('did-stop-loading', onStop);
    scheduleExtract(3600);
    return () => {
      disposed = true;
      window.clearTimeout(timer);
      wv.removeEventListener('dom-ready', onReady);
      wv.removeEventListener('did-stop-loading', onStop);
    };
  }, [isPressReader, pressNewspapersSourceRequest]);

  useEffect(() => {
    if (!isPressReader || !pressCrawlerUrl) return undefined;
    const wv = pressCrawlerRef.current;
    if (!wv) return undefined;
    let timer = 0;
    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => extractPressReaderCrawlerPage('category-crawler'), PRESSREADER_CRAWL_INTERVAL_MS);
    };
    wv.addEventListener('dom-ready', schedule);
    wv.addEventListener('did-stop-loading', schedule);
    return () => {
      window.clearTimeout(timer);
      wv.removeEventListener('dom-ready', schedule);
      wv.removeEventListener('did-stop-loading', schedule);
    };
  }, [isPressReader, pressCrawlerUrl]);

  useEffect(() => {
    if (!loading) { setProgress(100); return; }
    setProgress(16);
    const timer = setInterval(() => {
      setProgress(value => Math.min(91, value + Math.max(1.5, (94 - value) * 0.08)));
    }, 140);
    return () => clearInterval(timer);
  }, [loading, reader.url]);

  useEffect(() => {
    const wv = webviewRef.current;
    if (!wv) return;

    const darkCSS = `
      :root { color-scheme: dark !important; }
      html, body {
        background:#0b1328 !important;
        color:#f7faff !important;
      }
      body {
        scrollbar-color: rgba(47,109,255,.55) rgba(255,255,255,.08) !important;
      }
      a, a * { color:#8db7ff !important; }
      input, textarea, select, button {
        color:#f7faff !important;
        background-color:rgba(8,14,28,.88) !important;
        border-color:rgba(238,248,255,.24) !important;
      }
      [role="button"], button { box-shadow:none !important; }
      header, nav, aside, main, section, article, div {
        border-color:rgba(238,248,255,.14) !important;
      }
      ::selection {
        background:rgba(47,109,255,.46) !important;
        color:#fff !important;
      }
      ${isPressReader ? `
      :root, html, body {
        color-scheme: dark !important;
        background:#111214 !important;
        color:#f7faff !important;
      }
      body {
        scrollbar-color: rgba(170,180,195,.55) #111214 !important;
      }
      header, nav, main, section, article, aside, footer,
      [role="banner"], [role="navigation"], [role="main"], [role="dialog"],
      [class*="header"], [class*="Header"], [class*="toolbar"], [class*="Toolbar"],
      [class*="modal"], [class*="Modal"], [class*="dialog"], [class*="Dialog"],
      [class*="catalog"], [class*="Catalog"], [class*="content"], [class*="Content"] {
        background-color:#181a1d !important;
        color:#f7faff !important;
        border-color:rgba(238,248,255,.16) !important;
      }
      [class*="card"], [class*="Card"], [class*="tile"], [class*="Tile"] {
        background-color:#202329 !important;
        color:#f7faff !important;
        border-color:rgba(238,248,255,.12) !important;
      }
      [class*="publication"], [class*="Publication"], [class*="cover"], [class*="Cover"],
      [class*="thumb"], [class*="Thumb"], [class*="image"], [class*="Image"],
      picture, figure, img {
        background-color:#202329 !important;
      }
      img:not([src]), img[src=""], img[aria-busy="true"], img[loading] {
        background:
          linear-gradient(145deg, #202329, #16181b) !important;
      }
      button, [role="button"], input, select, textarea {
        background-color:#24272d !important;
        color:#f7faff !important;
        border-color:rgba(238,248,255,.22) !important;
      }
      button:hover, [role="button"]:hover {
        background-color:#2d3138 !important;
      }
      ` : ''}
    `;

    const pressReaderDarkJS = `
      (() => {
        if (window.__wpPressReaderDarkActive) return;
        window.__wpPressReaderDarkActive = true;
        const base = '#111214';
        const panel = '#181a1d';
        const raised = '#202329';
        const text = '#f7faff';
        const styleId = 'wp-pressreader-dark-style';
        const skip = new Set(['SCRIPT', 'STYLE', 'SVG', 'PATH']);
        const frameCss = [
          ':root{color-scheme:dark!important}',
          'html,body{background:#111214!important;color:#f7faff!important}',
          'body{scrollbar-color:rgba(170,180,195,.55) #111214!important}',
          'a,a *{color:#8db7ff!important}',
          '[role="toolbar"],[role="banner"],[class*="Toolbar"],[class*="Header"]{background:#181a1d!important;color:#f7faff!important}',
          'main,section,article,aside,footer,[role="main"],[role="region"],[role="dialog"]{background-color:#181a1d!important;color:#f7faff!important}',
          '[class*="publication"],[class*="Publication"],[class*="cover"],[class*="Cover"],[class*="thumb"],[class*="Thumb"],[class*="image"],[class*="Image"],picture,figure,img{background-color:#202329!important}',
          'img:not([src]),img[src=""],img[aria-busy="true"],img[loading]{background:linear-gradient(145deg,#202329,#16181b)!important}',
          'input,textarea,select,button{background-color:#24272d!important;color:#f7faff!important;border-color:rgba(238,248,255,.24)!important}'
        ].join('\\n');
        function parseRgb(value) {
          const match = /rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)(?:,\\s*([\\d.]+))?\\)/.exec(value || '');
          if (!match) return null;
          return {
            r: Number(match[1]),
            g: Number(match[2]),
            b: Number(match[3]),
            a: match[4] == null ? 1 : Number(match[4])
          };
        }
        function isLightSurface(rgb) {
          if (!rgb || rgb.a < 0.45) return false;
          const max = Math.max(rgb.r, rgb.g, rgb.b);
          const min = Math.min(rgb.r, rgb.g, rgb.b);
          return max >= 112 && min >= 86;
        }
        function isDarkText(rgb) {
          if (!rgb || rgb.a < 0.45) return false;
          return Math.max(rgb.r, rgb.g, rgb.b) < 120;
        }
        function isRaisedLike(el) {
          const text = ((el.className && String(el.className)) + ' ' + (el.getAttribute('role') || '') + ' ' + (el.getAttribute('aria-label') || '')).toLowerCase();
          return /toolbar|command|header|button|menu|ribbon|bar|card|tile|modal|dialog/.test(text);
        }
        function injectStyle(doc) {
          try {
            const host = doc.head || doc.documentElement;
            if (!host || doc.getElementById(styleId)) return;
            const style = doc.createElement('style');
            style.id = styleId;
            style.textContent = frameCss;
            host.appendChild(style);
          } catch {}
        }
        function nodesFor(root) {
          const scope = root && root.querySelectorAll ? root : document;
          const baseNodes = scope.nodeType === 9 ? [scope.documentElement, scope.body] : [scope];
          return [...baseNodes, ...scope.querySelectorAll('*')].filter(Boolean);
        }
        function recolor(root) {
          const doc = root?.nodeType === 9 ? root : (root?.ownerDocument || document);
          injectStyle(doc);
          for (const el of nodesFor(root || doc)) {
            if (!el || skip.has(el.tagName)) continue;
            const style = doc.defaultView.getComputedStyle(el);
            const bg = parseRgb(style.backgroundColor);
            if (isLightSurface(bg)) {
              el.style.setProperty('background-color', isRaisedLike(el) ? raised : panel, 'important');
              el.style.setProperty('background-image', 'none', 'important');
            }
            const color = parseRgb(style.color);
            if (isDarkText(color)) el.style.setProperty('color', text, 'important');
          }
        }
        function recolorFrames(doc) {
          try {
            for (const frame of doc.querySelectorAll('iframe')) {
              try {
                const frameDoc = frame.contentDocument;
                if (!frameDoc) continue;
                recolor(frameDoc);
                watch(frameDoc);
                recolorFrames(frameDoc);
              } catch {}
            }
          } catch {}
        }
        let queued = false;
        function schedule(root) {
          if (queued) return;
          queued = true;
          requestAnimationFrame(() => {
            queued = false;
            try {
              recolor(root || document);
              recolorFrames(document);
            } catch {}
          });
        }
        function watch(doc) {
          try {
            if (!doc.documentElement || doc.__wpPressReaderDarkWatched) return;
            doc.__wpPressReaderDarkWatched = true;
            new MutationObserver(mutations => {
              for (const mutation of mutations) {
                for (const node of mutation.addedNodes) {
                  if (node.nodeType === 1) schedule(node);
                }
              }
            }).observe(doc.documentElement, { childList: true, subtree: true });
          } catch {}
        }
        watch(document);
        schedule(document);
        setTimeout(() => schedule(document), 250);
        setTimeout(() => schedule(document), 700);
        setTimeout(() => schedule(document), 1600);
        setTimeout(() => schedule(document), 3600);
      })();
    `;

    const applyDark = () => {
      if (isLive) {
        if (isLiveYouTube) {
          try { wv.insertCSS(YOUTUBE_PLAYER_CSS); } catch {}
        }
        return;
      }
      if (!isOutlook) {
        try { wv.insertCSS(darkCSS); } catch {}
      }
      if (isPressReader) {
        try { wv.executeJavaScript(pressReaderDarkJS, true); } catch {}
        try { wv.executeJavaScript(PRESSREADER_INTERACTION_TRACKER_JS, true); } catch {}
        if (!isPressReaderSettled()) setTimeout(prefetchPressReaderPublication, 650);
      }
    };
    const onDomReady = () => {
      webDiagDomReadyRef.current = true;
      applyDark();
      logWebIslandDiagnostics('dom-ready');
    };
    const onStart = () => {
      webDiagDomReadyRef.current = false;
      const url = safeWebviewUrl(reader.url);
      if (isLive) api.log?.('[live] zoom-webview-start-loading', title, url);
      logWebIslandDiagnostics('did-start-loading');
      const pressSettled = isPressReaderSettled();
      if (!isLive && !pressSettled) setLoading(true);
      setProgress(16);
      updateWebAuthState(url);
      if (isPressReader && !pressSettled) {
        if (pressManualLoginOpenRef.current) {
          setLoading(false);
          setProgress(100);
          return;
        }
        const activeGate = pressGateRef.current && pressGateRef.current !== 'ready' ? pressGateRef.current : '';
        const nextGate = activeGate || (pressSubmittingRef.current ? 'signing-in' : (!pressAuthReadyRef.current ? 'preparing' : 'opening-publication'));
        updatePressGate(
          nextGate,
          nextGate === 'opening-publication' ? 'Loading PressReader'
            : nextGate === 'opening' ? 'Opening PressReader catalog'
              : nextGate === 'signing-in' ? 'Signing in to PressReader'
                : 'Preparing PressReader session'
        );
      }
    };
    const onStop = () => {
      const url = safeWebviewUrl(reader.url);
      if (isLive) api.log?.('[live] zoom-webview-stop-loading', title, url);
      setCurrentUrl(url);
      if (isPressReader && isPressReaderCatalogUrl(url)) {
        if (!pressManualLoginOpenRef.current) setPressNativeCatalogOpen(true);
      }
      updateWebAuthState(url);
      applyDark();
      logWebIslandDiagnostics('did-stop-loading', { url });
      setTimeout(applyDark, 400);
      setTimeout(applyDark, 1400);
      setTimeout(() => logWebIslandDiagnostics('did-stop-loading+650ms', { url }), 650);
      setTimeout(() => logWebIslandDiagnostics('did-stop-loading+1800ms', { url }), 1800);
      if (isLiveYouTube) {
        try { wv.executeJavaScript(YOUTUBE_PLAYER_DIAG_JS, true); } catch {}
        setTimeout(applyDark, 4000);
        setTimeout(applyDark, 10000);
      }
      if (isPressReader) {
        runPressReaderAutomation();
        if (!isPressReaderSettled()) {
          setTimeout(prefetchPressReaderPublication, 900);
          setTimeout(prefetchPressReaderPublication, 2400);
        }
      } else {
        setLoading(false);
      }
    };
    const onNavigate = () => {
      const url = safeWebviewUrl(reader.url);
      if (isLive) api.log?.('[live] zoom-webview-navigate', title, url);
      setCurrentUrl(url);
      if (isPressReader && isPressReaderCatalogUrl(url)) setPressNativeCatalogOpen(true);
      updateWebAuthState(url);
      applyDark();
      if (isPressReader && !isPressReaderSettled()) setTimeout(prefetchPressReaderPublication, 700);
      logWebIslandDiagnostics('did-navigate', { url });
    };
    const onConsole = (event) => {
      if (isLive && typeof event.message === 'string' && /^\[(wp-live-yt|wp-yt|live)\]/i.test(event.message)) {
        api.log?.('[live] zoom-webview-console', title, event.message);
      }
      if (!isPressReader || typeof event.message !== 'string') return;
      if (!event.message.startsWith('[wp-pressreader-user-click]')) return;
      if (isPressReaderSettled()) {
        setLoading(true);
        setProgress(24);
        updatePressGate('opening-publication', 'Opening PressReader publication');
        queuePressAutomation(220);
        return;
      }
      setLoading(true);
      setProgress(24);
      updatePressGate('opening-publication', 'Opening PressReader publication');
      queuePressAutomation(220);
      setTimeout(() => runPressReaderAutomation(), 900);
      setTimeout(() => runPressReaderAutomation(), 1800);
      setTimeout(() => runPressReaderAutomation(), 3200);
    };
    const onFail = event => {
      if (isLive) api.log?.('[live] zoom-webview-fail-load', title, event?.errorCode, event?.errorDescription, event?.validatedURL);
      logWebIslandDiagnostics('did-fail-load', {
        errorCode: event?.errorCode,
        errorDescription: event?.errorDescription,
        validatedURL: event?.validatedURL,
        isMainFrame: event?.isMainFrame,
      });
    };
    const onFinish = () => logWebIslandDiagnostics('did-finish-load');
    const onFrameFinish = event => logWebIslandDiagnostics('did-frame-finish-load', {
      isMainFrame: event?.isMainFrame,
      frameProcessId: event?.frameProcessId,
      frameRoutingId: event?.frameRoutingId,
    });
    const onGone = event => logWebIslandDiagnostics('render-process-gone', {
      reason: event?.reason,
      exitCode: event?.exitCode,
    });
    const onUnresponsive = () => logWebIslandDiagnostics('unresponsive');
    const onResponsive = () => logWebIslandDiagnostics('responsive');
    const onTitle = event => logWebIslandDiagnostics('page-title-updated', { title: event?.title });
    const onOpenInPlace = event => {
      const nextUrl = event?.url || event?.detail?.url || event?.details?.url;
      if (!/^https:\/\/([a-z0-9-]+\.)?tradingview\.com\//i.test(nextUrl || '')) return;
      try { event.preventDefault?.(); } catch {}
      try { event.window?.close?.(); } catch {}
      if (isTradingViewHeatmap && openHeatmapDrilldown(nextUrl)) return;
      try {
        wv.src = nextUrl;
        setCurrentUrl(nextUrl);
        setLoading(true);
      } catch {}
    };

    wv.addEventListener('dom-ready', onDomReady);
    wv.addEventListener('did-start-loading', onStart);
    wv.addEventListener('did-stop-loading', onStop);
    wv.addEventListener('did-fail-load', onFail);
    wv.addEventListener('did-finish-load', onFinish);
    wv.addEventListener('did-frame-finish-load', onFrameFinish);
    wv.addEventListener('did-navigate', onNavigate);
    wv.addEventListener('did-navigate-in-page', onNavigate);
    wv.addEventListener('console-message', onConsole);
    wv.addEventListener('render-process-gone', onGone);
    wv.addEventListener('unresponsive', onUnresponsive);
    wv.addEventListener('responsive', onResponsive);
    wv.addEventListener('page-title-updated', onTitle);
    wv.addEventListener('new-window', onOpenInPlace);
    wv.addEventListener('did-create-window', onOpenInPlace);
    logWebIslandDiagnostics('listeners-attached');
    return () => {
      const wasDomReady = webDiagDomReadyRef.current;
      webDiagDomReadyRef.current = false;
      logWebIslandDiagnostics('listeners-detached', { wasDomReady });
      wv.removeEventListener('dom-ready', onDomReady);
      wv.removeEventListener('did-start-loading', onStart);
      wv.removeEventListener('did-stop-loading', onStop);
      wv.removeEventListener('did-fail-load', onFail);
      wv.removeEventListener('did-finish-load', onFinish);
      wv.removeEventListener('did-frame-finish-load', onFrameFinish);
      wv.removeEventListener('did-navigate', onNavigate);
      wv.removeEventListener('did-navigate-in-page', onNavigate);
      wv.removeEventListener('console-message', onConsole);
      wv.removeEventListener('render-process-gone', onGone);
      wv.removeEventListener('unresponsive', onUnresponsive);
      wv.removeEventListener('responsive', onResponsive);
      wv.removeEventListener('page-title-updated', onTitle);
      wv.removeEventListener('new-window', onOpenInPlace);
      wv.removeEventListener('did-create-window', onOpenInPlace);
    };
  }, [reader.url, reader.authUrl, isOutlook, isPressReader, isTradingViewHeatmap, isLive, isLiveYouTube, liveHlsFailed, runPressReaderAutomation]);

  const pressReaderShielded = isPressReader && !pressManualLoginOpen && (loading || (pressGate && pressGate !== 'ready'));
  const pressShelfNormalizedQuery = pressShelfQuery.trim().toLowerCase();
  const pressShelfFilteredItems = !pressShelfNormalizedQuery
    ? pressShelfItems
    : pressShelfItems.filter(item => `${item.title || ''} ${item.categoryTitle || ''} ${item.issueDate || ''} ${item.url || ''}`.toLowerCase().includes(pressShelfNormalizedQuery));
  const pressShelfFeatured = pressShelfFilteredItems[0] || pressShelfItems[0] || null;
  const pressCatalogCategories = pressCatalogIndex.categories || [];
  const pressNativeCatalogVisible = isPressReader && !pressManualLoginOpen && !pressReaderShielded && (pressNativeCatalogOpen || isPressReaderCatalogUrl(currentUrl));
  const pressAutomationBlocked = isPressReader && Number(pressGuardrail.blockedUntil || 0) > Date.now();
  const pressAutomationBlockedMessage = pressAutomationBlocked ? pressReaderGuardrailMessage() : '';
  const pressCatalogGroups = pressShelfNormalizedQuery
    ? [{
        id: 'search',
        title: 'Search results',
        publications: pressShelfFilteredItems,
      }]
    : [
        ...pressApiGroups,
        ...pressCatalogCategories
          .filter(category => Object.prototype.hasOwnProperty.call(pressCategorySelection, category.id) ? pressCategorySelection[category.id] !== false : category.enabled !== false)
          .map(category => ({
            ...category,
            publications: (category.publications || []).filter(item => item?.image || item?.url || item?.title).slice(0, 28),
          }))
          .filter(category => category.publications.length),
      ];

  return (
    <div ref={stageRef} className="reader-stage browser-island-stage">
      <ReaderLaunchGhost active={launch.launching} style={launch.style} label={source} preview={ghostPreview} />
      <article
        ref={cardRef}
        className={`reader-card browser-island-card${selfLaunching ? ' reader-card-pending' : ' reader-card-settled'}`}
      >
        <div className="reader-card-glow" />
        <div className="reader-topbar">
          <div className="reader-source">
            <span className="reader-dot" />
            <span>{source}</span>
            <span className="reader-source-mode">{title}</span>
          </div>
          <div className="reader-actions">
            {isPressReader && (
              <>
                {pressManualLoginOpen ? (
                  <button className="reader-text-button" onClick={() => restorePressReaderNativeCatalogAfterLogin('manual-return')} title="Return to the native PressReader catalog">
                    Catalog UI
                  </button>
                ) : (
                  <>
                    <button className={`reader-text-button pressreader-shelf-toggle${pressNativeCatalogVisible ? ' is-active' : ''}`} onClick={showPressReaderNativeCatalog} title="Show native PressReader catalog">
                      Catalog {pressShelfItems.length ? pressShelfItems.length : ''}
                    </button>
                    <button className="reader-text-button" onClick={refreshPressReaderNativeCatalog} disabled={pressAutomationBlocked || pressShelfScanning || pressCrawlerActive} title={pressAutomationBlockedMessage || 'Refresh native PressReader index'}>
                      {pressAutomationBlocked ? 'Paused' : pressCrawlerActive ? 'Crawling' : pressShelfScanning ? 'Scanning' : 'Refresh'}
                    </button>
                    <button className="reader-text-button" onClick={inspectPressReaderApi} disabled={pressNetworkInspecting} title="Capture sanitized PressReader catalog API traffic">
                      {pressNetworkInspecting ? 'Inspecting' : 'Inspect API'}
                    </button>
                  </>
                )}
              </>
            )}
            {reader.authUrl && showWebSignIn && (
              <button className="reader-text-button" onClick={signInToWebSession} title={`Sign in to ${source}`}>Sign in</button>
            )}
            <button className="reader-icon-button" onClick={() => onOpenExternal(currentUrl || reader.url)} title="Open in default browser">↗</button>
            <button className="reader-icon-button" onClick={closeOrReturnFromBrowserCard} title={isTradingViewHeatmap && heatmapDrilldownOpen ? 'Return to heatmap' : 'Close'}>X</button>
          </div>
        </div>

        <div className="reader-progress-track" aria-hidden="true">
          <div className="reader-progress-fill" style={{ width: `${progress}%`, opacity: loading ? 1 : 0.45 }} />
        </div>

        <div className={`browser-island-frame${isLive ? ' browser-island-frame-live' : ''}${pressReaderShielded ? ' browser-island-frame-shielded' : ''}`}>
          {isLiveYouTube ? (
            <div className="browser-island-live-native">
              <LiveYouTubeEmbedTile
                feed={liveYouTubeFeed}
                muted={liveMuted}
                onReady={() => {
                  api.log?.('[live] zoom-youtube-embed-ready', reader.title || reader.url);
                  setLoading(false);
                  setProgress(100);
                }}
              />
            </div>
          ) : liveUsesNativeVideo ? (
            <div className="browser-island-live-native">
              <LiveHlsTile
                src={liveNativeHlsUrl}
                muted={liveMuted}
                objectFit="cover"
                label={`zoom:${reader.title || reader.url}`}
                onReady={() => {
                  window.clearTimeout(livePlaybackTimerRef.current);
                  api.log?.('[live] zoom-hls-playback-ready', reader.title || reader.url);
                  setLoading(false);
                  setProgress(100);
                }}
                onFatal={() => {
                  if (isLiveResolvable) {
                    api.log?.('[live] zoom-hls-playback-fatal', reader.title || reader.url);
                    setLiveHlsUrl('');
                    setLiveHlsFailed(true);
                  }
                }}
              />
            </div>
          ) : liveNativePending ? (
            <div className="browser-island-live-pending">
              <div className="browser-island-pulse" />
              <span>Resolving pure feed</span>
            </div>
          ) : (
            <webview
              className="browser-island-webview"
              ref={webviewRef}
              src={reader.url}
              partition={reader.partition === undefined ? 'persist:widget-browser' : reader.partition || undefined}
              httpreferrer={reader.referrer || undefined}
              useragent={reader.userAgent || undefined}
              allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
              allowpopups="true"
              webpreferences="contextIsolation=yes,nodeIntegration=no"
              style={isLive
                ? { width: '100%', height: 'auto', aspectRatio: '16 / 9', maxHeight: '100%', display: 'inline-flex', background: '#000' }
                : { position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'inline-flex', background: isPressReader ? '#111214' : '#050913', opacity: pressNativeCatalogVisible ? 0 : 1, pointerEvents: pressNativeCatalogVisible ? 'none' : 'auto' }}
            />
          )}
          {isPressReader && pressCrawlerUrl && (
            <webview
              ref={pressCrawlerRef}
              src={pressCrawlerUrl}
              partition="persist:pressreader"
              webpreferences="contextIsolation=yes,nodeIntegration=no"
              style={{ position: 'absolute', width: 1280, height: 900, left: -1400, top: 0, opacity: 0, pointerEvents: 'none' }}
            />
          )}
          {isPressReader && pressNewspapersSourceRequest?.url && (
            <webview
              ref={pressNewspapersSourceRef}
              src={pressNewspapersSourceRequest.url}
              partition="persist:pressreader"
              webpreferences="contextIsolation=yes,nodeIntegration=no"
              style={{ position: 'absolute', width: 1440, height: 1000, left: -1600, top: 0, opacity: 0, pointerEvents: 'none' }}
            />
          )}
          {isLive && (
            <button type="button" className="browser-island-mute" onClick={toggleLiveMute} title={liveMuted ? 'Enable sound' : 'Mute'}>
              {liveMuted ? <BrowserMutedIcon /> : <BrowserSoundIcon />}
            </button>
          )}
          {loading && !isLive && !pressReaderShielded && !isPressReader && (
            <div className="browser-island-loading">
              <div className="browser-island-pulse" />
              <span>Preparing dark web surface</span>
            </div>
          )}
          {pressReaderShielded && (
            <div className={`browser-island-loading pressreader-gate${pressGate === 'setup' ? ' is-setup' : ''}`}>
              {pressGate === 'setup' ? (
                <form className="pressreader-login-card" onSubmit={savePressReaderCredentials}>
                  <div className="pressreader-login-kicker">PressReader</div>
                  <div className="pressreader-login-title">Library sign-in</div>
                  <div className="pressreader-login-copy">{pressMessage || 'Save your login once. Future opens will sign in quietly.'}</div>
                  <label>
                    <span>No d'usager</span>
                    <input
                      value={pressForm.user}
                      onChange={event => setPressForm(form => ({ ...form, user: event.target.value }))}
                      autoComplete="username"
                    />
                  </label>
                  <label>
                    <span>Mot de passe</span>
                    <input
                      value={pressForm.pass}
                      onChange={event => setPressForm(form => ({ ...form, pass: event.target.value }))}
                      type="password"
                      autoComplete="current-password"
                    />
                  </label>
                  <div className="pressreader-login-actions">
                    {pressAuth && <button type="button" className="reader-text-button" onClick={forgetPressReaderCredentials}>Forget</button>}
                    <button type="button" className="reader-text-button" onClick={openPressReaderPageLogin}>Use page login</button>
                    <button type="submit" className="reader-text-button">Save and connect</button>
                  </div>
                </form>
              ) : (
                <>
                  <div className="browser-island-pulse" />
                  <span>{pressMessage || 'Preparing PressReader'}</span>
                  <button type="button" className="reader-text-button" onClick={openPressReaderPageLogin}>Use page login</button>
                </>
              )}
            </div>
          )}
          {pressNativeCatalogVisible && (
            <PressReaderCatalog
              catalogCategories={pressCatalogCategories}
              catalogGroups={pressCatalogGroups}
              featuredItem={pressShelfFeatured}
              status={pressAutomationBlockedMessage || pressShelfStatus || `${pressShelfItems.length} cover${pressShelfItems.length === 1 ? '' : 's'} ready`}
              query={pressShelfQuery}
              onQueryChange={setPressShelfQuery}
              onOpenItem={openPressShelfItem}
              onRefresh={refreshPressReaderNativeCatalog}
              onBootstrap={() => scanPressReaderShelf({ open: true, reason: 'native-catalog' })}
              onDailyRefresh={() => startPressReaderCategoryCrawl({ force: true })}
              onToggleCategory={togglePressReaderCategory}
              onCategoryOpen={loadPressReaderCategoryFromApi}
              categorySelection={pressCategorySelection}
              categoryLoadingId={pressApiLoadingCategoryId}
              automationBlocked={pressAutomationBlocked}
              scanning={pressShelfScanning}
              crawling={pressCrawlerActive}
              onClose={onClose}
            />
          )}
        </div>
      </article>
    </div>
  );
}

function BrowserMutedIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zM4.27 3 3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4 9.91 6.09 12 8.18V4z" />
    </svg>
  );
}

function BrowserSoundIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
    </svg>
  );
}

function CategoryManager({ categories, activeIds, setActiveIds, onClose, onReset }) {
  return (
    <div onClick={onClose} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.72)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:100}}>
      <div onClick={e=>e.stopPropagation()} style={{background:"#18181c",border:"1px solid rgba(255,255,255,0.08)",borderRadius:16,padding:20,width:560,maxHeight:"82vh",display:"flex",flexDirection:"column"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16,flexShrink:0}}>
          <span style={{fontSize:14,fontWeight:500,color:"#e0e0e0"}}>Manage widgets</span>
          <button onClick={onClose} style={{background:"none",border:"none",color:"#d0d0e0",fontSize:13,cursor:"pointer",padding:4}}>✕</button>
        </div>
        <div style={{display:"flex",gap:20,overflow:"hidden",flex:1}}>
          {/* System column */}
          <div style={{flex:"0 0 220px",display:"flex",flexDirection:"column",overflow:"hidden"}}>
            <div style={{fontSize:10,color:"#2a2a34",textTransform:"uppercase",letterSpacing:1,marginBottom:8,flexShrink:0}}>System</div>
            <div style={{overflowY:"auto",flex:1}}>
              {SYS.map(w=>{
                const on=activeIds.includes(w.id);
                return(
                  <div key={w.id} style={{display:"flex",alignItems:"center",gap:10,padding:"9px 0",borderBottom:"1px solid rgba(255,255,255,0.04)"}}>
                    <span style={{...C.dot,background:w.color}}/>
                    <div style={{flex:1}}>
                      <div style={{fontSize:13,color:"#e4e4f4"}}>{w.label}</div>
                      <div style={{fontSize:10,color:"#c4c4d4"}}>{w.note}</div>
                    </div>
                    <button onClick={()=>setActiveIds(p=>on?p.filter(x=>x!==w.id):[...p,w.id])}
                      style={{border:"1px solid",borderRadius:6,fontSize:11,padding:"3px 10px",cursor:"pointer",fontWeight:500,fontFamily:"'DM Sans',sans-serif",background:on?w.color+"22":"rgba(255,255,255,0.05)",color:on?w.color:"#d0d0e0",borderColor:on?w.color+"44":"rgba(255,255,255,0.08)"}}>
                      {on?"Pinned":"Add"}
                    </button>
                  </div>
                );
              })}
              <button onClick={onReset} style={{marginTop:16,background:"none",border:"none",fontSize:11,color:"#282830",cursor:"pointer",padding:0,display:"block"}}>↺ Load a different OPML file</button>
            </div>
          </div>
          {/* Divider */}
          <div style={{width:1,background:"rgba(255,255,255,0.06)",flexShrink:0}}/>
          {/* News column */}
          <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
            <div style={{fontSize:10,color:"#2a2a34",textTransform:"uppercase",letterSpacing:1,marginBottom:8,flexShrink:0}}>News categories</div>
            <div style={{overflowY:"auto",flex:1}}>
              {categories.map((cat,i)=>{
                const id="cat:"+cat.label,on=activeIds.includes(id),col=getNewsCategoryColor(cat.label,i);
                return(
                  <div key={cat.label} style={{display:"flex",alignItems:"center",gap:10,padding:"9px 0",borderBottom:"1px solid rgba(255,255,255,0.04)"}}>
                    <span style={{...C.dot,background:col}}/>
                    <div style={{flex:1}}>
                      <div style={{fontSize:13,color:"#e4e4f4"}}>{cat.label}</div>
                      <div style={{fontSize:10,color:"#c4c4d4"}}>{cat.feeds.length} feed{cat.feeds.length!==1?"s":""}</div>
                    </div>
                    <button onClick={()=>setActiveIds(p=>on?p.filter(x=>x!==id):[...p,id])}
                      style={{border:"1px solid",borderRadius:6,fontSize:11,padding:"3px 10px",cursor:"pointer",fontWeight:500,fontFamily:"'DM Sans',sans-serif",background:on?col+"22":"rgba(255,255,255,0.05)",color:on?col:"#444",borderColor:on?col+"44":"rgba(255,255,255,0.08)"}}>
                      {on?"Pinned":"Add"}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Settings modal ────────────────────────────────────────────────────────────
function SettingsSlider({ label, value, min, max, step=0.01, onChange }) {
  return (
    <div style={{padding:"10px 0",borderBottom:"1px solid rgba(255,255,255,0.05)"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
        <div style={{fontSize:13,color:"#e4e4f4"}}>{label}</div>
        <div style={{fontSize:11,color:"#d0d0e0",fontFamily:"DM Mono,monospace"}}>{Math.round(value*100)}%</div>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e=>onChange(parseFloat(e.target.value))}
        style={{width:"100%",accentColor:"var(--accent)",cursor:"pointer"}}/>
    </div>
  );
}

function SettingsModal({ onClose, opacity, onOpacityChange, cardOpacity, onCardOpacityChange, pinnedOpacity, onPinnedOpacityChange, location, onLocationChange, apiKeys, onApiKeyChange, newsCarouselEnabled, onNewsCarouselEnabledChange, newsCarouselIntervalMs, onNewsCarouselIntervalMsChange }) {
  const [autostart, setAutostart] = useState(false);
  const [locDraft, setLocDraft] = useState('');
  const [tomtomDraft, setTomtomDraft] = useState(apiKeys?.traffic || '');
  const [locSearching, setLocSearching] = useState(false);
  const [locResult, setLocResult] = useState(null);
  const [locError, setLocError] = useState('');
  const [pressSettingsIndex, setPressSettingsIndex] = useState(emptyPressReaderCatalogIndex());
  const [pressSettingsSelection, setPressSettingsSelection] = useState({});

  useEffect(()=>{ api.autostart?.get().then(v=>setAutostart(!!v)); },[]);
  useEffect(() => {
    Promise.all([
      api.store.get(SK_PRESSREADER_CATALOG_INDEX),
      api.store.get(SK_PRESSREADER_CATEGORY_SELECTION),
    ]).then(([rawIndex, rawSelection]) => {
      setPressSettingsIndex(parsePressReaderCatalogIndex(rawIndex));
      setPressSettingsSelection(parsePressReaderCategorySelection(rawSelection));
    }).catch(() => {});
  }, []);

  function toggleAutostart() {
    const next=!autostart; setAutostart(next);
    api.autostart?.set(next); api.store.set(SK_AUTOSTART, next ? '1' : '');
  }

  async function searchLocation() {
    if (!locDraft.trim()) return;
    setLocSearching(true); setLocError(''); setLocResult(null);
    try {
      const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(locDraft.trim())}&count=1&language=en&format=json`);
      const d = await r.json();
      if (d.results?.length) {
        const res = d.results[0];
        setLocResult({ name:`${res.name}, ${res.admin1||res.country}`, lat:res.latitude, lon:res.longitude, timezone:res.timezone });
      } else { setLocError('Location not found'); }
    } catch { setLocError('Search failed'); }
    setLocSearching(false);
  }

  function togglePressSettingCategory(categoryId, enabled) {
    const next = { ...pressSettingsSelection, [categoryId]: !!enabled };
    setPressSettingsSelection(next);
    api.store.set(SK_PRESSREADER_CATEGORY_SELECTION, JSON.stringify(next));
  }

  return (
    <div onClick={onClose} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.72)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:100}}>
      <div onClick={e=>e.stopPropagation()} style={{background:"#18181c",border:"1px solid rgba(255,255,255,0.08)",borderRadius:16,padding:20,width:280,maxHeight:"90vh",overflowY:"auto"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
          <span style={{fontSize:14,fontWeight:500,color:"#e0e0e0"}}>Settings</span>
          <button onClick={onClose} style={{background:"none",border:"none",color:"#d0d0e0",fontSize:13,cursor:"pointer",padding:4}}>✕</button>
        </div>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 0",borderBottom:"1px solid rgba(255,255,255,0.05)"}}>
          <div>
            <div style={{fontSize:13,color:"#e4e4f4"}}>Start with Windows</div>
            <div style={{fontSize:10,color:"#c4c4d4",marginTop:2}}>Launch panel on login</div>
          </div>
          <button onClick={toggleAutostart} style={{
            width:36,height:20,borderRadius:10,border:"none",cursor:"pointer",transition:"background 0.2s",position:"relative",
            background:autostart?"var(--accent)":"rgba(255,255,255,0.1)"
          }}>
            <span style={{position:"absolute",top:2,left:autostart?18:2,width:16,height:16,borderRadius:"50%",background:"#fff",transition:"left 0.2s",display:"block"}}/>
          </button>
        </div>
        <SettingsSlider label="Background opacity" min="0" max="1" value={opacity} onChange={onOpacityChange}/>
        <SettingsSlider label="Card opacity" min="0" max="1" value={cardOpacity} onChange={onCardOpacityChange}/>
        <SettingsSlider label="Pinned opacity" min="0" max="1" value={pinnedOpacity} onChange={onPinnedOpacityChange}/>
        <div style={{padding:"12px 0",borderBottom:"1px solid rgba(255,255,255,0.05)"}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:12}}>
            <div>
              <div style={{fontSize:13,color:"#e4e4f4"}}>News carousel</div>
              <div style={{fontSize:10,color:"#c4c4d4",marginTop:2}}>Use rotating hero cards</div>
            </div>
            <button onClick={()=>onNewsCarouselEnabledChange(!newsCarouselEnabled)} style={{
              width:36,height:20,borderRadius:10,border:"none",cursor:"pointer",transition:"background 0.2s",position:"relative",flexShrink:0,
              background:newsCarouselEnabled?"var(--accent)":"rgba(255,255,255,0.1)"
            }}>
              <span style={{position:"absolute",top:2,left:newsCarouselEnabled?18:2,width:16,height:16,borderRadius:"50%",background:"#fff",transition:"left 0.2s",display:"block"}}/>
            </button>
          </div>
          <div style={{marginTop:10,opacity:newsCarouselEnabled?1:0.42,pointerEvents:newsCarouselEnabled?'auto':'none'}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
              <div style={{fontSize:12,color:"#e4e4f4"}}>Rotation speed</div>
              <div style={{fontSize:11,color:"#d0d0e0",fontFamily:"DM Mono,monospace"}}>{Math.round(newsCarouselIntervalMs / 1000)}s</div>
            </div>
            <input type="range" min="20" max="60" step="1" value={Math.round(newsCarouselIntervalMs / 1000)}
              onChange={e=>onNewsCarouselIntervalMsChange(parseInt(e.target.value, 10) * 1000)}
              style={{width:"100%",accentColor:"var(--accent)",cursor:"pointer"}}/>
          </div>
        </div>
        <div style={{padding:"12px 0",borderBottom:"1px solid rgba(255,255,255,0.05)"}}>
          <div style={{fontSize:13,color:"#e4e4f4",marginBottom:2}}>Location</div>
          <div style={{fontSize:10,color:"#c4c4d4",marginBottom:8}}>Weather &amp; traffic</div>
          <div style={{fontSize:11,color:"#888",marginBottom:8,fontFamily:"DM Mono,monospace",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{location.name}</div>
          <div style={{display:"flex",gap:6}}>
            <input value={locDraft} onChange={e=>setLocDraft(e.target.value)}
              onKeyDown={e=>{ if(e.key==='Enter') searchLocation(); }}
              placeholder="Search city…"
              style={{...C.inp,flex:1,fontSize:11}}/>
            <button onClick={searchLocation} disabled={locSearching} style={C.btn}>{locSearching?'…':'↵'}</button>
          </div>
          {locError&&<div style={{fontSize:10,color:"#f77f4f",marginTop:6}}>{locError}</div>}
          {locResult&&(
            <div style={{marginTop:8,padding:"8px 10px",background:"rgba(255,255,255,0.04)",borderRadius:8,display:"flex",alignItems:"center",justifyContent:"space-between",gap:8}}>
              <span style={{fontSize:11,color:"#e4e4f4",flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{locResult.name}</span>
              <button onClick={()=>{ onLocationChange(locResult); setLocResult(null); setLocDraft(''); }} style={{...C.btn,padding:"2px 10px",fontSize:11,flexShrink:0}}>Use</button>
            </div>
          )}
        </div>
        <div style={{padding:"12px 0",borderBottom:"1px solid rgba(255,255,255,0.05)"}}>
          <div style={{fontSize:13,color:"#e4e4f4",marginBottom:2}}>Traffic API key</div>
          <div style={{fontSize:10,color:"#c4c4d4",marginBottom:8}}>TomTom · free tier at developer.tomtom.com</div>
          <div style={{display:"flex",gap:6}}>
            <input value={tomtomDraft} onChange={e=>setTomtomDraft(e.target.value)}
              placeholder="Paste TomTom key…"
              style={{...C.inp,flex:1,fontSize:11,fontFamily:'DM Mono,monospace'}}/>
            <button onClick={()=>onApiKeyChange('traffic', tomtomDraft.trim())} style={C.btn}>Save</button>
          </div>
        </div>
        <div style={{padding:"12px 0",borderBottom:"1px solid rgba(255,255,255,0.05)"}}>
          <div style={{fontSize:13,color:"#e4e4f4",marginBottom:2}}>PressReader categories</div>
          <div style={{fontSize:10,color:"#c4c4d4",marginBottom:8}}>Daily native shelf index</div>
          {pressSettingsIndex.categories.length ? (
            <div style={{display:"grid",gap:6,maxHeight:180,overflowY:"auto",paddingRight:2}}>
              {pressSettingsIndex.categories.map(category => {
                const checked = Object.prototype.hasOwnProperty.call(pressSettingsSelection, category.id)
                  ? pressSettingsSelection[category.id] !== false
                  : category.enabled !== false;
                return (
                  <label key={category.id} style={{display:"flex",alignItems:"center",gap:7,fontSize:11,color:"#e4e4f4"}}>
                    <input type="checkbox" checked={checked} onChange={event => togglePressSettingCategory(category.id, event.target.checked)} style={{accentColor:"var(--accent)"}} />
                    <span style={{flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{category.title}</span>
                    <span style={{fontSize:9,color:"#8a8a96",fontFamily:"DM Mono,monospace"}}>{category.publications?.length || 0}</span>
                  </label>
                );
              })}
            </div>
          ) : (
            <div style={{fontSize:10,color:"#8a8a96",lineHeight:1.4}}>Open PressReader and scan the catalog once to discover categories.</div>
          )}
        </div>
        <div style={{fontSize:10,color:"#282830",marginTop:16,lineHeight:1.5}}>
          Panel position: left edge · Win+W to toggle
        </div>
      </div>
    </div>
  );
}

// ── Taskbar notification rotator ──────────────────────────────────────────────
function useNotificationRotator(snippets, totalUnread) {
  const [idx, setIdx] = useState(0);
  const [visible, setVisible] = useState(false);

  useEffect(()=>{
    if (!snippets.length) { setVisible(false); return; }
    setVisible(true);
    const t = setInterval(()=>setIdx(i=>(i+1)%snippets.length), 8000);
    return ()=>clearInterval(t);
  },[snippets.length]);

  useEffect(()=>{ api.badge?.set(totalUnread); },[totalUnread]);

  return { snippet: snippets[idx] || null, visible };
}

// ── Main ─────────────────────────────────────────────────────────────────────
export default function App() {
  const [categories,   setCategories]   = useState(null);
  const [activeIds,    setActiveIds]    = useState([]);
  const [columns,      setColumns]      = useState({});
  const [apiKeys,      setApiKeys]      = useState({});
  const [showMgr,      setShowMgr]      = useState(false);
  const [refreshKey,   setRefreshKey]   = useState(0);
  const [showSettings, setShowSettings] = useState(false);
  const [storageReady, setStorageReady] = useState(false);
  const [pinned,       setPinned]       = useState(false);
  const [time,         setTime]         = useState(new Date());
  const [visible,      setVisible]      = useState(!window.electronAPI);
  const [opacity,       setOpacity]       = useState(0.55);
  const [cardOpacity,   setCardOpacity]   = useState(1);
  const [pinnedOpacity, setPinnedOpacity] = useState(0.25);
  const [newsCarouselEnabled, setNewsCarouselEnabled] = useState(false);
  const [newsCarouselIntervalMs, setNewsCarouselIntervalMs] = useState(20000);
  const [location,      setLocation]      = useState(DEFAULT_LOC);
  const [tvSymbols,     setTvSymbols]     = useState(null);
  const [accentColor,    setAccentColor]    = useState('#202020');
  const [systemWindowColor, setSystemWindowColor] = useState('#1f1f1f');
  const [browserPane,  setBrowserPane]  = useState({ open: false, url: '', loading: false, braveX: 0 });
  const [reader, setReader] = useState({ open: false, mode: 'article', status: 'idle', url: '', seed: null, article: null, error: '', launchRect: null });
  const [readerTransition, setReaderTransition] = useState(null);
  const [panelMode, setPanelMode] = useState('base');
  const [baseColumnCount, setBaseColumnCount] = useState(DEFAULT_BASE_COLUMN_COUNT);
  const [modeSwitching, setModeSwitching] = useState(false);
  const workstationMode = panelMode === 'monitor';

  // Column widths: fixed lanes plus a flexible right column.
  const [colWidths, setColWidths] = useState(DEFAULT_COL_WIDTHS);
  const colWidthsRef = useRef(DEFAULT_COL_WIDTHS);
  const panelBgRef = useRef(null);
  const storageReadyRef = useRef(false);
  const pendingShowRef  = useRef(false);
  const readerRequestRef = useRef(0);
  const readerTransitionRef = useRef(null);
  const modeSwitchSeqRef = useRef(0);
  const workstationBackupRef = useRef(null);
  const workstationAnimationTimerRef = useRef(0);
  const workstationExpandTimerRef = useRef(0);
  useEffect(() => { colWidthsRef.current = colWidths; }, [colWidths]);
  useEffect(() => {
    api.reader?.setZoomActive?.(reader.open || !!readerTransition);
    return () => api.reader?.setZoomActive?.(false);
  }, [reader.open, readerTransition]);

  // Expand/collapse state per widget id — persisted
  const [expandedMap, setExpandedMap] = useState({});

  function getExpanded(id)   { return expandedMap[id] !== false; }
  function toggleExpanded(id) {
    const fromExpanded = expandedMap[id] !== false;
    const toExpanded = !fromExpanded;
    logExpandDiagnosticSnapshot({ id, phase: 'before-toggle', fromExpanded, toExpanded, categories, panelBgRef });
    EXPAND_DIAG_DELAYS.forEach(delay => {
      window.setTimeout(() => {
        logExpandDiagnosticSnapshot({
          id,
          phase: `after-toggle-${delay}ms`,
          fromExpanded,
          toExpanded,
          categories,
          panelBgRef,
        });
      }, delay);
    });
    window.requestAnimationFrame(() => {
      logExpandDiagnosticSnapshot({ id, phase: 'after-toggle-raf1', fromExpanded, toExpanded, categories, panelBgRef });
      window.requestAnimationFrame(() => {
        logExpandDiagnosticSnapshot({ id, phase: 'after-toggle-raf2', fromExpanded, toExpanded, categories, panelBgRef });
      });
    });
    setExpandedMap(p => {
      const wasExpanded = p[id] !== false;
      if (wasExpanded) playCardCollapseSound();
      else playCardExpandSound();
      return { ...p, [id]: !wasExpanded };
    });
  }

  // Column divider drag — purely in-renderer
  function onColDividerDown(which) {
    return (e) => {
      e.preventDefault();
      const startX = e.clientX;
      const startW = colWidthsRef.current[which];
      const onMove = (ev) => {
        const newW = Math.max(150, Math.min(startW + (ev.clientX - startX), 500));
        setColWidths(p => ({ ...p, [which]: newW }));
      };
      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        api.store.set(SK_COLW, JSON.stringify(colWidthsRef.current));
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    };
  }

  function getReaderLaunchRect(event) {
    const rect = event?.currentTarget?.getBoundingClientRect?.();
    if (Number.isFinite(event?.clientX) && Number.isFinite(event?.clientY)) {
      return {
        kind: 'point',
        left: event.clientX - 0.5,
        top: event.clientY - 0.5,
        width: 1,
        height: 1,
      };
    }
    if (!rect) return null;
    return {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    };
  }

  function launchReader(nextReader, launchRect) {
    const cleanReader = { ...nextReader, launchRect: null };
    if (reader.open && launchRect) {
      const key = `${Date.now()}-${readerRequestRef.current}`;
      const transition = {
        key,
        launchRect,
        preview: readerPreview(nextReader),
        nextReader: cleanReader,
      };
      readerTransitionRef.current = transition;
      setReaderTransition(transition);
      return key;
    }
    readerTransitionRef.current = null;
    setReaderTransition(null);
    setReader({ ...nextReader, launchRect });
    return '';
  }

  function updateLaunchedReader(key, nextReader, fallbackLaunchRect = null) {
    const cleanReader = { ...nextReader, launchRect: null };
    const active = key && readerTransitionRef.current?.key === key;
    if (active) {
      const transition = {
        ...readerTransitionRef.current,
        preview: readerPreview(nextReader),
        nextReader: cleanReader,
      };
      readerTransitionRef.current = transition;
      setReaderTransition(transition);
      return;
    }
    setReader({ ...nextReader, launchRect: fallbackLaunchRect });
  }

  const completeReaderTransition = useCallback((key) => {
    const transition = readerTransitionRef.current;
    if (!transition || transition.key !== key) return;
    readerTransitionRef.current = null;
    setReaderTransition(null);
    setReader(transition.nextReader);
  }, []);

  function openBrowser(target, event) {
    const seed = typeof target === 'string' ? null : target;
    const url = typeof target === 'string' ? target : target?.link;
    if (!url) return;
    const requestId = readerRequestRef.current + 1;
    const launchRect = getReaderLaunchRect(event);
    readerRequestRef.current = requestId;
    const transitionKey = launchReader({ open: true, mode: 'article', status: 'loading', url, seed, article: null, error: '' }, launchRect);
    const timeout = window.setTimeout(() => {
      if (readerRequestRef.current !== requestId) return;
      readerRequestRef.current += 1;
      updateLaunchedReader(transitionKey, {
        open: true,
        mode: 'article',
        status: 'error',
        url,
        seed,
        article: {
          ok: false,
          title: seed?.title || 'Reader view unavailable',
          source: seed?.source || '',
          sourceLabel: 'direct',
          paragraphs: [],
          images: seed?.image ? [seed.image] : [],
          image: seed?.image || '',
          attempts: [{ source: 'fast deadline', error: `${READER_CLIENT_TIMEOUT_MS}ms exceeded` }],
        },
        error: 'Reader extraction stopped after 5 seconds. Open the original article or try archive.org.',
      }, transitionKey ? null : launchRect);
    }, READER_CLIENT_TIMEOUT_MS);
    api.reader?.fetch?.(url, seed).then(article => {
      if (readerRequestRef.current !== requestId) return;
      window.clearTimeout(timeout);
      if (article?.ok) updateLaunchedReader(transitionKey, { open: true, mode: 'article', status: 'ready', url, seed, article, error: '' }, transitionKey ? null : launchRect);
      else updateLaunchedReader(transitionKey, { open: true, mode: 'article', status: 'error', url, seed, article, error: article?.error || 'Reader extraction failed.' }, transitionKey ? null : launchRect);
    }).catch(error => {
      if (readerRequestRef.current !== requestId) return;
      window.clearTimeout(timeout);
      updateLaunchedReader(transitionKey, { open: true, mode: 'article', status: 'error', url, seed, article: null, error: error?.message || 'Reader extraction failed.' }, transitionKey ? null : launchRect);
    });
  }

  function openReaderArchive(url, seed = null) {
    if (!url) return;
    const requestId = readerRequestRef.current + 1;
    readerRequestRef.current = requestId;
    const archiveSeed = {
      ...(seed || reader.seed || {}),
      title: seed?.title || reader.seed?.title || 'Checking archive.org',
      source: seed?.source || reader.seed?.source || 'archive.org',
    };
    setReader(previous => ({
      ...previous,
      open: true,
      mode: 'article',
      status: 'loading',
      url,
      seed: archiveSeed,
      article: null,
      error: '',
      launchRect: null,
    }));
    const archiveRequest = api.reader?.fetchArchive
      ? api.reader.fetchArchive(url)
      : Promise.resolve({ ok: false, error: 'Restart widget-panel to enable archive.org lookup.' });
    archiveRequest.then(article => {
      if (readerRequestRef.current !== requestId) return;
      if (article?.ok) {
        setReader({ open: true, mode: 'article', status: 'ready', url, seed: archiveSeed, article, error: '', launchRect: null });
      } else {
        setReader({
          open: true,
          mode: 'article',
          status: 'error',
          url,
          seed: archiveSeed,
          article,
          error: article?.error || 'Archive.org lookup failed.',
          launchRect: null,
        });
      }
    }).catch(error => {
      if (readerRequestRef.current !== requestId) return;
      setReader({
        open: true,
        mode: 'article',
        status: 'error',
        url,
        seed: archiveSeed,
        article: null,
        error: error?.message || 'Archive.org lookup failed.',
        launchRect: null,
      });
    });
  }

  function openWebCard(options = {}, event) {
    const {
      url,
      title = 'Web content',
      source = 'Browser mode',
      partition = 'persist:widget-browser',
      authUrl = '',
      flavor = '',
      referrer = '',
      userAgent = '',
      ...extra
    } = options || {};
    if (!url) return;

    const requestId = readerRequestRef.current + 1;
    readerRequestRef.current = requestId;
    const launchRect = getReaderLaunchRect(event);
    launchReader({
      open: true,
      mode: 'web',
      status: 'ready',
      url,
      title,
      source,
      partition,
      authUrl,
      flavor,
      referrer,
      userAgent,
      ...extra,
      seed: null,
      article: null,
      error: '',
    }, launchRect);
  }

  useEffect(() => {
    const offAuthUrl = api.msGraph?.onAuthUrl?.((payload = {}) => {
      if (!payload.url) return;
      openWebCard({
        url: payload.url,
        title: payload.title || 'Microsoft sign-in',
        source: payload.source || 'Microsoft',
        partition: 'persist:widget-browser',
        flavor: 'outlook',
      });
    });
    const offAuthComplete = api.msGraph?.onAuthComplete?.((payload = {}) => {
      if (!payload.ok) return;
      readerRequestRef.current += 1;
      readerTransitionRef.current = null;
      setReaderTransition(null);
      setReader(previous => (
        previous.open && previous.mode === 'web' && previous.source === 'Microsoft'
          ? { open: false, mode: 'article', status: 'idle', url: '', seed: null, article: null, error: '', launchRect: null }
          : previous
      ));
    });
    return () => {
      offAuthUrl?.();
      offAuthComplete?.();
    };
  }, [openWebCard]);

  function closeReader() {
    readerRequestRef.current += 1;
    readerTransitionRef.current = null;
    setReaderTransition(null);
    setReader({ open: false, mode: 'article', status: 'idle', url: '', seed: null, article: null, error: '', launchRect: null });
  }

  function openReaderExternal(url) {
    if (url) api.reader?.openExternal?.(url);
  }

  const [unreadMap, setUnreadMap] = useState({});
  const totalUnread = Object.values(unreadMap).reduce((a,b)=>a+b, 0);
  const [snippets, setSnippets] = useState([]);

  // Drag-and-drop reorder state
  const [dragId,     setDragId]     = useState(null);
  const [dropTarget, setDropTarget] = useState(null); // { col, beforeId } | null

  function handleDrop(fromId, targetCol, beforeId) {
    setColumns(p => ({ ...p, [fromId]: targetCol }));
    setActiveIds(prev => {
      const arr = prev.filter(x => x !== fromId);
      if (beforeId !== null) {
        const ti = arr.indexOf(beforeId);
        if (ti !== -1) { arr.splice(ti, 0, fromId); return arr; }
      }
      arr.push(fromId);
      return arr;
    });
  }

  useEffect(()=>{ const t=setInterval(()=>setTime(new Date()),1000); return ()=>clearInterval(t); },[]);

  // ── Slide animation ──────────────────────────────────────────────────────
  useEffect(() => {
    const panelApi = window.electronAPI?.panel;
    if (!panelApi) return;
    panelApi.onShow(() => {
      playPanelInSound();
      if (storageReadyRef.current) setVisible(true);
      else pendingShowRef.current = true;
    });
    panelApi.onHide(() => {
      playPanelOutSound();
      setVisible(false);
      setShowSettings(false);
      setShowMgr(false);
      closeReader();
      api.modal?.close();
      setTimeout(() => panelApi.hideDone(), PANEL_SLIDE_MS + 40);
    });
    panelApi.ready();
  }, []);

  // ── Browser pane (embedded Brave) ────────────────────────────────────────
  useEffect(() => {
    const bApi = window.electronAPI?.browser;
    if (!bApi) return;
    bApi.onPaneShow(({ url, braveX }) => setBrowserPane({ open: true, url, loading: false, braveX }));
    bApi.onPaneHide(() => {
      setBrowserPane(p => ({ ...p, open: false }));
      bApi.setIgnoreMouseEvents(false);
    });
    bApi.onLoading(v => setBrowserPane(p => ({ ...p, loading: v })));
    bApi.onUrl(u => setBrowserPane(p => ({ ...p, url: u })));
  }, []);

  // ── Resize drag handle (panel width) ────────────────────────────────────
  const onResizeMouseDown = useCallback((e) => {
    e.preventDefault();
    window.electronAPI?.panel?.resizeStart(e.screenX, window.innerWidth);
    const onUp = () => {
      window.electronAPI?.panel?.resizeEnd();
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mouseup', onUp);
  }, []);

  // ── Default column assignment ────────────────────────────────────────────
  function getColFor(id) {
    return getColumnForWidget(id, columns);
  }

  // ── Load persisted config ────────────────────────────────────────────────
  useEffect(()=>{
    // Load visual settings first so panel renders at correct opacity/card-opacity immediately
    Promise.all([
      storageLoad(),
      api.store.get(SK_OPACITY),
      api.store.get(SK_CARD_OPACITY),
      api.store.get(SK_PINNED_OPACITY),
      api.store.get(SK_LOCATION),
      api.store.get(SK_NEWS_CAROUSEL),
      api.store.get(SK_NEWS_CAROUSEL_MS),
    ]).then(([saved, opv, cardv, pinnedv, locv, newsCarouselV, newsCarouselMsV]) => {
      if (saved?.categories?.length) {
        setCategories(saved.categories);
        // Strip orphan IDs (e.g. 'pressreader' left over from earlier sessions
        // when it was a widget). KNOWN_SYS in the column-split logic also
        // filters these out at render time, but persisting them clean here
        // means they stop being written back to wp-config.
        const knownCats = new Set((saved.categories||[]).map(c => 'cat:' + c.label));
        const cleaned = (saved.activeIds||[]).filter(id => SYSTEM_WIDGET_ID_SET.has(id) || knownCats.has(id));
        const seeded = cleaned.includes('starvis') ? cleaned : [...cleaned, 'starvis'];
        setActiveIds(seeded);
        const cols = saved.columns || {};
        const stale = cols.weather==="right" || cols.stocks==="right" || cols.traffic==="right";
        const hasMid = Object.values(cols).some(v => v === "mid");
        let finalCols;
        if (stale) {
          finalCols = defaultColumns(saved.categories);
        } else if (!hasMid && Object.keys(cols).length > 0) {
          finalCols = {};
          for (const [id, c] of Object.entries(cols)) {
            finalCols[id] = (c === "right" && id.startsWith("cat:")) ? "mid" : c;
          }
        } else {
          finalCols = cols;
        }
        // Migrate: cat:* widgets in "mid" from pre-feed-column saves → "feed"
        const hasFeed = Object.values(finalCols).some(v => v === "feed");
        if (!hasFeed) {
          for (const id of Object.keys(finalCols)) {
            if (id.startsWith("cat:") && finalCols[id] === "mid") finalCols[id] = "feed";
          }
        }
        // Migrate workstation cards into the new telemetry lane once. After
        // that, manual drag/drop placement is preserved by the saved columns.
        const hasMonitor = Object.values(finalCols).some(v => v === "monitor");
        if (!hasMonitor) {
          for (const id of WORKSTATION_WIDGET_ID_SET) {
            finalCols[id] = "monitor";
          }
        }
        finalCols.starvis = finalCols.starvis || 'right';
        setColumns(finalCols);
        setApiKeys(saved.apiKeys||{});
      }
      if (opv) setOpacity(parseFloat(opv));
      const cardVal = cardv ? parseFloat(cardv) : 1;
      setCardOpacity(cardVal);
      document.documentElement.style.setProperty('--card-bg', `rgba(38,40,50,${cardVal})`);
      if (pinnedv) setPinnedOpacity(parseFloat(pinnedv));
      setNewsCarouselEnabled(newsCarouselV === '1');
      if (newsCarouselMsV) {
        const parsed = parseInt(newsCarouselMsV, 10);
        if (Number.isFinite(parsed)) setNewsCarouselIntervalMs(Math.max(20000, Math.min(60000, parsed)));
      }
      if (locv) { try { setLocation(JSON.parse(locv)); } catch {} }
      api.store.get(SK_TV_SYMBOLS).then(v => {
        let syms = DEFAULT_TV_SYMBOLS;
        if (v) { try { syms = JSON.parse(v); } catch {} }
        setTvSymbols(syms);
      });
      setStorageReady(true);
    });

    api.pin?.get().then(p=>setPinned(!!p));
    api.pin?.onChange(p=>setPinned(!!p));
    api.store.get(SK_COLW).then(v=>{
      if (v) try {
        const p = JSON.parse(v);
        const merged = { ...DEFAULT_COL_WIDTHS, ...p };
        setColWidths(merged);
        colWidthsRef.current = merged;
      } catch {}
    });
    api.store.get(SK_BASE_COLUMNS).then(v => {
      const parsed = parseInt(v || '', 10);
      if (Number.isFinite(parsed)) {
        setBaseColumnCount(Math.max(3, Math.min(DEFAULT_BASE_COLUMN_COUNT, parsed)));
      }
    });
    api.store.get(SK_EXPANDED).then(v=>{
      if (v) try { setExpandedMap(JSON.parse(v)); } catch {}
    });
    window.electronAPI?.system?.accentColor().then(c=>{ if (c) setAccentColor(c); });
    window.electronAPI?.system?.windowColor().then(c=>{ if (c) setSystemWindowColor(c); });
    window.electronAPI?.system?.onWindowColorChange?.(c=>{ if (c) setSystemWindowColor(c); });
  },[]);

  // Flush pending panel-show once storage is ready (cold-start race fix)
  useEffect(() => {
    storageReadyRef.current = storageReady;
    if (storageReady && pendingShowRef.current) {
      pendingShowRef.current = false;
      setVisible(true);
    }
  }, [storageReady]);

  // Persist main config on change
  useEffect(()=>{
    if (!storageReady || !categories || workstationMode) return;
    storageSave({ categories, activeIds, columns, apiKeys });
  },[categories, activeIds, columns, apiKeys, storageReady, workstationMode]);

  // Persist expanded map on change
  useEffect(()=>{
    if (!storageReady || workstationMode) return;
    api.store.set(SK_EXPANDED, JSON.stringify(expandedMap));
  },[expandedMap, storageReady, workstationMode]);

  useEffect(()=>{
    if (!storageReady) return;
    api.store.set(SK_OPACITY, String(opacity));
  },[opacity, storageReady]);

  useEffect(()=>{
    if (!storageReady) return;
    api.store.set(SK_CARD_OPACITY, String(cardOpacity));
    document.documentElement.style.setProperty('--card-bg', `rgba(38,40,50,${cardOpacity})`);
  },[cardOpacity, storageReady]);

  useEffect(()=>{
    if (!storageReady) return;
    api.store.set(SK_PINNED_OPACITY, String(pinnedOpacity));
  },[pinnedOpacity, storageReady]);

  useEffect(() => {
    if (!storageReady) return;
    api.store.set(SK_NEWS_CAROUSEL, newsCarouselEnabled ? '1' : '');
  }, [newsCarouselEnabled, storageReady]);

  useEffect(() => {
    if (!storageReady) return;
    api.store.set(SK_NEWS_CAROUSEL_MS, String(newsCarouselIntervalMs));
  }, [newsCarouselIntervalMs, storageReady]);

  useEffect(() => {
    if (!storageReady) return;
    api.store.set(SK_BASE_COLUMNS, String(baseColumnCount));
  }, [baseColumnCount, storageReady]);

  useEffect(()=>{
    if (!storageReady) return;
    api.store.set(SK_LOCATION, JSON.stringify(location));
  },[location, storageReady]);

  // Log and force repaint when panel becomes visible
  useEffect(() => {
    if (!visible || !storageReady) return;
    const el = panelBgRef.current;
    const computedBg = el ? window.getComputedStyle(el).backgroundColor : 'n/a';
    api.log?.(`panel visible: opacity=${opacity} storageReady=${storageReady} computedBg=${computedBg} el=${!!el}`);
    if (!el) return;
    requestAnimationFrame(() => {
      const bg2 = window.getComputedStyle(el).backgroundColor;
      api.log?.(`rAF1: computedBg=${bg2}`);
      el.style.outline = '1px solid transparent';
      requestAnimationFrame(() => {
        const bg3 = window.getComputedStyle(el).backgroundColor;
        api.log?.(`rAF2: computedBg=${bg3}`);
        el.style.outline = '';
      });
    });
  }, [visible, storageReady]);

  // Build notification snippets
  useEffect(()=>{
    const items=[];
    Object.entries(unreadMap).forEach(([id,count])=>{
      if (count>0) {
        const label=id.startsWith("cat:")?id.slice(4):id;
        items.push(`${count} unread · ${label}`);
      }
    });
    setSnippets(items);
  },[unreadMap]);

  const { snippet, visible: tickerVisible } = useNotificationRotator(snippets, totalUnread);

  function handleOPML(cats) {
    const defaults=[...cats.slice(0,2).map(c=>"cat:"+c.label),"weather","stocks","traffic","starvis"];
    setCategories(cats); setActiveIds(defaults); setColumns(defaultColumns(cats));
  }
  function resetColumns() { setColumns(defaultColumns(categories)); }
  function saveKey(service, key) {
    setApiKeys(p=>({...p,[service]:key}));
    setActiveIds(p=>p.includes(service)?p:[...p,service]);
  }
  function reset() {
    setCategories(null); setActiveIds([]); setColumns({}); setApiKeys({});
    setShowMgr(false); storageSave({});
  }
  async function togglePin() {
    const next = await api.pin?.toggle();
    setPinned(!!next);
    api.store.set(SK_PINNED, next ? '1' : '');
  }

  function captureWorkstationRects() {
    const rects = new Map();
    document.querySelectorAll('[data-widget-id]').forEach(el => {
      const id = el.getAttribute('data-widget-id');
      if (!WORKSTATION_WIDGET_ID_SET.has(id)) return;
      rects.set(id, el.getBoundingClientRect());
    });
    return rects;
  }

  function animateWorkstationCards(fromRects) {
    if (!fromRects?.size) return;
    window.clearTimeout(workstationAnimationTimerRef.current);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const animated = [];
        document.querySelectorAll('[data-widget-id]').forEach(el => {
          const id = el.getAttribute('data-widget-id');
          const from = fromRects.get(id);
          if (!from) return;
          const to = el.getBoundingClientRect();
          const dx = from.left - to.left;
          const dy = from.top - to.top;
          if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
          el.style.transition = 'none';
          el.style.animation = 'none';
          el.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
          el.style.zIndex = '7';
          el.style.willChange = 'transform';
          animated.push(el);
        });
        requestAnimationFrame(() => {
          animated.forEach(el => {
            el.style.transition = 'transform 420ms cubic-bezier(.18,.82,.24,1)';
            el.style.transform = 'translate3d(0, 0, 0)';
          });
        });
        workstationAnimationTimerRef.current = window.setTimeout(() => {
          animated.forEach(el => {
            el.style.transition = '';
            el.style.animation = '';
            el.style.transform = '';
            el.style.zIndex = '';
            el.style.willChange = '';
          });
        }, 470);
      });
    });
  }

  async function fitNativePanelForMode(mode, count = baseColumnCount) {
    try {
      await api.panel?.fitMode?.({
        mode,
        baseColumnCount: count,
        colWidths: colWidthsRef.current,
      });
    } catch (error) {
      api.log?.('[panel-fit-mode] renderer error', error?.message || String(error));
    }
  }

  async function setWidgetPanelMode(requestedMode) {
    if (!loaded || modeSwitching) return;
    window.clearTimeout(workstationExpandTimerRef.current);
    let nextMode = requestedMode === panelMode ? 'base' : requestedMode;
    nextMode = PANEL_MODES.includes(nextMode) ? nextMode : 'base';

    const seq = modeSwitchSeqRef.current + 1;
    modeSwitchSeqRef.current = seq;
    setModeSwitching(true);
    const fromRects = captureWorkstationRects();

    try {
      await fitNativePanelForMode(nextMode, nextMode === 'base' ? baseColumnCount : DEFAULT_BASE_COLUMN_COUNT);
      if (modeSwitchSeqRef.current !== seq) return;

      if (workstationMode && nextMode !== 'monitor') {
        const backup = workstationBackupRef.current;
        if (backup) {
          setActiveIds(backup.activeIds);
          setColumns(backup.columns);
          setExpandedMap(backup.expandedMap);
          workstationBackupRef.current = null;
        }
      }

      if (nextMode === 'monitor' && !workstationMode) {
        workstationBackupRef.current = {
          activeIds,
          columns,
          expandedMap,
        };
        setActiveIds(prev => {
          const next = prev.filter(id => !WORKSTATION_WIDGET_ID_SET.has(id));
          for (const id of WORKSTATION_WIDGET_IDS) {
            if (!next.includes(id)) next.push(id);
          }
          return next;
        });
        setColumns(prev => ({ ...prev, ...WORKSTATION_MODE_COLUMNS }));
        workstationExpandTimerRef.current = window.setTimeout(() => {
          setExpandedMap(prev => ({
            ...prev,
            ...Object.fromEntries(WORKSTATION_WIDGET_IDS.map(id => [id, true])),
          }));
        }, 430);
      }

      setPanelMode(nextMode);
      animateWorkstationCards(fromRects);
    } finally {
      if (modeSwitchSeqRef.current === seq) setModeSwitching(false);
    }
  }

  function toggleWorkstationMode() {
    setWidgetPanelMode('monitor');
  }

  function adjustBaseColumns(delta) {
    setBaseColumnCount(count => {
      const next = Math.max(3, Math.min(DEFAULT_BASE_COLUMN_COUNT, count + delta));
      if (next !== count && panelMode === 'base' && !reader.open && !readerTransition) {
        fitNativePanelForMode('base', next);
      }
      return next;
    });
  }

  const loaded = !!categories;
  // Filter out IDs that don't map to a known widget type — e.g. an old
  // 'pressreader' or removed cat:* left over in saved activeIds. Without
  // this, WidgetCard returns null but renderCol still renders the wrapping
  // .wi div, taking up space in whichever column the phantom ID was placed.
  const visibleIds = activeIds.filter(id => isKnownWidgetId(id, categories));
  const layoutVisibleIds = visibleIds;
  const newsIds  = layoutVisibleIds.filter(id => id.startsWith("cat:"));
  const stageActive = reader.open || !!readerTransition || panelMode === 'monitor' || panelMode === 'live';
  const webStageActive = (reader.open && reader.mode === 'web') || readerTransition?.nextReader?.mode === 'web';
  const belongsInRegularColumn = id => panelMode !== 'monitor' || !WORKSTATION_WIDGET_ID_SET.has(id);
  const leftIds  = layoutVisibleIds.filter(id => getColFor(id) === "left" && belongsInRegularColumn(id));
  const monitorIds = layoutVisibleIds.filter(id => getColFor(id) === "monitor" && belongsInRegularColumn(id));
  const midIds = layoutVisibleIds.filter(id => getColFor(id) === "mid" && belongsInRegularColumn(id));
  const feedIds = layoutVisibleIds.filter(id => getColFor(id) === "feed" && belongsInRegularColumn(id));
  const rightIds = layoutVisibleIds.filter(id => getColFor(id) === "right" && belongsInRegularColumn(id));
  const auxIds = layoutVisibleIds.filter(id => getColFor(id) === "aux" && belongsInRegularColumn(id));
  const workstationStageIds = WORKSTATION_WIDGET_IDS.filter(id => visibleIds.includes(id) || panelMode === 'monitor');
  const regularColumnCount = panelMode === 'base' && !stageActive
    ? baseColumnCount
    : DEFAULT_BASE_COLUMN_COUNT;
  const regularVisibleColumns = new Set(BASE_COLUMN_ORDER.slice(0, regularColumnCount));
  const lastRegularColumn = BASE_COLUMN_ORDER[Math.max(0, regularColumnCount - 1)];

  useEffect(() => {
    if (!visible || !loaded || browserPane.open) return;
    const geometryMode = stageActive ? (panelMode === 'base' ? 'stage' : panelMode) : (panelMode === 'news' ? 'news' : 'base');
    const geometryColumnCount = geometryMode === 'base' ? baseColumnCount : DEFAULT_BASE_COLUMN_COUNT;
    fitNativePanelForMode(geometryMode, geometryColumnCount);
  }, [visible, loaded, browserPane.open, stageActive, panelMode, baseColumnCount]);

  const onUnread = useCallback((id, count)=>{
    setUnreadMap(p => (p[id] === count ? p : { ...p, [id]: count }));
  },[]);

  if (!storageReady) return (
    <div style={{display:"flex",height:"100vh",alignItems:"center",justifyContent:"center",background:"rgba(10,10,12,0.95)",fontFamily:"'DM Sans',sans-serif"}}>
      <div style={{fontSize:11,color:"#c4c4d4"}}>Loading…</div>
    </div>
  );

  // Shared WidgetCard renderer for a column.
  // Drop targets are the card wrappers themselves — top-half hover = insert before,
  // bottom-half hover = insert after. Border lines show the insertion point.
  function renderCol(ids, colName) {
    return ids.map((id, i) => {
      const nextId = ids[i + 1] ?? null;
      const dropBefore = dragId && dropTarget?.col === colName && dropTarget?.beforeId === id;
      const dropAfter  = dragId && dropTarget?.col === colName && dropTarget?.beforeId === nextId;
      const hideForNewsMode = panelMode === 'news' && id === 'starvis';
      return (
        <div
          key={`${id}-${id.startsWith('cat:') || id === 'starvis' ? 'stable' : refreshKey}`}
          className="wi"
          data-widget-id={id}
          data-widget-col={colName}
          data-widget-expanded={getExpanded(id) ? 'true' : 'false'}
          data-widget-news={id.startsWith('cat:') ? 'true' : 'false'}
          style={{
          display: hideForNewsMode ? 'none' : undefined,
          animationDelay: (i*25)+"ms",
          borderTop:    !workstationMode && dropBefore ? '2px solid var(--accent)' : '2px solid transparent',
          borderBottom: !workstationMode && dropAfter  ? '2px solid var(--accent)' : '2px solid transparent',
          transition: 'border-color 0.06s',
        }}
        onDragOver={e=>{
          if (workstationMode) return;
          e.preventDefault(); e.stopPropagation();
          const rect = e.currentTarget.getBoundingClientRect();
          const before = e.clientY < rect.top + rect.height / 2;
          const target = { col: colName, beforeId: before ? id : nextId };
          if (!dropTarget || dropTarget.col !== colName || dropTarget.beforeId !== target.beforeId) {
            setDropTarget(target);
          }
        }}
        onDrop={e=>{
          if (workstationMode) return;
          e.preventDefault(); e.stopPropagation();
          if (dragId && dropTarget) handleDrop(dragId, dropTarget.col, dropTarget.beforeId);
        }}>
          <WidgetCard id={id} categories={categories||[]} apiKeys={apiKeys} onSaveKey={saveKey}
            colorIdx={newsIds.indexOf(id)}
            onUnreadChange={count=>onUnread(id,count)}
            onOpenUrl={openBrowser}
            onOpenWebContent={openWebCard}
            newsCarouselEnabled={newsCarouselEnabled}
            newsCarouselIntervalMs={newsCarouselIntervalMs}
            location={location}
            tvSymbols={tvSymbols}
            expanded={getExpanded(id)}
            onToggle={()=>toggleExpanded(id)}
            isDragging={dragId === id}
            onDragStart={workstationMode ? undefined : ()=>{ setDragId(id); setDropTarget(null); }}
            onDragEnd={workstationMode ? undefined : ()=>{ setDragId(null); setDropTarget(null); }} />
        </div>
      );
    });
  }

  function renderStageWidget(id, extraStyle = {}) {
    return (
      <div
        key={`${id}-stage-${refreshKey}`}
        className="wi workstation-stage-card"
        data-widget-id={id}
        data-widget-col="stage"
        data-widget-expanded="true"
        data-widget-news={id.startsWith('cat:') ? 'true' : 'false'}
        style={{ minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', ...extraStyle }}
      >
        <WidgetCard id={id} categories={categories || []} apiKeys={apiKeys} onSaveKey={saveKey}
          colorIdx={newsIds.indexOf(id)}
          onUnreadChange={count => onUnread(id, count)}
          onOpenUrl={openBrowser}
          onOpenWebContent={openWebCard}
          newsCarouselEnabled={newsCarouselEnabled}
          newsCarouselIntervalMs={newsCarouselIntervalMs}
          location={location}
          tvSymbols={tvSymbols}
          expanded={true}
          onToggle={() => toggleExpanded(id)}
          isDragging={false}
          onDragStart={undefined}
          onDragEnd={undefined} />
      </div>
    );
  }

  function renderMonitorStage() {
    const present = id => workstationStageIds.includes(id);
    return (
      <div className="monitor-stage" style={{
        flex: 1,
        minWidth: 0,
        minHeight: 0,
        padding: '10px',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        overflowY: 'auto',
        overflowX: 'hidden',
      }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8, minHeight: 0, alignItems: 'stretch' }}>
          {present('workstation-cpu') && renderStageWidget('workstation-cpu', { minHeight: 0, height: '100%' })}
          {present('workstation-gpu') && renderStageWidget('workstation-gpu', { minHeight: 0, height: '100%' })}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8, minHeight: 0, alignItems: 'stretch' }}>
          {present('workstation-ram') && renderStageWidget('workstation-ram', { minHeight: 0, height: '100%' })}
          {present('workstation-disk') && renderStageWidget('workstation-disk', { minHeight: 0, height: '100%' })}
          {present('workstation-network') && renderStageWidget('workstation-network', { minHeight: 0, height: '100%' })}
        </div>
      </div>
    );
  }

  function renderStageArea() {
    if (reader.open || readerTransition) {
      return reader.mode === 'web'
        ? <BrowserIslandCard key={`web-${reader.url || ''}-${reader.flavor || ''}`} reader={reader} transition={readerTransition} onTransitionLanded={completeReaderTransition} onClose={closeReader} onOpenExternal={openReaderExternal} onOpenWebContent={openWebCard} />
        : <ArticleReaderCard reader={reader} transition={readerTransition} onTransitionLanded={completeReaderTransition} onClose={closeReader} onOpenExternal={openReaderExternal} onOpenArchive={openReaderArchive} />;
    }
    if (panelMode === 'live') return <LiveFeedGrid onOpenWebContent={openWebCard} />;
    if (panelMode === 'monitor') return renderMonitorStage();
    return null;
  }

  function columnFlexStyle(colName) {
    const grows = !stageActive && colName === lastRegularColumn;
    return grows
      ? { flex: '1 0 auto', width: colWidths[colName], minWidth: colWidths[colName] }
      : { flex: '0 0 auto', width: colWidths[colName] };
  }

  const panelAlpha = pinned ? pinnedOpacity : opacity;
  const panelLowAlpha = panelAlpha;
  const panelGlowAlpha = opacityRange(panelAlpha, 0, 0.18);
  const acrylicCardTopAlpha = opacityRange(cardOpacity, 0, 1);
  const acrylicCardBottomAlpha = opacityRange(cardOpacity, 0, 0.96);
  const acrylicCardFillAlpha = opacityRange(cardOpacity, 0, 1);
  const acrylicCardFillSoftAlpha = opacityRange(cardOpacity, 0, 0.82);

  return (
    <div style={{
      display:"flex",height:"100vh",fontFamily:"'DM Sans',sans-serif",background:"transparent",overflow:"hidden",
      "--accent":accentColor,
      "--acrylic-card-top":`rgba(10,18,34,${acrylicCardTopAlpha})`,
      "--acrylic-card-bottom":`rgba(8,10,18,${acrylicCardBottomAlpha})`,
      "--acrylic-card-fill":`rgba(8,14,28,${acrylicCardFillAlpha})`,
      "--acrylic-card-fill-soft":`rgba(8,14,28,${acrylicCardFillSoftAlpha})`
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600&family=DM+Mono:wght@300;400&display=swap');
        html,body{background:transparent;margin:0;padding:0}
        *{box-sizing:border-box;margin:0;padding:0}
        ::-webkit-scrollbar{width:3px}
        ::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.18);border-radius:2px}
        ::-webkit-scrollbar-thumb:hover{background:rgba(255,255,255,0.28)}
        @keyframes fadeIn{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:none}}
        @keyframes pulse{0%,100%{opacity:.18}50%{opacity:.44}}
        @keyframes ticker{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
        @keyframes spin{to{transform:rotate(360deg)}}
        .wi{animation:fadeIn 0.2s ease both}
        .workstation-stage-card > .wp-acrylic-shell{height:100%;width:100%}
        .workstation-stage-card .wp-acrylic-body{min-height:0}
        .monitor-stage{
          position:relative;
          border-radius:8px;
          border:1px solid rgba(238,248,255,.18);
          background:
            radial-gradient(circle at 82% 8%, rgba(47,109,255,.16), transparent 34%),
            radial-gradient(circle at 15% 92%, rgba(122,178,255,.08), transparent 32%),
            linear-gradient(145deg, rgba(5,9,19,.92), rgba(2,5,12,.86));
          box-shadow:
            inset 0 0 0 1px rgba(47,109,255,.10),
            inset 0 1px 0 rgba(255,255,255,.06),
            0 0 26px rgba(47,109,255,.12);
        }
        .monitor-stage::before{
          content:"";
          position:absolute;
          inset:0;
          pointer-events:none;
          border-radius:inherit;
          background:linear-gradient(115deg, rgba(255,255,255,.055), transparent 26%, transparent 70%, rgba(47,109,255,.07));
          mix-blend-mode:screen;
        }
        .monitor-stage .workstation-stage-card > .wp-acrylic-shell{
          border-color:rgba(238,248,255,.34) !important;
          background:
            linear-gradient(145deg, rgba(9,16,30,.82), rgba(4,8,17,.76)),
            rgba(4,8,17,.80) !important;
          box-shadow:
            0 0 0 1px rgba(255,255,255,.08),
            0 0 18px rgba(31,111,255,.18),
            inset 0 0 0 1px rgba(255,255,255,.08),
            inset 0 16px 36px rgba(255,255,255,.018) !important;
        }
        input{color-scheme:dark}
        button:focus{outline:none}
        a{color:var(--accent)}
        /* Global text vibrancy */
        body{color:#eeeef8}
        .panel-wrap{
          --panel-slide-duration:${PANEL_SLIDE_MS}ms;
          --panel-bg:
            linear-gradient(145deg, rgba(48,58,88,${opacityRange(panelAlpha, 0, 1)}), rgba(10,16,30,${opacityRange(panelLowAlpha, 0, 1)})),
            radial-gradient(circle at 88% 96%, rgba(31,111,255,${panelGlowAlpha}), transparent 25%),
            radial-gradient(circle at 8% 2%, rgba(255,255,255,${opacityRange(panelAlpha, 0, 0.10)}), transparent 18%),
            linear-gradient(90deg, rgba(255,255,255,${opacityRange(panelAlpha, 0, 0.10)}), transparent 16%, transparent 84%, rgba(255,255,255,${opacityRange(panelAlpha, 0, 0.055)}));
          opacity:.90;
          box-sizing:border-box;
          background:var(--panel-bg);
          border:1px solid rgba(238,248,255,0.34);
          box-shadow:
            inset 0 0 0 1px rgba(31,111,255,0.11),
            inset 0 1px 0 rgba(255,255,255,0.20),
            0 0 30px rgba(31,111,255,0.12);
          backdrop-filter:blur(28px) saturate(178%) contrast(104%);
          -webkit-backdrop-filter:blur(28px) saturate(178%) contrast(104%);
          transform:
            perspective(1800px)
            translate3d(calc(-100% - 18px),0,0)
            rotateY(-6deg)
            scale3d(.982,.996,1);
          transform-origin:left center;
          transform-style:preserve-3d;
          backface-visibility:hidden;
          will-change:transform,opacity;
          contain:paint style;
          transition:
            transform var(--panel-slide-duration) cubic-bezier(.16,.84,.22,1),
            opacity 260ms cubic-bezier(.22,1,.36,1);
          isolation:isolate;
        }
        .panel-wrap.open{
          opacity:1;
          transform:
            perspective(1800px)
            translate3d(0,0,0)
            rotateY(0deg)
            scale3d(1,1,1);
        }
        .resize-handle{
          width:5px;flex-shrink:0;cursor:ew-resize;
          background:transparent;
          opacity:0;
          transition:background 0.15s, opacity 0.15s;
          position:relative;z-index:10;
        }
        .resize-handle:hover,.resize-handle:active{
          opacity:1;
          background:linear-gradient(180deg, transparent, rgba(244,250,255,0.40), rgba(31,111,255,0.48), rgba(244,250,255,0.28), transparent);
        }
        .col-divider{
          width:4px;flex-shrink:0;cursor:col-resize;
          background:linear-gradient(180deg, transparent, rgba(244,250,255,0.12), rgba(31,111,255,0.18), rgba(244,250,255,0.08), transparent);
          transition:background 0.15s;
          user-select:none;
        }
        .col-divider:hover{
          background:linear-gradient(180deg, transparent, rgba(244,250,255,0.26), rgba(31,111,255,0.34), rgba(244,250,255,0.18), transparent);
        }
        .panel-surface{
          position:relative;
          isolation:isolate;
          background:transparent;
          border:0;
          box-shadow:none;
          backdrop-filter:none;
          -webkit-backdrop-filter:none;
        }
        .panel-surface.web-stage{
          isolation:auto;
        }
        .panel-surface::before{
          content:"";
          position:absolute;
          inset:0;
          pointer-events:none;
          border:1px solid rgba(238,248,255,0.48);
          box-shadow:
            inset 0 0 0 1px rgba(31,111,255,0.16),
            inset 0 1px 0 rgba(255,255,255,0.24),
            0 0 18px rgba(31,111,255,0.14);
          z-index:2;
        }
        .panel-surface::after{
          content:"";
          position:absolute;
          left:18px;right:18px;top:0;height:1px;
          pointer-events:none;
          background:linear-gradient(90deg, transparent, rgba(31,111,255,0.55), rgba(255,255,255,0.78), rgba(31,111,255,0.55), transparent);
          box-shadow:0 0 12px rgba(31,111,255,0.34);
          opacity:.56;
          z-index:3;
        }
        .panel-chrome-button{
          width:24px;
          height:24px;
          display:inline-flex;
          align-items:center;
          justify-content:center;
          border-radius:6px;
          border:1px solid rgba(122,178,255,0.24);
          background:rgba(31,111,255,0.045);
          color:rgba(235,247,255,0.86);
          cursor:pointer;
          padding:0;
          line-height:1;
          transition:background .15s,border-color .15s,box-shadow .15s,color .15s,transform .15s;
          box-shadow:inset 0 0 0 1px rgba(255,255,255,0.035);
          text-shadow:0 0 8px rgba(31,111,255,0.34);
        }
        .panel-chrome-button:hover{
          border-color:rgba(190,224,255,0.64);
          background:rgba(31,111,255,0.14);
          color:#fff;
          box-shadow:0 0 14px rgba(31,111,255,0.24), inset 0 0 0 1px rgba(255,255,255,0.08);
        }
        .panel-chrome-button:active{
          transform:translateY(1px);
          background:rgba(31,111,255,0.20);
        }
        .panel-chrome-button.is-active{
          border-color:rgba(230,246,255,0.72);
          background:rgba(31,111,255,0.18);
          color:#fff;
          box-shadow:0 0 16px rgba(31,111,255,0.30), inset 0 0 0 1px rgba(255,255,255,0.11);
        }
        @keyframes readerZoom{
          from{opacity:0;transform:scale(.965) translateY(12px);filter:blur(8px)}
          to{opacity:1;transform:scale(1) translateY(0);filter:none}
        }
        @keyframes readerLaunchRollLegacy{
          0%{
            opacity:1;
            filter:blur(.2px) saturate(1.08);
            transform:
              perspective(1800px)
              translate3d(var(--reader-launch-x,0),var(--reader-launch-y,0),80px)
              rotateX(7deg)
              rotateY(-9deg)
              rotateZ(-360deg)
              scale(var(--reader-launch-scale,.16));
          }
          4%{
            transform:
              perspective(1800px)
              translate3d(calc(var(--reader-launch-x,0) * .965),calc(var(--reader-launch-y,0) * .965),92px)
              rotateX(8deg)
              rotateY(-8deg)
              rotateZ(-342deg)
              scale(.20);
          }
          8%{
            transform:
              perspective(1800px)
              translate3d(calc(var(--reader-launch-x,0) * .925),calc(var(--reader-launch-y,0) * .925),104px)
              rotateX(9deg)
              rotateY(-6deg)
              rotateZ(-323deg)
              scale(.25);
          }
          12%{
            transform:
              perspective(1800px)
              translate3d(calc(var(--reader-launch-x,0) * .875),calc(var(--reader-launch-y,0) * .875),112px)
              rotateX(8deg)
              rotateY(-3deg)
              rotateZ(-303deg)
              scale(.31);
          }
          16%{
            transform:
              perspective(1800px)
              translate3d(calc(var(--reader-launch-x,0) * .815),calc(var(--reader-launch-y,0) * .815),118px)
              rotateX(6deg)
              rotateY(1deg)
              rotateZ(-282deg)
              scale(.38);
          }
          20%{
            transform:
              perspective(1800px)
              translate3d(calc(var(--reader-launch-x,0) * .748),calc(var(--reader-launch-y,0) * .748),122px)
              rotateX(4deg)
              rotateY(4deg)
              rotateZ(-260deg)
              scale(.45);
          }
          25%{
            transform:
              perspective(1800px)
              translate3d(calc(var(--reader-launch-x,0) * .662),calc(var(--reader-launch-y,0) * .662),124px)
              rotateX(2deg)
              rotateY(7deg)
              rotateZ(-233deg)
              scale(.54);
          }
          30%{
            transform:
              perspective(1800px)
              translate3d(calc(var(--reader-launch-x,0) * .575),calc(var(--reader-launch-y,0) * .575),120px)
              rotateX(-1deg)
              rotateY(8deg)
              rotateZ(-207deg)
              scale(.63);
          }
          35%{
            transform:
              perspective(1800px)
              translate3d(calc(var(--reader-launch-x,0) * .488),calc(var(--reader-launch-y,0) * .488),112px)
              rotateX(-3deg)
              rotateY(7deg)
              rotateZ(-181deg)
              scale(.72);
          }
          40%{
            transform:
              perspective(1800px)
              translate3d(calc(var(--reader-launch-x,0) * .405),calc(var(--reader-launch-y,0) * .405),100px)
              rotateX(-4deg)
              rotateY(5deg)
              rotateZ(-156deg)
              scale(.80);
          }
          45%{
            transform:
              perspective(1800px)
              translate3d(calc(var(--reader-launch-x,0) * .328),calc(var(--reader-launch-y,0) * .328),86px)
              rotateX(-4deg)
              rotateY(2deg)
              rotateZ(-132deg)
              scale(.87);
          }
          50%{
            filter:blur(0) saturate(1.04);
            transform:
              perspective(1800px)
              translate3d(calc(var(--reader-launch-x,0) * .258),calc(var(--reader-launch-y,0) * .258),72px)
              rotateX(-3deg)
              rotateY(-1deg)
              rotateZ(-108deg)
              scale(.93);
          }
          55%{
            transform:
              perspective(1800px)
              translate3d(calc(var(--reader-launch-x,0) * .196),calc(var(--reader-launch-y,0) * .196),58px)
              rotateX(-2deg)
              rotateY(-3deg)
              rotateZ(-86deg)
              scale(.975);
          }
          60%{
            transform:
              perspective(1800px)
              translate3d(calc(var(--reader-launch-x,0) * .144),calc(var(--reader-launch-y,0) * .144),44px)
              rotateX(-1deg)
              rotateY(-4deg)
              rotateZ(-65deg)
              scale(1.006);
          }
          66%{
            transform:
              perspective(1800px)
              translate3d(calc(var(--reader-launch-x,0) * .090),calc(var(--reader-launch-y,0) * .090),30px)
              rotateX(1deg)
              rotateY(-4deg)
              rotateZ(-42deg)
              scale(1.024);
          }
          72%{
            transform:
              perspective(1800px)
              translate3d(calc(var(--reader-launch-x,0) * .048),calc(var(--reader-launch-y,0) * .048),18px)
              rotateX(2deg)
              rotateY(-3deg)
              rotateZ(-23deg)
              scale(1.028);
          }
          78%{
            transform:
              perspective(1800px)
              translate3d(calc(var(--reader-launch-x,0) * .020),calc(var(--reader-launch-y,0) * .020),10px)
              rotateX(2deg)
              rotateY(-1deg)
              rotateZ(-10deg)
              scale(1.020);
          }
          84%{
            transform:
              perspective(1800px)
              translate3d(calc(var(--reader-launch-x,0) * .004),calc(var(--reader-launch-y,0) * .004),5px)
              rotateX(1deg)
              rotateY(.5deg)
              rotateZ(-2deg)
              scale(1.011);
          }
          90%{
            transform:
              perspective(1800px)
              translate3d(calc(var(--reader-launch-x,0) * -.004),calc(var(--reader-launch-y,0) * -.004),2px)
              rotateX(.4deg)
              rotateY(.8deg)
              rotateZ(1.5deg)
              scale(1.005);
          }
          96%{
            opacity:1;
            transform:
              perspective(1800px)
              translate3d(0,0,0)
              rotateX(.1deg)
              rotateY(.1deg)
              rotateZ(.25deg)
              scale(1.001);
          }
          100%{
            opacity:1;
            filter:none;
            transform:
              perspective(1800px)
              translate3d(0,0,0)
              rotateX(0deg)
              rotateY(0deg)
              rotateZ(0deg)
              scale(1);
          }
        }
        @keyframes readerSweep{
          from{transform:translateX(-130%)}
          to{transform:translateX(130%)}
        }
        @keyframes readerLaunchFlip{
          0%{
            opacity:.72;
            border-radius:999px;
            transform:
              perspective(1800px)
              translate3d(var(--reader-launch-x,0),var(--reader-launch-y,0),74px)
              rotate3d(.22,.88,.18,-180deg)
              scale(var(--reader-launch-scale,.16));
          }
          7%{
            opacity:.86;
            border-radius:999px;
            transform:
              perspective(1800px)
              translate3d(calc(var(--reader-launch-x,0) * .94),calc(var(--reader-launch-y,0) * .94),92px)
              rotate3d(.22,.88,.18,-171deg)
              scale(.045);
          }
          14%{
            opacity:1;
            border-radius:24px;
            transform:
              perspective(1800px)
              translate3d(calc(var(--reader-launch-x,0) * .85),calc(var(--reader-launch-y,0) * .85),108px)
              rotate3d(.22,.88,.18,-158deg)
              scale(.13);
          }
          22%{
            border-radius:12px;
            transform:
              perspective(1800px)
              translate3d(calc(var(--reader-launch-x,0) * .72),calc(var(--reader-launch-y,0) * .72),116px)
              rotate3d(.22,.88,.18,-141deg)
              scale(.29);
          }
          31%{
            border-radius:8px;
            transform:
              perspective(1800px)
              translate3d(calc(var(--reader-launch-x,0) * .57),calc(var(--reader-launch-y,0) * .57),112px)
              rotate3d(.22,.88,.18,-118deg)
              scale(.47);
          }
          40%{
            transform:
              perspective(1800px)
              translate3d(calc(var(--reader-launch-x,0) * .41),calc(var(--reader-launch-y,0) * .41),98px)
              rotate3d(.22,.88,.18,-92deg)
              scale(.65);
          }
          50%{
            transform:
              perspective(1800px)
              translate3d(calc(var(--reader-launch-x,0) * .27),calc(var(--reader-launch-y,0) * .27),76px)
              rotate3d(.22,.88,.18,-65deg)
              scale(.81);
          }
          60%{
            transform:
              perspective(1800px)
              translate3d(calc(var(--reader-launch-x,0) * .16),calc(var(--reader-launch-y,0) * .16),52px)
              rotate3d(.22,.88,.18,-39deg)
              scale(.94);
          }
          70%{
            transform:
              perspective(1800px)
              translate3d(calc(var(--reader-launch-x,0) * .075),calc(var(--reader-launch-y,0) * .075),30px)
              rotate3d(.22,.88,.18,-19deg)
              scale(1.012);
          }
          80%{
            transform:
              perspective(1800px)
              translate3d(calc(var(--reader-launch-x,0) * .025),calc(var(--reader-launch-y,0) * .025),14px)
              rotate3d(.22,.88,.18,-6deg)
              scale(1.018);
          }
          90%{
            transform:
              perspective(1800px)
              translate3d(calc(var(--reader-launch-x,0) * -.004),calc(var(--reader-launch-y,0) * -.004),4px)
              rotate3d(.22,.88,.18,1.5deg)
              scale(1.002);
          }
          100%{
            opacity:1;
            border-radius:8px;
            transform:
              perspective(1800px)
              translate3d(0,0,0)
              rotate3d(.22,.88,.18,0deg)
              scale(1);
          }
        }
        .reader-stage{
          position:relative;
          flex:1;min-width:0;overflow:visible;padding:0 10px 12px 6px;
          display:flex;flex-direction:column;
          perspective:1800px;
          perspective-origin:50% 48%;
        }
        .browser-island-stage{
          min-height:0;
          height:100%;
          overflow:hidden;
          perspective:none;
          perspective-origin:50% 50%;
          transform-style:flat;
        }
        .reader-card{
          position:relative;flex:1;min-height:0;overflow:hidden;border-radius:8px;
          display:flex;flex-direction:column;
          border:1px solid rgba(238,248,255,.58);
          background:
            linear-gradient(145deg, rgba(10,18,34,.74), rgba(5,9,18,.60)),
            radial-gradient(circle at 85% 12%, rgba(47,109,255,.20), transparent 28%);
          box-shadow:
            0 0 0 1px rgba(47,109,255,.22),
            0 18px 46px rgba(0,0,0,.30),
            0 0 38px rgba(47,109,255,.16),
            inset 0 1px 0 rgba(255,255,255,.18),
            inset 0 0 0 1px rgba(255,255,255,.08);
          backdrop-filter:blur(28px) saturate(180%);
          -webkit-backdrop-filter:blur(28px) saturate(180%);
          animation:readerZoom 180ms cubic-bezier(.22,1,.36,1) both;
          transform-origin:center center;
          transform-style:preserve-3d;
          will-change:transform,opacity;
        }
        .reader-card.reader-card-pending{
          opacity:0;
          animation:none;
        }
        .reader-card.reader-card-settled{
          opacity:1;
          animation:none;
          transform:none;
        }
        .reader-launch-ghost{
          position:absolute;
          z-index:80;
          pointer-events:none;
          overflow:hidden;
          border-radius:8px;
          border:1px solid rgba(238,248,255,.70);
          background:
            linear-gradient(145deg, rgba(10,18,34,.82), rgba(4,8,17,.70)),
            radial-gradient(circle at 78% 10%, rgba(47,109,255,.30), transparent 34%);
          box-shadow:
            0 0 0 1px rgba(47,109,255,.28),
            0 18px 46px rgba(0,0,0,.34),
            0 0 42px rgba(47,109,255,.22),
            inset 0 1px 0 rgba(255,255,255,.22),
            inset 0 0 0 1px rgba(255,255,255,.10);
          backface-visibility:visible;
          -webkit-backface-visibility:visible;
          transform-style:preserve-3d;
          transform-origin:50% 50%;
          will-change:transform,opacity;
          contain:layout paint style;
          isolation:isolate;
          animation:readerLaunchFlip var(--reader-launch-duration,560ms) cubic-bezier(.16,.84,.22,1) both;
        }
        .reader-launch-ghost::before{
          content:"";
          position:absolute;inset:0;pointer-events:none;z-index:0;
          background:
            linear-gradient(115deg, rgba(255,255,255,.18), transparent 24%, transparent 58%, rgba(47,109,255,.16)),
            radial-gradient(circle at 70% 8%, rgba(122,178,255,.20), transparent 30%);
          mix-blend-mode:screen;
          opacity:.72;
          transform:translateZ(2px);
        }
        .reader-launch-ghost::after{
          content:"";
          position:absolute;inset:0;pointer-events:none;z-index:2;border-radius:inherit;
          border:1px solid rgba(255,255,255,.28);
          box-shadow:inset 0 0 0 1px rgba(47,109,255,.16), inset 0 0 24px rgba(47,109,255,.08);
          transform:translateZ(3px);
        }
        .reader-launch-ghost-glow{
          position:absolute;left:24px;right:24px;top:0;height:1px;
          background:linear-gradient(90deg,transparent,rgba(47,109,255,.74),rgba(255,255,255,.92),rgba(47,109,255,.74),transparent);
          box-shadow:0 0 20px rgba(47,109,255,.46);
          z-index:3;
          transform:translateZ(4px);
        }
        .reader-launch-ghost-image{
          position:absolute;inset:0;width:100%;height:100%;object-fit:cover;
          opacity:.28;filter:saturate(.9) contrast(1.05);
          z-index:0;transform:translateZ(1px);
        }
        .reader-launch-ghost-content{
          position:absolute;inset:0;z-index:3;padding:16px 18px;
          display:flex;flex-direction:column;justify-content:flex-end;
          background:
            linear-gradient(180deg, rgba(3,7,15,.10), rgba(3,7,15,.62)),
            radial-gradient(circle at 78% 12%, rgba(47,109,255,.16), transparent 34%);
          transform:translateZ(5px);
        }
        .reader-launch-ghost-label{
          color:#fff;font-size:10px;
          font-family:'DM Mono',monospace;text-shadow:0 0 12px rgba(47,109,255,.64);
          opacity:.72;
          white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
        }
        .reader-launch-ghost-title{
          margin-top:7px;color:#fff;font-size:22px;line-height:1.06;
          max-width:min(680px,78%);text-shadow:0 0 18px rgba(47,109,255,.34);
          overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;
        }
        .reader-launch-ghost-detail{
          margin-top:8px;max-width:min(620px,70%);color:rgba(247,250,255,.70);
          font-size:12px;line-height:1.35;overflow:hidden;display:-webkit-box;
          -webkit-line-clamp:2;-webkit-box-orient:vertical;
        }
        .reader-card-glow{
          position:absolute;left:24px;right:24px;top:0;height:1px;
          background:linear-gradient(90deg,transparent,rgba(47,109,255,.74),rgba(255,255,255,.88),rgba(47,109,255,.74),transparent);
          box-shadow:0 0 18px rgba(47,109,255,.42);pointer-events:none;
        }
        .reader-topbar{
          height:42px;display:flex;align-items:center;justify-content:space-between;
          padding:0 12px 0 14px;border-bottom:1px solid rgba(247,250,255,.10);
          flex:0 0 auto;
        }
        .reader-source{display:flex;align-items:center;gap:8px;color:#f7faff;font-size:11px;min-width:0}
        .reader-dot{width:7px;height:7px;border-radius:50%;background:#2f6dff;box-shadow:0 0 12px rgba(47,109,255,.9);flex-shrink:0}
        .reader-source-mode{color:rgba(247,250,255,.55);font-family:'DM Mono',monospace;font-size:9px}
        .reader-actions{display:flex;gap:6px;flex-shrink:0}
        .reader-icon-button{
          width:25px;height:25px;border-radius:6px;border:1px solid rgba(238,248,255,.36);
          background:rgba(47,109,255,.10);color:#f7faff;cursor:pointer;font-size:12px;
          display:flex;align-items:center;justify-content:center;
          box-shadow:inset 0 0 0 1px rgba(255,255,255,.05),0 0 12px rgba(47,109,255,.14);
          transition:background .15s,border-color .15s,box-shadow .15s,transform .15s;
        }
        .reader-icon-button:hover{
          background:rgba(47,109,255,.22);border-color:rgba(255,255,255,.70);
          box-shadow:0 0 18px rgba(47,109,255,.30),inset 0 0 0 1px rgba(255,255,255,.10);
        }
        .reader-icon-button:active{transform:translateY(1px)}
        .reader-text-button{
          height:25px;border-radius:6px;border:1px solid rgba(238,248,255,.34);
          background:rgba(47,109,255,.12);color:#f7faff;cursor:pointer;font-size:10px;
          display:flex;align-items:center;justify-content:center;padding:0 9px;
          box-shadow:inset 0 0 0 1px rgba(255,255,255,.05),0 0 12px rgba(47,109,255,.12);
          transition:background .15s,border-color .15s,box-shadow .15s,transform .15s;
        }
        .reader-text-button:hover{
          background:rgba(47,109,255,.24);border-color:rgba(255,255,255,.68);
          box-shadow:0 0 18px rgba(47,109,255,.28),inset 0 0 0 1px rgba(255,255,255,.10);
        }
        .reader-text-button:active{transform:translateY(1px)}
        .reader-progress-track{height:2px;background:rgba(255,255,255,.06);overflow:hidden;flex:0 0 auto}
        .reader-progress-fill{
          height:100%;background:linear-gradient(90deg,rgba(47,109,255,.20),rgba(238,248,255,.95),rgba(47,109,255,.70));
          box-shadow:0 0 14px rgba(47,109,255,.58);transition:width .22s ease,opacity .35s;
        }
        .reader-content{
          flex:1 1 0;height:0;min-height:0;display:grid;
          grid-template-columns:minmax(0,1fr) 260px;grid-auto-rows:auto;
          align-content:start;
          align-items:start;gap:18px;padding:18px 12px 18px 18px;
          overflow-y:scroll;overflow-x:hidden;overscroll-behavior:contain;
          scrollbar-color:rgba(47,109,255,.58) rgba(255,255,255,.06);
          scrollbar-width:thin;scrollbar-gutter:stable;
        }
        .reader-content::-webkit-scrollbar{width:8px}
        .reader-content::-webkit-scrollbar-track{background:rgba(255,255,255,.035);border-radius:999px}
        .reader-content::-webkit-scrollbar-thumb{
          background:linear-gradient(180deg,rgba(122,178,255,.76),rgba(31,111,255,.55));
          border-radius:999px;border:2px solid rgba(4,8,17,.78);
          box-shadow:0 0 12px rgba(47,109,255,.36);
        }
        .reader-copy{
          min-width:0;min-height:0;overflow:visible;padding-right:0;
        }
        .reader-copy h1{font-size:26px;line-height:1.08;color:#fff;font-weight:650;margin-bottom:12px;letter-spacing:0}
        .reader-copy p{font-size:14px;line-height:1.72;color:rgba(247,250,255,.88);margin:0 0 13px}
        .reader-deck{font-size:15px!important;color:rgba(247,250,255,.68)!important;line-height:1.55!important;margin-bottom:18px!important}
        .reader-media{
          position:sticky;top:0;align-self:start;
          min-width:0;min-height:0;display:flex;flex-direction:column;gap:10px;
        }
        .reader-image-shell{position:relative;min-width:0}
        .reader-image-shell img{cursor:zoom-in}
        .reader-image-count{
          position:absolute;right:8px;bottom:8px;border:1px solid rgba(238,248,255,.28);
          background:rgba(5,9,19,.72);color:#fff;border-radius:999px;padding:3px 7px;
          font-family:'DM Mono',monospace;font-size:9px;box-shadow:0 0 14px rgba(47,109,255,.2);
        }
        .reader-media img,.reader-image-placeholder{
          width:100%;aspect-ratio:4/3;border-radius:7px;object-fit:cover;
          border:1px solid rgba(238,248,255,.22);background:rgba(255,255,255,.05);
          box-shadow:0 0 20px rgba(47,109,255,.12);
        }
        .reader-image-placeholder{display:flex;align-items:center;justify-content:center;color:rgba(247,250,255,.38);font-family:'DM Mono',monospace;font-size:12px}
        .reader-meta{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}
        .reader-meta div{border:1px solid rgba(247,250,255,.10);background:rgba(255,255,255,.035);border-radius:6px;padding:7px 6px}
        .reader-meta span{display:block;color:rgba(247,250,255,.54);font-size:8.5px;text-transform:uppercase}
        .reader-meta strong{display:block;color:#fff;font-family:'DM Mono',monospace;font-size:11px;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .reader-loading{
          position:relative;margin-top:20px;border:1px solid rgba(238,248,255,.18);border-radius:8px;
          background:rgba(47,109,255,.055);padding:18px;overflow:hidden;color:#f7faff;
        }
        .reader-scanline{
          position:absolute;inset:0;background:linear-gradient(90deg,transparent,rgba(238,248,255,.16),transparent);
          animation:readerSweep 1.25s linear infinite;
        }
        .reader-loading-title{position:relative;font-size:14px;font-weight:650;margin-bottom:5px}
        .reader-loading-text{position:relative;font-size:11px;color:rgba(247,250,255,.62)}
        .reader-error{
          border:1px solid rgba(255,255,255,.18);background:rgba(47,109,255,.07);
          border-radius:8px;padding:16px;color:rgba(247,250,255,.82);font-size:13px;line-height:1.5;
        }
        .reader-debug{
          margin-top:10px;border:1px solid rgba(238,248,255,.13);border-radius:8px;
          background:rgba(255,255,255,.035);padding:10px 11px;color:rgba(247,250,255,.62);
          font-family:'DM Mono',monospace;font-size:10px;
        }
        .reader-debug-title{color:rgba(247,250,255,.78);margin-bottom:7px}
        .reader-debug-row{
          display:grid;grid-template-columns:minmax(0,1fr) 38px 48px auto minmax(0,1.4fr);
          gap:8px;align-items:center;min-height:18px;border-top:1px solid rgba(247,250,255,.06);
        }
        .reader-debug-row:first-of-type{border-top:0}
        .reader-debug-row span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .reader-open-fallback{
          border-radius:6px;border:1px solid rgba(238,248,255,.42);
          background:rgba(47,109,255,.14);color:#fff;font-size:11px;padding:7px 10px;cursor:pointer;
        }
        .reader-error-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
        .reader-image-overlay{
          position:absolute;inset:0;z-index:12;display:flex;align-items:flex-start;justify-content:center;
          padding-top:clamp(72px, 14%, 150px);
          background:
            radial-gradient(circle at 50% 18%, rgba(47,109,255,.16), transparent 32%),
            rgba(2,5,12,.76);
          backdrop-filter:blur(14px);
        }
        .reader-image-viewer{
          position:relative;width:min(86%,920px);height:min(72%,620px);display:flex;align-items:center;justify-content:center;
          border:1px solid rgba(238,248,255,.42);border-radius:9px;
          background:linear-gradient(145deg,rgba(8,13,23,.82),rgba(3,6,14,.72));
          box-shadow:0 0 0 1px rgba(255,255,255,.08),0 24px 80px rgba(0,0,0,.44),0 0 38px rgba(47,109,255,.24);
          overflow:hidden;
        }
        .reader-image-viewer img{
          max-width:100%;max-height:100%;width:auto;height:auto;object-fit:contain;
        }
        .reader-image-close,.reader-image-nav{
          position:absolute;z-index:2;border-radius:7px;border:1px solid rgba(238,248,255,.34);
          background:rgba(47,109,255,.12);color:#fff;cursor:pointer;
          box-shadow:0 0 14px rgba(47,109,255,.18);
        }
        .reader-image-close{top:12px;right:12px;width:30px;height:30px}
        .reader-image-nav{top:50%;width:34px;height:46px;transform:translateY(-50%);font-size:18px}
        .reader-image-prev{left:12px}
        .reader-image-next{right:12px}
        .reader-image-caption{
          position:absolute;left:50%;bottom:12px;transform:translateX(-50%);
          color:rgba(247,250,255,.76);font-family:'DM Mono',monospace;font-size:10px;
          padding:4px 9px;border-radius:999px;border:1px solid rgba(238,248,255,.20);
          background:rgba(5,9,19,.72);
        }
        .browser-island-card{
          flex:1 1 0;
          min-height:0;
          height:100%;
          max-height:100%;
          overflow:hidden;
          background:
            linear-gradient(145deg, rgba(7,13,27,.76), rgba(3,6,14,.66)),
            radial-gradient(circle at 78% 8%, rgba(47,109,255,.22), transparent 30%);
          backdrop-filter:none;
          -webkit-backdrop-filter:none;
          transform-style:flat;
          will-change:auto;
          contain:none;
          isolation:auto;
        }
        .browser-island-card.reader-card-settled{
          transform:none !important;
          animation:none !important;
        }
        .browser-island-card .reader-topbar{
          background:linear-gradient(90deg, rgba(11,19,40,.78), rgba(11,19,40,.58));
        }
        .browser-island-frame{
          position:relative;flex:1 1 0;height:0;min-height:0;margin:12px;border-radius:8px;
          overflow:hidden;background:#050913;border:1px solid rgba(238,248,255,.18);
          box-shadow:inset 0 0 0 1px rgba(47,109,255,.10),0 0 26px rgba(47,109,255,.12);
          transform:none;
          filter:none;
          contain:none;
        }
        .browser-island-frame-live{
          display:flex;align-items:center;justify-content:center;background:#000;overflow:hidden;
        }
        .browser-island-frame webview{
          border:0;background:#050913;transform:none;filter:none;contain:none;
          min-width:0;min-height:0;
        }
        .browser-island-webview{
          position:absolute !important;
          inset:0 !important;
          width:100% !important;
          height:100% !important;
          display:inline-flex !important;
        }
        .browser-island-frame-live webview{
          flex:0 0 auto;align-self:center;
        }
        .browser-island-live-native{
          width:100%;aspect-ratio:16/9;max-height:100%;background:#000;align-self:center;
        }
        .browser-island-live-pending{
          width:100%;aspect-ratio:16/9;max-height:100%;align-self:center;background:#000;
          display:grid;place-items:center;color:rgba(247,250,255,.62);font:10px "DM Mono",monospace;
        }
        .browser-island-live-pending .browser-island-pulse{margin-bottom:34px;}
        .browser-island-mute{
          position:absolute;right:10px;bottom:10px;z-index:4;width:32px;height:32px;
          border-radius:50%;border:1px solid rgba(238,248,255,.24);
          background:rgba(0,0,0,.58);color:#fff;cursor:pointer;
          display:flex;align-items:center;justify-content:center;padding:0;
          box-shadow:0 0 14px rgba(47,109,255,.18);
          backdrop-filter:blur(5px);
        }
        .browser-island-frame-shielded webview{
          opacity:0;
          pointer-events:none;
        }
        .browser-island-loading{
          position:absolute;inset:0;display:flex;align-items:center;justify-content:center;gap:10px;
          color:rgba(247,250,255,.74);font-size:11px;font-family:'DM Mono',monospace;
          background:linear-gradient(145deg,rgba(5,9,19,.86),rgba(5,9,19,.52));
          pointer-events:none;transition:opacity .22s;
        }
        .pressreader-gate{
          pointer-events:auto;
          background:
            radial-gradient(circle at 50% 0%, rgba(255,255,255,.10), transparent 34%),
            linear-gradient(145deg, rgba(24,26,29,.96), rgba(14,15,17,.92));
        }
        .pressreader-gate.is-setup{
          align-items:center;
          justify-content:center;
        }
        .pressreader-login-card{
          width:min(360px, calc(100% - 48px));
          border-radius:8px;
          border:1px solid rgba(238,248,255,.52);
          background:
            linear-gradient(145deg, rgba(26,28,32,.82), rgba(13,14,16,.74)),
            radial-gradient(circle at 82% 0%, rgba(255,255,255,.11), transparent 36%);
          box-shadow:
            0 0 0 1px rgba(255,255,255,.10),
            0 22px 58px rgba(0,0,0,.34),
            0 0 32px rgba(47,109,255,.10),
            inset 0 1px 0 rgba(255,255,255,.18);
          padding:18px;
          color:#fff;
          font-family:'DM Sans',system-ui,sans-serif;
        }
        .pressreader-login-kicker{
          color:#8db7ff;
          font-family:'DM Mono',monospace;
          font-size:9px;
          letter-spacing:.08em;
          text-transform:uppercase;
          margin-bottom:5px;
        }
        .pressreader-login-title{
          font-size:18px;
          line-height:1.1;
          margin-bottom:8px;
        }
        .pressreader-login-copy{
          font-size:11px;
          line-height:1.45;
          color:rgba(247,250,255,.66);
          margin-bottom:14px;
        }
        .pressreader-login-card label{
          display:block;
          color:rgba(247,250,255,.78);
          font-size:10px;
          margin-top:9px;
        }
        .pressreader-login-card label span{
          display:block;
          margin-bottom:5px;
        }
        .pressreader-login-card input{
          width:100%;
          height:32px;
          border-radius:6px;
          border:1px solid rgba(238,248,255,.28);
          background:rgba(17,18,20,.74);
          color:#fff;
          outline:none;
          padding:0 9px;
          box-shadow:inset 0 0 0 1px rgba(47,109,255,.08);
        }
        .pressreader-login-card input:focus{
          border-color:rgba(238,248,255,.76);
          box-shadow:0 0 18px rgba(47,109,255,.22), inset 0 0 0 1px rgba(47,109,255,.18);
        }
        .pressreader-login-actions{
          display:flex;
          justify-content:flex-end;
          gap:8px;
          margin-top:14px;
        }
        .pressreader-shelf-toggle.is-active{
          border-color:rgba(112,232,255,.62);
          background:rgba(47,109,255,.20);
          color:#eafcff;
        }
        .pressreader-shelf{
          position:absolute;
          inset:10px;
          z-index:6;
          display:grid;
          grid-template-columns:minmax(230px,300px) minmax(0,1fr);
          gap:10px;
          padding:10px;
          border-radius:8px;
          border:1px solid rgba(238,248,255,.28);
          background:
            linear-gradient(145deg,rgba(10,14,24,.88),rgba(7,9,15,.74)),
            radial-gradient(circle at 12% 0%,rgba(112,232,255,.16),transparent 28%);
          box-shadow:0 20px 70px rgba(0,0,0,.42),0 0 0 1px rgba(255,255,255,.06),inset 0 1px 0 rgba(255,255,255,.12);
          backdrop-filter:blur(16px);
          pointer-events:auto;
          overflow:hidden;
        }
        .pressreader-shelf-hero{
          min-width:0;
          display:flex;
          flex-direction:column;
          gap:10px;
          padding:10px;
          border-radius:7px;
          background:rgba(255,255,255,.045);
          border:1px solid rgba(238,248,255,.12);
        }
        .pressreader-shelf-titlebar{
          display:flex;
          justify-content:space-between;
          gap:10px;
          align-items:flex-start;
        }
        .pressreader-shelf-kicker{
          color:#8db7ff;
          font-family:'DM Mono',monospace;
          font-size:8px;
          text-transform:uppercase;
          letter-spacing:.08em;
        }
        .pressreader-shelf-title{
          color:#fff;
          font-size:17px;
          line-height:1.12;
          margin-top:3px;
        }
        .pressreader-shelf-actions,.pressreader-shelf-feature-actions{
          display:flex;
          gap:6px;
          align-items:center;
          flex-wrap:wrap;
          justify-content:flex-end;
        }
        .pressreader-shelf-feature{
          min-height:188px;
          display:grid;
          grid-template-columns:92px minmax(0,1fr);
          gap:11px;
          align-items:end;
        }
        .pressreader-shelf-feature img,.pressreader-shelf-placeholder{
          width:92px;
          height:138px;
          border-radius:5px;
          object-fit:cover;
          background:linear-gradient(145deg,rgba(47,109,255,.34),rgba(7,9,15,.86));
          border:1px solid rgba(238,248,255,.20);
          box-shadow:0 10px 28px rgba(0,0,0,.32);
        }
        .pressreader-shelf-placeholder{
          display:grid;
          place-items:center;
          color:#fff;
          font-size:34px;
          font-weight:800;
        }
        .pressreader-shelf-feature-copy{
          min-width:0;
          display:flex;
          flex-direction:column;
          gap:7px;
        }
        .pressreader-shelf-feature-title{
          color:#fff;
          font-size:15px;
          line-height:1.18;
          display:-webkit-box;
          -webkit-line-clamp:3;
          -webkit-box-orient:vertical;
          overflow:hidden;
        }
        .pressreader-shelf-feature-meta,.pressreader-shelf-status{
          color:rgba(247,250,255,.60);
          font-family:'DM Mono',monospace;
          font-size:9px;
          line-height:1.35;
        }
        .pressreader-shelf-search{
          height:32px;
          width:100%;
          border-radius:6px;
          border:1px solid rgba(238,248,255,.20);
          background:rgba(2,5,12,.52);
          color:#fff;
          padding:0 9px;
          outline:none;
          font-size:11px;
        }
        .pressreader-shelf-search:focus{
          border-color:rgba(112,232,255,.64);
          box-shadow:0 0 18px rgba(47,109,255,.22);
        }
        .pressreader-category-picks{
          display:flex;
          flex-wrap:wrap;
          gap:5px;
          max-height:72px;
          overflow:auto;
          padding:1px;
        }
        .pressreader-category-pick{
          min-width:0;
          display:flex;
          align-items:center;
          gap:4px;
          max-width:100%;
          border:1px solid rgba(238,248,255,.12);
          border-radius:999px;
          background:rgba(255,255,255,.035);
          color:rgba(247,250,255,.56);
          padding:3px 7px 3px 5px;
          cursor:pointer;
          font-size:8px;
          font-family:'DM Mono',monospace;
          text-transform:uppercase;
        }
        .pressreader-category-pick.is-on{
          color:#dffcff;
          border-color:rgba(112,232,255,.34);
          background:rgba(47,109,255,.12);
        }
        .pressreader-category-pick input{
          width:11px;
          height:11px;
          margin:0;
          accent-color:#70e8ff;
          flex:0 0 auto;
        }
        .pressreader-category-pick span{
          overflow:hidden;
          text-overflow:ellipsis;
          white-space:nowrap;
        }
        .pressreader-shelf-grid{
          min-width:0;
          overflow:auto;
          display:flex;
          flex-direction:column;
          gap:14px;
          padding:2px 2px 10px;
        }
        .pressreader-catalog-section{
          min-width:0;
          display:grid;
          gap:8px;
        }
        .pressreader-catalog-section-head{
          display:flex;
          align-items:center;
          justify-content:space-between;
          gap:10px;
          padding:0 4px;
          color:rgba(247,250,255,.90);
          font-size:13px;
          font-weight:700;
        }
        .pressreader-catalog-section-head small{
          color:rgba(247,250,255,.45);
          font:9px 'DM Mono',monospace;
        }
        .pressreader-catalog-row{
          min-width:0;
          display:grid;
          grid-template-columns:repeat(auto-fill,minmax(104px,1fr));
          gap:8px;
        }
        .pressreader-cover{
          min-width:0;
          display:grid;
          gap:6px;
          justify-items:center;
          align-content:start;
          border:1px solid rgba(238,248,255,.10);
          border-radius:7px;
          background:rgba(255,255,255,.035);
          color:#fff;
          padding:8px 7px;
          cursor:pointer;
          text-align:left;
          transition:transform .16s ease,border-color .16s ease,background .16s ease;
        }
        .pressreader-cover:hover{
          transform:translateY(-2px);
          border-color:rgba(112,232,255,.42);
          background:rgba(47,109,255,.12);
        }
        .pressreader-cover-art{
          width:72px;
          height:104px;
          display:grid;
          place-items:center;
          border-radius:4px;
          overflow:hidden;
          background:rgba(3,7,15,.82);
          border:1px solid rgba(238,248,255,.14);
          box-shadow:0 7px 18px rgba(0,0,0,.28);
        }
        .pressreader-cover-art img{
          width:100%;
          height:100%;
          object-fit:cover;
          display:block;
        }
        .pressreader-cover-art span{
          font-size:22px;
          font-weight:800;
        }
        .pressreader-cover-title{
          width:100%;
          color:rgba(247,250,255,.88);
          font-size:10px;
          line-height:1.18;
          display:-webkit-box;
          -webkit-line-clamp:2;
          -webkit-box-orient:vertical;
          overflow:hidden;
        }
        .pressreader-cover-meta{
          width:100%;
          color:rgba(247,250,255,.48);
          font-family:'DM Mono',monospace;
          font-size:8px;
          white-space:nowrap;
          overflow:hidden;
          text-overflow:ellipsis;
        }
        .pressreader-shelf-empty{
          min-height:220px;
          grid-column:1/-1;
          display:grid;
          place-items:center;
          align-content:center;
          gap:10px;
          color:rgba(247,250,255,.62);
          font:10px 'DM Mono',monospace;
          text-align:center;
        }
        .browser-island-pulse{
          width:10px;height:10px;border-radius:50%;background:#2f6dff;
          box-shadow:0 0 0 4px rgba(47,109,255,.12),0 0 18px rgba(47,109,255,.66);
          animation:browserPulse .9s ease-in-out infinite alternate;
        }
        @keyframes browserPulse{
          from{transform:scale(.72);opacity:.55}
          to{transform:scale(1.08);opacity:1}
        }
      `}</style>

      {/* ── Sliding wrapper ── */}
      <div className={`panel-wrap${visible?" open":""}`}
           style={{display:"flex",flexDirection:"row",height:"100vh",
                   width: browserPane.open ? browserPane.braveX : '100vw',
                   backdropFilter:webStageActive ? "none" : undefined,
                   WebkitBackdropFilter:webStageActive ? "none" : undefined}}>

        {/* ── Panel content ── */}
        <div ref={panelBgRef} className={`panel-surface${webStageActive ? ' web-stage' : ''}`} style={{
          flex:"0 0 auto",
          width: browserPane.open ? browserPane.braveX : '100vw',
          overflow:"hidden",
          display:"flex",flexDirection:"row",
          transition:"width 280ms cubic-bezier(0.32,0,0.16,1)"}}>

          <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>

            {/* ── Header ── */}
            <div style={{padding:"10px 20px 10px",display:"flex",justifyContent:"space-between",alignItems:"center",flexShrink:0}}>
              <div style={{fontSize:13,fontWeight:600,color:"#f2f2ff",letterSpacing:0.2,textTransform:"capitalize",display:"flex",alignItems:"baseline",gap:6}}>
                {time.toLocaleDateString("fr-CA",{weekday:"long"})}
              </div>
              <div style={{display:"flex",gap:5,alignItems:"center",marginTop:2}}>
                <button className="panel-chrome-button" onClick={(event)=>openWebCard({
                  url: PRESSREADER_URL,
                  title: 'PressReader',
                  source: 'PressReader',
                  partition: 'persist:pressreader',
                  flavor: 'pressreader',
                }, event)} title="PressReader">
                  <svg width="16" height="16" viewBox="0 0 32 32" style={{display:"block"}}>
                    <path d="M6,4 H26 A4,4 0 0 1 30,8 V20 A4,4 0 0 1 26,24 H22 L24,30 L16,24 H6 A4,4 0 0 1 2,20 V8 A4,4 0 0 1 6,4 Z" fill="rgba(31,111,255,0.72)"/>
                    <text x="16" y="15" fontSize="14" fontWeight="800" fill="#fff" textAnchor="middle"
                      fontFamily="'DM Sans',sans-serif" dominantBaseline="central">P</text>
                  </svg>
                </button>
                {loaded&&(
                  <div style={{display:'flex',gap:3,alignItems:'center',marginRight:2}}>
                    {[
                      ['base', 'B', 'Base mode'],
                      ['news', 'N', 'News mode'],
                      ['monitor', 'M', 'Monitor mode'],
                      ['live', 'L', 'Live mode'],
                    ].map(([mode, label, title]) => (
                      <button
                        key={mode}
                        className={`panel-chrome-button${panelMode === mode ? " is-active" : ""}`}
                        onClick={() => setWidgetPanelMode(mode)}
                        disabled={modeSwitching}
                        title={title}
                        style={{fontSize:10,fontFamily:'DM Mono,monospace',opacity:modeSwitching ? 0.54 : 1}}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                )}
                {loaded&&panelMode === 'base'&&(
                  <div style={{display:'flex',gap:3,alignItems:'center',marginRight:2}}>
                    <button
                      className="panel-chrome-button"
                      onClick={() => adjustBaseColumns(-1)}
                      title="Show fewer base columns"
                      disabled={modeSwitching || baseColumnCount <= 3}
                      style={{fontSize:12,fontFamily:'DM Mono,monospace',opacity:modeSwitching || baseColumnCount <= 3 ? 0.42 : 1}}
                    >
                      -
                    </button>
                    <span style={{minWidth:16,textAlign:'center',fontSize:9,color:'rgba(247,250,255,.72)',fontFamily:'DM Mono,monospace'}}>
                      {baseColumnCount}
                    </span>
                    <button
                      className="panel-chrome-button"
                      onClick={() => adjustBaseColumns(1)}
                      title="Show more base columns"
                      disabled={modeSwitching || baseColumnCount >= DEFAULT_BASE_COLUMN_COUNT}
                      style={{fontSize:12,fontFamily:'DM Mono,monospace',opacity:modeSwitching || baseColumnCount >= DEFAULT_BASE_COLUMN_COUNT ? 0.42 : 1}}
                    >
                      +
                    </button>
                  </div>
                )}
                <button className={`panel-chrome-button${pinned ? " is-active" : ""}`} onClick={togglePin} title={pinned?"Unpin":"Pin to desktop"} style={{fontSize:13}}>
                  📌
                </button>
                {loaded&&<button className="panel-chrome-button" onClick={()=>{setShowMgr(true);api.modal.open();}} title="Manage widgets" style={{fontSize:14}}>⚙</button>}
                <button className="panel-chrome-button" onClick={()=>{setShowSettings(true);api.modal.open();}} title="Settings" style={{fontSize:13}}>≡</button>
                {loaded&&<button className="panel-chrome-button" onClick={()=>setRefreshKey(k=>k+1)} title="Refresh data" style={{fontSize:13}}>↺</button>}
              </div>
            </div>

            {/* ── Body ── */}
            {!loaded && <OPMLDrop onLoaded={handleOPML} />}
            {loaded && (
              <div style={{flex:1,minWidth:0,overflowX:stageActive?"visible":"auto",overflowY:stageActive?"visible":"hidden",display:"flex"}}>

                {/* Column 1 */}
                <div style={{...columnFlexStyle("left"),overflowY:"auto",padding:"0px 6px 12px 10px",display:"flex",flexDirection:"column",gap:8}}
                  onDragOver={e=>{e.preventDefault();setDropTarget({col:"left",beforeId:null});}}
                  onDrop={e=>{e.preventDefault();if(dragId&&dropTarget)handleDrop(dragId,dropTarget.col,dropTarget.beforeId);}}>
                  {renderCol(leftIds, "left")}
                  {leftIds.length===0&&<div style={{textAlign:"center",color:"#d0d0e0",fontSize:10,marginTop:30,opacity:0.5}}>Empty</div>}
                </div>

                {/* Divider col 1 | col 2 */}
                <div className="col-divider" onMouseDown={onColDividerDown('left')} />

                {/* Column 2 - Workstation telemetry */}
                <div style={{...columnFlexStyle("monitor"),overflowY:"auto",padding:"0px 6px 12px 6px",display:"flex",flexDirection:"column",gap:8}}
                  onDragOver={e=>{e.preventDefault();setDropTarget({col:"monitor",beforeId:null});}}
                  onDrop={e=>{e.preventDefault();if(dragId&&dropTarget)handleDrop(dragId,dropTarget.col,dropTarget.beforeId);}}>
                  {renderCol(monitorIds, "monitor")}
                  {monitorIds.length===0&&<div style={{textAlign:"center",color:"#d0d0e0",fontSize:10,marginTop:30,opacity:0.5}}>Empty</div>}
                </div>

                {/* Divider col 2 | col 3 */}
                <div className="col-divider" onMouseDown={onColDividerDown('monitor')} />

                {/* Column 3 */}
                <div style={{...columnFlexStyle("mid"),overflowY:"auto",padding:"0px 6px 12px 6px",display:"flex",flexDirection:"column",gap:8}}
                  onDragOver={e=>{e.preventDefault();setDropTarget({col:"mid",beforeId:null});}}
                  onDrop={e=>{e.preventDefault();if(dragId&&dropTarget)handleDrop(dragId,dropTarget.col,dropTarget.beforeId);}}>
                  {renderCol(midIds, "mid")}
                  {midIds.length===0&&<div style={{textAlign:"center",color:"#d0d0e0",fontSize:10,marginTop:30,opacity:0.5}}>Empty</div>}
                </div>

                {/* Divider col 2 | col 3 (feed) */}
                {(stageActive || regularVisibleColumns.has('feed')) && (
                  <div className="col-divider" onMouseDown={stageActive ? undefined : onColDividerDown('mid')} />
                )}

                {/* Column 3 — Feeds */}
                {stageActive ? (
                  <div style={{flex:1,minWidth:0,minHeight:0,overflow:"visible",padding:"0px 10px 12px 6px",display:"flex"}}
                    onDragOver={e=>{e.preventDefault();setDropTarget({col:"feed",beforeId:null});}}
                    onDrop={e=>{e.preventDefault();if(dragId&&dropTarget)handleDrop(dragId,dropTarget.col,dropTarget.beforeId);}}>
                    {renderStageArea()}
                  </div>
                ) : (
                  <>
                    <div style={{...columnFlexStyle("feed"),overflowY:"auto",padding:"0px 6px 12px 6px",display:regularVisibleColumns.has('feed') ? "flex" : "none",flexDirection:"column",gap:8}}
                      onDragOver={e=>{e.preventDefault();setDropTarget({col:"feed",beforeId:null});}}
                      onDrop={e=>{e.preventDefault();if(dragId&&dropTarget)handleDrop(dragId,dropTarget.col,dropTarget.beforeId);}}>
                      {renderCol(feedIds, "feed")}
                      {feedIds.length===0&&<div style={{textAlign:"center",color:"#d0d0e0",fontSize:10,marginTop:30,opacity:0.5}}>Empty</div>}
                    </div>

                    <div className="col-divider" style={{display:regularVisibleColumns.has('feed') && regularVisibleColumns.has('right') ? undefined : 'none'}} onMouseDown={onColDividerDown('feed')} />
                    <div style={{...columnFlexStyle("right"),overflowY:"auto",padding:"0px 6px 12px 6px",display:regularVisibleColumns.has('right') ? "flex" : "none",flexDirection:"column",gap:8}}
                      onDragOver={e=>{e.preventDefault();setDropTarget({col:"right",beforeId:null});}}
                      onDrop={e=>{e.preventDefault();if(dragId&&dropTarget)handleDrop(dragId,dropTarget.col,dropTarget.beforeId);}}>
                      {renderCol(rightIds, "right")}
                      {rightIds.length===0&&<div style={{textAlign:"center",color:"#d0d0e0",fontSize:10,marginTop:30,opacity:0.5}}>Empty</div>}
                    </div>
                    <div className="col-divider" style={{display:regularVisibleColumns.has('right') && regularVisibleColumns.has('aux') ? undefined : 'none'}} onMouseDown={onColDividerDown('right')} />
                    <div style={{...columnFlexStyle("aux"),overflowY:"auto",padding:"0px 10px 12px 6px",display:regularVisibleColumns.has('aux') ? "flex" : "none",flexDirection:"column",gap:8}}
                      onDragOver={e=>{e.preventDefault();setDropTarget({col:"aux",beforeId:null});}}
                      onDrop={e=>{e.preventDefault();if(dragId&&dropTarget)handleDrop(dragId,dropTarget.col,dropTarget.beforeId);}}>
                      {renderCol(auxIds, "aux")}
                      {auxIds.length===0&&<div style={{textAlign:"center",color:"#d0d0e0",fontSize:10,marginTop:30,opacity:0.5}}>Empty</div>}
                    </div>
                  </>
                )}
              </div>
            )}

            {/* ── Footer ── */}
            {loaded&&(
              <div style={{padding:"8px 16px",borderTop:"1px solid rgba(255,255,255,0.04)",display:"flex",justifyContent:"space-between",alignItems:"center",flexShrink:0}}>
                <span style={{fontSize:9,color:"#c4c4d4",fontFamily:"DM Mono,monospace"}}>{categories.length} categories · OPML</span>
                <button onClick={()=>{setShowMgr(true);api.modal.open();}} style={{background:"none",border:"1px solid rgba(255,255,255,0.2)",color:"#e4e4f4",fontSize:10,padding:"3px 8px",borderRadius:5,cursor:"pointer"}}>+ Add widget</button>
              </div>
            )}
          </div>

          {/* Resize handle (panel width) */}
          <div className="resize-handle" onMouseDown={onResizeMouseDown} />
        </div>

      </div>

      {showMgr&&loaded&&<CategoryManager categories={categories} activeIds={activeIds} setActiveIds={setActiveIds} onClose={()=>{setShowMgr(false);api.modal.close();}} onReset={reset}/>}
      {showSettings&&<SettingsModal onClose={()=>{setShowSettings(false);api.modal.close();}}
        opacity={opacity} onOpacityChange={setOpacity}
        cardOpacity={cardOpacity} onCardOpacityChange={v=>{ setCardOpacity(v); document.documentElement.style.setProperty('--card-bg',`rgba(38,40,50,${v})`); }}
        pinnedOpacity={pinnedOpacity} onPinnedOpacityChange={setPinnedOpacity}
        newsCarouselEnabled={newsCarouselEnabled} onNewsCarouselEnabledChange={setNewsCarouselEnabled}
        newsCarouselIntervalMs={newsCarouselIntervalMs} onNewsCarouselIntervalMsChange={setNewsCarouselIntervalMs}
        location={location} onLocationChange={setLocation}
        apiKeys={apiKeys} onApiKeyChange={(service,key)=>saveKey(service,key)}/>}

      {/* ── Panel-color backdrop for the browser extension area ── */}
      {browserPane.open && (
        <div style={{
          position: 'fixed', left: browserPane.braveX, top: 0, right: 0, bottom: 0,
          background: `rgba(55,60,80,${pinned ? pinnedOpacity : opacity})`,
          zIndex: 9998, pointerEvents: 'none',
        }} />
      )}

      {/* ── Browser controls — two buttons painted on the panel backdrop ── */}
      {browserPane.open && (
        <div style={{
          position: 'fixed', top: 12, right: 20,
          display: 'flex', alignItems: 'center', gap: 4,
          zIndex: 9999, userSelect: 'none',
        }}>
          {browserPane.loading && (
            <div style={{width:12,height:12,border:'2px solid rgba(255,255,255,0.1)',borderTop:'2px solid #888',borderRadius:'50%',animation:'spin 0.7s linear infinite',marginRight:8}}/>
          )}
          <button
            onClick={() => window.electronAPI?.browser?.openExternal()}
            title="Open in Brave"
            style={{background:"none",border:"1px solid transparent",borderRadius:6,color:"#aaa",fontSize:14,cursor:"pointer",padding:"3px 6px",lineHeight:1,transition:"all 0.15s"}}
            onMouseEnter={e=>e.currentTarget.style.color='#dcdcec'} onMouseLeave={e=>e.currentTarget.style.color='#aaa'}>
            ↗
          </button>
          <button
            onClick={() => window.electronAPI?.browser?.close()}
            title="Dismiss"
            style={{background:"none",border:"1px solid transparent",borderRadius:6,color:"#aaa",fontSize:14,cursor:"pointer",padding:"3px 6px",lineHeight:1,transition:"all 0.15s"}}
            onMouseEnter={e=>e.currentTarget.style.color='#dcdcec'} onMouseLeave={e=>e.currentTarget.style.color='#aaa'}>
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
