/**
 * StylesheetIndex — scans every accessible stylesheet once and buckets
 * media-query rules into Elementor's breakpoint model so per-element
 * responsive overrides can be resolved quickly.
 *
 * Cross-origin stylesheets throw on .cssRules access; those are counted and
 * surfaced as a snapshot warning rather than failing the run.
 */

import { BREAKPOINTS, BREAKPOINT_MAX_WIDTH } from '../../common/constants.js';
import { containsVar, resolveCssVars } from '../css/var-resolver.js';

export class StylesheetIndex {
  constructor(document) {
    this.document = document;
    /** @type {Array<{device: string, selector: string, style: CSSStyleDeclaration}>} */
    this.deviceRules = [];
    /**
     * Desktop-scope background-image declarations, in cascade order.
     * Used to rescue backgrounds that lazy-load mechanisms force to `none`
     * at computed-style time (e.g. Elementor's `.e-lazyloaded` gate).
     * @type {Array<{selector: string, value: string, baseHref: string|null}>}
     */
    this.backgroundRules = [];
    /**
     * Desktop-scope rules declaring box offsets/size/transform. Computed
     * style turns `left: 50%` into the px it resolved to at extraction
     * width; positioned decorations need the authored value to land in the
     * same place at other widths.
     * @type {Array<{selector: string, style: CSSStyleDeclaration}>}
     */
    this.offsetRules = [];
    /** offsetRules bucketed by the rightmost compound's id/class/tag. */
    this.offsetBuckets = new Map();
    this.offsetOrder = 0;
    this.inaccessibleSheets = 0;
    this.inaccessibleHrefs = []; // cross-origin sheets; fonts recoverable via fetch
    this.fontFaces = [];   // { family, src, weight, style, baseHref }
    this.keyframes = 0;
  }

  build() {
    for (const sheet of this.document.styleSheets) {
      let rules;
      try { rules = sheet.cssRules; } catch {
        this.inaccessibleSheets++;
        if (sheet.href) this.inaccessibleHrefs.push(sheet.href);
        continue;
      }
      if (!rules) continue;
      this.#walkRules(rules, null, sheet.href ?? null);
    }
    return this;
  }

  #walkRules(rules, device, baseHref) {
    for (const rule of rules) {
      if (rule instanceof CSSMediaRule) {
        const bucket = bucketForMedia(rule.media);
        // Nested media: most specific (innermost) bucket wins.
        this.#walkRules(rule.cssRules, bucket ?? device, baseHref);
      } else if (rule instanceof CSSFontFaceRule) {
        const s = rule.style;
        this.fontFaces.push({
          family: (s.getPropertyValue('font-family') || '').replace(/^['"]|['"]$/g, ''),
          src: s.getPropertyValue('src') || '',
          weight: s.getPropertyValue('font-weight') || 'normal',
          style: s.getPropertyValue('font-style') || 'normal',
          // src is authored, often relative — it must resolve against the
          // DECLARING stylesheet, not the page URL.
          baseHref,
        });
      } else if (rule instanceof CSSStyleRule) {
        if (device) {
          for (const selector of safeSplitSelectors(rule.selectorText)) {
            this.deviceRules.push({ device, selector, style: rule.style });
          }
        } else {
          if (OFFSET_PROPS.some((p) => rule.style.getPropertyValue(p))) {
            for (const selector of safeSplitSelectors(rule.selectorText)) {
              const entry = { selector, style: rule.style, order: this.offsetOrder++ };
              this.offsetRules.push(entry);
              const key = bucketKey(selector);
              if (!this.offsetBuckets.has(key)) this.offsetBuckets.set(key, []);
              this.offsetBuckets.get(key).push(entry);
            }
          }
          const bg = rule.style.getPropertyValue('background-image') || rule.style.getPropertyValue('background');
          // Accept var() references too — declaredBackgroundFor resolves them
          // per element before extracting the url.
          if (bg && (bg.includes('url(') || containsVar(bg))) {
            for (const selector of safeSplitSelectors(rule.selectorText)) {
              this.backgroundRules.push({ selector, value: bg.trim(), baseHref });
            }
          }
        }
      } else if (rule.cssRules) {
        // supports/layer/etc — descend, keep current device bucket
        try { this.#walkRules(rule.cssRules, device, baseHref); } catch { /* ignore */ }
      }
    }
  }

  /**
   * Authored offset/size/transform declarations matching `el` (desktop
   * scope, later rules win; `!important` beats normal).
   * @returns {Record<string, string>}
   */
  declaredOffsetsFor(el) {
    const out = {};
    const important = {};
    // Only rules whose rightmost compound could match this element, kept in
    // cascade (source) order.
    const candidates = [];
    const add = (key) => { const list = this.offsetBuckets.get(key); if (list) candidates.push(...list); };
    add('*');
    add(`tag:${el.tagName.toLowerCase()}`);
    if (el.id) add(`id:${el.id}`);
    for (const c of el.classList) add(`cls:${c}`);
    candidates.sort((a, b) => a.order - b.order);
    for (const { selector, style } of candidates) {
      let matches = false;
      try { matches = el.matches(selector); } catch { continue; }
      if (!matches) continue;
      for (const prop of OFFSET_PROPS) {
        const v = style.getPropertyValue(prop);
        if (!v) continue;
        const imp = style.getPropertyPriority(prop) === 'important';
        if (important[prop] && !imp) continue;
        out[prop] = v.trim();
        if (imp) important[prop] = true;
      }
    }
    return out;
  }

  /**
   * Last (cascade-order) declared background-image for `el`, with its URL
   * resolved against the declaring stylesheet. Returns null when none apply.
   */
  declaredBackgroundFor(el) {
    let found = null;
    for (const { selector, value, baseHref } of this.backgroundRules) {
      // Lazy gates use :not(.e-lazyloaded) selectors — strip the gate so the
      // rule matches the element's "loaded" state.
      const cleaned = selector.replace(/:not\(\.e-lazyloaded\)/g, '');
      let matches = false;
      try { matches = el.matches(cleaned); } catch { continue; }
      if (matches) found = { value, baseHref };
    }
    if (!found) return null;
    // Authored values may hide the url behind a variable (`background-image:
    // var(--hero-bg)`) — resolve against the element's computed style first.
    let value = found.value;
    if (containsVar(value)) {
      const win = this.document.defaultView;
      if (win) {
        const style = win.getComputedStyle(el);
        value = resolveCssVars(value, (name) => style.getPropertyValue(name));
      }
    }
    const m = /url\((['"]?)(.*?)\1\)/.exec(value);
    if (!m) return null;
    try {
      const abs = new URL(m[2], found.baseHref ?? this.document.baseURI).href;
      return `url("${abs}")`;
    } catch { return null; }
  }

  /**
   * Resolve all override declarations that apply to `el` at the given device.
   * Later stylesheet order wins (a fair approximation of the cascade for
   * same-specificity overrides, which media-query overrides usually are).
   * @returns {Record<string,string>}
   */
  overridesFor(el, device, props) {
    const out = {};
    for (const { device: d, selector, style } of this.deviceRules) {
      if (d !== device) continue;
      let matches = false;
      try { matches = el.matches(selector); } catch { continue; }
      if (!matches) continue;
      for (const prop of props) {
        const v = style.getPropertyValue(prop);
        if (v) out[prop] = v.trim();
      }
      // Expand shorthands that the captured-prop list reads longhand.
      expandShorthands(style, out);
      // Elementor containers change layout per breakpoint only through
      // custom properties (`--flex-direction:column` in a media rule), read
      // by the inner box via var(); map them to the real properties.
      for (const [name, targets] of ELEMENTOR_LAYOUT_VARS) {
        const v = style.getPropertyValue(name).trim();
        if (!v) continue;
        const parts = targets.length > 1 ? v.split(/\s+/) : [v];
        targets.forEach((t, i) => { if (props.includes(t)) out[t] = parts[i] ?? parts[0]; });
      }
    }
    return out;
  }
}

/** Map a MediaList to a breakpoint bucket (or null when not width-based). */
export function bucketForMedia(media) {
  const text = media.mediaText.toLowerCase();
  if (!/(max|min)-width/.test(text)) return null;

  const maxW = matchPx(text, /max-width:\s*([\d.]+)px/);
  const minW = matchPx(text, /min-width:\s*([\d.]+)px/);

  // Desktop-first overrides: max-width buckets map directly to Elementor devices.
  if (maxW !== null) {
    if (maxW <= BREAKPOINT_MAX_WIDTH[BREAKPOINTS.MOBILE] + 13) return BREAKPOINTS.MOBILE; // tolerate 767/780 variants
    if (maxW <= BREAKPOINT_MAX_WIDTH[BREAKPOINTS.TABLET] + 36) return BREAKPOINTS.TABLET; // tolerate 1024/1060 variants
    return null; // wide max-width — effectively desktop, baseline already has it
  }
  // Pure min-width rules describe the desktop baseline; nothing to override.
  if (minW !== null) return null;
  return null;
}

function matchPx(text, re) {
  const m = re.exec(text);
  return m ? parseFloat(m[1]) : null;
}

function safeSplitSelectors(selectorText) {
  return (selectorText || '').split(',').map((s) => s.trim()).filter(Boolean);
}

/** Bucket key of a selector: its rightmost compound's id, else first class, else tag. */
function bucketKey(selector) {
  const last = selector.replace(/::?[\w-]+(\([^)]*\))?/g, '').trim().split(/[\s>+~]+/).pop() || '';
  const id = /#([\w-]+)/.exec(last);
  if (id) return `id:${id[1]}`;
  const cls = /\.([\w-]+)/.exec(last);
  if (cls) return `cls:${cls[1]}`;
  const tag = /^([a-z][\w-]*)/i.exec(last);
  return tag ? `tag:${tag[1].toLowerCase()}` : '*';
}

const OFFSET_PROPS = ['top', 'right', 'bottom', 'left', 'width', 'transform', 'grid-template-columns'];

const ELEMENTOR_LAYOUT_VARS = [
  ['--flex-direction', ['flex-direction']],
  ['--flex-wrap', ['flex-wrap']],
  ['--justify-content', ['justify-content']],
  ['--align-items', ['align-items']],
  ['--gap', ['row-gap', 'column-gap']],
  ['--row-gap', ['row-gap']],
  ['--column-gap', ['column-gap']],
  // Container size controls are variables too (min_height_tablet -> --min-height).
  ['--min-height', ['min-height']],
  ['--width', ['width']],
];

const SHORTHAND_EXPANSIONS = {
  margin: ['margin-top', 'margin-right', 'margin-bottom', 'margin-left'],
  padding: ['padding-top', 'padding-right', 'padding-bottom', 'padding-left'],
  gap: ['row-gap', 'column-gap'],
};

function expandShorthands(style, out) {
  for (const [shorthand, longhands] of Object.entries(SHORTHAND_EXPANSIONS)) {
    const v = style.getPropertyValue(shorthand);
    if (!v) continue;
    for (const lh of longhands) {
      const lv = style.getPropertyValue(lh);
      if (lv) out[lh] = lv.trim();
    }
  }
  const fontShorthand = style.getPropertyValue('font');
  if (fontShorthand) {
    for (const lh of ['font-size', 'font-family', 'font-weight', 'line-height']) {
      const lv = style.getPropertyValue(lh);
      if (lv) out[lh] = lv.trim();
    }
  }
}
