/**
 * Elementor Native Engine
 * -----------------------
 * Runs only on pages built with Elementor. Instead of approximating settings
 * from computed style (the generic path every other site takes), it recovers
 * what Elementor actually saved:
 *
 *  - classic elements: post CSS reversed through the installed plugins'
 *    control templates (css-reverse.js) -> exact control names and values,
 *    per breakpoint, with kit global references; wrapper classes reversed via
 *    prefix_class; Pro per-element custom CSS recovered verbatim from its
 *    comment markers; unexplained rules kept as custom CSS.
 *  - atomic (V4) elements: local style classes and global classes rebuilt as
 *    typed style definitions (atomic.js).
 *  - document-level custom CSS (page / header / footer templates).
 *
 * Results are attached to `node.semantic.elementorNative` and consumed by
 * the exporter; the generic canonical settings stay in place for the builder
 * preview and for user re-mapping.
 */

import { walkTree } from '../../common/utils.js';
import { classTokens } from '../dom/structure-heuristics.js';
import { resolveCssVars, containsVar } from '../css/var-resolver.js';
import { collectCssRules, declsToText, fetchText } from './css-text.js';
import { CompiledStack, loadControlsIndex } from './controls-index.js';
import { deviceForMedia, reverseElement } from './css-reverse.js';
import { extractNativeContent, uploadedSvgIcons } from './native-content.js';
import { resolveUploadedSvgIcons } from './svg-resolver.js';
import {
  atomicSettingsFromDom, base64Utf8, buildStyleDefinition, candidateGlobalClasses, stateFromSuffix,
} from './atomic.js';

const DEFAULT_BREAKPOINTS = {
  mobile: { direction: 'max', value: 767 },
  mobile_extra: { direction: 'max', value: 880 },
  tablet: { direction: 'max', value: 1024 },
  tablet_extra: { direction: 'max', value: 1200 },
  laptop: { direction: 'max', value: 1366 },
  widescreen: { direction: 'min', value: 2400 },
};

const EMPTY_STACK = new CompiledStack({});

export class ElementorNativeEngine {
  static phaseName = 'elementor-native';

  async run(ctx) {
    const { document, snapshot, logger } = ctx;
    const log = logger.child('elementor');
    const elements = ctx.scratch.get('elementsByNodeId');
    if (!elements || !snapshot.tree) return;

    const nativeNodes = [];
    walkTree(snapshot.tree, (n) => { if (n.semantic?.elementorNative) nativeNodes.push(n); });
    if (!nativeNodes.length) return;

    const win = ctx.window ?? document.defaultView;
    const index = await loadControlsIndex();
    const breakpoints = readFrontendBreakpoints(document) ?? index?.map.breakpoints ?? DEFAULT_BREAKPOINTS;

    const { rules, regions, failed, sheets } = await collectCssRules(document, {
      filter: authoredSheet,
      fetchText: ctx.options?.fetchText,
    });

    // Pro custom CSS, verbatim, with the wrapper rewritten back to `selector`.
    const elementCss = new Map();
    const documentCss = [];
    for (const region of regions) {
      if (region.kind === 'element') {
        const wrapper = new RegExp(`(?:\\.elementor-\\d+\\s+)?\\.elementor-element\\.elementor-element-${region.elementId}(?![\\w-])`, 'g');
        push(elementCss, region.elementId, region.text.replace(wrapper, 'selector'));
      } else {
        documentCss.push(region.text.replace(/\.elementor-\d+(?![\w-])/g, 'selector'));
      }
    }

    // Index rules by the element they target / the class they style.
    const byElement = new Map();
    const byClass = new Map();
    for (const rule of rules) {
      if (rule.region) continue;
      for (const selector of rule.selectors) {
        const id = /\.elementor-element-([0-9a-z]+)(?![\w-])/i.exec(selector)?.[1];
        if (id) {
          push(byElement, id, { selector, rule });
          continue;
        }
        // Atomic class styles: `.elementor .<class><state>`
        const cls = /^\.elementor\s+\.(-?[_a-zA-Z][\w-]*)(.*)$/.exec(selector);
        if (cls) push(byClass, cls[1], { selector, suffix: cls[2], rule });
      }
    }

    const rtl = (snapshot.meta.dir || '').toLowerCase() === 'rtl';
    const schema = index?.atomicStyleSchema ?? {};
    const globalClasses = new Map();
    let reversed = 0;
    let atomicCount = 0;
    let unknownWidgets = 0;
    const svgIcons = [];

    for (const node of nativeNodes) {
      const el = elements.get(node.id);
      const native = node.semantic.elementorNative;
      if (!el || !native.sourceId) continue;
      const style = win.getComputedStyle(el);
      const varLookup = (name) => style.getPropertyValue(name);

      if (native.atomic) {
        buildAtomic(node, el, native, { byClass, breakpoints, schema, rtl, varLookup, globalClasses, baseUrl: snapshot.meta.url });
        atomicCount++;
        continue;
      }

      const elType = native.elType === 'widget' ? 'widget' : native.elType;
      let stack = index?.stackFor(elType, native.widgetType ?? null) ?? null;
      if (!stack) {
        stack = EMPTY_STACK;
        if (native.widgetType) unknownWidgets++;
      }
      const result = reverseElement({
        stack,
        elementId: native.sourceId,
        rules: byElement.get(native.sourceId) ?? [],
        breakpoints,
        varLookup,
        classes: classTokens(el),
      });
      if (native.elType === 'widget' && native.widgetType) {
        native.content = extractNativeContent(el, native.widgetType, snapshot.meta.url);
        for (const icon of uploadedSvgIcons(native.content)) svgIcons.push({ node, icon });
      }
      native.exact = {
        settings: result.settings,
        globals: result.globals,
        repeaters: result.repeaters,
        customCss: [...(elementCss.get(native.sourceId) ?? []), result.leftoverCss].filter(Boolean).join('\n'),
        matched: result.matched,
        controlsKnown: stack !== EMPTY_STACK,
      };
      reversed++;
    }

    // Uploaded SVG icons: find each file in the source site's media library
    // so Elementor's import can download it; the inline drawing alone cannot
    // be imported as an icon.
    let svgStats = null;
    if (svgIcons.length) {
      svgStats = await resolveUploadedSvgIcons(
        svgIcons.map(({ icon }) => ({ markup: icon.__svg, apply: (url) => { icon.value = { url, id: '' }; } })),
        { document, fetchText: ctx.options?.fetchText ?? fetchText },
      ).catch(() => null);
      for (const { node, icon } of svgIcons) {
        delete icon.__svg;
        if (!icon.value?.url) {
          node.warnings.push('Uploaded SVG icon not found in the source site\'s media library; re-select it after import (the drawing is in the assets package).');
        }
      }
    }

    if (globalClasses.size) {
      snapshot.globals.atomicClasses = Object.fromEntries(globalClasses);
    }

    // Page-level custom CSS for the export: Pro document custom CSS (page,
    // header/footer templates) with document wrappers as `selector`, plus
    // authored rules styling the tree's custom classes from ANY readable
    // sheet (theme, kit, custom-CSS plugins) — not only inline <style>.
    const classCss = customClassRules(rules, snapshot.tree, new Set(globalClasses.keys()))
      .map((rule) => ruleText(rule, (s) => s.replace(/\.elementor-(?:\d+|kit-\d+)\s+/g, '')));
    const pageCss = [...documentCss, ...classCss].join('\n');
    if (pageCss) {
      const bodyStyle = win.getComputedStyle(document.body);
      const lookup = (name) => bodyStyle.getPropertyValue(name);
      snapshot.meta.customCss = containsVar(pageCss) ? resolveCssVars(pageCss, lookup) : pageCss;
    }

    snapshot.meta.elementor = {
      generator: document.querySelector('meta[name="generator"][content*="Elementor"]')?.getAttribute('content') ?? null,
      controlsMap: index ? { elementor: index.version, pro: index.proVersion } : null,
      breakpoints,
      cssSheets: sheets,
      cssRules: rules.length,
      unreadableSheets: failed,
    };
    if (!index) snapshot.tree.warnings.push('Elementor controls map could not be loaded; styles were approximated from computed CSS.');
    const pageVersion = /Elementor ([\d.]+)/.exec(snapshot.meta.elementor.generator ?? '')?.[1];
    if (index && pageVersion && minor(pageVersion) !== minor(index.version)) {
      snapshot.tree.warnings.push(`Page uses Elementor ${pageVersion}; the controls map was generated from ${index.version}. Regenerate it with tools/elementor-dump if styles look off.`);
    }
    if (failed.length) snapshot.tree.warnings.push(`${failed.length} stylesheet(s) could not be read; some Elementor styles may be missing.`);

    log.info(`elementor: ${reversed} classic element(s) reversed from ${rules.length} rules, ${atomicCount} atomic, ${globalClasses.size} global class(es), ${unknownWidgets} unknown widget type(s)${svgStats ? `, svg icons ${svgStats.resolved}/${svgStats.total} recovered (${svgStats.scanned} files scanned)` : ''}`);
  }
}

/**
 * Stylesheets that can carry authored styles: inline <style>, generated
 * Elementor CSS (uploads/elementor/css), theme and custom-CSS files. Plugin
 * asset bundles (elementor/assets, woocommerce…) only hold framework CSS.
 */
function authoredSheet(sheet) {
  if (sheet.ownerNode?.tagName === 'STYLE') return true;
  const href = sheet.href || '';
  if (!href) return false;
  if (/\/uploads\/|\/themes\//.test(href)) return true;
  return !/\/plugins\//.test(href) && !/\/wp-includes\//.test(href);
}

/** Breakpoints the source site actually uses (elementorFrontendConfig). */
function readFrontendBreakpoints(document) {
  for (const script of document.querySelectorAll('script:not([src])')) {
    const text = script.textContent || '';
    const at = text.indexOf('elementorFrontendConfig');
    if (at === -1) continue;
    const start = text.indexOf('{', at);
    if (start === -1) continue;
    const json = balancedJson(text, start);
    try {
      const config = JSON.parse(json);
      const raw = config?.responsive?.breakpoints;
      if (!raw) continue;
      const out = {};
      for (const [key, bp] of Object.entries(raw)) {
        out[key] = { direction: bp.direction, value: Number(bp.value), enabled: !!bp.is_enabled };
      }
      return out;
    } catch { /* not JSON */ }
  }
  return null;
}

function balancedJson(text, start) {
  let depth = 0;
  let quote = null;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\') { i++; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"') { quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return text.slice(start, i + 1);
  }
  return '';
}

/* ------------------------------------------------------------------ *
 * Atomic
 * ------------------------------------------------------------------ */

function buildAtomic(node, el, native, ctx) {
  const { byClass, breakpoints, schema, rtl, varLookup, globalClasses, baseUrl } = ctx;
  const type = native.widgetType ?? native.elType;
  const { settings, warnings } = atomicSettingsFromDom(el, type, baseUrl);
  node.warnings.push(...warnings);

  const resolveVar = (value) => resolveCssVars(value, varLookup);
  const opts = { rtl, resolveVar };
  const styles = {};
  const classIds = [];

  for (const cls of native.localClasses ?? []) {
    const groups = groupClassRules(byClass.get(cls) ?? [], breakpoints);
    const def = buildStyleDefinition(cls, 'local', groups.ok, schema, opts);
    appendCustomCss(def, groups.unmapped, cls);
    if (def.variants.length) {
      styles[cls] = def;
      classIds.push(cls);
    }
  }

  // Global classes: rendered by label; exported with a stable generated id.
  for (const label of candidateGlobalClasses(el)) {
    const entries = (byClass.get(label) ?? []).filter((e) => /\/elementor\/css\/global-/.test(e.rule.href ?? ''));
    if (!entries.length) continue;
    let def = globalClasses.get(label);
    if (!def) {
      const groups = groupClassRules(entries, breakpoints);
      def = buildStyleDefinition(`g-${hash(label)}`, label, groups.ok, schema, opts);
      appendCustomCss(def, groups.unmapped, label);
      globalClasses.set(label, def);
    }
    classIds.push(def.id);
  }

  native.atomicData = { settings, styles, classIds };
}

/** Group a class's rules into (breakpoint, state) variants. */
function groupClassRules(entries, breakpoints) {
  const byKey = new Map();
  const unmapped = [];
  for (const { suffix, rule } of entries) {
    const device = deviceForMedia(rule.media, breakpoints);
    const state = stateFromSuffix(suffix);
    if (!device || state === undefined) { unmapped.push({ suffix, rule }); continue; }
    const key = `${device}|${state ?? ''}`;
    if (!byKey.has(key)) byKey.set(key, { breakpoint: device, state, decls: new Map() });
    for (const d of rule.decls) byKey.get(key).decls.set(d.prop, d);
  }
  return {
    ok: [...byKey.values()].map((g) => ({ ...g, decls: [...g.decls.values()] })),
    unmapped,
  };
}

/**
 * Rules that are not plain state/breakpoint variants (descendant selectors,
 * pseudo-elements) have no prop representation; fold them into the desktop
 * variant's custom CSS so nothing is lost.
 */
function appendCustomCss(def, unmapped, cls) {
  if (!unmapped.length) return;
  const text = unmapped.map(({ suffix, rule }) => {
    const css = `&${suffix}{${declsToText(rule.decls)}}`;
    return rule.media ? `@media ${rule.media}{${css}}` : css;
  }).join('\n');
  let variant = def.variants.find((v) => v.meta.breakpoint === 'desktop' && !v.meta.state);
  if (!variant) {
    variant = { meta: { breakpoint: 'desktop', state: null }, props: {}, custom_css: null };
    def.variants.push(variant);
  }
  const prev = variant.custom_css?.raw ? decodeBase64Utf8(variant.custom_css.raw) : '';
  variant.custom_css = { raw: base64Utf8([prev, `/* ${cls} */`, text].filter(Boolean).join('\n')) };
}

function decodeBase64Utf8(b64) {
  const bin = atob(b64);
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

/* ------------------------------------------------------------------ */

function ruleText(rule, mapSelector) {
  const css = `${rule.selectors.map(mapSelector).join(',')}{${declsToText(rule.decls)}}`;
  return rule.media ? `@media ${rule.media}{${css}}` : css;
}

const MAX_CLASS_CSS_RULES = 400;

/**
 * Authored rules whose selectors reference a custom class present in the
 * tree. Element-id rules belong to element custom CSS, region rules to
 * document CSS and global-class rules to atomic style definitions — all
 * excluded here.
 */
function customClassRules(rules, tree, atomicLabels) {
  const custom = new Set();
  walkTree(tree, (n) => {
    // <body>'s classes (rtl, page-id-…) describe the page, not an element.
    if (n === tree && n.tag === 'body') return;
    for (const c of n.customClasses ?? []) if (!atomicLabels.has(c)) custom.add(c);
  });
  if (!custom.size) return [];
  const out = [];
  for (const rule of rules) {
    if (rule.region) continue;
    if (rule.selectors.some((s) => /\.elementor-element-[0-9a-z]+(?![\w-])/i.test(s))) continue;
    const hit = rule.selectors.some((s) => {
      for (const m of s.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) if (custom.has(m[1])) return true;
      return false;
    });
    if (!hit) continue;
    out.push(rule);
    if (out.length >= MAX_CLASS_CSS_RULES) break;
  }
  return out;
}

function minor(version) {
  return String(version).split('.').slice(0, 2).join('.');
}

function push(map, key, value) {
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(value);
}

function hash(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  return h.toString(16).slice(0, 7).padStart(7, '0');
}
