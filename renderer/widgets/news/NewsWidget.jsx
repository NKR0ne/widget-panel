import { useEffect, useRef, useState } from 'react';
import DemoBadge from '../../ui/DemoBadge.jsx';
import Skel from '../../ui/Skel.jsx';
import { C } from '../../ui/theme.js';
import { fetchCategoryNews } from './news.service.js';
import { getNewsCategoryColor } from './news.theme.js';
import { publishStarvisContext } from '../../services/starvisContext.service.js';
import { api } from '../../services/electronApi.js';

const NEWS_REFRESH_MS = 30 * 60 * 1000;
const NEWS_LOAD_TIMEOUT_MS = 18000;
const NEWS_CAROUSEL_HEIGHT_MIN = 150;
const NEWS_CAROUSEL_HEIGHT_MAX = 420;
const NEWS_CAROUSEL_HEIGHT_DEFAULT = 210;
const NEWS_CAROUSEL_STAGGER_MS = 1000;
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

function newsHeightKey(category) {
  return `wp-news-card-height:${category.label || 'news'}`;
}

function clampNewsHeight(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return NEWS_CAROUSEL_HEIGHT_DEFAULT;
  return Math.max(NEWS_CAROUSEL_HEIGHT_MIN, Math.min(NEWS_CAROUSEL_HEIGHT_MAX, n));
}

export default function NewsWidget({ category, colorIdx, onUnreadChange, onOpenUrl, carouselEnabled = false, carouselIntervalMs = 20000 }) {
  const color = getNewsCategoryColor(category.label, colorIdx);
  const cacheKey = newsCacheKey(category);
  const cached = newsCache.get(cacheKey);
  const [items, setItems] = useState(() => cached?.items || []);
  const [demo, setDemo] = useState(() => cached?.demo || false);
  const [status, setStatus] = useState(() => cached?.items?.length ? 'ok' : 'loading');
  const [readIds, setReadIds] = useState(new Set());
  const [carouselIndex, setCarouselIndex] = useState(0);
  const [carouselHeight, setCarouselHeight] = useState(NEWS_CAROUSEL_HEIGHT_DEFAULT);
  const [flipDirection, setFlipDirection] = useState(1);
  const [lastUpdated, setLastUpdated] = useState(() => cached?.lastUpdated || null);
  const itemsRef = useRef(items);
  const demoRef = useRef(demo);
  const requestRef = useRef(0);
  const lastUnreadRef = useRef(null);
  const resizeRef = useRef(null);
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
    api.store.get(newsHeightKey(category)).then(value => {
      if (alive && value) setCarouselHeight(clampNewsHeight(value));
    });
    return () => { alive = false; };
  }, [category]);

  useEffect(() => {
    setCarouselIndex(index => Math.min(index, Math.max(0, items.length - 1)));
  }, [items.length]);

  useEffect(() => {
    if (!carouselEnabled || items.length < 2) return undefined;
    const delay = Math.max(20000, Number(carouselIntervalMs) || 20000);
    const stagger = Math.max(0, Number(colorIdx) || 0) * NEWS_CAROUSEL_STAGGER_MS;
    let interval = 0;
    const flipNext = () => {
      setFlipDirection(1);
      setCarouselIndex(index => (index + 1) % items.length);
    };
    const initial = setTimeout(() => {
      flipNext();
      interval = setInterval(flipNext, delay);
    }, delay + stagger);
    return () => {
      clearTimeout(initial);
      clearInterval(interval);
    };
  }, [carouselEnabled, carouselIntervalMs, colorIdx, items.length]);

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
  const activeItem = hasItems ? items[Math.min(carouselIndex, items.length - 1)] : null;

  function openItem(item, event) {
    if (!item) return;
    setReadIds((previous) => new Set([...previous, item.id]));
    if (item.link && item.link !== '#') onOpenUrl?.(item, event);
  }

  function rotateCarousel(delta) {
    if (items.length < 2) return;
    setFlipDirection(delta >= 0 ? 1 : -1);
    setCarouselIndex(index => (index + delta + items.length) % items.length);
  }

  function startResize(event) {
    event.preventDefault();
    event.stopPropagation();
    resizeRef.current = {
      y: event.clientY,
      height: carouselHeight,
    };
    const onMove = moveEvent => {
      if (!resizeRef.current) return;
      const next = clampNewsHeight(resizeRef.current.height + moveEvent.clientY - resizeRef.current.y);
      resizeRef.current.nextHeight = next;
      setCarouselHeight(next);
    };
    const onUp = () => {
      const next = clampNewsHeight(resizeRef.current?.nextHeight || carouselHeight);
      resizeRef.current = null;
      api.store.set(newsHeightKey(category), String(next));
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

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
        {hasItems && !carouselEnabled && (
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
                  openItem(item, event);
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
        {hasItems && carouselEnabled && activeItem && (
          <div
            style={{
              ...NEWS_LIST_SURFACE,
              minHeight: NEWS_CAROUSEL_HEIGHT_MIN,
              height: carouselHeight,
              cursor: 'pointer',
              perspective: 900,
            }}
            onClick={(event) => openItem(activeItem, event)}
          >
            <style>{`
              @keyframes wpNewsCarouselFlip {
                from { opacity: .38; transform: rotateY(var(--wp-news-flip-start, 72deg)) scale(.982); filter: blur(1px); }
                to { opacity: 1; transform: rotateY(0deg) scale(1); filter: none; }
              }
              .wp-news-carousel-nav {
                position:absolute;top:50%;z-index:3;width:28px;height:38px;
                transform:translateY(-50%);border-radius:7px;border:1px solid rgba(255,255,255,.28);
                background:rgba(2,7,16,.48);color:#fff;font-size:20px;line-height:1;
                display:flex;align-items:center;justify-content:center;cursor:pointer;
                box-shadow:0 8px 20px rgba(0,0,0,.22), inset 0 0 0 1px rgba(255,255,255,.05);
                backdrop-filter:blur(8px);transition:background .16s,border-color .16s,transform .16s;
              }
              .wp-news-carousel-nav:hover { background:rgba(31,111,255,.34);border-color:rgba(171,211,255,.54); }
            `}</style>
            <div
              key={`${activeItem.id}-${carouselIndex}`}
              style={{
                '--wp-news-flip-start': flipDirection >= 0 ? '76deg' : '-76deg',
                position: 'absolute',
                inset: 0,
                transformStyle: 'preserve-3d',
                animation: 'wpNewsCarouselFlip 520ms cubic-bezier(.18,.82,.24,1) both',
              }}
            >
              {activeItem.image && (
                <img
                  src={activeItem.image}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  style={{
                  position: 'absolute',
                  inset: 0,
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  opacity: readIds.has(activeItem.id) ? 0.42 : 0.72,
                  filter: 'saturate(0.9) brightness(0.68) contrast(1.08)',
                  zIndex: -2,
                  }}
                  onError={(event) => { event.currentTarget.style.display = 'none'; }}
                />
              )}
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  background: activeItem.image
                    ? 'linear-gradient(180deg, rgba(3,7,16,0.18), rgba(3,7,16,0.72) 60%, rgba(3,7,16,0.92))'
                    : 'linear-gradient(145deg, rgba(8,18,34,0.95), rgba(5,9,18,0.88))',
                  zIndex: -1,
                }}
              />
              {demo && <DemoBadge />}
              <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: '100%', padding: '12px 42px 15px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, gap: 8 }}>
                  <span style={{ fontSize: 10, color: '#dcdcec', fontFamily: 'DM Mono,monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {activeItem.source}
                  </span>
                  <span style={{ fontSize: 10, color: '#dcdcec', fontFamily: 'DM Mono,monospace', flexShrink: 0 }}>
                    {activeItem.time}
                  </span>
                </div>
                <div style={{ fontSize: 14, lineHeight: 1.32, color: '#fff', fontWeight: 600, textShadow: '0 1px 12px rgba(0,0,0,0.62)' }}>
                  {activeItem.title}
                </div>
                {activeItem.description && (
                  <div style={{ marginTop: 7, fontSize: 11, lineHeight: 1.35, color: 'rgba(245,248,255,0.82)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                    {activeItem.description}
                  </div>
                )}
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 10 }}>
                  {items.map((item, index) => (
                    <button
                      key={item.id}
                      type="button"
                      title={`Show article ${index + 1}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        setFlipDirection(index >= carouselIndex ? 1 : -1);
                        setCarouselIndex(index);
                      }}
                      style={{
                        width: index === carouselIndex ? 15 : 5,
                        height: 5,
                        borderRadius: 3,
                        border: 'none',
                        padding: 0,
                        background: index === carouselIndex ? color : 'rgba(255,255,255,0.36)',
                        cursor: 'pointer',
                        transition: 'width 0.18s ease, background 0.18s ease',
                      }}
                    />
                  ))}
                </div>
              </div>
            </div>
            {items.length > 1 && (
              <>
                <button
                  className="wp-news-carousel-nav"
                  type="button"
                  title="Previous article"
                  onClick={(event) => {
                    event.stopPropagation();
                    rotateCarousel(-1);
                  }}
                  style={{ left: 8 }}
                >
                  &lsaquo;
                </button>
                <button
                  className="wp-news-carousel-nav"
                  type="button"
                  title="Next article"
                  onClick={(event) => {
                    event.stopPropagation();
                    rotateCarousel(1);
                  }}
                  style={{ right: 8 }}
                >
                  &rsaquo;
                </button>
              </>
            )}
            <div
              onMouseDown={startResize}
              title="Resize news card"
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                bottom: 0,
                height: 10,
                cursor: 'ns-resize',
                background: 'linear-gradient(180deg, transparent, rgba(255,255,255,0.10))',
              }}
            />
          </div>
        )}
      </div>
    ),
  };
}
