/**
 * Global constants shared by every execution context
 * (content script, service worker, builder page, popup).
 */

export const APP = {
  NAME: 'Element Finder Studio',
  VERSION: '0.1.0',
  SNAPSHOT_SCHEMA_VERSION: 1,
};

/** Elementor's default breakpoint model (Desktop-first cascade). */
export const BREAKPOINTS = {
  DESKTOP: 'desktop',
  TABLET: 'tablet',
  MOBILE: 'mobile',
};

export const BREAKPOINT_MAX_WIDTH = {
  [BREAKPOINTS.TABLET]: 1024,
  [BREAKPOINTS.MOBILE]: 767,
};

export const DEVICE_ORDER = [BREAKPOINTS.DESKTOP, BREAKPOINTS.TABLET, BREAKPOINTS.MOBILE];

/** Suffix applied to Elementor setting keys per device. */
export const DEVICE_SUFFIX = {
  [BREAKPOINTS.DESKTOP]: '',
  [BREAKPOINTS.TABLET]: '_tablet',
  [BREAKPOINTS.MOBILE]: '_mobile',
};

/** Hard limits that keep extraction bounded on pathological pages. */
export const LIMITS = {
  MAX_NODES: 6000,
  MAX_DEPTH: 24,
  MAX_TEXT_LENGTH: 20000,
  MAX_ASSETS: 1500,
  MAX_INLINE_SVG_BYTES: 200 * 1024,
};

/** Message protocol — every cross-context message carries a `type` from here. */
export const MSG = {
  // popup/background -> content
  PING: 'EF_PING',
  EXTRACT_PAGE: 'EF_EXTRACT_PAGE',
  PICK_ELEMENT: 'EF_PICK_ELEMENT',
  CANCEL_PICK: 'EF_CANCEL_PICK',
  // content -> background
  EXTRACTION_PROGRESS: 'EF_EXTRACTION_PROGRESS',
  EXTRACTION_COMPLETE: 'EF_EXTRACTION_COMPLETE',
  EXTRACTION_FAILED: 'EF_EXTRACTION_FAILED',
  // background -> popup
  STATUS_UPDATE: 'EF_STATUS_UPDATE',
  // builder -> background
  OPEN_BUILDER: 'EF_OPEN_BUILDER',
  // content -> background: stylesheet text the page's CORS policy hides
  FETCH_TEXT: 'EF_FETCH_TEXT',
};

/** chrome.storage.local keys. */
export const STORAGE_KEYS = {
  LAST_SNAPSHOT: 'ef:lastSnapshot',
  LAST_STATUS: 'ef:lastStatus',
  SETTINGS: 'ef:settings',
};

export const EL_TYPES = {
  CONTAINER: 'container',
  SECTION: 'section',
  COLUMN: 'column',
  WIDGET: 'widget',
};

export const NODE_ROLES = {
  CONTAINER: 'container',
  WIDGET: 'widget',
  TEXT_FRAGMENT: 'text-fragment',
  IGNORED: 'ignored',
};

/** Mapping decision provenance — drives confidence display & validation. */
export const MAPPING_SOURCES = {
  ELEMENTOR_NATIVE: 'elementor-native',
  RULE: 'rule',
  HEURISTIC: 'heuristic',
  AI: 'ai',
  USER: 'user',
  FALLBACK: 'fallback',
};
