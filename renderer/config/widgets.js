export const PALETTE = [
  '#4f8ef7',
  '#5cc8a8',
  '#b07ef7',
  '#f7a64f',
  '#f74f7e',
  '#4ff7c8',
  '#f7f74f',
  '#c8f74f',
];

export const SYS = [
  { id: 'weather', label: 'Prévisions', note: 'Open-Meteo · no key', color: '#f7c94f' },
  { id: 'traffic', label: 'Circulation', note: 'TomTom · free key', color: '#f77f4f' },
  { id: 'stocks', label: 'Marchés', note: 'Finnhub · free key', color: '#5cc8a8' },
  { id: 'calendar', label: 'Calendrier', note: 'No API needed', color: '#9c27b0' },
  { id: 'clock', label: 'Horloge', note: 'No API needed', color: '#e8e8f0' },
  { id: 'agenda', label: 'Outlook Agenda', note: 'Microsoft Graph · OAuth', color: '#0078d4' },
  { id: 'mail', label: 'Outlook Mail', note: 'Microsoft Graph · OAuth', color: '#0078d4' },
  { id: 'todo', label: 'Microsoft To-Do', note: 'Microsoft Graph · OAuth', color: '#2564cf' },
  { id: 'starvis', label: 'Starvis', note: 'AI command center · prototype', color: '#62e6ff' },
  { id: 'camera', label: 'Caméra', note: 'Security Center · local', color: '#5e8af5' },
  { id: 'euronews', label: 'Euronews', note: 'HLS · Antik', color: '#1e4ba8' },
  { id: 'live-bloomberg', label: 'Bloomberg Live', note: 'Live feed', color: '#2f6dff' },
  { id: 'live-radio-canada', label: 'Radio-Canada.info', note: 'Live feed', color: '#2f6dff' },
  { id: 'live-france24', label: 'France 24', note: 'Live feed', color: '#2f6dff' },
  { id: 'live-cbc-news', label: 'CBC News', note: 'Live feed', color: '#2f6dff' },
  { id: 'live-lcn', label: 'LCN', note: 'Live feed', color: '#2f6dff' },
  { id: 'workstation-cpu', label: 'CPU', note: 'Workstation service', color: '#2f6dff' },
  { id: 'workstation-gpu', label: 'GPU', note: 'Workstation service', color: '#2f6dff' },
  { id: 'workstation-ram', label: 'RAM', note: 'Workstation service', color: '#2f6dff' },
  { id: 'workstation-disk', label: 'Disk', note: 'Workstation service', color: '#2f6dff' },
  { id: 'workstation-network', label: 'Network', note: 'Workstation service', color: '#2f6dff' },
];

export const SYSTEM_WIDGET_IDS = SYS.map(widget => widget.id);
export const SYSTEM_WIDGET_ID_SET = new Set(SYSTEM_WIDGET_IDS);
export const WORKSTATION_WIDGET_IDS = [
  'workstation-cpu',
  'workstation-gpu',
  'workstation-ram',
  'workstation-disk',
  'workstation-network',
];
export const WORKSTATION_WIDGET_ID_SET = new Set(WORKSTATION_WIDGET_IDS);
export const LIVE_WIDGET_IDS = [
  'live-bloomberg',
  'live-radio-canada',
  'live-france24',
  'live-cbc-news',
  'live-lcn',
];
export const LIVE_WIDGET_ID_SET = new Set(LIVE_WIDGET_IDS);

export function defaultColumns(categories) {
  const cols = {};
  (categories || []).forEach(category => {
    cols[`cat:${category.label}`] = 'feed';
  });
  cols.weather = 'left';
  cols.stocks = 'left';
  cols.traffic = 'left';
  cols.clock = 'left';
  cols.agenda = 'right';
  cols.mail = 'right';
  cols.starvis = 'right';
  cols.camera = 'left';
  cols.todo = 'right';
  LIVE_WIDGET_IDS.forEach(id => { cols[id] = 'aux'; });
  WORKSTATION_WIDGET_IDS.forEach(id => { cols[id] = 'monitor'; });
  return cols;
}

export function getColumnForWidget(id, columns) {
  if (columns[id]) return columns[id];
  if (WORKSTATION_WIDGET_ID_SET.has(id)) return 'monitor';
  if (LIVE_WIDGET_ID_SET.has(id)) return 'aux';
  return id.startsWith('cat:') ? 'feed' : 'left';
}

export function isKnownWidgetId(id, categories) {
  return SYSTEM_WIDGET_ID_SET.has(id)
    || (id.startsWith('cat:') && (categories || []).some(category => category.label === id.slice(4)));
}
