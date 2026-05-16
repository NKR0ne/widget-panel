import { SK_CONFIG } from '../config/storageKeys.js';
import { api } from './electronApi.js';

export async function storageSave(data) {
  try {
    await api.store.set(SK_CONFIG, JSON.stringify(data));
  } catch {}
}

export async function storageLoad() {
  try {
    const raw = await api.store.get(SK_CONFIG);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
