import { useEffect, useState } from 'react';
import DemoBadge from '../../ui/DemoBadge.jsx';
import Skel from '../../ui/Skel.jsx';
import { C } from '../../ui/theme.js';
import { fetchCategoryNews } from './news.service.js';
import { getNewsCategoryColor } from './news.theme.js';

const NEWS_REFRESH_MS = 30 * 60 * 1000;

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
      setStatus('loading');
      fetchCategoryNews(category).then(({ items: nextItems, demo: isDemo }) => {
        if (!alive) return;
        setItems(nextItems);
        setDemo(isDemo);
        setStatus('ok');
        setLastUpdated(Date.now());
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
    : (status === 'ok' && unread > 0 && !demo)
      ? <span style={{ ...C.badge, background: color + '22', color }}>{unread}</span>
      : null;

  return {
    color,
    title: category.label,
    lastUpdated,
    badge: badgeEl,
    content: (
      <div>
        {status === 'loading' && <Skel />}
        {status === 'ok' && (
          <div>
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
                onClick={() => {
                  setReadIds((previous) => new Set([...previous, item.id]));
                  if (item.link && item.link !== '#') onOpenUrl?.(item.link);
                }}
              >
                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                  {item.image && (
                    <img
                      src={item.image}
                      loading="lazy"
                      alt=""
                      style={{
                        width: 44,
                        height: 44,
                        borderRadius: 6,
                        objectFit: 'cover',
                        flexShrink: 0,
                        background: 'rgba(255,255,255,0.05)',
                      }}
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
