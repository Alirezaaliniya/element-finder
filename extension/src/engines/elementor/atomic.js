/**
 * Elementor V4 "atomic" elements.
 *
 * Rendering facts (modules/atomic-widgets, Elementor 4.x):
 *  - Atomic containers (e-flexbox, e-div-block, e-tabs…) render
 *    `data-element_type="e-flexbox"` + `e-con e-atomic-element <type>-base`.
 *  - Atomic widgets render NO wrapper and no data-widget_type: the twig
 *    template prints the bare tag (`<h3 class="e-a1f0002-2222222 e-heading-base">`).
 *    The type is recoverable from the base-style class `<type>-base`
 *    (Has_Base_Styles::generate_base_style_id) and the id from data-id /
 *    data-interaction-id / the local style class `e-<id>-<hash>`.
 *  - Styles are classes: local `.elementor .e-<id>-<hash>{…}` in
 *    local-<post>-frontend-<device>.css, global classes by LABEL
 *    `.elementor .<label>{…}` in global-<post>-frontend-<device>.css.
 *  - Saved data is typed: `{ "$$type": "size", "value": { size, unit } }`,
 *    validated by Style_Parser on import — one invalid prop rejects the whole
 *    element, so anything not representable exactly goes to the variant's
 *    `custom_css` (base64 raw declarations) instead of a guessed prop.
 */

const KNOWN_ATOMIC_WIDGETS = [
  'e-heading', 'e-paragraph', 'e-button', 'e-image', 'e-svg', 'e-divider',
  'e-youtube', 'e-self-hosted-video', 'e-form', 'e-form-input', 'e-form-label',
  'e-form-textarea', 'e-form-submit-button', 'e-form-checkbox',
];

const LOCAL_STYLE_RE = /^e-([0-9a-z]{6,10})-([0-9a-z]{5,10})$/;
const BASE_CLASS_RE = /^(e-[a-z0-9-]+?)-base$/;

/**
 * Detect an atomic element/widget from its DOM element.
 * @param {Element} el
 * @param {Set<string>} [atomicTypes] types registered on the source site (controls map)
 * @returns {{elType: string, widgetType?: string, atomic: true, sourceId: string|null, localClasses: string[]}|null}
 */
export function detectAtomic(el, atomicTypes) {
  const classes = classList(el);
  const isKnown = (t) => (atomicTypes?.size ? atomicTypes.has(t) : true);

  const elementType = el.getAttribute('data-element_type');
  if (elementType && /^e-/.test(elementType) && elementType !== 'e-con') {
    return {
      elType: elementType,
      atomic: true,
      sourceId: el.getAttribute('data-id') || el.getAttribute('data-interaction-id'),
      localClasses: classes.filter((c) => LOCAL_STYLE_RE.test(c)),
    };
  }

  // Atomic widgets: identified by their base-style class.
  let widgetType = null;
  for (const c of classes) {
    const m = BASE_CLASS_RE.exec(c);
    if (!m) continue;
    // `e-heading-link-base` / `e-image-link-base` are inner link styles.
    const type = m[1].replace(/-link$/, '');
    if (KNOWN_ATOMIC_WIDGETS.includes(type) || isKnown(type)) { widgetType = type; break; }
  }
  if (!widgetType) return null;

  // An e-image with a link renders <a class="e-image-link-base"><img class="e-image-base"></a>;
  // the widget is the <a>, the <img> is its content.
  if (el.tagName === 'IMG' && el.parentElement?.classList.contains('e-image-link-base')) return null;

  const local = classes.filter((c) => LOCAL_STYLE_RE.test(c));
  const img = el.tagName === 'A' && widgetType === 'e-image' ? el.querySelector('img') : null;
  if (img) local.push(...classList(img).filter((c) => LOCAL_STYLE_RE.test(c)));

  return {
    elType: 'widget',
    widgetType,
    atomic: true,
    sourceId: el.getAttribute('data-id')
      || el.getAttribute('data-interaction-id')
      || img?.getAttribute('data-interaction-id')
      || LOCAL_STYLE_RE.exec(local[0] ?? '')?.[1]
      || null,
    localClasses: local,
  };
}

function classList(el) {
  const raw = typeof el.className === 'string' ? el.className : (el.getAttribute?.('class') || '');
  return raw.split(/\s+/).filter(Boolean);
}

/** Classes on an atomic element that are global classes (labels), not framework. */
export function candidateGlobalClasses(el) {
  return classList(el).filter((c) =>
    !LOCAL_STYLE_RE.test(c) && !BASE_CLASS_RE.test(c) &&
    !/^(elementor(-|$)|e-con$|e-atomic-element$|e--)/.test(c));
}

export function isLocalStyleClass(c) {
  return LOCAL_STYLE_RE.test(c);
}

/* ------------------------------------------------------------------ *
 * Typed settings from the DOM
 * ------------------------------------------------------------------ */

const str = (value) => ({ $$type: 'string', value: String(value) });
const html = (content) => ({ $$type: 'html-v3', value: { content: str(content), children: [] } });

const INLINE_HTML_ALLOWED = new Set(['B', 'STRONG', 'SUP', 'SUB', 'S', 'EM', 'I', 'U', 'A', 'DEL', 'SPAN', 'BR', 'UL', 'OL', 'LI', 'BLOCKQUOTE']);

/** Inner HTML restricted to the tags the atomic templates keep (striptags allow-list). */
function inlineHtml(el) {
  const clone = el.cloneNode(true);
  (function clean(node) {
    for (const child of [...node.children]) {
      clean(child);
      if (!INLINE_HTML_ALLOWED.has(child.tagName)) child.replaceWith(...child.childNodes);
      else for (const a of [...child.attributes]) if (!(child.tagName === 'A' && (a.name === 'href' || a.name === 'target'))) child.removeAttribute(a.name);
    }
  })(clone);
  return clone.innerHTML.replace(/\s+/g, ' ').trim();
}

function linkProp(a, baseUrl) {
  const href = a?.getAttribute('href');
  if (!href) return null;
  let url = href;
  try { url = new URL(href, baseUrl).href; } catch { /* keep */ }
  const value = { destination: { $$type: 'url', value: url } };
  if (a.getAttribute('target') === '_blank') value.isTargetBlank = { $$type: 'boolean', value: true };
  return { $$type: 'link', value };
}

/**
 * Settings (minus `classes`) of an atomic element, read back from its DOM.
 * @returns {{settings: object, warnings: string[]}}
 */
export function atomicSettingsFromDom(el, type, baseUrl) {
  const settings = {};
  const warnings = [];
  const tag = el.tagName.toLowerCase();
  const cssId = el.getAttribute('id');
  if (cssId) settings._cssid = str(cssId);

  switch (type) {
    case 'e-heading': {
      settings.tag = str(/^h[1-6]$/.test(tag) ? tag : 'h2');
      const a = el.querySelector(':scope > a');
      settings.title = html(inlineHtml(a ?? el));
      const link = linkProp(a, baseUrl);
      if (link) settings.link = link;
      break;
    }
    case 'e-paragraph': {
      settings.tag = str(tag === 'span' ? 'span' : 'p');
      const a = el.querySelector(':scope > a');
      settings.paragraph = html(inlineHtml(a ?? el));
      const link = linkProp(a, baseUrl);
      if (link) settings.link = link;
      break;
    }
    case 'e-button': {
      settings.text = html(inlineHtml(el));
      const link = linkProp(tag === 'a' ? el : null, baseUrl);
      if (link) settings.link = link;
      break;
    }
    case 'e-image': {
      const img = tag === 'img' ? el : el.querySelector('img');
      const src = img?.currentSrc || img?.getAttribute('src') || '';
      let url = src;
      try { url = new URL(src, baseUrl).href; } catch { /* keep */ }
      settings.image = {
        $$type: 'image',
        value: {
          src: { $$type: 'image-src', value: { id: null, url: { $$type: 'url', value: url }, alt: str(img?.getAttribute('alt') ?? '') } },
          size: str('full'),
        },
      };
      const link = linkProp(tag === 'a' ? el : null, baseUrl);
      if (link) settings.link = link;
      break;
    }
    case 'e-youtube': {
      let data = {};
      try { data = JSON.parse(el.getAttribute('data-settings') || '{}'); } catch { /* ignore */ }
      if (data.source) settings.source = str(data.source);
      for (const k of ['autoplay', 'mute', 'loop', 'lazyload', 'rel']) {
        if (typeof data[k] === 'boolean') settings[k] = { $$type: 'boolean', value: data[k] };
      }
      if (typeof data.controls === 'boolean') settings.player_controls = { $$type: 'boolean', value: data.controls };
      break;
    }
    case 'e-svg': {
      // The svg prop is a media-library/file URL the markup does not expose
      // (and data: URLs fail Url_Prop_Type validation); the exporter emits
      // the inline markup as an HTML widget instead.
      const svg = el.querySelector('svg');
      if (svg) settings.__svgMarkup = svg.outerHTML;
      const link = linkProp(tag === 'a' ? el : null, baseUrl);
      if (link) settings.link = link;
      break;
    }
    case 'e-flexbox':
    case 'e-div-block': {
      const allowed = ['div', 'header', 'section', 'article', 'aside', 'footer', 'a', 'button'];
      if (tag !== 'div' && allowed.includes(tag)) settings.tag = str(tag);
      const link = linkProp(tag === 'a' ? el : null, baseUrl);
      if (link) settings.link = link;
      break;
    }
    default:
      break;
  }
  return { settings, warnings };
}

/* ------------------------------------------------------------------ *
 * CSS declarations -> atomic style props
 * ------------------------------------------------------------------ */

const SIZE_UNITS = new Set(['px', 'em', 'rem', 'vw', 'vh', 'ch', 'ms', 's', 'deg', 'rad', 'grad', 'turn', 'vmin', 'vmax', '%']);

/** "12px" -> {$$type:size}; "auto" -> unit auto; anything else -> custom. */
function sizeProp(value) {
  const v = String(value).trim();
  if (v === 'auto') return { $$type: 'size', value: { size: '', unit: 'auto' } };
  const m = /^(-?(?:\d+\.?\d*|\.\d+))([a-z%]*)$/i.exec(v);
  if (m) {
    const unit = (m[2] || 'px').toLowerCase();
    if (SIZE_UNITS.has(unit) || (m[2] === '' && Number(m[1]) === 0)) {
      return { $$type: 'size', value: { size: Number(m[1]), unit: m[2] ? unit : 'px' } };
    }
  }
  return { $$type: 'size', value: { size: v, unit: 'custom' } };
}

/** Unitless numbers are valid for line-height only as a custom size. */
function lineHeightProp(value) {
  const v = String(value).trim();
  if (/^-?[\d.]+$/.test(v)) return { $$type: 'size', value: { size: v, unit: 'custom' } };
  return sizeProp(v);
}

const colorProp = (v) => ({ $$type: 'color', value: String(v).trim() });

const LOGICAL_SIDES = {
  padding: ['block-start', 'inline-end', 'block-end', 'inline-start'],
  margin: ['block-start', 'inline-end', 'block-end', 'inline-start'],
  'border-width': ['block-start', 'inline-end', 'block-end', 'inline-start'],
};

/** Physical longhand -> logical key, honouring writing direction. */
function physicalToLogical(side, rtl) {
  if (side === 'top') return 'block-start';
  if (side === 'bottom') return 'block-end';
  if (side === 'left') return rtl ? 'inline-end' : 'inline-start';
  return rtl ? 'inline-start' : 'inline-end';
}

function expandFour(value) {
  const parts = String(value).trim().split(/\s+/);
  if (parts.length === 1) return [parts[0], parts[0], parts[0], parts[0]];
  if (parts.length === 2) return [parts[0], parts[1], parts[0], parts[1]];
  if (parts.length === 3) return [parts[0], parts[1], parts[2], parts[1]];
  return parts.slice(0, 4);
}

/**
 * Convert declarations to atomic style props valid under the source site's
 * Style_Schema. Returns the props plus the declarations that could not be
 * represented (they become the variant's custom CSS).
 *
 * @param {Array<{prop: string, value: string, important: boolean}>} decls
 * @param {object} schema atomicStyleSchema from the controls map
 * @param {{rtl?: boolean, resolveVar?: (v: string) => string}} [opts]
 */
export function declsToAtomicProps(decls, schema, opts = {}) {
  const rtl = !!opts.rtl;
  const props = {};
  const rest = [];
  const boxes = { padding: {}, margin: {}, 'border-width': {} };
  const radius = {};

  for (const decl of decls) {
    let { prop, value } = decl;
    if (decl.important) { rest.push(decl); continue; }
    if (value.includes('var(') && opts.resolveVar) value = opts.resolveVar(value);
    if (value.includes('var(')) { rest.push(decl); continue; }

    // Box sides (logical longhands as atomic CSS writes them, or physical).
    const box = /^(padding|margin|border)-(block-start|block-end|inline-start|inline-end|top|right|bottom|left)(-width)?$/.exec(prop);
    if (box && (box[1] !== 'border' || box[3])) {
      const group = box[1] === 'border' ? 'border-width' : box[1];
      const side = /^(top|right|bottom|left)$/.test(box[2]) ? physicalToLogical(box[2], rtl) : box[2];
      boxes[group][side] = value;
      continue;
    }
    if (prop === 'padding' || prop === 'margin' || prop === 'border-width') {
      const [t, r, b, l] = expandFour(value);
      const sides = boxes[prop];
      sides['block-start'] = t; sides['block-end'] = b;
      sides[rtl ? 'inline-start' : 'inline-end'] = r;
      sides[rtl ? 'inline-end' : 'inline-start'] = l;
      continue;
    }
    if (prop === 'border-radius') {
      const [tl, tr, br, bl] = expandFour(value);
      Object.assign(radius, { 'start-start': tl, 'start-end': tr, 'end-end': br, 'end-start': bl });
      continue;
    }
    const corner = /^border-(top|bottom)-(left|right)-radius$/.exec(prop);
    if (corner) {
      const block = corner[1] === 'top' ? 'start' : 'end';
      const inlineStart = (corner[2] === 'left') !== rtl;
      radius[`${block}-${inlineStart ? 'start' : 'end'}`] = value;
      continue;
    }

    const converted = convertSimple(prop, value, schema[prop]);
    if (converted) props[converted.prop] = converted.value;
    else rest.push(decl);
  }

  for (const [group, sides] of Object.entries(boxes)) {
    const keys = Object.keys(sides);
    if (!keys.length || !schema[group]) continue;
    const values = LOGICAL_SIDES[group].map((k) => sides[k]);
    if (values.every((v) => v !== undefined && v === values[0])) {
      props[group] = sizeProp(values[0]);
    } else {
      const shapeKey = group === 'border-width' ? 'border-width' : 'dimensions';
      const value = {};
      for (const k of LOGICAL_SIDES[group]) if (sides[k] !== undefined) value[k] = sizeProp(sides[k]);
      props[group] = { $$type: shapeKey, value };
    }
  }
  if (Object.keys(radius).length && schema['border-radius']) {
    const values = Object.values(radius);
    props['border-radius'] = Object.keys(radius).length === 4 && values.every((v) => v === values[0])
      ? sizeProp(values[0])
      : { $$type: 'border-radius', value: Object.fromEntries(Object.entries(radius).map(([k, v]) => [k, sizeProp(v)])) };
  }
  return { props, rest };
}

const INSET_MAP = { top: 'inset-block-start', bottom: 'inset-block-end' };

function convertSimple(prop, value, def) {
  // Physical offsets -> logical schema props.
  if (prop === 'top' || prop === 'bottom') return { prop: INSET_MAP[prop], value: sizeProp(value) };
  if (prop === 'background-color') return { prop: 'background', value: { $$type: 'background', value: { color: colorProp(value) } } };
  if (prop === 'row-gap' || prop === 'column-gap') return null; // folded below via `gap` only
  if (!def) return null;

  const members = def.union ? def.union.map((u) => u.k) : [def.k];
  if (prop === 'line-height') return { prop, value: lineHeightProp(value) };
  if (prop === 'gap') {
    const parts = value.trim().split(/\s+/);
    if (parts.length === 2 && members.includes('layout-direction')) {
      return { prop, value: { $$type: 'layout-direction', value: { row: sizeProp(parts[0]), column: sizeProp(parts[1]) } } };
    }
    return { prop, value: sizeProp(parts[0]) };
  }
  if (prop === 'font-family' && members.includes('string')) {
    return { prop, value: str(value.split(',')[0].trim().replace(/^['"]|['"]$/g, '')) };
  }
  if (members.includes('color')) return { prop, value: colorProp(value) };
  if (members.includes('size')) return { prop, value: sizeProp(value) };
  if (def.k === 'number') {
    const n = Number(value);
    return Number.isFinite(n) ? { prop, value: { $$type: 'number', value: n } } : null;
  }
  if (def.k === 'string') {
    if (def.enum && !def.enum.includes(value.trim())) return null;
    return { prop, value: str(value.trim()) };
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * Style definitions
 * ------------------------------------------------------------------ */

/** Base64 for possibly non-Latin-1 CSS text (Utils::decode_string is base64_decode). */
export function base64Utf8(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/**
 * Build an atomic style definition from grouped class rules.
 * @param {string} id style id (local `e-…` id, or global `g-…` id)
 * @param {string} label 'local' or the global class label
 * @param {Array<{breakpoint: string, state: string|null, decls: Array}>} groups
 */
export function buildStyleDefinition(id, label, groups, schema, opts) {
  const variants = [];
  for (const g of groups) {
    const { props, rest } = declsToAtomicProps(g.decls, schema, opts);
    const restText = rest.map((d) => `${d.prop}: ${d.value}${d.important ? ' !important' : ''};`).join('\n');
    if (!Object.keys(props).length && !restText) continue;
    variants.push({
      meta: { breakpoint: g.breakpoint, state: g.state },
      props,
      custom_css: restText ? { raw: base64Utf8(restText) } : null,
    });
  }
  return { id, label, type: 'class', variants };
}

/** Elementor style-state suffixes (Style_States) back to state names. */
export function stateFromSuffix(suffix) {
  const s = suffix.trim();
  if (!s) return null;
  const m = /^:(hover|focus|active|focus-visible|checked)$/.exec(s);
  if (m) return m[1] === 'focus-visible' ? 'hover' : m[1];
  if (s === '.e--selected') return 'e--selected';
  return undefined; // not a plain state: keep as custom CSS
}
