import { useEffect, useId, useState } from 'react';
import AnimatedWidgetBody from './AnimatedWidgetBody.jsx';
import { playHoverFocusSound } from '../services/sound.service.js';
import { C } from './theme.js';

export default function AcrylicWidgetShell({
  color,
  title,
  sub,
  badge,
  rightBadge,
  expanded,
  onToggle,
  isDragging,
  onDragStart,
  onDragEnd,
  lastUpdated,
  softText = false,
  stableBackground = false,
  disableBackdrop = false,
  children,
}) {
  const [now, setNow] = useState(Date.now());
  const [hoverFocused, setHoverFocused] = useState(false);
  const shellId = useId().replace(/:/g, '');
  const accent = '#1f6fff';
  const glow = color || accent;

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

  const activateHoverFocus = () => {
    setHoverFocused(true);
    playHoverFocusSound();
  };

  const handleKeyDown = (event) => {
    if (event.currentTarget !== event.target) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onToggle?.();
    }
  };

  return (
    <div
      className={`wp-acrylic-shell wp-acrylic-${shellId}`}
      tabIndex={0}
      onMouseEnter={activateHoverFocus}
      onMouseLeave={() => setHoverFocused(false)}
      onFocus={(event) => {
        if (event.currentTarget === event.target) activateHoverFocus();
        else setHoverFocused(true);
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setHoverFocused(false);
      }}
      onKeyDown={handleKeyDown}
      style={{
        position: 'relative',
        isolation: 'isolate',
        contain: 'paint',
        overflow: 'hidden',
        borderRadius: 8,
        border: hoverFocused ? '1px solid rgba(171,211,255,0.84)' : '1px solid rgba(122,178,255,0.48)',
        background: [
          'radial-gradient(circle at 16% 0%, rgba(47,109,255,0.13), transparent 30%)',
          'radial-gradient(circle at 88% 6%, rgba(122,178,255,0.09), transparent 28%)',
          'linear-gradient(145deg, var(--acrylic-card-top, rgba(10,18,34,0.34)), var(--acrylic-card-bottom, rgba(8,10,18,0.22)))',
          stableBackground
            ? 'var(--acrylic-card-fill, rgba(8,14,28,0.20))'
            : 'var(--acrylic-card-fill-soft, rgba(8,14,28,0.14))',
        ].join(','),
        backgroundColor: stableBackground
          ? 'var(--acrylic-card-fill, rgba(8,14,28,0.20))'
          : 'var(--acrylic-card-fill-soft, rgba(8,14,28,0.14))',
        boxShadow: (hoverFocused ? [
          '0 0 0 1px rgba(171,211,255,0.18)',
          `0 0 18px ${glow}`,
          '0 0 36px rgba(31,111,255,0.34)',
          '0 0 62px rgba(47,109,255,0.16)',
          'inset 0 0 0 1px rgba(171,211,255,0.20)',
          'inset 0 18px 38px rgba(122,178,255,0.055)',
        ] : [
          '0 0 0 1px rgba(122,178,255,0.12)',
          '0 0 16px rgba(31,111,255,0.28)',
          '0 0 30px rgba(47,109,255,0.10)',
          'inset 0 0 0 1px rgba(171,211,255,0.11)',
          'inset 0 16px 34px rgba(122,178,255,0.035)',
        ]).join(','),
        backdropFilter: disableBackdrop ? 'none' : 'blur(18px) saturate(150%)',
        WebkitBackdropFilter: disableBackdrop ? 'none' : 'blur(18px) saturate(150%)',
        opacity: isDragging ? 0.35 : 1,
        outline: 'none',
        transition: 'opacity 0.1s, border-color 0.18s, box-shadow 0.18s, transform 0.18s',
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
          top: 0,
          left: 0,
          right: 0,
          height: 58,
          pointerEvents: 'none',
          background: [
            'radial-gradient(ellipse at 16% 0%, rgba(47,109,255,0.24), transparent 42%)',
            'radial-gradient(ellipse at 84% 0%, rgba(122,178,255,0.16), transparent 42%)',
            'linear-gradient(180deg, rgba(47,109,255,0.10), transparent 64%)',
          ].join(','),
          opacity: hoverFocused ? 0.78 : 0.58,
          borderRadius: '8px 8px 0 0',
          transition: 'opacity 0.18s',
        }}
      />
      <div
        style={{
          height: 1,
          margin: '0 18px',
          background: `linear-gradient(90deg, transparent, rgba(47,109,255,0.76), rgba(171,211,255,0.86), rgba(47,109,255,0.76), transparent)`,
          boxShadow: `0 0 12px rgba(31,111,255,0.58), 0 0 24px rgba(47,109,255,0.24)`,
          opacity: hoverFocused ? 0.9 : 0.68,
          transition: 'opacity 0.18s',
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: '1 1 auto' }}>
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
              boxShadow: `0 0 10px ${color || accent}, 0 0 20px rgba(31,111,255,0.42)`,
            }}
          />
          <span
            style={{
              ...C.title,
              color: '#fff',
              fontSize: 10,
              fontWeight: softText ? 400 : C.title.fontWeight,
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
          {rightBadge}
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
      <AnimatedWidgetBody expanded={expanded} className="wp-acrylic-body" fade={false} style={{ position: 'relative' }}>
        <div style={{ padding: '0 14px 12px' }}>
          {children}
        </div>
      </AnimatedWidgetBody>
    </div>
  );
}
