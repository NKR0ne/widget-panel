import { useEffect, useMemo, useState } from 'react';
import { subscribeWorkstationTelemetry } from './workstation.service.js';

const BLUE = '#2f6dff';
const SOFT_BLUE = 'rgba(47,109,255,0.78)';
const BLUE_FILL = 'rgba(47,109,255,0.22)';
const GREEN = 'rgba(95,255,190,0.72)';
const GOLD = 'rgba(255,187,55,0.72)';
const VIOLET = 'rgba(194,106,255,0.72)';
const TEXT = '#f7faff';
const MUTED = 'rgba(247,250,255,0.66)';
const FAINT = 'rgba(247,250,255,0.12)';
const GRAPH_TIME_SECTIONS = 3;
const GRAPH_VALUE_SECTIONS = 10;
const TIME_GRID_RATIOS = Array.from({ length: GRAPH_TIME_SECTIONS + 1 }, (_, index) => index / GRAPH_TIME_SECTIONS);
const VALUE_GRID_RATIOS = Array.from({ length: GRAPH_VALUE_SECTIONS + 1 }, (_, index) => index / GRAPH_VALUE_SECTIONS);
const RANGE_BLUE = [0, 140, 255];
const RANGE_YELLOW = [255, 220, 0];
const RANGE_ORANGE = [255, 140, 40];
const RANGE_RED = [255, 40, 40];
const TEMP_GRADIENT = 'linear-gradient(180deg, rgba(255,40,40,0.88) 0%, rgba(255,140,40,0.86) 25%, rgba(255,220,0,0.82) 50%, rgba(0,140,255,0.78) 100%)';

function clampUnit(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function mixChannel(a, b, t) {
  return Math.round(a + (b - a) * clampUnit(t));
}

function mixRgb(a, b, t) {
  return [
    mixChannel(a[0], b[0], t),
    mixChannel(a[1], b[1], t),
    mixChannel(a[2], b[2], t),
  ];
}

function rangeRgb(ratio) {
  const pct = clampUnit(ratio) * 100;
  if (pct <= 25) return RANGE_BLUE;
  if (pct <= 50) return mixRgb(RANGE_BLUE, RANGE_YELLOW, (pct - 25) / 25);
  if (pct <= 75) return mixRgb(RANGE_YELLOW, RANGE_ORANGE, (pct - 50) / 25);
  return mixRgb(RANGE_ORANGE, RANGE_RED, (pct - 75) / 25);
}

function rangeColor(ratio, alpha = 1) {
  const [r, g, b] = rangeRgb(ratio);
  return `rgba(${r},${g},${b},${alpha})`;
}

function ratioForValue(value, max) {
  return clampUnit((Number(value) || 0) / Math.max(1, Number(max) || 1));
}

function tempScaleRatio(value) {
  return clampUnit((Number(value) || 0) / 100);
}

function compactWatts(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return '--';
  return `${Math.round(n)}W`;
}

function gridCoord(ratio, size) {
  return (ratio * (size - 1) + 0.5).toFixed(1);
}

function gridStroke(ratio) {
  return ratio === 0 || ratio === 1 ? 'rgba(255,255,255,0.16)' : FAINT;
}

function useTelemetry() {
  const [snapshot, setSnapshot] = useState(null);
  useEffect(() => subscribeWorkstationTelemetry(setSnapshot), []);
  return snapshot;
}

function fmt(value, suffix = '', digits = 0) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return '--';
  return `${n.toFixed(digits)}${suffix}`;
}

function fmtSigned(value, suffix = '', digits = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '--';
  return `${n.toFixed(digits)}${suffix}`;
}

function fmtInt(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '--';
  return new Intl.NumberFormat('fr-CA').format(Math.round(n));
}

function fmtMemoryMB(value, digits = 1) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return '--';
  if (n >= 1024) return `${(n / 1024).toFixed(digits)} GB`;
  return `${n.toFixed(0)} MB`;
}

function fmtUptime(seconds) {
  const total = Number(seconds);
  if (!Number.isFinite(total) || total <= 0) return '--';
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = Math.floor(total % 60);
  const clock = [h, m, s].map(part => String(part).padStart(2, '0')).join(':');
  return d > 0 ? `${d}d ${clock}` : clock;
}

function latest(values = []) {
  return values.length ? values[values.length - 1] : 0;
}

function maxOf(...groups) {
  let max = 0;
  groups.forEach(group => {
    if (Array.isArray(group)) group.forEach(value => { max = Math.max(max, Number(value) || 0); });
    else max = Math.max(max, Number(group) || 0);
  });
  return Math.max(1, max);
}

function HeaderMetric({ value, muted = false }) {
  return (
    <span style={{
      flexShrink: 0,
      marginLeft: 2,
      padding: '2px 6px',
      borderRadius: 5,
      border: muted ? '1px solid rgba(247,250,255,0.18)' : '1px solid rgba(238,248,255,0.38)',
      background: muted ? 'rgba(255,255,255,0.04)' : 'rgba(47,109,255,0.14)',
      color: TEXT,
      fontFamily: 'DM Mono,monospace',
      fontSize: 10,
      lineHeight: 1.15,
      boxShadow: muted ? 'none' : '0 0 12px rgba(47,109,255,0.24), inset 0 0 0 1px rgba(255,255,255,0.06)',
      textShadow: muted ? 'none' : '0 0 8px rgba(47,109,255,0.35)',
    }}>
      {value}
    </span>
  );
}

function metricWithUnit(value, suffix = '', digits = 0) {
  return fmt(value, suffix, digits).replace(' ', '');
}

function TempBar({ value, max = 100, label = 'Temp' }) {
  const safeValue = Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : 0;
  const ratio = ratioForValue(safeValue, max);
  const heatColor = rangeColor(tempScaleRatio(safeValue), 0.92);
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '13px minmax(0,1fr)', gap: 6, alignItems: 'end', minWidth: 0 }}>
      <div style={{
        height: 42,
        width: 10,
        border: '1px solid rgba(238,248,255,0.28)',
        borderRadius: 3,
        background: 'linear-gradient(180deg, rgba(255,205,70,0.18), rgba(47,109,255,0.08))',
        position: 'relative',
        overflow: 'hidden',
        boxShadow: `inset 0 0 0 1px rgba(255,255,255,0.05), 0 0 12px ${rangeColor(tempScaleRatio(safeValue), 0.18)}`,
      }}>
        <div style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          height: `${ratio * 100}%`,
          overflow: 'hidden',
          border: ratio > 0 ? '1px solid rgba(255,255,255,0.56)' : 'none',
          boxShadow: `0 0 14px ${heatColor}`,
        }}>
          <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 42, background: TEMP_GRADIENT }} />
        </div>
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 8.5, color: MUTED, textTransform: 'uppercase' }}>{label}</div>
        <div style={{ fontSize: 11, color: TEXT, fontFamily: 'DM Mono,monospace', marginTop: 1 }}>{fmt(value, ' C')}</div>
        <div style={{ fontSize: 7.5, color: MUTED, fontFamily: 'DM Mono,monospace', marginTop: 2 }}>max {fmt(max, ' C')}</div>
      </div>
    </div>
  );
}

function PowerGauge({ value, max, label = 'Power' }) {
  const safeMax = Math.max(1, Number(max) || 1);
  const safeValue = Math.max(0, Number(value) || 0);
  const ratio = ratioForValue(safeValue, safeMax);
  const powerColor = rangeColor(ratio, 0.96);
  const radius = 22;
  const circumference = 2 * Math.PI * radius;
  const dash = ratio * circumference;
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', minWidth: 0 }}>
      <svg width="42" height="42" viewBox="0 0 58 58" style={{ flexShrink: 0 }}>
        <circle cx="29" cy="29" r={radius} fill="rgba(2,8,18,0.34)" stroke="rgba(247,250,255,0.14)" strokeWidth="6" />
        <circle
          cx="29"
          cy="29"
          r={radius}
          fill="none"
          stroke={powerColor}
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circumference - dash}`}
          transform="rotate(180 29 29)"
          style={{ filter: `drop-shadow(0 0 6px ${rangeColor(ratio, 0.52)})` }}
        />
        <text x="29" y="29" textAnchor="middle" dominantBaseline="central" fill={TEXT} fontSize="13" fontFamily="DM Mono,monospace">
          {fmt(value)}
        </text>
      </svg>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 8.5, color: MUTED, textTransform: 'uppercase' }}>{label}</div>
        <div style={{ fontSize: 11, color: TEXT, fontFamily: 'DM Mono,monospace' }}>{fmt(value, ' W')}</div>
        <div style={{ fontSize: 7.5, color: MUTED, fontFamily: 'DM Mono,monospace', marginTop: 2 }}>limit {fmt(max, ' W')}</div>
      </div>
    </div>
  );
}

function GaugeRow({ temp, tempMax, power, powerMax }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'minmax(0,1fr) minmax(0,1.15fr)',
      gap: 8,
      alignItems: 'center',
      borderTop: '1px solid rgba(247,250,255,0.10)',
      paddingTop: 8,
      marginTop: 9,
    }}>
      <TempBar value={temp} max={tempMax} />
      <PowerGauge value={power} max={powerMax} />
    </div>
  );
}

function descriptor(title, content, sub = '', badge = null) {
  return {
    shell: 'acrylic',
    color: BLUE,
    title,
    sub,
    badge: null,
    shellProps: { softText: true, rightBadge: badge },
    content,
  };
}

function pointsFor(values = [], width, height, max) {
  if (!values.length) return '';
  return values.map((value, index) => {
    const x = values.length <= 1 ? 0 : (index / (values.length - 1)) * width;
    const ratio = Math.max(0, Math.min(1, (Number(value) || 0) / max));
    const y = height - ratio * (height - 3) - 1.5;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
}

function LineChart({ series = [], max = 100, height = 52 }) {
  const width = 190;
  const safeMax = Math.max(1, max);
  const prepared = useMemo(() => series
    .filter(item => item.values?.length)
    .map(item => ({ ...item, points: pointsFor(item.values, width, height, safeMax) })),
    [series, safeMax, height]);

  return (
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" width="100%" height={height} style={{ display: 'block', overflow: 'visible' }} shapeRendering="crispEdges">
      {VALUE_GRID_RATIOS.map(ratio => (
        <line key={`value-${ratio}`} x1="0" y1={gridCoord(ratio, height)} x2={width} y2={gridCoord(ratio, height)} stroke={gridStroke(ratio)} strokeWidth={ratio === 0 || ratio === 1 ? '0.9' : '0.65'} vectorEffect="non-scaling-stroke" />
      ))}
      {TIME_GRID_RATIOS.map(ratio => (
        <line key={`time-${ratio}`} x1={gridCoord(ratio, width)} y1="0" x2={gridCoord(ratio, width)} y2={height} stroke={gridStroke(ratio)} strokeWidth={ratio === 0 || ratio === 1 ? '0.9' : '0.8'} vectorEffect="non-scaling-stroke" />
      ))}
      {prepared.map((item, index) => item.fill ? (
        <polygon
          key={`fill-${index}`}
          points={`0,${height - 1} ${item.points} ${width},${height - 1}`}
          fill={item.fill}
        />
      ) : null)}
      {prepared.map((item, index) => (
        <polyline
          key={`line-${index}`}
          points={item.points}
          fill="none"
          stroke={item.color || SOFT_BLUE}
          strokeWidth={item.width || 0.95}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  );
}

function MiniGraph({ label, value, series, max = 100, height = 42 }) {
  return (
    <div style={{
      minWidth: 0,
      width: '100%',
      border: '1px solid rgba(247,250,255,0.14)',
      background: 'rgba(2,8,18,0.28)',
      padding: '4px 5px 3px',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6, color: MUTED, fontSize: 8, marginBottom: 2 }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
        <span style={{ color: TEXT, fontFamily: 'DM Mono,monospace' }}>{value}</span>
      </div>
      <LineChart series={series} max={max} height={height} />
    </div>
  );
}

function GraphGrid({ graphs, columns = 2 }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gap: 4 }}>
      {graphs.map(graph => <MiniGraph key={graph.label} {...graph} />)}
    </div>
  );
}

function TabButton({ active, children, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        height: 22,
        flex: 1,
        borderRadius: 5,
        border: active ? '1px solid rgba(239,248,255,0.72)' : '1px solid rgba(247,250,255,0.12)',
        background: active ? 'rgba(47,109,255,0.24)' : 'rgba(255,255,255,0.035)',
        color: TEXT,
        fontSize: 10,
        cursor: 'pointer',
        boxShadow: active ? '0 0 12px rgba(47,109,255,0.24), inset 0 0 0 1px rgba(255,255,255,0.08)' : 'none',
      }}
    >
      {children}
    </button>
  );
}

function ViewToggle({ active, onChange }) {
  return (
    <div style={{ display: 'flex', gap: 4, flexShrink: 0, width: 116 }}>
      <TabButton active={active === 'graphs'} onClick={() => onChange('graphs')}>Graphiques</TabButton>
      <TabButton active={active === 'metrics'} onClick={() => onChange('metrics')}>Détails</TabButton>
    </div>
  );
}

function MetricTile({ label, value }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 8.5, color: MUTED, textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 12.5, color: TEXT, fontFamily: 'DM Mono,monospace', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {value}
      </div>
    </div>
  );
}

function FooterMetricRow({ items }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))`,
      gap: 6,
      borderTop: '1px solid rgba(247,250,255,0.10)',
      paddingTop: 8,
      marginTop: 9,
    }}>
      {items.map(item => (
        <div key={item.label} style={{ minWidth: 0 }}>
          <div style={{ fontSize: 7.5, color: MUTED, textTransform: 'uppercase', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.label}</div>
          <div style={{ fontSize: 9.5, color: TEXT, fontFamily: 'DM Mono,monospace', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.value}</div>
        </div>
      ))}
    </div>
  );
}

function FooterPowerGauge({ value, max }) {
  const safeMax = Math.max(1, Number(max) || 1);
  const safeValue = Math.max(0, Number(value) || 0);
  const ratio = ratioForValue(safeValue, safeMax);
  const powerColor = rangeColor(ratio, 0.96);
  const radius = 15;
  const circumference = 2 * Math.PI * radius;
  const dash = ratio * circumference;
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, minWidth: 0 }}>
      <span style={{
        color: 'rgba(247,250,255,0.58)',
        fontSize: 7.6,
        fontFamily: 'DM Mono,monospace',
        whiteSpace: 'nowrap',
        minWidth: 24,
        textAlign: 'right',
      }}>
        {compactWatts(safeMax)}
      </span>
      <svg width="42" height="42" viewBox="0 0 40 40" style={{ flexShrink: 0 }}>
        <circle cx="20" cy="20" r={radius} fill="rgba(2,8,18,0.34)" stroke="rgba(247,250,255,0.14)" strokeWidth="4" />
        <circle
          cx="20"
          cy="20"
          r={radius}
          fill="none"
          stroke={powerColor}
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circumference - dash}`}
          transform="rotate(180 20 20)"
          style={{ filter: `drop-shadow(0 0 5px ${rangeColor(ratio, 0.5)})` }}
        />
        <circle cx="20" cy="20" r="10.7" fill="none" stroke="rgba(247,250,255,0.16)" strokeWidth="0.75" />
        <text x="20" y="20.2" textAnchor="middle" dominantBaseline="central" fill={TEXT} fontSize="9.2" fontFamily="DM Mono,monospace">
          {fmt(value)}
        </text>
      </svg>
    </div>
  );
}

function FooterTempBar({ value, max }) {
  const safeMax = Math.max(1, Number(max) || 1);
  const safeValue = Math.max(0, Number(value) || 0);
  const ratio = ratioForValue(safeValue, safeMax);
  const heatColor = rangeColor(tempScaleRatio(safeValue), 0.92);
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, minWidth: 0 }}>
      <div style={{
        height: 40,
        width: 10,
        border: '1px solid rgba(238,248,255,0.3)',
        borderRadius: 3,
        background: 'linear-gradient(180deg, rgba(255,205,70,0.16), rgba(47,109,255,0.08))',
        position: 'relative',
        overflow: 'hidden',
        boxShadow: `inset 0 0 0 1px rgba(255,255,255,0.04), 0 0 9px ${rangeColor(tempScaleRatio(safeValue), 0.18)}`,
      }}>
        <div style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          height: `${ratio * 100}%`,
          overflow: 'hidden',
          border: ratio > 0 ? '1px solid rgba(255,255,255,0.56)' : 'none',
          boxShadow: `0 0 12px ${heatColor}`,
        }}>
          <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 40, background: TEMP_GRADIENT }} />
        </div>
      </div>
      <span style={{ color: TEXT, fontSize: 10, fontFamily: 'DM Mono,monospace', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{fmt(value, ' C')}</span>
    </div>
  );
}

function FooterTextMetric({ item }) {
  return (
    <div style={{ display: 'grid', alignContent: 'center', minWidth: 0 }}>
      <div style={{ fontSize: 7.5, color: MUTED, textTransform: 'uppercase' }}>{item.label}</div>
      <div style={{ fontSize: 9.5, color: TEXT, fontFamily: 'DM Mono,monospace', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.value}</div>
    </div>
  );
}

function CpuGpuFooter({ first, second, power, powerMax, temp, tempMax }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'minmax(0, 0.9fr) minmax(0, 0.86fr) minmax(72px, 1.08fr) minmax(58px, 0.84fr)',
      gap: 7,
      borderTop: '1px solid rgba(247,250,255,0.10)',
      paddingTop: 7,
      marginTop: 9,
      alignItems: 'center',
      minHeight: 42,
    }}>
      <FooterTextMetric item={first} />
      <FooterTextMetric item={second} />
      <FooterPowerGauge value={power} max={powerMax} />
      <FooterTempBar value={temp} max={tempMax} />
    </div>
  );
}

function MetricsTable({ rows }) {
  return (
    <div style={{ borderTop: '1px solid rgba(247,250,255,0.10)' }}>
      {rows.map(([label, value]) => (
        <div key={label} style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(74px, 0.78fr) minmax(0, 1.22fr)',
          gap: 8,
          padding: '5px 0',
          borderBottom: '1px solid rgba(247,250,255,0.075)',
          alignItems: 'baseline',
        }}>
          <div style={{ color: MUTED, fontSize: 9.5, minWidth: 0 }}>{label}</div>
          <div style={{ color: TEXT, fontSize: 10.5, fontFamily: 'DM Mono,monospace', textAlign: 'right', minWidth: 0, overflowWrap: 'anywhere' }}>{value}</div>
        </div>
      ))}
    </div>
  );
}

function CardBody({ unavailable, subline, tiles, graphView, rows, live, gauges = null, footer = null }) {
  const [tab, setTab] = useState('graphs');

  if (unavailable) {
    return (
      <div style={{ color: TEXT, fontSize: 12, padding: '5px 0 2px' }}>
        <div>Telemetry service unavailable</div>
        <div style={{ color: MUTED, fontSize: 11, marginTop: 4 }}>Start WorkstationMonitor with the telemetry service enabled.</div>
      </div>
    );
  }

  return (
    <div style={{ color: TEXT }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', marginBottom: 9 }}>
        {subline && <div style={{ color: MUTED, fontSize: 10, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>{subline}</div>}
        <ViewToggle active={tab} onChange={setTab} />
        <div title={live ? 'Sampling' : 'Paused'} style={{
          width: 7,
          height: 7,
          borderRadius: '50%',
          background: live ? BLUE : 'rgba(247,250,255,0.28)',
          boxShadow: live ? '0 0 10px rgba(47,109,255,0.85)' : 'none',
          flexShrink: 0,
        }} />
      </div>
      {tab === 'graphs' ? graphView : <MetricsTable rows={rows} />}
      {tiles?.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 10, marginTop: 10 }}>
          {tiles.map(item => <MetricTile key={item.label} {...item} />)}
        </div>
      )}
      {gauges}
      {footer}
    </div>
  );
}

function serviceRows(snapshot) {
  return [
    ['Sampler', snapshot?.sampling ? 'Live' : 'Paused'],
    ['Clients', fmtInt(snapshot?.activeClients || 0)],
    ['Interval', fmt(snapshot?.sampleIntervalMs, ' ms')],
  ];
}

export function CpuWidget() {
  const s = useTelemetry();
  const cpu = s?.cpu;
  const coreGraphs = (cpu?.coreHistory || []).slice(0, 12).map((values, index) => ({
    label: `CPU ${index}`,
    value: fmt(latest(values), '%'),
    series: [{ values, color: SOFT_BLUE, fill: BLUE_FILL }],
    max: 100,
    height: 28,
  }));

  return descriptor('CPU', (
    <CardBody
      unavailable={!cpu}
      live={s?.sampling && !s?.stale}
      subline={cpu?.name || 'Processor'}
      tiles={[]}
      footer={<CpuGpuFooter
        first={{ label: 'Clock', value: fmt(cpu?.frequencyMHz, ' MHz') }}
        second={{ label: 'Threads', value: fmtInt(cpu?.threads) }}
        power={cpu?.powerW}
        powerMax={cpu?.powerLimitW || 130}
        temp={cpu?.temperatureC}
        tempMax={cpu?.tjMaxC || 100}
      />}
      graphView={(
        <div style={{ display: 'grid', gap: 6 }}>
          <MiniGraph
            label="Total usage"
            value={fmt(cpu?.usagePct, '%')}
            series={[{ values: cpu?.history || [], color: SOFT_BLUE, fill: BLUE_FILL, width: 1.05 }]}
            max={100}
            height={48}
          />
          <GraphGrid graphs={coreGraphs} columns={4} />
        </div>
      )}
      rows={[
        ['Processor', cpu?.name || '--'],
        ['Utilization', fmt(cpu?.usagePct, '%')],
        ['Speed', fmt(cpu?.frequencyMHz, ' MHz')],
        ['Base speed', fmt(cpu?.baseFrequencyMHz, ' MHz')],
        ['Frequency source', cpu?.frequencySource || '--'],
        ['Processes', fmtInt(cpu?.processes)],
        ['Threads', fmtInt(cpu?.threads)],
        ['Handles', fmtInt(cpu?.handles)],
        ['Uptime', fmtUptime(cpu?.uptimeSeconds)],
        ['Physical cores', fmtInt(cpu?.physicalCores)],
        ['Logical cores', fmtInt(cpu?.coreCount)],
        ['Sockets', fmtInt(cpu?.sockets)],
        ['Virtualization', cpu?.virtualizationEnabled ? 'Enabled' : 'Disabled'],
        ['Cache L1', fmt(cpu?.cacheL1KB, ' KB')],
        ['Cache L2', fmt(cpu?.cacheL2KB, ' KB')],
        ['Cache L3', fmt(cpu?.cacheL3KB, ' KB')],
        ['Temperature', fmt(cpu?.temperatureC, ' C')],
        ['Temp source', cpu?.temperatureSource || '--'],
        ['Power limit', fmt(cpu?.powerLimitW, ' W')],
        ...serviceRows(s),
      ]}
    />
  ), '', <HeaderMetric value={metricWithUnit(cpu?.usagePct, '%')} muted={!s?.sampling || s?.stale} />);
}

export function GpuWidget() {
  const s = useTelemetry();
  const gpu = s?.gpu;
  return descriptor('GPU', (
    <CardBody
      unavailable={!gpu}
      live={s?.sampling && !s?.stale}
      subline={gpu?.name || 'Graphics'}
      tiles={[]}
      footer={<CpuGpuFooter
        first={{ label: 'Clock', value: fmt(gpu?.clockMHz, ' MHz') }}
        second={{ label: 'VRAM', value: fmtMemoryMB(gpu?.vramUsedMB) }}
        power={gpu?.powerW}
        powerMax={gpu?.powerLimitW || 320}
        temp={gpu?.temperatureC}
        tempMax={gpu?.tjMaxC || 95}
      />}
      graphView={(
        <div style={{ display: 'grid', gap: 6 }}>
          <GraphGrid graphs={[
            { label: '3D', value: fmt(latest(gpu?.history3D), '%'), series: [{ values: gpu?.history3D || [], color: GREEN, fill: 'rgba(95,255,190,0.16)' }], height: 30 },
            { label: 'Copy', value: fmt(latest(gpu?.historyCopy), '%'), series: [{ values: gpu?.historyCopy || [], color: GREEN }], height: 30 },
            { label: 'Encode', value: fmt(latest(gpu?.historyEncode), '%'), series: [{ values: gpu?.historyEncode || [], color: GREEN }], height: 30 },
            { label: 'Decode', value: fmt(latest(gpu?.historyDecode), '%'), series: [{ values: gpu?.historyDecode || [], color: GREEN }], height: 30 },
          ]} />
          <MiniGraph label="Dedicated memory" value={`${fmtMemoryMB(gpu?.vramUsedMB)} / ${fmtMemoryMB(gpu?.vramTotalMB, 0)}`} series={[{ values: gpu?.historyVRAM || [], color: SOFT_BLUE, fill: BLUE_FILL }]} max={100} height={36} />
          <MiniGraph label="Shared memory" value={`${fmtMemoryMB(gpu?.sharedUsedMB)} / ${fmtMemoryMB(gpu?.sharedTotalMB, 0)}`} series={[{ values: gpu?.historySharedMemory || [], color: SOFT_BLUE, fill: BLUE_FILL }]} max={100} height={36} />
        </div>
      )}
      rows={[
        ['GPU', gpu?.name || '--'],
        ['Utilization', fmt(gpu?.usagePct, '%')],
        ['Clock', fmt(gpu?.clockMHz, ' MHz')],
        ['Temperature', fmt(gpu?.temperatureC, ' C')],
        ['Power', fmt(gpu?.powerW, ' W')],
        ['Power limit', fmt(gpu?.powerLimitW, ' W')],
        ['Dedicated used', fmtMemoryMB(gpu?.vramUsedMB)],
        ['Dedicated total', fmtMemoryMB(gpu?.vramTotalMB, 0)],
        ['Shared used', fmtMemoryMB(gpu?.sharedUsedMB)],
        ['Shared total', fmtMemoryMB(gpu?.sharedTotalMB, 0)],
        ['Hardware reserved', fmtMemoryMB(gpu?.dedicatedSystemMemoryMB, 0)],
        ['FPS', s?.fps?.tracking ? fmt(s?.fps?.current) : '--'],
        ['FPS source', s?.fps?.source || '--'],
        ['FPS provider', s?.fps?.provider || '--'],
        ['Driver version', gpu?.driverVersion || '--'],
        ['Driver date', gpu?.driverDate || '--'],
        ['DirectX', gpu?.directXVersion || '--'],
        ['PCI bus', gpu?.pciBusId || '--'],
        ...serviceRows(s),
      ]}
    />
  ), '', <HeaderMetric value={metricWithUnit(gpu?.usagePct, '%')} muted={!s?.sampling || s?.stale} />);
}

export function RamWidget() {
  const s = useTelemetry();
  const ram = s?.ram;
  const bw = ram?.bandwidth;
  const bwMax = maxOf(bw?.peakGBps, bw?.theoreticalPeakGBps, bw?.history);
  return descriptor('RAM', (
    <CardBody
      unavailable={!ram}
      live={s?.sampling && !s?.stale}
      subline={ram?.model || 'System memory'}
      tiles={[
        { label: 'Free', value: fmt(ram?.availableGB, ' GB', 1) },
        { label: 'Total', value: fmt(ram?.totalGB, ' GB', 0) },
        { label: 'BW', value: fmt(bw?.totalGBps, ' GB/s', 1) },
      ]}
      graphView={(
        <div style={{ display: 'grid', gap: 6 }}>
          <MiniGraph label="Memory pressure" value={fmt(ram?.usedPct, '%')} series={[{ values: ram?.history || [], color: GOLD, fill: 'rgba(255,187,55,0.16)' }]} max={100} height={54} />
          <MiniGraph label="Memory bandwidth" value={fmt(bw?.totalGBps, ' GB/s', 1)} series={[{ values: bw?.history || [], color: GOLD, fill: 'rgba(255,187,55,0.14)' }]} max={bwMax} height={54} />
        </div>
      )}
      rows={[
        ['Module', ram?.model || '--'],
        ['Used', fmt(ram?.usedPct, '%')],
        ['Available', fmt(ram?.availableGB, ' GB', 1)],
        ['Total RAM', fmt(ram?.totalGB, ' GB', 1)],
        ['BW available', bw?.available ? 'Yes' : 'No'],
        ['BW read', fmt(bw?.readGBps, ' GB/s', 1)],
        ['BW write', fmt(bw?.writeGBps, ' GB/s', 1)],
        ['BW total', fmt(bw?.totalGBps, ' GB/s', 1)],
        ['BW peak', fmt(bw?.peakGBps, ' GB/s', 1)],
        ['Theoretical peak', fmt(bw?.theoreticalPeakGBps, ' GB/s', 1)],
        ...serviceRows(s),
      ]}
    />
  ), '', <HeaderMetric value={metricWithUnit(ram?.usedPct, '%')} muted={!s?.sampling || s?.stale} />);
}

export function DiskWidget() {
  const s = useTelemetry();
  const disk = s?.disk;
  const max = Math.max(5, maxOf(disk?.history));
  return descriptor('DISK', (
    <CardBody
      unavailable={!disk}
      live={s?.sampling && !s?.stale}
      subline={disk?.model || 'PhysicalDrive0'}
      tiles={[
        { label: 'Activity', value: fmt(disk?.activityPct, '%', 1) },
        { label: 'Peak', value: fmt(max, '%') },
        { label: 'State', value: (disk?.activityPct || 0) > 2 ? 'Active' : 'Idle' },
      ]}
      graphView={(
        <MiniGraph label="Disk activity" value={fmt(disk?.activityPct, '%', 1)} series={[{ values: disk?.history || [], color: GREEN, fill: 'rgba(95,255,190,0.15)' }]} max={max} height={54} />
      )}
      rows={[
        ['Model', disk?.model || '--'],
        ['Activity', fmt(disk?.activityPct, '%', 1)],
        ['Peak 30s', fmt(max, '%')],
        ['State', (disk?.activityPct || 0) > 2 ? 'Active' : 'Idle'],
        ['Source', 'System IO counters'],
        ...serviceRows(s),
      ]}
    />
  ), '', <HeaderMetric value={metricWithUnit(disk?.activityPct, '%', 1)} muted={!s?.sampling || s?.stale} />);
}

export function NetworkWidget() {
  const s = useTelemetry();
  const net = s?.network;
  const max = Math.max(1, maxOf(net?.downHistory, net?.upHistory));
  return descriptor('NETWORK', (
    <CardBody
      unavailable={!net}
      live={s?.sampling && !s?.stale}
      subline={net?.adapter || 'Network adapter'}
      tiles={[
        { label: 'Up', value: fmt(net?.upMbps, ' Mbps', 1) },
        { label: 'Scale', value: fmt(max, ' Mbps', 0) },
        { label: 'Link', value: net?.valid ? 'Live' : 'Offline' },
      ]}
      graphView={(
        <MiniGraph
          label="Network throughput"
          value={`D ${fmt(net?.downMbps, '', 1)} / U ${fmt(net?.upMbps, ' Mbps', 1)}`}
          series={[
            { values: net?.downHistory || [], color: VIOLET, fill: 'rgba(194,106,255,0.14)', width: 1.05 },
            { values: net?.upHistory || [], color: SOFT_BLUE, width: 0.85 },
          ]}
          max={max}
          height={54}
        />
      )}
      rows={[
        ['Adapter', net?.adapter || '--'],
        ['Link', net?.valid ? 'Live' : 'Offline'],
        ['Download', fmt(net?.downMbps, ' Mbps', 3)],
        ['Upload', fmt(net?.upMbps, ' Mbps', 3)],
        ['Peak down', fmt(maxOf(net?.downHistory), ' Mbps', 3)],
        ['Peak up', fmt(maxOf(net?.upHistory), ' Mbps', 3)],
        ['Graph scale', fmt(max, ' Mbps', 1)],
        ...serviceRows(s),
      ]}
    />
  ), '', <HeaderMetric value={`${metricWithUnit(net?.downMbps, 'M', 1)}↓ ${metricWithUnit(net?.upMbps, 'M', 1)}↑`} muted={!s?.sampling || s?.stale} />);
}
