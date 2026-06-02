import { api } from './electronApi.js';

const lastSent = new Map();
const MIN_UPDATE_MS = 1800;

export function publishStarvisContext(id, payload) {
  if (!id || !payload) return;
  const now = Date.now();
  const previous = lastSent.get(id) || 0;
  const force = !!payload.force;
  if (!force && now - previous < MIN_UPDATE_MS) return;
  lastSent.set(id, now);

  try {
    const { force: _force, ...safePayload } = payload;
    api.starvis?.updateContext?.({
      id,
      updatedAt: now,
      ...safePayload,
    });
  } catch {}
}
