/**
 * Canonical data model — the Intermediate Representation (IR) every engine
 * reads from / writes to. The IR is plain JSON so it can cross extension
 * context boundaries and be persisted verbatim.
 *
 * Snapshot
 * ├── meta        page-level metadata & engine versions
 * ├── tree        root ExtractedNode (recursive)
 * ├── assets[]    deduplicated asset catalog (nodes reference by id)
 * ├── globals     page-wide design tokens (palette, fonts)
 * └── stats       extraction statistics for the UI
 */

import { APP, NODE_ROLES } from '../common/constants.js';
import { elementorId } from '../common/utils.js';

/** @returns {object} a fresh ExtractedNode */
export function createNode(init = {}) {
  return {
    id: elementorId(),
    tag: '',                 // lowercase tag name
    role: NODE_ROLES.CONTAINER,
    label: '',               // human-readable name shown in the tree
    domPath: '',             // CSS-ish locator (diagnostics only)
    classes: [],
    customClasses: [],       // non-framework classes -> Elementor _css_classes
    attrs: {},               // curated attribute subset (id, data-*, aria-*)
    semantic: {
      kind: null,            // hero | header | footer | nav | card | gallery | ...
      isRepeated: false,     // member of a detected repeating pattern
      patternKey: null,      // shared key among pattern siblings
      elementorNative: null, // { elType, widgetType, settings? } when source page is Elementor
    },
    layout: null,            // { display, direction, wrap, gap*, justify, align, columns }
    rect: null,              // { x, y, width, height } at extraction time (desktop)
    content: {},             // engine-specific extracted content (text, src, href, fields…)
    styles: { desktop: {}, tablet: {}, mobile: {} },   // raw curated CSS declarations
    settings: { desktop: {}, tablet: {}, mobile: {} }, // Elementor-compatible settings
    mapping: null,           // { elType, widgetType, confidence, source, alternatives[] }
    assets: [],              // asset ids referenced by this node
    hidden: false,           // user removed it from output (kept for restore)
    warnings: [],
    children: [],
    ...init,
  };
}

export function createSnapshot(init = {}) {
  return {
    schemaVersion: APP.SNAPSHOT_SCHEMA_VERSION,
    appVersion: APP.VERSION,
    meta: {
      url: '',
      title: '',
      lang: '',
      dir: 'ltr',
      extractedAt: null,
      viewport: { width: 0, height: 0 },
      scope: 'page', // 'page' | 'element'
      customCss: '', // page-level custom CSS recovered from the source
      ...init.meta,
    },
    tree: init.tree ?? null,
    assets: init.assets ?? [],
    globals: { colors: [], fonts: [], ...init.globals },
    stats: {
      domNodesSeen: 0,
      nodesExtracted: 0,
      nodesSkipped: 0,
      patternsDetected: 0,
      assetsCollected: 0,
      durationMs: 0,
      enginePhases: {},
      ...init.stats,
    },
  };
}

/** @returns {object} a catalog entry for the assets array */
export function createAsset(init = {}) {
  return {
    id: '',          // stable hash-based id
    type: 'image',   // image | svg | icon | video | font | background | favicon
    url: null,       // absolute URL (null for inline assets)
    inline: null,    // inline payload (e.g. serialized SVG markup)
    filename: '',
    mime: '',
    origin: '',      // host the asset came from
    meta: {},        // width/height/alt/fontFamily/…
    usedBy: [],      // node ids
    ...init,
  };
}

/** Cheap stable id for asset dedup: djb2 over the identity string. */
export function assetId(identity) {
  let h = 5381;
  for (let i = 0; i < identity.length; i++) h = ((h << 5) + h + identity.charCodeAt(i)) >>> 0;
  return 'a' + h.toString(16);
}
