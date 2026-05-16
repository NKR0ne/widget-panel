export const DEFAULT_LOC = {
  name: 'L\u00e9vis, QC',
  lat: 46.8123,
  lon: -71.1756,
  timezone: 'America/Toronto',
};

export const MOCK_WX = {
  current: {
    temperature_2m: 7,
    apparent_temperature: 3,
    weather_code: 2,
    wind_speed_10m: 19,
    relative_humidity_2m: 68,
  },
  hourly: {
    time: Array.from({ length: 24 }, (_, i) => {
      const d = new Date();
      d.setHours(d.getHours() + i, 0, 0, 0);
      return d.toISOString();
    }),
    temperature_2m: [7, 8, 9, 9, 8, 6, 5, 4, 4, 5, 7, 9, 10, 10, 9, 8, 6, 5, 4, 3, 3, 3, 3, 4],
    weather_code: [2, 1, 1, 1, 2, 61, 61, 63, 63, 61, 2, 1, 1, 2, 2, 61, 61, 63, 3, 3, 3, 2, 2, 2],
  },
  daily: {
    time: Array.from({ length: 5 }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() + i);
      return d.toISOString().slice(0, 10);
    }),
    weather_code: [61, 2, 1, 2, 71],
    temperature_2m_max: [9, 14, 16, 11, 8],
    temperature_2m_min: [2, 5, 7, 4, 1],
  },
};
