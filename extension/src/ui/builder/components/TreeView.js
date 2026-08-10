/**
 * TreeView — structure panel. Expand/collapse, selection (synced with
 * preview + inspector), HTML5 drag & drop (reorder / reparent into
 * containers), and inline remove/restore.
 */

import { EL_TYPES } from '../../../common/constants.js';
import { escapeHtml } from '../../../common/utils.js';
import { t } from '../../../common/i18n.js';
import { isProWidget } from '../../../engines/mapping/widget-catalog.js';

const ICONS = {
  container: '▦', heading: 'H', 'text-editor': '¶', image: '🖼', button: '⏺',
  video: '▶', icon: '★', form: '✉', 'nav-menu': '☰', 'icon-list': '≡',
  default: '◻',
};

export class TreeView {
  /**
   * @param {HTMLElement} root
   * @param {import('../store.js').BuilderStore} store
   */
  constructor(root, store) {
    this.root = root;
    this.store = store;
    this.collapsed = new Set();
    this.dragId = null;

    store.events.on('snapshot', () => { this.collapsed.clear(); this.render(); });
    store.events.on('tree', () => this.render());
    store.events.on('selection', () => this.#syncSelection());

    this.root.addEventListener('keydown', (e) => {
      if (e.key === 'Delete' && store.selectedId) {
        store.removeNode(store.selectedId);
      }
    });
  }

  render() {
    const tree = this.store.tree;
    this.root.textContent = '';
    if (!tree) return;
    this.root.appendChild(this.#renderNode(tree, 0));
    this.#syncSelection();
    const countEl = document.getElementById('tree-count');
    if (countEl) countEl.textContent = t('tree.elements', { count: this.store.visibleCount() });
  }

  #renderNode(node, depth) {
    const frag = document.createDocumentFragment();
    const row = document.createElement('div');
    row.className = 'tree-row' + (node.hidden ? ' hidden-node' : '');
    row.dataset.id = node.id;
    row.draggable = depth > 0;

    const hasChildren = node.children.length > 0;
    const isOpen = !this.collapsed.has(node.id);

    const toggle = document.createElement('span');
    toggle.className = `tree-toggle ${hasChildren ? (isOpen ? 'open' : '') : 'leaf'}`;
    toggle.textContent = '▶';
    toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      if (isOpen) this.collapsed.add(node.id); else this.collapsed.delete(node.id);
      this.render();
    });
    row.appendChild(toggle);

    const widgetType = node.mapping?.widgetType;
    const icon = document.createElement('span');
    icon.className = 'tree-icon';
    icon.textContent = node.mapping?.elType === EL_TYPES.CONTAINER
      ? ICONS.container : (ICONS[widgetType] ?? ICONS.default);
    row.appendChild(icon);

    const label = document.createElement('span');
    label.className = 'tree-label';
    label.textContent = node.label || node.tag;
    row.appendChild(label);

    const chip = document.createElement('span');
    const conf = node.mapping?.confidence ?? 0;
    chip.className = 'tree-widget'
      + (widgetType && isProWidget(widgetType) ? ' pro' : '')
      + (conf < 0.5 && node.mapping?.elType === EL_TYPES.WIDGET ? ' low' : '');
    chip.textContent = node.mapping?.elType === EL_TYPES.CONTAINER ? t('tree.container') : (widgetType ?? '?');
    chip.title = t('tree.chipTitle', { confidence: (conf * 100) | 0, source: node.mapping?.source ?? 'n/a' });
    row.appendChild(chip);

    row.addEventListener('click', () => this.store.select(node.id));
    row.addEventListener('dblclick', () => {
      if (node.hidden) this.store.restoreNode(node.id);
    });
    this.#wireDnD(row, node);

    frag.appendChild(row);

    if (hasChildren && isOpen) {
      const kids = document.createElement('div');
      kids.className = 'tree-children';
      for (const child of node.children) kids.appendChild(this.#renderNode(child, depth + 1));
      frag.appendChild(kids);
    }
    return frag;
  }

  #wireDnD(row, node) {
    row.addEventListener('dragstart', (e) => {
      this.dragId = node.id;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', node.id);
    });
    row.addEventListener('dragend', () => { this.dragId = null; this.#clearDropMarks(); });
    row.addEventListener('dragover', (e) => {
      if (!this.dragId || this.dragId === node.id) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      this.#clearDropMarks();
      row.classList.add(`drop-${this.#dropPosition(e, row, node)}`);
    });
    row.addEventListener('dragleave', () => row.classList.remove('drop-inside', 'drop-before', 'drop-after'));
    row.addEventListener('drop', (e) => {
      e.preventDefault();
      const sourceId = this.dragId || e.dataTransfer.getData('text/plain');
      this.#clearDropMarks();
      if (!sourceId) return;
      const ok = this.store.moveNode(sourceId, node.id, this.#dropPosition(e, row, node));
      if (ok) this.store.select(sourceId);
    });
  }

  /** Top quarter -> before, bottom quarter -> after, middle -> inside (containers only). */
  #dropPosition(e, row, node) {
    const rect = row.getBoundingClientRect();
    const ratio = (e.clientY - rect.top) / rect.height;
    const canNest = node.mapping?.elType === EL_TYPES.CONTAINER;
    if (canNest && ratio > 0.3 && ratio < 0.7) return 'inside';
    return ratio < 0.5 ? 'before' : 'after';
  }

  #clearDropMarks() {
    for (const el of this.root.querySelectorAll('.drop-inside,.drop-before,.drop-after')) {
      el.classList.remove('drop-inside', 'drop-before', 'drop-after');
    }
  }

  #syncSelection() {
    for (const el of this.root.querySelectorAll('.tree-row.selected')) el.classList.remove('selected');
    if (!this.store.selectedId) return;
    const row = this.root.querySelector(`.tree-row[data-id="${CSS.escape(this.store.selectedId)}"]`);
    if (row) {
      row.classList.add('selected');
      row.scrollIntoView({ block: 'nearest' });
    } else {
      // Selected node is inside a collapsed branch — expand ancestors.
      this.#expandTo(this.store.selectedId);
    }
  }

  #expandTo(id) {
    const path = [];
    const find = (node) => {
      if (node.id === id) return true;
      for (const child of node.children) {
        if (find(child)) { path.push(node.id); return true; }
      }
      return false;
    };
    if (this.store.tree && find(this.store.tree)) {
      let changed = false;
      for (const pid of path) if (this.collapsed.delete(pid)) changed = true;
      if (changed) {
        this.render();
        this.root.querySelector(`.tree-row[data-id="${CSS.escape(id)}"]`)
          ?.scrollIntoView({ block: 'nearest' });
      }
    }
  }
}

export function widgetIconFor(type) {
  return ICONS[type] ?? ICONS.default;
}

export { escapeHtml };
