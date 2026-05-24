import { useEffect, useState } from 'react';

export default function AnimatedWidgetBody({
  expanded,
  className,
  style,
  children,
  transitionMs = 230,
  fade = true,
}) {
  const [present, setPresent] = useState(expanded);
  const [open, setOpen] = useState(expanded);

  useEffect(() => {
    let frame = 0;
    let timeout = 0;

    if (expanded) {
      setPresent(true);
      frame = requestAnimationFrame(() => setOpen(true));
    } else {
      setOpen(false);
      timeout = window.setTimeout(() => setPresent(false), transitionMs);
    }

    return () => {
      if (frame) cancelAnimationFrame(frame);
      if (timeout) window.clearTimeout(timeout);
    };
  }, [expanded, transitionMs]);

  if (!present) return null;

  return (
    <div
      className={className}
      style={{
        display: 'grid',
        gridTemplateRows: open ? '1fr' : '0fr',
        opacity: fade ? (open ? 1 : 0) : 1,
        transform: open ? 'translateY(0)' : 'translateY(-4px)',
        transition: [
          `grid-template-rows ${transitionMs}ms cubic-bezier(0.22, 1, 0.36, 1)`,
          fade ? `opacity ${Math.max(120, transitionMs - 60)}ms ease` : '',
          `transform ${transitionMs}ms cubic-bezier(0.22, 1, 0.36, 1)`,
        ].filter(Boolean).join(','),
        willChange: fade ? 'grid-template-rows, opacity, transform' : 'grid-template-rows, transform',
        ...style,
      }}
    >
      <div style={{ minHeight: 0, overflow: 'hidden' }}>
        {children}
      </div>
    </div>
  );
}
