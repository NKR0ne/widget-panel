const fs = require('fs');
const path = require('path');
const vm = require('vm');

const args = process.argv.slice(2);
const preview = args.includes('--preview');
const lines = args.includes('--lines');
const url = args.find(arg => !arg.startsWith('--'));
if (!url) {
  console.error('Usage: npm run debug:reader -- <article-url> [--preview]');
  process.exit(2);
}

const root = path.resolve(__dirname, '..');
const mainSource = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const start = mainSource.indexOf('function stripTags');
const end = mainSource.indexOf("ipcMain.handle('reader-fetch'");

if (start < 0 || end <= start) {
  console.error('Could not locate reader fetch block in main.js');
  process.exit(1);
}

const sandbox = {
  module: { exports: {} },
  exports: {},
  require,
  URL,
  Buffer,
  console,
  setTimeout,
  clearTimeout,
};

vm.runInNewContext(
  `${mainSource.slice(start, end)}\nmodule.exports = { fetchReaderArticle, readerFetchText, jinaReaderUrls, markdownBody, cleanMarkdownText, isMarkdownArticleMarker };`,
  sandbox,
  { filename: 'reader-fetch-under-debug.js' },
);

(async () => {
  const helpers = sandbox.module.exports;
  const article = await helpers.fetchReaderArticle(url);
  const report = {
    ok: article.ok,
    source: article.source,
    mode: article.sourceLabel,
    title: article.title,
    paragraphs: article.paragraphs?.length || 0,
    chars: (article.paragraphs || []).join(' ').length,
    images: article.images?.length || 0,
    paywall: !!article.paywall,
    error: article.error || '',
    attempts: article.attempts || [],
  };
  if (preview) {
    report.preview = (article.paragraphs || []).map(paragraph => paragraph.slice(0, 140));
  }
  if (lines) {
    const proxyUrl = helpers.jinaReaderUrls(url)[0];
    const response = await helpers.readerFetchText(proxyUrl);
    const bodyLines = helpers.markdownBody(response.text || '').split(/\r?\n/).map((line, index) => {
      const clean = helpers.cleanMarkdownText(line.trim());
      return { index, clean, marker: helpers.isMarkdownArticleMarker(clean) };
    }).filter(line => line.clean);
    const interesting = bodyLines.filter(line =>
      line.marker
      || /EDA|AI revolution|Data management|The next phase|Pedro|Pires|May 15/i.test(line.clean)
    ).slice(0, 80);
    report.lines = interesting;
  }
  console.log(JSON.stringify(report, null, 2));
})().catch(error => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
