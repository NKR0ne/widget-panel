export const MOCK_NEWS = [
  { id: '1', title: 'RISC-V chips are closing the gap with x86 in datacenter benchmarks', source: 'arstechnica.com', link: '#', time: '12m', image: null },
  { id: '2', title: 'Firefox 127 ships with improved memory isolation on Windows', source: 'theregister.com', link: '#', time: '34m', image: null },
  { id: '3', title: 'EU regulators open formal probe into Microsoft AI bundling practices', source: 'reuters.com', link: '#', time: '1h', image: null },
  { id: '4', title: 'Apple acquires UK startup behind on-device LLM inference engine', source: 'ft.com', link: '#', time: '2h', image: null },
  { id: '5', title: 'Nvidia Blackwell supply ramp expected to ease H200 constraints in Q3', source: 'tomshardware.com', link: '#', time: '3h', image: null },
];

export const MOCK_NEWS_FR = [
  { id: 'f1', title: 'Le gouvernement Legault depose son budget 2025 avec surplus de 1,2 G$', source: 'lapresse.ca', link: '#', time: '5m', image: null },
  { id: 'f2', title: 'Quebec annonce 800 nouveaux logements sociaux dans la region de Quebec', source: 'radio-canada.ca', link: '#', time: '28m', image: null },
  { id: 'f3', title: 'Pont de Quebec : les travaux de refection majeures debutent cet ete', source: 'lesoleil.com', link: '#', time: '1h', image: null },
  { id: 'f4', title: 'Feux de foret : alerte preventive levee pour la Cote-Nord', source: 'tvanouvelles.ca', link: '#', time: '2h', image: null },
  { id: 'f5', title: 'Le Canadien repeche en 5e position au prochain repechage LNH', source: 'rds.ca', link: '#', time: '3h', image: null },
];

export function getMockNewsForCategory(label) {
  const value = (label || '').toLowerCase();
  return value.includes('actual') || value.includes('nouv') || value.includes('info')
    ? MOCK_NEWS_FR
    : MOCK_NEWS;
}
