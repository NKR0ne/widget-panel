import { api } from '../../services/electronApi.js';

const STORAGE = {
  session: 'wp-tv-session',
  user: 'wp-tv-user',
  listIndex: 'wp-tv-list-idx',
  cardHeight: 'wp-tv-card-height',
};

export async function getTradingViewSession() {
  return api.store.get(STORAGE.session);
}

export async function getTradingViewUser() {
  return api.store.get(STORAGE.user);
}

export async function getSavedListIndex() {
  return parseInt(await api.store.get(STORAGE.listIndex) || '0');
}

export async function getSavedCardHeight() {
  return parseInt(await api.store.get(STORAGE.cardHeight) || '0');
}

export function saveListIndex(index) {
  return api.store.set(STORAGE.listIndex, String(index));
}

export function saveCardHeight(height) {
  return api.store.set(STORAGE.cardHeight, String(height));
}

export function fetchTradingViewWatchlists(options = {}) {
  return api.tv.watchlists(options);
}

export function loginTradingView() {
  return api.tv.browserLogin();
}

export function logoutTradingView() {
  return api.tv.logout();
}

export function fetchChart(ticker) {
  return api.tv.chart(ticker);
}

export function fetchMarketEvents(options) {
  return api.tv.events(options);
}

export function openTradingViewChart(symbol) {
  return api.browser.open(`https://www.tradingview.com/chart/?symbol=${symbol}`);
}

export function setModalOpen(open) {
  if (open) api.modal?.open();
  else api.modal?.close();
}

export async function getStoredWidgetHeight(storeKey) {
  const height = parseInt(await api.store.get(storeKey) || '0');
  return height;
}

export function saveStoredWidgetHeight(storeKey, height) {
  return api.store.set(storeKey, String(height));
}
