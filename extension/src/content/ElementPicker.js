/**
 * ElementPicker — interactive overlay for "extract just this element".
 * Highlights the hovered element, Esc cancels, click confirms.
 * Resolves with the chosen Element or null.
 */
export class ElementPicker {
  #overlay = null;
  #label = null;
  #resolve = null;
  #current = null;
  #onMove = this.#handleMove.bind(this);
  #onClick = this.#handleClick.bind(this);
  #onKey = this.#handleKey.bind(this);

  /** @returns {Promise<Element|null>} */
  pick() {
    if (this.#resolve) return Promise.resolve(null); // already picking
    this.#mount();
    return new Promise((resolve) => { this.#resolve = resolve; });
  }

  cancel() {
    this.#finish(null);
  }

  #mount() {
    const overlay = document.createElement('div');
    overlay.setAttribute('data-ef-picker', '');
    Object.assign(overlay.style, {
      position: 'fixed', zIndex: '2147483646', pointerEvents: 'none',
      border: '2px solid #7c5cff', background: 'rgba(124,92,255,0.12)',
      borderRadius: '3px', transition: 'all 40ms linear', display: 'none',
    });
    const label = document.createElement('div');
    Object.assign(label.style, {
      position: 'fixed', zIndex: '2147483647', pointerEvents: 'none',
      background: '#1d1733', color: '#fff', font: '12px/1.6 system-ui',
      padding: '2px 8px', borderRadius: '4px', display: 'none', maxWidth: '60vw',
      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    });
    document.documentElement.append(overlay, label);
    this.#overlay = overlay;
    this.#label = label;

    document.addEventListener('mousemove', this.#onMove, true);
    document.addEventListener('click', this.#onClick, true);
    document.addEventListener('keydown', this.#onKey, true);
    document.documentElement.style.cursor = 'crosshair';
  }

  #handleMove(e) {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || el === this.#overlay || el === this.#label || el.closest?.('[data-ef-picker]')) return;
    this.#current = el;
    const r = el.getBoundingClientRect();
    Object.assign(this.#overlay.style, {
      display: 'block', left: `${r.left}px`, top: `${r.top}px`,
      width: `${r.width}px`, height: `${r.height}px`,
    });
    const cls = el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
    this.#label.textContent = `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${cls}  —  click to extract, Esc to cancel`;
    Object.assign(this.#label.style, {
      display: 'block',
      left: `${Math.min(r.left, innerWidth - 320)}px`,
      top: `${r.top > 28 ? r.top - 26 : r.bottom + 6}px`,
    });
  }

  #handleClick(e) {
    e.preventDefault();
    e.stopImmediatePropagation();
    this.#finish(this.#current);
  }

  #handleKey(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopImmediatePropagation();
      this.#finish(null);
    }
  }

  #finish(el) {
    document.removeEventListener('mousemove', this.#onMove, true);
    document.removeEventListener('click', this.#onClick, true);
    document.removeEventListener('keydown', this.#onKey, true);
    document.documentElement.style.cursor = '';
    this.#overlay?.remove();
    this.#label?.remove();
    this.#overlay = this.#label = this.#current = null;
    const resolve = this.#resolve;
    this.#resolve = null;
    resolve?.(el);
  }
}
