import AcrylicWidgetShell from './AcrylicWidgetShell.jsx';
import WidgetShell from './WidgetShell.jsx';

const SHELLS = {
  classic: WidgetShell,
  acrylic: AcrylicWidgetShell,
};

export default function WidgetFrame({ data: descriptor, expanded, onToggle, isDragging, onDragStart, onDragEnd }) {
  if (!descriptor) return null;

  const Shell = SHELLS[descriptor.shell] || SHELLS.acrylic;
  const shellProps = descriptor.shellProps || {};
  return (
    <Shell
      {...shellProps}
      color={descriptor.color}
      title={descriptor.title}
      sub={descriptor.sub}
      badge={descriptor.badge}
      lastUpdated={descriptor.lastUpdated}
      transparent={descriptor.transparent}
      expanded={expanded}
      onToggle={onToggle}
      isDragging={isDragging}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      {descriptor.content}
    </Shell>
  );
}
