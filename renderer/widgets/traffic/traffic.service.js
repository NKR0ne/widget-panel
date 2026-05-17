import { SK_TRAFFIC_THEME, SK_TRAFFIC_ZOOM } from '../../config/storageKeys.js';
import { api } from '../../services/electronApi.js';
import { DEFAULT_TRAFFIC_THEME, DEFAULT_TRAFFIC_ZOOM, TRAFFIC_THEMES } from './traffic.constants.js';

export async function loadTrafficZoom() {
  try {
    const stored = await api.store.get(SK_TRAFFIC_ZOOM);
    const zoom = parseInt(stored || '', 10);
    return Number.isNaN(zoom) ? DEFAULT_TRAFFIC_ZOOM : zoom;
  } catch {
    return DEFAULT_TRAFFIC_ZOOM;
  }
}

export async function saveTrafficZoom(zoom) {
  try {
    await api.store.set(SK_TRAFFIC_ZOOM, String(zoom));
  } catch {}
}

export async function loadTrafficTheme() {
  try {
    const stored = await api.store.get(SK_TRAFFIC_THEME);
    return TRAFFIC_THEMES.some(theme => theme.id === stored) ? stored : DEFAULT_TRAFFIC_THEME;
  } catch {
    return DEFAULT_TRAFFIC_THEME;
  }
}

export async function saveTrafficTheme(theme) {
  try {
    await api.store.set(SK_TRAFFIC_THEME, theme);
  } catch {}
}

export function buildTrafficMapSrc({ location, apiKey, zoom, theme = DEFAULT_TRAFFIC_THEME }) {
  const lat = location.lat.toFixed(5);
  const lon = location.lon.toFixed(5);
  const key = apiKey ? `&apiKey=${encodeURIComponent(apiKey)}` : '';
  return `./traffic.html?lat=${lat}&lon=${lon}&zoom=${zoom}&theme=${encodeURIComponent(theme)}${key}`;
}
