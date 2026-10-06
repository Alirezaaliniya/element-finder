/**
 * Compiled view of the Elementor control map (data/controls-map.json,
 * generated from the installed plugins by tools/elementor-dump).
 *
 * For every element type it builds the reverse of Elementor's CSS generator
 * (core/files/css/base.php::add_control_rules): each style control's
 * `selectors` entry `{{WRAPPER}} .elementor-heading-title => color: {{VALUE}};`
 * becomes a matcher keyed by its normalized selector, holding declaration
 * templates whose placeholders compile to capture regexes. Controls that
 * render as wrapper classes (`prefix_class`) become class matchers.
 */

const DEVICE_SUFFIX_RE = /_(mobile_extra|tablet_extra|mobile|tablet|laptop|widescreen)$/;

/** Placeholder syntax used by Elementor (same regex as base.php). */
const PLACEHOLDER_RE = /{{(?:([^.}]+)\.)?([^}| ]*)(?: *\|\| *(?:([^.}]+)\.)?([^}| ]*) *)*}}/g;

const NUMERIC_PLACEHOLDERS = new Set([
  'SIZE', 'TOP', 'RIGHT', 'BOTTOM', 'LEFT', 'ROW', 'COLUMN',
  'HORIZONTAL', 'VERTICAL', 'BLUR', 'SPREAD',
]);

/** Shorthands Elementor writes in templates; matched component-wise. */
const SHORTHAND_SIDES = {
  padding: ['padding-top', 'padding-right', 'padding-bottom', 'padding-left'],
  margin: ['margin-top', 'margin-right', 'margin-bottom', 'margin-left'],
  'border-width': ['border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width'],
  'border-radius': ['border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius'],
};

let mapPromise = null;

/**
 * Load the controls map once. Resolved relative to this module so it works
 * from the extension origin and from the e2e harness's HTTP server alike.
 * @returns {Promise<ControlsIndex|null>}
 */
export function loadControlsIndex() {
  if (!mapPromise) {
    mapPromise = fetch(new URL('./data/controls-map.json', import.meta.url))
      .then((r) => (r.ok ? r.json() : null))
      .then((map) => (map ? new ControlsIndex(map) : null))
      .catch(() => null);
  }
  return mapPromise;
}

export class ControlsIndex {
  constructor(map) {
    this.map = map;
    this.version = map.elementorVersion;
    this.proVersion = map.elementorProVersion;
    /** @type {Map<string, CompiledStack>} */
    this.cache = new Map();
    this.atomicTypes = new Set(Object.keys(map.atomic ?? {}));
    this.atomicStyleSchema = map.atomicStyleSchema ?? {};
  }

  hasWidget(widgetType) {
    return !!this.map.widgets?.[widgetType];
  }

  /**
   * @param {'widget'|'container'|'section'|'column'} elType
   * @param {string|null} widgetType
   * @returns {CompiledStack|null}
   */
  stackFor(elType, widgetType = null) {
    const key = elType === 'widget' ? `w:${widgetType}` : `e:${elType}`;
    if (this.cache.has(key)) return this.cache.get(key);
    let controls = null;
    if (elType === 'widget') {
      const w = this.map.widgets?.[widgetType];
      if (w) controls = { ...(this.map.widgets[w.common]?.controls ?? {}), ...w.controls };
    } else {
      controls = this.map.elements?.[elType] ?? null;
    }
    const stack = controls ? new CompiledStack(controls) : null;
    this.cache.set(key, stack);
    return stack;
  }
}

/**
 * @typedef {object} DeclTemplate
 * @property {string} prop
 * @property {RegExp} strict   numeric placeholders must be numbers
 * @property {RegExp} loose    numeric placeholders accept any text (custom units)
 * @property {Array<{name: string, ext: string|null}>} groups capture order
 * @property {string} [literal] template value when it has no placeholder
 */

export class CompiledStack {
  constructor(controls) {
    this.controls = controls;
    /** @type {Map<string, Array<object>>} selectorKey -> matchers */
    this.bySelector = new Map();
    /** @type {Array<{name: string, def: object, prefix: string}>} */
    this.classMatchers = [];
    /** repeater name -> { field -> def } for {{CURRENT_ITEM}} selectors */
    this.repeaters = new Map();
    let order = 0;
    for (const [name, def] of Object.entries(controls)) {
      order++;
      // PHP turns numeric option keys ("500") into integers in the dump.
      normalizeOptions(def);
      for (const fdef of Object.values(def.f ?? {})) normalizeOptions(fdef);
      if (def.pc) this.classMatchers.push({ name, def, prefix: def.pc });
      if (def.s) this.#addSelectors(name, def, order, null);
      if (def.f) {
        for (const [field, fdef] of Object.entries(def.f)) {
          if (fdef.s) this.#addSelectors(field, fdef, order, name);
        }
      }
    }
    // Longest class prefixes first: `elementor-widget-tablet__width-` must
    // win over `elementor-`.
    this.classMatchers.sort((a, b) => b.prefix.length - a.prefix.length);
  }

  #addSelectors(name, def, order, repeater) {
    for (const [rawSelector, cssTemplate] of Object.entries(def.s)) {
      // Device-scoped selector keys: "(tablet){{WRAPPER}} .x" / "(desktop+)…"
      let selector = rawSelector;
      let deviceRule = null;
      const dm = /^((?:\([^)]+\)){1,2})/.exec(selector);
      if (dm) {
        deviceRule = [...dm[1].matchAll(/\(([^)]+)\)/g)].map((m) => m[1]);
        selector = selector.slice(dm[1].length);
      }
      const variants = compileVariants(def, cssTemplate);
      if (!variants.length) continue;
      for (const part of splitSelectorList(selector)) {
        const at = part.indexOf('{{WRAPPER}}');
        if (at === -1) continue;
        const key = selectorKey(part.slice(0, at), part.slice(at + '{{WRAPPER}}'.length));
        const matcher = { name, def, order, variants, deviceRule, repeater };
        if (!this.bySelector.has(key)) this.bySelector.set(key, []);
        this.bySelector.get(key).push(matcher);
      }
    }
  }
}

function normalizeOptions(def) {
  if (Array.isArray(def.o) && def.o.some((o) => typeof o !== 'string')) def.o = def.o.map(String);
}

/**
 * A control's CSS template can expand into several alternatives:
 *  - selectors_dictionary: `{{VALUE}}` stands for a dictionary entry, which
 *    may itself be a full declaration list (flex_direction on containers);
 *  - unit_selectors_dictionary: a different template per unit.
 * Each variant is a list of declaration templates plus the value that
 * produced it.
 */
function compileVariants(def, cssTemplate) {
  const variants = [];
  const templates = [{ css: cssTemplate, unit: null }];
  for (const [unit, css] of Object.entries(def.usd ?? {})) templates.push({ css, unit });

  for (const { css, unit } of templates) {
    if (def.sd && /{{VALUE}}/.test(css)) {
      for (const [option, replacement] of Object.entries(def.sd)) {
        // Legacy dictionary keys (align: left -> end) are not selectable any
        // more; the raw variant reproduces the current option instead.
        if (def.o?.length && !def.o.includes(option)) continue;
        const decls = compileDecls(css.split('{{VALUE}}').join(String(replacement ?? '')));
        if (decls.length) variants.push({ decls, option, unit });
      }
    }
    const decls = compileDecls(css);
    if (decls.length) variants.push({ decls, option: null, unit });
  }
  return variants;
}

function compileDecls(css) {
  const out = [];
  // Dictionary values may carry comments (`-99999 /* order start hack */`);
  // the CSS parser drops comments from real rules, so templates must too.
  for (const raw of splitTopLevel(css.replace(/\/\*[\s\S]*?\*\//g, ''), ';')) {
    const colon = raw.indexOf(':');
    if (colon <= 0) continue;
    const prop = raw.slice(0, colon).trim();
    const value = raw.slice(colon + 1).trim();
    if (!prop || !value) continue;
    const sides = SHORTHAND_SIDES[prop.toLowerCase()];
    const parts = sides ? splitTopLevel(value, ' ').map((s) => s.trim()).filter(Boolean) : null;
    if (sides && parts.length === 4) {
      // Generated output keeps the 4-value shorthand verbatim, but CSSOM
      // fallbacks expand it — keep both the shorthand and side templates.
      out.push(compileDecl(prop, value));
      out[out.length - 1].sides = sides.map((p, i) => compileDecl(p, parts[i]));
      continue;
    }
    out.push(compileDecl(prop, value));
  }
  return out;
}

function compileDecl(prop, valueTemplate) {
  const groups = [];
  let strict = '';
  let loose = '';
  let last = 0;
  PLACEHOLDER_RE.lastIndex = 0;
  let m;
  while ((m = PLACEHOLDER_RE.exec(valueTemplate))) {
    const literal = valueTemplate.slice(last, m.index);
    strict += literalPattern(literal);
    loose += literalPattern(literal);
    const name = m[2];
    const ext = m[1] || null;
    groups.push({ name, ext });
    if (name === 'UNIT') {
      strict += '([a-z%]*)';
      loose += '([a-z%]*)';
    } else if (ext && !NUMERIC_PLACEHOLDERS.has(name)) {
      // References to other controls (`{{box_shadow_position.VALUE}}`) are
      // keywords and may be empty; a greedy-safe class keeps them from
      // stealing text from the preceding placeholder.
      strict += '([\\w-]*)';
      loose += '([\\w-]*)';
    } else if (NUMERIC_PLACEHOLDERS.has(name)) {
      strict += '(-?(?:\\d+\\.?\\d*|\\.\\d+)(?:e-?\\d+)?)';
      loose += '(.*?)';
    } else {
      strict += '(.+?)';
      loose += '(.*?)';
    }
    last = m.index + m[0].length;
  }
  const tail = valueTemplate.slice(last);
  strict += literalPattern(tail);
  loose += literalPattern(tail);
  return {
    prop: prop.toLowerCase().startsWith('--') ? prop : prop.toLowerCase(),
    strict: new RegExp(`^${strict}$`, 'i'),
    loose: new RegExp(`^${loose}$`, 'i'),
    groups,
    literal: groups.length ? undefined : valueTemplate.trim(),
  };
}

/** Escape a literal template chunk; whitespace becomes optional. */
function literalPattern(text) {
  return text
    .split(/\s+/)
    .map((chunk) => chunk.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('\\s*');
}

/* ------------------------------------------------------------------ *
 * Selector normalization
 * ------------------------------------------------------------------ */

export function selectorKey(prefix, suffix) {
  return `${normalizeSelector(prefix)}|${normalizeSelector(suffix)}`;
}

/**
 * Canonical selector text: collapsed whitespace, tight combinators, single
 * quotes. Applied to both generated selectors and templates so browser /
 * template formatting differences never break a match.
 */
export function normalizeSelector(sel) {
  return String(sel ?? '')
    .replace(/"/g, "'")
    .replace(/\s+/g, ' ')
    .replace(/\s*([>+~,])\s*/g, '$1')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')')
    .replace(/::(before|after)/g, ':$1')
    .trim();
}

function splitSelectorList(selector) {
  return splitTopLevel(selector, ',').map((s) => s.trim()).filter(Boolean);
}

function splitTopLevel(str, sep) {
  const out = [];
  let depth = 0;
  let cur = '';
  let quote = null;
  for (const ch of str) {
    if (quote) { cur += ch; if (ch === quote) quote = null; continue; }
    if (ch === '"' || ch === "'") { quote = ch; cur += ch; continue; }
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    if (ch === sep && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

export function baseControlName(name) {
  return name.replace(DEVICE_SUFFIX_RE, '');
}
