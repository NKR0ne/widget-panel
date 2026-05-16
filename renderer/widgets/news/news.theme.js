import { PALETTE } from '../../config/widgets.js';

export function getNewsCategoryColor(label, index = 0) {
  const value = (label || '').toLowerCase();
  if (value.includes('tech')) return '#4f8ef7';
  if (value.includes('world') || value.includes('news')) return '#5cc8a8';
  if (value.includes('actual') || value.includes('info') || value.includes('nouv')) return '#5cc8a8';
  if (value.includes('sci')) return '#b07ef7';
  if (value.includes('sport')) return '#f77f4f';
  if (value.includes('fin') || value.includes('busi')) return '#f7c94f';
  if (value.includes('ai') || value.includes('ml')) return '#f74f7e';
  return PALETTE[index % PALETTE.length];
}
