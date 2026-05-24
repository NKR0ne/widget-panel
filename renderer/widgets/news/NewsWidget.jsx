import { useEffect, useState } from 'react';
import DemoBadge from '../../ui/DemoBadge.jsx';
import Skel from '../../ui/Skel.jsx';
import { C } from '../../ui/theme.js';
import { fetchCategoryNews } from './news.service.js';
import { getNewsCategoryColor } from './news.theme.js';

const NEWS_REFRESH_MS = 30 * 60 * 1000;
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
  const [items, setItems] = useState([]);
  const [demo, setDemo] = useState(false);
  const [status, setStatus] = useState('loading');
  const [readIds, setReadIds] = useState(new Set());
  const [lastUpdated, setLastUpdated] = useState(null);
  const unread = items.filter((item) => !readIds.has(item.id)).length;

  useEffect(() => { onUnreadChange?.(unread); }, [onUnreadChange, unread]);

  useEffect(() => {
    let alive = true;

    const load = () => {
      setStatus(previous => (previous === 'ok' || previous === 'refreshing') ? 'refreshing' : 'loading');
      fetchCategoryNews(category).then(({ items: nextItems, demo: isDemo }) => {
        if (!alive) return;
        setItems(nextItems);
        setDemo(isDemo);
        setStatus('ok');
        setLastUpdated(Date.now());
      }).catch(() => {
        if (!alive) return;
        setStatus(previous => previous === 'refreshing' ? 'ok' : 'error');
      });
    };

    load();
    const timer = setInterval(load, NEWS_REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [category]);

  const badgeEl = status === 'loading'
    ? <span style={{ fontSize: 10, color: '#c4c4d4' }}>fetching...</span>
    : status === 'refreshing'
      ? <span style={{ fontSize: 10, color: '#c4c4d4' }}>sync...</span>
    : (status === 'ok' && unread > 0 && !demo)
      ? <span style={{ ...C.badge, background: color + '22', color }}>{unread}</span>
      : null;
  const hasItems = items.length > 0;

  return {
    color,
    title: category.label,
    lastUpdated,
    badge: badgeEl,
    shellProps: { stableBackground: true, disableBackdrop: true },
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
