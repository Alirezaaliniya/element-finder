/**
 * Source CSS for the Elementor export
 * -----------------------------------
 * Element settings carry what Elementor's controls can express. The page's
 * own CSS (captured by the Source CSS Engine) also holds what they cannot:
 * :hover/:focus states, ::before/::after, transitions and keyframes, icon-font
 * glyphs, and the inner markup of HTML widgets. This module rewrites that CSS
 * for the imported template and it ships as Pro custom CSS.
 *
 * The preview CSS targets `[data-ef-id="X"]`; an exported element keeps the
 * id X, and Elementor renders it as `.elementor-element-X`. Rules for
 * elements inside an HTML widget keep their `[data-ef-sub]` targets, because
 * the widget carries the captured markup with those attributes. Rules kept
 * as written (`.btn:hover`) are scoped under `selector` so they cannot reach
 * the rest of the target site. Bare tag and universal rules (`a`, `h1`, `*`)
 * are dropped for the same reason.
 *
 * Specificity: every rule is emitted as `:where(…):not(.ef-a):not(.ef-b)`,
 * a uniform (0,2,0). The source cascade order is kept, because the rules
 * were already emitted sorted by their original specificity. Elementor's
 * per-element settings CSS (0,3,0) still wins, so editing a control after
 * import works. Kit and widget-default CSS (≤0,2,0, earlier) does not.
 */

import { parseCssWithRegions, splitTopLevel } from '../elementor/css-text.js';

const BOOST = ':not(.ef-a):not(.ef-b)';
const INHERITED_OR_PAGE = /^(--|color$|font|line-height$|letter-spacing$|word-spacing$|text-align$|direction$|background)/;

/**
 * @param {object} snapshot
 * @param {{exportedIds: Set<string>, subHosts: Set<string>}} scope ids rendered
 *        as Elementor elements, and ids of HTML widgets carrying captured markup
 * @returns {string} CSS using Elementor's `selector` placeholder, or ''
 */
export function sourceCssForElementor(snapshot, { exportedIds, subHosts }) {
  const css = snapshot.sourceStyles?.css;
  if (!css) return '';
  const rootId = snapshot.tree?.id;
  const { rules, keyframes } = parseCssWithRegions(css);

  const out = [];
  const push = (media, sel, decls) => out.push({ media: media ?? null, sel, decls });
  for (const rule of rules) {
    for (const selector of rule.selectors) {
      const m = /^:where\(([\s\S]*)\)(::?[\w-]+)?$/.exec(selector.trim());
      if (!m) continue;
      const pseudoEl = m[2] ?? '';
      const targets = [];
      let pageLevel = false;
      for (const target of splitTopLevel(m[1], ',').map((s) => s.trim())) {
        // The page root / <html>: the document wrapper inherits their text
        // styles and variables.
        if (target === 'html' || target === ':root' || target === `[data-ef-id="${rootId}"]`) {
          if (!pseudoEl) pageLevel = true;
          continue;
        }
        const rewritten = rewriteTarget(target, exportedIds, subHosts);
        if (rewritten) targets.push(rewritten);
      }
      if (targets.length) push(rule.media, `:where(${targets.join(',')})${BOOST}${pseudoEl}`, rule.decls);
      if (pageLevel) {
        const pageDecls = rule.decls.filter((d) => INHERITED_OR_PAGE.test(d.prop));
        if (pageDecls.length) push(rule.media, `:where(selector)${BOOST}`, pageDecls);
      }
    }
  }
  if (!out.length) return '';

  const body = mergeRuns(out).map(({ media, sel, decls }) => {
    const text = `${sel}{${decls.map((d) => `${d.prop}:${d.value}${d.important ? '!important' : ''}`).join(';')}}`;
    return media ? `@media ${media}{${text}}` : text;
  }).join('\n');
  const used = new Set([...body.matchAll(/animation(?:-name)?\s*:([^;}]*)/g)].flatMap((x) => x[1].split(/[\s,]+/)));
  const frames = keyframes.filter((k) => used.has(k.name)).map((k) => k.text);
  return [fontFaces(snapshot), body, ...frames].filter(Boolean).join('\n');
}

/**
 * Adjacent rules with the same selector and media become one, resolved as
 * the cascade would (later wins, unless the earlier one is !important).
 * Only ADJACENT ones: moving a declaration past a rule in between could
 * change which of the two wins on an element both match.
 */
function mergeRuns(rules) {
  const merged = [];
  for (const r of rules) {
    const prev = merged[merged.length - 1];
    if (!prev || prev.sel !== r.sel || prev.media !== r.media) {
      merged.push({ media: r.media, sel: r.sel, decls: [...r.decls] });
      continue;
    }
    // Within one rule repeated properties are fallbacks and all stay; across
    // rules the later one replaces the earlier, unless that was !important.
    const keepOld = new Set(prev.decls.filter((d) => d.important).map((d) => d.prop));
    const incoming = r.decls.filter((d) => d.important || !keepOld.has(d.prop));
    const replaced = new Set(incoming.map((d) => d.prop));
    prev.decls = [...prev.decls.filter((d) => !replaced.has(d.prop) || (d.important && !incoming.some((x) => x.prop === d.prop && x.important))), ...incoming];
  }
  return merged;
}

/** One preview target -> its selector in the imported template, or null. */
function rewriteTarget(target, exportedIds, subHosts) {
  // Elementor replaces the word `selector` everywhere, class names included.
  if (target.includes('selector')) return null;
  if (!/data-ef-(id|sub)/.test(target)) {
    // Kept as written: only when it names a class or id (a bare `a` or `*`
    // would restyle the whole target site), and only inside this document.
    const named = /[.#][\w-]/.test(target.replace(/\[[^\]]*\]/g, '')) || /\[class\s*[\^*$|~]?=/.test(target);
    return named ? `selector ${target}` : null;
  }
  let ok = true;
  const out = target
    .replace(/\[data-ef-id="([^"]+)"\]/g, (_, id) => {
      if (!exportedIds.has(id)) ok = false;
      return `.elementor-element-${id}`;
    })
    .replace(/\[data-ef-sub="([^"]+)-\d+"\]/g, (sub, host) => {
      if (!subHosts.has(host)) ok = false;
      return sub;
    });
  return ok ? out : null;
}

/** The catalogued web fonts (icon fonts included) at their source URLs. */
function fontFaces(snapshot) {
  return (snapshot.assets ?? [])
    .filter((a) => a.type === 'font' && a.url && a.meta?.family)
    .map((a) => `@font-face{font-family:"${a.meta.family.replace(/"/g, '')}";src:url("${a.url}");` +
      `font-weight:${a.meta.weight || 'normal'};font-style:${a.meta.style || 'normal'};font-display:swap}`)
    .join('\n');
}
