/**
 * PreviewPane — live visual reconstruction inside a same-origin extension
 * iframe (preview.html). Markup and CSS are injected directly through
 * contentDocument: MV3 extension CSP (script-src 'self') forbids the inline
 * scripts a srcdoc document would need, so all behaviour (click-to-select,
 * highlight) is attached from this side instead.
 */

import { debounce } from '../../../common/utils.js';
import { safeFragment } from '../../../common/safe-html.js';
import { ReconstructionEngine } from '../../../engines/reconstruction/ReconstructionEngine.js';

export class PreviewPane {
  /**
   * @param {HTMLIFrameElement} iframe (src="preview.html")
   * @param {import('../store.js').BuilderStore} store
   */
  constructor(iframe, store) {
    this.iframe = iframe;
    this.store = store;
    this.engine = new ReconstructionEngine();
    this.ready = false;
    this.pending = false;
    this.fontBlobCache = new Map(); // font url -> blob: url (or original on failure)
    this.render = debounce(() => this.#render(), 150);

    store.events.on('snapshot', () => this.render());
    store.events.on('tree', () => this.render());
    store.events.on('device', (device) => this.#applyDevice(device));
    store.events.on('selection', (id) => this.#highlight(id));

    this.iframe.addEventListener('load', () => {
      this.ready = true;
      this.#wireDocument();
      if (this.pending) { this.pending = false; this.#render(); }
    });
    // The iframe may already be loaded by the time we construct.
    if (this.iframe.contentDocument?.readyState === 'complete' &&
        this.iframe.contentDocument.getElementById('ef-base')) {
      this.ready = true;
      this.#wireDocument();
    }
  }

  get doc() {
    return this.iframe.contentDocument;
  }

  #wireDocument() {
    const doc = this.doc;
    if (!doc || doc.__efWired) return;
    doc.__efWired = true;
    doc.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const el = e.target.closest('[data-ef-id]');
      if (el) this.store.select(el.dataset.efId);
    }, true);
  }

  #render() {
    const snapshot = this.store.snapshot;
    if (!snapshot) return;
    if (!this.ready) { this.pending = true; return; }

    const doc = this.doc;
    const { bodyHtml, pageCss, baseCss, dir, lang } = this.engine.buildPreviewParts(snapshot, {
      device: this.store.device,
    });
    doc.documentElement.dir = dir;
    doc.documentElement.lang = lang;
    doc.getElementById('ef-base').textContent = baseCss;
    doc.getElementById('ef-page').textContent = pageCss;
    // The reconstruction carries HTML/SVG taken from the scanned site; strip
    // anything active before it enters this (privileged) extension page.
    doc.body.replaceChildren(safeFragment(doc, bodyHtml));
    this.#applyDevice(this.store.device);
    this.#highlight(this.store.selectedId);
    void this.#injectFonts(snapshot);
  }

  /**
   * Webfonts are CORS-guarded subresources: a `src:url(https://site/font.woff2)`
   * inside the chrome-extension:// preview is blocked unless the site sends
   * CORS headers (most don't) — the text silently falls back to system fonts.
   * The extension itself CAN fetch them (host_permissions), so load each font
   * binary once and serve it to the iframe as a same-origin blob: URL.
   */
  async #injectFonts(snapshot) {
    const styleEl = this.doc?.getElementById('ef-fonts');
    if (!styleEl) return;
    const fonts = (snapshot.assets ?? []).filter((a) => a.type === 'font' && a.url && a.meta?.family);
    if (!fonts.length) { styleEl.textContent = ''; return; }
    const rules = await Promise.all(fonts.map(async (a) => {
      const src = await this.#fontBlobUrl(a.url);
      return `@font-face{font-family:"${a.meta.family.replace(/"/g, '')}";src:url("${src}");` +
        `font-weight:${a.meta.weight || 'normal'};font-style:${a.meta.style || 'normal'};font-display:swap}`;
    }));
    // Guard against a stale async write after the project changed mid-fetch.
    if (this.store.snapshot === snapshot && this.doc?.getElementById('ef-fonts')) {
      this.doc.getElementById('ef-fonts').textContent = rules.join('\n');
    }
  }

  async #fontBlobUrl(url) {
    if (this.fontBlobCache.has(url)) return this.fontBlobCache.get(url);
    let result = url; // fall back to the original URL (works when the host sends CORS)
    try {
      const res = await fetch(url, { credentials: 'omit' });
      if (res.ok) result = URL.createObjectURL(await res.blob());
    } catch { /* keep original */ }
    this.fontBlobCache.set(url, result);
    return result;
  }

  #applyDevice(device) {
    this.iframe.classList.remove('tablet', 'mobile');
    if (device !== 'desktop') this.iframe.classList.add(device);
    const sizeEl = document.getElementById('preview-size');
    if (sizeEl) {
      sizeEl.textContent = device === 'desktop' ? 'responsive' : device === 'tablet' ? '≤1024px' : '≤767px';
    }
  }

  #highlight(id) {
    const doc = this.doc;
    if (!doc?.body) return;
    for (const el of doc.querySelectorAll('.ef-selected')) el.classList.remove('ef-selected');
    if (!id) return;
    const el = doc.querySelector(`[data-ef-id="${CSS.escape(id)}"]`);
    if (el) {
      el.classList.add('ef-selected');
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }
}
