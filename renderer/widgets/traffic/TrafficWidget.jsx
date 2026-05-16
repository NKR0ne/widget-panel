import { useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_LOC } from '../weather/weather.constants.js';
import { DEFAULT_TRAFFIC_ZOOM } from './traffic.constants.js';
import { buildTrafficMapSrc, loadTrafficZoom, saveTrafficZoom } from './traffic.service.js';

export default function TrafficWidget({ location = DEFAULT_LOC, apiKey = '' }) {
  const [initialZoom, setInitialZoom] = useState(DEFAULT_TRAFFIC_ZOOM);
  const zoomRef = useRef(initialZoom);

  useEffect(() => {
    let alive = true;
    loadTrafficZoom().then((storedZoom) => {
      if (!alive) return;
      setInitialZoom(storedZoom);
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
    () => buildTrafficMapSrc({ location, apiKey, zoom: initialZoom }),
    [location.lat, location.lon, apiKey, initialZoom]
  );

  return {
    color: '#f77f4f',
    title: 'Circulation',
    sub: `Satellite - ${location.name}`,
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
