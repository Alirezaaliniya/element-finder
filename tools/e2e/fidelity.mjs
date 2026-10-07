/**
 * Fidelity harness against a LIVE Elementor site.
 *
 *  1. Serves the extension modules over HTTP with CORS (so a page on another
 *     origin can import them).
 *  2. Opens the URL in headless Chrome and runs the real extraction pipeline
 *     on document.body.
 *  3. Exports the snapshot with the real Elementor exporter (in Node).
 *  4. Loads the ground truth — the documents' saved `_elementor_data` — via
 *     tools/e2e/elementor-data.php and compares every source element with the
 *     exported element of the same id: widget type, and every style setting
 *     (a key the controls map knows as a selector-bearing control).
 *
 * Usage:
 *   node tools/e2e/fidelity.mjs <url> [--wp C:/wamp64/www/saipa] [--out name] [--verbose]
 */

import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer-core';

const args = process.argv.slice(2);
const url = args.find((a) => !a.startsWith('--'));
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? def : (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true);
};
if (!url) {
  console.error('usage: node tools/e2e/fidelity.mjs <url> [--wp <wp-root>] [--out <name>] [--verbose]');
  process.exit(1);
}
const WP_ROOT = opt('wp', 'C:/wamp64/www/saipa');
const OUT_NAME = opt('out', 'fidelity');
const VERBOSE = !!opt('verbose', false);
const PHP = opt('php', 'C:/wamp64/bin/php/php8.3.28/php.exe');

const ROOT = resolve(import.meta.dirname, '../..');
const OUT = resolve(import.meta.dirname, 'out');
const PORT = 8124;
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const MIME = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json' };

const server = http.createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = join(ROOT, path);
  const headers = { 'access-control-allow-origin': '*', 'cache-control': 'no-store' };
  if (!file.startsWith(ROOT) || !existsSync(file)) { res.writeHead(404, headers); res.end(); return; }
  res.writeHead(200, { ...headers, 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
  res.end(await readFile(file));
});
await new Promise((r) => server.listen(PORT, r));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  // Remote HTTPS pages must be allowed to import the modules from localhost.
  args: ['--no-sandbox', '--window-size=1440,900', '--disable-features=BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessSendPreflights,PrivateNetworkAccessRespectPreflightResults,LocalNetworkAccessChecks'],
  defaultViewport: { width: 1440, height: 900 },
});
const page = await browser.newPage();
await page.setBypassCSP(true);
page.on('console', (m) => { if (VERBOSE || m.type() === 'error') console.log('[page]', m.text().slice(0, 300)); });
page.on('pageerror', (e) => VERBOSE && console.log('[pageerror]', String(e).slice(0, 200)));
await page.goto(url, { waitUntil: 'load', timeout: 90_000 }).catch((e) => console.log('goto warning:', e.message));
await new Promise((r) => setTimeout(r, 1200));

const result = await page.evaluate(async (port) => {
  const base = `http://localhost:${port}/extension/src`;
  try {
    const mod = (p) => import(`${base}/${p}`);
    const { ExtractionPipeline } = await mod('core/ExtractionPipeline.js');
    const { buildPhases } = await mod('core/phases.js');
    const pipeline = new ExtractionPipeline(buildPhases());
    const snapshot = await pipeline.run(document, document.body);
    const postIds = [...new Set([...document.querySelectorAll('[data-elementor-id]')].map((e) => e.getAttribute('data-elementor-id')))];
    return { ok: true, snapshot, postIds };
  } catch (err) {
    return { ok: false, error: String(err?.stack || err) };
  }
}, PORT);

// --preview <png>: render the builder's reconstruction of the snapshot and
// screenshot it next to the source page (--shot <png>) for visual diffing.
const PREVIEW = opt('preview', null);
const SHOT = opt('shot', null);
if (result.ok && (PREVIEW || SHOT)) {
  if (SHOT) await page.screenshot({ path: SHOT, fullPage: true });
  if (PREVIEW) {
    const html = await page.evaluate(async (port, snap) => {
      const { ReconstructionEngine } = await import(`http://localhost:${port}/extension/src/engines/reconstruction/ReconstructionEngine.js`);
      return new ReconstructionEngine().buildPreviewDocument(snap);
    }, PORT, result.snapshot);
    const preview = await browser.newPage();
    await preview.setContent(html, { waitUntil: 'networkidle2', timeout: 90_000 }).catch(() => {});
    await new Promise((r) => setTimeout(r, 800));
    await preview.screenshot({ path: PREVIEW, fullPage: true });
  }
}

await browser.close();
server.close();

if (!result.ok) {
  console.error('PIPELINE FAILED IN PAGE:\n', result.error);
  process.exit(1);
}

const { snapshot, postIds } = result;
const imp = (p) => import(pathToFileURL(join(ROOT, p)).href);
const { exportElementorTemplate } = await imp('extension/src/engines/export/elementor-exporter.js');
const controlsMap = JSON.parse(await readFile(join(ROOT, 'extension/src/engines/elementor/data/controls-map.json'), 'utf8'));

const tpl = exportElementorTemplate(snapshot, { title: 'fidelity' });
await mkdir(OUT, { recursive: true });
await writeFile(join(OUT, `${OUT_NAME}-snapshot.json`), JSON.stringify(snapshot, null, 1));
await writeFile(join(OUT, `${OUT_NAME}-export.json`), JSON.stringify(tpl, null, 1));

/* ---------------- ground truth ---------------- */

// Remote sites: no database to compare against — extraction/export only.
if (opt('no-truth', false)) {
  console.log(`extracted ${snapshot.stats.nodesExtracted} nodes; phases: ${Object.entries(snapshot.stats.enginePhases).map(([k, v]) => `${k}:${v.ok ? 'ok' : 'FAIL'}`).join(' ')}`);
  process.exit(0);
}

const truth = JSON.parse(execFileSync(PHP, [join(ROOT, 'tools/e2e/elementor-data.php'), WP_ROOT, ...postIds], {
  encoding: 'utf8', maxBuffer: 256 * 1024 * 1024,
}));

const sourceById = new Map();
for (const [postId, doc] of Object.entries(truth)) {
  (function walk(els) {
    for (const el of els ?? []) {
      sourceById.set(el.id, { ...el, postId });
      walk(el.elements);
    }
  })(doc.elements);
}

const exportedById = new Map();
(function walk(els) {
  for (const el of els ?? []) {
    exportedById.set(el.id, el);
    walk(el.elements);
  }
})(tpl.content);

/* ---------------- comparison ---------------- */

function styleControlsFor(el) {
  if (el.elType === 'widget') {
    const w = controlsMap.widgets[el.widgetType];
    if (!w) return null;
    return { ...controlsMap.widgets[w.common]?.controls, ...w.controls };
  }
  return controlsMap.elements[el.elType] ?? null;
}

/** Every style key a saved element carries, incl. device variants. */
function styleKeysOf(settings, controls) {
  const keys = new Set();
  for (const key of Object.keys(settings ?? {})) {
    if (key === '__globals__' || key === '__dynamic__') continue;
    const base = key.replace(/_(tablet|mobile|laptop|widescreen|tablet_extra|mobile_extra)$/, '');
    if (controls[key] || controls[base]) keys.add(key);
  }
  return keys;
}

function norm(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') return v.trim().toLowerCase();
  if (Array.isArray(v)) return v.map(norm);
  if (typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v).sort()) {
      const x = v[k];
      if (k === 'sizes' || k === 'isLinked' || k === 'id' || k === '_id' || k === '__dynamic__' || k === 'source' || k === 'alt') continue;
      if (x === '' || x === null || (Array.isArray(x) && !x.length)) continue;
      out[k] = norm(x);
    }
    return out;
  }
  return String(v);
}

function isEmptyValue(v) {
  if (v === '' || v === null || v === undefined) return true;
  if (typeof v !== 'object' || Array.isArray(v)) return false;
  return Object.entries(v).every(([k, x]) => k === 'unit' || k === 'sizes' || k === 'isLinked' || x === '' || x === null);
}

/**
 * Semantic equality: legacy option keys that Elementor's selectors_dictionary
 * renders identically (align "left" -> "end") count as equal.
 */
function eq(a, b, def) {
  if (JSON.stringify(norm(a)) === JSON.stringify(norm(b))) return true;
  if (def?.sd && typeof a === 'string' && def.sd[a] !== undefined && def.sd[a] === b) return true;
  return false;
}

const NON_VISUAL = new Set(['_title', 'hover_animation']);
const stats = { elements: 0, inExport: 0, typeOk: 0, styleKeys: 0, match: 0, diff: 0, miss: 0, extra: 0, globals: 0, globalsCovered: 0, contentKeys: 0, contentMatch: 0 };
const contentDiffs = [];
const perType = new Map();
const missKeys = new Map();
const diffSamples = [];
const missingElements = new Map();

for (const [id, src] of sourceById) {
  const type = src.elType === 'widget' ? src.widgetType : src.elType;
  if (src.elType === 'widget' && /^e-/.test(src.widgetType ?? '')) { /* atomic widget: compared by type only */ }
  const ours = exportedById.get(id);
  stats.elements++;
  const t = perType.get(type) ?? { n: 0, found: 0, typeOk: 0, keys: 0, match: 0 };
  perType.set(type, t);
  t.n++;
  if (!ours) { missingElements.set(type, (missingElements.get(type) ?? 0) + 1); continue; }
  stats.inExport++; t.found++;
  const oursType = ours.elType === 'widget' ? ours.widgetType : ours.elType;
  if (oursType === type) { stats.typeOk++; t.typeOk++; }
  if (oursType !== type) continue;

  const controls = styleControlsFor(src);
  if (!controls) continue;
  const srcKeys = styleKeysOf(src.settings, controls);
  const oursKeys = styleKeysOf(ours.settings, controls);
  for (const key of srcKeys) {
    if (NON_VISUAL.has(key)) continue;
    // A key driven by a kit global renders the global, not its stale raw
    // value; it is scored in the globals line instead.
    if (src.settings.__globals__?.[key]) continue;
    // Saved-but-empty values (`{unit:"px", size:""}`) generate no CSS.
    if (isEmptyValue(src.settings[key])) continue;
    stats.styleKeys++; t.keys++;
    const def = controls[key] ?? controls[key.replace(/_(tablet|mobile|laptop|widescreen|tablet_extra|mobile_extra)$/, '')];
    if (!(key in (ours.settings ?? {}))) {
      stats.miss++;
      const mk = `${type}.${key}`;
      missKeys.set(mk, (missKeys.get(mk) ?? 0) + 1);
    } else if (eq(src.settings[key], ours.settings[key], def)) {
      stats.match++; t.match++;
    } else {
      stats.diff++;
      if (diffSamples.length < 40) diffSamples.push({ id, type, key, src: src.settings[key], ours: ours.settings[key] });
    }
  }
  for (const key of oursKeys) if (!srcKeys.has(key)) stats.extra++;

  // Content keys: everything that is not a style control or editor bookkeeping.
  for (const [key, value] of Object.entries(src.settings ?? {})) {
    if (srcKeys.has(key) || key.startsWith('_') || /^(animentor|motion_fx|scroll_|sticky|__)/.test(key)) continue;
    if (isEmptyValue(value)) continue;
    stats.contentKeys++;
    if (eq(value, ours.settings?.[key])) stats.contentMatch++;
    else if (contentDiffs.length < 40) contentDiffs.push({ id, type, key, src: value, ours: ours.settings?.[key] });
  }
  for (const gkey of Object.keys(src.settings?.__globals__ ?? {})) {
    if (!src.settings.__globals__[gkey]) continue;
    stats.globals++;
    if (ours.settings?.__globals__?.[gkey] || ours.settings?.[gkey] !== undefined) stats.globalsCovered++;
  }
}

const pct = (a, b) => (b ? `${Math.round((a / b) * 1000) / 10}%` : '—');
console.log(`\n=== FIDELITY: ${url} ===`);
console.log(`documents: ${postIds.join(', ')}`);
console.log(`source elements: ${stats.elements}  exported(by id): ${stats.inExport} (${pct(stats.inExport, stats.elements)})  type correct: ${stats.typeOk} (${pct(stats.typeOk, stats.inExport)})`);
console.log(`style keys: ${stats.styleKeys}  exact: ${stats.match} (${pct(stats.match, stats.styleKeys)})  different: ${stats.diff}  missing: ${stats.miss}  extra(noise): ${stats.extra}`);
console.log(`global refs: ${stats.globals}  covered: ${stats.globalsCovered} (${pct(stats.globalsCovered, stats.globals)})`);
console.log(`content keys: ${stats.contentKeys}  exact: ${stats.contentMatch} (${pct(stats.contentMatch, stats.contentKeys)})`);
console.log(`custom css (page): ${tpl.page_settings?.custom_css ? tpl.page_settings.custom_css.length + ' chars' : 'none'}`);

console.log('\n--- per type (n / found / type-ok / style exact) ---');
for (const [type, t] of [...perType].sort((a, b) => b[1].n - a[1].n)) {
  console.log(`  ${type.padEnd(28)} ${String(t.n).padStart(4)} ${String(t.found).padStart(4)} ${String(t.typeOk).padStart(4)}   ${pct(t.match, t.keys).padStart(6)} of ${t.keys}`);
}
if (missingElements.size) {
  console.log('\n--- source elements not exported under their id ---');
  console.log('  ' + [...missingElements].map(([k, v]) => `${k}:${v}`).join('  '));
}
console.log('\n--- top missing style keys ---');
for (const [k, v] of [...missKeys].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(`  ${v}x ${k}`);
console.log('\n--- value differences (sample) ---');
for (const d of diffSamples.slice(0, VERBOSE ? 40 : 15)) {
  console.log(`  ${d.type}#${d.id}.${d.key}\n     src : ${JSON.stringify(d.src).slice(0, 160)}\n     ours: ${JSON.stringify(d.ours).slice(0, 160)}`);
}

if (VERBOSE) {
  console.log('\n--- content differences (sample) ---');
  for (const d of contentDiffs.slice(0, 25)) {
    console.log(`  ${d.type}#${d.id}.${d.key}\n     src : ${JSON.stringify(d.src).slice(0, 160)}\n     ours: ${JSON.stringify(d.ours).slice(0, 160)}`);
  }
}

await writeFile(join(OUT, `${OUT_NAME}-report.json`), JSON.stringify({ url, stats, perType: Object.fromEntries(perType), missKeys: Object.fromEntries(missKeys), diffSamples, contentDiffs }, null, 1));
