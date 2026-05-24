const PROXY1 = 'https://api.allorigins.win/raw?url=';
const METEO = 'https://api.open-meteo.com/v1/forecast';

export function buildWeatherUrl(location) {
  return METEO
    + `?latitude=${location.lat}&longitude=${location.lon}`
    + '&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,relative_humidity_2m'
    + '&hourly=temperature_2m,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,wind_speed_10m_max'
    + `&timezone=${encodeURIComponent(location.timezone)}&forecast_days=14`;
}

export async function fetchWeather(location) {
  const url = buildWeatherUrl(location);
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Open-Meteo HTTP ${response.status}`);
    return await response.json();
  } catch {
    const response = await fetch(PROXY1 + encodeURIComponent(url));
    if (!response.ok) throw new Error(`Weather proxy HTTP ${response.status}`);
    return response.json();
  }
}
