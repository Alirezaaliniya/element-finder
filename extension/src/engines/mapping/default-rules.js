/**
 * Default mapping rules. Each rule:
 *   { id, priority, match(node, helpers) -> confidence 0..1 | 0, widgetType | elType }
 *
 * Rules are evaluated highest-priority-first; the best non-zero confidence
 * wins. They are intentionally data-light (work on the IR, never the DOM) so
 * the same rules run in the builder when the user re-maps a node.
 */

import { EL_TYPES, NODE_ROLES } from '../../common/constants.js';

const HEADINGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

export const DEFAULT_RULES = [
  // ---------- Structure --------------------------------------------------
  {
    id: 'container-flex', priority: 100, elType: EL_TYPES.CONTAINER,
    match: (n) => (n.role === NODE_ROLES.CONTAINER ? ((n.layout?.display || '').includes('flex') || (n.layout?.display || '').includes('grid') ? 0.95 : 0.75) : 0),
  },

  // ---------- Obvious tag widgets ------------------------------------------
  {
    id: 'heading', priority: 95, widgetType: 'heading',
    match: (n) => (HEADINGS.has(n.tag) && n.content.text ? 0.98 : 0),
  },
  {
    id: 'image', priority: 95, widgetType: 'image',
    match: (n) => (n.tag === 'img' || n.tag === 'picture' ? 0.98 : 0),
  },
  {
    id: 'inline-svg-icon', priority: 94, widgetType: 'icon',
    match: (n) => {
      if (n.tag !== 'svg') return 0;
      const small = (n.rect?.width ?? 0) <= 96 && (n.rect?.height ?? 0) <= 96;
      return small ? 0.9 : 0.55; // large svg may be an illustration -> image/html better
    },
  },
  {
    id: 'icon-font', priority: 94, widgetType: 'icon',
    match: (n) => ((n.tag === 'i' || n.tag === 'span') && n.assets.length && !n.content.text && n.children.length === 0 ? 0.92 : 0),
  },
  {
    id: 'video-native', priority: 93, widgetType: 'video',
    match: (n) => (n.tag === 'video' ? 0.95 : 0),
  },
  {
    id: 'video-embed', priority: 93, widgetType: 'video',
    match: (n) => (n.tag === 'iframe' && (n.content.videoProvider === 'youtube' || n.content.videoProvider === 'vimeo') ? 0.95 : 0),
  },
  {
    id: 'google-maps', priority: 93, widgetType: 'google_maps',
    match: (n) => (n.tag === 'iframe' && n.content.videoProvider === 'google-maps' ? 0.95 : 0),
  },
  {
    id: 'divider', priority: 92, widgetType: 'divider',
    match: (n) => (n.tag === 'hr' ? 0.98 : 0),
  },

  // ---------- Interactive ----------------------------------------------------
  {
    id: 'button', priority: 90, widgetType: 'button',
    match: (n) => {
      if (n.tag === 'button' && n.content.text) return 0.95;
      if (n.tag === 'a' && n.content.isButtonLike && n.content.text) return 0.92;
      if (n.tag === 'input' && n.content.isButtonLike) return 0.9;
      return 0;
    },
  },
  {
    id: 'form', priority: 90, widgetType: 'form',
    match: (n) => (n.tag === 'form' && (n.content.fields?.length ?? 0) > 0 ? 0.9 : 0),
  },
  {
    id: 'search-form', priority: 91, widgetType: 'search-form',
    match: (n) => (n.tag === 'form' && (n.content.fields ?? []).some((f) => f.type === 'search' || /search|جستجو|s\b/.test(f.name)) ? 0.92 : 0),
  },
  {
    id: 'nav-menu', priority: 89, widgetType: 'nav-menu',
    match: (n) => ((n.semantic.kind === 'nav' || n.tag === 'nav') && (n.content.menu?.length ?? 0) > 0 ? 0.9 : 0),
  },
  {
    id: 'mega-menu', priority: 90, widgetType: 'mega-menu',
    match: (n) => (n.semantic.kind === 'mega-menu' ? 0.85 : 0),
  },

  // ---------- Composite patterns ------------------------------------------------
  {
    id: 'icon-list', priority: 85, widgetType: 'icon-list',
    match: (n) => {
      if ((n.tag !== 'ul' && n.tag !== 'ol') || !(n.content.listItems?.length >= 2)) return 0;
      return 0.8;
    },
  },
  {
    id: 'social-icons', priority: 86, widgetType: 'social-icons',
    match: (n) => {
      const links = n.children.filter((c) => c.tag === 'a' && /facebook|twitter|x\.com|instagram|linkedin|youtube|telegram|whatsapp|pinterest|tiktok/i.test(c.content.href || ''));
      return links.length >= 2 ? 0.88 : 0;
    },
  },
  {
    id: 'icon-box', priority: 80, widgetType: 'icon-box',
    match: (n) => {
      if (n.role !== NODE_ROLES.CONTAINER || n.children.length < 2 || n.children.length > 4) return 0;
      const hasIcon = n.children.some((c) => c.mappingHint === 'icon' || c.tag === 'svg' || (c.assets.length && (c.tag === 'i' || c.tag === 'span')));
      const hasHeading = n.children.some((c) => HEADINGS.has(c.tag));
      const hasText = n.children.some((c) => c.tag === 'p' || c.content.html);
      return hasIcon && hasHeading && hasText ? 0.7 : 0;
    },
  },
  {
    id: 'image-box', priority: 79, widgetType: 'image-box',
    match: (n) => {
      if (n.role !== NODE_ROLES.CONTAINER || n.children.length < 2 || n.children.length > 4) return 0;
      const hasImg = n.children.some((c) => c.tag === 'img');
      const hasHeading = n.children.some((c) => HEADINGS.has(c.tag));
      return hasImg && hasHeading ? 0.65 : 0;
    },
  },
  {
    id: 'testimonial', priority: 81, widgetType: 'testimonial',
    match: (n) => (n.semantic.kind === 'testimonial' && n.role === NODE_ROLES.CONTAINER ? 0.75 : 0),
  },
  {
    id: 'pricing', priority: 81, widgetType: 'price-table',
    match: (n) => (n.semantic.kind === 'pricing' && n.role === NODE_ROLES.CONTAINER ? 0.7 : 0),
  },
  {
    id: 'tabs', priority: 82, widgetType: 'nested-tabs',
    match: (n) => (n.semantic.kind === 'tabs' && n.role === NODE_ROLES.CONTAINER ? 0.7 : 0),
  },
  {
    id: 'accordion', priority: 82, widgetType: 'nested-accordion',
    match: (n) => (n.semantic.kind === 'accordion' || n.tag === 'details' ? 0.72 : 0),
  },
  {
    id: 'slider-container', priority: 83, widgetType: 'nested-carousel',
    match: (n) => (n.semantic.kind === 'slider' && n.role === NODE_ROLES.CONTAINER ? 0.7 : 0),
  },
  {
    id: 'loop-grid-pattern', priority: 78, widgetType: 'loop-grid',
    match: (n) => {
      if (n.role !== NODE_ROLES.CONTAINER) return 0;
      const repeated = n.children.filter((c) => c.semantic.isRepeated);
      // A container whose children are mostly one repeated pattern is a loop candidate.
      return repeated.length >= 3 && repeated.length >= n.children.length * 0.8 ? 0.6 : 0;
    },
  },
  {
    id: 'image-gallery', priority: 77, widgetType: 'image-gallery',
    match: (n) => {
      if (n.role !== NODE_ROLES.CONTAINER || n.children.length < 3) return 0;
      const images = n.children.filter((c) => c.tag === 'img' || (c.children.length === 1 && c.children[0].tag === 'img'));
      return images.length === n.children.length ? 0.75 : 0;
    },
  },
  {
    id: 'woocommerce-block', priority: 84, widgetType: 'woocommerce-products',
    match: (n) => (n.semantic.kind === 'woocommerce' && n.semantic.isRepeated === false && n.role === NODE_ROLES.CONTAINER && n.children.some((c) => c.semantic.isRepeated) ? 0.6 : 0),
  },
  {
    id: 'blockquote', priority: 75, widgetType: 'blockquote',
    match: (n) => (n.tag === 'blockquote' ? 0.85 : 0),
  },

  // ---------- Text fallbacks ---------------------------------------------------
  {
    id: 'text-editor', priority: 50, widgetType: 'text-editor',
    match: (n) => {
      if (n.role !== NODE_ROLES.WIDGET) return 0;
      if (n.content.html || (n.content.text && (n.tag === 'p' || n.tag === 'div' || n.tag === 'span' || n.tag === 'li' || n.tag === 'label'))) return 0.7;
      return 0;
    },
  },
  {
    id: 'plain-link-text', priority: 49, widgetType: 'text-editor',
    match: (n) => (n.tag === 'a' && n.content.text && !n.content.isButtonLike ? 0.6 : 0),
  },
  {
    id: 'spacer', priority: 40, widgetType: 'spacer',
    match: (n) => (n.role === NODE_ROLES.WIDGET && !n.content.text && !n.assets.length && (n.rect?.height ?? 0) > 8 && (n.rect?.width ?? 0) > 0 && n.children.length === 0 ? 0.4 : 0),
  },
];

/** Elements Elementor cannot represent natively -> html widget with a warning. */
export const UNSUPPORTED_TAGS = new Set(['canvas', 'object', 'embed', 'applet', 'map', 'table', 'dialog']);
