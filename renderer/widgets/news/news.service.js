import { api } from '../../services/electronApi.js';
import { getMockNewsForCategory } from './news.mock.js';

const RSS_PROXY_RAW = 'https://api.allorigins.win/raw?url=';
const RSS_PROXY_JSON = 'https://api.rss2json.com/v1/api.json?rss_url=';
const CORS_PROXY = 'https://corsproxy.io/?';
const MAX_ITEMS = 7;
const MAX_AGE_MS = 30 * 86400000;
const REFRESH_BUCKET_MS = 5 * 60 * 1000;

function normalizeFeedUrl(url) {
  const raw = (url || '').trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    if (/\.?lapresse\.ca$/i.test(parsed.hostname) && parsed.pathname === '/actualites/societe/rss') {
      parsed.pathname = '/societe/rss';
      return parsed.href;
    }
    return parsed.href;
  } catch {
    return raw;
  }
}

function relTime(value) {
  if (!value) return '';
  const seconds = (Date.now() - new Date(value)) / 1000;
  if (seconds < 60) return Math.floor(seconds) + 's';
  if (seconds < 3600) return Math.floor(seconds / 60) + 'm';
  if (seconds < 86400) return Math.floor(seconds / 3600) + 'h';
  return Math.floor(seconds / 86400) + 'd';
}

export function parseOPML(xml) {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const categories = {};

  Array.from(doc.querySelectorAll('body > outline')).forEach((top) => {
    const children = Array.from(top.querySelectorAll('outline[xmlUrl]'));
    if (!children.length) {
      const url = normalizeFeedUrl(top.getAttribute('xmlUrl'));
      if (url) {
        if (!categories.Uncategorized) categories.Uncategorized = { label: 'Uncategorized', feeds: [] };
        categories.Uncategorized.feeds.push({ url, title: top.getAttribute('title') || url });
      }
      return;
    }

    const label = top.getAttribute('title') || top.getAttribute('text') || 'Category';
    if (!categories[label]) categories[label] = { label, feeds: [] };
    children.forEach((feed) => {
      const url = normalizeFeedUrl(feed.getAttribute('xmlUrl'));
      if (url) categories[label].feeds.push({ url, title: feed.getAttribute('title') || url });
    });
  });

  return Object.values(categories);
}

function extractImage(item) {
  const enclosure = item.querySelector('enclosure');
  if (enclosure?.getAttribute('type')?.startsWith('image')) {
    const url = enclosure.getAttribute('url');
    if (url) return url;
  }

  for (const tag of ['thumbnail', 'content']) {
    const elements = Array.from(item.getElementsByTagName('media:' + tag))
      .concat(Array.from(item.getElementsByTagName(tag)));
    for (const element of elements) {
      const url = element.getAttribute('url');
      const medium = element.getAttribute('medium') || '';
      if (url && (medium === 'image' || tag === 'thumbnail')) return url;
    }
  }

  const imageUrl = item.querySelector('image url')?.textContent?.trim();
  return imageUrl || null;
}

function normalizeItemUrl(value, baseUrl = '') {
  const raw = (value || '').trim();
  if (!raw || raw === '#') return '';
  try {
    const url = baseUrl ? new URL(raw, baseUrl) : new URL(raw);
    return /^https?:$/i.test(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
}

function cleanItemText(value = '') {
  return value
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getItemText(item, tag) {
  try {
    const direct = item.querySelector(tag)?.textContent?.trim();
    if (direct) return direct;
  } catch {}
  return item.getElementsByTagName(tag)?.[0]?.textContent?.trim() || '';
}

function extractLink(item, baseUrl = '') {
  const atomLinks = Array.from(item.querySelectorAll('link[href]'));
  const preferredAtom = atomLinks.find(link => {
    const rel = (link.getAttribute('rel') || 'alternate').toLowerCase();
    return rel === 'alternate' || rel === '';
  }) || atomLinks[0];

  const guid = item.querySelector('guid');
  const guidValue = guid?.getAttribute('isPermaLink') !== 'false' ? guid?.textContent?.trim() : '';
  const candidates = [
    preferredAtom?.getAttribute('href'),
    item.querySelector('link')?.textContent?.trim(),
    guidValue,
    item.querySelector('id')?.textContent?.trim(),
  ];

  for (const candidate of candidates) {
    const url = normalizeItemUrl(candidate, baseUrl);
    if (url) return url;
  }
  return '';
}

export function parseRSSXml(xml, baseUrl = '') {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  return Array.from(doc.querySelectorAll('item, entry')).map((item) => {
    const get = (tag) => getItemText(item, tag);
    const link = extractLink(item, baseUrl);
    const pubDate = get('pubDate') || get('published') || get('updated');
    return {
      id: get('guid') || link,
      title: get('title'),
      link,
      image: extractImage(item),
      description: cleanItemText(get('description') || get('summary') || get('content:encoded')),
      author: get('dc:creator') || get('author'),
      source: getHostname(link),
      time: relTime(pubDate),
      _pubDate: pubDate,
    };
  }).filter((item) => item.title && item.link);
}

async function fetchRSS(url) {
  url = normalizeFeedUrl(url);
  if (!url) return null;
  const bucket = Math.floor(Date.now() / REFRESH_BUCKET_MS);
  const cacheBustedUrl = url + (url.includes('?') ? '&' : '?') + `_cb=${bucket}`;

  try {
    const response = await api.rss.fetch(url);
    if (response?.ok) {
      const items = parseRSSXml(response.text, url).slice(0, MAX_ITEMS);
      if (items.length) return items;
    }
  } catch {}

  try {
    const response = await fetch(RSS_PROXY_RAW + encodeURIComponent(cacheBustedUrl));
    if (response.ok) {
      const items = parseRSSXml(await response.text(), url).slice(0, MAX_ITEMS);
      if (items.length) return items;
    }
  } catch {}

  try {
    const response = await fetch(RSS_PROXY_JSON + encodeURIComponent(cacheBustedUrl) + '&count=6');
    const data = await response.json();
    if (data.status === 'ok') {
      return data.items.map((item) => ({
        id: item.guid || item.link,
        title: item.title,
        link: item.link,
        image: item.thumbnail || item.enclosure?.link || null,
        description: cleanItemText(item.description || item.content || ''),
        author: item.author || '',
        source: getHostname(item.link),
        time: relTime(item.pubDate),
      }));
    }
  } catch {}

  try {
    const response = await fetch(CORS_PROXY + encodeURIComponent(cacheBustedUrl));
    if (response.ok) {
      const items = parseRSSXml(await response.text(), url).slice(0, MAX_ITEMS);
      if (items.length) return items;
    }
  } catch {}

  return null;
}

export async function fetchCategoryNews(category) {
  if (!category.feeds?.length) {
    return { items: getMockNewsForCategory(category.label), demo: true };
  }

  try {
    const results = await Promise.all(category.feeds.map((feed) => fetchRSS(feed.url)));
    const cutoff = Date.now() - MAX_AGE_MS;
    const items = results.flat().filter(Boolean)
      .filter((item, index, all) => all.findIndex((other) => other.id === item.id) === index)
      .filter((item) => {
        const date = new Date(item._pubDate);
        return !item._pubDate || Number.isNaN(date.getTime()) || date.getTime() > cutoff;
      })
      .sort((a, b) => new Date(b._pubDate || 0) - new Date(a._pubDate || 0))
      .slice(0, MAX_ITEMS);

    if (items.length) return { items, demo: false };
  } catch {}

  return { items: getMockNewsForCategory(category.label), demo: true };
}

function getHostname(url) {
  try {
    return new URL(url).hostname.replace('www.', '');
  } catch {
    return '';
  }
}
