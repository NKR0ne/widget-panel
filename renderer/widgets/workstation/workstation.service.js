import { api } from '../../services/electronApi.js';

const subscribers = new Set();
let pollTimer = null;
let currentSnapshot = null;
let connecting = false;

async function poll() {
  if (!subscribers.size || connecting) return;
  connecting = true;
  try {
    const snapshot = await api.workstation?.snapshot?.();
    if (snapshot) {
      currentSnapshot = snapshot;
      subscribers.forEach(callback => callback(snapshot));
    }
  } finally {
    connecting = false;
  }
}

export function subscribeWorkstationTelemetry(callback) {
  subscribers.add(callback);
  if (currentSnapshot) callback(currentSnapshot);

  if (!pollTimer) {
    api.workstation?.connect?.();
    poll();
    pollTimer = setInterval(poll, 1000);
  }

  return () => {
    subscribers.delete(callback);
    if (!subscribers.size) {
      clearInterval(pollTimer);
      pollTimer = null;
      currentSnapshot = null;
      api.workstation?.disconnect?.();
    }
  };
}
