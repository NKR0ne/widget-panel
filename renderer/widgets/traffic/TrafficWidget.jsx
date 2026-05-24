import { useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_LOC } from '../weather/weather.constants.js';
import {
  AUTO_DAY_TRAFFIC_THEME,
  AUTO_NIGHT_TRAFFIC_THEME,
  DEFAULT_TRAFFIC_THEME,
  DEFAULT_TRAFFIC_ZOOM,
  TRAFFIC_NIGHT_END_HOUR,
  TRAFFIC_NIGHT_START_HOUR,
  TRAFFIC_THEMES,
} from './traffic.constants.js';
import { buildTrafficMapSrc, loadTrafficTheme, loadTrafficZoom, saveTrafficTheme, saveTrafficZoom } from './traffic.service.js';

function resolveAutoTrafficTheme() {
  const hour = new Date().getHours();
  return hour >= TRAFFIC_NIGHT_START_HOUR || hour < TRAFFIC_NIGHT_END_HOUR
    ? AUTO_NIGHT_TRAFFIC_THEME
    : AUTO_DAY_TRAFFIC_THEME;
}

function trafficCityName(location) {
  return String(location?.name || DEFAULT_LOC.name || '')
    .split(',')
    .map(part => part.trim())
    .filter(Boolean)[0] || 'Quebec';
}

export default function TrafficWidget({ location = DEFAULT_LOC, apiKey = '' }) {
  const [initialZoom, setInitialZoom] = useState(DEFAULT_TRAFFIC_ZOOM);
  const [theme, setTheme] = useState(DEFAULT_TRAFFIC_THEME);
  const [autoTheme, setAutoTheme] = useState(resolveAutoTrafficTheme);
  const zoomRef = useRef(initialZoom);

  useEffect(() => {
    let alive = true;
    Promise.all([loadTrafficZoom(), loadTrafficTheme()]).then(([storedZoom, storedTheme]) => {
      if (!alive) return;
      setInitialZoom(storedZoom);
      setTheme(storedTheme);
      zoomRef.current = storedZoom;
    });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    const updateAutoTheme = () => setAutoTheme(resolveAutoTrafficTheme());
    updateAutoTheme();
    const timer = setInterval(updateAutoTheme, 60000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const handler = (event) => {
      if (event.data?.type !== 'trafficZoom') return;
      const nextZoom = event.data.zoom;
      if (nextZoom === zoomRef.current) return;
      zoomRef.current = nextZoom;
      saveTrafficZoom(nextZoom);
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  const effectiveTheme = theme === 'auto' ? autoTheme : theme;
  const src = useMemo(
    () => buildTrafficMapSrc({ location, apiKey, zoom: initialZoom, theme: effectiveTheme }),
    [location.lat, location.lon, apiKey, initialZoom, effectiveTheme]
  );

  const selectTheme = (nextTheme) => {
    setTheme(nextTheme);
    saveTrafficTheme(nextTheme);
  };

  return {
    color: '#f77f4f',
    title: 'Circulation',
    sub: trafficCityName(location),
    badge: (
      <select
        value={theme}
        onClick={event => event.stopPropagation()}
        onChange={event => selectTheme(event.target.value)}
        title="Map theme"
        style={themeSelectStyle}
      >
        {TRAFFIC_THEMES.map(option => (
          <option key={option.id} value={option.id} style={{ background: '#101522' }}>
            {option.label}
          </option>
        ))}
      </select>
    ),
    content: (
      <div style={{ margin: '4px -2px 0', borderRadius: 10, overflow: 'hidden', lineHeight: 0 }}>
        <iframe
          key={src}
          src={src}
          width="100%"
          height="260"
          style={{ border: 'none', display: 'block', borderRadius: 10 }}
          title="Traffic map"
        />
      </div>
    ),
  };
}

const themeSelectStyle = {
  width: 104,
  maxWidth: 104,
  height: 19,
  borderRadius: 5,
  border: '1px solid rgba(122,178,255,0.28)',
  background: 'rgba(31,111,255,0.08)',
  color: '#fff',
  fontSize: 9,
  fontFamily: 'DM Mono,monospace',
  outline: 'none',
  cursor: 'pointer',
  padding: '0 4px',
  marginRight: 14,
  flexShrink: 0,
};
