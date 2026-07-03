/**
 * Widget content hoisting.
 *
 * Real pages (and especially Elementor-built pages, where data-widget_type
 * lives on a wrapper div) put a widget's content and text styling on
 * DESCENDANTS of the node that maps to the widget:
 *
 *     div[data-widget_type="heading.default"]   <- maps to "heading"
 *       └─ div.elementor-widget-container
 *            └─ h2.elementor-heading-title      <- text + typography live here
 *
 * Since Elementor widgets cannot carry child elements, the wrapper must
 * absorb the primary descendant's content and the style settings that belong
 * to the widget (typography/color from text descendants, box styles from
 * button/image descendants). Runs post-order so nested composites (icon-box
 * containing a heading wrapper) hoist bottom-up.
 *
 * Pure IR — used by the mapping engine after the mapping pass, and by the
 * builder store when the user re-maps a node.
 */

import { DEVICE_ORDER, EL_TYPES } from '../../common/constants.js';

const HEADING_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

/** Hoist the whole tree (post-order). @returns {number} nodes hoisted */
export function hoistAll(root) {
  let count = 0;
  (function rec(node) {
    for (const child of node.children ?? []) rec(child);
    if (hoistWidgetContent(node)) count++;
  })(root);
  return count;
}

/** Hoist a single widget-mapped node from its descendants. @returns {boolean} changed */
export function hoistWidgetContent(node) {
  if (node.mapping?.elType !== EL_TYPES.WIDGET || !node.children?.length) return false;
  const wt = node.mapping.widgetType;

  switch (wt) {
    case 'image': {
      if (node.content.src) return false;
      const img = firstDescendant(node, (n) => !!n.content.src || n.tag === 'img' || n.tag === 'picture');
      if (!img) return false;
      copyContent(node, img, ['src', 'alt', 'title', 'linkHref']);
      adoptAssets(node, img);
      mergeSettings(node, img, (k) => k === 'border_radius' || k.startsWith('box_shadow') || k === 'opacity');
      return true;
    }

    case 'heading': {
      if (node.content.text) return false;
      const h = firstDescendant(node, (n) => HEADING_TAGS.has(n.tag) || (!!n.content.text && !n.children.length));
      if (!h) return false;
      copyContent(node, h, ['text', 'headerSize']);
      // Elementor heading "HTML tag" follows the real text element: a heading
      // rendered as <span>/<p>/<div> must keep that tag, not default to h2.
      if (!node.content.headerSize) {
        node.content.headerSize = HEADING_TAGS.has(h.tag) ? h.tag
          : (h.tag === 'span' || h.tag === 'p' || h.tag === 'div') ? (h.tag === 'div' ? 'div' : h.tag)
          : 'h2';
      }
      mergeSettings(node, h, isTextStyleKey);
      return true;
    }

    case 'button': {
      const a = firstDescendant(node, (n) => (n.tag === 'a' || n.tag === 'button') && !!n.content.text);
      if (!a) return false;
      copyContent(node, a, ['text', 'href', 'target', 'isButtonLike']);
      mergeSettings(node, a, (k) => isTextStyleKey(k) || isBoxStyleKey(k));
      return true;
    }

    case 'text-editor': {
      if (node.content.html || node.content.text) return false;
      const t = firstDescendant(node, (n) => !!n.content.html || !!n.content.text);
      if (!t) return false;
      copyContent(node, t, ['html', 'text']);
      mergeSettings(node, t, isTextStyleKey);
      return true;
    }

    case 'icon': {
      if (node.content.svgMarkup || node.assets.length) return false;
      const i = firstDescendant(node, (n) => !!n.content.svgMarkup || n.assets.length > 0);
      if (!i) return false;
      copyContent(node, i, ['svgMarkup', 'linkHref']);
      adoptAssets(node, i);
      mergeSettings(node, i, (k) => k === 'color');
      return true;
    }

    case 'video':
    case 'google_maps': {
      if (node.content.src) return false;
      const v = firstDescendant(node, (n) => (n.tag === 'video' || n.tag === 'iframe') && !!n.content.src);
      if (!v) return false;
      copyContent(node, v, ['src', 'poster', 'videoProvider', 'autoplay', 'loop', 'muted']);
      adoptAssets(node, v);
      return true;
    }

    case 'nav-menu':
    case 'mega-menu': {
      if (node.content.menu?.length) return false;
      const m = firstDescendant(node, (n) => (n.content.menu?.length ?? 0) > 0);
      if (!m) return false;
      copyContent(node, m, ['menu']);
      return true;
    }

    case 'icon-list': {
      if (node.content.listItems?.length) return false;
      const l = firstDescendant(node, (n) => (n.content.listItems?.length ?? 0) > 0);
      if (!l) return false;
      copyContent(node, l, ['listItems']);
      return true;
    }

    case 'form':
    case 'search-form': {
      if (node.content.fields?.length) return false;
      const f = firstDescendant(node, (n) => (n.content.fields?.length ?? 0) > 0);
      if (!f) return false;
      copyContent(node, f, ['fields', 'action', 'method']);
      return true;
    }

    case 'image-carousel':
    case 'image-gallery': {
      if (node.content.images?.length) return false;
      const images = collectImages(node);
      if (!images.length) return false;
      node.content.images = images;
      return true;
    }

    case 'tabs':
    case 'accordion':
    case 'toggle':
    case 'nested-tabs':
    case 'nested-accordion': {
      if (node.content.items?.length) return false;
      const items = collectTitledSections(node);
      if (!items.length) return false;
      node.content.items = items;
      return true;
    }

    case 'counter': {
      if (node.content.counter) return false;
      const numeric = selfOrDescendant(node, (n) => /[\d]/.test(n.content.text || '') && !n.children.length)
        ?? selfOrDescendant(node, (n) => /[\d]/.test(n.content.text || ''));
      const text = numeric?.content.text ?? '';
      const m = /([\d][\d.,\s]*)/.exec(text);
      if (!m) return false;
      const counter = {
        number: parseFloat(m[1].replace(/[,\s]/g, '')) || 0,
        prefix: text.slice(0, m.index).trim(),
        suffix: text.slice(m.index + m[1].length).trim(),
      };
      const title = selfOrDescendant(node, (n) =>
        !!n.content.text && n !== numeric && !/\d/.test(n.content.text));
      if (title) counter.title = title.content.text;
      node.content.counter = counter;
      return true;
    }

    case 'progress': {
      if (node.content.progress) return false;
      const src = selfOrDescendant(node, (n) =>
        /\d{1,3}\s*%/.test(n.content.text || '') || n.attrs?.['aria-valuenow'] !== undefined);
      if (!src) return false;
      const percent = src.attrs?.['aria-valuenow'] !== undefined
        ? parseFloat(src.attrs['aria-valuenow'])
        : parseFloat(/(\d{1,3})\s*%/.exec(src.content.text)[1]);
      if (!Number.isFinite(percent)) return false;
      const title = selfOrDescendant(node, (n) => !!n.content.text && n !== src && !/\d{1,3}\s*%/.test(n.content.text));
      node.content.progress = { percent: Math.min(100, Math.max(0, percent)), title: title?.content.text ?? '' };
      return true;
    }

    case 'star-rating': {
      if (node.content.rating != null) return false;
      // Prefer an explicit numeric rating ("4.5"); fall back to counting star glyphs/icons.
      const numeric = selfOrDescendant(node, (n) => /^[0-5](\.\d)?$/.test((n.content.text || '').trim()));
      if (numeric) { node.content.rating = parseFloat(numeric.content.text); return true; }
      let stars = 0;
      (function count(n) {
        if ((n.tag === 'i' || n.tag === 'svg' || n.tag === 'span') && (n.assets.length || n.content.svgMarkup)) stars++;
        if (/[★⭐]/.test(n.content.text || '')) stars += (n.content.text.match(/[★⭐]/g) || []).length;
        for (const c of n.children ?? []) count(c);
      })(node);
      if (!stars) return false;
      node.content.rating = Math.min(5, stars);
      return true;
    }

    case 'icon-box':
    case 'image-box':
    case 'testimonial':
    case 'call-to-action':
    case 'flip-box':
    case 'price-table':
    case 'alert':
      return hoistComposite(node);

    default: {
      // Unknown/native widget: at least surface a text payload for preview.
      if (node.content.text) return false;
      const t = firstDescendant(node, (n) => !!n.content.text && !n.children.length);
      if (!t) return false;
      node.content.text = t.content.text;
      return true;
    }
  }
}

/**
 * Composite widgets keep a structured `content.composite` payload that the
 * export adapters translate into widget-specific settings.
 */
function hoistComposite(node) {
  if (node.content.composite) return false;
  const heading = firstDescendant(node, (n) => HEADING_TAGS.has(n.tag) && !!n.content.text);
  const text = firstDescendant(node, (n) =>
    (!!n.content.html || !!n.content.text) && !HEADING_TAGS.has(n.tag) && n !== heading && !n.children.length);
  const image = firstDescendant(node, (n) => !!n.content.src || n.tag === 'img');
  const icon = firstDescendant(node, (n) => !!n.content.svgMarkup || (n.assets.length > 0 && (n.tag === 'i' || n.tag === 'span' || n.tag === 'svg')));
  const link = firstDescendant(node, (n) => !!n.content.href);

  const composite = {};
  if (heading) composite.title = heading.content.text;
  if (text) composite.description = text.content.html || text.content.text;
  if (image?.content.src) { composite.imageUrl = image.content.src; composite.imageAlt = image.content.alt ?? ''; adoptAssets(node, image); }
  if (icon) { composite.svgMarkup = icon.content.svgMarkup ?? null; adoptAssets(node, icon); }
  if (link) { composite.href = link.content.href; composite.linkText = link.content.text ?? ''; }
  if (!Object.keys(composite).length) return false;

  node.content.composite = composite;
  if (heading) mergeSettings(node, heading, isTextStyleKey);
  return true;
}

/* ------------------------------------------------------------------ */

/** Like firstDescendant but also tests the node itself. */
function selfOrDescendant(node, pred) {
  return pred(node) ? node : firstDescendant(node, pred);
}

/** All descendant images, document order, deduped by src. */
function collectImages(node) {
  const seen = new Set();
  const images = [];
  (function rec(n) {
    for (const c of n.children ?? []) {
      if (c.hidden) continue;
      const src = c.content.src;
      if (src && !seen.has(src)) {
        seen.add(src);
        images.push({ src, alt: c.content.alt ?? '' });
      }
      rec(c);
    }
  })(node);
  return images.slice(0, 30);
}

/**
 * Group a tabs/accordion-like structure into { title, body } items.
 * Each direct child (or grandchild when a single wrapper intervenes) becomes
 * one item: title from its first heading/summary/button-ish text, body from
 * the first other text/html payload.
 */
function collectTitledSections(node) {
  let groups = (node.children ?? []).filter((c) => !c.hidden);
  if (groups.length === 1 && groups[0].children?.length) {
    groups = groups[0].children.filter((c) => !c.hidden);
  }
  const items = [];
  for (const g of groups) {
    const titleNode = selfOrDescendant(g, (n) =>
      !!n.content.text && (HEADING_TAGS.has(n.tag) || n.tag === 'summary' || n.tag === 'button' || n.tag === 'a'))
      ?? firstDescendant(g, (n) => !!n.content.text && !n.children.length);
    const bodyNode = firstDescendant(g, (n) =>
      n !== titleNode && (!!n.content.html || (!!n.content.text && !n.children.length)));
    if (!titleNode && !bodyNode) continue;
    items.push({
      title: titleNode?.content.text ?? `Item ${items.length + 1}`,
      body: bodyNode?.content.html || bodyNode?.content.text || '',
    });
  }
  // A single "item" is a title+body pair, not a tabbed structure — reject so
  // the mapping falls back to something saner than a one-tab widget.
  return items.length >= 2 ? items : [];
}

/** Shallowest-first (BFS) search through visible descendants. */
function firstDescendant(node, pred) {
  const queue = [...(node.children ?? [])];
  while (queue.length) {
    const n = queue.shift();
    if (!n.hidden) {
      if (pred(n)) return n;
      queue.push(...(n.children ?? []));
    }
  }
  return null;
}

function copyContent(target, source, keys) {
  for (const key of keys) {
    if (source.content[key] !== undefined && target.content[key] === undefined) {
      target.content[key] = source.content[key];
    }
  }
  // Custom classes drive the page's custom CSS; a wrapper widget must keep the
  // ones from the element it absorbed (e.g. `ns-button` on the inner <a>).
  for (const cls of source.customClasses ?? []) {
    if (!target.customClasses.includes(cls)) target.customClasses.push(cls);
  }
  target.content._hoistedFrom = source.id;
}

function adoptAssets(target, source) {
  for (const id of source.assets ?? []) {
    if (!target.assets.includes(id)) target.assets.push(id);
  }
}

/**
 * Merge matching setting keys from the primary descendant into the wrapper.
 * The descendant wins: wrapper values for text styles are inherited noise
 * (a wrapper div "has" a font-size, but the h2's own value is the truth).
 */
function mergeSettings(target, source, keyPred) {
  for (const device of DEVICE_ORDER) {
    const src = source.settings?.[device] ?? {};
    for (const [key, value] of Object.entries(src)) {
      if (keyPred(key)) target.settings[device][key] = value;
    }
  }
}

function isTextStyleKey(k) {
  return k.startsWith('typography_') || k === 'color' || k === 'align';
}

function isBoxStyleKey(k) {
  return k.startsWith('background_') || k.startsWith('border_') || k === 'padding'
    || k.startsWith('box_shadow') || k === 'border_radius';
}
