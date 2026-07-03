/**
 * Preview fidelity harness: extracts a styled synthetic page with the real
 * pipeline in Chrome, rebuilds the preview document with the Reconstruction
 * Engine, renders IT in Chrome too, and compares computed styles and geometry
 * between source and preview element by element. Guards the "fonts/sizes are
 * wrong in the builder" and "absolute elements jump around" regressions, for
 * both full-page and picked-element scope. Also asserts no `var(...)`
 * survives into preview CSS or export JSON.
 */

import http from 'node:http';
import { resolve } from 'node:path';
import puppeteer from 'puppeteer-core';

const ROOT = resolve(import.meta.dirname, '../..');
const PORT = 8124;
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const TEST_PAGE = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<link rel="stylesheet" href="/theme/style.css">
<!-- different host string = different origin: CSSOM access throws, the
     @font-face inside must be recovered by fetching the css text -->
<link rel="stylesheet" href="http://127.0.0.1:${PORT}/gf.css">
<style>
  :root { --brand: #e91e63; --fs-hero: 40px; --e-global-color-accent: #00bcd4; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: ThemeFont, Georgia, serif; font-size: 17px; color: #222233; }
  .page { width: 1100px; margin: 0 auto; }
  .hero { position: relative; display: flex; flex-direction: column; gap: 16px;
          padding: 60px 40px; background: #f7f3ee; }
  /* font declared on a wrapper the DOM analyzer will likely SKIP */
  .hero-inner { font-family: Verdana, sans-serif; }
  .hero h1 { font-size: var(--fs-hero); color: var(--brand); font-weight: 800; margin: 0; }
  .hero p { line-height: 1.8; margin: 0; }
  .btn { display: inline-block; background: var(--brand); color: #ffffff; padding: 14px 34px;
         border-radius: 8px; text-decoration: none; font-size: 15px; font-weight: 700; }
  /* absolute badge: containing block is .hero, NOT its direct parent .hero-inner.
     Uses the webfont so the picked-element preview must trigger its load. */
  .badge { position: absolute; top: 24px; right: 32px; width: 90px; height: 34px;
           background: #ff9800; color: #fff; font-size: 13px; text-align: center;
           line-height: 34px; border-radius: 17px; font-family: ThemeFont, Arial, sans-serif; }
  .elementor-widget-heading .elementor-heading-title { font-size: 28px; color: var(--e-global-color-accent);
         font-weight: 600; margin: 0; }
  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; padding: 40px; }
  .cell { border: 1px solid #ddd; border-radius: 10px; padding: 24px; }
  .cell h3 { font-size: 21px; margin: 0 0 8px; }
</style>
</head>
<body>
<div class="page">
  <section class="hero" id="src-hero">
    <div class="hero-inner">
      <h1 id="src-h1">Big hero title</h1>
      <p id="src-p">A paragraph of introduction text that inherits the wrapper font and body size.</p>
      <a id="src-btn" class="btn" href="/x">Get started</a>
      <span id="src-badge" class="badge">NEW OFFER</span>
    </div>
  </section>
  <div data-element_type="widget" data-widget_type="heading.default" class="elementor-widget-heading">
    <div class="elementor-widget-container">
      <h2 id="src-h2" class="elementor-heading-title">Elementor style heading</h2>
    </div>
  </div>
  <section class="grid" id="src-grid">
    <div class="cell"><h3>Cell one</h3><p>Grid body text one.</p></div>
    <div class="cell"><h3>Cell two</h3><p>Grid body text two.</p></div>
    <div class="cell"><h3>Cell three</h3><p>Grid body text three.</p></div>
  </section>
</div>
</body>
</html>`;

/* ---------------- serve repo + test page + fonts ---------------- */

// @font-face fixtures: theme css uses a RELATIVE font url (must resolve
// against the sheet, not the page); gf.css sits on another origin.
const FIXTURES = {
  '/theme/style.css': ['text/css',
    '@font-face{font-family:ThemeFont;src:url(fonts/theme.woff2) format("woff2");font-weight:400;font-style:normal}'],
  '/gf.css': ['text/css',
    `@font-face{font-family:RemoteFont;src:url(http://127.0.0.1:${PORT}/theme/fonts/remote.woff2) format("woff2")}`],
  '/theme/fonts/theme.woff2': ['font/woff2', 'not-a-real-font'],
  '/theme/fonts/remote.woff2': ['font/woff2', 'not-a-real-font'],
};

const hits = [];
const server = http.createServer(async (req, res) => {
  try {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    hits.push(path);
    const cors = { 'access-control-allow-origin': '*' };
    if (path === '/__test__.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', ...cors });
      res.end(TEST_PAGE);
      return;
    }
    if (FIXTURES[path]) {
      res.writeHead(200, { 'content-type': FIXTURES[path][0], ...cors });
      res.end(FIXTURES[path][1]);
      return;
    }
    const { readFile } = await import('node:fs/promises');
    const body = await readFile(resolve(ROOT, '.' + path)); // read BEFORE writeHead
    res.writeHead(200, { 'content-type': path.endsWith('.js') ? 'text/javascript' : 'application/octet-stream', ...cors });
    res.end(body);
  } catch {
    if (!res.headersSent) res.writeHead(404);
    res.end();
  }
});
await new Promise((r) => server.listen(PORT, r));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--window-size=1440,900'],
  defaultViewport: { width: 1440, height: 900 },
});

const METRIC_IDS = ['src-h1', 'src-p', 'src-btn', 'src-h2'];

/* ---------------- 1) extract on the source page (both scopes) ---------------- */

const page = await browser.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 200)));
await page.goto(`http://localhost:${PORT}/__test__.html`, { waitUntil: 'networkidle2' });

const extraction = await page.evaluate(async (port, ids) => {
  const base = `http://localhost:${port}/extension/src`;
  const { ExtractionPipeline } = await import(`${base}/core/ExtractionPipeline.js`);
  const { DomAnalysisEngine } = await import(`${base}/engines/dom/DomAnalysisEngine.js`);
  const { ContentExtractionEngine } = await import(`${base}/engines/content/ContentExtractionEngine.js`);
  const { CssInterpretationEngine } = await import(`${base}/engines/css/CssInterpretationEngine.js`);
  const { ResponsiveAnalysisEngine } = await import(`${base}/engines/responsive/ResponsiveAnalysisEngine.js`);
  const { AssetCollectionEngine } = await import(`${base}/engines/assets/AssetCollectionEngine.js`);
  const { WidgetMappingEngine } = await import(`${base}/engines/mapping/WidgetMappingEngine.js`);

  const makePipeline = () => new ExtractionPipeline([
    { name: 'dom-analysis', engine: new DomAnalysisEngine() },
    { name: 'content-extraction', engine: new ContentExtractionEngine() },
    { name: 'css-interpretation', engine: new CssInterpretationEngine() },
    { name: 'responsive-analysis', engine: new ResponsiveAnalysisEngine() },
    { name: 'asset-collection', engine: new AssetCollectionEngine() },
    { name: 'widget-mapping', engine: new WidgetMappingEngine() },
  ]);

  const snapshot = await makePipeline().run(document, document.body);
  // "Pick an element" scope: the hero section is the extraction root.
  const heroSnapshot = await makePipeline().run(document, document.getElementById('src-hero'));

  const source = {};
  for (const id of ids) {
    const el = document.getElementById(id);
    const s = getComputedStyle(el);
    source[id] = {
      fontSize: s.fontSize,
      fontFamily: s.fontFamily.split(',')[0].replace(/['"]/g, '').trim(),
      fontWeight: s.fontWeight,
      color: s.color,
      background: s.backgroundColor,
      text: el.textContent.trim(),
    };
  }
  // Badge geometry relative to its containing block (.hero).
  const hero = document.getElementById('src-hero').getBoundingClientRect();
  const badge = document.getElementById('src-badge').getBoundingClientRect();
  source.badgeOffset = {
    top: badge.top - hero.top,
    right: hero.right - badge.right,
    width: badge.width, height: badge.height,
  };
  // Grid geometry: three cells on one row.
  const cells = [...document.querySelectorAll('#src-grid .cell')].map((c) => c.getBoundingClientRect());
  source.gridRow = { sameTop: cells.every((c) => Math.abs(c.top - cells[0].top) < 2), cols: cells.length };
  return { snapshot, heroSnapshot, source };
}, PORT, METRIC_IDS);

const { snapshot, heroSnapshot, source } = extraction;

/* ---------------- 2) rebuild + render both previews ---------------- */

const fileUrl = (p) => `file://${ROOT.replace(/\\/g, '/')}${p}`;
const { ReconstructionEngine } = await import(fileUrl('/extension/src/engines/reconstruction/ReconstructionEngine.js'));
const { exportElementorTemplate } = await import(fileUrl('/extension/src/engines/export/elementor-exporter.js'));
const { walkTree } = await import(fileUrl('/extension/src/common/utils.js'));

const engine = new ReconstructionEngine();
const previewHtml = engine.buildPreviewDocument(snapshot);
const heroPreviewHtml = engine.buildPreviewDocument(heroSnapshot);

const measurePreview = async (html, source) => {
  const p = await browser.newPage();
  await p.setContent(html, { waitUntil: 'load' });
  await new Promise((r) => setTimeout(r, 400)); // let lazy font fetches fire
  const out = await p.evaluate((source) => {
    const result = { metrics: {} };
    const leaves = [...document.querySelectorAll('body *')].filter((el) => el.children.length === 0);
    const findByText = (text) => leaves.find((e) => e.textContent.trim() === text);
    for (const [id, src] of Object.entries(source)) {
      if (!src?.text) continue;
      const el = findByText(src.text);
      if (!el) { result.metrics[id] = null; continue; }
      const s = getComputedStyle(el);
      let bg = s.backgroundColor, walk = el;
      while (bg === 'rgba(0, 0, 0, 0)' && walk.parentElement && !walk.dataset.efId) {
        walk = walk.parentElement;
        bg = getComputedStyle(walk).backgroundColor;
      }
      result.metrics[id] = {
        fontSize: s.fontSize,
        fontFamily: s.fontFamily.split(',')[0].replace(/['"]/g, '').trim(),
        fontWeight: s.fontWeight,
        color: s.color,
        background: bg,
      };
    }
    // Badge geometry: the hero box is the element whose background matches
    // the hero section; find via the badge's positioned ancestor instead —
    // offsetParent is exactly the containing block the layout used.
    const badgeText = findByText('NEW OFFER');
    if (badgeText) {
      // the absolute box is the [data-ef-id] wrapper carrying the styles
      let box = badgeText;
      while (box && getComputedStyle(box).position !== 'absolute') box = box.parentElement;
      if (box) {
        const anchor = box.offsetParent ?? document.body;
        const a = anchor.getBoundingClientRect();
        const b = box.getBoundingClientRect();
        result.badgeOffset = { top: b.top - a.top, right: a.right - b.right, width: b.width, height: b.height };
        result.badgeAnchorBg = getComputedStyle(anchor).backgroundColor;
      }
    }
    const cellTitles = ['Cell one', 'Cell two', 'Cell three'].map(findByText).filter(Boolean);
    if (cellTitles.length === 3) {
      const tops = cellTitles.map((el) => el.getBoundingClientRect().top);
      result.gridRow = { sameTop: tops.every((t) => Math.abs(t - tops[0]) < 2), cols: 3 };
    }
    return result;
  }, source);
  await p.close();
  return out;
};

hits.length = 0; // only count requests made BY the preview renders
const full = await measurePreview(previewHtml, source);
const fontRequestedByFullPreview = hits.includes('/theme/fonts/theme.woff2');
hits.length = 0;
const heroOnly = await measurePreview(heroPreviewHtml, source);
const fontRequestedByHeroPreview = hits.includes('/theme/fonts/theme.woff2');

await browser.close();
server.close();

/* ---------------- 3) assertions ---------------- */

let failures = 0;
const assert = (cond, label) => { if (!cond) { console.error('ASSERT FAIL:', label); failures++; } };

const compareMetrics = (scope, metrics, ids) => {
  console.log(`=== ${scope}: SOURCE vs PREVIEW ===`);
  for (const id of ids) {
    const s = source[id];
    const p = metrics[id];
    console.log(` ${id}: src ${s.fontSize}/${s.fontFamily}/w${s.fontWeight}/${s.color}  →  preview ${p ? `${p.fontSize}/${p.fontFamily}/w${p.fontWeight}/${p.color}` : 'NOT FOUND'}`);
    assert(p, `[${scope}] ${id} rendered in preview`);
    if (!p) continue;
    assert(p.fontSize === s.fontSize, `[${scope}] ${id} font-size (src ${s.fontSize}, preview ${p.fontSize})`);
    assert(p.fontFamily === s.fontFamily, `[${scope}] ${id} font-family (src ${s.fontFamily}, preview ${p.fontFamily})`);
    assert(p.fontWeight === s.fontWeight, `[${scope}] ${id} font-weight (src ${s.fontWeight}, preview ${p.fontWeight})`);
    assert(p.color === s.color, `[${scope}] ${id} color (src ${s.color}, preview ${p.color})`);
  }
};

compareMetrics('FULL PAGE', full.metrics, METRIC_IDS);
compareMetrics('PICKED ELEMENT (hero)', heroOnly.metrics, ['src-h1', 'src-p', 'src-btn']);

assert(full.metrics['src-btn']?.background === source['src-btn'].background,
  `button background (src ${source['src-btn'].background}, preview ${full.metrics['src-btn']?.background})`);

// Absolute badge must anchor to the hero box with the source offsets.
const near = (a, b, tol = 3) => Math.abs(a - b) <= tol;
for (const [scope, r] of [['FULL PAGE', full], ['PICKED ELEMENT', heroOnly]]) {
  console.log(` ${scope} badge: src offset t${source.badgeOffset.top}/r${source.badgeOffset.right} ${source.badgeOffset.width}x${source.badgeOffset.height}  →  preview ${r.badgeOffset ? `t${r.badgeOffset.top}/r${r.badgeOffset.right} ${r.badgeOffset.width}x${r.badgeOffset.height} (anchor bg ${r.badgeAnchorBg})` : 'NOT FOUND'}`);
  assert(r.badgeOffset, `[${scope}] absolute badge rendered`);
  if (!r.badgeOffset) continue;
  assert(near(r.badgeOffset.top, source.badgeOffset.top), `[${scope}] badge top offset (src ${source.badgeOffset.top}, preview ${r.badgeOffset.top})`);
  assert(near(r.badgeOffset.right, source.badgeOffset.right), `[${scope}] badge right offset (src ${source.badgeOffset.right}, preview ${r.badgeOffset.right})`);
  assert(near(r.badgeOffset.width, source.badgeOffset.width), `[${scope}] badge width`);
  assert(near(r.badgeOffset.height, source.badgeOffset.height), `[${scope}] badge height`);
}

// Grid renders three columns on one row.
assert(source.gridRow.sameTop, 'source grid sanity');
assert(full.gridRow?.sameTop, `grid cells stay on one row in preview (got ${JSON.stringify(full.gridRow)})`);

// Webfont pipeline: same-origin @font-face with a RELATIVE src must resolve
// against the declaring sheet; the cross-origin sheet's face must be
// recovered via fetch; BOTH scopes must catalog them and the rendered
// preview must actually request the font file.
const fontAssets = (snap) => (snap.assets ?? []).filter((a) => a.type === 'font');
const themeFontUrl = `http://localhost:${PORT}/theme/fonts/theme.woff2`;
for (const [scope, snap] of [['FULL PAGE', snapshot], ['PICKED ELEMENT', heroSnapshot]]) {
  const fonts = fontAssets(snap);
  console.log(` ${scope} font assets: ${fonts.map((f) => `${f.meta.family}=${f.url}`).join(' | ') || 'NONE'}`);
  assert(fonts.some((f) => f.meta.family === 'ThemeFont' && f.url === themeFontUrl),
    `[${scope}] ThemeFont cataloged with sheet-relative URL resolved (got ${JSON.stringify(fonts.map((f) => f.url))})`);
  assert(fonts.some((f) => f.meta.family === 'RemoteFont'),
    `[${scope}] RemoteFont recovered from cross-origin stylesheet`);
}
assert(previewHtml.includes('@font-face') && previewHtml.includes(themeFontUrl), 'full preview embeds ThemeFont @font-face');
assert(heroPreviewHtml.includes('@font-face') && heroPreviewHtml.includes(themeFontUrl), 'hero preview embeds ThemeFont @font-face');
assert(fontRequestedByFullPreview, 'full-page preview actually requested the theme font file');
assert(fontRequestedByHeroPreview, 'picked-element preview actually requested the theme font file');

// No unresolved variables anywhere in preview CSS or export JSON.
assert(!previewHtml.includes('var(--'), 'preview CSS contains no unresolved var()');
const tplJson = JSON.stringify(exportElementorTemplate(snapshot));
assert(!tplJson.includes('var(--'), 'export JSON contains no unresolved var()');

// The hero h1 must export explicit typography resolved from the CSS vars.
let heroHeading = null;
walkTree(snapshot.tree, (n) => {
  if (n.mapping?.widgetType === 'heading' && (n.content.text ?? '').includes('Big hero title')) heroHeading = n;
});
assert(heroHeading, 'hero h1 mapped to heading widget');
if (heroHeading) {
  const st = heroHeading.settings.desktop;
  assert(st.typography_font_size?.size === 40, `hero h1 exports font-size 40 (got ${JSON.stringify(st.typography_font_size)})`);
  assert(st.color === '#E91E63', `hero h1 exports resolved brand color (got ${st.color})`);
}

if (failures) { console.error(`\n${failures} PREVIEW FIDELITY ASSERTION(S) FAILED`); process.exit(1); }
console.log('\nALL PREVIEW FIDELITY ASSERTIONS PASSED');
