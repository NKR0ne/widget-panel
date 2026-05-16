import { SK_EURONEWS_HEIGHT } from '../../config/storageKeys.js';
import { api } from '../../services/electronApi.js';
import { DEFAULT_EURONEWS_HEIGHT, HLS_JS_URL, MIN_EURONEWS_HEIGHT } from './euronews.constants.js';

let hlsLoadingPromise = null;

export function loadHlsJs() {
  if (window.Hls) return Promise.resolve(window.Hls);
  if (hlsLoadingPromise) return hlsLoadingPromise;
  hlsLoadingPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = HLS_JS_URL;
    script.async = true;
    script.onload = () => resolve(window.Hls);
    script.onerror = () => {
      hlsLoadingPromise = null;
      reject(new Error('hls.js load failed'));
    };
    document.head.appendChild(script);
  });
  return hlsLoadingPromise;
}

export async function loadEuronewsHeight() {
  try {
    const stored = await api.store.get(SK_EURONEWS_HEIGHT);
    const height = parseInt(stored || '0', 10);
    return height >= MIN_EURONEWS_HEIGHT ? height : DEFAULT_EURONEWS_HEIGHT;
  } catch {
    return DEFAULT_EURONEWS_HEIGHT;
  }
}

export async function saveEuronewsHeight(height) {
  try {
    await api.store.set(SK_EURONEWS_HEIGHT, String(height));
  } catch {}
}
