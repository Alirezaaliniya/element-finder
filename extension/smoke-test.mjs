/**
 * Smoke test for the DOM-free modules (converters, mapping, exporter,
 * zip writer, validation). Run with: node smoke-test.mjs
 */

let failures = 0;
function check(cond, label) {
  if (!cond) { console.error('FAIL:', label); failures++; }
}

// --- CSS converters ------------------------------------------------------
const { toHexColor, toSlider, toDimensions, parseBoxShadow, extractGradient, declarationsToSettings } =
  await import('./src/engines/css/converters.js');

check(toHexColor('rgb(244, 116, 33)') === '#F47421', 'hex: ' + toHexColor('rgb(244, 116, 33)'));
check(toHexColor('rgba(244, 116, 33, 0.18)') === '#F474212E', 'hexa: ' + toHexColor('rgba(244, 116, 33, 0.18)'));
check(toHexColor('rgba(0, 0, 0, 0)') === null, 'transparent -> null');
check(JSON.stringify(toSlider('30px')) === '{"unit":"px","size":30,"sizes":[]}', 'slider px');
check(toSlider('50%').unit === '%', 'slider %');

const dim = toDimensions('5px', '20px', '5px', '20px');
check(dim.top === '5' && dim.right === '20' && dim.isLinked === false, 'dimensions');
check(toDimensions('0px', '0px', '0px', '0px') === null, 'all-zero dims -> null');

// units are preserved
const dimEm = toDimensions('2em', '1rem', '0', '0');
check(dimEm.unit === 'em', 'dimensions em unit: ' + dimEm.unit);
check(dimEm.top === '2', 'dimensions em top');

const dimPct = toDimensions('5%', '10%', '5%', '10%');
check(dimPct.unit === '%', 'dimensions % unit: ' + dimPct.unit);

const sh = parseBoxShadow('rgba(0, 0, 0, 0.25) 0px 4px 12px 0px');
check(sh.vertical === 4 && sh.blur === 12, 'box-shadow');

const shInset = parseBoxShadow('inset rgba(0, 0, 0, 0.5) 0px 2px 8px 0px');
check(shInset.inset === 'yes' && shInset.vertical === 2, 'box-shadow inset');

const shInsetMid = parseBoxShadow('0px 4px 12px 0px inset rgba(0,0,0,0.3)');
check(shInsetMid.inset === 'yes', 'box-shadow inset mid');

const g = extractGradient('linear-gradient(135deg, rgb(124,92,255) 0%, rgb(74,52,184) 100%)');
check(g.angle === 135 && g.colorA === '#7C5CFF', 'gradient');

const s = declarationsToSettings({
  'display': 'flex', 'flex-direction': 'column', 'column-gap': '10px', 'row-gap': '10px',
  'padding-top': '20px', 'padding-right': '20px', 'padding-bottom': '20px', 'padding-left': '20px',
  'background-color': 'rgb(244,116,33)', 'font-size': '30px', 'font-weight': '700',
  'color': 'rgb(255,255,255)',
}, { isContainer: true });
check(s.flex_direction === 'column', 'settings flex_direction');
check(s.flex_gap?.size === 10 && s.flex_gap?.isLinked === true, 'settings flex_gap');
check(s.padding?.isLinked === true, 'settings padding linked');
check(s.background_color === '#F47421' && s.background_background === 'classic', 'settings background');
check(s.typography_font_weight === 'bold' && s.typography_typography === 'custom', 'settings typography');

// --- utils ------------------------------------------------------------------
const { elementorId, walkTree, findNode, findParent } = await import('./src/common/utils.js');
check(/^[0-9a-f]{7,8}$/.test(elementorId()), 'elementorId format');

// --- mapping -------------------------------------------------------------------
const { WidgetMappingEngine } = await import('./src/engines/mapping/WidgetMappingEngine.js');
const { createNode, createSnapshot } = await import('./src/core/model.js');
const eng = new WidgetMappingEngine();

const h = createNode({ tag: 'h2', role: 'widget', content: { text: 'Hello', headerSize: 'h2' } });
const mh = eng.mapNode(h);
check(mh.widgetType === 'heading' && mh.confidence > 0.9, 'map heading: ' + JSON.stringify(mh));

const nat = createNode({
  tag: 'div', role: 'widget',
  semantic: { kind: null, isRepeated: false, patternKey: null, elementorNative: { elType: 'widget', widgetType: 'loop-carousel' } },
});
check(eng.mapNode(nat).source === 'elementor-native', 'native passthrough');

const btn = createNode({ tag: 'a', role: 'widget', content: { text: 'Buy', href: 'https://x', isButtonLike: true } });
check(eng.mapNode(btn).widgetType === 'button', 'map button');

const mystery = createNode({ tag: 'div', role: 'widget', content: {} });
check(eng.mapNode(mystery).widgetType === 'html', 'fallback html');

// --- exporter ---------------------------------------------------------------------
const { exportElementorTemplate } = await import('./src/engines/export/elementor-exporter.js');
const root = createNode({ tag: 'body', role: 'container', mapping: { elType: 'container', widgetType: null, confidence: 1, source: 'rule', alternatives: [] } });
h.mapping = mh;
h.settings.desktop = { color: '#FFFFFF', typography_typography: 'custom', typography_font_size: { unit: 'px', size: 30, sizes: [] } };
h.settings.mobile = { typography_font_size: { unit: 'px', size: 20, sizes: [] } };
const cont = createNode({ tag: 'div', role: 'container', mapping: { elType: 'container', widgetType: null, confidence: 1, source: 'rule', alternatives: [] }, children: [h] });
cont.settings.desktop = { flex_direction: 'row', background_color: '#F47421', background_background: 'classic' };
root.children.push(cont);

const snap = createSnapshot({ tree: root, meta: { title: 'Test', url: 'https://x.test', dir: 'rtl' } });
const tpl = exportElementorTemplate(snap);
check(tpl.version === '0.4' && tpl.type === 'page', 'template meta');
check(tpl.content[0].elType === 'container' && tpl.content[0].settings.flex_direction === 'row', 'container export');
const w = tpl.content[0].elements[0];
check(w.widgetType === 'heading' && w.settings.title === 'Hello', 'heading content export');
check(w.settings.title_color === '#FFFFFF', 'color renamed to title_color: ' + JSON.stringify(w.settings));
check(w.settings.typography_font_size_mobile?.size === 20, 'responsive _mobile suffix');
check(w.settings.typography_font_size?.size === 30, 'desktop unsuffixed');

// --- control-name resolution (widget-controls.js) -------------------------
const { resolveSettingKey, isResponsiveKey } = await import('./src/engines/export/widget-controls.js');
check(resolveSettingKey('padding', null) === 'padding', 'container padding');
check(resolveSettingKey('padding', 'heading') === '_padding', 'widget padding -> _padding');
check(resolveSettingKey('padding', 'button') === 'text_padding', 'button padding -> text_padding');
check(resolveSettingKey('_position', null) === 'position', 'container position drops underscore');
check(resolveSettingKey('_position', 'heading') === '_position', 'widget position keeps underscore');
check(resolveSettingKey('_css_classes', null) === 'css_classes', 'container css_classes');
check(resolveSettingKey('_css_classes', 'heading') === '_css_classes', 'widget _css_classes');
check(resolveSettingKey('background_color', 'heading') === '_background_color', 'widget background -> _background_*');
check(resolveSettingKey('background_color', 'button') === 'background_color', 'button keeps its own background group');
check(resolveSettingKey('background_color', null) === 'background_color', 'container background');
check(resolveSettingKey('typography_font_size', 'icon-box') === 'title_typography_font_size', 'icon-box typography group');
check(resolveSettingKey('typography_font_size', null) === null, 'container has no typography');
check(resolveSettingKey('color', 'testimonial') === 'content_content_color', 'testimonial text colour');
check(resolveSettingKey('align', 'icon-box') === 'text_align', 'icon-box align -> text_align');
check(resolveSettingKey('border_radius', 'image') === 'image_border_radius', 'image radius');
check(resolveSettingKey('border_radius', 'heading') === '_border_radius', 'widget radius -> _border_radius');
check(resolveSettingKey('min_height', 'heading') === null, 'min_height is container-only');
check(isResponsiveKey('color') === false && isResponsiveKey('padding') === true, 'responsive key table');

// --- export uses resolved names ------------------------------------------
const ib = createNode({
  tag: 'div', role: 'widget', attrs: { id: 'features' },
  customClasses: ['my-card'],
  content: { composite: { title: 'Fast', description: 'Really fast' } },
  mapping: { elType: 'widget', widgetType: 'icon-box', confidence: 1, source: 'rule', alternatives: [] },
});
ib.settings.desktop = {
  color: '#111111', align: 'center', padding: { unit: 'px', top: '8', right: '8', bottom: '8', left: '8', isLinked: true },
  background_color: '#EEEEEE', background_background: 'classic',
  typography_typography: 'custom', typography_font_size: { unit: 'px', size: 24, sizes: [] },
};
ib.settings.tablet = { color: '#222222', typography_font_size: { unit: 'px', size: 18, sizes: [] } };
cont.children.push(ib);
cont.customClasses = ['hero-row'];
cont.tag = 'section';
const tpl3 = exportElementorTemplate(snap);
const ibOut = tpl3.content[0].elements.find((e) => e.widgetType === 'icon-box').settings;
check(ibOut.title_color === '#111111', 'icon-box colour -> title_color');
check(ibOut.text_align === 'center', 'icon-box align -> text_align');
check(ibOut._padding?.top === '8', 'icon-box padding -> _padding');
check(ibOut._background_color === '#EEEEEE', 'icon-box background -> _background_color');
check(ibOut.title_typography_font_size?.size === 24, 'icon-box typography group applied');
check(ibOut.title_typography_font_size_tablet?.size === 18, 'responsive typography suffix');
check(ibOut.title_color_tablet === undefined, 'non-responsive colour has no _tablet twin');
check(ibOut._css_classes === 'my-card', 'widget custom classes');
check(ibOut._element_id === 'features', 'widget element id preserved');
const contOut = tpl3.content[0].settings;
check(contOut.css_classes === 'hero-row', 'container classes use css_classes: ' + JSON.stringify(contOut.css_classes));
check(contOut._css_classes === undefined, 'container does not use _css_classes');
check(contOut.html_tag === 'section', 'container html_tag from source tag');
cont.children.pop();
cont.tag = 'div';
cont.customClasses = [];

// hidden nodes are dropped
h.hidden = true;
const tpl2 = exportElementorTemplate(snap);
check((tpl2.content[0].elements ?? []).length === 0, 'hidden node dropped from export');
h.hidden = false;

// --- zip writer --------------------------------------------------------------------
const { ZipWriter } = await import('./src/engines/export/ZipWriter.js');
const zip = new ZipWriter();
zip.addFile('a/b.txt', 'hello zip');
zip.addFile('manifest.json', '{}');
const blob = zip.build();
const buf = new Uint8Array(await blob.arrayBuffer());
check(buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04, 'zip local header magic');
const tail = buf.slice(-22);
check(tail[0] === 0x50 && tail[1] === 0x4b && tail[2] === 0x05 && tail[3] === 0x06, 'zip EOCD magic');
check(new DataView(tail.buffer, tail.byteOffset).getUint16(10, true) === 2, 'zip entry count');

// --- validation ----------------------------------------------------------------------
const { ValidationEngine } = await import('./src/engines/validation/ValidationEngine.js');
const v = new ValidationEngine();
const report = v.validate(snap);
check(typeof report.ok === 'boolean' && Array.isArray(report.issues), 'validation report shape');

// broken image must be an error with a fix
const badImg = createNode({ tag: 'img', role: 'widget', mapping: { elType: 'widget', widgetType: 'image', confidence: 1, source: 'rule', alternatives: [] } });
cont.children.push(badImg);
const report2 = v.validate(snap);
const imgIssue = report2.issues.find((i) => i.code === 'image-missing-src');
check(imgIssue?.severity === 'error' && typeof imgIssue.fix?.apply === 'function', 'image-missing-src detected');
check(v.applyFix(snap, imgIssue) === true, 'fix applied');
check(badImg.hidden === true, 'fix hid the node');

// --- tree utils ------------------------------------------------------------------------
check(findNode(root, h.id)?.id === h.id, 'findNode');
check(findParent(root, h.id)?.id === cont.id, 'findParent');
let visits = 0;
walkTree(root, () => { visits++; });
check(visits === 4, 'walkTree count: ' + visits);

// --- storage diff (static method, no IndexedDB needed) -----------------------------------
const { ProjectStorageEngine } = await import('./src/engines/storage/ProjectStorageEngine.js');
const snapB = structuredClone(snap);
snapB.tree.children[0].children[0].content.text = 'Changed';
const diff = ProjectStorageEngine.compareSnapshots(snap, snapB);
check(diff.contentChanged.length >= 1 && diff.added.length === 0, 'version diff: ' + diff.summary);

if (failures) {
  console.error(`\n${failures} CHECK(S) FAILED`);
  process.exit(1);
}
console.log('ALL SMOKE TESTS PASSED');
