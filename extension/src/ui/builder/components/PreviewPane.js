/**
 * PreviewPane — live visual reconstruction inside a same-origin extension
 * iframe (preview.html). Markup and CSS are injected directly through
 * contentDocument: MV3 extension CSP (script-src 'self') forbids the inline
 * scripts a srcdoc document would need, so all behaviour (click-to-select,
 * highlight) is attached from this side instead.
 */

import { debounce } from '../../../common/utils.js';
import { safeFragment } from '../../../common/safe-html.js';
import { previewMode, ReconstructionEngine } from '../../../engines/reconstruction/ReconstructionEngine.js';

const DEVICE_WIDTH = { tablet: 1024, mobile: 390 };

/** The width the page was extracted at; Elementor's desktop starts at 1025px. */
function desktopWidth(snapshot) {
  const w = snapshot?.meta?.viewport?.width ?? 0;
  return w > 1024 ? w : 1440;
}

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
    // 'source' (the page's own CSS) or 'interpreted' (Elementor settings only).
    this.mode = 'source';
    this.modeSwitch = document.getElementById('preview-mode');
    this.modeSwitch?.addEventListener('click', (e) => {
      const mode = e.target.closest('[data-mode]')?.dataset.mode;
      if (!mode || mode === this.mode) return;
      this.mode = mode;
      this.#render();
    });

    store.events.on('snapshot', () => this.render());
    store.events.on('tree', () => this.render());
    store.events.on('device', (device) => this.#applyDevice(device));
    store.events.on('selection', (id) => this.#highlight(id));
    const stage = this.iframe.parentElement?.parentElement;
    if (stage) new ResizeObserver(() => this.#applyDevice(this.store.device)).observe(stage);

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
    // Source-styled previews keep real <form>s; Enter in a field must not
    // navigate the preview away.
    doc.addEventListener('submit', (e) => e.preventDefault(), true);
  }

  #render() {
    const snapshot = this.store.snapshot;
    if (!snapshot) return;
    if (!this.ready) { this.pending = true; return; }

    const doc = this.doc;
    const mode = previewMode(snapshot, this.mode);
    this.#syncModeSwitch(snapshot, mode);
    const { bodyHtml, pageCss, baseCss, dir, lang } = this.engine.buildPreviewParts(snapshot, {
      device: this.store.device,
      mode,
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

  /** The switch only exists for snapshots that carry source styles. */
  #syncModeSwitch(snapshot, mode) {
    if (!this.modeSwitch) return;
    this.modeSwitch.classList.toggle('hidden', !snapshot.sourceStyles?.css);
    for (const btn of this.modeSwitch.querySelectorAll('[data-mode]')) {
      btn.classList.toggle('active', btn.dataset.mode === mode);
    }
  }

  /**
   * Render at the device's real width and scale down to fit the pane. At
   * the pane's own width (~800px) a site's media queries would show its
   * tablet layout even in the desktop view.
   */
  #applyDevice(device) {
    const frame = this.iframe.parentElement;
    const stage = frame?.parentElement;
    const target = device === 'desktop' ? desktopWidth(this.store.snapshot) : DEVICE_WIDTH[device] ?? 1024;
    let scale = 1;
    if (stage?.clientWidth) {
      const cs = getComputedStyle(stage);
      const availW = stage.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      const availH = stage.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
      scale = Math.min(1, availW / target);
      frame.style.width = `${Math.floor(target * scale)}px`;
      frame.style.height = `${availH}px`;
      this.iframe.style.width = `${target}px`;
      this.iframe.style.height = `${availH / scale}px`;
      this.iframe.style.transform = scale < 1 ? `scale(${scale})` : '';
    }
    const sizeEl = document.getElementById('preview-size');
    if (sizeEl) sizeEl.textContent = scale < 1 ? `${target}px · ${Math.round(scale * 100)}%` : `${target}px`;
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
