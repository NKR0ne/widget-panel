import { api } from './electronApi.js';

const lastSent = new Map();
const MIN_UPDATE_MS = 1800;

export function publishStarvisContext(id, payload) {
  if (!id || !payload) return;
  const now = Date.now();
  const previous = lastSent.get(id) || 0;
  if (now - previous < MIN_UPDATE_MS) return;
  lastSent.set(id, now);

  try {
    api.starvis?.updateContext?.({
      id,
      updatedAt: now,
      ...payload,
    });
  } catch {}
}
