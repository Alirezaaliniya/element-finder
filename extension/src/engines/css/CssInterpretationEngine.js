/**
 * CSS Interpretation Engine
 * -------------------------
 * Phase 3. For every IR node it captures a curated subset of the element's
 * computed style (desktop baseline) and converts it into Elementor-compatible
 * settings via the pure converters module.
 *
 * Capturing *every* computed property would bloat snapshots and produce
 * noisy exports, so CAPTURED_PROPS is the deliberate, reviewed allowlist.
 * The same converter path is reused by the Responsive Analysis Engine for
 * tablet/mobile overrides, guaranteeing consistent interpretation per device.
 */

import { NODE_ROLES } from '../../common/constants.js';
import { walkTree } from '../../common/utils.js';
import { StylesheetIndex } from '../responsive/StylesheetIndex.js';
import { declarationsToSettings } from './converters.js';
import { containsVar, resolveCssVars, resolveElementorGlobals } from './var-resolver.js';

export const CAPTURED_PROPS = [
  'display', 'position', 'top', 'right', 'bottom', 'left', 'z-index',
  'width', 'max-width', 'height', 'min-height',
  'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'font-family', 'font-size', 'font-weight', 'font-style', 'line-height',
  'letter-spacing', 'text-transform', 'text-decoration-line', 'text-align',
  'color',
  'background-color', 'background-image', 'background-position',
  'background-repeat', 'background-size', 'background-attachment',
  'border-top-style', 'border-top-width', 'border-right-width',
  'border-bottom-width', 'border-left-width', 'border-top-color',
  'border-top-left-radius', 'border-top-right-radius',
  'border-bottom-right-radius', 'border-bottom-left-radius',
  'box-shadow', 'opacity', 'overflow',
  'flex-direction', 'flex-wrap', 'justify-content', 'align-items',
  'align-self', 'order', 'flex-grow', 'row-gap', 'column-gap',
  'grid-template-columns',
  'object-fit', 'aspect-ratio',
  // Elementor custom properties preserve authored (unresolved) values that
  // computed longhands lose — e.g. `--width: 47%` becomes px in `width`.
  '--width', '--content-width', '--min-height', '--e-con-grid-template-columns',
];

/**
 * Inheritable properties are only captured when they DIFFER from the DOM
 * parent's computed value. Computed style reports a font-size/color for
 * every element; without this filter each image, button and container
 * exports the page's inherited body typography as if it were widget styling
 * (verified against a real Elementor export of the same region).
 */
const INHERITED_PROPS = new Set([
  'font-family', 'font-size', 'font-weight', 'font-style', 'line-height',
  'letter-spacing', 'text-transform', 'text-align', 'color',
  // CSS custom properties inherit by default — Elementor's --width on a
  // container would otherwise be re-read on every descendant and exported as
  // a bogus width. Keep only when the element declares its own value.
  '--width', '--content-width', '--min-height',
]);

export class CssInterpretationEngine {
  static phaseName = 'css-interpretation';

  run(ctx) {
    const { snapshot, window: win, logger } = ctx;
    const log = logger.child('css');
    const elements = ctx.scratch.get('elementsByNodeId');
    if (!elements || !snapshot.tree) return;

    // Built once here, reused by the Responsive Analysis Engine.
    const sheetIndex = new StylesheetIndex(ctx.document).build();
    ctx.scratch.set('stylesheetIndex', sheetIndex);

    const palette = new Map(); // color -> usage count
    const fonts = new Map();   // family -> usage count
    let converted = 0;
    let rescuedBackgrounds = 0;

    // Custom properties inherit, so the body/root computed style answers any
    // page-level variable (Elementor kit globals live on body.elementor-kit-N).
    const rootStyle = win.getComputedStyle(ctx.document.body ?? ctx.document.documentElement);
    const rootLookup = (name) => rootStyle.getPropertyValue(name);

    walkTree(snapshot.tree, (node, parentNode) => {
      const el = elements.get(node.id);
      if (!el) return;
      const style = win.getComputedStyle(el);
      const varLookup = (name) => style.getPropertyValue(name) || rootLookup(name);

      // Inherited-prop filtering must compare against the IR parent, not the
      // DOM parent: skipped wrappers between the two may be where a font/color
      // was declared, and a value filtered against them has no surviving node
      // to carry it. The tree ROOT is compared against nothing — it anchors
      // the inheritance chain for preview and export, so its inherited
      // typography (from <html>/ancestors outside the extraction) is always
      // captured.
      const parentEl = parentNode ? (elements.get(parentNode.id) ?? el.parentElement) : null;
      const parentStyle = parentEl ? win.getComputedStyle(parentEl) : null;
      const raw = {};
      for (const prop of CAPTURED_PROPS) {
        let v = style.getPropertyValue(prop);
        if (!v) continue;
        if (parentStyle && INHERITED_PROPS.has(prop) && parentStyle.getPropertyValue(prop) === v) continue;
        // Computed longhands are var-free, but captured custom properties
        // (--width & co) can still carry var() chains — fold them to values
        // usable on the import target, where the source variables don't exist.
        if (containsVar(v)) v = resolveCssVars(v, varLookup);
        raw[prop] = v;
      }

      // Lazy-loaded backgrounds: Elementor forces background-image to `none`
      // until JS marks the element `.e-lazyloaded`; other lazy libraries park
      // URLs in custom properties or data attributes. Without rescue, every
      // below-the-fold background exports as missing.
      if (!raw['background-image'] || raw['background-image'] === 'none') {
        const lazyVar = style.getPropertyValue('--e-bg-lazyload').trim();
        const dataBg = el.getAttribute?.('data-bg') || el.getAttribute?.('data-background') || el.getAttribute?.('data-bg-url');
        let declared = lazyVar && lazyVar !== 'none' ? lazyVar
          : dataBg ? `url("${dataBg}")`
          : sheetIndex.declaredBackgroundFor(el);
        // Stylesheet-declared values are authored, not computed — they may
        // reference variables (`background-image: var(--hero-bg)`).
        if (declared && containsVar(declared)) declared = resolveCssVars(declared, varLookup);
        if (declared && declared !== 'none' && !containsVar(declared)) {
          raw['background-image'] = declared;
          rescuedBackgrounds++;
        }
      }

      // Auto-centering margins (`margin: 0 auto`) resolve to large symmetric
      // px values in computed style. Elementor centers boxed containers
      // itself, so exporting these adds phantom outer margins — drop them.
      stripAutoMargins(el, win, raw);

      node.styles.desktop = raw;

      // Native Elementor data-settings reference kit globals
      // (`__globals__: { title_color: "globals/colors?id=primary" }`) that do
      // not exist on the import target — replace them with concrete values
      // computed here, while the kit CSS is still loaded.
      if (node.semantic?.elementorNative?.settings) {
        node.semantic.elementorNative.settings =
          resolveElementorGlobals(node.semantic.elementorNative.settings, varLookup);
      }

      const isContainer = node.role === NODE_ROLES.CONTAINER;
      node.settings.desktop = declarationsToSettings(raw, { isContainer });
      converted++;

      collectToken(palette, node.settings.desktop.color);
      collectToken(palette, node.settings.desktop.background_color);
      collectToken(fonts, node.settings.desktop.typography_font_family);
    });

    // Page-wide design tokens, most used first — the seed for a future
    // "promote to Elementor Global" feature.
    snapshot.globals.colors = topEntries(palette, 16);
    snapshot.globals.fonts = topEntries(fonts, 8);

    // Recover page-level custom CSS for the extracted classes. Elementor scopes
    // page custom CSS under a `.elementor-<postId>` / `.elementor-kit-*` prefix
    // in an inline <style>; we keep rules that target custom classes present in
    // the extracted tree so the styling survives import.
    snapshot.meta.customCss = collectCustomCss(ctx.document, snapshot.tree, rootLookup);

    log.info(`interpreted ${converted} nodes, rescued ${rescuedBackgrounds} lazy backgrounds, ${snapshot.globals.colors.length} palette colors, ${snapshot.globals.fonts.length} fonts`);
  }
}

/**
 * Detect and remove auto-centering horizontal margins. An element is
 * auto-centered when its margin box (width + left + right margin) fills the
 * parent's content width and the two margins are symmetric — the exact
 * signature of `margin-inline: auto`. Top/bottom margins are left untouched.
 */
function stripAutoMargins(el, win, raw) {
  const ml = parseFloat(raw['margin-left']);
  const mr = parseFloat(raw['margin-right']);
  if (!Number.isFinite(ml) || !Number.isFinite(mr)) return;
  if (ml < 4 || mr < 4 || Math.abs(ml - mr) > 2) return;
  const parent = el.parentElement;
  if (!parent) return;
  const ps = win.getComputedStyle(parent);
  const parentContent = parent.clientWidth - (parseFloat(ps.paddingLeft) || 0) - (parseFloat(ps.paddingRight) || 0);
  const marginBox = el.getBoundingClientRect().width + ml + mr;
  if (parentContent > 0 && Math.abs(marginBox - parentContent) <= 4) {
    delete raw['margin-left'];
    delete raw['margin-right'];
  }
}

function collectToken(map, value) {
  if (!value || typeof value !== 'string') return;
  map.set(value, (map.get(value) || 0) + 1);
}

const MAX_CUSTOM_CSS = 40 * 1024;

/**
 * Collect inline-<style> rules that target a custom class present in the tree.
 * The class prefix Elementor scopes page custom CSS with (`.elementor-15 `) is
 * stripped so the rules apply inside the imported template. Variable
 * references are folded to page-level computed values (`varLookup`) since the
 * source variables don't exist on the import target.
 */
function collectCustomCss(document, tree, varLookup) {
  const customClasses = new Set();
  walkTree(tree, (n) => { for (const c of n.customClasses ?? []) customClasses.add(c); });
  if (!customClasses.size) return '';

  const chunks = [];
  let size = 0;
  for (const styleEl of document.querySelectorAll('style')) {
    const css = styleEl.textContent || '';
    // Only inline page/kit CSS; skip framework stylesheets injected as <style>.
    if (!/\.elementor-(\d+|kit)/.test(css) && !/--e-/.test(css)) {
      if (![...customClasses].some((c) => css.includes(`.${c}`))) continue;
    }
    for (const rule of splitRules(css)) {
      if (![...customClasses].some((c) => rule.selector.includes(`.${c}`))) continue;
      const selector = rule.selector.replace(/\.elementor-(?:\d+|kit-\d+)\s+/g, '').trim();
      const body = varLookup && containsVar(rule.body)
        ? resolveCssVars(rule.body, varLookup)
        : rule.body;
      const text = `${selector}{${body}}`;
      if (size + text.length > MAX_CUSTOM_CSS) return chunks.join('\n');
      chunks.push(text);
      size += text.length;
    }
  }
  return chunks.join('\n');
}

/** Lightweight top-level rule splitter (selector + body), ignores @-rules' nesting. */
function splitRules(css) {
  const rules = [];
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf('{', i);
    if (open === -1) break;
    const selector = css.slice(i, open).trim();
    // Skip at-rules with nested blocks (@media/@keyframes) to avoid mis-splitting.
    if (selector.startsWith('@')) {
      const close = matchBrace(css, open);
      i = close + 1;
      continue;
    }
    const close = css.indexOf('}', open);
    if (close === -1) break;
    rules.push({ selector, body: css.slice(open + 1, close).trim() });
    i = close + 1;
  }
  return rules;
}

function matchBrace(css, open) {
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}' && --depth === 0) return i;
  }
  return css.length;
}

function topEntries(map, limit) {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([value, count]) => ({ value, count }));
}
