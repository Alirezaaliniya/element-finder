/**
 * Precise structural + settings diff between the official Elementor export
 * (reference) and the extension's export (actual), to enumerate EVERY
 * missing or differing setting. Matches elements positionally by depth-first
 * order (ids differ between tools).
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../..');
const ref = JSON.parse(await readFile(`${ROOT}/فایلی که با المنتور از یک ناحیه استخراج گرفتم.json`, 'utf8'));
const act = JSON.parse(await readFile(`${ROOT}/همون ناحیه که با اکستنشن استخراج گرفته شده و دارای مشکل است.json`, 'utf8'));

console.log('TEMPLATE META');
console.log(`  type:      ref="${ref.type}"  act="${act.type}"  ${ref.type === act.type ? 'OK' : '❌ DIFF'}`);
console.log(`  topLevel:  ref=${ref.content.length}  act=${act.content.length}  ${ref.content.length === act.content.length ? 'OK' : '❌ DIFF'}`);

function flatten(els, depth = 0, out = []) {
  for (const el of els ?? []) {
    out.push({ depth, elType: el.elType, widget: el.widgetType ?? null, settings: el.settings ?? {} });
    flatten(el.elements, depth + 1, out);
  }
  return out;
}
const refFlat = flatten(ref.content);
const actFlat = flatten(act.content);

console.log(`\nELEMENT COUNT  ref=${refFlat.length}  act=${actFlat.length}`);
console.log('\nELEMENT SEQUENCE (ref vs act):');
const max = Math.max(refFlat.length, actFlat.length);
for (let i = 0; i < max; i++) {
  const r = refFlat[i], a = actFlat[i];
  const rs = r ? `${'  '.repeat(r.depth)}${r.elType}:${r.widget ?? ''}` : '—';
  const as = a ? `${'  '.repeat(a.depth)}${a.elType}:${a.widget ?? ''}` : '—';
  const sameType = r && a && r.elType === a.elType && r.widget === a.widget;
  console.log(`  [${i}] ${sameType ? '  ' : '❌'} ref(${rs.trim()})  |  act(${as.trim()})`);
}

// Settings comparison for aligned widgets (match by title/text/image filename).
console.log('\n\nPER-WIDGET SETTINGS GAPS (reference key -> status in actual):');
const idOf = (el) => el.settings.title || el.settings.text || el.settings.image?.url?.split('/').pop() || `${el.widget}`;
const actByKey = new Map(actFlat.map((e) => [idOf(e), e]));

for (const r of refFlat) {
  const key = idOf(r);
  const a = actByKey.get(key);
  if (!a) { console.log(`\n  ⨯ MISSING ELEMENT entirely: ${r.elType}:${r.widget} "${String(key).slice(0, 30)}"`); continue; }
  const missing = [];
  const different = [];
  for (const [k, v] of Object.entries(r.settings)) {
    if (k === '__globals__' || k === '__dynamic__') continue;
    if (!(k in a.settings)) { missing.push(k); continue; }
    const rv = JSON.stringify(v), av = JSON.stringify(a.settings[k]);
    if (rv !== av) different.push(`${k} (ref=${rv.slice(0, 40)} act=${av.slice(0, 40)})`);
  }
  if (missing.length || different.length) {
    console.log(`\n  ${r.elType}:${r.widget} "${String(key).slice(0, 30)}"`);
    if (missing.length) console.log(`    MISSING: ${missing.join(', ')}`);
    if (different.length) for (const d of different) console.log(`    DIFF: ${d}`);
  }
}
