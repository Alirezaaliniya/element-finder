/**
 * Source-CSS fidelity harness: a hand-written (non-Elementor) page is
 * extracted with the real pipeline (core/phases.js, including the Source CSS
 * Engine), the preview is rebuilt in source mode, and computed styles are
 * compared between the source page and the preview element by element —
 * including :hover states, ::before content, animations and a mobile media
 * query. Then the Elementor export is checked: CSS rewritten to
 * `.elementor-element-<id>`, scoped under `selector`, no bare tag rules,
 * icon-font icons exported with their classes.
 *
 *   node tools/e2e/source-css-fidelity.mjs
 */

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import puppeteer from 'puppeteer-core';

const ROOT = resolve(import.meta.dirname, '../..');
const PORT = 8125;
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const TEST_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<link rel="stylesheet" href="/theme.css">
<style>
  :root { --brand: #e91e63; }
  body { margin: 0; font-family: Georgia, serif; color: #222222; }
  /* a style-neutral wrapper the DOM phase collapses: its font must survive */
  .font-wrap { font-family: Verdana, sans-serif; }
  .stack { display: flex; flex-direction: column; align-items: flex-start; }
  .row > .col { flex: 1 0 0%; padding: 0 15px; }
  .card .title { color: var(--brand); font-size: 22px; margin: 0 0 8px; }
  .card .title:hover { color: #00bcd4; }
  .btn { display: inline-block; padding: 10px 20px; background: #333333; color: #fff; text-decoration: none; }
  .btn:hover { background: var(--brand); }
  /* icon-font pattern: a Private Use Area glyph drawn by ::before */
  .ico { font-family: TestIcons; font-style: normal; }
  .ico::before { content: "\\e900"; color: rgb(255, 215, 0); }
  .menu { margin: 0; padding: 0; }
  .menu li { list-style: none; display: inline-block; margin-inline-end: 12px; }
  .badge { display: inline-flex; gap: 4px; }
  .menu li:hover > a { color: rgb(0, 128, 0); }
  .dropdown { opacity: 0; position: absolute; }
  #cd .inner span { display: inline-block; width: 36px; border: 2px solid rgb(142, 213, 87); }
  @keyframes pulse { to { opacity: .5; } }
  .pulse { animation: pulse 1s infinite alternate; }
</style>
</head>
<body>
<div>
  <div class="row" id="t-row">
    <div class="col" id="t-col1">
      <div class="card"><div class="font-wrap"><div class="stack">
        <h3 class="title" id="t-title">Card title</h3>
        <a class="btn" id="t-btn" href="#">Go <i class="ico" id="t-ico"></i></a>
      </div></div></div>
    </div>
    <div class="col" id="t-col2">
      <ul class="menu" id="t-menu"><li id="t-li"><a href="#" id="t-link">One</a></li><li><a href="#">Two</a></li></ul>
      <span class="badge"><i class="ico" id="t-ico2"></i><span>New</span></span>
      <div class="dropdown">HIDDEN-DROPDOWN</div>
    </div>
  </div>
</div>
<div id="cd"><div class="inner"><span id="t-tick">00</span><span>01</span></div></div>
<p class="pulse" id="t-pulse">Pulsing text</p>
<script>
  // Rebuilds its whole inner element every 50 ms, like a countdown widget.
  setInterval(() => {
    document.getElementById('cd').innerHTML =
      '<div class="inner"><span id="t-tick">' + (Date.now() % 100) + '</span><span>01</span></div>';
  }, 50);
</script>
</body>
</html>`;

const FIXTURES = {
  '/theme.css': ['text/css', `.row { display: flex; flex-wrap: wrap; margin: 0 -15px; }
@media (max-width: 767px) { .row { display: block; } }`],
};

const server = http.createServer(async (req, res) => {
  try {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (path === '/__test__.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(TEST_PAGE);
      return;
    }
    if (FIXTURES[path]) {
      res.writeHead(200, { 'content-type': FIXTURES[path][0] });
      res.end(FIXTURES[path][1]);
      return;
    }
    const body = await readFile(resolve(ROOT, '.' + path));
    const type = path.endsWith('.js') ? 'text/javascript' : path.endsWith('.json') ? 'application/json' : 'application/octet-stream';
    res.writeHead(200, { 'content-type': type });
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
  args: ['--no-sandbox'],
  defaultViewport: { width: 1440, height: 900 },
});

const failures = [];
const check = (label, ok, detail = '') => {
  console.log(`${ok ? ' ok ' : 'FAIL'} ${label}${detail ? `  ${detail}` : ''}`);
  if (!ok) failures.push(label);
};

/** Computed styles the comparison looks at, read in whichever document. */
const MEASURE = (ids) => {
  const out = {};
  for (const id of ids) {
    const el = document.getElementById(id);
    if (!el) { out[id] = null; continue; }
    const s = getComputedStyle(el);
    const b = getComputedStyle(el, '::before');
    out[id] = {
      color: s.color, fontFamily: s.fontFamily, fontSize: s.fontSize, display: s.display,
      background: s.backgroundColor, padding: s.padding, width: Math.round(el.getBoundingClientRect().width),
      listStyle: s.listStyleType, border: s.borderTopColor + ' ' + s.borderTopWidth,
      before: b.content, beforeColor: b.color, animation: s.animationName,
    };
  }
  return out;
};
const IDS = ['t-title', 't-btn', 't-ico', 't-ico2', 't-col1', 't-col2', 't-li', 't-link', 't-tick', 't-pulse'];
const HOVERS = [['t-title', 't-title', 'color'], ['t-btn', 't-btn', 'background'], ['t-li', 't-link', 'color']];

async function hoverValues(page) {
  const out = {};
  for (const [target, read, prop] of HOVERS) {
    await page.hover(`#${target}`);
    await new Promise((r) => setTimeout(r, 50));
    out[`${target}:hover ${read}.${prop}`] = await page.evaluate((id, p) => {
      const s = getComputedStyle(document.getElementById(id));
      return p === 'background' ? s.backgroundColor : s[p];
    }, read, prop);
  }
  await page.mouse.move(0, 0);
  return out;
}

try {
  /* ---------------- 1) extract on the source page ---------------- */
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 200)));
  await page.goto(`http://localhost:${PORT}/__test__.html`, { waitUntil: 'networkidle2' });

  const snapshot = await page.evaluate(async (port) => {
    const base = `http://localhost:${port}/extension/src`;
    const { ExtractionPipeline } = await import(`${base}/core/ExtractionPipeline.js`);
    const { buildPhases } = await import(`${base}/core/phases.js`);
    return new ExtractionPipeline(buildPhases()).run(document, document.body);
  }, PORT);
  const source = await page.evaluate(MEASURE, IDS);
  const sourceHover = await hoverValues(page);
  await page.setViewport({ width: 390, height: 800 });
  const sourceMobileRow = await page.evaluate(() => getComputedStyle(document.getElementById('t-row')).display);

  check('source-css phase ran', !!snapshot.sourceStyles?.css, JSON.stringify(snapshot.sourceStyles?.stats ?? {}));

  /* ---------------- 2) rebuild + render the source-mode preview ---------------- */
  const fileUrl = (p) => `file://${ROOT.replace(/\\/g, '/')}${p}`;
  const { ReconstructionEngine } = await import(fileUrl('/extension/src/engines/reconstruction/ReconstructionEngine.js'));
  const { exportElementorTemplate } = await import(fileUrl('/extension/src/engines/export/elementor-exporter.js'));
  const html = new ReconstructionEngine().buildPreviewDocument(snapshot, { mode: 'source' });

  const preview = await browser.newPage();
  await preview.setContent(html, { waitUntil: 'load' });
  const rendered = await preview.evaluate(MEASURE, IDS);
  const previewHover = await hoverValues(preview);
  const previewText = await preview.evaluate(() => document.body.innerText);
  await preview.setViewport({ width: 390, height: 800 });
  const previewMobileRow = await preview.evaluate(() => getComputedStyle(document.getElementById('t-row')).display);

  console.log('=== SOURCE vs SOURCE-MODE PREVIEW ===');
  for (const id of IDS) {
    if (!rendered[id]) { check(`${id} present in preview`, false); continue; }
    const diffs = Object.keys(source[id]).filter((k) => source[id][k] !== rendered[id][k]);
    check(id, !diffs.length, diffs.map((k) => `${k}: ${source[id][k]} -> ${rendered[id][k]}`).join(' | '));
  }
  for (const key of Object.keys(sourceHover)) {
    check(key, sourceHover[key] === previewHover[key], `${sourceHover[key]} -> ${previewHover[key]}`);
  }
  check('opacity-hidden dropdown skipped', !previewText.includes('HIDDEN-DROPDOWN'));
  check('mobile media query', sourceMobileRow === previewMobileRow, `${sourceMobileRow} -> ${previewMobileRow}`);

  /* ---------------- 3) Elementor export ---------------- */
  const template = exportElementorTemplate(snapshot, { sourceCss: true });
  const css = template.page_settings.custom_css ?? '';
  const ids = new Set();
  (function walk(els) { for (const e of els) { ids.add(e.id); walk(e.elements ?? []); } })(template.content);
  const icon = (function find(els) {
    for (const e of els) { if (e.settings?.selected_icon?.library === 'ef-source') return e; const f = find(e.elements ?? []); if (f) return f; }
    return null;
  })(template.content);
  const targetIds = [...css.matchAll(/\.elementor-element-([0-9a-z]+)/g)].map((m) => m[1]);
  console.log('=== EXPORT ===');
  check('export carries source css', css.length > 0, `${css.length} bytes`);
  check('rewritten targets are exported elements', targetIds.length > 0 && targetIds.every((id) => ids.has(id)), `${targetIds.length} refs`);
  check('kept-as-written rules are scoped', /:where\(selector \.btn:hover\)/.test(css));
  check('no bare tag/universal rules', !/:where\((?:selector )?(?:a|li|h3|\*)\)/.test(css));
  check('no preview-only markers', !/data-ef-id|ef-body/.test(css));
  check('keyframes travel', /@keyframes pulse/.test(css));
  check('icon-font icon keeps its classes and size', icon?.settings.selected_icon.value === 'ico' && !icon.settings._css_classes && icon.settings.size?.size === 16, JSON.stringify(icon?.settings ?? null));
  check('without the option nothing changes', !exportElementorTemplate(snapshot, { sourceCss: false }).page_settings.custom_css?.includes('elementor-element-'));
} finally {
  await browser.close();
  server.close();
}

if (failures.length) {
  console.log(`\n${failures.length} SOURCE CSS ASSERTION(S) FAILED`);
  process.exitCode = 1;
} else {
  console.log('\nALL SOURCE CSS ASSERTIONS PASSED');
}
