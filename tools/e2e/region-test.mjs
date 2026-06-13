/**
 * Region regression test — reproduces the user's "hero section" comparison:
 * the fixture mirrors the Elementor frontend markup whose official export is
 * `فایلی که با المنتور از یک ناحیه استخراج گرفتم.json`. The pipeline runs in
 * element-pick scope on the root container and the export must match the
 * reference's structure and styling semantics.
 */

import http from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import puppeteer from 'puppeteer-core';

const ROOT = resolve(import.meta.dirname, '../..');
const OUT = resolve(import.meta.dirname, 'out');
const PORT = 8126;

// Mirrors real Elementor frontend output: --width custom props, custom CSS
// classes, e-con-* layout classes, page custom CSS in an inline <style>.
const FIXTURE = `<!doctype html>
<html dir="rtl" lang="fa">
<head><meta charset="utf-8"><style>
  body { margin:0; font-family:"nias peyda"; font-size:17px; line-height:34px; color:#1E293B; }
  .elementor-99 .nias-pop-animation { filter: drop-shadow(0 10px 20px rgba(0,0,0,.2)); }
  .elementor-99 .ns-button:hover { transform: scale(1.05); }
</style></head>
<body>
<div class="elementor elementor-99">
  <div class="elementor-element elementor-element-5ed3a3a9 e-flex e-con e-parent" data-id="5ed3a3a9" data-element_type="container"
       data-settings='{"background_background":"classic"}'
       style="display:flex;flex-direction:row;justify-content:space-around;align-items:center;min-height:513px;overflow:hidden;position:relative;--width:1200px">

    <div class="elementor-element elementor-element-661f0e95 nias-pop-animation elementor-widget elementor-widget-image" data-id="661f0e95"
         data-element_type="widget" data-widget_type="image.default" data-settings='{"_position":"absolute"}'
         style="position:absolute;left:874px;top:0;width:240px">
      <div class="elementor-widget-container"><img src="/img/image24.avif" alt="" width="240" height="240"></div>
    </div>

    <div class="elementor-element elementor-element-57f3fdc2 e-con e-child" data-id="57f3fdc2" data-element_type="container"
         style="display:flex;flex-direction:row;flex-wrap:wrap;align-items:center;--width:400px">

      <div class="elementor-element elementor-element-5a48e45e elementor-widget elementor-widget-heading" data-id="5a48e45e"
           data-element_type="widget" data-widget_type="heading.default" style="text-align:center">
        <div class="elementor-widget-container">
          <span class="elementor-heading-title" style="font-size:32px;line-height:40px">یادگیری المنتور در</span>
        </div>
      </div>

      <div class="elementor-element elementor-element-37499ff2 elementor-widget elementor-widget-heading" data-id="37499ff2"
           data-element_type="widget" data-widget_type="heading.default" style="text-align:center">
        <div class="elementor-widget-container">
          <h1 class="elementor-heading-title" style="font-size:69px;font-weight:700;line-height:75px;color:#20242E;margin:0">آکادمی نیاس</h1>
        </div>
      </div>

      <div class="elementor-element elementor-element-35072f31 elementor-widget elementor-widget-button" data-id="35072f31"
           data-element_type="widget" data-widget_type="button.default" style="--width:47%;width:47%">
        <div class="elementor-widget-container">
          <div class="elementor-button-wrapper">
            <a class="elementor-button ns-button" href="https://nias.ir/course/elementor/"
               style="display:inline-block;padding:15px 25px 15px 25px;background-color:#FF6B35;color:#FFFFFF;border-radius:10px">
              <span class="elementor-button-content-wrapper"><span class="elementor-button-text">شرکت در دوره</span></span>
            </a>
          </div>
        </div>
      </div>

      <div class="elementor-element elementor-element-d1b9e92 elementor-widget elementor-widget-image" data-id="d1b9e92"
           data-element_type="widget" data-widget_type="image.default" style="--width:47%;width:47%">
        <div class="elementor-widget-container"><img src="/img/group36885.webp" alt="" width="180" height="60"></div>
      </div>

      <div class="elementor-element elementor-element-6ace0186 elementor-widget elementor-widget-heading" data-id="6ace0186"
           data-element_type="widget" data-widget_type="heading.default" style="text-align:center">
        <div class="elementor-widget-container">
          <span class="elementor-heading-title" style="color:#94969A">با بروز ترین متد های نوین و کلی پروژه استاد شو .</span>
        </div>
      </div>
    </div>

    <div class="elementor-element elementor-element-16068df4 elementor-widget elementor-widget-image" data-id="16068df4"
         data-element_type="widget" data-widget_type="image.default" style="position:absolute;right:80px;top:40px;width:120px">
      <div class="elementor-widget-container"><img src="/img/Frame-57-1.webp" alt="" width="120" height="120"></div>
    </div>
  </div>
</div>
</body></html>`;

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' };
const PIXEL = Buffer.from('R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==', 'base64');
const server = http.createServer(async (req, res) => {
  try {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (path === '/fixture.html') { res.writeHead(200, { 'content-type': MIME['.html'] }); res.end(FIXTURE); return; }
    if (path.startsWith('/img/')) { res.writeHead(200, { 'content-type': 'image/gif' }); res.end(PIXEL); return; }
    const file = join(ROOT, path);
    if (!existsSync(file)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream' });
    res.end(await readFile(file));
  } catch { res.writeHead(500); res.end(); }
});
await new Promise((r) => server.listen(PORT, r));

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: 'new', args: ['--no-sandbox'], defaultViewport: { width: 1440, height: 900 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 200)));
await page.goto(`http://localhost:${PORT}/fixture.html`, { waitUntil: 'networkidle2' });

const result = await page.evaluate(async (port) => {
  const base = `http://localhost:${port}/extension/src`;
  const { ExtractionPipeline } = await import(`${base}/core/ExtractionPipeline.js`);
  const { DomAnalysisEngine } = await import(`${base}/engines/dom/DomAnalysisEngine.js`);
  const { ContentExtractionEngine } = await import(`${base}/engines/content/ContentExtractionEngine.js`);
  const { CssInterpretationEngine } = await import(`${base}/engines/css/CssInterpretationEngine.js`);
  const { ResponsiveAnalysisEngine } = await import(`${base}/engines/responsive/ResponsiveAnalysisEngine.js`);
  const { AssetCollectionEngine } = await import(`${base}/engines/assets/AssetCollectionEngine.js`);
  const { WidgetMappingEngine } = await import(`${base}/engines/mapping/WidgetMappingEngine.js`);
  const pipeline = new ExtractionPipeline([
    { name: 'dom', engine: new DomAnalysisEngine() },
    { name: 'content', engine: new ContentExtractionEngine() },
    { name: 'css', engine: new CssInterpretationEngine() },
    { name: 'responsive', engine: new ResponsiveAnalysisEngine() },
    { name: 'assets', engine: new AssetCollectionEngine() },
    { name: 'mapping', engine: new WidgetMappingEngine() },
  ]);
  // Element-pick scope: the hero container, exactly like the user's extraction.
  const rootEl = document.querySelector('.elementor-element-5ed3a3a9');
  const snapshot = await pipeline.run(document, rootEl);
  return { snapshot };
}, PORT);

await browser.close();
server.close();

const { exportElementorTemplate } = await import(`file://${ROOT.replace(/\\/g, '/')}/extension/src/engines/export/elementor-exporter.js`);
const tpl = exportElementorTemplate(result.snapshot);
await mkdir(OUT, { recursive: true });
await writeFile(join(OUT, 'region-export.json'), JSON.stringify(tpl, null, 1));
await writeFile(join(OUT, 'region-snapshot.json'), JSON.stringify(result.snapshot, null, 1));

/* ---------------- assertions against the reference export ---------------- */

let failures = 0;
const assert = (cond, label) => { console.log((cond ? ' OK  ' : 'FAIL ') + label); if (!cond) failures++; };
const widgets = [];
(function collect(els) { for (const el of els ?? []) { widgets.push(el); collect(el.elements); } })(tpl.content);
const byType = (t) => widgets.filter((w) => w.widgetType === t);

// 1. Root container preserved with its layout settings; template type "container".
assert(tpl.type === 'container', `type is "container" (got "${tpl.type}")`);
assert(tpl.content.length === 1 && tpl.content[0].elType === 'container', 'single root container');
const root = tpl.content[0];
assert(root.settings.flex_direction === 'row', 'root flex_direction row');
assert(root.settings.flex_justify_content === 'space-around', `root justify space-around (got ${root.settings.flex_justify_content})`);
assert(root.settings.flex_align_items === 'center', 'root align center');
assert(root.settings.min_height?.size === 513, `root min_height 513 (got ${JSON.stringify(root.settings.min_height)})`);
assert(root.settings.width?.size === 1200, `root width 1200 (got ${JSON.stringify(root.settings.width)})`);
assert(root.settings.overflow === 'hidden', `root overflow hidden (got ${root.settings.overflow})`);
assert(root.settings.background_background === 'classic', `root native background_background merged (got ${root.settings.background_background})`);
assert(root.elements.length === 3, `root has 3 children (got ${root.elements.length})`);
const innerCol = root.elements[1];
assert(innerCol.settings.width?.size === 400, `inner container width 400 (got ${JSON.stringify(innerCol.settings.width)})`);

// 2. No inherited typography junk on images/buttons (reference images have none).
for (const img of byType('image')) {
  assert(!img.settings.typography_typography && !img.settings.color && !img.settings.align,
    `image ${img.id} carries no inherited typography/color/align`);
  assert(!!img.settings.image?.url, `image ${img.id} has URL`);
}

// 2b. REGRESSION: --width inherits in CSS; widgets that don't set their OWN
//     width must NOT inherit the container's as a bogus width.
const noWidth = (e) => !e.settings.width && !e.settings._element_custom_width;
const img24 = byType('image').find((i) => i.settings.image?.url?.includes('image24'));
const frame57 = byType('image').find((i) => i.settings.image?.url?.includes('Frame-57'));
assert(noWidth(img24), `decorative image24 has no inherited width (w=${JSON.stringify(img24.settings.width)} ecw=${JSON.stringify(img24.settings._element_custom_width)})`);
assert(noWidth(frame57), `decorative Frame-57 has no inherited width`);
for (const h of byType('heading')) {
  assert(noWidth(h), `heading "${h.settings.title?.slice(0,16)}" has no inherited width (w=${JSON.stringify(h.settings.width)} ecw=${JSON.stringify(h.settings._element_custom_width)})`);
}
// The image that DOES declare its own --width:47% keeps it.
const grpImg = byType('image').find((i) => i.settings.image?.url?.includes('group36885'));
assert(grpImg?.settings._element_custom_width?.size === 47, `group36885 keeps its own 47% width (got ${JSON.stringify(grpImg?.settings._element_custom_width)})`);

// 2c. REGRESSION: auto-centering margins must not be exported anywhere.
assert(!root.settings.margin, `root has NO phantom auto-margin (got ${JSON.stringify(root.settings.margin)})`);
for (const w of widgets) {
  assert(!w.settings.margin || (w.settings.margin.left !== w.settings.margin.right) || parseFloat(w.settings.margin.left) < 4,
    `element ${w.elType}:${w.widget} has no phantom auto-margin (got ${JSON.stringify(w.settings.margin)})`);
}

// 3. Heading rendered as <span> keeps its own 32px size and span tag.
const h1s = byType('heading');
const small = h1s.find((h) => h.settings.title?.includes('یادگیری'));
assert(!!small, 'small heading exists');
assert(small?.settings.typography_font_size?.size === 32, `small heading font 32 (got ${small?.settings.typography_font_size?.size})`);
assert(small?.settings.header_size === 'span', `small heading header_size span (got ${small?.settings.header_size})`);
const big = h1s.find((h) => h.settings.title?.includes('آکادمی'));
assert(big?.settings.typography_font_size?.size === 69, 'big heading font 69');
assert(big?.settings.header_size === 'h1', 'big heading h1');
assert(big?.settings.title_color === '#20242E', `big heading color #20242E (got ${big?.settings.title_color})`);
assert(big?.settings.typography_font_weight === 'bold', 'big heading bold');
const desc = h1s.find((h) => h.settings.title?.includes('استاد شو'));
assert(desc?.settings.title_color === '#94969A', `description color #94969A (got ${desc?.settings.title_color})`);

// 4. Button absorbed its <a>: text, link, padding (text_padding), background.
const btn = byType('button')[0];
assert(!!btn, 'button widget exists');
assert(btn?.settings.text === 'شرکت در دوره', 'button text');
assert(btn?.settings.link?.url?.includes('nias.ir/course'), `button link (got ${btn?.settings.link?.url})`);
assert(btn?.settings.text_padding?.top === '15' && btn?.settings.text_padding?.right === '25', `button text_padding 15/25 (got ${JSON.stringify(btn?.settings.text_padding)})`);
assert(btn?.settings.background_color === '#FF6B35', `button background (got ${btn?.settings.background_color})`);

// 5. The corner image (declared right:80px) anchors to "end" with offset 80.
const corner = byType('image').find((i) => i.settings.image?.url?.includes('Frame-57'));
assert(corner?.settings._position === 'absolute', 'corner image is absolute');
assert(corner?.settings._offset_orientation_h === 'end', `corner image anchors to end (got ${corner?.settings._offset_orientation_h})`);
assert(corner?.settings._offset_x_end?.size === 80, `end offset 80 (got ${corner?.settings._offset_x_end?.size})`);

// 6. Custom CSS classes preserved (page custom CSS targets these).
const popImg = byType('image').find((i) => i.settings.image?.url?.includes('image24'));
assert(popImg?.settings._css_classes === 'nias-pop-animation', `image keeps _css_classes (got ${popImg?.settings._css_classes})`);
assert(btn?.settings._css_classes === 'ns-button', `button keeps hoisted _css_classes (got ${btn?.settings._css_classes})`);

// 7. Flex-item custom widths recovered from --width (47%).
assert(btn?.settings._element_custom_width?.size === 47 && btn?.settings._element_custom_width?.unit === '%',
  `button _element_custom_width 47% (got ${JSON.stringify(btn?.settings._element_custom_width)})`);

// 8. Page custom CSS recovered and class-prefix stripped.
assert(/\.ns-button:hover/.test(tpl.page_settings.custom_css || ''), 'page custom_css includes .ns-button:hover');
assert(/\.nias-pop-animation/.test(tpl.page_settings.custom_css || ''), 'page custom_css includes .nias-pop-animation');
assert(!/\.elementor-99/.test(tpl.page_settings.custom_css || ''), 'page custom_css strips .elementor-99 scope prefix');

if (failures) { console.error(`\n${failures} REGION ASSERTION(S) FAILED`); process.exit(1); }
console.log('\nALL REGION ASSERTIONS PASSED');
