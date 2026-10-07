/**
 * Preview renderers — one per widget type. Each returns an HTML string that
 * approximates how Elementor will render the widget, used by the
 * Reconstruction Engine to build the live preview document.
 *
 * Renderers receive (node, helpers) where helpers = { esc, assetUrl, renderChildren }.
 */

import { escapeHtml } from '../../common/utils.js';
import { icon as svgIcon } from '../../ui/shared/icons.js';

export const WIDGET_RENDERERS = {
  heading(node) {
    const native = node.semantic?.elementorNative?.content;
    const tag = safeTag(native?.header_size || node.content.headerSize || 'h2');
    // Elementor titles keep inline markup (multi-colour <span style> runs).
    const inner = native?.title ? inlineHtml(native.title) : escapeHtml(node.content.text || 'Heading');
    return `<${tag} class="ef-w-heading">${inner}</${tag}>`;
  },

  'text-editor'(node) {
    if (node.content.html) return `<div class="ef-w-text">${node.content.html}</div>`;
    return `<div class="ef-w-text"><p>${escapeHtml(node.content.text || '')}</p></div>`;
  },

  image(node, { assetUrl }) {
    const src = node.content.src || assetUrl(node.assets[0]);
    if (!src) return placeholder('Image', 'missing source');
    return `<img class="ef-w-image" src="${escapeHtml(src)}" alt="${escapeHtml(node.content.alt || '')}">`;
  },

  button(node) {
    const text = node.semantic?.elementorNative?.content?.text || node.content.text || 'Click here';
    return `<a class="ef-w-button" href="javascript:void(0)">${escapeHtml(text)}</a>`;
  },

  icon(node, { inlineAsset }) {
    const svg = node.content.svgMarkup || inlineAsset(node.assets[0]);
    if (svg && svg.startsWith('<svg')) {
      // Elementor sizes icons through font-size (svg: 1em); the markup's own
      // width/height attributes are the file's, not the design's.
      const box = svgBox(node);
      const style = box ? ` style="display:inline-block;width:${box.width}px;height:${box.height}px"` : '';
      const sized = box ? fillSvg(svg) : svg;
      return `<span class="ef-w-icon"${style}>${sized}</span>`;
    }
    return `<span class="ef-w-icon ef-icon-fallback">${svgIcon('icon', { size: 24 })}</span>`;
  },

  video(node) {
    if (node.content.src && node.tag === 'video') {
      const poster = node.content.poster ? ` poster="${escapeHtml(node.content.poster)}"` : '';
      return `<video class="ef-w-video" src="${escapeHtml(node.content.src)}"${poster} controls muted></video>`;
    }
    if (node.content.src) {
      return `<div class="ef-w-video ef-embed"><iframe src="${escapeHtml(node.content.src)}" loading="lazy" allowfullscreen></iframe></div>`;
    }
    return placeholder('Video', 'no source');
  },

  google_maps(node) {
    return node.content.src
      ? `<div class="ef-w-video ef-embed"><iframe src="${escapeHtml(node.content.src)}" loading="lazy"></iframe></div>`
      : placeholder('Google Maps', '');
  },

  divider() {
    return '<div class="ef-w-divider"><hr></div>';
  },

  spacer(node) {
    const h = Math.max(8, Math.min(200, node.rect?.height ?? 24));
    return `<div class="ef-w-spacer" style="height:${h}px"></div>`;
  },

  'icon-list'(node) {
    const items = (node.content.listItems ?? []).map((it) =>
      `<li><span class="ef-li-bullet">${svgIcon('ok', { size: 14 })}</span>${escapeHtml(it.text)}</li>`).join('');
    return `<ul class="ef-w-icon-list">${items || '<li>List item</li>'}</ul>`;
  },

  'social-icons'(node) {
    const links = node.children.filter((c) => c.tag === 'a');
    const icons = (links.length ? links : [1, 2, 3]).map(() => `<span class="ef-w-social">${svgIcon('global', { size: 18 })}</span>`).join('');
    return `<div class="ef-w-socials">${icons}</div>`;
  },

  'nav-menu'(node) {
    const items = (node.content.menu ?? []).slice(0, 10).map((it) =>
      `<li>${escapeHtml(it.text)}${it.children?.length ? svgIcon('chevron-down', { size: 12 }) : ''}</li>`).join('');
    return `<nav class="ef-w-nav"><ul>${items || '<li>Menu</li>'}</ul></nav>`;
  },

  form(node) {
    const fields = (node.content.fields ?? []).map((f) => {
      const label = f.label || f.placeholder || f.name || f.type;
      if (f.type === 'textarea') return `<label>${escapeHtml(label)}<textarea disabled placeholder="${escapeHtml(f.placeholder)}"></textarea></label>`;
      if (f.type === 'select') return `<label>${escapeHtml(label)}<select disabled><option>${escapeHtml(f.options?.[0] ?? '')}</option></select></label>`;
      if (f.type === 'checkbox' || f.type === 'radio') return `<label class="ef-inline"><input type="${f.type}" disabled> ${escapeHtml(label)}</label>`;
      return `<label>${escapeHtml(label)}<input type="${escapeHtml(f.type)}" disabled placeholder="${escapeHtml(f.placeholder)}"></label>`;
    }).join('');
    return `<form class="ef-w-form" onsubmit="return false">${fields}<button type="button" class="ef-w-button">Submit</button></form>`;
  },

  html(node) {
    // Untrusted captured markup is *described*, never executed, in preview.
    return placeholder('HTML widget', `${node.tag} — raw markup preserved for export`);
  },

  blockquote(node) {
    return `<blockquote class="ef-w-blockquote">${escapeHtml(node.content.text || '')}</blockquote>`;
  },

  testimonial(node, { renderChildren }) {
    return `<div class="ef-w-card">${renderChildren(node)}</div>`;
  },
};

/** Composite widgets that should render their children inside a frame. */
export const CONTAINERISH_WIDGETS = new Set([
  'icon-box', 'image-box', 'testimonial', 'price-table', 'nested-tabs',
  'nested-accordion', 'nested-carousel', 'loop-grid', 'loop-carousel',
  'image-gallery', 'image-carousel', 'call-to-action', 'flip-box', 'slides',
  'woocommerce-products', 'wc-archive-products', 'posts', 'portfolio',
]);

/** Rendered size of the icon's <svg> (IR rect of the svg descendant or the node). */
function svgBox(node) {
  const queue = [node];
  while (queue.length) {
    const n = queue.shift();
    if (n.tag === 'svg' && n.rect?.width) return { width: n.rect.width, height: n.rect.height };
    queue.push(...(n.children ?? []));
  }
  return node.rect?.width ? { width: node.rect.width, height: node.rect.height } : null;
}

const SAFE_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'div', 'span', 'p']);
function safeTag(tag) {
  return SAFE_TAGS.has(tag) ? tag : 'h2';
}

/** Inline markup only: drops scripts, event handlers and block structure. */
function inlineHtml(html) {
  return String(html)
    .replace(/<(script|style|iframe|object)\b[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/<(?!\/?(span|strong|b|em|i|u|a|br|sup|sub|mark|small)\b)[^>]*>/gi, '');
}

/** Make the root <svg> fill its box (drop the file's own width/height). */
function fillSvg(svg) {
  const end = svg.indexOf('>');
  if (end === -1) return svg;
  const head = svg.slice(0, end).replace(/\s(width|height)="[^"]*"/g, '');
  // Inline style: beats the preview's generic `.ef-w-icon svg` sizing rule.
  return `${head} width="100%" height="100%" style="width:100%;height:100%;font-size:inherit"${svg.slice(end)}`;
}

export function placeholder(label, note) {
  return `<div class="ef-placeholder"><strong>${escapeHtml(label)}</strong>${note ? `<small>${escapeHtml(note)}</small>` : ''}</div>`;
}
