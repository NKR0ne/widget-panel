import { useEffect, useState } from 'react';
import DemoBadge from '../../ui/DemoBadge.jsx';
import Skel from '../../ui/Skel.jsx';
import { DEFAULT_LOC, MOCK_WX } from './weather.constants.js';
import { wmo } from './weather.format.js';
import { fetchWeather } from './weather.service.js';

export default function WeatherWidget({ location = DEFAULT_LOC }) {
  const [wx, setWx] = useState(null);
  const [demo, setDemo] = useState(false);
  const [status, setStatus] = useState('loading');
  const [lastUpdated, setLastUpdated] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const doFetch = () => {
      setStatus('loading');
      fetchWeather(location)
        .then(data => {
          if (cancelled) return;
          setWx(data);
          setDemo(false);
          setStatus('ok');
          setLastUpdated(Date.now());
        })
        .catch(() => {
          if (cancelled) return;
          setWx(MOCK_WX);
          setDemo(true);
          setStatus('ok');
          setLastUpdated(Date.now());
        });
    };

    doFetch();
    const t = setInterval(doFetch, 30 * 60 * 1000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [location.lat, location.lon, location.timezone]);

  const cur = wx?.current;
  const daily = wx?.daily;
  const hourly = wx?.hourly;
  const nowIdx = hourly ? Math.max(0, hourly.time.findIndex(t => new Date(t) > new Date()) - 1) : 0;
  const [cond, icon] = cur ? wmo(cur.weather_code) : ['', '\u26c5'];

  return {
    color: '#f7c94f',
    title: 'Pr\u00e9visions',
    sub: location.name,
    lastUpdated,
    content: (
      <div>
        {status === 'loading' && <Skel n={2} />}
        {status === 'ok' && cur && (
          <div>
            {demo && <DemoBadge />}
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, padding: '4px 0 12px' }}>
              <span style={{ fontSize: 36, lineHeight: 1 }}>{icon}</span>
              <div>
                <div style={{ fontSize: 32, fontWeight: 300, color: '#f0f0f0', letterSpacing: -1, lineHeight: 1 }}>
                  {Math.round(cur.temperature_2m)}&deg;
                </div>
                <div style={{ fontSize: 11, color: '#d0d0e0', marginTop: 2 }}>
                  {cond} &middot; feels {Math.round(cur.apparent_temperature)}&deg;
                </div>
              </div>
              <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
                <div style={{ fontSize: 11, color: '#c4c4d4' }}>
                  Humidity <span style={{ color: '#777' }}>{cur.relative_humidity_2m}%</span>
                </div>
                <div style={{ fontSize: 11, color: '#c4c4d4', marginTop: 2 }}>
                  Wind <span style={{ color: '#777' }}>{Math.round(cur.wind_speed_10m)} km/h</span>
                </div>
              </div>
            </div>
            {hourly && (
              <div style={{ display: 'flex', gap: 2, paddingBottom: 8, borderBottom: '1px solid rgba(255,255,255,0.05)', overflowX: 'auto' }}>
                {hourly.time.slice(nowIdx, nowIdx + 6).map((t, i) => {
                  const [, ic] = wmo(hourly.weather_code[nowIdx + i]);
                  return (
                    <div key={t} style={{ flex: '0 0 auto', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, padding: '5px 9px', borderRadius: 8, background: i === 0 ? 'rgba(247,201,79,0.1)' : 'transparent' }}>
                      <span style={{ fontSize: 10, color: i === 0 ? '#f7c94f' : '#aaa' }}>
                        {i === 0 ? 'Now' : new Date(t).toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                      <span style={{ fontSize: 14 }}>{ic}</span>
                      <span style={{ fontSize: 11, color: '#d0d0e0' }}>{Math.round(hourly.temperature_2m[nowIdx + i])}&deg;</span>
                    </div>
                  );
                })}
              </div>
            )}
            {daily && (
              <div style={{ paddingTop: 8 }}>
                {daily.time.map((t, i) => {
                  const [, ic] = wmo(daily.weather_code[i]);
                  const lbl = i === 0 ? 'Today' : new Date(`${t}T12:00`).toLocaleDateString('fr-CA', { weekday: 'short' });
                  return (
                    <div key={t} style={{ display: 'flex', alignItems: 'center', padding: '4px 0', borderBottom: i < daily.time.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none' }}>
                      <span style={{ fontSize: 12, color: '#d0d0e0', width: 44, textTransform: 'capitalize' }}>{lbl}</span>
                      <span style={{ fontSize: 13, marginRight: 8 }}>{ic}</span>
                      <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end' }}>
                        <span style={{ fontSize: 12, color: '#c4c4d4' }}>{Math.round(daily.temperature_2m_min[i])}&deg;</span>
                        <div style={{ height: 3, borderRadius: 2, background: 'linear-gradient(90deg,#4f8ef7,#f7c94f)', width: 38, opacity: 0.3 }} />
                        <span style={{ fontSize: 12, color: '#dcdcec' }}>{Math.round(daily.temperature_2m_max[i])}&deg;</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    ),
  };
}
