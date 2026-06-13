/**
 * StylesheetIndex — scans every accessible stylesheet once and buckets
 * media-query rules into Elementor's breakpoint model so per-element
 * responsive overrides can be resolved quickly.
 *
 * Cross-origin stylesheets throw on .cssRules access; those are counted and
 * surfaced as a snapshot warning rather than failing the run.
 */

import { BREAKPOINTS, BREAKPOINT_MAX_WIDTH } from '../../common/constants.js';

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
    this.inaccessibleSheets = 0;
    this.fontFaces = [];   // { family, src, weight, style }
    this.keyframes = 0;
  }

  build() {
    for (const sheet of this.document.styleSheets) {
      let rules;
      try { rules = sheet.cssRules; } catch { this.inaccessibleSheets++; continue; }
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
        });
      } else if (rule instanceof CSSStyleRule) {
        if (device) {
          for (const selector of safeSplitSelectors(rule.selectorText)) {
            this.deviceRules.push({ device, selector, style: rule.style });
          }
        } else {
          const bg = rule.style.getPropertyValue('background-image') || rule.style.getPropertyValue('background');
          if (bg && bg.includes('url(')) {
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
    const m = /url\((['"]?)(.*?)\1\)/.exec(found.value);
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
