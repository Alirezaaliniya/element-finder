/**
 * Run the Elementor CSS reverse engine on CSS files for one element, in Node.
 *
 *   node tools/e2e/reverse-debug.mjs <file.css>... --id <elementId> --type container|section|column|<widgetType>
 *
 * Prints the element's rules, the recovered settings, globals and leftovers.
 */
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(import.meta.dirname, '../..');
const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(`--${n}`); return i === -1 ? null : args[i + 1]; };
const files = args.filter((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));
const id = opt('id');
const type = opt('type') ?? 'container';

const imp = (p) => import(pathToFileURL(join(ROOT, p)).href);
const { parseCss } = await imp('extension/src/engines/elementor/css-text.js');
const { ControlsIndex } = await imp('extension/src/engines/elementor/controls-index.js');
const { reverseElement } = await imp('extension/src/engines/elementor/css-reverse.js');

const map = JSON.parse(await readFile(join(ROOT, 'extension/src/engines/elementor/data/controls-map.json'), 'utf8'));
const index = new ControlsIndex(map);
const isElement = ['container', 'section', 'column'].includes(type);
const stack = index.stackFor(isElement ? type : 'widget', isElement ? null : type);
if (!stack) { console.error('no controls for', type); process.exit(1); }

const rules = [];
for (const f of files) {
  for (const rule of parseCss(await readFile(f, 'utf8'))) {
    for (const selector of rule.selectors) {
      if (new RegExp(`\\.elementor-element-${id}(?![\\w-])`).test(selector)) rules.push({ selector, rule });
    }
  }
}
console.log(`--- ${rules.length} rule(s) for ${id}`);
for (const { selector, rule } of rules) {
  console.log(`  ${rule.media ? `@media ${rule.media} ` : ''}${selector}`);
  console.log(`     ${rule.decls.map((d) => `${d.prop}:${d.value}`).join('; ').slice(0, 300)}`);
}
const result = reverseElement({ stack, elementId: id, rules, breakpoints: map.breakpoints, varLookup: () => '', classes: [] });
console.log('--- settings'); console.log(JSON.stringify(result.settings, null, 1));
console.log('--- globals', JSON.stringify(result.globals));
console.log('--- leftover css\n' + result.leftoverCss);
console.log('--- custom css\n' + result.customCss);
