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
import { escapeHtml } from '../../common/utils.js';
import { CONTAINERISH_WIDGETS, placeholder, WIDGET_RENDERERS } from './widget-renderers.js';

/** Raw style properties replayed onto preview elements (fidelity allowlist). */
const PREVIEW_PROPS = [
  'display', 'flex-direction', 'flex-wrap', 'justify-content', 'align-items',
  'align-self', 'row-gap', 'column-gap', 'width', 'max-width', 'min-height',
  'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'font-family', 'font-size', 'font-weight', 'font-style', 'line-height',
  'letter-spacing', 'text-transform', 'text-align', 'color',
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
      pageCss: cssRules.join('\n'),
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

    if (mapping.elType === EL_TYPES.CONTAINER) {
      return `<div class="ef-container" data-ef-id="${node.id}">${helpers.renderChildren(node)}</div>`;
    }

    const renderer = WIDGET_RENDERERS[mapping.widgetType];
    let inner;
    if (renderer) {
      try { inner = renderer(node, helpers); } catch { inner = placeholder(mapping.widgetType, 'render error'); }
    } else if (CONTAINERISH_WIDGETS.has(mapping.widgetType)) {
      inner = `<div class="ef-composite"><span class="ef-composite-tag">${escapeHtml(mapping.widgetType)}</span>${helpers.renderChildren(node)}</div>`;
    } else {
      inner = placeholder(mapping.widgetType || 'widget', node.label);
    }
    return `<div class="ef-widget" data-ef-id="${node.id}">${inner}</div>`;
  }

  #emitCss(node, cssRules) {
    const sel = `[data-ef-id="${node.id}"]`;
    const desktop = declBlock(node.styles.desktop);
    if (desktop) cssRules.push(`${sel}{${desktop}}`);
    for (const device of [BREAKPOINTS.TABLET, BREAKPOINTS.MOBILE]) {
      const decls = declBlock(node.styles[device]);
      if (decls) cssRules.push(`@media (max-width:${BREAKPOINT_MAX_WIDTH[device]}px){${sel}{${decls}}}`);
    }
  }
}

function declBlock(raw) {
  if (!raw) return '';
  const parts = [];
  for (const prop of PREVIEW_PROPS) {
    const v = raw[prop];
    if (v === undefined || v === '' || isNoise(prop, v)) continue;
    parts.push(`${prop}:${v}`);
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
.ef-container{position:relative;min-height:4px}
.ef-widget{position:relative}
.ef-selected{outline:2px solid #7c5cff!important;outline-offset:-2px}
[data-ef-id]:hover{outline:1px dashed rgba(124,92,255,.55);outline-offset:-1px;cursor:pointer}
.ef-placeholder{border:1px dashed #b6a8ff;background:#f4f1ff;color:#5a4bb5;border-radius:6px;
  padding:10px 14px;font-size:12px;display:flex;flex-direction:column;gap:2px;margin:2px 0}
.ef-composite{border:1px dashed #cfc6ff;border-radius:6px;padding:6px;position:relative}
.ef-composite-tag{position:absolute;top:-9px;inset-inline-start:8px;background:#7c5cff;color:#fff;
  font-size:10px;padding:1px 6px;border-radius:4px;z-index:2}
.ef-w-button{display:inline-block;padding:10px 22px;background:#5a4bb5;color:#fff;border-radius:4px;
  text-decoration:none;font-size:14px}
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
