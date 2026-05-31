import { api } from '../../services/electronApi.js';
import { getMockNewsForCategory } from './news.mock.js';

const MAX_ITEMS = 7;
const MAX_AGE_MS = 30 * 86400000;
const RSS_ATTEMPT_TIMEOUT_MS = 6500;
const RSS_FEED_TIMEOUT_MS = 18000;
const NEWS_IMAGE_TIMEOUT_MS = 4200;

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('RSS request timed out')), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

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
  if (enclosure?.getAttribute('type')?.startsWith('image') || /\.(?:avif|webp|jpe?g|png|gif)(?:[?#]|$)/i.test(enclosure?.getAttribute('url') || '')) {
    const url = enclosure.getAttribute('url');
    if (url) return url;
  }

  const candidates = [];
  for (const tag of ['thumbnail', 'content']) {
    const elements = Array.from(item.getElementsByTagName('media:' + tag))
      .concat(Array.from(item.getElementsByTagName(tag)));
    for (const element of elements) {
      const url = element.getAttribute('url');
      const medium = element.getAttribute('medium') || '';
      if (url && (medium === 'image' || tag === 'thumbnail' || /\.(?:avif|webp|jpe?g|png|gif)(?:[?#]|$)/i.test(url))) {
        candidates.push({
          url,
          width: parseInt(element.getAttribute('width') || '0', 10) || 0,
        });
      }
    }
  }
  candidates.sort((a, b) => b.width - a.width);
  if (candidates[0]?.url) return candidates[0].url;

  const itunesImage = item.getElementsByTagName('itunes:image')?.[0]?.getAttribute('href');
  if (itunesImage) return itunesImage;

  const imageUrl = item.querySelector('image url')?.textContent?.trim();
  if (imageUrl) return imageUrl;

  return extractHtmlImage(
    getItemText(item, 'description') ||
    getItemText(item, 'summary') ||
    getItemText(item, 'content:encoded') ||
    getItemText(item, 'content')
  );
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

function pickFromSrcset(srcset = '') {
  return String(srcset || '')
    .split(',')
    .map(part => {
      const [url, descriptor] = part.trim().split(/\s+/);
      const width = parseInt(String(descriptor || '').replace(/\D/g, ''), 10) || 0;
      return { url, width };
    })
    .filter(item => item.url)
    .sort((a, b) => b.width - a.width)[0]?.url || '';
}

function extractHtmlImage(html = '') {
  const text = String(html || '');
  const img = text.match(/<img\b[^>]*>/i)?.[0] || '';
  if (img) {
    const attr = name => img.match(new RegExp(`\\b${name}=["']([^"']+)["']`, 'i'))?.[1] || '';
    const src = attr('src') || attr('data-src') || attr('data-original') || attr('data-lazy-src') || pickFromSrcset(attr('srcset') || attr('data-srcset'));
    if (src && !/logo|icon|avatar|sprite|tracking|pixel|spacer/i.test(src)) return src;
  }

  const url = text.match(/https?:\/\/[^\s"'<>]+?\.(?:avif|webp|jpe?g|png|gif)(?:\?[^\s"'<>]*)?/i)?.[0] || '';
  return url && !/logo|icon|avatar|sprite|tracking|pixel|spacer/i.test(url) ? url : null;
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
    const rawImage = extractImage(item);
    const image = normalizeItemUrl(rawImage, link || baseUrl) || rawImage;
    return {
      id: get('guid') || link,
      title: get('title'),
      link,
      image,
      description: cleanItemText(get('description') || get('summary') || get('content:encoded')),
      author: get('dc:creator') || get('author'),
      source: getHostname(link),
      time: relTime(pubDate),
      _pubDate: pubDate,
    };
  }).filter((item) => item.title && item.link);
}

async function fetchRSSInner(url) {
  url = normalizeFeedUrl(url);
  if (!url) return null;

  try {
    if (!api.rss?.fetch) return null;
    const response = await withTimeout(api.rss.fetch(url), RSS_ATTEMPT_TIMEOUT_MS);
    if (response?.ok) {
      const items = parseRSSXml(response.text, url).slice(0, MAX_ITEMS);
      if (items.length) return items;
    }
  } catch {}

  return null;
}

async function fetchRSS(url) {
  try {
    return await withTimeout(fetchRSSInner(url), RSS_FEED_TIMEOUT_MS);
  } catch {
    return null;
  }
}

function withImageTimeout(promise) {
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve(null), NEWS_IMAGE_TIMEOUT_MS);
    promise.then(
      value => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
    );
  });
}

async function hydrateMissingItemImages(items) {
  if (!api.reader?.fetch) return items;
  const missing = items.filter(item => !item.image && item.link && item.link !== '#');
  if (!missing.length) return items;

  const hydrated = await Promise.all(items.map(async item => {
    if (item.image || !item.link || item.link === '#') return item;
    const article = await withImageTimeout(api.reader.fetch(item.link, item));
    const image = article?.image || (Array.isArray(article?.images) ? article.images.find(Boolean) : '');
    return image ? { ...item, image } : item;
  }));
  return hydrated;
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

    if (items.length) return { items: await hydrateMissingItemImages(items), demo: false };
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
