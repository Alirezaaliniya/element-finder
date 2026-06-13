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
      for (const name of ['id', 'role', 'href', 'type', 'aria-label']) {
        const v = el.getAttribute(name);
        if (v) node.attrs[name] = truncate(v, 300);
      }

      node.semantic.kind = detectSemanticKind(el, style, depth);
      node.semantic.elementorNative = detectElementorNative(el);
      const patternKey = parentPatternMap?.get(el) ?? null;
      if (patternKey) {
        node.semantic.isRepeated = true;
        node.semantic.patternKey = patternKey;
        patternKeys.add(patternKey);
      }

      node.label = makeLabel(node, el);
      stats.nodesExtracted++;
      elementsByNodeId.set(node.id, el);

      if (role === NODE_ROLES.CONTAINER) {
        const childPatterns = detectRepeatingPatterns(el);
        for (const child of el.children) {
          const childNode = build(child, depth + 1, childPatterns);
          if (childNode) node.children.push(childNode);
        }
        // A container that lost all its children to skipping but has text
        // becomes a text widget instead of an empty shell.
        if (!node.children.length && el.textContent?.trim()) {
          node.role = NODE_ROLES.WIDGET;
        }
      }
      return node;
    };

    snapshot.tree = build(rootElement, 0, null);
    snapshot.stats.patternsDetected = patternKeys.size;

    // Collapse pointless single-child wrapper chains (div > div > div…)
    // to keep the Elementor structure shallow and editable.
    if (snapshot.tree) collapseWrappers(snapshot.tree, elementsByNodeId);

    log.info(`tree built: ${stats.nodesExtracted} nodes, ${stats.nodesSkipped} skipped, ${patternKeys.size} patterns`);
  }
}

/** Merge wrapper-only containers into their single child (preserving styles precedence: child wins). */
function collapseWrappers(node, elementsByNodeId) {
  for (let i = 0; i < node.children.length; i++) {
    let child = node.children[i];
    while (
      child.role === NODE_ROLES.CONTAINER &&
      child.children.length === 1 &&
      !child.semantic.kind &&
      !child.semantic.elementorNative &&
      isStyleNeutral(child)
    ) {
      elementsByNodeId.delete(child.id);
      child = child.children[0];
      node.children[i] = child;
    }
    collapseWrappers(child, elementsByNodeId);
  }
}

/** True when a wrapper contributes no meaningful visual styling of its own. */
function isStyleNeutral(node) {
  const l = node.layout || {};
  const flexish = (l.display || '').includes('flex') || (l.display || '').includes('grid');
  // Keep flex/grid wrappers: they carry layout semantics.
  return !flexish;
}

function makeLabel(node, el) {
  const text = el.textContent?.trim();
  if (node.semantic.elementorNative?.widgetType) return `⚡ ${node.semantic.elementorNative.widgetType}`;
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
