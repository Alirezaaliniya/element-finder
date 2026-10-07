/**
 * The single entry point for turning HTML strings into DOM.
 *
 * Markup is parsed in an inert document (DOMParser: no scripts run, no
 * resources load) and stripped of everything executable before it is moved
 * into a live document: script-like elements, inline event handlers and
 * javascript:/vbscript:/data:text/html URLs. UI templates, the bundled icon
 * set and page-derived markup (preview, rich-text sanitizing) all go through
 * here, so nothing assigns `innerHTML` directly.
 */

const DROP_ELEMENTS = 'script, noscript, object, embed, applet, base, meta, link, frame, frameset, portal';
const URL_ATTRS = new Set(['href', 'src', 'xlink:href', 'action', 'formaction', 'data', 'poster', 'srcset']);
const UNSAFE_URL = /^\s*(javascript|vbscript|data:text\/html)/i;

/**
 * Parse HTML into the <body> of a fresh inert document and sanitize it.
 * Read it (innerHTML, querySelector…) or move its children elsewhere.
 * @param {string} html
 * @returns {HTMLBodyElement}
 */
export function parseInert(html) {
  const doc = new DOMParser().parseFromString(`<!doctype html><html><body>${html ?? ''}</body></html>`, 'text/html');
  sanitizeTree(doc.body);
  return doc.body;
}

/**
 * Sanitized DocumentFragment owned by `ownerDoc`, ready to insert.
 * @param {Document} ownerDoc
 * @param {string} html
 */
export function safeFragment(ownerDoc, html) {
  const body = parseInert(html);
  const fragment = ownerDoc.createDocumentFragment();
  for (const node of [...body.childNodes]) fragment.appendChild(ownerDoc.importNode(node, true));
  return fragment;
}

/** Replace `el`'s children with the sanitized markup. */
export function setSafeHTML(el, html) {
  el.replaceChildren(safeFragment(el.ownerDocument, html));
}

/** Remove executable parts from a parsed subtree, in place. */
export function sanitizeTree(root) {
  for (const el of root.querySelectorAll(DROP_ELEMENTS)) el.remove();
  for (const el of root.querySelectorAll('*')) {
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase();
      if (name.startsWith('on')) el.removeAttribute(attr.name);
      else if (URL_ATTRS.has(name) && UNSAFE_URL.test(attr.value)) el.removeAttribute(attr.name);
    }
    // SVG animation can (re)write href / event attributes after insertion.
    if (/^(set|animate)$/i.test(el.localName) && /^(on|href|xlink:href)/i.test(el.getAttribute('attributeName') || '')) {
      el.remove();
    }
  }
  return root;
}
