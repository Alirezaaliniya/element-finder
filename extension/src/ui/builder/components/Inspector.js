/**
 * Inspector — detail panel for the selected node: identity, mapping decision
 * (with confidence and re-mapping dropdown from the widget catalog), text
 * editing, link editing, image replacement, settings preview per device,
 * warnings and remove/restore.
 */

import { DEVICE_ORDER, EL_TYPES } from '../../../common/constants.js';
import { escapeHtml } from '../../../common/utils.js';
import { widgetOptionsByCategory, widgetInfo } from '../../../engines/mapping/widget-catalog.js';

export class Inspector {
  /**
   * @param {HTMLElement} root
   * @param {import('../store.js').BuilderStore} store
   */
  constructor(root, store) {
    this.root = root;
    this.store = store;
    store.events.on('selection', () => this.render());
    store.events.on('tree', () => this.render());
    store.events.on('snapshot', () => this.render());
  }

  render() {
    const node = this.store.selectedNode();
    this.root.textContent = '';
    if (!node) {
      this.root.innerHTML = '<p class="empty">Select an element in the tree or preview.</p>';
      return;
    }

    this.root.append(
      this.#identitySection(node),
      this.#mappingSection(node),
      ...this.#contentSections(node),
      this.#settingsSection(node),
      ...(node.warnings.length ? [this.#warningsSection(node)] : []),
      this.#actionsSection(node),
    );
  }

  #section(title, ...children) {
    const sec = el('div', 'insp-section');
    sec.appendChild(el('h3', '', title));
    sec.append(...children);
    return sec;
  }

  #identitySection(node) {
    const dl = el('dl', 'insp-kv');
    const kv = (k, v) => {
      dl.appendChild(el('dt', '', k));
      dl.appendChild(el('dd', '', v ?? '—'));
    };
    kv('Label', node.label);
    kv('Tag', `<${node.tag}>`);
    kv('Id', node.id);
    if (node.semantic.kind) kv('Semantic', node.semantic.kind);
    if (node.semantic.isRepeated) kv('Pattern', node.semantic.patternKey);
    if (node.semantic.elementorNative) kv('Source', `Elementor ${node.semantic.elementorNative.widgetType ?? node.semantic.elementorNative.elType}`);
    if (node.rect) kv('Size', `${node.rect.width}×${node.rect.height}px`);
    return this.#section('Element', dl);
  }

  #mappingSection(node) {
    const m = node.mapping;
    const conf = m?.confidence ?? 0;
    const bar = el('div', `confidence-bar ${conf < 0.5 ? 'low' : conf < 0.8 ? 'mid' : ''}`);
    const fill = el('i');
    fill.style.width = `${Math.round(conf * 100)}%`;
    bar.appendChild(fill);

    const meta = el('div', 'insp-row');
    meta.innerHTML = `<label>Mapped by ${escapeHtml(m?.source ?? 'n/a')}${m?.ruleId ? ` · rule “${escapeHtml(m.ruleId)}”` : ''} · confidence ${(conf * 100) | 0}%</label>`;

    const select = document.createElement('select');
    select.appendChild(new Option('Container (layout)', '@container', false, m?.elType === EL_TYPES.CONTAINER));
    for (const [category, options] of Object.entries(widgetOptionsByCategory())) {
      const group = document.createElement('optgroup');
      group.label = category;
      for (const opt of options) {
        const o = new Option(
          `${opt.label}${opt.tier !== 'free' ? ` (${opt.tier})` : ''}`,
          opt.type,
          false,
          m?.elType === EL_TYPES.WIDGET && m?.widgetType === opt.type,
        );
        group.appendChild(o);
      }
      select.appendChild(group);
    }
    // Unknown third-party widget — keep it selectable.
    if (m?.widgetType && !widgetInfo(m.widgetType)) {
      select.appendChild(new Option(`${m.widgetType} (third-party)`, m.widgetType, false, true));
    }
    select.addEventListener('change', () => {
      const v = select.value;
      this.store.changeMapping(node.id, v === '@container'
        ? { elType: EL_TYPES.CONTAINER, widgetType: null }
        : { elType: EL_TYPES.WIDGET, widgetType: v });
    });

    const row = el('div', 'insp-row');
    row.append(label('Widget mapping'), select);

    const sec = this.#section('Mapping', row, bar, meta);

    if (m?.alternatives?.length) {
      const alts = el('div', 'insp-row');
      alts.appendChild(label('Alternatives'));
      for (const alt of m.alternatives.slice(0, 3)) {
        const btn = document.createElement('button');
        btn.textContent = `${alt.widgetType ?? 'container'} (${((alt.confidence ?? 0) * 100) | 0}%)`;
        btn.addEventListener('click', () => this.store.changeMapping(node.id, {
          elType: alt.elType, widgetType: alt.widgetType,
        }));
        alts.appendChild(btn);
      }
      sec.appendChild(alts);
    }
    return sec;
  }

  #contentSections(node) {
    const sections = [];
    const c = node.content;

    if (c.text !== undefined || c.headerSize) {
      const ta = document.createElement('textarea');
      ta.rows = 3;
      ta.value = c.text ?? '';
      ta.addEventListener('change', () => this.store.updateText(node.id, ta.value));
      sections.push(this.#section('Text', wrapRow('Editable text', ta)));
    }

    if (node.tag === 'a' || c.href !== undefined || node.mapping?.widgetType === 'button') {
      const input = document.createElement('input');
      input.type = 'url';
      input.placeholder = 'https://…';
      input.value = c.href ?? '';
      input.addEventListener('change', () => this.store.updateLink(node.id, input.value));
      sections.push(this.#section('Link', wrapRow('Destination URL', input)));
    }

    if (node.mapping?.widgetType === 'image' || c.src) {
      const fig = el('div', 'insp-row');
      if (c.src) {
        const img = document.createElement('img');
        img.className = 'thumb';
        img.src = c.src;
        img.alt = c.alt ?? '';
        fig.appendChild(img);
      }
      const input = document.createElement('input');
      input.type = 'url';
      input.placeholder = 'Replace image URL…';
      input.value = c.src ?? '';
      input.addEventListener('change', () => this.store.replaceImage(node.id, input.value));
      sections.push(this.#section('Image', fig, wrapRow('Image URL', input)));
    }

    if (c.fields?.length) {
      const list = el('div', 'insp-row');
      list.innerHTML = `<label>${c.fields.length} form field(s)</label>` +
        c.fields.slice(0, 8).map((f) => `<div>· ${escapeHtml(f.label || f.name || f.type)} <small>(${escapeHtml(f.type)}${f.required ? ', required' : ''})</small></div>`).join('');
      sections.push(this.#section('Form', list));
    }

    if (c.menu?.length) {
      const list = el('div', 'insp-row');
      list.innerHTML = `<label>Menu items</label>` +
        c.menu.slice(0, 10).map((m) => `<div>· ${escapeHtml(m.text)}${m.children?.length ? ` <small>(+${m.children.length} sub)</small>` : ''}</div>`).join('');
      sections.push(this.#section('Menu', list));
    }
    return sections;
  }

  #settingsSection(node) {
    const wrap = el('div', 'insp-row');
    for (const device of DEVICE_ORDER) {
      const settings = node.settings[device];
      const keys = Object.keys(settings ?? {});
      if (!keys.length) continue;
      const details = document.createElement('details');
      if (device === 'desktop') details.open = true;
      const summary = document.createElement('summary');
      summary.textContent = `${device} (${keys.length} settings)`;
      details.appendChild(summary);
      const pre = document.createElement('pre');
      pre.style.cssText = 'font-size:10.5px;overflow:auto;max-height:160px;background:var(--bg-2);padding:8px;border-radius:6px';
      pre.textContent = JSON.stringify(settings, null, 1);
      details.appendChild(pre);
      wrap.appendChild(details);
    }
    if (!wrap.children.length) wrap.appendChild(el('div', '', 'No interpreted settings.'));
    return this.#section('Elementor settings', wrap);
  }

  #warningsSection(node) {
    const wrap = el('div', 'insp-row');
    for (const w of node.warnings) wrap.appendChild(el('div', 'insp-warning', w));
    return this.#section('Warnings', wrap);
  }

  #actionsSection(node) {
    const actions = el('div', 'insp-actions');
    const removeBtn = document.createElement('button');
    removeBtn.className = node.hidden ? '' : 'danger';
    removeBtn.textContent = node.hidden ? '↩ Restore element' : '🗑 Remove from output';
    removeBtn.addEventListener('click', () => {
      if (node.hidden) this.store.restoreNode(node.id); else this.store.removeNode(node.id);
    });
    actions.appendChild(removeBtn);
    return this.#section('Actions', actions);
  }
}

/* helpers */
function el(tag, className = '', text = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}
function label(text) {
  const l = document.createElement('label');
  l.textContent = text;
  return l;
}
function wrapRow(labelText, control) {
  const row = el('div', 'insp-row');
  row.append(label(labelText), control);
  return row;
}
