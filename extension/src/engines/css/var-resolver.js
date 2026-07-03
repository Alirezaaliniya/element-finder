/**
 * CSS custom-property resolution.
 *
 * Exported templates land on a DIFFERENT site where the source page's CSS
 * variables (Elementor kit globals like `--e-global-color-primary`, theme
 * tokens, lazy-load vars) do not exist. Any `var(...)` that survives into the
 * export therefore renders as a missing/invalid value. This module folds
 * variables down to their concrete computed values at capture time, while the
 * source page is still available to answer lookups.
 *
 * A "lookup" is `(name: '--foo') => string` — usually backed by
 * `getComputedStyle(el).getPropertyValue(name)`, which already walks the
 * inheritance chain up to :root.
 */

import { firstFontFamily, toHexColor, toSlider } from './converters.js';

/** Cheap guard so callers can skip work for the common var-free case. */
export function containsVar(value) {
  return typeof value === 'string' && value.includes('var(');
}

/**
 * Substitute every `var(--name[, fallback])` in a CSS value with the
 * lookup's computed value; nested fallbacks (`var(--a, var(--b, red))`)
 * resolve recursively.
 *
 * @param {string} value
 * @param {(name: string) => string} lookup
 * @param {object} [opts]
 * @param {boolean} [opts.keepUnresolved=true] when a variable has no computed
 *        value and no fallback, keep the original `var(...)` text (right for
 *        pass-through CSS) instead of dropping it to an empty string.
 * @returns {string}
 */
export function resolveCssVars(value, lookup, opts = {}) {
  const { keepUnresolved = true } = opts;
  let current = value;
  // A substituted value may itself contain var() (custom prop chains in
  // browsers that expose them unresolved) — iterate with a hard cap.
  for (let pass = 0; pass < 8 && containsVar(current); pass++) {
    const next = substituteOnce(current, lookup, keepUnresolved);
    if (next === current) break; // only unresolved-and-kept vars remain
    current = next;
  }
  return current;
}

function substituteOnce(value, lookup, keepUnresolved) {
  let out = '';
  let i = 0;
  while (i < value.length) {
    const start = value.indexOf('var(', i);
    if (start === -1) { out += value.slice(i); break; }
    out += value.slice(i, start);
    const close = matchParen(value, start + 3);
    if (close === -1) { out += value.slice(start); break; }
    const inner = value.slice(start + 4, close);
    const comma = topLevelComma(inner);
    const name = (comma === -1 ? inner : inner.slice(0, comma)).trim();
    const fallback = comma === -1 ? null : inner.slice(comma + 1).trim();

    let resolved = '';
    try { resolved = (lookup(name) || '').trim(); } catch { /* detached el */ }
    if (!resolved && fallback !== null) resolved = fallback;
    out += resolved || (keepUnresolved ? value.slice(start, close + 1) : '');
    i = close + 1;
  }
  return out;
}

/** Index of the ')' matching the '(' at `open`, or -1. */
function matchParen(str, open) {
  let depth = 0;
  for (let i = open; i < str.length; i++) {
    if (str[i] === '(') depth++;
    else if (str[i] === ')' && --depth === 0) return i;
  }
  return -1;
}

/** First comma at paren depth 0 (separates var name from fallback). */
function topLevelComma(str) {
  let depth = 0;
  for (let i = 0; i < str.length; i++) {
    if (str[i] === '(') depth++;
    else if (str[i] === ')') depth--;
    else if (str[i] === ',' && depth === 0) return i;
  }
  return -1;
}

/* ------------------------------------------------------------------ *
 * Elementor kit globals in native data-settings
 * ------------------------------------------------------------------ */

const GLOBAL_COLOR_RE = /^globals\/colors\?id=(.+)$/;
const GLOBAL_TYPO_RE = /^globals\/typography\?id=(.+)$/;

const TYPO_PARTS = [
  ['font-family', (prefix, v) => {
    const family = firstFontFamily(v);
    return family ? { [`${prefix}_font_family`]: family } : null;
  }],
  ['font-size', (prefix, v) => {
    const slider = toSlider(v);
    return slider ? { [`${prefix}_font_size`]: slider } : null;
  }],
  ['font-weight', (prefix, v) => (v ? { [`${prefix}_font_weight`]: v } : null)],
  ['font-style', (prefix, v) => (v && v !== 'normal' ? { [`${prefix}_font_style`]: v } : null)],
  ['text-transform', (prefix, v) => (v && v !== 'none' ? { [`${prefix}_text_transform`]: v } : null)],
  ['text-decoration', (prefix, v) => (v && v !== 'none' ? { [`${prefix}_text_decoration`]: v.split(' ')[0] } : null)],
  ['line-height', (prefix, v) => {
    const slider = v && v !== 'normal' ? toSlider(v) : null;
    return slider ? { [`${prefix}_line_height`]: slider } : null;
  }],
  ['letter-spacing', (prefix, v) => {
    const slider = v && v !== 'normal' ? toSlider(v) : null;
    return slider ? { [`${prefix}_letter_spacing`]: slider } : null;
  }],
];

/**
 * Replace an Elementor `__globals__` block (site-kit references like
 * `"globals/colors?id=primary"`) with the concrete values the source page
 * computed for them. The kit does not exist on the import target, so an
 * un-resolved reference silently loses the style there.
 *
 * Returns a NEW settings object; the original is not mutated.
 *
 * @param {object} settings native data-settings (may contain __globals__)
 * @param {(name: string) => string} lookup
 */
export function resolveElementorGlobals(settings, lookup) {
  const globals = settings?.__globals__;
  if (!globals || typeof globals !== 'object') return settings;

  const out = { ...settings };
  delete out.__globals__;

  for (const [key, ref] of Object.entries(globals)) {
    if (typeof ref !== 'string' || !ref) continue;

    const colorId = GLOBAL_COLOR_RE.exec(ref)?.[1];
    if (colorId) {
      const raw = safeLookup(lookup, `--e-global-color-${colorId}`);
      const hex = toHexColor(raw) ?? (raw.startsWith('#') ? raw.toUpperCase() : null);
      if (hex && out[key] === undefined) out[key] = hex;
      continue;
    }

    const typoId = GLOBAL_TYPO_RE.exec(ref)?.[1];
    if (typoId && key.endsWith('_typography')) {
      const prefix = key.slice(0, -'_typography'.length);
      let any = false;
      for (const [part, build] of TYPO_PARTS) {
        const v = safeLookup(lookup, `--e-global-typography-${typoId}-${part}`);
        const fragment = v ? build(prefix, v) : null;
        if (fragment) {
          for (const [k, val] of Object.entries(fragment)) {
            if (out[k] === undefined) { out[k] = val; any = true; }
          }
        }
      }
      if (any && out[key] === undefined) out[key] = 'custom';
    }
  }
  return out;
}

function safeLookup(lookup, name) {
  try { return (lookup(name) || '').trim(); } catch { return ''; }
}
