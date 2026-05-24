const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const mainSource = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const start = mainSource.indexOf('function stripTags');
const end = mainSource.indexOf('function readerFetchText');

assert(start >= 0 && end > start, 'Could not locate reader parser block in main.js');

const sandbox = {
  module: { exports: {} },
  exports: {},
  URL,
  console,
};

vm.runInNewContext(
  `${mainSource.slice(start, end)}\nmodule.exports = { parseArticleHtml, parseJinaMarkdown };`,
  sandbox,
  { filename: 'reader-parser-under-test.js' },
);

const { parseArticleHtml, parseJinaMarkdown } = sandbox.module.exports;

const eetimesFixture = `
  <html>
    <head>
      <meta property="og:title" content="EDA AI Revolution Meets Its Real-World Constraints">
      <meta property="og:description" content="AI is changing EDA, but deployment constraints remain practical and technical.">
    </head>
    <body>
      <div class="site-menu">
        <ul>
          <li>News, technologies, and trends in the electronics industry</li>
        </ul>
      </div>
      <main>
        <article>
          <h1>EDA AI Revolution Meets Its Real-World Constraints</h1>
          <div class="entry-content">
            <p>Artificial intelligence is reshaping electronic design automation, but the industry is learning that useful deployment depends on data quality, trust, explainability and integration with established engineering flows.</p>
            <p>Tool vendors are moving quickly, yet users still need predictable results that can survive schedule pressure, verification complexity and the realities of semiconductor design teams.</p>
            <div>Partner Content</div>
            <h4>New Power Modules Simplify Demanding Designs</h4>
            <p>By Microchip Technology</p>
            <h4>APEC 2025 Demonstrates Better Power Density</h4>
            <p>By Vicor</p>
            <h4>Accelerating Model-Based Design for Engineers</h4>
            <p>By MathWorks</p>
            <p>The next phase of AI in EDA will require tighter feedback loops between model suggestions, human review, verification evidence and production signoff requirements.</p>
            <p>That means the winners will be tools that augment engineering judgment without obscuring how decisions were made or why a result should be trusted.</p>
            <div>Read also:</div>
            <h3>Siemens EDA expands its AI portfolio for chip design</h3>
            <p>This related article summary should not be included in the purified reader output.</p>
          </div>
        </article>
      </main>
    </body>
  </html>
`;

function assertEetimesClean(article, expectedCount) {
  assert(article.ok, 'Expected parser to extract article paragraphs');
  const text = article.paragraphs.join('\n');

  assert.match(text, /Artificial intelligence is reshaping electronic design automation/);
  assert.match(text, /The next phase of AI in EDA/);
  assert.doesNotMatch(text, /News, technologies, and trends/);
  assert.doesNotMatch(text, /Partner Content/);
  assert.doesNotMatch(text, /New Power Modules/);
  assert.doesNotMatch(text, /Microchip Technology|Vicor|MathWorks/);
  assert.doesNotMatch(text, /Read also|Siemens EDA|related article summary/);
  if (expectedCount) assert.strictEqual(article.paragraphs.length, expectedCount);
}

const article = parseArticleHtml(
  eetimesFixture,
  'https://www.eetimes.com/eda-ai-revolution-meets-its-real-world-constraints/',
  'https://www.eetimes.com/eda-ai-revolution-meets-its-real-world-constraints/',
  'fixture',
);

assertEetimesClean(article, 4);

const eetimesLooseTextFixture = `
  <html>
    <head>
      <meta property="og:title" content="EDA AI Revolution Meets Its Real-World Constraints">
      <meta property="og:description" content="AI is changing EDA, but deployment constraints remain practical and technical.">
      <meta property="og:image" content="https://example.test/ai.jpg">
    </head>
    <body>
      <div>Home</div>
      <div>Articles</div>
      <div>EDA AI Revolution Meets Its Real-World Constraints</div>
      <div>By Anne-Francoise Pele</div>
      <div>Share</div>
      <div>Artificial intelligence is reshaping electronic design automation, but the industry is learning that useful deployment depends on data quality, trust, explainability and integration with established engineering flows.</div>
      <div>Tool vendors are moving quickly, yet users still need predictable results that can survive schedule pressure, verification complexity and the realities of semiconductor design teams.</div>
      <div>Partner Content</div>
      <div>New Power Modules Simplify Demanding Designs</div>
      <div>By Microchip Technology</div>
      <div>APEC 2025 Demonstrates Better Power Density</div>
      <div>By Vicor</div>
      <div>Accelerating Model-Based Design for Engineers</div>
      <div>By MathWorks</div>
      <div>The next phase of AI in EDA will require tighter feedback loops between model suggestions, human review, verification evidence and production signoff requirements.</div>
      <div>That means the winners will be tools that augment engineering judgment without obscuring how decisions were made or why a result should be trusted.</div>
      <div>Read also:</div>
      <div>Siemens EDA expands its AI portfolio for chip design.</div>
      <div>This related article summary should not be included in the purified reader output.</div>
    </body>
  </html>
`;

const looseArticle = parseArticleHtml(
  eetimesLooseTextFixture,
  'https://www.eetimes.com/eda-ai-revolution-meets-its-real-world-constraints/',
  'https://www.eetimes.com/eda-ai-revolution-meets-its-real-world-constraints/',
  'fixture',
);

assertEetimesClean(looseArticle, 4);

const jinaFixture = `
Title: EDA AI Revolution Meets Its Real-World Constraints
URL Source: https://www.eetimes.com/eda-ai-revolution-meets-its-real-world-constraints/
Published Time: 2026-05-15T11:08:30+00:00

Markdown Content:
Navigation
News
Subscribe

# EDA AI Revolution Faces Real-World Limits - EE Times

By Anne-Francoise Pele
May 15, 2026

![AI chip](https://example.test/ai-chip.jpg)

Artificial intelligence is reshaping electronic design automation, but the industry is learning that useful deployment depends on data quality, trust, explainability and integration with established engineering flows.

Tool vendors are moving quickly, yet users still need predictable results that can survive schedule pressure, verification complexity and the realities of semiconductor design teams.

### Data management remains the AI bottleneck

The next phase of AI in EDA will require tighter feedback loops between model suggestions, human review, verification evidence and production signoff requirements.

That means the winners will be tools that augment engineering judgment without obscuring how decisions were made or why a result should be trusted.

##### Read also:

Siemens EDA expands its AI portfolio for chip design.
This related article summary should not be included in the purified reader output.
`;

const jinaArticle = parseJinaMarkdown(
  jinaFixture,
  'https://r.jina.ai/http://r.jina.ai/http://https://www.eetimes.com/eda-ai-revolution-meets-its-real-world-constraints/',
  'https://www.eetimes.com/eda-ai-revolution-meets-its-real-world-constraints/',
);

assertEetimesClean(jinaArticle, 5);
assert.strictEqual(jinaArticle.sourceLabel, 'jina');
assert.strictEqual(jinaArticle.images[0], 'https://example.test/ai-chip.jpg');

console.log(`reader cleanup tests passed (${article.paragraphs.length} tagged + ${looseArticle.paragraphs.length} loose + ${jinaArticle.paragraphs.length} proxy paragraphs)`);
