/**
 * DOM Analysis Engine
 * -------------------
 * Phase 1 of the pipeline. Walks the live DOM from the chosen root and emits
 * the IR tree: hierarchy, container/widget roles, layout relationships,
 * semantic kinds, repeating-pattern detection and Elementor-native metadata.
 *
 * It also records a node-id -> Element map into ctx.scratch so downstream
 * engines (CSS, content, assets, responsive) can revisit the live elements
 * without re-walking the DOM.
 */

import { LIMITS, NODE_ROLES } from '../../common/constants.js';
import { truncate } from '../../common/utils.js';
import { createNode } from '../../core/model.js';
import {
  classifyRole,
  classTokens,
  customClassTokens,
  detectElementorNative,
  detectRepeatingPatterns,
  detectSemanticKind,
  isResponsivelyHidden,
  readLayout,
  shouldSkipElement,
} from './structure-heuristics.js';

export class DomAnalysisEngine {
  static phaseName = 'dom-analysis';

  run(ctx) {
    const { rootElement, snapshot, logger } = ctx;
    const log = logger.child('dom');
    const elementsByNodeId = new Map();
    ctx.scratch.set('elementsByNodeId', elementsByNodeId);

    const stats = snapshot.stats;
    const patternKeys = new Set();
    const usedIds = new Set();

    const build = (el, depth, parentPatternMap) => {
      stats.domNodesSeen++;
      if (stats.nodesExtracted >= LIMITS.MAX_NODES) { stats.nodesSkipped++; return null; }
      if (depth > LIMITS.MAX_DEPTH) { stats.nodesSkipped++; return null; }

      const style = ctx.window.getComputedStyle(el);
      if (el !== rootElement && shouldSkipElement(el, style)) { stats.nodesSkipped++; return null; }

      const tag = el.tagName.toLowerCase();
      const role = el === rootElement ? NODE_ROLES.CONTAINER : classifyRole(el, style);
      const rect = el.getBoundingClientRect();

      const node = createNode({
        tag,
        role,
        classes: classTokens(el).slice(0, 12),
        customClasses: customClassTokens(el).slice(0, 10),
        domPath: domPath(el),
        rect: {
          x: Math.round(rect.x + ctx.window.scrollX),
          y: Math.round(rect.y + ctx.window.scrollY),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        },
        layout: readLayout(style),
      });

      // Curated attributes only — full attribute dumps bloat the snapshot.
      for (const name of ['id', 'role', 'href', 'type', 'aria-label', 'data-tab-index']) {
        const v = el.getAttribute(name);
        if (v) node.attrs[name] = truncate(v, 300);
      }

      node.semantic.kind = detectSemanticKind(el, style, depth);
      node.semantic.elementorNative = detectElementorNative(el);
      // Native elements keep their Elementor id: the id is what post CSS
      // (`.elementor-element-<id>`) and repeater/custom CSS selectors refer
      // to, and re-importing under the same ids keeps them valid. Loop items
      // repeat one template's ids, so only the first occurrence keeps it.
      // Atomic widgets are leaf elements by definition (their markup is the
      // template output: <h3>, <a>, <a><img></a>), never containers.
      if (node.semantic.elementorNative?.atomic && node.semantic.elementorNative.elType === 'widget') {
        node.role = NODE_ROLES.WIDGET;
      }
      if (isResponsivelyHidden(el)) node.hiddenOn = ['desktop'];
      const sourceId = node.semantic.elementorNative?.sourceId;
      if (sourceId && /^[0-9a-z]{6,10}$/i.test(sourceId) && !usedIds.has(sourceId)) node.id = sourceId;
      usedIds.add(node.id);
      const patternKey = parentPatternMap?.get(el) ?? null;
      if (patternKey) {
        node.semantic.isRepeated = true;
        node.semantic.patternKey = patternKey;
        patternKeys.add(patternKey);
      }

      node.label = makeLabel(node, el);
      stats.nodesExtracted++;
      elementsByNodeId.set(node.id, el);

      if (node.role === NODE_ROLES.CONTAINER) {
        const childPatterns = detectRepeatingPatterns(el);
        for (const child of el.childNodes) {
          // Text mixed with elements (`<a><i></i> Label <span>…</span></a>`)
          // has no element of its own; without a node it would vanish.
          const childNode = child.nodeType === 1 ? build(child, depth + 1, childPatterns)
            : child.nodeType === 3 ? textRunNode(child, ctx, node) : null;
          if (childNode) {
            if (child.nodeType === 3) { usedIds.add(childNode.id); stats.nodesExtracted++; }
            node.children.push(childNode);
          }
        }
        // A container that lost all its children to skipping but has text
        // becomes a text widget instead of an empty shell. Only RENDERED
        // text counts: textContent also returns the text of the hidden
        // children that were just skipped (closed search/dropdown panels).
        if (!node.children.length && visibleText(el)) {
          node.role = NODE_ROLES.WIDGET;
        }
      }
      return node;
    };

    snapshot.tree = build(rootElement, 0, null);
    snapshot.stats.patternsDetected = patternKeys.size;

    // Elementor's own structural wrappers (e-con-inner, section container,
    // column widget-wrap, document wrapper) are regenerated by Elementor on
    // render; exported as containers they would nest every layout twice.
    const layoutElements = new Map();
    ctx.scratch.set('layoutElementsByNodeId', layoutElements);
    if (snapshot.tree) flattenStructuralWrappers(snapshot.tree, elementsByNodeId, layoutElements);

    // Collapse pointless single-child wrapper chains (div > div > div…)
    // to keep the Elementor structure shallow and editable.
    // The source-CSS engine needs to know where each collapsed wrapper went:
    // the fonts, colours and variables it declared are inherited by the node
    // that replaced it.
    const collapsedInto = new Map();
    ctx.scratch.set('collapsedInto', collapsedInto);
    if (snapshot.tree) collapseWrappers(snapshot.tree, elementsByNodeId, ctx.window, collapsedInto);

    log.info(`tree built: ${stats.nodesExtracted} nodes, ${stats.nodesSkipped} skipped, ${patternKeys.size} patterns`);
  }
}

const ELEMENTOR_STRUCTURAL_WRAPPER =
  '.e-con-inner, .elementor-container, .elementor-widget-wrap, .elementor-column-wrap, ' +
  '.elementor-section-wrap, .elementor-inner, .elementor[data-elementor-id]';

/** Splice Elementor structural wrapper nodes out, promoting their children. */
function flattenStructuralWrappers(node, elementsByNodeId, layoutElements) {
  const out = [];
  for (const child of node.children) {
    flattenStructuralWrappers(child, elementsByNodeId, layoutElements);
    const el = elementsByNodeId.get(child.id);
    if (child.role === NODE_ROLES.CONTAINER && !child.semantic.elementorNative && el?.matches?.(ELEMENTOR_STRUCTURAL_WRAPPER)) {
      // A boxed container lays its children out on `.e-con-inner`
      // (flex-direction: var(--flex-direction)); the outer box is always a
      // column. Keep the inner box as the container's layout source.
      if (el.matches('.e-con-inner, .elementor-container, .elementor-widget-wrap') && !layoutElements.has(node.id)) {
        layoutElements.set(node.id, el);
        if (child.layout) node.layout = child.layout;
      }
      elementsByNodeId.delete(child.id);
      out.push(...child.children);
    } else {
      out.push(child);
    }
  }
  node.children = out;
}

/** Merge wrapper-only containers into their single child (preserving styles precedence: child wins). */
function collapseWrappers(node, elementsByNodeId, win, collapsedInto) {
  for (let i = 0; i < node.children.length; i++) {
    let child = node.children[i];
    const removed = [];
    while (
      child.role === NODE_ROLES.CONTAINER &&
      child.children.length === 1 &&
      !child.semantic.kind &&
      !child.semantic.elementorNative &&
      isStyleNeutral(child, elementsByNodeId.get(child.id), win)
    ) {
      removed.push(elementsByNodeId.get(child.id));
      elementsByNodeId.delete(child.id);
      child = child.children[0];
      node.children[i] = child;
    }
    for (const el of removed) if (el) collapsedInto?.set(el, child.id);
    collapseWrappers(child, elementsByNodeId, win, collapsedInto);
  }
}

/**
 * True when a wrapper contributes no meaningful visual styling of its own.
 * Collapsing drops the wrapper's styles entirely, so a box that paints
 * (background, border, shadow), spaces (padding, margin), positions, sizes
 * or hides its child must survive — on hand-written sites (Bootstrap rows and
 * columns, cards, dropdown shells) that styling IS the design.
 */
function isStyleNeutral(node, el, win) {
  const l = node.layout || {};
  const flexish = (l.display || '').includes('flex') || (l.display || '').includes('grid');
  // Keep flex/grid wrappers: they carry layout semantics.
  if (flexish) return false;
  if (!el || !win) return true;
  const s = win.getComputedStyle(el);
  if (s.position !== 'static' || s.opacity !== '1' || s.transform !== 'none') return false;
  if (s.backgroundImage !== 'none' || !isTransparent(s.backgroundColor) || s.boxShadow !== 'none') return false;
  if (s.maxWidth !== 'none' || (s.overflow !== 'visible' && s.overflow !== 'clip')) return false;
  for (const side of ['Top', 'Right', 'Bottom', 'Left']) {
    if (parseFloat(s[`padding${side}`]) || parseFloat(s[`margin${side}`])) return false;
    if (s[`border${side}Style`] !== 'none' && parseFloat(s[`border${side}Width`])) return false;
  }
  return true;
}

function isTransparent(color) {
  return color === 'transparent' || /rgba\([^)]*,\s*0\)$/.test(color);
}

/**
 * Text-widget node for a non-blank text run inside a container. It has no
 * element, so the style engines skip it: it inherits typography from its
 * parent node in preview and export, exactly as the bare text does.
 */
function textRunNode(textNode, ctx, parent) {
  const text = textNode.nodeValue.replace(/\s+/g, ' ').trim();
  if (!text) return null;
  const range = ctx.document.createRange();
  range.selectNodeContents(textNode);
  const rect = range.getBoundingClientRect();
  if (!rect.width && !rect.height) return null;
  return createNode({
    tag: 'span',
    role: NODE_ROLES.WIDGET,
    label: `text: ${truncate(text, 32)}`,
    domPath: `${parent.domPath}>#text`,
    rect: {
      x: Math.round(rect.x + ctx.window.scrollX),
      y: Math.round(rect.y + ctx.window.scrollY),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    },
    content: { text },
  });
}

/** Text the element actually renders (excludes display:none descendants). */
function visibleText(el) {
  return (el.innerText ?? el.textContent ?? '').trim();
}

function makeLabel(node, el) {
  const text = el.textContent?.trim();
  // Native elements are badged in the tree UI; the label stays plain text.
  if (node.semantic.elementorNative?.widgetType) return node.semantic.elementorNative.widgetType;
  if (node.semantic.kind) return `${node.semantic.kind} (${node.tag})`;
  if (/^h[1-6]$/.test(node.tag) && text) return `${node.tag}: ${truncate(text, 32)}`;
  if (node.tag === 'img') return `img: ${truncate(el.getAttribute('alt') || el.getAttribute('src')?.split('/').pop() || '', 32)}`;
  if (node.tag === 'a' && text) return `link: ${truncate(text, 32)}`;
  if (node.tag === 'button' && text) return `button: ${truncate(text, 32)}`;
  if (node.role === NODE_ROLES.WIDGET && text) return `${node.tag}: ${truncate(text, 32)}`;
  const cls = node.classes[0] ? `.${node.classes[0]}` : '';
  return `${node.tag}${cls}`;
}

function domPath(el) {
  const parts = [];
  let cur = el;
  let guard = 0;
  while (cur && cur.nodeType === 1 && cur.tagName !== 'HTML' && guard++ < 32) {
    let part = cur.tagName.toLowerCase();
    if (cur.id) { parts.unshift(`${part}#${cur.id}`); break; }
    const parent = cur.parentElement;
    if (parent) {
      const idx = Array.prototype.indexOf.call(parent.children, cur);
      part += `:nth-child(${idx + 1})`;
    }
    parts.unshift(part);
    cur = cur.parentElement;
  }
  return parts.join('>');
}
