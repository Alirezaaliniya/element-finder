/** Shared low-level utilities. Zero dependencies, runs in any context. */

const HEX = '0123456789abcdef';

/** Elementor-style element id: 7-8 lowercase hex chars. */
export function elementorId() {
  let id = '';
  const len = 7 + (Math.random() < 0.5 ? 1 : 0);
  for (let i = 0; i < len; i++) id += HEX[(Math.random() * 16) | 0];
  return id;
}

export function uuid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export function deepClone(value) {
  if (value === undefined) return undefined;
  if (globalThis.structuredClone) return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

export function debounce(fn, ms) {
  let t;
  return function (...args) {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), ms);
  };
}

export function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

export function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Remove keys whose value is undefined/null/'' — keeps exported JSON lean. */
export function compactObject(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null || v === '') continue;
    out[k] = v;
  }
  return out;
}

export function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function truncate(str, max) {
  str = String(str ?? '');
  return str.length > max ? str.slice(0, max - 1) + '…' : str;
}

/** Safe filename from arbitrary text. */
export function slugify(text, fallback = 'untitled') {
  const slug = String(text ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return slug || fallback;
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return '?';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (bytes >= 1024 && i < units.length - 1) { bytes /= 1024; i++; }
  return `${bytes.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/** Parse a CSS pixel-ish value to a number, or null. */
export function cssNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : null;
}

/** Round to at most 2 decimals (Elementor stores clean numbers). */
export function round2(n) {
  return Math.round(n * 100) / 100;
}

/** Walk an extracted-node tree depth-first. Return false from visit to skip children. */
export function walkTree(node, visit, parent = null, depth = 0) {
  if (!node) return;
  const descend = visit(node, parent, depth);
  if (descend === false) return;
  for (const child of node.children || []) walkTree(child, visit, node, depth + 1);
}

export function findNode(root, id) {
  let found = null;
  walkTree(root, (n) => {
    if (n.id === id) { found = n; return false; }
  });
  return found;
}

export function findParent(root, id) {
  let found = null;
  walkTree(root, (n) => {
    if ((n.children || []).some((c) => c.id === id)) { found = n; return false; }
  });
  return found;
}

export function countNodes(root) {
  let count = 0;
  walkTree(root, () => { count++; });
  return count;
}

/** Resolve a possibly-relative URL against a base; returns null when unresolvable. */
export function resolveUrl(url, base) {
  if (!url) return null;
  try { return new URL(url, base).href; } catch { return null; }
}

export function fileExtensionFromUrl(url) {
  try {
    const path = new URL(url).pathname;
    const m = /\.([a-z0-9]{1,5})$/i.exec(path);
    return m ? m[1].toLowerCase() : '';
  } catch { return ''; }
}
