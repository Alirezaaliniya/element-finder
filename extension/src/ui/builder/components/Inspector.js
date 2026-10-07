/**
 * Inspector — detail panel for the selected node: identity, mapping decision
 * (with confidence and re-mapping dropdown from the widget catalog), text
 * editing, link editing, image replacement, settings preview per device,
 * warnings and remove/restore.
 */

import { DEVICE_ORDER, EL_TYPES } from '../../../common/constants.js';
import { escapeHtml } from '../../../common/utils.js';
import { getLang, t, WIDGET_SYNONYMS_FA } from '../../../common/i18n.js';
import { widgetOptionsByCategory, widgetInfo } from '../../../engines/mapping/widget-catalog.js';
import { icon } from '../../shared/icons.js';

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
      this.root.innerHTML = `<p class="empty">${escapeHtml(t('insp.selectPrompt'))}</p>`;
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
    kv(t('insp.label'), node.label);
    kv(t('insp.tag'), `<${node.tag}>`);
    kv(t('insp.id'), node.id);
    if (node.semantic.kind) kv(t('insp.semantic'), node.semantic.kind);
    if (node.semantic.isRepeated) kv(t('insp.pattern'), node.semantic.patternKey);
    if (node.semantic.elementorNative) kv(t('insp.source'), `Elementor ${node.semantic.elementorNative.widgetType ?? node.semantic.elementorNative.elType}`);
    if (node.rect) kv(t('insp.size'), `${node.rect.width}×${node.rect.height}px`);
    return this.#section(t('insp.element'), dl);
  }

  #mappingSection(node) {
    const m = node.mapping;
    const conf = m?.confidence ?? 0;
    const bar = el('div', `confidence-bar ${conf < 0.5 ? 'low' : conf < 0.8 ? 'mid' : ''}`);
    const fill = el('i');
    fill.style.width = `${Math.round(conf * 100)}%`;
    bar.appendChild(fill);

    const meta = el('div', 'insp-row');
    const metaLabel = document.createElement('label');
    metaLabel.textContent = t('insp.mappedBy', {
      source: m?.source ?? 'n/a',
      rule: m?.ruleId ? t('insp.ruleSuffix', { rule: m.ruleId }) : '',
      confidence: (conf * 100) | 0,
    });
    meta.appendChild(metaLabel);

    const row = el('div', 'insp-row');
    row.append(label(t('insp.widgetMapping')), this.#widgetPicker(node));

    const sec = this.#section(t('insp.mapping'), row, bar, meta);

    if (m?.alternatives?.length) {
      const alts = el('div', 'insp-row');
      alts.appendChild(label(t('insp.alternatives')));
      for (const alt of m.alternatives.slice(0, 3)) {
        const btn = document.createElement('button');
        btn.textContent = `${alt.widgetType ?? t('tree.container')} (${((alt.confidence ?? 0) * 100) | 0}%)`;
        btn.addEventListener('click', () => this.store.changeMapping(node.id, {
          elType: alt.elType, widgetType: alt.widgetType,
        }));
        alts.appendChild(btn);
      }
      sec.appendChild(alts);
    }
    return sec;
  }

  /**
   * Searchable widget picker: a search input over the full catalog (plus the
   * container option and any third-party current value), grouped by category.
   * In Persian, widget types also match their فارسی synonyms.
   */
  #widgetPicker(node) {
    const m = node.mapping;
    const currentValue = m?.elType === EL_TYPES.CONTAINER ? '@container' : (m?.widgetType ?? '');
    const fa = getLang() === 'fa';

    const options = [{
      value: '@container', label: t('insp.containerOption'), tier: 'free', category: 'layout',
      haystack: `container layout ${t('insp.containerOption')} ${fa ? 'کانتینر چیدمان' : ''}`.toLowerCase(),
    }];
    for (const [category, opts] of Object.entries(widgetOptionsByCategory())) {
      for (const opt of opts) {
        options.push({
          value: opt.type, label: opt.label, tier: opt.tier, category,
          haystack: `${opt.label} ${opt.type} ${category} ${fa ? WIDGET_SYNONYMS_FA[opt.type] ?? '' : ''}`.toLowerCase(),
        });
      }
    }
    if (m?.widgetType && !widgetInfo(m.widgetType)) {
      options.push({
        value: m.widgetType, label: `${m.widgetType} (${t('insp.thirdParty')})`,
        tier: 'free', category: t('insp.thirdParty'), haystack: m.widgetType.toLowerCase(),
      });
    }
    const currentLabel = options.find((o) => o.value === currentValue)?.label ?? currentValue;

    const wrap = el('div', 'widget-picker');
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'widget-picker-input';
    input.placeholder = t('insp.searchWidget');
    input.value = currentLabel;
    input.setAttribute('spellcheck', 'false');
    const list = el('div', 'widget-picker-list hidden');
    wrap.append(input, list);

    const pick = (opt) => {
      list.classList.add('hidden');
      input.value = opt.label;
      this.store.changeMapping(node.id, opt.value === '@container'
        ? { elType: EL_TYPES.CONTAINER, widgetType: null }
        : { elType: EL_TYPES.WIDGET, widgetType: opt.value });
    };

    const renderList = (query) => {
      const q = query.trim().toLowerCase();
      const visible = q ? options.filter((o) => o.haystack.includes(q)) : options;
      list.textContent = '';
      if (!visible.length) {
        list.appendChild(el('div', 'widget-picker-empty', t('insp.noResults')));
        return visible;
      }
      let lastCategory = null;
      for (const opt of visible) {
        if (opt.category !== lastCategory) {
          lastCategory = opt.category;
          list.appendChild(el('div', 'widget-picker-group', opt.category));
        }
        const item = el('div', `widget-picker-item${opt.value === currentValue ? ' current' : ''}`);
        item.appendChild(el('span', '', opt.label));
        if (opt.tier !== 'free') item.appendChild(el('small', 'tier', opt.tier));
        // mousedown fires before the input's blur, so the pick always lands.
        item.addEventListener('mousedown', (e) => { e.preventDefault(); pick(opt); });
        list.appendChild(item);
      }
      return visible;
    };

    let lastVisible = options;
    input.addEventListener('focus', () => {
      input.select();
      lastVisible = renderList('');
      list.classList.remove('hidden');
    });
    input.addEventListener('input', () => {
      lastVisible = renderList(input.value);
      list.classList.remove('hidden');
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && lastVisible.length) { e.preventDefault(); pick(lastVisible[0]); input.blur(); }
      if (e.key === 'Escape') { input.value = currentLabel; list.classList.add('hidden'); input.blur(); }
    });
    input.addEventListener('blur', () => {
      // Let a mousedown pick land first; then restore the label if nothing chosen.
      setTimeout(() => { list.classList.add('hidden'); if (document.activeElement !== input) input.value = currentLabel; }, 120);
    });
    return wrap;
  }

  #contentSections(node) {
    const sections = [];
    const c = node.content;

    if (c.text !== undefined || c.headerSize) {
      const ta = document.createElement('textarea');
      ta.rows = 3;
      ta.value = c.text ?? '';
      ta.addEventListener('change', () => this.store.updateText(node.id, ta.value));
      sections.push(this.#section(t('insp.text'), wrapRow(t('insp.editableText'), ta)));
    }

    if (node.tag === 'a' || c.href !== undefined || node.mapping?.widgetType === 'button') {
      const input = document.createElement('input');
      input.type = 'url';
      input.placeholder = 'https://…';
      input.value = c.href ?? '';
      input.addEventListener('change', () => this.store.updateLink(node.id, input.value));
      sections.push(this.#section(t('insp.link'), wrapRow(t('insp.destinationUrl'), input)));
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
      input.placeholder = 'https://…';
      input.value = c.src ?? '';
      input.addEventListener('change', () => this.store.replaceImage(node.id, input.value));
      sections.push(this.#section(t('insp.image'), fig, wrapRow(t('insp.imageUrl'), input)));
    }

    if (c.fields?.length) {
      const list = el('div', 'insp-row');
      list.innerHTML = `<label>${escapeHtml(t('insp.formFields', { count: c.fields.length }))}</label>` +
        c.fields.slice(0, 8).map((f) => `<div>· ${escapeHtml(f.label || f.name || f.type)} <small>(${escapeHtml(f.type)}${f.required ? `, ${escapeHtml(t('insp.required'))}` : ''})</small></div>`).join('');
      sections.push(this.#section(t('insp.form'), list));
    }

    if (c.menu?.length) {
      const list = el('div', 'insp-row');
      list.innerHTML = `<label>${escapeHtml(t('insp.menuItems'))}</label>` +
        c.menu.slice(0, 10).map((m) => `<div>· ${escapeHtml(m.text)}${m.children?.length ? ` <small>(${escapeHtml(t('insp.subItems', { count: m.children.length }))})</small>` : ''}</div>`).join('');
      sections.push(this.#section(t('insp.menu'), list));
    }
    return sections;
  }

  #settingsSection(node) {
    const wrap = el('div', 'insp-row');
    const block = (title, value, open = false) => {
      const details = document.createElement('details');
      details.open = open;
      const summary = document.createElement('summary');
      summary.textContent = title;
      details.appendChild(summary);
      const pre = document.createElement('pre');
      pre.style.cssText = 'font-size:10.5px;overflow:auto;max-height:160px;background:var(--bg-2);padding:8px;border-radius:6px';
      pre.textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 1);
      details.appendChild(pre);
      wrap.appendChild(details);
    };

    // Elementor-built source: the settings recovered from its generated CSS
    // are what the export uses while the node keeps its native mapping.
    const native = node.semantic.elementorNative;
    const nativeMapped = node.mapping?.source === 'elementor-native';
    if (native?.exact?.controlsKnown && nativeMapped) {
      const exact = { ...(native.content ?? {}), ...native.exact.settings };
      block(t('insp.exactSettings', { count: Object.keys(exact).length }), exact, true);
      if (Object.keys(native.exact.globals ?? {}).length) block(t('insp.globalRefs'), native.exact.globals);
      if (native.exact.customCss) block(t('insp.customCss'), native.exact.customCss);
    }
    if (native?.atomicData && nativeMapped) {
      block(t('insp.atomicSettings'), native.atomicData.settings, true);
      if (Object.keys(native.atomicData.styles ?? {}).length) block(t('insp.atomicStyles'), native.atomicData.styles);
    }

    for (const device of DEVICE_ORDER) {
      const settings = node.settings[device];
      const keys = Object.keys(settings ?? {});
      if (!keys.length) continue;
      block(t('insp.deviceSettings', { device, count: keys.length }), settings, device === 'desktop' && !wrap.children.length);
    }
    if (!wrap.children.length) wrap.appendChild(el('div', '', t('insp.noSettings')));
    return this.#section(t('insp.settings'), wrap);
  }

  #warningsSection(node) {
    const wrap = el('div', 'insp-row');
    for (const w of node.warnings) wrap.appendChild(el('div', 'insp-warning', w));
    return this.#section(t('insp.warnings'), wrap);
  }

  #actionsSection(node) {
    const actions = el('div', 'insp-actions');
    const removeBtn = document.createElement('button');
    removeBtn.className = node.hidden ? '' : 'danger';
    removeBtn.innerHTML = `${icon(node.hidden ? 'restore' : 'trash', { size: 16 })}<span>${escapeHtml(node.hidden ? t('insp.restore') : t('insp.remove'))}</span>`;
    removeBtn.addEventListener('click', () => {
      if (node.hidden) this.store.restoreNode(node.id); else this.store.removeNode(node.id);
    });
    actions.appendChild(removeBtn);
    return this.#section(t('insp.actions'), actions);
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
