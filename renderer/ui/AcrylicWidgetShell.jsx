import { useEffect, useId, useState } from 'react';
import AnimatedWidgetBody from './AnimatedWidgetBody.jsx';
import { C } from './theme.js';

export default function AcrylicWidgetShell({
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
  children,
}) {
  const [now, setNow] = useState(Date.now());
  const shellId = useId().replace(/:/g, '');
  const accent = '#1f6fff';

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
    <div
      className={`wp-acrylic-shell wp-acrylic-${shellId}`}
      style={{
        position: 'relative',
        overflow: 'hidden',
        borderRadius: 8,
        border: '1px solid rgba(244,250,255,0.54)',
        background: 'linear-gradient(145deg, var(--acrylic-card-top, rgba(10,18,34,0.46)), var(--acrylic-card-bottom, rgba(8,10,18,0.34)))',
        boxShadow: [
          '0 0 0 1px rgba(255,255,255,0.10)',
          '0 0 14px rgba(31,111,255,0.20)',
          'inset 0 0 0 1px rgba(255,255,255,0.10)',
          'inset 0 16px 36px rgba(255,255,255,0.028)',
        ].join(','),
        backdropFilter: 'blur(18px) saturate(150%)',
        WebkitBackdropFilter: 'blur(18px) saturate(150%)',
        opacity: isDragging ? 0.35 : 1,
        transition: 'opacity 0.1s, border-color 0.18s, box-shadow 0.18s',
      }}
    >
      <style>{`
        .wp-acrylic-${shellId} .wp-acrylic-body :where(div,span,button,input,select,label) {
          color: rgba(255,255,255,0.96) !important;
        }
        .wp-acrylic-${shellId} .wp-acrylic-body button,
        .wp-acrylic-${shellId} .wp-acrylic-body select,
        .wp-acrylic-${shellId} .wp-acrylic-body input {
          border-color: rgba(205,230,255,0.34) !important;
        }
        .wp-acrylic-${shellId} .wp-acrylic-body button {
          background: rgba(31,111,255,0.10) !important;
        }
      `}</style>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          background: [
            'linear-gradient(90deg, rgba(255,255,255,0.14), transparent 24%, transparent 78%, rgba(255,255,255,0.08))',
            'linear-gradient(180deg, rgba(31,111,255,0.12), transparent 24%)',
          ].join(','),
          opacity: 0.48,
        }}
      />
      <div
        style={{
          height: 1,
          margin: '0 18px',
          background: `linear-gradient(90deg, transparent, rgba(31,111,255,0.62), rgba(255,255,255,0.82), rgba(31,111,255,0.62), transparent)`,
          boxShadow: `0 0 10px rgba(31,111,255,0.42)`,
          opacity: 0.52,
        }}
      />
      <div
        style={{
          position: 'relative',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '10px 14px 9px',
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
              color: 'rgba(255,255,255,0.82)',
              fontSize: 11,
              cursor: 'grab',
              userSelect: 'none',
              flexShrink: 0,
              lineHeight: 1,
              padding: '0 4px 0 0',
              textShadow: '0 0 8px rgba(31,111,255,0.48)',
            }}
          >
            &#10303;
          </span>
          <span
            style={{
              ...C.dot,
              background: color || accent,
              boxShadow: `0 0 10px ${color || accent}`,
            }}
          />
          <span
            style={{
              ...C.title,
              color: '#fff',
              fontSize: 10,
              letterSpacing: 1.15,
              textShadow: '0 0 8px rgba(31,111,255,0.42)',
            }}
          >
            {title}
          </span>
          {sub && (
            <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.78)', fontFamily: 'DM Mono,monospace' }}>
              {sub}
            </span>
          )}
          {badge}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }} onClick={e => e.stopPropagation()}>
          {ageLabel && <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.7)', fontFamily: 'DM Mono,monospace' }}>{ageLabel}</span>}
          <span
            style={{
              ...C.chev,
              color: '#fff',
              textShadow: '0 0 8px rgba(31,111,255,0.46)',
              transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
            }}
            onClick={onToggle}
          >
            &rsaquo;
          </span>
        </div>
      </div>
      <AnimatedWidgetBody expanded={expanded} className="wp-acrylic-body" style={{ position: 'relative' }}>
        <div style={{ padding: '0 14px 12px' }}>
          {children}
        </div>
      </AnimatedWidgetBody>
    </div>
  );
}
