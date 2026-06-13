/**
 * E2E reproduction harness:
 *  1. Serves the repo over HTTP (so the saved SAIPA page + extension modules
 *     share an origin and ES modules import cleanly).
 *  2. Opens the saved Elementor page in headless Chrome.
 *  3. Imports the real extraction pipeline modules into the page and runs
 *     them against document.body.
 *  4. Dumps the snapshot + diagnostics, then runs the Elementor exporter on
 *     it in Node and reports what the exported JSON actually contains.
 */

import http from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import puppeteer from 'puppeteer-core';

const ROOT = resolve(import.meta.dirname, '../..');
const OUT = resolve(import.meta.dirname, 'out');
const PORT = 8123;
const PAGE = encodeURIComponent('نمایندگی رسمی سایپا.htm');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.woff': 'font/woff',
  '.woff2': 'font/woff2', '.gif': 'image/gif', '.ico': 'image/x-icon',
};

const server = http.createServer(async (req, res) => {
  try {
    let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    // The saved page references "*.js.download" files; serve them as JS.
    const file = join(ROOT, path);
    if (!existsSync(file)) { res.writeHead(404); res.end(); return; }
    const ext = file.endsWith('.download') ? '.js' : extname(file).toLowerCase();
    res.writeHead(200, { 'content-type': MIME[ext] ?? 'application/octet-stream' });
    res.end(await readFile(file));
  } catch (err) {
    res.writeHead(500); res.end(String(err));
  }
});
await new Promise((r) => server.listen(PORT, r));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--window-size=1440,900', '--lang=fa'],
  defaultViewport: { width: 1440, height: 900 },
});

const page = await browser.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 200)));

await page.goto(`http://localhost:${PORT}/${PAGE}`, { waitUntil: 'networkidle2', timeout: 60_000 })
  .catch((e) => console.log('goto warning:', e.message));
await new Promise((r) => setTimeout(r, 1500)); // let fonts/layout settle

const result = await page.evaluate(async (port) => {
  const base = `http://localhost:${port}/extension/src`;
  const logs = [];
  try {
    const { ExtractionPipeline } = await import(`${base}/core/ExtractionPipeline.js`);
    const { DomAnalysisEngine } = await import(`${base}/engines/dom/DomAnalysisEngine.js`);
    const { ContentExtractionEngine } = await import(`${base}/engines/content/ContentExtractionEngine.js`);
    const { CssInterpretationEngine } = await import(`${base}/engines/css/CssInterpretationEngine.js`);
    const { ResponsiveAnalysisEngine } = await import(`${base}/engines/responsive/ResponsiveAnalysisEngine.js`);
    const { AssetCollectionEngine } = await import(`${base}/engines/assets/AssetCollectionEngine.js`);
    const { WidgetMappingEngine } = await import(`${base}/engines/mapping/WidgetMappingEngine.js`);

    const pipeline = new ExtractionPipeline([
      { name: 'dom-analysis', engine: new DomAnalysisEngine() },
      { name: 'content-extraction', engine: new ContentExtractionEngine() },
      { name: 'css-interpretation', engine: new CssInterpretationEngine() },
      { name: 'responsive-analysis', engine: new ResponsiveAnalysisEngine() },
      { name: 'asset-collection', engine: new AssetCollectionEngine() },
      { name: 'widget-mapping', engine: new WidgetMappingEngine() },
    ]);
    const snapshot = await pipeline.run(document, document.body);
    // Fidelity baseline: VISIBLE Elementor elements the source page declares,
    // excluding loop-template internals — Elementor's own template export
    // stores loop widgets empty (items regenerate from the query), and hidden
    // documents (popups, closed dropdowns) are excluded by design.
    const all = document.querySelectorAll('[data-element_type]');
    let nativeVisible = 0;
    for (const el of all) {
      if (el.getClientRects().length === 0) continue;
      if (el.parentElement?.closest('[data-widget_type^="loop-"]')) continue;
      nativeVisible++;
    }
    return { ok: true, snapshot, nativeElements: all.length, nativeVisible, logs };
  } catch (err) {
    return { ok: false, error: String(err?.stack || err), logs };
  }
}, PORT);

await browser.close();
server.close();

if (!result.ok) {
  console.error('PIPELINE FAILED IN PAGE:\n', result.error);
  process.exit(1);
}

const snapshot = result.snapshot;
await mkdir(OUT, { recursive: true });
await writeFile(join(OUT, 'snapshot.json'), JSON.stringify(snapshot, null, 1));

/* ---------------- diagnostics ---------------- */

const { walkTree } = await import(`file://${ROOT}/extension/src/common/utils.js`.replace(/\\/g, '/'));
const { exportElementorTemplate } = await import(`file://${ROOT}/extension/src/engines/export/elementor-exporter.js`.replace(/\\/g, '/'));

console.log('\n=== PHASES ===');
for (const [name, info] of Object.entries(snapshot.stats.enginePhases)) {
  console.log(` ${info.ok ? 'OK ' : 'FAIL'} ${name}`, info.ok ? `${info.durationMs}ms` : info.error);
}
console.log('\n=== STATS ===', JSON.stringify(snapshot.stats, null, 1).slice(0, 600));

let total = 0, withDesktopSettings = 0, withStyles = 0, widgets = 0, widgetWithSettings = 0;
const imageNodes = [];
walkTree(snapshot.tree, (n) => {
  total++;
  if (Object.keys(n.styles?.desktop ?? {}).length) withStyles++;
  if (Object.keys(n.settings?.desktop ?? {}).length) withDesktopSettings++;
  if (n.mapping?.elType === 'widget') {
    widgets++;
    if (Object.keys(n.settings?.desktop ?? {}).length) widgetWithSettings++;
  }
  if (n.mapping?.widgetType === 'image' || n.tag === 'img' || n.tag === 'picture') {
    imageNodes.push({ tag: n.tag, widget: n.mapping?.widgetType, src: n.content?.src ?? null, assets: n.assets.length });
  }
});
console.log(`\n=== NODES === total=${total} withRawStyles=${withStyles} withSettings=${withDesktopSettings} widgets=${widgets} widgetsWithSettings=${widgetWithSettings}`);

console.log('\n=== IMAGE NODES (first 12) ===');
for (const i of imageNodes.slice(0, 12)) console.log(' ', JSON.stringify(i));

console.log('\n=== ASSETS by type ===');
const byType = {};
for (const a of snapshot.assets) byType[a.type] = (byType[a.type] ?? 0) + 1;
console.log(' ', JSON.stringify(byType));
console.log('\n=== ASSET URL SAMPLE (first 8) ===');
for (const a of snapshot.assets.slice(0, 8)) console.log(`  [${a.type}] ${a.url ?? '(inline)'}`);

const tpl = exportElementorTemplate(snapshot);
await writeFile(join(OUT, 'elementor-export.json'), JSON.stringify(tpl, null, 1));

let exContainers = 0, exWidgets = 0, exWidgetsWithStyle = 0, exImagesBroken = 0, exImagesTotal = 0;
const styleKeys = ['typography_typography', 'background_color', 'background_image', 'border_border', '_padding', '_margin', 'title_color', 'text_color', 'button_text_color', 'color', 'padding', 'margin', 'min_height', 'box_shadow_box_shadow'];
const visit = (els) => {
  for (const el of els ?? []) {
    if (el.elType === 'container') exContainers++;
    else {
      exWidgets++;
      if (styleKeys.some((k) => k in el.settings)) exWidgetsWithStyle++;
      if (el.widgetType === 'image') {
        exImagesTotal++;
        if (!el.settings.image?.url) exImagesBroken++;
      }
    }
    visit(el.elements);
  }
};
visit(tpl.content);
console.log(`\n=== EXPORT === containers=${exContainers} widgets=${exWidgets} widgetsWithStyleSettings=${exWidgetsWithStyle} imageWidgets=${exImagesTotal} imageWidgetsWithoutUrl=${exImagesBroken}`);

const sample = [];
const findSamples = (els) => {
  for (const el of els ?? []) {
    if (el.elType === 'widget' && sample.length < 4) sample.push({ widgetType: el.widgetType, settings: el.settings });
    findSamples(el.elements);
  }
};
findSamples(tpl.content);
console.log('\n=== SAMPLE EXPORTED WIDGETS ===');
console.log(JSON.stringify(sample, null, 1).slice(0, 2200));

/* ---------------- assertions (the user-reported regressions) ---------------- */

let failures = 0;
const assert = (cond, label) => { if (!cond) { console.error('ASSERT FAIL:', label); failures++; } };

let headings = 0, headingsWithTitle = 0, headingsWithStyle = 0;
let images = 0, imagesWithUrl = 0;
let bgImages = 0;
let exportedTotal = 0;
let adminLinks = 0, srText = 0;
const countWidgets = (els) => {
  for (const el of els ?? []) {
    exportedTotal++;
    if (el.settings?.background_image?.url) bgImages++;
    if (el.elType === 'widget') {
      if (el.widgetType === 'heading') {
        headings++;
        if (el.settings.title) headingsWithTitle++;
        if (el.settings.typography_typography === 'custom' || el.settings.title_color) headingsWithStyle++;
      }
      if (el.widgetType === 'image') {
        images++;
        if (el.settings.image?.url) imagesWithUrl++;
      }
      const json = JSON.stringify(el.settings);
      if (json.includes('wp-admin')) adminLinks++;
      if (json.includes('Skip to content')) srText++;
    }
    countWidgets(el.elements);
  }
};
countWidgets(tpl.content);

const native = result.nativeVisible;
console.log(`\n=== ASSERTIONS === nativeVisible=${native} (of ${result.nativeElements} total) exportedTotal=${exportedTotal} headings=${headings}/${headingsWithTitle} titled/${headingsWithStyle} styled, images=${images}/${imagesWithUrl} with URL, bgImages=${bgImages}, adminLinkWidgets=${adminLinks}, srTextWidgets=${srText}`);
// The page is Elementor-built: a faithful export mirrors the source's
// visible structure (hidden popups/dropdown documents are excluded by design).
assert(exportedTotal >= native * 0.8, `exported ${exportedTotal} elements; source shows ${native} visible — must cover >= 80%`);
assert(headings >= 10, `should export many headings, got ${headings}`);
assert(headings === headingsWithTitle, `every heading needs a title (${headingsWithTitle}/${headings})`);
// Not all headings carry explicit typography — the source template itself
// leaves ~40% of headings on theme/global styles (verified against the
// reference elementor-1324 export). Inherited values must NOT be exported.
assert(headingsWithStyle >= headings * 0.5, `headings with explicit styling should carry typography/color settings (${headingsWithStyle}/${headings})`);
assert(images >= 3 && images === imagesWithUrl, `every image widget needs a URL (${imagesWithUrl}/${images})`);
assert(bgImages >= 5, `container background images must survive export, got ${bgImages}`);
assert(adminLinks === 0, `WP admin bar must be excluded (found ${adminLinks} widgets with wp-admin links)`);
assert(srText === 0, `screen-reader-only elements must be excluded`);

if (failures) { console.error(`\n${failures} E2E ASSERTION(S) FAILED`); process.exit(1); }
console.log('\nALL E2E ASSERTIONS PASSED');
