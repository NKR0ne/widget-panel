export function wmo(code) {
  if (code === 0) return ['Clear', '\u2600\ufe0f'];
  if (code <= 2) return ['Partly cloudy', '\u26c5'];
  if (code === 3) return ['Overcast', '\u2601\ufe0f'];
  if (code <= 49) return ['Foggy', '\u{1f32b}'];
  if (code <= 59) return ['Drizzle', '\u{1f326}'];
  if (code <= 69) return ['Rain', '\u{1f327}'];
  if (code <= 79) return ['Snow', '\u2744\ufe0f'];
  if (code <= 84) return ['Showers', '\u{1f327}'];
  if (code <= 94) return ['Thunderstorm', '\u26c8'];
  return ['Storm', '\u{1f329}'];
}
