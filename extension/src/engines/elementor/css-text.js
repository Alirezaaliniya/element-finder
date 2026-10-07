/**
 * Raw stylesheet text acquisition + a small CSS parser.
 *
 * Why raw text instead of CSSOM: Elementor writes control values into post
 * CSS verbatim from each control's selector template (`color:#F47421`,
 * `padding:5px 20px 5px 20px`, `color:var( --e-global-color-bf98087 )`).
 * CSSOM re-serializes all of that (hex -> rgb(), shorthands collapsed,
 * var() spacing normalized) and drops comments — and Elementor Pro marks
 * per-element custom CSS only with comments:
 *
 *   / * Start custom CSS for heading, class: .elementor-element-c1f0002 * / … / * End custom CSS * /
 *
 * so the original text is fetched (same-origin, or via the service worker
 * which holds host permissions) and parsed here. CSSOM is the fallback for
 * sheets whose text cannot be obtained.
 */

/**
 * @typedef {object} CssRule
 * @property {string[]} selectors   individual selectors of the rule
 * @property {Array<{prop: string, value: string, important: boolean}>} decls
 * @property {string|null} media    combined media condition (link media + @media)
 * @property {string|null} href     source stylesheet (null for inline)
 * @property {number} order         global cascade order
 * @property {{kind: 'element'|'document', elementId?: string}|null} region
 *           Elementor Pro custom-CSS region the rule was authored in
 */

import { MSG } from '../../common/constants.js';

const MAX_SHEET_BYTES = 3 * 1024 * 1024;

/**
 * Collect parsed rules of every stylesheet in the document, in cascade order.
 *
 * @param {Document} document
 * @param {object} [opts]
 * @param {(url: string) => Promise<string|null>} [opts.fetchText]
 * @param {(sheet: CSSStyleSheet) => boolean} [opts.filter] sheets to include
 * @returns {Promise<{rules: CssRule[], regions: CssRegion[], sheets: number, failed: string[]}>}
 */
export async function collectCssRules(document, opts = {}) {
  const fetchText = opts.fetchText ?? defaultFetchText;
  const sheets = [...document.styleSheets].filter((s) => !opts.filter || opts.filter(s));

  // Fetch in parallel; order is restored by sheet index.
  const texts = await Promise.all(sheets.map(async (sheet) => {
    const node = sheet.ownerNode;
    if (node?.tagName === 'STYLE') return { text: node.textContent || '' };
    if (!sheet.href) return { text: cssomText(sheet) };
    try {
      const text = await fetchText(sheet.href);
      if (typeof text === 'string' && text.length <= MAX_SHEET_BYTES) return { text };
    } catch { /* fall through to CSSOM */ }
    const fallback = cssomText(sheet);
    return fallback === null ? { failed: sheet.href } : { text: fallback };
  }));

  const rules = [];
  const regions = [];
  const failed = [];
  let order = 0;
  sheets.forEach((sheet, i) => {
    const entry = texts[i];
    if (entry.failed) { failed.push(entry.failed); return; }
    const linkMedia = sheetMedia(sheet);
    const parsed = parseCssWithRegions(entry.text);
    for (const rule of parsed.rules) {
      rule.media = joinMedia(linkMedia, rule.media);
      rule.href = sheet.href ?? null;
      rule.order = order++;
      rules.push(rule);
    }
    for (const region of parsed.regions) {
      region.media = linkMedia;
      region.href = sheet.href ?? null;
      regions.push(region);
    }
  });
  return { rules, regions, sheets: sheets.length, failed };
}

/** Text of a URL: direct fetch, then the service worker (CORS-free). */
export async function fetchText(url) {
  return defaultFetchText(url);
}

async function defaultFetchText(url) {
  try {
    const res = await fetch(url, { credentials: 'same-origin' });
    if (res.ok) return await res.text();
  } catch { /* CORS / network */ }
  // Content scripts inherit the page's CORS restrictions; the service worker
  // holds <all_urls> host permissions and can read any sheet.
  if (globalThis.chrome?.runtime?.sendMessage) {
    try {
      const reply = await chrome.runtime.sendMessage({ type: MSG.FETCH_TEXT, url });
      if (reply?.ok) return reply.text;
    } catch { /* no service worker */ }
  }
  return null;
}

/** Serialize a sheet through CSSOM (normalized values, no comments). */
function cssomText(sheet) {
  try {
    return [...sheet.cssRules].map((r) => r.cssText).join('\n');
  } catch {
    return null; // cross-origin
  }
}

function sheetMedia(sheet) {
  const text = sheet.media?.mediaText?.trim();
  return text && text !== 'all' ? text : null;
}

function joinMedia(a, b) {
  if (a && b) return `${a} and ${b}`;
  return a || b || null;
}

/* ------------------------------------------------------------------ *
 * Parser
 * ------------------------------------------------------------------ */

const START_ELEMENT_CSS = /^\s*Start custom CSS for [^,]*, class: \.elementor-element-([0-9a-z]+)\s*$/i;
const START_DOCUMENT_CSS = /^\s*Start custom CSS\s*$/i;
const END_CUSTOM_CSS = /^\s*End custom CSS\s*$/i;

/**
 * Parse CSS text into flat style rules. Nested @media/@supports/@layer/
 * @container blocks are flattened with their condition recorded; @keyframes,
 * @font-face and other non-style at-rules are skipped.
 *
 * @param {string} css
 * @returns {CssRule[]}
 */
export function parseCss(css) {
  return parseCssWithRegions(css).rules;
}

/**
 * @typedef {object} CssRegion
 * @property {'element'|'document'} kind
 * @property {string} [elementId]
 * @property {string} text  the custom CSS exactly as authored (formatting,
 *                          comments and nesting preserved)
 */

/** Rules plus the verbatim text of each Pro custom-CSS region. */
export function parseCssWithRegions(css) {
  const rules = [];
  const state = { i: 0, region: null, regionStart: 0, regions: [] };
  parseBlock(css, state, null, rules, false);
  return { rules, regions: state.regions };
}

function parseBlock(css, state, media, rules, nested) {
  let prelude = '';
  while (state.i < css.length) {
    const ch = css[state.i];

    if (ch === '/' && css[state.i + 1] === '*') {
      const end = css.indexOf('*/', state.i + 2);
      const comment = css.slice(state.i + 2, end === -1 ? css.length : end);
      const commentStart = state.i;
      state.i = end === -1 ? css.length : end + 2;
      trackRegion(comment, state, css, commentStart);
      continue;
    }
    if (ch === '"' || ch === "'") {
      const end = skipString(css, state.i);
      prelude += css.slice(state.i, end);
      state.i = end;
      continue;
    }
    if (ch === '}') {
      state.i++;
      if (nested) return;
      prelude = '';
      continue;
    }
    if (ch === ';' && prelude.trim().startsWith('@')) {
      // @import / @charset / @layer a, b;
      prelude = '';
      state.i++;
      continue;
    }
    if (ch === '{') {
      state.i++;
      const head = prelude.trim();
      prelude = '';
      if (head.startsWith('@')) {
        const name = /^@([\w-]+)/.exec(head)?.[1]?.toLowerCase() ?? '';
        if (name === 'media') {
          parseBlock(css, state, joinMedia(media, head.slice(6).trim()), rules, true);
        } else if (name === 'supports' || name === 'layer' || name === 'container' || name === 'document' || name === 'scope') {
          parseBlock(css, state, media, rules, true);
        } else {
          skipBlock(css, state);
        }
        continue;
      }
      const body = readDeclarationBlock(css, state);
      if (!head) continue;
      const decls = parseDeclarations(body);
      if (!decls.length) continue;
      rules.push({
        selectors: splitTopLevel(head, ',').map((s) => s.trim()).filter(Boolean),
        decls,
        media,
        href: null,
        order: 0,
        region: state.region ? { ...state.region } : null,
      });
      continue;
    }
    prelude += ch;
    state.i++;
  }
}

function trackRegion(comment, state, css, commentStart) {
  const el = START_ELEMENT_CSS.exec(comment);
  if (el) { openRegion(state, { kind: 'element', elementId: el[1] }); return; }
  if (START_DOCUMENT_CSS.test(comment)) { openRegion(state, { kind: 'document' }); return; }
  if (END_CUSTOM_CSS.test(comment) && state.region) {
    state.regions.push({ ...state.region, text: css.slice(state.regionStart, commentStart).trim() });
    state.region = null;
  }

  function openRegion(st, region) {
    st.region = region;
    st.regionStart = st.i; // just after the start comment
  }
}

/** Read a declaration block body; leaves state.i after the closing brace. */
function readDeclarationBlock(css, state) {
  let depth = 0;
  const start = state.i;
  while (state.i < css.length) {
    const ch = css[state.i];
    if (ch === '"' || ch === "'") { state.i = skipString(css, state.i); continue; }
    if (ch === '/' && css[state.i + 1] === '*') {
      const end = css.indexOf('*/', state.i + 2);
      state.i = end === -1 ? css.length : end + 2;
      continue;
    }
    if (ch === '{') depth++;
    if (ch === '}') {
      if (depth === 0) {
        const body = css.slice(start, state.i);
        state.i++;
        return body;
      }
      depth--;
    }
    state.i++;
  }
  return css.slice(start);
}

function skipBlock(css, state) {
  let depth = 1;
  while (state.i < css.length && depth > 0) {
    const ch = css[state.i];
    if (ch === '"' || ch === "'") { state.i = skipString(css, state.i); continue; }
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    state.i++;
  }
}

function skipString(css, i) {
  const quote = css[i];
  let j = i + 1;
  while (j < css.length && css[j] !== quote) {
    if (css[j] === '\\') j++;
    j++;
  }
  return j + 1;
}

/**
 * "color:#fff; font-family:"A", sans-serif" -> decls. Splits on top-level
 * semicolons so data: URLs and strings survive.
 */
export function parseDeclarations(body) {
  const decls = [];
  for (const part of splitTopLevel(stripComments(body), ';')) {
    const colon = part.indexOf(':');
    if (colon <= 0) continue;
    const prop = part.slice(0, colon).trim().toLowerCase();
    let value = part.slice(colon + 1).trim();
    if (!prop || !value || /[{}]/.test(prop)) continue;
    let important = false;
    const imp = /\s*!\s*important\s*$/i.exec(value);
    if (imp) { important = true; value = value.slice(0, imp.index).trim(); }
    decls.push({ prop: prop.startsWith('--') ? part.slice(0, colon).trim() : prop, value, important });
  }
  return decls;
}

function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '');
}

/** Split on `sep` outside parentheses, brackets and strings. */
export function splitTopLevel(str, sep) {
  const out = [];
  let depth = 0;
  let cur = '';
  let quote = null;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (quote) {
      cur += ch;
      if (ch === '\\') { cur += str[++i] ?? ''; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; cur += ch; continue; }
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    if (ch === sep && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

/** Serialize decls back to CSS text. */
export function declsToText(decls) {
  return decls.map((d) => `${d.prop}:${d.value}${d.important ? ' !important' : ''};`).join('');
}
