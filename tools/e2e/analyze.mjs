/** Post-mortem: where do IR nodes go missing from the export, and where are backgrounds? */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const OUT = resolve(import.meta.dirname, 'out');
const snapshot = JSON.parse(await readFile(`${OUT}/snapshot.json`, 'utf8'));
const tpl = JSON.parse(await readFile(`${OUT}/elementor-export.json`, 'utf8'));

const exportedIds = new Set();
(function collect(els) {
  for (const el of els ?? []) { exportedIds.add(el.id); collect(el.elements); }
})(tpl.content);

// IR nodes with native elementor identity that did NOT export, grouped by the widgetType of the nearest exported ancestor.
const lost = new Map();
let bgNodes = 0;
const bgSamples = [];
(function walk(node, ancestorWidget) {
  if (!node) return;
  const isExported = exportedIds.has(node.id);
  const native = node.semantic?.elementorNative;
  if (native && !isExported) {
    const key = ancestorWidget ?? '(none)';
    lost.set(key, (lost.get(key) ?? 0) + 1);
  }
  const bg = node.styles?.desktop?.['background-image'];
  if (bg && bg !== 'none') {
    bgNodes++;
    if (bgSamples.length < 10) bgSamples.push({ id: node.id, exported: isExported, label: node.label, widget: node.mapping?.widgetType ?? node.mapping?.elType, bg: bg.slice(0, 110) });
  }
  const nextAncestor = isExported && node.mapping?.elType === 'widget' ? node.mapping.widgetType : ancestorWidget;
  for (const c of node.children ?? []) walk(c, isExported ? nextAncestor : ancestorWidget);
})(snapshot.tree, null);

console.log('NATIVE NODES LOST FROM EXPORT, by swallowing widget:');
for (const [k, v] of [...lost.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${v}  inside ${k}`);

console.log(`\nIR nodes with background-image: ${bgNodes}`);
for (const s of bgSamples) console.log(' ', JSON.stringify(s));

// Also: how many exported elements have background_image setting?
let exportedBg = 0;
(function walk2(els) {
  for (const el of els ?? []) {
    if (el.settings?.background_image?.url) exportedBg++;
    walk2(el.elements);
  }
})(tpl.content);
console.log(`\nexported elements with background_image: ${exportedBg}`);
