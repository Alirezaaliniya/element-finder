/**
 * CSS value parsers and CSS->Elementor setting converters.
 * Pure functions: raw CSS declaration map in, Elementor setting fragments out.
 */

import { compactObject, cssNumber, round2 } from '../../common/utils.js';

/* ------------------------------------------------------------------ *
 * Value parsing
 * ------------------------------------------------------------------ */

/** rgb()/rgba()/hex/named-ish -> #RRGGBB or #RRGGBBAA. Returns null for transparent/none. */
export function toHexColor(value) {
  if (!value || value === 'none') return null;
  value = value.trim();
  if (value.startsWith('#')) return value.toUpperCase();
  const m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.%]+))?\s*\)$/i.exec(value);
  if (!m) return null;
  const [r, g, b] = [m[1], m[2], m[3]].map((n) => Math.round(parseFloat(n)));
  let alpha = m[4] === undefined ? 1 : (m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]));
  if (alpha === 0) return null; // fully transparent — treat as unset
  const hex = (n) => n.toString(16).padStart(2, '0').toUpperCase();
  let out = `#${hex(r)}${hex(g)}${hex(b)}`;
  if (alpha < 1) out += hex(Math.round(alpha * 255));
  return out;
}

/** "12px" -> {unit:'px', size:12}; supports %, em, rem, vw, vh. */
export function toSlider(value) {
  const n = cssNumber(value);
  if (n === null) return null;
  const unit = /%$/.test(value) ? '%'
    : /em$/.test(value) && !/rem$/.test(value) ? 'em'
    : /rem$/.test(value) ? 'rem'
    : /vw$/.test(value) ? 'vw'
    : /vh$/.test(value) ? 'vh'
    : 'px';
  return { unit, size: round2(n), sizes: [] };
}

/** Elementor "dimensions" control from 4 side values. Returns null when all zero. */
export function toDimensions(top, right, bottom, left) {
  const raw = [top, right, bottom, left];
  const vals = raw.map((v) => cssNumber(v) ?? 0);
  if (vals.every((v) => v === 0)) return null;
  const [t, r, b, l] = vals.map((v) => String(round2(v)));
  // Preserve the original CSS unit (em, rem, %, vw, vh) instead of always
  // defaulting to px, which would silently break relative-unit layouts.
  const unit = detectUnit(raw.find((v) => v && cssNumber(v) !== 0) || raw[0]);
  return {
    unit,
    top: t, right: r, bottom: b, left: l,
    isLinked: t === r && r === b && b === l,
  };
}

/** Extract the CSS unit from a value string ("2em" → "em", "10px" → "px"). */
function detectUnit(value) {
  if (!value || typeof value !== 'string') return 'px';
  const m = /(%|em|rem|vw|vh)$/.exec(value.trim());
  return m ? m[1] : 'px';
}

/** Extract first url(...) from a background-image value. */
export function extractCssUrl(value) {
  if (!value || value === 'none') return null;
  const m = /url\((['"]?)(.*?)\1\)/.exec(value);
  return m ? m[2] : null;
}

/** Detect a linear/radial gradient in background-image. */
export function extractGradient(value) {
  if (!value || value === 'none') return null;
  const m = /(linear|radial)-gradient\((.+)\)/.exec(value);
  if (!m) return null;
  const colors = [...m[2].matchAll(/rgba?\([^)]*\)|#[0-9a-f]{3,8}/gi)].map((x) => toHexColor(x[0])).filter(Boolean);
  if (colors.length < 2) return null;
  let angle = 180;
  const angleMatch = /(-?[\d.]+)deg/.exec(m[2]);
  if (angleMatch) angle = round2(parseFloat(angleMatch[1]));
  return { type: m[1], angle, colorA: colors[0], colorB: colors[colors.length - 1] };
}

/** Parse the first box-shadow into Elementor's shadow control shape. */
export function parseBoxShadow(value) {
  if (!value || value === 'none') return null;
  const first = splitTopLevel(value, ',')[0];
  const inset = /\binset\b/.test(first);
  const color = toHexColor((/rgba?\([^)]*\)|#[0-9a-f]{3,8}/i.exec(first) || [])[0] || '');
  const nums = first.replace(/rgba?\([^)]*\)|#[0-9a-f]{3,8}/gi, '')
    .replace(/\binset\b/g, '').trim()
    .split(/\s+/).map(cssNumber).filter((n) => n !== null);
  if (nums.length < 2) return null;
  const shadow = {
    horizontal: round2(nums[0]),
    vertical: round2(nums[1]),
    blur: round2(nums[2] ?? 0),
    spread: round2(nums[3] ?? 0),
    color: color || 'rgba(0,0,0,0.5)',
  };
  if (inset) shadow.inset = 'yes';
  return shadow;
}

/** Split on a separator only at paren depth 0 (for shadow/gradient lists). */
function splitTopLevel(str, sep) {
  const out = [];
  let depth = 0, cur = '';
  for (const ch of str) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === sep && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

export function firstFontFamily(value) {
  if (!value) return null;
  const first = value.split(',')[0].trim().replace(/^['"]|['"]$/g, '');
  if (!first || /^(-apple-system|system-ui|blinkmacsystemfont)$/i.test(first)) return null;
  return first;
}

/* ------------------------------------------------------------------ *
 * Declaration map -> Elementor settings
 * ------------------------------------------------------------------ */

/**
 * Convert a raw curated declaration map into generic Elementor settings.
 * Widget-specific key renames (e.g. color -> title_color for headings)
 * happen later in the export adapters; here we emit canonical names.
 *
 * @param {Record<string,string>} raw curated CSS declarations
 * @param {object} [opts] { isContainer, defaults: raw decls of the parent default (for override diffing) }
 */
export function declarationsToSettings(raw, opts = {}) {
  const s = {};
  const { isContainer = false } = opts;

  // --- Spacing -----------------------------------------------------
  const padding = toDimensions(raw['padding-top'], raw['padding-right'], raw['padding-bottom'], raw['padding-left']);
  if (padding) s.padding = padding;
  const margin = toDimensions(raw['margin-top'], raw['margin-right'], raw['margin-bottom'], raw['margin-left']);
  if (margin) s.margin = margin;

  // --- Typography ---------------------------------------------------
  const typo = {};
  const fontSize = toSlider(raw['font-size']);
  if (fontSize) typo.typography_font_size = fontSize;
  const family = firstFontFamily(raw['font-family']);
  if (family) typo.typography_font_family = family;
  const weight = raw['font-weight'];
  if (weight && weight !== '400' && weight !== 'normal') typo.typography_font_weight = weight === '700' ? 'bold' : weight;
  if (raw['font-style'] && raw['font-style'] !== 'normal') typo.typography_font_style = raw['font-style'];
  if (raw['text-transform'] && raw['text-transform'] !== 'none') typo.typography_text_transform = raw['text-transform'];
  const deco = raw['text-decoration-line'] || raw['text-decoration'];
  if (deco && deco !== 'none' && !deco.startsWith('none')) typo.typography_text_decoration = deco.split(' ')[0];
  const lh = raw['line-height'];
  if (lh && lh !== 'normal') {
    const slider = toSlider(lh);
    if (slider) typo.typography_line_height = slider;
  }
  const ls = raw['letter-spacing'];
  if (ls && ls !== 'normal') {
    const slider = toSlider(ls);
    if (slider) typo.typography_letter_spacing = slider;
  }
  if (Object.keys(typo).length) {
    s.typography_typography = 'custom';
    Object.assign(s, typo);
  }
  const color = toHexColor(raw['color']);
  if (color) s.color = color; // renamed per-widget at export
  if (raw['text-align'] && raw['text-align'] !== 'start' && raw['text-align'] !== 'left') {
    s.align = raw['text-align'] === 'end' ? 'right' : raw['text-align'];
  }

  // --- Background ----------------------------------------------------
  const bgColor = toHexColor(raw['background-color']);
  const bgUrl = extractCssUrl(raw['background-image']);
  const gradient = extractGradient(raw['background-image']);
  if (bgUrl) {
    s.background_background = 'classic';
    s.background_image = { url: bgUrl, id: '', source: 'library' };
    if (raw['background-position'] && raw['background-position'] !== '0% 0%') {
      s.background_position = normalizeBgPosition(raw['background-position']);
    }
    if (raw['background-repeat'] && raw['background-repeat'] !== 'repeat') s.background_repeat = raw['background-repeat'];
    if (raw['background-size'] && raw['background-size'] !== 'auto') {
      s.background_size = ['cover', 'contain', 'auto'].includes(raw['background-size']) ? raw['background-size'] : 'cover';
    }
    if (bgColor) s.background_color = bgColor;
  } else if (gradient) {
    s.background_background = 'gradient';
    s.background_color = gradient.colorA;
    s.background_color_b = gradient.colorB;
    s.background_gradient_angle = { unit: 'deg', size: gradient.angle, sizes: [] };
    s.background_gradient_type = gradient.type;
  } else if (bgColor) {
    s.background_background = 'classic';
    s.background_color = bgColor;
  }

  // --- Border ----------------------------------------------------------
  const bStyle = raw['border-top-style'];
  const bWidth = toDimensions(raw['border-top-width'], raw['border-right-width'], raw['border-bottom-width'], raw['border-left-width']);
  if (bStyle && bStyle !== 'none' && bWidth) {
    s.border_border = bStyle;
    s.border_width = bWidth;
    const bColor = toHexColor(raw['border-top-color']);
    if (bColor) s.border_color = bColor;
  }
  const radius = toDimensions(
    raw['border-top-left-radius'], raw['border-top-right-radius'],
    raw['border-bottom-right-radius'], raw['border-bottom-left-radius'],
  );
  if (radius) s.border_radius = radius;

  // --- Shadow ---------------------------------------------------------
  const shadow = parseBoxShadow(raw['box-shadow']);
  if (shadow) {
    s.box_shadow_box_shadow_type = 'yes';
    s.box_shadow_box_shadow = shadow;
  }

  // --- Sizing / positioning --------------------------------------------
  // Only AUTHORED widths are design intent: Elementor's --width variable
  // (keeps "47%"/"1200px") or an explicit percentage. The computed `width`
  // longhand is the layout result (always px) and would add noise to every
  // element, so it is never used here.
  const authoredWidth = (raw['--width'] || '').trim()
    || (/%$/.test(raw['width'] || '') ? raw['width'] : '');
  if (isContainer) {
    const minH = toSlider(raw['min-height'] || raw['--min-height']);
    if (minH && minH.size > 0) s.min_height = minH;
    const w = toSlider(authoredWidth);
    if (w && (w.unit !== 'px' || (w.size > 0 && w.size <= 1600))) {
      s.width = w;
      s.content_width = 'full'; // a width-bearing flex container is content-full
    }
  } else if (authoredWidth) {
    // Flex-item width on widgets -> Elementor's element-width controls.
    const w = toSlider(authoredWidth);
    if (w) {
      s._element_width = 'initial';
      s._element_custom_width = w;
    }
  }
  const overflow = raw['overflow'];
  if (overflow === 'hidden' || overflow === 'auto' || overflow === 'scroll') s.overflow = overflow;
  const z = cssNumber(raw['z-index']);
  if (z !== null && z !== 0) s.z_index = z;
  if (raw['position'] === 'absolute' || raw['position'] === 'fixed') {
    s._position = raw['position'];
    // Anchor each axis to its NEAREST edge — an element 80px from the right
    // of a 1200px container must export as _offset_x_end: 80 (orientation
    // "end"), not _offset_x: ~1000, or it drifts on other screen widths.
    const left = cssNumber(raw['left']);
    const right = cssNumber(raw['right']);
    if (right !== null && (left === null || Math.abs(right) < Math.abs(left))) {
      s._offset_orientation_h = 'end';
      s._offset_x_end = toSlider(raw['right']);
    } else if (left !== null) {
      s._offset_x = toSlider(raw['left']);
    }
    const top = cssNumber(raw['top']);
    const bottom = cssNumber(raw['bottom']);
    if (bottom !== null && (top === null || Math.abs(bottom) < Math.abs(top))) {
      s._offset_orientation_v = 'end';
      s._offset_y_end = toSlider(raw['bottom']);
    } else if (top !== null) {
      s._offset_y = toSlider(raw['top']);
    }
  }
  const opacity = cssNumber(raw['opacity']);
  if (opacity !== null && opacity < 1) s.opacity = { unit: 'px', size: round2(opacity), sizes: [] };

  // --- Flex container -----------------------------------------------------
  if (isContainer && (raw['display'] || '').includes('flex')) {
    const dir = raw['flex-direction'] || 'row';
    s.flex_direction = dir;
    if (raw['flex-wrap'] === 'wrap') s.flex_wrap = 'wrap';
    const justify = normalizeFlexValue(raw['justify-content']);
    if (justify && justify !== 'normal' && justify !== 'flex-start') s.flex_justify_content = justify;
    const align = normalizeFlexValue(raw['align-items']);
    if (align && align !== 'normal' && align !== 'stretch') s.flex_align_items = align;
    const colGap = cssNumber(raw['column-gap']) ?? 0;
    const rowGap = cssNumber(raw['row-gap']) ?? 0;
    if (colGap || rowGap) {
      s.flex_gap = {
        unit: 'px',
        size: round2(colGap || rowGap),
        column: String(round2(colGap)),
        row: String(round2(rowGap)),
        isLinked: colGap === rowGap,
      };
    }
  }

  // --- Flex item (alignment within parent) ---------------------------------
  const alignSelf = normalizeFlexValue(raw['align-self']);
  if (alignSelf && alignSelf !== 'auto' && alignSelf !== 'normal' && alignSelf !== 'stretch') {
    s._flex_align_self = raw['align-self'];
  }

  return compactObject(s);
}

function normalizeBgPosition(value) {
  const named = {
    '50% 50%': 'center center', '50% 0%': 'center top', '50% 100%': 'center bottom',
    '0% 50%': 'left center', '100% 50%': 'right center', '0% 0%': 'top left',
    '100% 0%': 'right top', '0% 100%': 'left bottom', '100% 100%': 'right bottom',
  };
  return named[value] || 'center center';
}

function normalizeFlexValue(v) {
  if (!v) return null;
  return v.replace(/^(start)$/, 'flex-start').replace(/^(end)$/, 'flex-end');
}
