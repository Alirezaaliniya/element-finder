/**
 * Structure heuristics used by the DOM Analysis Engine:
 * semantic-kind detection, widget/container role classification and
 * repeating-pattern (loop/grid candidate) detection.
 */

import { NODE_ROLES } from '../../common/constants.js';
import { detectAtomic } from '../elementor/atomic.js';

const IGNORED_TAGS = new Set([
  'script', 'style', 'noscript', 'template', 'meta', 'link', 'base', 'title',
  'head', 'param', 'track', 'br', 'wbr',
]);

const WIDGETISH_TAGS = new Set([
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'img', 'picture', 'svg', 'video',
  'audio', 'iframe', 'canvas', 'button', 'input', 'select', 'textarea',
  'blockquote', 'pre', 'code', 'hr', 'table', 'figure',
]);

const STRUCTURAL_TAGS = new Set([
  'div', 'section', 'article', 'main', 'header', 'footer', 'aside', 'nav',
  'ul', 'ol', 'li', 'form', 'fieldset', 'figure', 'details', 'summary', 'body',
]);

export function isIgnoredTag(tag) {
  return IGNORED_TAGS.has(tag);
}

/**
 * Page chrome that must never end up in a template: WP admin bar, debug
 * toolbars, our own picker overlay. Matched by element id.
 */
const NOISE_IDS = new Set([
  'wpadminbar', 'query-monitor-main', 'qm-fatal', 'wp-toolbar',
  'cookie-law-info-bar', 'wpfront-scroll-top-container',
]);

/** Should the element be skipped entirely (with a stat bump)? */
export function shouldSkipElement(el, style) {
  const tag = el.tagName.toLowerCase();
  if (isIgnoredTag(tag)) return true;
  if (el.id && NOISE_IDS.has(el.id)) return true;
  if (el.hasAttribute('data-ef-picker')) return true;
  // PHP notices printed into the page by Xdebug.
  if (el.classList.contains('xdebug-error')) return true;
  // Accessibility-only elements (visually clipped off-screen).
  const cl = el.classList;
  if (cl.contains('screen-reader-text') || cl.contains('sr-only') ||
      cl.contains('visually-hidden') || cl.contains('skip-link') ||
      cl.contains('elementor-screen-only')) return true;
  if (style.display === 'none') {
    // Elementor responsive visibility: an element hidden only on desktop is
    // the tablet/mobile variant of a section (mobile header, mobile menu) and
    // must be kept — it exports with `hide_desktop`. Closed panels of nested
    // widgets (mega-menu dropdowns, inactive tabs, carousel slides) are
    // hidden by interaction state and are part of the design too.
    return !isResponsivelyHidden(el) && !isNestedPanel(el);
  }
  // Entrance animations keep content `visibility:hidden` until it scrolls
  // into view (Elementor's .elementor-invisible, WOW/AOS, animation plugins).
  // That is a transient state, not a design decision.
  if (style.visibility === 'hidden' && !isAnimationPending(el)) return true;
  // Decorative/measurement helpers that render nothing.
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0 && !el.childElementCount && !el.textContent?.trim()) {
    return true;
  }
  return false;
}

const ANIMATION_PENDING_SELECTOR =
  '.elementor-invisible, .wow, [data-aos], [data-animentor], .animentor-el, [data-sal], [data-scroll], .animate__animated';

/** Hidden only until a scroll/entrance animation runs (self or an ancestor). */
function isAnimationPending(el) {
  // Elementor-native elements are never hidden by design via visibility.
  if (el.hasAttribute('data-element_type')) return true;
  return !!el.closest?.(ANIMATION_PENDING_SELECTOR);
}

/** A native container living inside a (nested) Elementor widget. */
function isNestedPanel(el) {
  return el.getAttribute('data-element_type') === 'container' && !!el.parentElement?.closest('[data-widget_type]');
}

/** Hidden on the current (desktop) viewport by Elementor's responsive classes only. */
export function isResponsivelyHidden(el) {
  return el.classList.contains('elementor-hidden-desktop') && el.hasAttribute('data-element_type');
}

/**
 * Classify an element as container vs widget.
 * Containers structure layout; widgets carry content. An element with mixed
 * inline content and a single semantic purpose leans widget.
 */
export function classifyRole(el, style) {
  const tag = el.tagName.toLowerCase();

  // Elementor structure is authoritative: a native container stays a
  // container even when its children happen to look like rich text.
  const elType = el.getAttribute('data-element_type');
  if (elType && elType !== 'widget' && (el.classList.contains('e-con') || /^(container|section|column|e-)/.test(elType))) {
    return NODE_ROLES.CONTAINER;
  }

  if (WIDGETISH_TAGS.has(tag)) return NODE_ROLES.WIDGET;
  if (tag === 'a') {
    // Links wrapping block structure are containers; standalone links are widgets (button/text).
    return el.childElementCount > 1 || hasBlockChildren(el) ? NODE_ROLES.CONTAINER : NODE_ROLES.WIDGET;
  }
  if (tag === 'span' || tag === 'strong' || tag === 'em' || tag === 'label' || tag === 'i') {
    return el.childElementCount === 0 ? NODE_ROLES.WIDGET : NODE_ROLES.CONTAINER;
  }
  if (STRUCTURAL_TAGS.has(tag)) {
    // A structural tag with no element children but real text is effectively a text widget.
    if (el.childElementCount === 0) {
      return el.textContent?.trim() ? NODE_ROLES.WIDGET : NODE_ROLES.CONTAINER;
    }
    // A div containing only inline text markup (b/i/span/br/a-inline) reads as one rich-text widget.
    if (isRichTextBlock(el)) return NODE_ROLES.WIDGET;
    return NODE_ROLES.CONTAINER;
  }
  return el.childElementCount > 0 ? NODE_ROLES.CONTAINER : NODE_ROLES.WIDGET;
}

const INLINE_TEXT_TAGS = new Set(['span', 'strong', 'em', 'b', 'i', 'u', 's', 'br', 'a', 'small', 'sub', 'sup', 'mark', 'abbr', 'code']);

const BLOCK_DESCENDANT_SELECTOR =
  'div,section,article,ul,ol,li,img,picture,figure,h1,h2,h3,h4,h5,h6,form,table,video,iframe,svg,button,header,footer,nav,aside';

export function isRichTextBlock(el) {
  if (!el.childElementCount) return false;
  // A single non-<p> child carrying the text is structure, not rich text:
  // a heading's <span class="elementor-heading-title">, a button's <a>.
  // Absorbing it would lose the child's own typography/padding/link —
  // descend instead so the child becomes its own IR node.
  if (el.childElementCount === 1 && el.children[0].tagName.toLowerCase() !== 'p') return false;
  let texty = 0;
  for (const child of el.children) {
    const t = child.tagName.toLowerCase();
    if (t !== 'p' && !INLINE_TEXT_TAGS.has(t)) return false;
    // An inline-looking child (an <a> wrapping a whole card, a <span> with a
    // grid inside) disqualifies the block: it is structure, not rich text.
    if (child.childElementCount && child.querySelector(BLOCK_DESCENDANT_SELECTOR)) return false;
    texty++;
  }
  return texty > 0 && (el.textContent?.trim().length ?? 0) > 0;
}

function hasBlockChildren(el) {
  for (const child of el.children) {
    const t = child.tagName.toLowerCase();
    if (!INLINE_TEXT_TAGS.has(t)) return true;
  }
  return false;
}

/** Best-effort semantic kind for nicer labels, mapping hints and AI features. */
export function detectSemanticKind(el, style, depth) {
  const tag = el.tagName.toLowerCase();
  const cls = (el.className && typeof el.className === 'string') ? el.className.toLowerCase() : '';
  const id = (el.id || '').toLowerCase();
  const idCls = `${id} ${cls}`;

  if (tag === 'header' || /(^|[\s_-])(site-?header|masthead|topbar)([\s_-]|$)/.test(idCls)) return 'header';
  if (tag === 'footer' || /(^|[\s_-])(site-?footer|colophon)([\s_-]|$)/.test(idCls)) return 'footer';
  if (tag === 'nav' || el.getAttribute('role') === 'navigation' || /\b(nav|menu)\b/.test(idCls)) return 'nav';
  if (tag === 'aside') return 'sidebar';
  if (tag === 'form') return 'form';
  if (/\b(hero|banner|jumbotron|masthead)\b/.test(idCls) && depth <= 4) return 'hero';
  if (/\b(card|tile|box)\b/.test(idCls)) return 'card';
  if (/\b(gallery|grid|portfolio)\b/.test(idCls)) return 'gallery';
  if (/\b(slider|carousel|swiper|slick)\b/.test(idCls)) return 'slider';
  if (/\b(testimonial|review)\b/.test(idCls)) return 'testimonial';
  if (/\b(pricing|price-table|plan)\b/.test(idCls)) return 'pricing';
  if (/\b(accordion|collapse)\b/.test(idCls)) return 'accordion';
  if (/\b(tabs?|tab-content)\b/.test(idCls)) return 'tabs';
  if (/\b(modal|popup|dialog|lightbox)\b/.test(idCls) || el.getAttribute('role') === 'dialog') return 'popup';
  if (/\b(breadcrumbs?)\b/.test(idCls)) return 'breadcrumbs';
  if (/\b(woocommerce|product|cart|checkout|shop)\b/.test(idCls)) return 'woocommerce';
  if (/\bmega-?menu\b/.test(idCls)) return 'mega-menu';
  if (tag === 'section' || (tag === 'div' && depth <= 2 && style.display !== 'inline')) return 'section';
  return null;
}

/**
 * Signature of an element for pattern detection: tag + sorted class tokens
 * (ignoring obviously unique tokens) + child tag shape.
 */
export function structuralSignature(el) {
  const tag = el.tagName.toLowerCase();
  const classes = classTokens(el).filter((c) => !/\d{3,}|^(post|item|product)-\d+$/.test(c)).sort().slice(0, 6);
  const childShape = Array.from(el.children, (c) => c.tagName.toLowerCase()).slice(0, 8).join(',');
  return `${tag}|${classes.join('.')}|${childShape}`;
}

export function classTokens(el) {
  const raw = typeof el.className === 'string' ? el.className : (el.getAttribute?.('class') || '');
  return raw.split(/\s+/).filter(Boolean);
}

/**
 * Framework/builder-generated classes carry no design intent of their own —
 * dropping them leaves the page's *custom* classes (e.g. `nias-pop-animation`,
 * `ns-button`), which the page's custom CSS targets. Those must be preserved
 * as Elementor `_css_classes` or that CSS goes dead after import.
 */
const FRAMEWORK_CLASS = [
  /^elementor(-|$)/, /^e-/, /^swiper(-|$)/, /^wp-/, /^has-/, /^is-/, /^js-/,
  /^animated$/, /^animation-/, /^ast-/, /^wc-/, /^woocommerce/, /^menu-item/,
  /^page-/, /^post-\d/, /^attachment-/, /^size-/, /^align(none|left|right|center)$/,
  /^current[-_]/, /^sub-menu$/, /^children$/, /^lazyload(ed|ing)?$/,
  /^(row|col|col-\d|d-flex|d-block|container|container-fluid)$/,
  // Added at render time by animation plugins, not authored.
  /^animentor-/, /^aos-/, /^wow$/, /^sal-/,
];

export function customClassTokens(el) {
  return classTokens(el).filter((c) => !FRAMEWORK_CLASS.some((re) => re.test(c)));
}

/**
 * Detect repeating siblings (>= minRepeat identical signatures) — these are
 * loop-grid / carousel / list candidates.
 * @returns {Map<Element, string>} element -> patternKey
 */
export function detectRepeatingPatterns(parentEl, minRepeat = 3) {
  const groups = new Map();
  for (const child of parentEl.children) {
    const sig = structuralSignature(child);
    if (!groups.has(sig)) groups.set(sig, []);
    groups.get(sig).push(child);
  }
  const result = new Map();
  let i = 0;
  for (const [sig, members] of groups) {
    if (members.length >= minRepeat && members[0].childElementCount > 0) {
      const key = `pat-${hash(sig)}-${i++}`;
      for (const m of members) result.set(m, key);
    }
  }
  return result;
}

function hash(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

/** Read flex/grid layout facts from a computed style. */
export function readLayout(style) {
  const display = style.display;
  const isFlex = display.includes('flex');
  const isGrid = display.includes('grid');
  if (!isFlex && !isGrid && display !== 'block' && display !== 'inline-block') return { display };

  const layout = { display };
  if (isFlex) {
    layout.direction = style.flexDirection || 'row';
    layout.wrap = style.flexWrap || 'nowrap';
    layout.justify = style.justifyContent;
    layout.align = style.alignItems;
    layout.gap = { row: style.rowGap, column: style.columnGap };
  } else if (isGrid) {
    const cols = style.gridTemplateColumns?.split(' ').filter(Boolean) ?? [];
    layout.columns = cols.length || 1;
    layout.gap = { row: style.rowGap, column: style.columnGap };
    layout.justify = style.justifyItems;
    layout.align = style.alignItems;
  }
  return layout;
}

/** Detect Elementor source markup for high-fidelity passthrough mapping. */
export function detectElementorNative(el) {
  const elType = el.getAttribute('data-element_type');
  // Atomic (V4) elements render `data-element_type="e-flexbox"`; atomic
  // widgets render no wrapper at all and are recognised by base classes.
  if (!elType || /^e-/.test(elType)) return detectAtomic(el);
  const native = { elType };
  const widgetType = el.getAttribute('data-widget_type');
  if (widgetType) {
    // "loop-carousel.product" = widget "loop-carousel" with skin "product".
    const [base, skin] = widgetType.split('.');
    native.widgetType = base;
    if (skin && skin !== 'default') native.skin = skin;
  }
  const settings = el.getAttribute('data-settings');
  if (settings) {
    try { native.settings = JSON.parse(settings); } catch { /* malformed, ignore */ }
  }
  const modelCid = el.getAttribute('data-id');
  if (modelCid) native.sourceId = modelCid;
  return native;
}
