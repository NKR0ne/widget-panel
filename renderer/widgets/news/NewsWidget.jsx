import { useEffect, useRef, useState } from 'react';
import DemoBadge from '../../ui/DemoBadge.jsx';
import Skel from '../../ui/Skel.jsx';
import { C } from '../../ui/theme.js';
import { fetchCategoryNews } from './news.service.js';
import { getNewsCategoryColor } from './news.theme.js';
import { publishStarvisContext } from '../../services/starvisContext.service.js';

const NEWS_REFRESH_MS = 30 * 60 * 1000;
const NEWS_LOAD_TIMEOUT_MS = 18000;
const newsCache = new Map();

function newsCacheKey(category) {
  const feeds = (category.feeds || []).map((feed) => feed.url).join('|');
  return `${category.label}::${feeds}`;
}

function withRefreshTimeout(promise) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('News refresh timed out')), NEWS_LOAD_TIMEOUT_MS);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

const NEWS_LIST_SURFACE = {
  position: 'relative',
  isolation: 'isolate',
  contain: 'paint',
  overflow: 'hidden',
  borderRadius: 6,
  background: 'linear-gradient(180deg, rgba(5,10,22,0.20), rgba(5,8,18,0.14))',
  boxShadow: 'inset 0 0 0 1px rgba(205,230,255,0.045)',
  transform: 'translateZ(0)',
};

function newsTheme(title = '') {
  const text = title.toLowerCase();
  if (/ai|artificial intelligence|openai|anthropic|model|chip|nvidia|semiconductor/.test(text)) return 'AI and chips';
  if (/market|stock|fed|rate|inflation|bond|earnings|ipo|bank|dollar|oil/.test(text)) return 'Markets and economy';
  if (/trump|biden|election|minister|government|policy|court|congress|senate|war|china|russia|ukraine|israel/.test(text)) return 'Politics and geopolitics';
  if (/security|hack|breach|privacy|malware|ransomware|cyber/.test(text)) return 'Security';
  if (/health|drug|medical|hospital|disease|climate|weather|storm|fire/.test(text)) return 'Health and environment';
  return 'General';
}

function summarizeThemes(items = []) {
  const counts = new Map();
  items.forEach(item => counts.set(newsTheme(item.title), (counts.get(newsTheme(item.title)) || 0) + 1));
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([theme, count]) => `${theme} (${count})`);
}

const NEWS_THUMB_STYLE = {
  width: 44,
  height: 44,
  borderRadius: 6,
  objectFit: 'cover',
  flexShrink: 0,
  background: 'rgba(6,12,24,0.72)',
  opacity: 0.86,
  filter: 'saturate(0.86) brightness(0.82) contrast(1.04)',
  boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.05)',
};

export default function NewsWidget({ category, colorIdx, onUnreadChange, onOpenUrl }) {
  const color = getNewsCategoryColor(category.label, colorIdx);
  const cacheKey = newsCacheKey(category);
  const cached = newsCache.get(cacheKey);
  const [items, setItems] = useState(() => cached?.items || []);
  const [demo, setDemo] = useState(() => cached?.demo || false);
  const [status, setStatus] = useState(() => cached?.items?.length ? 'ok' : 'loading');
  const [readIds, setReadIds] = useState(new Set());
  const [lastUpdated, setLastUpdated] = useState(() => cached?.lastUpdated || null);
  const itemsRef = useRef(items);
  const demoRef = useRef(demo);
  const requestRef = useRef(0);
  const lastUnreadRef = useRef(null);
  const unread = items.filter((item) => !readIds.has(item.id)).length;

  useEffect(() => {
    if (lastUnreadRef.current === unread) return;
    lastUnreadRef.current = unread;
    onUnreadChange?.(unread);
  }, [onUnreadChange, unread]);

  useEffect(() => { itemsRef.current = items; }, [items]);
  useEffect(() => { demoRef.current = demo; }, [demo]);

  useEffect(() => {
    let alive = true;
    const cachedResult = newsCache.get(cacheKey);

    if (cachedResult?.items?.length) {
      itemsRef.current = cachedResult.items;
      demoRef.current = cachedResult.demo;
      setItems(cachedResult.items);
      setDemo(cachedResult.demo);
      setLastUpdated(cachedResult.lastUpdated || null);
      setStatus('ok');
    }

    const load = () => {
      const requestId = requestRef.current + 1;
      requestRef.current = requestId;
      setStatus(previous => (previous === 'ok' || previous === 'refreshing' || itemsRef.current.length > 0) ? 'refreshing' : 'loading');
      withRefreshTimeout(fetchCategoryNews(category)).then(({ items: nextItems, demo: isDemo }) => {
        if (!alive) return;
        if (requestRef.current !== requestId) return;
        const cleanItems = Array.isArray(nextItems) ? nextItems.filter(Boolean) : [];
        if (!cleanItems.length) throw new Error('No news items returned');
        if (isDemo && itemsRef.current.length > 0 && !demoRef.current) {
          setStatus('ok');
          return;
        }
        const updatedAt = Date.now();
        newsCache.set(cacheKey, { items: cleanItems, demo: !!isDemo, lastUpdated: updatedAt });
        itemsRef.current = cleanItems;
        demoRef.current = !!isDemo;
        setItems(cleanItems);
        setDemo(!!isDemo);
        setStatus('ok');
        setLastUpdated(updatedAt);
      }).catch(() => {
        if (!alive) return;
        if (requestRef.current !== requestId) return;
        setStatus(itemsRef.current.length > 0 ? 'ok' : 'error');
      });
    };

    load();
    const timer = setInterval(load, NEWS_REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [category, cacheKey]);

  const badgeEl = status === 'loading'
    ? <span style={{ fontSize: 10, color: '#c4c4d4' }}>fetching...</span>
    : status === 'refreshing'
      ? <span style={{ fontSize: 10, color: '#c4c4d4' }}>sync...</span>
    : (status === 'ok' && unread > 0 && !demo)
      ? <span style={{ ...C.badge, background: color + '22', color }}>{unread}</span>
      : null;
  const hasItems = items.length > 0;

  useEffect(() => {
    if (!hasItems) return;
    const themes = summarizeThemes(items);
    publishStarvisContext(`news:${category.label}`, {
      title: `News: ${category.label}`,
      summary: `${category.label}: ${unread} unread. Themes: ${themes.join(', ') || 'General'}.`,
      data: {
        category: category.label,
        unread,
        demo,
        themes,
        topItems: items.slice(0, 8).map(item => ({
          title: item.title,
          source: item.source,
          time: item.time,
          link: item.link,
        })),
      },
    });
  }, [category.label, demo, hasItems, items, unread]);

  return {
    color,
    title: category.label,
    lastUpdated,
    badge: badgeEl,
    shellProps: { stableBackground: true },
    content: (
      <div>
        {status === 'loading' && !hasItems && <Skel />}
        {status === 'error' && !hasItems && <div style={{ color: '#777', fontSize: 11, padding: '8px 0' }}>Feed unavailable</div>}
        {hasItems && (
          <div style={NEWS_LIST_SURFACE}>
            {demo && <DemoBadge />}
            {items.map((item, index) => (
              <div
                key={item.id}
                style={{
                  padding: '8px 0',
                  cursor: 'pointer',
                  opacity: readIds.has(item.id) ? 0.35 : 1,
                  borderTop: index > 0 ? '1px solid rgba(255,255,255,0.04)' : 'none',
                }}
                onClick={(event) => {
                  setReadIds((previous) => new Set([...previous, item.id]));
                  if (item.link && item.link !== '#') onOpenUrl?.(item, event);
                }}
              >
                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                  {item.image && (
                    <img
                      src={item.image}
                      loading="lazy"
                      decoding="async"
                      alt=""
                      style={NEWS_THUMB_STYLE}
                      onError={(event) => { event.target.style.display = 'none'; }}
                    />
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, color: '#d8d8e8', lineHeight: 1.45, marginBottom: 4 }}>
                      {item.title}
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: 10, color: '#666' }}>{item.source}</span>
                      <span style={{ fontSize: 10, color: '#dcdcec', fontFamily: 'DM Mono,monospace' }}>
                        {item.time}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    ),
  };
}
