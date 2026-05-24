import { api } from '../../services/electronApi.js';

const subscribers = new Set();
const REPLAY_MAX_AGE_MS = 2500;

let pollTimer = null;
let currentSnapshot = null;
let currentSnapshotAt = 0;
let connecting = false;
let connectPromise = null;

async function poll() {
  if (!subscribers.size || connecting) return;
  connecting = true;
  try {
    await ensureConnected();
    const snapshot = await api.workstation?.snapshot?.();
    if (snapshot) {
      currentSnapshotAt = Date.now();
      currentSnapshot = { ...snapshot, receivedAt: currentSnapshotAt };
      subscribers.forEach(callback => callback(currentSnapshot));
    }
  } finally {
    connecting = false;
  }
}

function ensureConnected() {
  if (!api.workstation?.connect) return Promise.resolve();
  if (!connectPromise) {
    connectPromise = Promise.resolve(api.workstation.connect())
      .catch(() => false)
      .finally(() => { connectPromise = null; });
  }
  return connectPromise;
}

export function subscribeWorkstationTelemetry(callback) {
  subscribers.add(callback);
  if (currentSnapshot && Date.now() - currentSnapshotAt <= REPLAY_MAX_AGE_MS) {
    callback(currentSnapshot);
  }

  if (!pollTimer) {
    poll();
    pollTimer = setInterval(poll, 1000);
  } else {
    poll();
  }

  return () => {
    subscribers.delete(callback);
    if (!subscribers.size) {
      clearInterval(pollTimer);
      pollTimer = null;
      currentSnapshot = null;
      currentSnapshotAt = 0;
      api.workstation?.disconnect?.();
    }
  };
}
