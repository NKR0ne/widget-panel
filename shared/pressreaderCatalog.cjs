const PRESSREADER_PROXY_ORIGIN = 'https://www.pressreader.com.ezproxy.bibliothequedequebec.qc.ca';
const PRESSREADER_CATALOG_URL = `${PRESSREADER_PROXY_ORIGIN}/fr/catalog`;
const PRESSREADER_NEWSPAPERS_SOURCE_URL = `${PRESSREADER_PROXY_ORIGIN}/fr/newspapers`;

const PRESSREADER_CATEGORY_IDS = {
  news: 1124,
  businessFinance: 1069,
  sports: 1075,
  newspapers: 142606336,
  magazines: 150994944,
};

const PRESSREADER_CANADIAN_NEWSPAPER_PATTERN = /canada|qu[e\u00e9]bec|montreal|montr[e\u00e9]al|toronto|ottawa|vancouver|calgary|edmonton|winnipeg|gazette|devoir|presse|soleil|journal de|globe and mail|national post|star|province|citizen|leader-post|chronicle herald/i;
const PRESSREADER_BUSINESS_NEWSPAPER_PATTERN = /business|finance|financial|affaires|\u00e9conomie|economie|economist|bloomberg|wall street|investor|cinco d[i\u00ed]as|les affaires/i;
const PRESSREADER_DAILY_NEWSPAPER_PATTERN = /daily|journal|times|post|gazette|guardian|globe|mail|mirror|express|telegraph|independent|record|sun|observer|herald|press|standard|courier|tribune|star|today|morning|evening|le monde|le temps|lib[e\u00e9]ration|el pa[i\u00ed]s/i;
const PRESSREADER_SUNDAY_NEWSPAPER_PATTERN = /sunday|dimanche/i;
const PRESSREADER_WEEKLY_NEWSPAPER_PATTERN = /weekly|hebdo|semaine|week-end|weekend/i;
const PRESSREADER_LOCAL_NEWSPAPER_PATTERN = /qu[e\u00e9]bec|montreal|montr[e\u00e9]al|ottawa|toronto|vancouver|calgary|edmonton|winnipeg|gazette|devoir|presse|soleil|journal de|globe and mail|star|cbc|radio-canada|echos vedettes|local|regional/i;

function pressReaderSlug(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' et ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function pressReaderText(value) {
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value).trim();
  if (Array.isArray(value)) return value.map(pressReaderText).find(Boolean) || '';
  if (typeof value === 'object') {
    return pressReaderText(value.text)
      || pressReaderText(value.name)
      || pressReaderText(value.title)
      || pressReaderText(value.displayName)
      || pressReaderText(value.label)
      || pressReaderText(value.value)
      || pressReaderText(value.en)
      || pressReaderText(value.fr)
      || '';
  }
  return '';
}

function collectPressReaderValues(value, predicate, out = [], seen = new Set()) {
  if (value == null || out.length > 200) return out;
  if (typeof value === 'object') {
    if (seen.has(value)) return out;
    seen.add(value);
  }
  if (predicate(value)) out.push(value);
  if (Array.isArray(value)) {
    value.forEach(item => collectPressReaderValues(item, predicate, out, seen));
  } else if (typeof value === 'object') {
    Object.values(value).forEach(item => collectPressReaderValues(item, predicate, out, seen));
  }
  return out;
}

function findPressReaderImageUrl(value) {
  const urls = collectPressReaderValues(value, item => (
    typeof item === 'string'
    && /^https?:\/\//i.test(item)
    && /(cover|thumbnail|image|img|jpg|jpeg|png|webp|avif|pressreader|newspaperdirect|prcdn|ndcdn)/i.test(item)
  ));
  return urls[0] || '';
}

function normalizePressReaderWebUrl(raw = '') {
  if (!raw) return '';
  try {
    const parsed = new URL(raw, PRESSREADER_CATALOG_URL);
    const host = parsed.hostname.toLowerCase();
    if (host === 'pressreader.com' || host === 'www.pressreader.com') {
      const proxy = new URL(PRESSREADER_PROXY_ORIGIN);
      parsed.protocol = proxy.protocol;
      parsed.host = proxy.host;
    }
    return parsed.href;
  } catch {
    return String(raw || '');
  }
}

function findPressReaderWebUrl(value) {
  const urls = collectPressReaderValues(value, item => (
    typeof item === 'string'
    && (/^https?:\/\//i.test(item) || item.startsWith('/'))
    && /pressreader\.com|^\/[a-z]{2,}(?:\/|$)|^\/catalog(?:\/|$)/i.test(item)
    && !/(jpg|jpeg|png|webp|avif|gif)(?:[?#]|$)/i.test(item)
  ));
  return urls[0] ? normalizePressReaderWebUrl(urls[0]) : '';
}

function compactPressReaderDate(value) {
  const raw = pressReaderText(value);
  if (!raw) return '';
  const ymd = raw.match(/(20\d{2})[-/]?(\d{2})[-/]?(\d{2})/);
  return ymd ? `${ymd[1]}${ymd[2]}${ymd[3]}` : '';
}

function displayPressReaderDate(value) {
  const raw = pressReaderText(value);
  const ymd = raw.match(/(20\d{2})[-/]?(\d{2})[-/]?(\d{2})/);
  return ymd ? `${ymd[1]}-${ymd[2]}-${ymd[3]}` : raw;
}

function pressReaderIssueFor(item = {}) {
  return item?.latestIssue
    || item?.latest
    || item?.issue
    || item?.currentIssue
    || item?.lastIssue
    || {};
}

function buildPressReaderThumbnailUrl(item = {}) {
  const existing = findPressReaderImageUrl(item);
  if (existing) return existing;
  const issue = pressReaderIssueFor(item);
  const issueKey = pressReaderText(issue?.key || item?.issueKey || item?.latestIssueKey);
  if (issueKey) return `https://i.prcdn.co/img?file=${encodeURIComponent(issueKey)}&page=1&width=320`;
  const cid = pressReaderText(issue?.cid || item?.cid || item?.contentId || item?.publicationId || item?.id);
  const date = compactPressReaderDate(issue?.issueDate || item?.latestIssueDate || item?.issueDate || item?.date || item?.publicationDate);
  if (cid && date) return `https://i.prcdn.co/img?cid=${encodeURIComponent(cid)}&date=${date}&page=1&width=320`;
  return '';
}

function buildPressReaderPublicationUrl(item = {}) {
  const existing = findPressReaderWebUrl(item);
  if (existing) return existing;
  const title = pressReaderText(item?.slug || item?.urlSlug || item?.titleSlug || item?.name || item?.title || item?.displayName);
  const country = pressReaderText(item?.country?.slug || item?.countrySlug || item?.country?.name || item?.countryName || item?.country);
  if (title && country) return normalizePressReaderWebUrl(`/${pressReaderSlug(country)}/${pressReaderSlug(title)}`);
  const cid = pressReaderText(item?.cid || item?.contentId || item?.publicationId || item?.id);
  if (cid) return `${PRESSREADER_CATALOG_URL}/${encodeURIComponent(cid)}`;
  return '';
}

function findPressReaderPublicationArray(data) {
  const arrays = collectPressReaderValues(data, item => (
    Array.isArray(item)
    && item.some(child => child && typeof child === 'object' && (pressReaderText(child.title || child.name || child.displayName) || findPressReaderImageUrl(child)))
  ));
  return arrays.sort((a, b) => b.length - a.length)[0] || [];
}

function pressReaderCatalogEndpoint({ offset = 0, limit = 30, orderBy = 'searchrank desc', filters = {} } = {}) {
  const params = new URLSearchParams();
  params.set('offset', String(Math.max(0, Number(offset) || 0)));
  params.set('limit', String(Math.max(1, Math.min(100, Number(limit) || 30))));
  if (orderBy) params.set('orderBy', orderBy);
  if (filters.has?.length) params.set('has', filters.has.join(','));
  if (filters.in?.length) params.set('in', Array.isArray(filters.in[0]) ? filters.in.map(group => group.join(',')).join('&in=') : filters.in.join(','));
  if (filters.exc?.length) params.set('exc', filters.exc.join(','));
  if (filters.cid?.length) params.set('cid', filters.cid.join(','));
  if (filters.releaseFrequency) params.set('releaseFrequency', String(filters.releaseFrequency));
  if (filters.issueDate) params.set('issueDate', String(filters.issueDate));
  return `/services/catalog/v2/publications?${params.toString().replace(/%26in%3D/g, '&in=')}`;
}

function pressReaderTodayIssueDate() {
  const now = new Date();
  return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
}

function pressReaderNewspaperSectionRequests() {
  const newspaper = PRESSREADER_CATEGORY_IDS.newspapers;
  const section = (id, title, endpoints, options = {}) => ({ id, title, endpoints, ...options });
  return [
    section('featured', 'En vedette', [
      pressReaderCatalogEndpoint({ offset: 0, limit: 24, orderBy: 'searchrank desc', filters: { has: [newspaper] } }),
    ]),
    section('local', 'Local', [], {
      deriveFromAll: item => PRESSREADER_LOCAL_NEWSPAPER_PATTERN.test(pressReaderSearchText(item)),
    }),
    section('national', 'National', [], {
      deriveFromAll: item => PRESSREADER_CANADIAN_NEWSPAPER_PATTERN.test(pressReaderSearchText(item)),
    }),
    section('international', 'International', [], {
      deriveFromAll: item => !PRESSREADER_CANADIAN_NEWSPAPER_PATTERN.test(pressReaderSearchText(item)),
    }),
    section('daily', 'Quotidien', [
      pressReaderCatalogEndpoint({ offset: 0, limit: 24, orderBy: 'rank desc', filters: { has: [newspaper], releaseFrequency: 'Daily' } }),
    ], {
      fallbackFromAll: item => PRESSREADER_DAILY_NEWSPAPER_PATTERN.test(pressReaderSearchText(item)),
    }),
    section('weekly', 'Hebdomadaire', [
      pressReaderCatalogEndpoint({ offset: 0, limit: 24, orderBy: 'rank desc', filters: { has: [newspaper], releaseFrequency: 'Weekly' } }),
    ], {
      fallbackFromAll: item => PRESSREADER_WEEKLY_NEWSPAPER_PATTERN.test(pressReaderSearchText(item)),
    }),
    section('today', "Aujourd'hui", [
      pressReaderCatalogEndpoint({ offset: 0, limit: 24, orderBy: 'rank desc', filters: { has: [newspaper], issueDate: pressReaderTodayIssueDate() } }),
    ]),
    section('sunday', 'Dimanche', [
      pressReaderCatalogEndpoint({ offset: 0, limit: 24, orderBy: 'rank desc', filters: { has: [newspaper], releaseFrequency: 'Sunday' } }),
    ], {
      fallbackFromAll: item => PRESSREADER_SUNDAY_NEWSPAPER_PATTERN.test(pressReaderSearchText(item)),
    }),
    section('sports', 'Sports', [
      pressReaderCatalogEndpoint({ offset: 0, limit: 24, orderBy: 'rank desc', filters: { has: [newspaper, PRESSREADER_CATEGORY_IDS.sports] } }),
    ], {
      fallbackFromAll: item => /sports?|hockey|football|soccer|tennis|baseball|basketball|golf|nhl|nfl|mlb|nba/i.test(pressReaderSearchText(item)),
    }),
    section('business-current-affairs', 'Affaires et actualites', [
      pressReaderCatalogEndpoint({ offset: 0, limit: 24, orderBy: 'rank desc', filters: { has: [newspaper, PRESSREADER_CATEGORY_IDS.businessFinance] } }),
    ], {
      fallbackFromAll: item => PRESSREADER_BUSINESS_NEWSPAPER_PATTERN.test(pressReaderSearchText(item)),
    }),
    section('all-news', 'Tous les journaux', [0, 30, 60].map(offset => pressReaderCatalogEndpoint({
      offset,
      limit: 30,
      orderBy: 'searchrank desc',
      filters: { has: [newspaper] },
    }))),
  ];
}

function pressReaderFallbackNewspaperEndpoints() {
  return [0, 30, 60].map(offset => pressReaderCatalogEndpoint({
    offset,
    limit: 30,
    orderBy: 'latestIssueDate desc',
    filters: { has: [PRESSREADER_CATEGORY_IDS.newspapers] },
  }));
}

function pressReaderMetadataText(item = {}, keys = []) {
  for (const key of keys) {
    const direct = pressReaderText(item?.[key]);
    if (direct) return direct;
  }
  const values = collectPressReaderValues(item, value => (
    value && typeof value === 'object' && keys.some(key => Object.prototype.hasOwnProperty.call(value, key))
  ));
  for (const value of values) {
    for (const key of keys) {
      const text = pressReaderText(value?.[key]);
      if (text) return text;
    }
  }
  return '';
}

function pressReaderSearchText(item = {}) {
  return [
    item.title,
    item.categoryTitle,
    item.country,
    item.language,
    item.publisher,
    item.frequency,
    item.cid,
  ].filter(Boolean).join(' ');
}

function sortPressReaderPublications(items = []) {
  return [...items].sort((a, b) => (
    (b.issueDate || '').localeCompare(a.issueDate || '')
    || String(a.title || '').localeCompare(String(b.title || ''))
  ));
}

function normalizePressReaderTitleForRank(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, 'and')
    .replace(/\([^)]*\)/g, '')
    .replace(/[^a-z0-9]+/gi, ' ')
    .trim()
    .toLowerCase();
}

function uniquePressReaderPublications(items = [], limit = 36) {
  const seen = new Set();
  return items.filter(item => {
    const key = item.cid || item.url || item.openUrl || item.image || item.thumbnailUrl || normalizePressReaderTitleForRank(item.title);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, limit);
}

function normalizePressReaderApiPublication(item, index = 0, category = {}) {
  const issue = pressReaderIssueFor(item);
  const title = pressReaderText(item?.title)
    || pressReaderText(item?.name)
    || pressReaderText(item?.displayName)
    || pressReaderText(item?.publicationName)
    || pressReaderText(item)
    || `Publication ${index + 1}`;
  const cid = pressReaderText(issue?.cid || item?.cid || item?.contentId || item?.publicationId || item?.id);
  const issueDate = displayPressReaderDate(issue?.issueDate || item?.latestIssueDate || item?.issueDate || item?.date || item?.publicationDate);
  const country = pressReaderMetadataText(item, ['countryName', 'country', 'regionName', 'region', 'iso']);
  const language = pressReaderMetadataText(item, ['languageName', 'language', 'lang', 'culture']);
  const publisher = pressReaderMetadataText(item, ['publisherName', 'publisher', 'providerName']);
  const frequency = pressReaderMetadataText(item, ['releaseFrequency', 'frequency', 'periodicity', 'schedule']);
  const thumbnailUrl = buildPressReaderThumbnailUrl(item);
  const openUrl = buildPressReaderPublicationUrl(item);
  const key = pressReaderText(issue?.key || item?.key) || cid || `${category.id || 'pressreader'}-${title}-${index}`;
  return {
    id: key,
    key,
    title,
    image: thumbnailUrl,
    thumbnailUrl,
    url: openUrl,
    openUrl,
    issueDate,
    cid,
    country,
    language,
    publisher,
    frequency,
    categoryId: category.id || 'actualites',
    categoryTitle: category.title || 'Actualites',
    source: 'PressReader API',
  };
}

function normalizePressReaderPages(pages = [], category = {}) {
  const seenItems = new Set();
  return pages
    .flatMap(page => findPressReaderPublicationArray(page?.data))
    .map((item, index) => normalizePressReaderApiPublication(item, index, category))
    .filter(item => item.title || item.thumbnailUrl || item.openUrl)
    .filter(item => {
      const key = item.cid || item.openUrl || item.thumbnailUrl || item.title;
      if (!key || seenItems.has(key)) return false;
      seenItems.add(key);
      return true;
    });
}

async function fetchEndpointGroup(endpoints = [], fetchPage) {
  if (!endpoints.length) return { pages: [], failed: null };
  const pages = await Promise.all(endpoints.map(endpoint => fetchPage(endpoint)));
  const failed = pages.find(page => !page?.ok);
  return { pages: failed ? [] : pages, failed: failed || null };
}

async function buildPressReaderNewspaperCategory(request = {}, fetchPage) {
  if (typeof fetchPage !== 'function') {
    return { ok: false, error: 'Missing PressReader catalog fetcher' };
  }
  const category = {
    id: String(request.categoryId || request.id || 'actualites'),
    title: String(request.title || 'Actualites'),
    mediaType: 'newspapers',
  };
  const sectionRequests = pressReaderNewspaperSectionRequests();
  const sectionResults = await Promise.all(sectionRequests.map(async section => {
    const result = await fetchEndpointGroup(section.endpoints, fetchPage);
    return { section, ...result };
  }));
  const firstFailure = sectionResults.find(result => result.failed)?.failed;
  if (firstFailure?.needsInspect) {
    return {
      ok: false,
      needsInspect: true,
      error: firstFailure.error || 'PressReader API auth was not observed yet.',
      category,
      sourceUrl: PRESSREADER_NEWSPAPERS_SOURCE_URL,
    };
  }

  let allItems = normalizePressReaderPages(
    sectionResults.find(result => result.section.id === 'all-news')?.pages || [],
    { id: category.id, title: 'Tous les journaux' }
  );
  if (!allItems.length) {
    const fallbackPages = await Promise.all(pressReaderFallbackNewspaperEndpoints().map(endpoint => fetchPage(endpoint)));
    const failedFallback = fallbackPages.find(page => !page?.ok);
    if (failedFallback) {
      return {
        ok: false,
        needsInspect: !!failedFallback.needsInspect,
        error: failedFallback.error || 'PressReader publications fetch failed.',
        category,
        sourceUrl: PRESSREADER_NEWSPAPERS_SOURCE_URL,
      };
    }
    allItems = normalizePressReaderPages(fallbackPages, category);
  }

  const sortedAllItems = sortPressReaderPublications(allItems);
  const subcategories = sectionResults
    .map(({ section, pages }) => {
      let publications = normalizePressReaderPages(pages, { id: category.id, title: section.title });
      if (!publications.length && section.deriveFromAll) publications = sortedAllItems.filter(section.deriveFromAll);
      if (!publications.length && section.fallbackFromAll) publications = sortedAllItems.filter(section.fallbackFromAll);
      publications = uniquePressReaderPublications(sortPressReaderPublications(publications), 30);
      return {
        id: section.id,
        title: section.title,
        count: publications.length,
        publications,
        items: publications,
      };
    })
    .filter(section => section.publications.length);

  const publications = uniquePressReaderPublications(
    [...subcategories.flatMap(section => section.publications), ...sortedAllItems],
    140
  );

  return {
    ok: true,
    category,
    sectionLabel: 'Journaux',
    sourceUrl: PRESSREADER_NEWSPAPERS_SOURCE_URL,
    updatedAt: Date.now(),
    count: publications.length,
    publications,
    items: publications,
    subcategories,
    sections: subcategories,
  };
}

async function buildPressReaderCategoryCatalog(request = {}, fetchPage) {
  const mediaType = String(request.mediaType || '').toLowerCase();
  const categoryText = `${request.categoryId || request.id || ''} ${request.title || ''}`;
  if (mediaType === 'newspapers' || /actualit|news|journaux|newspaper/i.test(pressReaderSlug(categoryText))) {
    return buildPressReaderNewspaperCategory(request, fetchPage);
  }
  return {
    ok: false,
    error: `Unsupported PressReader category: ${request.title || request.categoryId || 'unknown'}`,
  };
}

module.exports = {
  PRESSREADER_CATEGORY_IDS,
  PRESSREADER_NEWSPAPERS_SOURCE_URL,
  buildPressReaderCategoryCatalog,
  buildPressReaderNewspaperCategory,
  normalizePressReaderApiPublication,
  pressReaderCatalogEndpoint,
  pressReaderNewspaperSectionRequests,
  pressReaderSlug,
  uniquePressReaderPublications,
};
