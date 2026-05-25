import { useEffect, useRef, useState } from 'react';
import Skel from '../../ui/Skel.jsx';
import { api } from '../../services/electronApi.js';
import { DEFAULT_LOC } from './weather.constants.js';
import { wmo } from './weather.format.js';
import { fetchWeather } from './weather.service.js';
import { publishStarvisContext } from '../../services/starvisContext.service.js';

const SK_WEATHER_DAILY_HEIGHT = 'wp-weather-daily-height';
const DEFAULT_DAILY_HEIGHT = 164;
const FORECAST_COLUMNS = '1.08fr 0.56fr 0.72fr 1fr 0.78fr 0.96fr';
const FORECAST_HEADERS = ['Jour', 'Ciel', 'Max', 'Pr\u00e9cip.', 'Vent', 'Min/Max'];

function formatPrecipMm(value) {
  if (value == null) return '--';
  const n = Number(value);
  if (!Number.isFinite(n)) return '--';
  if (n <= 0) return '0 mm';
  const digits = n >= 10 ? 0 : 1;
  return `${n.toLocaleString('fr-CA', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })} mm`;
}

function formatTemp(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '--';
  return `${Math.round(n)}\u00b0`;
}

function formatForecastDay(date, index) {
  if (index === 0) return 'Auj.';
  return date.toLocaleDateString('fr-CA', { weekday: 'short' });
}

export default function WeatherWidget({ location = DEFAULT_LOC }) {
  const [wx, setWx] = useState(null);
  const [status, setStatus] = useState('loading');
  const [lastUpdated, setLastUpdated] = useState(null);
  const [dailyHeight, setDailyHeight] = useState(DEFAULT_DAILY_HEIGHT);
  const hasWeatherRef = useRef(false);

  useEffect(() => {
    let alive = true;
    api.store.get(SK_WEATHER_DAILY_HEIGHT).then(value => {
      const height = parseInt(value || '0', 10);
      if (alive && height >= 110) setDailyHeight(height);
    });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const doFetch = () => {
      setStatus(hasWeatherRef.current ? 'ok' : 'loading');
      fetchWeather(location)
        .then(data => {
          if (cancelled) return;
          setWx(data);
          hasWeatherRef.current = true;
          setStatus('ok');
          setLastUpdated(Date.now());
        })
        .catch(() => {
          if (cancelled) return;
          setStatus(hasWeatherRef.current ? 'ok' : 'error');
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

  useEffect(() => {
    if (!cur) return;
    const [condition] = wmo(cur.weather_code);
    publishStarvisContext('weather', {
      title: 'Weather',
      summary: `${location.name}: ${Math.round(cur.temperature_2m)} C, ${condition}, feels ${Math.round(cur.apparent_temperature)} C, wind ${Math.round(cur.wind_speed_10m)} km/h.`,
      data: {
        location: location.name,
        current: {
          temperatureC: cur.temperature_2m,
          apparentTemperatureC: cur.apparent_temperature,
          condition,
          humidityPct: cur.relative_humidity_2m,
          windKmh: cur.wind_speed_10m,
        },
        forecast: (daily?.time || []).slice(0, 5).map((date, index) => {
          const [dayCondition] = wmo(daily.weather_code[index]);
          return {
            date,
            condition: dayCondition,
            minC: daily.temperature_2m_min[index],
            maxC: daily.temperature_2m_max[index],
            precipitationMm: daily.precipitation_sum?.[index],
            windKmh: daily.wind_speed_10m_max?.[index],
          };
        }),
      },
    });
  }, [cur, daily, location.name]);

  const onDailyResizeMouseDown = (event) => {
    event.preventDefault();
    const startY = event.clientY;
    const startH = dailyHeight;
    let nextHeight = startH;
    const onMove = (moveEvent) => {
      nextHeight = Math.max(110, Math.min(420, startH + (moveEvent.clientY - startY)));
      setDailyHeight(nextHeight);
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      api.store.set(SK_WEATHER_DAILY_HEIGHT, String(nextHeight));
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  return {
    color: '#f7c94f',
    title: 'Pr\u00e9visions',
    sub: location.name,
    lastUpdated,
    content: (
      <div>
        {status === 'loading' && <Skel n={2} />}
        {status === 'error' && (
          <div style={{ color: '#d0d0e0', fontSize: 11, padding: '8px 0' }}>
            M\u00e9t\u00e9o indisponible
          </div>
        )}
        {status === 'ok' && cur && (
          <div>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, padding: '4px 0 12px' }}>
              <span style={{ fontSize: 36, lineHeight: 1 }}>{icon}</span>
              <div>
                <div style={{ fontSize: 32, fontWeight: 300, color: '#f0f0f0', letterSpacing: -1, lineHeight: 1 }}>
                  {Math.round(cur.temperature_2m)}&deg;
                </div>
                <div style={{ fontSize: 11, color: '#d0d0e0', marginTop: 2 }}>
                  {cond} &middot; ressenti {Math.round(cur.apparent_temperature)}&deg;
                </div>
              </div>
              <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
                <div style={{ fontSize: 11, color: '#c4c4d4' }}>
                  Humidit\u00e9 <span style={{ color: '#777' }}>{cur.relative_humidity_2m}%</span>
                </div>
                <div style={{ fontSize: 11, color: '#c4c4d4', marginTop: 2 }}>
                  Vent <span style={{ color: '#777' }}>{Math.round(cur.wind_speed_10m)} km/h</span>
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
                        {i === 0 ? 'Maint.' : new Date(t).toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                      <span style={{ fontSize: 14 }}>{ic}</span>
                      <span style={{ fontSize: 11, color: '#d0d0e0' }}>{Math.round(hourly.temperature_2m[nowIdx + i])}&deg;</span>
                    </div>
                  );
                })}
              </div>
            )}
            {daily && (
              <div
                style={{
                  marginTop: 8,
                  paddingTop: 1,
                  paddingRight: 3,
                  height: dailyHeight,
                  overflowY: 'auto',
                  overflowX: 'hidden',
                  borderTop: '1px solid rgba(255,255,255,0.05)',
                }}
              >
                <div
                  style={{
                    position: 'sticky',
                    top: 0,
                    zIndex: 1,
                    display: 'grid',
                    gridTemplateColumns: FORECAST_COLUMNS,
                    columnGap: 5,
                    alignItems: 'center',
                    padding: '4px 0 5px',
                    background: 'linear-gradient(180deg, rgba(31,111,255,0.08), rgba(8,14,28,0.18))',
                    borderTop: '1px solid rgba(238,248,255,0.045)',
                    borderBottom: '1px solid rgba(238,248,255,0.075)',
                    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.045)',
                    backdropFilter: 'blur(8px)',
                    WebkitBackdropFilter: 'blur(8px)',
                  }}
                >
                  {FORECAST_HEADERS.map((header) => (
                    <span
                      key={header}
                      style={{
                        fontSize: 7.8,
                        color: 'rgba(244,248,255,0.56)',
                        textTransform: 'uppercase',
                        letterSpacing: 0.45,
                        textAlign: header === 'Jour' ? 'left' : 'center',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {header}
                    </span>
                  ))}
                </div>
                {daily.time.map((t, i) => {
                  const [, ic] = wmo(daily.weather_code[i]);
                  const dayDate = new Date(`${t}T12:00`);
                  const lbl = formatForecastDay(dayDate, i);
                  const minTemp = Math.round(daily.temperature_2m_min[i]);
                  const maxTemp = Math.round(daily.temperature_2m_max[i]);
                  const dayTemp = Number.isFinite(daily.temperature_2m_max?.[i]) ? maxTemp : null;
                  const precipSum = Number.isFinite(daily.precipitation_sum?.[i]) ? daily.precipitation_sum[i] : null;
                  const wind = Number.isFinite(daily.wind_speed_10m_max?.[i]) ? Math.round(daily.wind_speed_10m_max[i]) : null;
                  const precipLabel = formatPrecipMm(precipSum);
                  return (
                    <div
                      key={t}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: FORECAST_COLUMNS,
                        columnGap: 5,
                        alignItems: 'center',
                        padding: '6px 0',
                        borderBottom: i < daily.time.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none',
                      }}
                    >
                      <div style={{ minWidth: 0, lineHeight: 1.05 }}>
                        <div style={{ fontSize: 10, color: '#f2f2ff', textTransform: 'capitalize', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{lbl}</div>
                        <div style={{ fontSize: 9, color: 'rgba(228,228,244,0.50)', marginTop: 2 }}>{dayDate.getDate()}</div>
                      </div>
                      <span style={{ fontSize: 13, textAlign: 'center', lineHeight: 1 }}>{ic}</span>
                      <span style={{ fontSize: 14, color: '#ff6960', textAlign: 'center', lineHeight: 1, whiteSpace: 'nowrap' }}>
                        {dayTemp !== null ? formatTemp(dayTemp) : '--'}
                      </span>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: 4,
                          fontSize: 9,
                          color: precipSum && precipSum > 0 ? '#70a8ff' : 'rgba(228,228,244,0.66)',
                          lineHeight: 1.2,
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {precipSum && precipSum > 0 && <span style={{ fontSize: 8, lineHeight: 1 }}>&#9679;</span>}
                        <span>{precipLabel}</span>
                      </div>
                      <div style={{
                        width: 20,
                        height: 20,
                        borderRadius: '50%',
                        border: `1px solid ${wind && wind >= 25 ? 'rgba(247,201,79,0.72)' : 'rgba(244,250,255,0.34)'}`,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#f7faff',
                        fontSize: 9,
                        lineHeight: 1,
                        justifySelf: 'center',
                        background: 'rgba(255,255,255,0.025)',
                      }}>
                        {wind ?? '--'}
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '14px minmax(10px, 1fr) 14px', alignItems: 'center', gap: 2, justifyContent: 'stretch', minWidth: 0 }}>
                        <span style={{ fontSize: 7, color: '#c4c4d4', textAlign: 'right' }}>{minTemp}&deg;</span>
                        <div style={{ height: 3, borderRadius: 2, background: 'linear-gradient(90deg,#4f8ef7,#f7c94f)', opacity: 0.36 }} />
                        <span style={{ fontSize: 7, color: '#dcdcec', textAlign: 'right' }}>{maxTemp}&deg;</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            {daily && (
              <div onMouseDown={onDailyResizeMouseDown}
                style={{height:6,marginTop:2,marginLeft:-14,marginRight:-14,cursor:'ns-resize',
                  display:'flex',alignItems:'center',justifyContent:'center',userSelect:'none'}}>
                <div style={{width:28,height:2,borderRadius:1,background:'rgba(255,255,255,0.1)'}}/>
              </div>
            )}
          </div>
        )}
      </div>
    ),
  };
}
