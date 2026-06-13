/**
 * PreviewPane — live visual reconstruction inside a same-origin extension
 * iframe (preview.html). Markup and CSS are injected directly through
 * contentDocument: MV3 extension CSP (script-src 'self') forbids the inline
 * scripts a srcdoc document would need, so all behaviour (click-to-select,
 * highlight) is attached from this side instead.
 */

import { debounce } from '../../../common/utils.js';
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
    doc.body.innerHTML = bodyHtml; // generated/sanitized markup; scripts never execute via innerHTML
    this.#applyDevice(this.store.device);
    this.#highlight(this.store.selectedId);
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
