import { useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_LOC } from '../weather/weather.constants.js';
import { DEFAULT_TRAFFIC_THEME, DEFAULT_TRAFFIC_ZOOM, TRAFFIC_THEMES } from './traffic.constants.js';
import { buildTrafficMapSrc, loadTrafficTheme, loadTrafficZoom, saveTrafficTheme, saveTrafficZoom } from './traffic.service.js';

export default function TrafficWidget({ location = DEFAULT_LOC, apiKey = '' }) {
  const [initialZoom, setInitialZoom] = useState(DEFAULT_TRAFFIC_ZOOM);
  const [theme, setTheme] = useState(DEFAULT_TRAFFIC_THEME);
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

  const src = useMemo(
    () => buildTrafficMapSrc({ location, apiKey, zoom: initialZoom, theme }),
    [location.lat, location.lon, apiKey, initialZoom, theme]
  );

  const currentTheme = TRAFFIC_THEMES.find(option => option.id === theme) || TRAFFIC_THEMES[0];
  const selectTheme = (nextTheme) => {
    setTheme(nextTheme);
    saveTrafficTheme(nextTheme);
  };

  return {
    color: '#f77f4f',
    title: 'Circulation',
    sub: `${currentTheme.label} - ${location.name}`,
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
  maxWidth: 78,
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
};
