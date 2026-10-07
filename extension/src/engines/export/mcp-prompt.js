/**
 * "Elementor MCP prompt" export: a self-contained Markdown brief an AI agent
 * with an Elementor MCP server can execute to rebuild the page.
 *
 * MCP servers for Elementor differ a lot — Elementor's own server
 * (modules/mcp: list-pages, get-page-structure, create-page,
 * update-page-settings, get-globals) cannot write elements, community
 * servers add container/widget tools or a "set page data" tool, and generic
 * WordPress servers only expose post meta. The brief therefore carries the
 * EXACT element data (same JSON as the template export) and tells the agent
 * how to apply it with whichever capability it has, in order of fidelity,
 * then how to verify the result.
 */

import { exportElementorTemplate } from './elementor-exporter.js';
import { widgetInfo } from '../mapping/widget-catalog.js';

/**
 * @param {object} snapshot IR snapshot
 * @param {object} [options] same as exportElementorTemplate (title, keepGlobals, atomic)
 * @returns {string} Markdown prompt
 */
export function buildMcpPrompt(snapshot, options = {}) {
  const template = exportElementorTemplate(snapshot, options);
  const title = template.title;
  const stats = analyse(template);
  const meta = snapshot.meta ?? {};
  const rtl = (meta.dir || '').toLowerCase() === 'rtl';

  const sections = [
    `# Rebuild "${title}" in Elementor (via MCP)`,
    intro(meta, title),
    requirements(stats, meta, rtl, options),
    procedure(stats),
    rules(rtl),
    verification(stats),
    manifest(stats),
    outline(template.content),
    warningsSection(snapshot),
    dataSection(template),
  ];
  return `${sections.filter(Boolean).join('\n\n')}\n`;
}

/* ------------------------------------------------------------------ */

function intro(meta, title) {
  return [
    'You are an expert Elementor builder working through an MCP connection to a WordPress site.',
    `Your task: recreate the page **${title}** exactly as specified in this brief — same structure, widgets, content and styles.`,
    meta.url ? `Source page (for visual reference only, do not scrape it): ${meta.url}` : '',
    'Everything you need is in this document. The authoritative specification is the Elementor JSON in the final section;',
    'it was recovered from the source page\'s own Elementor data (control names and values are real Elementor settings, not approximations).',
    '**Do not redesign, simplify, translate, re-word or "improve" anything.**',
  ].filter(Boolean).join('\n');
}

function requirements(stats, meta, rtl, options) {
  const lines = ['## Requirements to check first'];
  const generator = meta.elementor?.generator?.split(';')[0];
  lines.push(`- Elementor ${generator ? `(source used ${generator})` : ''} must be active on the target site.`);
  if (stats.proWidgets.size) lines.push(`- **Elementor Pro** is required for: ${[...stats.proWidgets].map(code).join(', ')}.`);
  if (stats.wooWidgets.size) lines.push(`- **WooCommerce + Elementor Pro** are required for: ${[...stats.wooWidgets].map(code).join(', ')}.`);
  if (stats.atomic.size) lines.push(`- **Elementor 4 atomic (V4) elements** are used (${[...stats.atomic].map(code).join(', ')}). The V4 editor/experiment must be enabled.`);
  if (stats.unknownWidgets.size) lines.push(`- Third-party widgets from other plugins are used: ${[...stats.unknownWidgets].map(code).join(', ')}. If a plugin is missing, report it and continue with the rest.`);
  if (stats.fonts.size) lines.push(`- Fonts referenced by the design: ${[...stats.fonts].map(code).join(', ')}. If a font is not available on the target site, tell the user (it can be added via Elementor → Custom Fonts); keep the font name in the settings anyway.`);
  if (rtl) lines.push('- The page is **right-to-left** (Persian/Arabic). The target site should use an RTL language; do not mirror or "fix" alignment values — they are already correct for RTL.');
  if (options.keepGlobals) lines.push('- The data keeps `__globals__` references to the source kit. They only work on the SAME site/kit; elsewhere remove the `__globals__` keys (the concrete values are present next to them).');
  return lines.join('\n');
}

function procedure(stats) {
  return [
    '## Procedure',
    '1. **Discover your tools.** List the MCP tools available to you and note which of these capabilities exist:',
    '   - (A) importing an Elementor template / JSON file;',
    '   - (B) writing a page\'s whole Elementor data (e.g. "set/update page data/elements", or a generic post-meta tool that can write `_elementor_data`);',
    '   - (C) adding elements one by one (e.g. "add container", "add widget", "update element settings");',
    '   - creating a page (Elementor\'s own server: `elementor/create-page`), updating page settings (`elementor/update-page-settings`), reading a page tree (`elementor/get-page-structure`), media upload/sideload, global classes/variables.',
    '2. **Create the target page** (unless the user named an existing one): title as given above, built with Elementor, status draft.',
    '3. **Apply the elements using the best capability you have**, in this order of preference:',
    '   - **(A) Template import** — import the JSON from the final section as a template, then insert it into the page.',
    '   - **(B) Whole-document write** — write the `content` array as the page\'s element list. With a raw post-meta tool set:',
    '     `_elementor_edit_mode` = `builder`, `_elementor_template_type` = `wp-page`, `_elementor_data` = the `content` array as a JSON string,',
    '     then trigger a save/regeneration so Elementor rebuilds its CSS (save the document through Elementor, or clear Elementor\'s CSS cache).',
    '   - **(C) Element by element** — walk the tree depth-first in document order. Create each container before its children and each child at its index.',
    '     Send each element\'s `settings` object **verbatim** (all keys, including `_tablet` / `_mobile` variants, `custom_css`, `_css_classes`).',
    '     Keep element `id`s when the tool lets you set them (repeater items keep their `_id` — per-item styles depend on it).',
    `     Nested widgets (${['nested-tabs', 'nested-accordion', 'nested-carousel', 'mega-menu', 'off-canvas'].map(code).join(', ')}) own their child containers: one container per repeater item, in order.`,
    '4. **Page settings**: apply `page_settings` (it contains the page custom CSS) with `elementor/update-page-settings` or your equivalent tool.',
    stats.globalClasses ? '5. **Global classes (V4)**: create the classes listed in `global_classes` (keep their ids/labels) with your globals tool before or while adding atomic elements. If no tool can create global classes, copy each class\'s variants into the `styles` of every element that uses it and remove the id from that element\'s `classes`.' : '5. **Global styles**: none required — every colour/typography value is already concrete in the settings.',
    '6. **Media**: images and icons reference their source URLs. If you have a media upload/sideload tool, import each URL listed in the manifest and replace `url` (and set `id`) in the settings; otherwise keep the source URLs (they display as long as the source site is reachable).',
    '7. **Verify** (next section) and report.',
  ].join('\n');
}

function rules(rtl) {
  return [
    '## Rules',
    '- The JSON is the source of truth. Use control names and values exactly as written; never rename keys (e.g. `title_color` stays `title_color`, `_padding` stays `_padding`).',
    '- Do not add settings, widgets, wrappers, spacing or responsive values that are not in the data. Missing keys mean "Elementor default".',
    '- Keep text, HTML and links character-for-character (titles may contain inline `<span style=…>` markup — keep it).',
    '- `custom_css` uses Elementor Pro\'s `selector` keyword; keep it unchanged.',
    '- Elements with `hide_desktop` / `hide_tablet` / `hide_mobile` are responsive variants — create them too.',
    rtl ? '- Alignment values such as `start`/`end`/`left`/`right` are already correct for RTL; do not mirror them.' : '',
    '- If a tool rejects a setting, retry the element without only that key, continue, and list the dropped keys in your report.',
    '- If a widget type is unavailable on the target site, create the closest core widget only if the user agrees; otherwise skip it and report it.',
  ].filter(Boolean).join('\n');
}

function verification(stats) {
  return [
    '## Verification',
    `- Read the page back (e.g. \`elementor/get-page-structure\`) and confirm: **${stats.total}** elements in total — ${stats.containers} containers and ${stats.widgets} widgets — with the per-type counts in the manifest below.`,
    '- Spot-check five elements of different types: their `settings` must match the JSON key-for-key.',
    '- Open the page in the Elementor editor once (or save it) so Elementor regenerates the page CSS.',
    '- Report: page ID and edit URL, which path (A/B/C) you used, anything skipped or changed and why.',
  ].join('\n');
}

function manifest(stats) {
  const typeRows = [...stats.types.entries()].sort((a, b) => b[1] - a[1])
    .map(([type, n]) => `| ${code(type)} | ${n} |`).join('\n');
  const media = [...stats.media];
  return [
    '## Manifest',
    '| Element type | Count |',
    '|---|---|',
    typeRows,
    '',
    media.length
      ? `### Media referenced (${media.length})\n${media.slice(0, 300).map((u) => `- ${u}`).join('\n')}${media.length > 300 ? `\n- … ${media.length - 300} more (see JSON)` : ''}`
      : '### Media referenced\n- none',
  ].join('\n');
}

/** Indented, human-readable tree — for planning and for path (C). */
function outline(content) {
  const lines = ['## Structure outline', 'Indented in document order: `id` · type · key content. Full settings are in the JSON.', '```text'];
  const walk = (els, depth) => {
    for (const el of els ?? []) {
      if (lines.length > 1600) { lines.push(`${'  '.repeat(depth)}…`); return; }
      const type = el.elType === 'widget' ? el.widgetType : el.elType;
      lines.push(`${'  '.repeat(depth)}${el.id} · ${type}${summary(el) ? ` · ${summary(el)}` : ''}`);
      walk(el.elements, depth + 1);
    }
  };
  walk(content, 0);
  lines.push('```');
  return lines.join('\n');
}

function summary(el) {
  const s = el.settings ?? {};
  // Classic settings hold strings; atomic ones hold typed html-v3 objects.
  const text = [
    s.title, s.text, s.title_text, s.editor, s.html,
    s.title?.value?.content?.value, s.paragraph?.value?.content?.value, s.text?.value?.content?.value,
  ].find((v) => typeof v === 'string' && v);
  const parts = [];
  if (typeof text === 'string') parts.push(`"${clip(stripTags(text), 60)}"`);
  if (s.image?.url) parts.push(`img ${clip(s.image.url.split('/').pop(), 40)}`);
  if (s.link?.url) parts.push(`→ ${clip(s.link.url, 50)}`);
  if (s.html_tag) parts.push(`<${s.html_tag}>`);
  if (s.hide_desktop) parts.push('hidden on desktop');
  return parts.join(' · ');
}

function warningsSection(snapshot) {
  const warnings = new Map();
  (function walk(n) {
    if (!n || n.hidden) return;
    for (const w of n.warnings ?? []) warnings.set(w, (warnings.get(w) ?? 0) + 1);
    for (const c of n.children ?? []) walk(c);
  })(snapshot.tree);
  if (!warnings.size) return '';
  return [
    '## Known limitations of the extracted data',
    'Tell the user about these after building; do not try to guess the missing values.',
    ...[...warnings.entries()].slice(0, 30).map(([w, n]) => `- ${w}${n > 1 ? ` (${n}×)` : ''}`),
  ].join('\n');
}

function dataSection(template) {
  return [
    '## Elementor data (authoritative)',
    'Elementor template JSON (`version` 0.4). `content` is the page\'s element list; `page_settings` the document settings;',
    '`global_classes` (if present) the V4 global classes. Use it verbatim.',
    '```json',
    JSON.stringify(template, null, 1),
    '```',
  ].join('\n');
}

/* ------------------------------------------------------------------ */

function analyse(template) {
  const stats = {
    total: 0, containers: 0, widgets: 0,
    types: new Map(), proWidgets: new Set(), wooWidgets: new Set(), atomic: new Set(), unknownWidgets: new Set(),
    fonts: new Set(), media: new Set(), globalClasses: !!template.global_classes,
  };
  const walk = (els) => {
    for (const el of els ?? []) {
      stats.total++;
      const type = el.elType === 'widget' ? el.widgetType : el.elType;
      stats.types.set(type, (stats.types.get(type) ?? 0) + 1);
      if (el.elType === 'widget') stats.widgets++; else stats.containers++;
      if (/^e-/.test(type)) stats.atomic.add(type);
      else if (el.elType === 'widget') {
        const info = widgetInfo(type);
        if (!info) stats.unknownWidgets.add(type);
        else if (info.tier === 'woocommerce') stats.wooWidgets.add(type);
        else if (info.tier === 'pro' || info.tier === 'theme-builder') stats.proWidgets.add(type);
      }
      collectValues(el.settings, stats);
      collectValues(el.styles, stats);
      walk(el.elements);
    }
  };
  walk(template.content);
  if (template.page_settings?.custom_css) stats.proWidgets.add('page custom CSS');
  return stats;
}

/** Link-type settings hold URLs that are navigation targets, not media. */
const LINK_KEY = /(^|_)(link|links|destination|href)$/;

function collectValues(value, stats, key = '', inLink = false) {
  if (!value || typeof value !== 'object') {
    if (typeof value === 'string') {
      if (/font_family$/.test(key) && value) stats.fonts.add(value);
      if (key === 'url' && !inLink && /^https?:\/\//.test(value)) stats.media.add(value);
    }
    return;
  }
  // Atomic font-family prop: { "$$type": "string", value: "..." }
  if (key === 'font-family' && value.$$type === 'string') stats.fonts.add(value.value);
  if (key === 'url' && !inLink && value.$$type === 'url' && typeof value.value === 'string') stats.media.add(value.value);
  for (const [k, v] of Array.isArray(value) ? value.entries() : Object.entries(value)) {
    if (k === 'custom_css' && typeof v === 'string' && v) stats.proWidgets.add('element custom CSS');
    const childKey = String(k);
    collectValues(v, stats, childKey, inLink || LINK_KEY.test(childKey));
  }
}

function code(s) {
  return `\`${s}\``;
}

function clip(s, n) {
  s = String(s ?? '').replace(/\s+/g, ' ').trim();
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function stripTags(s) {
  return String(s).replace(/<[^>]*>/g, ' ');
}
