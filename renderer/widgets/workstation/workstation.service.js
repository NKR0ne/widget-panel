import { api } from '../../services/electronApi.js';
import { publishStarvisContext } from '../../services/starvisContext.service.js';

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
      publishStarvisContext('workstation', {
        title: 'Workstation telemetry',
        summary: [
          snapshot.cpu ? `CPU ${Math.round(snapshot.cpu.usagePct || 0)}% ${Math.round(snapshot.cpu.temperatureC || 0)}C` : '',
          snapshot.gpu ? `GPU ${Math.round(snapshot.gpu.usagePct || 0)}% ${Math.round(snapshot.gpu.temperatureC || 0)}C` : '',
          snapshot.ram ? `RAM ${Math.round(snapshot.ram.usedPct || 0)}%` : '',
          snapshot.network ? `Net down ${Number(snapshot.network.downMbps || 0).toFixed(1)} Mbps up ${Number(snapshot.network.upMbps || 0).toFixed(1)} Mbps` : '',
        ].filter(Boolean).join(' | '),
        data: {
          sampling: snapshot.sampling,
          stale: snapshot.stale,
          cpu: snapshot.cpu ? {
            name: snapshot.cpu.name,
            usagePct: snapshot.cpu.usagePct,
            temperatureC: snapshot.cpu.temperatureC,
            powerW: snapshot.cpu.powerW,
            frequencyMHz: snapshot.cpu.frequencyMHz,
          } : null,
          gpu: snapshot.gpu ? {
            name: snapshot.gpu.name,
            usagePct: snapshot.gpu.usagePct,
            temperatureC: snapshot.gpu.temperatureC,
            powerW: snapshot.gpu.powerW,
            vramUsedMB: snapshot.gpu.vramUsedMB,
            vramTotalMB: snapshot.gpu.vramTotalMB,
          } : null,
          ram: snapshot.ram ? {
            usedPct: snapshot.ram.usedPct,
            availableGB: snapshot.ram.availableGB,
            totalGB: snapshot.ram.totalGB,
          } : null,
          disk: snapshot.disk ? {
            model: snapshot.disk.model,
            activityPct: snapshot.disk.activityPct,
          } : null,
          network: snapshot.network ? {
            adapter: snapshot.network.adapter,
            downMbps: snapshot.network.downMbps,
            upMbps: snapshot.network.upMbps,
            valid: snapshot.network.valid,
          } : null,
        },
      });
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
