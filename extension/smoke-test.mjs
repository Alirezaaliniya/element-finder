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
