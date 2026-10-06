/**
 * Elementor CSS generation, run in reverse.
 *
 * Elementor turns every style control into post-CSS rules through the
 * control's selector template. Given the rules that target one element
 * (`.elementor-<post> .elementor-element.elementor-element-<id> …`) and the
 * compiled templates of that element's controls, this module recovers the
 * exact saved settings — control names, value shapes, responsive suffixes,
 * kit global references — instead of approximating them from computed style.
 *
 * Whatever no control explains (Pro custom CSS, third-party plugin rules,
 * unknown controls) is returned as leftover CSS so it can travel as the
 * element's `custom_css` instead of being dropped.
 */

import { baseControlName, normalizeSelector, selectorKey } from './controls-index.js';
import { declsToText } from './css-text.js';

const GLOBAL_COLOR_RE = /^var\(\s*--e-global-color-([\w-]+)\s*\)$/i;
const GLOBAL_TYPO_RE = /^var\(\s*--e-global-typography-([0-9a-z]+)-([a-z-]+)\s*\)(?:\s*,.*)?$/i;
const REPEATER_ITEM_RE = /\.elementor-repeater-item-([0-9a-z]+)/gi;

/**
 * Locate the element wrapper inside a generated selector.
 * `{{WRAPPER}}` renders as `.elementor-<postId> .elementor-element.elementor-element-<id>`
 * in post CSS (and without the post scope in some dynamic CSS).
 */
export function splitAtWrapper(selector, elementId) {
  const re = new RegExp(
    `(?:\\.elementor-(?:\\d+|kit-\\d+)\\s+)?(?:\\.elementor-element)?\\.elementor-element-${elementId}(?![\\w-])`,
  );
  const m = re.exec(selector);
  if (!m) return null;
  return { prefix: selector.slice(0, m.index), suffix: selector.slice(m.index + m[0].length) };
}

/**
 * Map a media condition to an Elementor device key.
 * @param {string|null} media
 * @param {Record<string, {direction: string, value: number, enabled?: boolean}>} breakpoints
 * @returns {string|null} 'desktop' for no media; null when unmappable
 */
export function deviceForMedia(media, breakpoints) {
  if (!media) return 'desktop';
  const max = [...media.matchAll(/max-width\s*:\s*([\d.]+)px/gi)].map((m) => parseFloat(m[1]));
  const min = [...media.matchAll(/min-width\s*:\s*([\d.]+)px/gi)].map((m) => parseFloat(m[1]));
  if (!max.length && !min.length) return null;
  if (max.length) {
    // "(max-width:1024px) and (min-width:768px)" is still the tablet value
    // of a control whose responsive range starts above mobile.
    const v = Math.min(...max);
    for (const [device, bp] of Object.entries(breakpoints)) {
      if (bp.direction === 'max' && Math.abs(bp.value - v) < 1) return device;
    }
    return null;
  }
  const v = Math.max(...min);
  for (const [device, bp] of Object.entries(breakpoints)) {
    if (bp.direction === 'min' && Math.abs(bp.value - v) < 1) return device;
  }
  // "(min-width:768px)" = everything above mobile: the desktop value of a
  // control registered with `responsive: { min: 'mobile' }` (container width).
  for (const bp of Object.values(breakpoints)) {
    if (bp.direction === 'max' && Math.abs(bp.value + 1 - v) < 1) return 'desktop';
  }
  return null;
}

/**
 * @param {object} args
 * @param {import('./controls-index.js').CompiledStack} args.stack
 * @param {string} args.elementId
 * @param {Array<{selector: string, rule: object}>} args.rules rules whose selector targets the element
 * @param {object} args.breakpoints
 * @param {(name: string) => string} [args.varLookup] computed custom-property lookup
 * @param {string[]} [args.classes] the element's wrapper classes
 * @returns {{settings: object, globals: object, repeaters: object, leftoverCss: string, matched: number}}
 */
export function reverseElement({ stack, elementId, rules, breakpoints, varLookup, classes = [] }) {
  const settings = {};
  const globals = {};
  const repeaters = {};
  const weak = {};
  const leftovers = [];
  let matched = 0;

  // 1. Group declarations by (selector key, device, repeater item). Later
  //    rules override earlier ones, mirroring the cascade.
  const groups = new Map();
  for (const { selector, rule } of rules) {
    // Pro custom CSS is taken verbatim from its region (see css-text.js).
    if (rule.region) continue;
    const split = splitAtWrapper(selector, elementId);
    if (!split) continue;
    const device = deviceForMedia(rule.media, breakpoints);
    let itemId = null;
    const suffix = split.suffix.replace(REPEATER_ITEM_RE, (_, id) => { itemId = id; return '{{CURRENT_ITEM}}'; });
    const key = selectorKey(stripPostScope(split.prefix), suffix);
    const groupKey = `${key}\u0000${device}\u0000${itemId ?? ''}`;
    let group = groups.get(groupKey);
    if (!group) {
      group = { key, device, itemId, decls: new Map(), sources: [] };
      groups.set(groupKey, group);
    }
    for (const d of rule.decls) group.decls.set(d.prop, { ...d, selector, media: rule.media });
  }

  // 2. Match every group against the controls registered for its selector.
  for (const group of groups.values()) {
    const matchers = stack.bySelector.get(group.key) ?? [];
    const candidates = [];
    if (group.device) {
      for (const matcher of matchers) {
        if (!!matcher.repeater !== !!group.itemId) continue;
        const key = deviceKey(matcher, group.device);
        if (!key) continue;
        for (const variant of matcher.variants) {
          const hit = matchVariant(variant, group.decls);
          if (hit) candidates.push({ matcher, variant, key, ...hit });
        }
      }
    }
    candidates.sort((a, b) => b.consumed.length - a.consumed.length || a.matcher.order - b.matcher.order);

    const consumed = new Set();
    const assigned = new Map();
    for (const c of candidates) {
      if (c.consumed.some((p) => consumed.has(p))) continue;
      const target = c.matcher.repeater
        ? ((repeaters[c.matcher.repeater] ??= {})[group.itemId] ??= {})
        : settings;
      // A value-less template (`--background-overlay: '';`) proves the
      // control is on but not which option; conditions decide later.
      if (isValueless(c)) {
        for (const p of c.consumed) consumed.add(p);
        if (target === settings && !(c.key in weak)) weak[c.key] = firstOption(c.matcher.def);
        continue;
      }
      const values = buildValues(c, stack, varLookup, group.device);
      if (!values) continue;
      if (assigned.has(c.key)) {
        // The same control often writes several templates on one selector
        // (an icon colour: `color` + `fill`); consume them when they agree.
        if (sameValue(assigned.get(c.key), values.settings[c.key])) for (const p of c.consumed) consumed.add(p);
        continue;
      }
      for (const p of c.consumed) consumed.add(p);
      assigned.set(c.key, values.settings[c.key]);
      matched++;
      // One control can be spread over several selectors (a dropdown radius
      // writes top corners on li:first-child and bottom ones on li:last-child):
      // merge the partial values instead of keeping whichever came first.
      for (const [k, v] of Object.entries(values.settings)) target[k] = mergeValue(target[k], v);
      Object.assign(globals, values.globals);
    }

    const rest = [...group.decls.values()].filter((d) => !consumed.has(d.prop));
    if (rest.length) leftovers.push(...rest);
  }

  // 3. Wrapper classes written through `prefix_class`.
  Object.assign(settings, reverseClasses(stack, classes));

  // 4. Controls only render when their conditions hold (a background colour
  //    needs `background_background: classic`) — satisfy them.
  applyConditions(settings, stack);
  for (const [key, value] of Object.entries(weak)) {
    if (settings[key] === undefined && value !== null) settings[key] = value;
  }
  // Same inside repeater items: a per-item colour needs `item_icon_color: custom`.
  for (const [repeater, items] of Object.entries(repeaters)) {
    const fields = stack.controls[repeater]?.f;
    if (!fields) continue;
    for (const itemSettings of Object.values(items)) applyConditions(itemSettings, { controls: fields });
  }

  dropDefaults(settings, stack);

  return {
    settings,
    globals,
    repeaters,
    leftoverCss: leftoversToCss(leftovers, elementId),
    matched,
  };
}

function mergeValue(prev, next) {
  if (prev === undefined) return next;
  if (!prev || !next || typeof prev !== 'object' || typeof next !== 'object' || Array.isArray(prev)) return prev;
  const out = { ...prev };
  for (const [k, v] of Object.entries(next)) {
    if (out[k] === undefined || out[k] === '') out[k] = v;
  }
  if ('top' in out && 'left' in out) {
    out.isLinked = out.top === out.right && out.right === out.bottom && out.bottom === out.left;
  }
  return out;
}

/** Matched a template that has no placeholder and no dictionary option. */
function isValueless(candidate) {
  const def = candidate.matcher.def;
  return candidate.option === null && candidate.captures.size === 0 && !candidate.globalRefs.length
    && (def.t === 'choose' || def.t === 'select') && !candidate.matcher.repeater;
}

function firstOption(def) {
  return def.o?.find((o) => o !== '') ?? null;
}

function stripPostScope(prefix) {
  return prefix.replace(/\.elementor-(?:\d+|kit-\d+)\s*$/, '').trim();
}

/** The setting key a matcher writes for a device, or null when it has no such variant. */
function deviceKey(matcher, device) {
  const { def, name } = matcher;
  if (def.r && !def.rd) {
    // A standalone device copy (e.g. `tabs_direction_mobile`).
    const target = def.r.max ?? (def.r.min ? def.r.min : 'desktop');
    return target === device ? name : null;
  }
  if (device === 'desktop') return name;
  return def.rd?.includes(device) ? `${name}_${device}` : null;
}

/* ------------------------------------------------------------------ *
 * Template matching
 * ------------------------------------------------------------------ */

/**
 * A variant matches when its PRIMARY (first) declaration matches. Secondary
 * declarations are consumed when they match and tolerated when they don't:
 * several controls write the same custom property (flex_direction and
 * flex_align_items both set --container-widget-width) and the cascade keeps
 * only the last one, so demanding all of them would reject real matches.
 * Candidates that explain more declarations still win the ranking.
 */
function matchVariant(variant, decls) {
  const captures = new Map();
  const consumed = [];
  const globalRefs = [];
  let first = true;
  for (const tpl of variant.decls) {
    const isPrimary = first;
    first = false;
    const decl = decls.get(tpl.prop);
    if (decl) {
      const trial = new Map(captures);
      if (matchDecl(tpl, decl.value, trial, globalRefs)) {
        for (const [k, v] of trial) captures.set(k, v);
        consumed.push(tpl.prop);
        continue;
      }
      if (isPrimary) return null;
      continue;
    }
    // CSSOM-serialized fallbacks expand shorthands into longhands.
    if (tpl.sides && tpl.sides.every((s) => decls.has(s.prop))) {
      const trial = new Map(captures);
      if (tpl.sides.every((side) => matchDecl(side, decls.get(side.prop).value, trial, globalRefs))) {
        for (const [k, v] of trial) captures.set(k, v);
        consumed.push(...tpl.sides.map((s) => s.prop));
        continue;
      }
    }
    if (isPrimary) return null;
  }
  if (!consumed.length) return null;
  return { captures, consumed, option: variant.option, unit: variant.unit, globalRefs };
}

function matchDecl(tpl, value, captures, globalRefs) {
  if (tpl.literal !== undefined) {
    return squash(tpl.literal) === squash(value);
  }
  // Kit globals replace the whole value (base.php::get_selector_global_value).
  const color = GLOBAL_COLOR_RE.exec(value);
  const typo = color ? null : GLOBAL_TYPO_RE.exec(value);
  if ((color || typo) && tpl.groups.length >= 1) {
    const main = tpl.groups.find((g) => g.name !== 'UNIT') ?? tpl.groups[0];
    globalRefs.push(color
      ? { kind: 'color', id: color[1], placeholder: main }
      : { kind: 'typography', id: typo[1], part: typo[2], placeholder: main });
    return true;
  }
  const m = tpl.strict.exec(value.trim()) ?? tpl.loose.exec(value.trim());
  if (!m) return false;
  for (let i = 0; i < tpl.groups.length; i++) {
    const g = tpl.groups[i];
    const capKey = `${g.ext ?? ''}.${g.name}`;
    const v = (m[i + 1] ?? '').trim();
    if (captures.has(capKey) && captures.get(capKey) !== v) {
      // `0px` sides are fine with any unit; other conflicts mean no match.
      if (g.name !== 'UNIT') return false;
      continue;
    }
    if (!captures.has(capKey) || captures.get(capKey) === '') captures.set(capKey, v);
  }
  return true;
}

function squash(text) {
  return String(text).replace(/\s+/g, '').toLowerCase();
}

/* ------------------------------------------------------------------ *
 * Value construction
 * ------------------------------------------------------------------ */

function buildValues(candidate, stack, varLookup, device) {
  const { matcher, captures, option, unit, globalRefs, key } = candidate;
  const out = { settings: {}, globals: {} };

  // Kit global reference: store the reference and its resolved value.
  if (globalRefs.length) {
    for (const ref of globalRefs) {
      if (ref.kind === 'color') {
        const globalKey = matcher.def.g ? `${matcher.def.gp}${matcher.def.g}` : key;
        out.globals[globalKey] = `globals/colors?id=${ref.id}`;
        const resolved = lookup(varLookup, `--e-global-color-${ref.id}`);
        if (resolved) out.settings[key] = normalizeColor(resolved);
      } else {
        const def = matcher.def;
        const groupKey = def.g ? `${def.gp}${def.g}` : key;
        out.globals[groupKey] = `globals/typography?id=${ref.id}`;
        const resolved = lookup(varLookup, `--e-global-typography-${ref.id}-${ref.part}`);
        if (resolved) {
          const value = typedValue(def, new Map([['.VALUE', resolved], ['.SIZE', numberPart(resolved)], ['.UNIT', unitPart(resolved)]]), null, null);
          if (value !== undefined) out.settings[key] = value;
        }
      }
    }
    if (captures.size === 0) return out;
  }

  const value = typedValue(matcher.def, captures, option, unit);
  if (value === undefined) return Object.keys(out.globals).length ? out : null;
  out.settings[key] = value;

  // `{{other_control.SIZE}}` references fill the referenced control too.
  const ext = new Map();
  for (const [capKey, v] of captures) {
    const dot = capKey.indexOf('.');
    const extName = capKey.slice(0, dot);
    if (!extName) continue;
    if (!ext.has(extName)) ext.set(extName, new Map());
    ext.get(extName).set(`.${capKey.slice(dot + 1)}`, v);
  }
  for (const [extName, extCaps] of ext) {
    const extDef = stack.controls[extName];
    if (!extDef) continue;
    if ([...extCaps.values()].every((v) => v === '')) continue;
    const extValue = typedValue(extDef, extCaps, null, null);
    if (extValue === undefined || extValue === '') continue;
    const extKey = device !== 'desktop' && extDef.rd?.includes(device) ? `${extName}_${device}` : extName;
    out.settings[extKey] = extValue;
  }
  return out;
}

function typedValue(def, caps, option, unitOverride) {
  const get = (name) => caps.get(`.${name}`);
  if (option !== null && option !== undefined) return option;
  switch (def.t) {
    case 'slider': {
      const size = get('SIZE') ?? get('VALUE');
      if (size === undefined || size === '') return undefined;
      const unit = get('UNIT') || unitOverride || def.d?.unit || 'px';
      const n = Number(size);
      return Number.isFinite(n) && size !== ''
        ? { unit, size: n, sizes: [] }
        : { unit: 'custom', size: String(size).trim(), sizes: [] };
    }
    case 'dimensions': {
      const sides = ['TOP', 'RIGHT', 'BOTTOM', 'LEFT'].map((s) => get(s));
      if (sides.every((v) => v === undefined)) return undefined;
      const [top, right, bottom, left] = sides.map((v) => (v === undefined ? '' : String(v)));
      return { unit: get('UNIT') || unitOverride || def.d?.unit || 'px', top, right, bottom, left, isLinked: top === right && right === bottom && bottom === left };
    }
    case 'gaps': {
      const row = get('ROW');
      const column = get('COLUMN');
      if (row === undefined && column === undefined) return undefined;
      const r = String(row ?? column);
      const c = String(column ?? row);
      return { column: c, row: r, isLinked: r === c, unit: get('UNIT') || def.d?.unit || 'px', size: Number(c) };
    }
    case 'color':
      // Raw post CSS holds the colour exactly as it was saved.
      return get('VALUE') !== undefined ? String(get('VALUE')).trim() : undefined;
    case 'media': {
      const url = get('URL') ?? get('VALUE');
      return url ? { url: stripQuotes(url), id: '', size: '' } : undefined;
    }
    case 'box_shadow': {
      if (get('HORIZONTAL') === undefined) return undefined;
      return {
        horizontal: Number(get('HORIZONTAL')), vertical: Number(get('VERTICAL')),
        blur: Number(get('BLUR') ?? 0), spread: Number(get('SPREAD') ?? 0),
        color: String(get('COLOR') ?? 'rgba(0,0,0,0.5)').trim(),
      };
    }
    case 'text_shadow': {
      if (get('HORIZONTAL') === undefined) return undefined;
      return {
        horizontal: Number(get('HORIZONTAL')), vertical: Number(get('VERTICAL')),
        blur: Number(get('BLUR') ?? 0), color: String(get('COLOR') ?? 'rgba(0,0,0,0.3)').trim(),
      };
    }
    case 'font': {
      const v = get('VALUE');
      return v ? stripQuotes(v.split(',')[0].trim()) : undefined;
    }
    case 'number': {
      const v = get('VALUE') ?? get('SIZE');
      const n = Number(v);
      return v !== undefined && v !== '' && Number.isFinite(n) ? n : v;
    }
    default: {
      const v = get('VALUE');
      // A raw value outside a choose/select's options belongs to another
      // control writing the same property (`_flex_order` vs `_flex_order_custom`).
      if (v !== undefined && def.o?.length && (def.t === 'choose' || def.t === 'select') && !def.o.includes(v)) return undefined;
      if (v === undefined) {
        // A template without {{VALUE}} matched literally: the control's only
        // meaningful value is its return value / single option.
        if (def.t === 'switcher') return def.rv ?? 'yes';
        return undefined;
      }
      return v;
    }
  }
}

function numberPart(v) {
  return /^(-?[\d.]+)/.exec(String(v).trim())?.[1] ?? '';
}

function unitPart(v) {
  return /^-?[\d.]+([a-z%]*)/i.exec(String(v).trim())?.[1] ?? '';
}

function stripQuotes(v) {
  return String(v).trim().replace(/^(['"])(.*)\1$/, '$2');
}

function lookup(varLookup, name) {
  if (!varLookup) return '';
  try { return (varLookup(name) || '').trim(); } catch { return ''; }
}

/** rgb()/rgba() -> #RRGGBB(AA); everything else unchanged. */
export function normalizeColor(value) {
  const v = String(value).trim();
  const m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.%]+))?\s*\)$/i.exec(v);
  if (!m) return v;
  const hex = (n) => Math.round(parseFloat(n)).toString(16).padStart(2, '0').toUpperCase();
  let out = `#${hex(m[1])}${hex(m[2])}${hex(m[3])}`;
  if (m[4] !== undefined) {
    const a = m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    if (a < 1) out += hex(a * 255);
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * prefix_class, conditions, defaults
 * ------------------------------------------------------------------ */

export function reverseClasses(stack, classes) {
  const out = {};
  const taken = new Set();
  for (const token of classes) {
    for (const { name, def, prefix } of stack.classMatchers) {
      if (taken.has(name) || !token.startsWith(prefix)) continue;
      const rest = token.slice(prefix.length);
      let value;
      if (def.t === 'switcher') {
        if (rest !== String(def.rv ?? 'yes')) continue;
        value = def.rv ?? 'yes';
      } else if (def.o?.length) {
        if (!def.o.includes(rest)) continue;
        value = rest;
      } else {
        continue; // free-form prefix classes are too ambiguous to reverse
      }
      taken.add(name);
      out[name] = value;
      break;
    }
  }
  return out;
}

const SWITCH_TYPES = new Set(['popover_toggle', 'switcher', 'select', 'choose']);

function applyConditions(settings, stack) {
  for (let pass = 0; pass < 3; pass++) {
    const constraints = new Map();
    const required = new Set();
    for (const key of Object.keys(settings)) {
      const base = baseControlName(key);
      const def = stack.controls[key] ?? stack.controls[base];
      // A device value (`_flex_order_custom_mobile`) depends on the same
      // device of a responsive condition control (`_flex_order_mobile`).
      const device = !stack.controls[key] && base !== key ? key.slice(base.length + 1) : null;
      const forDevice = (k) => {
        if (!device) return k;
        // Unfolded per-device control (prefix_class copies) or folded variant.
        if (stack.controls[`${k}_${device}`] || stack.controls[k]?.rd?.includes(device)) return `${k}_${device}`;
        return k;
      };
      for (const [rawKey, want] of Object.entries(def?.c ?? {})) {
        if (rawKey.includes('[')) continue;
        if (rawKey.endsWith('!')) {
          // `typography_typography!: ''` — the switcher must be on.
          if (want === '' || (Array.isArray(want) && !want.length)) required.add(forDevice(rawKey.slice(0, -1)));
          continue;
        }
        const condKey = forDevice(rawKey);
        const allowed = Array.isArray(want) ? want.map(String) : [String(want)];
        const prev = constraints.get(condKey);
        constraints.set(condKey, prev ? prev.filter((v) => allowed.includes(v)) : allowed);
      }
    }
    // Only switch-like controls are inferred; a condition on a content field
    // (`text!: ''` on a button's icon spacing) says nothing about its value.
    const known = (k) => {
      const def = stack.controls[k] ?? stack.controls[baseControlName(k)];
      return def && SWITCH_TYPES.has(def.t) ? def : null;
    };
    let changed = false;
    for (const [key, allowed] of constraints) {
      if (settings[key] !== undefined || !allowed.length) continue;
      const value = allowed.find((v) => v !== '') ?? null;
      if (value === null || !known(key)) continue;
      settings[key] = value;
      changed = true;
    }
    for (const key of required) {
      if (settings[key] !== undefined) continue;
      const def = known(key);
      if (!def) continue;
      settings[key] = def.t === 'popover_toggle'
        ? (key.endsWith('_typography') ? 'custom' : 'yes')
        : def.t === 'switcher' ? (def.rv ?? 'yes')
        : (def.o?.find((o) => o !== '') ?? 'yes');
      changed = true;
    }
    if (!changed) break;
  }
}

/** Elementor saves only non-default values; mirror that to keep exports lean. */
function dropDefaults(settings, stack) {
  for (const [key, value] of Object.entries(settings)) {
    const def = stack.controls[key];
    if (!def || def.d === undefined) continue;
    if (sameValue(def.d, value)) delete settings[key];
  }
}

function sameValue(a, b) {
  const norm = (v) => {
    if (v === null || v === undefined) return '';
    if (typeof v !== 'object') return String(v).trim().toLowerCase();
    const out = {};
    for (const [k, x] of Object.entries(v)) {
      if (k === 'sizes' || k === 'isLinked' || x === '' || x === null) continue;
      out[k] = norm(x);
    }
    return JSON.stringify(out);
  };
  return norm(a) === norm(b);
}

/* ------------------------------------------------------------------ *
 * Custom CSS
 * ------------------------------------------------------------------ */

function leftoversToCss(decls, elementId) {
  if (!decls.length) return '';
  const bySelector = new Map();
  for (const d of decls) {
    const key = `${d.media ?? ''}\u0000${d.selector}`;
    if (!bySelector.has(key)) bySelector.set(key, { selector: d.selector, media: d.media, decls: [] });
    bySelector.get(key).decls.push(d);
  }
  return [...bySelector.values()].map(({ selector, media, decls: list }) => {
    const css = `${wrapperToSelector(selector, elementId)}{${declsToText(list)}}`;
    return media ? `@media ${media}{${css}}` : css;
  }).join('\n');
}

export function wrapperToSelector(selector, elementId) {
  const split = splitAtWrapper(selector, elementId);
  if (!split) return selector;
  const prefix = stripPostScope(split.prefix);
  return `${prefix ? `${prefix} ` : ''}selector${split.suffix}`;
}

export { normalizeSelector };
