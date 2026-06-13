/**
 * Image URL resolution shared by the Content Extraction and Asset Collection
 * engines. Handles the real-world mess: lazy-load attributes (data-src and
 * friends), srcset candidate selection, <picture>, and placeholder srcs
 * (inline SVG shims, 1px gifs) that lazy-loaders leave in `src`.
 */

import { resolveUrl } from '../../common/utils.js';

const LAZY_SRC_ATTRS = ['data-src', 'data-lazy-src', 'data-original', 'data-lazyload', 'data-orig-file'];
const LAZY_SRCSET_ATTRS = ['data-srcset', 'data-lazy-srcset'];

/** Lazy-loader shims and spacer images that must never win. */
export function isPlaceholderSrc(url) {
  if (!url) return true;
  if (url.startsWith('data:image/svg+xml')) return true;           // size-reserving shim
  if (/^data:image\/gif/.test(url) && url.length < 200) return true; // 1px gif
  if (/\b(blank|spacer|placeholder|pixel|1x1|lazy)\.(gif|png|svg)\b/i.test(url)) return true;
  return false;
}

/**
 * Best source URL for an <img> / <picture> element.
 * Preference: real currentSrc → lazy attributes → largest srcset candidate
 * → src. Placeholders only win when nothing else exists.
 * @returns {string|null} absolute URL
 */
export function bestImageUrl(el, baseUrl) {
  const img = el.tagName === 'PICTURE' ? (el.querySelector('img') ?? el) : el;
  const candidates = [];

  if (img.currentSrc) candidates.push(img.currentSrc);
  for (const attr of LAZY_SRC_ATTRS) {
    const v = img.getAttribute(attr);
    if (v) candidates.push(v);
  }
  for (const attr of LAZY_SRCSET_ATTRS) {
    const largest = largestFromSrcset(img.getAttribute(attr));
    if (largest) candidates.push(largest);
  }
  const fromSrcset = largestFromSrcset(img.getAttribute('srcset'));
  if (fromSrcset) candidates.push(fromSrcset);
  const src = img.getAttribute('src');
  if (src) candidates.push(src);

  // <picture><source> fallbacks when the img itself gave us nothing real.
  if (el.tagName === 'PICTURE') {
    for (const source of el.querySelectorAll('source')) {
      const largest = largestFromSrcset(source.getAttribute('srcset') || source.getAttribute('data-srcset'));
      if (largest) candidates.push(largest);
    }
  }

  for (const c of candidates) {
    if (!isPlaceholderSrc(c)) {
      const abs = resolveUrl(c, baseUrl);
      if (abs) return abs;
    }
  }
  // Everything was a placeholder — return the first resolvable one rather than nothing.
  for (const c of candidates) {
    const abs = resolveUrl(c, baseUrl);
    if (abs) return abs;
  }
  return null;
}

/** All distinct URLs from a srcset (for asset variant cataloging). */
export function srcsetUrls(srcset, baseUrl, limit = 6) {
  if (!srcset) return [];
  const out = [];
  for (const part of srcset.split(',')) {
    const url = part.trim().split(/\s+/)[0];
    const abs = resolveUrl(url, baseUrl);
    if (abs && !isPlaceholderSrc(url) && !out.includes(abs)) out.push(abs);
    if (out.length >= limit) break;
  }
  return out;
}

/** Pick the largest candidate (by width descriptor / density) from a srcset. */
function largestFromSrcset(srcset) {
  if (!srcset) return null;
  let best = null;
  let bestScore = -1;
  for (const part of srcset.split(',')) {
    const bits = part.trim().split(/\s+/);
    const url = bits[0];
    if (!url) continue;
    const desc = bits[1] ?? '';
    const score = desc.endsWith('w') ? parseFloat(desc)
      : desc.endsWith('x') ? parseFloat(desc) * 1000
      : 0;
    if (score > bestScore) { bestScore = score; best = url; }
  }
  return best;
}
