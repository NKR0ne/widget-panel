export function wmo(code) {
  if (code === 0) return ['D\u00e9gag\u00e9', '\u2600\ufe0f'];
  if (code <= 2) return ['Partiellement nuageux', '\u26c5'];
  if (code === 3) return ['Couvert', '\u2601\ufe0f'];
  if (code <= 49) return ['Brouillard', '\u{1f32b}'];
  if (code <= 59) return ['Bruine', '\u{1f326}'];
  if (code <= 69) return ['Pluie', '\u{1f327}'];
  if (code <= 79) return ['Neige', '\u2744\ufe0f'];
  if (code <= 84) return ['Averses', '\u{1f327}'];
  if (code <= 94) return ['Orage', '\u26c8'];
  return ['Temp\u00eate', '\u{1f329}'];
}
