/**
 * Visual Reconstruction Engine
 * ----------------------------
 * Rebuilds the IR tree as a standalone HTML document that approximates the
 * final Elementor output — used as the builder's live preview (iframe
 * srcdoc) before export. Layout fidelity comes from the captured raw styles;
 * responsive behaviour is reproduced with generated media queries keyed by
 * `data-ef-id`, so the same document previews desktop/tablet/mobile.
 *
 * Every rendered element carries data-ef-id for click-to-select syncing
 * between the preview and the tree/inspector.
 */

import { BREAKPOINT_MAX_WIDTH, BREAKPOINTS, EL_TYPES } from '../../common/constants.js';
import { escapeHtml, findNode } from '../../common/utils.js';
import { CONTAINERISH_WIDGETS, placeholder, WIDGET_RENDERERS } from './widget-renderers.js';
import { classicEquivalent } from '../mapping/widget-catalog.js';

/** Raw style properties replayed onto preview elements (fidelity allowlist). */
const PREVIEW_PROPS = [
  'display', 'position', 'top', 'right', 'bottom', 'left', 'z-index',
  'flex-direction', 'flex-wrap', 'justify-content', 'align-items',
  'align-self', 'order', 'flex-grow', 'row-gap', 'column-gap',
  'grid-template-columns', 'transform',
  'width', 'max-width', 'min-height', 'aspect-ratio', 'overflow',
  'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'font-family', 'font-size', 'font-weight', 'font-style', 'line-height',
  'letter-spacing', 'text-transform', 'text-decoration-line', 'text-align', 'color',
  'background-color', 'background-image', 'background-position',
  'background-repeat', 'background-size',
  'border-top-style', 'border-top-width', 'border-right-width',
  'border-bottom-width', 'border-left-width', 'border-top-color',
  'border-top-left-radius', 'border-top-right-radius',
  'border-bottom-right-radius', 'border-bottom-left-radius',
  'box-shadow', 'opacity', 'object-fit',
];

export class ReconstructionEngine {
  /**
   * Build the reconstruction as parts, for hosts that inject markup into an
   * existing document (the builder's preview iframe — extension CSP forbids
   * the inline scripts a srcdoc document would need).
   * @returns {{bodyHtml: string, pageCss: string, baseCss: string, dir: string, lang: string}}
   */
  buildPreviewParts(snapshot, options = {}) {
    if (!snapshot?.tree) {
      return { bodyHtml: '<p>No extracted tree.</p>', pageCss: '', baseCss: BASE_PREVIEW_CSS, dir: 'ltr', lang: '' };
    }
    const cssRules = [];
    const bodyHtml = this.#renderNode(snapshot.tree, snapshot, cssRules, options);
    return {
      bodyHtml,
      // Order matters: font-faces first, per-node rules, then the page's
      // custom-class CSS so it can override interpreted values like it does
      // on the source page. The final rule brings a picked absolute/fixed
      // element back into flow while keeping it a containing block for its
      // own absolute descendants.
      pageCss: [
        fontFaceCss(snapshot),
        cssRules.join('\n'),
        snapshot.meta.customCss || '',
        'body>[data-ef-id]{position:relative;inset:auto}',
      ].filter(Boolean).join('\n'),
      baseCss: BASE_PREVIEW_CSS,
      dir: snapshot.meta.dir === 'rtl' ? 'rtl' : 'ltr',
      lang: snapshot.meta.lang || '',
    };
  }

  /**
   * Standalone HTML document (HTML Snapshot export). Includes a small inline
   * script for hover/select affordances — fine for a regular file, which has
   * no extension CSP.
   */
  buildPreviewDocument(snapshot, options = {}) {
    const { bodyHtml, pageCss, baseCss, dir, lang } = this.buildPreviewParts(snapshot, options);
    return `<!doctype html>
<html dir="${dir}" lang="${escapeHtml(lang)}">
<head>
<meta charset="utf-8">
<meta name="referrer" content="no-referrer">
<style>
${baseCss}
${pageCss}
</style>
</head>
<body>
${bodyHtml}
</body>
</html>`;
  }

  #renderNode(node, snapshot, cssRules, options) {
    if (!node || node.hidden) return '';
    this.#emitCss(node, cssRules);

    const mapping = node.mapping ?? { elType: EL_TYPES.CONTAINER };
    const helpers = {
      esc: escapeHtml,
      assetUrl: (id) => snapshot.assets.find((a) => a.id === id)?.url ?? null,
      inlineAsset: (id) => snapshot.assets.find((a) => a.id === id)?.inline ?? null,
      renderChildren: (n) => n.children.map((c) => this.#renderNode(c, snapshot, cssRules, options)).join(''),
    };

    // Custom classes make the preserved page custom CSS (meta.customCss)
    // match in the preview, exactly as it will after import.
    const customClasses = (node.customClasses ?? []).join(' ');
    const cls = (base) => customClasses ? `${base} ${escapeHtml(customClasses)}` : base;

    if (mapping.elType === EL_TYPES.CONTAINER) {
      return `<div class="${cls('ef-container')}" data-ef-id="${node.id}">${helpers.renderChildren(node)}</div>`;
    }

    // Atomic (V4) widgets preview through their classic equivalent.
    const renderer = WIDGET_RENDERERS[mapping.widgetType] ?? WIDGET_RENDERERS[classicEquivalent(mapping.widgetType)];
    const isNative = !!node.semantic?.elementorNative && mapping.source === 'elementor-native';
    let inner;
    if (renderer) {
      try { inner = renderer(node, helpers); } catch { inner = placeholder(mapping.widgetType, 'render error'); }
      // The widget's real styling usually lives on the hoisted descendant
      // (h2/a/p under the wrapper) whose markup the renderer replaced —
      // replay that node's styles onto the rendered inner element.
      this.#emitHoistedCss(node, cssRules);
    } else if (CONTAINERISH_WIDGETS.has(mapping.widgetType) && !isNative) {
      // Heuristically composed widget: framed and tagged so the user can
      // see what the extractor grouped. Native widgets render as the source.
      inner = `<div class="ef-composite"><span class="ef-composite-tag">${escapeHtml(mapping.widgetType)}</span>${helpers.renderChildren(node)}</div>`;
    } else if (node.children?.some((c) => !c.hidden)) {
      // No dedicated renderer (theme-builder, WooCommerce, third-party
      // widgets): the extracted subtree IS the rendered widget — show it
      // rather than a placeholder box.
      inner = `<div class="ef-native-render">${helpers.renderChildren(node)}</div>`;
    } else if (node.content?.src) {
      inner = `<img class="ef-w-image" src="${escapeHtml(node.content.src)}" alt="${escapeHtml(node.content.alt || '')}">`;
    } else if (node.content?.html || node.content?.text) {
      inner = `<div class="ef-w-text">${node.content.html ?? escapeHtml(node.content.text)}</div>`;
    } else if (isNative) {
      // A native widget with no content renders nothing on the source page
      // either (an empty shortcode, a hidden notice) — keep it invisible.
      inner = '';
    } else {
      inner = placeholder(mapping.widgetType || 'widget', node.label);
    }
    return `<div class="${cls('ef-widget')}" data-ef-id="${node.id}">${inner}</div>`;
  }

  #emitCss(node, cssRules) {
    this.#emitCssFor(`[data-ef-id="${node.id}"]`, node.styles, cssRules);
    // Elementor responsive visibility: kept for tablet/mobile, but hidden on
    // desktop widths exactly like `elementor-hidden-desktop` on the source.
    if (node.autoCentered) cssRules.push(`[data-ef-id="${node.id}"]{margin-left:auto;margin-right:auto}`);
    if (node.hiddenOn?.includes('desktop')) {
      cssRules.push(`@media (min-width:${BREAKPOINT_MAX_WIDTH[BREAKPOINTS.TABLET] + 1}px){[data-ef-id="${node.id}"]{display:none!important}}`);
    }
  }

  /**
   * Widget renderers replace the wrapper's descendants with generated markup,
   * so the styles captured on the hoisted source node (`content._hoistedFrom`)
   * would never reach the preview. Replay them on the rendered inner element
   * (`> *` — every renderer emits a single root). When hoisting bailed out
   * (wrapper already had content), locate the styled descendant by widget
   * semantics instead — its styles exist in the tree but its markup was
   * replaced, so without this they'd be lost.
   */
  #emitHoistedCss(node, cssRules) {
    const srcId = node.content?._hoistedFrom;
    let src = srcId ? findNode(node, srcId) : null;
    if (!src) src = findStyleSource(node);
    if (!src || src === node) return;
    this.#emitCssFor(`[data-ef-id="${node.id}"]>*`, src.styles, cssRules, HOISTED_SKIP_PROPS);
  }

  #emitCssFor(sel, styles, cssRules, skip) {
    const desktop = declBlock(styles?.desktop, skip);
    if (desktop) cssRules.push(`${sel}{${desktop}}`);
    for (const device of [BREAKPOINTS.TABLET, BREAKPOINTS.MOBILE]) {
      const decls = declBlock(styles?.[device], skip);
      if (decls) cssRules.push(`@media (max-width:${BREAKPOINT_MAX_WIDTH[device]}px){${sel}{${decls}}}`);
    }
  }
}

const HEADINGISH = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

/** Which descendant carries a widget's real styling, per widget type. */
const STYLE_SOURCE_PICKERS = {
  heading: (n) => (HEADINGISH.has(n.tag) || (!!n.content?.text && !n.children?.length)),
  button: (n) => n.tag === 'a' || n.tag === 'button',
  'text-editor': (n) => !!n.content?.html || !!n.content?.text,
  icon: (n) => n.tag === 'svg' || n.tag === 'i' || !!n.content?.svgMarkup,
  image: (n) => n.tag === 'img' || n.tag === 'picture',
  blockquote: (n) => !!n.content?.text,
};

/** Shallowest descendant matching the widget's style-source picker. */
function findStyleSource(node) {
  const type = node.mapping?.widgetType;
  const picker = STYLE_SOURCE_PICKERS[type] ?? STYLE_SOURCE_PICKERS[classicEquivalent(type)];
  if (!picker) return null;
  const queue = [...(node.children ?? [])];
  while (queue.length) {
    const n = queue.shift();
    if (n.hidden) continue;
    if (picker(n)) return n;
    queue.push(...(n.children ?? []));
  }
  return null;
}

/**
 * Layout placement belongs to the wrapper; replaying the source's
 * position/size on the inner element would double-apply it.
 */
const HOISTED_SKIP_PROPS = new Set([
  'position', 'top', 'right', 'bottom', 'left', 'z-index',
  'width', 'max-width', 'min-height', 'align-self', 'order', 'flex-grow',
  'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
]);

/** @font-face rules for the web fonts the asset engine catalogued, so the
 *  preview renders text with the source page's real fonts. */
function fontFaceCss(snapshot) {
  const faces = [];
  for (const a of snapshot.assets ?? []) {
    if (a.type !== 'font' || !a.url || !a.meta?.family) continue;
    faces.push(
      `@font-face{font-family:"${a.meta.family.replace(/"/g, '')}";` +
      `src:url("${a.url}");font-weight:${a.meta.weight || 'normal'};` +
      `font-style:${a.meta.style || 'normal'};font-display:swap}`,
    );
  }
  return faces.join('\n');
}

function declBlock(raw, skip) {
  if (!raw) return '';
  const parts = [];
  for (const prop of PREVIEW_PROPS) {
    if (skip?.has(prop)) continue;
    const v = raw[prop];
    if (v === undefined || v === '' || isNoise(prop, v)) continue;
    // `1fr` tracks floor at their content's min-content width (a 386px
    // image), so a narrower preview overflows; let tracks shrink like the
    // source's do at its own widths.
    if (prop === 'grid-template-columns' && !v.includes('minmax')) {
      parts.push(`${prop}:${v.replace(/(\d*\.?\d+)fr/g, 'minmax(0,$1fr)')}`);
      continue;
    }
    parts.push(`${prop}:${v}`);
  }
  // Out-of-flow boxes have no content-driven height in the rebuilt document —
  // replay the captured one (in-flow elements must NOT get it, it would
  // freeze the layout).
  if ((raw.position === 'absolute' || raw.position === 'fixed') && raw.height && !skip?.has('position')) {
    parts.push(`height:${raw.height}`);
  }
  return parts.join(';');
}

/** Skip default values that only add noise to the generated stylesheet. */
function isNoise(prop, value) {
  if (value === 'none' && prop !== 'display') return true;
  if (value === 'normal' || value === 'auto') return true;
  if (prop.startsWith('margin') && value === '0px') return true;
  if (prop.startsWith('padding') && value === '0px') return true;
  if (prop.includes('radius') && value === '0px') return true;
  if (prop === 'background-color' && value === 'rgba(0, 0, 0, 0)') return true;
  if (prop === 'opacity' && value === '1') return true;
  if (prop === 'width' && value.endsWith('px') && parseFloat(value) > 1200) return true; // viewport-derived
  return false;
}

const BASE_PREVIEW_CSS = `
*,*::before,*::after{box-sizing:border-box}
body{margin:0;font-family:system-ui,sans-serif;line-height:1.5}
img,video,iframe{max-width:100%}
/* No forced position:relative here — an absolute element anchors to its
   NEAREST positioned ancestor, and in the source that is often a distant
   section, not the direct parent. The replayed per-node styles carry the
   real position values, so forcing one on every box would hijack the
   containing block and misplace every absolutely-positioned element. */
.ef-container{min-height:4px}
.ef-selected{outline:2px solid #7c5cff!important;outline-offset:-2px}
[data-ef-id]:hover{outline:1px dashed rgba(124,92,255,.55);outline-offset:-1px;cursor:pointer}
.ef-placeholder{border:1px dashed #b6a8ff;background:#f4f1ff;color:#5a4bb5;border-radius:6px;
  padding:10px 14px;font-size:12px;display:flex;flex-direction:column;gap:2px;margin:2px 0}
.ef-composite{border:1px dashed #cfc6ff;border-radius:6px;padding:6px;position:relative}
.ef-composite-tag{position:absolute;top:-9px;inset-inline-start:8px;background:#7c5cff;color:#fff;
  font-size:10px;padding:1px 6px;border-radius:4px;z-index:2}
/* Neutralize UA/user-agent typography on rendered widget internals: the real
   values sit on the widget wrapper (direct-mapped nodes) or come from the
   hoisted >* rules (wrapped nodes) — UA h1-h6 sizing/margins and any styled
   defaults here would override the inherited truth and skew font sizes. */
.ef-w-heading{margin:0;font:inherit;color:inherit}
.ef-w-text>:first-child{margin-top:0}
.ef-w-text>:last-child{margin-bottom:0}
.ef-w-button{display:inline-block;padding:0;background:none;border:0;color:inherit;
  font:inherit;text-decoration:none;cursor:pointer}
.ef-w-divider hr{border:none;border-top:1px solid #999;margin:8px 0}
.ef-w-icon svg{width:1em;height:1em;font-size:24px}
.ef-icon-fallback{font-size:22px;color:#7c5cff}
.ef-w-icon-list{list-style:none;padding:0;margin:0}
.ef-w-icon-list li{display:flex;gap:8px;align-items:center;padding:3px 0}
.ef-li-bullet{font-size:8px;color:#7c5cff}
.ef-w-nav ul{list-style:none;display:flex;gap:18px;padding:0;margin:0;flex-wrap:wrap}
.ef-w-socials{display:flex;gap:10px;font-size:22px;color:#5a4bb5}
.ef-w-form{display:flex;flex-direction:column;gap:10px;max-width:480px}
.ef-w-form label{display:flex;flex-direction:column;gap:4px;font-size:13px}
.ef-w-form label.ef-inline{flex-direction:row;align-items:center}
.ef-w-form input,.ef-w-form textarea,.ef-w-form select{padding:8px;border:1px solid #ccc;border-radius:4px}
.ef-embed{position:relative;aspect-ratio:16/9}
.ef-embed iframe{position:absolute;inset:0;width:100%;height:100%;border:0}
.ef-w-card{border:1px solid #e3e0f0;border-radius:8px;padding:14px}
.ef-w-blockquote{border-inline-start:3px solid #7c5cff;margin:0;padding:6px 14px;font-style:italic}
`;
