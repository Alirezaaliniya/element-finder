/**
 * Source CSS Engine
 * -----------------
 * Hand-written (non-Elementor) pages: keep the page's REAL stylesheets for
 * the preview, instead of the ~60 computed properties the CSS Interpretation
 * Engine replays. Everything that list cannot carry — ::before/::after,
 * :hover/:focus states, transitions, keyframes, @media variants, UA defaults
 * of the original tags — comes along.
 *
 * The preview document is not the source DOM (wrappers are collapsed, hidden
 * panels skipped, the user can remove nodes), so selectors are not replayed
 * as written. Each one is resolved HERE, against the live page, and rewritten
 * to the elements it matched:
 *
 *   .site-header nav ul > li > a { color:#333 }
 *       ↓ matched the extracted <a> nodes 1f2e3d4, 5a6b7c8
 *   :where([data-ef-id="1f2e3d4"],[data-ef-id="5a6b7c8"]) { color:#333 }
 *
 * `:where()` gives every emitted selector the same (zero) specificity, so the
 * rules are emitted sorted by their ORIGINAL specificity and source order —
 * the browser's cascade then picks the same winner it picked on the source.
 * A selector that is a single compound (`.btn`, `a:hover`, `*`) needs no
 * rewriting: the preview keeps every element's tag and attributes, so it
 * matches exactly the same elements and is emitted as written.
 *
 * Elements inside a leaf node (an <a> with icon + label, an <svg>) are
 * previewed from their own captured markup; each gets a `data-ef-sub` key so
 * rules aimed at them are rewritten the same way.
 *
 * Output: `snapshot.sourceStyles = { css, stats }`, and on every node
 * `node.source = { attrs, html? }` (the element's attributes, and the inner
 * markup of leaves). The Reconstruction Engine renders from those.
 */

import { walkTree } from '../../common/utils.js';
import { collectCssRules } from '../elementor/css-text.js';

/** Inner markup above this size is not kept (the node previews as text). */
const MAX_LEAF_HTML = 256 * 1024;
const MAX_CSS = 4 * 1024 * 1024;

/** User-action state: matched without it, re-applied in the preview. */
const DYNAMIC_PSEUDO = /:(hover|focus-visible|focus-within|focus|active|visited|target)(?![\w-])/g;
/** Pseudo-classes whose result depends on siblings: never emitted as written. */
const STRUCTURAL_PSEUDO = /:(nth-|first-|last-|only-|empty|root|has|scope|host|defined|is|where|not|matches|-webkit-any|-moz-any)/;
const PSEUDO_ELEMENT = /(::?(?:before|after|first-line|first-letter|placeholder|marker|selection|backdrop|file-selector-button|-webkit-[\w-]+|-moz-[\w-]+))$/i;

/** Properties a collapsed wrapper still passes down to the node that replaced it. */
const INHERITED = new Set([
  'color', 'font', 'font-family', 'font-size', 'font-weight', 'font-style', 'font-variant',
  'font-feature-settings', 'font-variation-settings', 'font-stretch', 'line-height',
  'letter-spacing', 'word-spacing', 'text-align', 'text-transform', 'text-indent',
  'text-shadow', 'white-space', 'word-break', 'overflow-wrap', 'word-wrap', 'hyphens',
  'direction', 'visibility', 'cursor', 'list-style', 'list-style-type', 'list-style-position',
  'list-style-image', 'quotes', 'tab-size', '-webkit-font-smoothing', 'text-rendering',
]);

export class SourceCssEngine {
  static phaseName = 'source-css';

  async run(ctx) {
    const { document, snapshot, logger } = ctx;
    const log = logger.child('source-css');
    const elements = ctx.scratch.get('elementsByNodeId');
    if (!elements || !snapshot.tree) return;
    // Elementor pages are reversed exactly by the Elementor Native Engine;
    // their structural wrappers are flattened, which this mapping does not model.
    let native = false;
    walkTree(snapshot.tree, (n) => { if (n.semantic?.elementorNative) native = true; });
    if (native) return;

    const win = ctx.window ?? document.defaultView;
    const baseUrl = document.baseURI;

    // Fetch first: everything after this point is synchronous, so markup
    // capture and selector matching see the same DOM. Scripts rewrite parts
    // of the page all the time (a countdown rebuilds its digits every
    // second); an await in between would match against replaced elements.
    const { rules, keyframes, failed, sheets } = await collectCssRules(document, { fetchText: ctx.options?.fetchText });

    // --- 1. Every element the preview will contain gets a target key ---------
    const keys = new Map();        // Element -> selector of its preview element
    const inheritOnly = new Map(); // Element -> { target, depth } (not rendered)
    const rootEl = elements.get(snapshot.tree.id);
    // The root renders as a <div> when it was <body>; single-compound rules
    // naming `body` must be rewritten rather than replayed as written.
    const renamed = new Set([document.documentElement, document.body]);
    keys.set(document.documentElement, 'html');

    const reveal = [];
    walkTree(snapshot.tree, (node) => {
      const el = liveElement(elements.get(node.id), node, document);
      if (!el) return;
      keys.set(el, `[data-ef-id="${node.id}"]`);
      node.source = { attrs: sourceAttrs(el, baseUrl) };
      if (!node.children.length && el.childNodes.length) {
        const html = leafHtml(el, node.id, keys, baseUrl, document);
        if (html !== null) node.source.html = html;
      }
      // Kept although invisible: waiting for an entrance animation that will
      // never run in the preview. Show it in its final state.
      const cs = win.getComputedStyle(el);
      if (el !== rootEl && (cs.opacity === '0' || cs.visibility === 'hidden')) reveal.push(node.id);
    });

    // Collapsed wrappers and (for a picked element) the root's ancestors are
    // not rendered; what they declare for inheritance moves to their node.
    for (const [el, nodeId] of ctx.scratch.get('collapsedInto') ?? []) {
      inheritOnly.set(el, { target: `[data-ef-id="${nodeId}"]`, depth: depthOf(el) });
    }
    if (rootEl && rootEl !== document.body && rootEl !== document.documentElement) {
      for (let a = rootEl.parentElement; a && a !== document.documentElement; a = a.parentElement) {
        inheritOnly.set(a, { target: keys.get(rootEl), depth: depthOf(a) });
      }
    }

    // --- 2. Resolve every rule against the live page ------------------------
    const present = presentTokens(document);
    const entries = [];
    let invalid = 0;
    for (const rule of rules) {
      let declText = null;
      let inheritText = null;
      for (const selector of rule.selectors) {
        // Most framework CSS names classes this page never uses; skip those
        // without asking the selector engine.
        if (!mayMatch(selector, present)) continue;
        const resolved = resolveSelector(selector, document, keys, inheritOnly, renamed);
        if (resolved === null) { invalid++; continue; }
        const { targets, inherit, pseudoEl } = resolved;
        const spec = specificity(selector);
        if (targets.length) {
          declText ??= declsText(rule.decls, rule.href ?? baseUrl);
          entries.push({ band: 1, depth: 0, spec, order: rule.order, media: rule.media, pseudoEl, targets, text: declText });
        }
        for (const { target, depth } of inherit) {
          inheritText ??= declsText(rule.decls.filter((d) => d.prop.startsWith('--') || INHERITED.has(d.prop)), rule.href ?? baseUrl);
          if (inheritText) entries.push({ band: 0, depth, spec, order: rule.order, media: rule.media, pseudoEl: '', targets: [target], text: inheritText });
        }
      }
    }

    // Cascade order: inherited-from-wrapper values first (outermost first),
    // then direct rules by original specificity, then source order.
    entries.sort((a, b) => a.band - b.band || a.depth - b.depth || a.spec - b.spec || a.order - b.order);
    let css = emit(entries);

    // Keyframes the emitted rules actually run.
    const used = new Set();
    for (const m of css.matchAll(/animation(?:-name)?\s*:([^;}]*)/g)) {
      for (const word of m[1].split(/[\s,]+/)) if (word) used.add(word.replace(/['"]/g, ''));
    }
    const frames = keyframes.filter((k) => used.has(k.name.replace(/['"]/g, '')));
    if (frames.length) css += '\n' + frames.map((k) => (k.media ? `@media ${k.media}{${k.text}}` : k.text)).join('\n');

    if (reveal.length) {
      css += `\n${reveal.map((id) => `[data-ef-id="${id}"]`).join(',')}{opacity:1!important;visibility:visible!important;animation:none!important}`;
    }

    if (css.length > MAX_CSS) {
      log.warn(`source css too large (${css.length} bytes) — preview falls back to interpreted styles`);
      return;
    }
    snapshot.sourceStyles = {
      css,
      stats: { sheets, failedSheets: failed, rules: rules.length, emitted: entries.length, invalidSelectors: invalid, bytes: css.length },
    };
    log.info(`source css: ${rules.length} rules -> ${entries.length} emitted (${Math.round(css.length / 1024)} KB), ${failed.length} sheets unreadable`);
  }
}

/* ------------------------------------------------------------------ *
 * Selector resolution
 * ------------------------------------------------------------------ */

/**
 * @returns {{targets: string[], inherit: Array<{target: string, depth: number}>, pseudoEl: string}|null}
 *          null when the selector is invalid or unsupported here
 */
function resolveSelector(selector, document, keys, inheritOnly, renamed) {
  let base = selector.trim();
  let pseudoEl = '';
  const pe = PSEUDO_ELEMENT.exec(base);
  if (pe) {
    pseudoEl = pe[1].startsWith('::') ? pe[1] : `:${pe[1]}`;
    base = base.slice(0, pe.index);
  }
  if (!base || /(^|[\s>+~(,])$/.test(base)) base += '*';

  const compounds = splitCompounds(base);
  if (!compounds) return null;
  const stateAt = compounds.map((c) => (c.text.match(DYNAMIC_PSEUDO) ?? []).join(''));
  const stateful = stateAt.map((s, i) => (s ? i : -1)).filter((i) => i >= 0);
  const last = compounds.length - 1;
  // Supported states: on the subject, or on ONE ancestor reached through
  // descendant/child combinators only (`li:hover > .sub-menu`).
  if (stateful.length > 1) return null;
  const stateIdx = stateful[0] ?? -1;
  if (stateIdx >= 0 && stateIdx < last && compounds.slice(stateIdx + 1).some((c) => c.combinator === '+' || c.combinator === '~')) return null;

  const strip = (text) => {
    const s = text.replace(DYNAMIC_PSEUDO, '');
    return s === '' ? '*' : s;
  };
  const matchSel = compounds.map((c, i) => `${i ? ` ${c.combinator === ' ' ? '' : c.combinator} ` : ''}${strip(c.text)}`).join('');

  let matched;
  try { matched = document.querySelectorAll(matchSel); } catch { return null; }

  const targets = [];
  const inherit = [];
  const keyed = [];
  for (const el of matched) {
    if (keys.has(el)) keyed.push(el);
    else if (!pseudoEl && stateIdx < 0 && inheritOnly.has(el)) inherit.push(inheritOnly.get(el));
  }
  if (!keyed.length) return { targets, inherit, pseudoEl };

  const plain = base.replace(DYNAMIC_PSEUDO, '');
  const single = compounds.length === 1 && !STRUCTURAL_PSEUDO.test(plain);
  // `*` also matches the preview's own <html>/<body>, as it did on the source.
  if (single && !inherit.length && (plain === '*' || !keyed.some((el) => renamed.has(el)))) {
    // Same tag and attributes in the preview -> same matches; keep as written.
    targets.push(base);
  } else if (stateIdx >= 0 && stateIdx < last) {
    let ancSel = '';
    compounds.slice(0, stateIdx + 1).forEach((c, i) => { ancSel += `${i ? ` ${c.combinator === ' ' ? '' : c.combinator} ` : ''}${strip(c.text)}`; });
    for (const el of keyed) {
      let anc = null;
      try { anc = el.parentElement?.closest(ancSel); } catch { return null; }
      if (anc && keys.has(anc)) targets.push(`${keys.get(anc)}${stateAt[stateIdx]} ${keys.get(el)}`);
    }
  } else {
    const state = stateIdx === last ? stateAt[last] : '';
    for (const el of keyed) targets.push(`${keys.get(el)}${state}`);
  }
  return { targets, inherit, pseudoEl };
}

/** Split a selector into compounds with the combinator that precedes each. */
function splitCompounds(selector) {
  const out = [];
  let cur = '';
  let combinator = ' ';
  let depth = 0;
  let quote = null;
  const push = () => {
    if (cur.trim()) out.push({ text: cur.trim(), combinator });
    cur = '';
  };
  for (let i = 0; i < selector.length; i++) {
    const ch = selector[i];
    if (quote) { cur += ch; if (ch === '\\') cur += selector[++i] ?? ''; else if (ch === quote) quote = null; continue; }
    if (ch === '"' || ch === "'") { quote = ch; cur += ch; continue; }
    if (ch === '(' || ch === '[') depth++;
    if (ch === ')' || ch === ']') depth--;
    if (depth === 0 && (ch === '>' || ch === '+' || ch === '~' || /\s/.test(ch))) {
      if (cur.trim()) { push(); combinator = ' '; }
      if (ch !== ' ' && !/\s/.test(ch)) combinator = ch;
      continue;
    }
    cur += ch;
  }
  push();
  return out.length ? out : null;
}

/** Specificity as one comparable number: ids, classes/attrs/pseudo-classes, types. */
export function specificity(selector) {
  let a = 0; let b = 0; let c = 0;
  let s = selector;
  // Functional pseudo-classes: :where() counts nothing, the others count
  // their most specific argument.
  s = s.replace(/:where\((?:[^()]|\([^()]*\))*\)/g, '');
  s = s.replace(/:(is|not|has|matches|-webkit-any|-moz-any)\(((?:[^()]|\([^()]*\))*)\)/g, (_, _n, args) => {
    const best = Math.max(0, ...args.split(',').map((x) => specificity(x)));
    a += Math.floor(best / 1e6); b += Math.floor(best / 1e3) % 1e3; c += best % 1e3;
    return '';
  });
  s = s.replace(/"[^"]*"|'[^']*'/g, '');
  a += (s.match(/#[\w-]+/g) ?? []).length;
  b += (s.match(/\.[\w-]+|\[[^\]]*\]/g) ?? []).length;
  const pseudoEls = (s.match(/::[\w-]+|:(before|after|first-line|first-letter)(?![\w-])/g) ?? []).length;
  b += (s.match(/:[\w-]+/g) ?? []).length - pseudoEls;
  c += pseudoEls;
  c += (s.replace(/\[[^\]]*\]|[#.:][\w-]+(\([^)]*\))?/g, ' ').match(/(^|[\s>+~])[a-z][\w-]*/gi) ?? []).length;
  return a * 1e6 + b * 1e3 + c;
}

/* ------------------------------------------------------------------ *
 * Emission
 * ------------------------------------------------------------------ */

function emit(entries) {
  const out = [];
  let media = null;
  let block = [];
  let prev = null;
  const push = () => {
    if (prev) block.push(`:where(${prev.targets.join(',')})${prev.pseudoEl}{${prev.text}}`);
    prev = null;
  };
  const flush = () => {
    push();
    if (!block.length) return;
    out.push(media ? `@media ${media}{${block.join('')}}` : block.join('\n'));
    block = [];
  };
  for (const e of entries) {
    if ((e.media ?? null) !== media) { flush(); media = e.media ?? null; }
    // Selectors of one rule that sort next to each other share one block.
    if (prev && prev.order === e.order && prev.band === e.band && prev.pseudoEl === e.pseudoEl && prev.text === e.text) {
      prev = { ...prev, targets: [...prev.targets, ...e.targets] };
      continue;
    }
    push();
    prev = e;
  }
  flush();
  return out.join('\n');
}

/** Every class and id used in the document. */
function presentTokens(document) {
  const classes = new Set();
  const ids = new Set();
  for (const el of document.querySelectorAll('[class], [id]')) {
    for (const c of el.classList) classes.add(c);
    if (el.id) ids.add(el.id);
  }
  return { classes, ids };
}

/** False when the selector requires a class or id absent from the page. */
function mayMatch(selector, { classes, ids }) {
  // Escaped names (`.md\:flex`) are not worth tokenizing correctly here.
  if (selector.includes('\\')) return true;
  // Inside :not() an absent class makes the selector MORE likely to match.
  const required = selector
    .replace(/:(not|is|where|has|matches)\((?:[^()]|\([^()]*\))*\)/g, '')
    .replace(/\[[^\]]*\]|"[^"]*"|'[^']*'/g, '');
  for (const m of required.matchAll(/([.#])(-?[_a-zA-Z][\w-]*)/g)) {
    if (m[1] === '.' ? !classes.has(m[2]) : !ids.has(m[2])) return false;
  }
  return true;
}

function declsText(decls, base) {
  return decls.map((d) => `${d.prop}:${absolutizeCssUrls(d.value, base)}${d.important ? '!important' : ''};`).join('');
}

/** url(relative) in a stylesheet resolves against the SHEET, not the page. */
function absolutizeCssUrls(value, base) {
  if (!value.includes('url(')) return value;
  return value.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (m, q, u) => {
    if (/^(data:|#|[a-z][\w+.-]*:)/i.test(u)) return m;
    try { return `url("${new URL(u, base).href}")`; } catch { return m; }
  });
}

/* ------------------------------------------------------------------ *
 * Markup capture
 * ------------------------------------------------------------------ */

const URL_ATTRS = ['src', 'poster', 'data', 'action'];
const LAZY_SRC = ['data-src', 'data-lazy-src', 'data-original', 'data-lazy'];

/** Attributes of an element, with resource URLs made absolute. */
function sourceAttrs(el, baseUrl) {
  const out = [];
  for (const attr of el.attributes) {
    const name = attr.name.toLowerCase();
    if (name.startsWith('on') || name.startsWith('data-ef-')) continue;
    out.push([attr.name, absolutizeAttr(name, attr.value, baseUrl)]);
  }
  // Lazy images whose real source never got swapped in.
  if (el.tagName === 'IMG') {
    const lazy = LAZY_SRC.map((n) => el.getAttribute(n)).find(Boolean);
    const src = el.getAttribute('src') || '';
    if (lazy && (!src || src.startsWith('data:'))) {
      const i = out.findIndex(([n]) => n.toLowerCase() === 'src');
      const abs = absolutizeAttr('src', lazy, baseUrl);
      if (i >= 0) out[i][1] = abs; else out.push(['src', abs]);
    }
  }
  return out;
}

function absolutizeAttr(name, value, baseUrl) {
  try {
    if (URL_ATTRS.includes(name)) return /^(data:|#)/.test(value) ? value : new URL(value, baseUrl).href;
    if (name === 'srcset') {
      return value.split(',').map((part) => {
        const [u, ...rest] = part.trim().split(/\s+/);
        return u ? [new URL(u, baseUrl).href, ...rest].join(' ') : part;
      }).join(', ');
    }
    if (name === 'style') return absolutizeCssUrls(value, baseUrl);
  } catch { /* keep as authored */ }
  return value;
}

/**
 * Inner markup of a leaf node with a `data-ef-sub` key on every descendant
 * (registered in `keys` so rules aimed at them are rewritten), resource URLs
 * made absolute, and the SVG sprite symbols it references copied in.
 */
function leafHtml(el, nodeId, keys, baseUrl, document) {
  const clone = el.cloneNode(true);
  const originals = el.querySelectorAll('*');
  const copies = clone.querySelectorAll('*');
  if (originals.length !== copies.length) return null;
  for (let i = 0; i < copies.length; i++) {
    const copy = copies[i];
    const sub = `${nodeId}-${i}`;
    for (const [name, value] of sourceAttrs(originals[i], baseUrl)) {
      try { copy.setAttribute(name, value); } catch { /* invalid name */ }
    }
    for (const attr of [...copy.attributes]) if (attr.name.toLowerCase().startsWith('on')) copy.removeAttribute(attr.name);
    copy.setAttribute('data-ef-sub', sub);
    keys.set(originals[i], `[data-ef-sub="${sub}"]`);
  }

  // <use href="#icon-x"> pointing at a sprite elsewhere in the page.
  const symbols = [];
  for (const use of clone.querySelectorAll('use')) {
    const ref = use.getAttribute('href') || use.getAttribute('xlink:href') || '';
    if (!ref.startsWith('#')) continue;
    const target = document.getElementById(ref.slice(1));
    if (target && !el.contains(target) && !symbols.includes(target)) symbols.push(target);
  }
  // Their rules already come through document.styleSheets, rewritten.
  for (const dead of clone.querySelectorAll('style, script, template, noscript')) dead.remove();
  let html = clone.innerHTML;
  if (symbols.length) {
    html += `<svg width="0" height="0" style="position:absolute;overflow:hidden" aria-hidden="true"><defs>${symbols.map((s) => s.outerHTML).join('')}</defs></svg>`;
  }
  return html.length <= MAX_LEAF_HTML ? html : null;
}

/**
 * The node's element as it is NOW. Widgets that re-render (countdowns,
 * tickers) replace their elements after the DOM phase captured them; the
 * recorded path finds the element that took the old one's place.
 */
function liveElement(el, node, document) {
  if (!el || el.isConnected) return el;
  try {
    const now = node.domPath && document.querySelector(node.domPath);
    if (now?.tagName.toLowerCase() === node.tag) return now;
  } catch { /* path is not a valid selector */ }
  return el;
}

function depthOf(el) {
  let d = 0;
  for (let a = el; a; a = a.parentElement) d++;
  return d;
}
