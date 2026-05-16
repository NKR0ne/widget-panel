import { useEffect, useState } from 'react';
import AnimatedWidgetBody from './AnimatedWidgetBody.jsx';
import { C } from './theme.js';

export default function WidgetShell({
  color,
  title,
  sub,
  badge,
  expanded,
  onToggle,
  isDragging,
  onDragStart,
  onDragEnd,
  lastUpdated,
  transparent,
  children,
}) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);

  const ageLabel = (() => {
    if (!lastUpdated) return null;
    const mins = Math.floor((now - lastUpdated) / 60000);
    if (mins < 1) return '<1m';
    if (mins < 60) return `${mins}m`;
    return `${Math.floor(mins / 60)}h`;
  })();

  return (
    <div style={{
      ...C.card,
      ...(transparent ? { background: 'transparent', border: '1px solid rgba(255,255,255,0.08)' } : {}),
      opacity: isDragging ? 0.35 : 1,
      transition: 'opacity 0.1s',
    }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '10px 14px',
          cursor: 'pointer',
          userSelect: 'none',
        }}
        onClick={onToggle}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <span
            draggable
            onDragStart={e => { e.stopPropagation(); onDragStart?.(); }}
            onDragEnd={() => onDragEnd?.()}
            onClick={e => e.stopPropagation()}
            title="Drag to reorder"
            style={{
              color: '#c4c4d4',
              fontSize: 11,
              cursor: 'grab',
              userSelect: 'none',
              flexShrink: 0,
              lineHeight: 1,
              padding: '0 4px 0 0',
            }}
          >
            &#10303;
          </span>
          <span style={{ ...C.dot, background: color }} />
          <span style={C.title}>{title}</span>
          {sub && <span style={{ fontSize: 10, color: '#c4c4d4', fontFamily: 'DM Mono,monospace' }}>{sub}</span>}
          {badge}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }} onClick={e => e.stopPropagation()}>
          {ageLabel && <span style={{ fontSize: 9, color: '#2a2a38', fontFamily: 'DM Mono,monospace' }}>{ageLabel}</span>}
          <span style={{ ...C.chev, transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)' }} onClick={onToggle}>
            &rsaquo;
          </span>
        </div>
      </div>
      <AnimatedWidgetBody expanded={expanded}>
        <div style={{ padding: '0 14px 12px' }}>{children}</div>
      </AnimatedWidgetBody>
    </div>
  );
}
