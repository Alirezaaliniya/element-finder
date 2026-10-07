/**
 * ExportDialog — format picker driven by the Export Engine registry,
 * runs validation first, streams asset-package progress, and downloads
 * the produced artifacts.
 */

import { t } from '../../../common/i18n.js';
import { icon } from '../../shared/icons.js';
import { exportableElementCount } from '../../../engines/export/ExportEngine.js';

export class ExportDialog {
  /**
   * @param {HTMLDialogElement} dialog
   * @param {import('../store.js').BuilderStore} store
   * @param {import('../../../engines/export/ExportEngine.js').ExportEngine} exportEngine
   * @param {import('./ValidationPanel.js').ValidationPanel} validationPanel
   * @param {(msg: string, kind?: string) => void} toast
   */
  constructor(dialog, store, exportEngine, validationPanel, toast) {
    this.dialog = dialog;
    this.store = store;
    this.exportEngine = exportEngine;
    this.validationPanel = validationPanel;
    this.toast = toast;
  }

  open() {
    const formats = this.exportEngine.formats();
    const count = exportableElementCount(this.store.snapshot);

    this.dialog.innerHTML = `
      <div class="dialog-head">
        <span>${t('export.title', { count })}</span>
        <button data-close title="${t('export.cancel')}">${icon('close', { size: 16 })}</button>
      </div>
      <div class="dialog-body">
        ${formats.map((f, i) => `
          <label class="export-format">
            <input type="checkbox" value="${f.id}" ${i === 0 ? 'checked' : ''}>
            <span>
              <strong>${f.label} <small>(.${f.extension})</small></strong>
              <small>${f.description}</small>
            </span>
          </label>`).join('')}
        ${elementorOptionsHtml(this.store.snapshot)}
        <div class="export-progress" data-progress></div>
      </div>
      <div class="dialog-foot">
        <label style="margin-inline-end:auto;display:flex;gap:6px;align-items:center;font-size:12px;color:var(--muted)">
          <input type="checkbox" data-skip-validation style="width:auto"> ${t('export.skipValidation')}
        </label>
        <button data-close>${t('export.cancel')}</button>
        <button class="primary" data-run>${t('export.run')}</button>
      </div>`;

    for (const btn of this.dialog.querySelectorAll('[data-close]')) {
      btn.addEventListener('click', () => this.dialog.close());
    }
    this.dialog.querySelector('[data-run]').addEventListener('click', () => this.#run());
    this.dialog.showModal();
  }

  async #run() {
    const checked = [...this.dialog.querySelectorAll('.export-format input:checked')].map((i) => i.value);
    if (!checked.length) { this.toast(t('export.pickFormat'), 'error'); return; }
    const skipValidation = this.dialog.querySelector('[data-skip-validation]').checked;
    const progressEl = this.dialog.querySelector('[data-progress]');
    const runBtn = this.dialog.querySelector('[data-run]');
    runBtn.disabled = true;

    try {
      // Validate once up front so the report shows in the main panel too.
      if (!skipValidation) {
        const report = this.validationPanel.runValidation();
        if (!report.ok) {
          progressEl.textContent = t('export.blocked', { count: report.counts.error });
          runBtn.disabled = false;
          return;
        }
      }

      for (const formatId of checked) {
        progressEl.textContent = t('export.building', { format: formatId });
        const { artifacts } = await this.exportEngine.export(formatId, this.store.snapshot, {
          title: this.store.project?.name,
          keepGlobals: !!this.dialog.querySelector('[data-keep-globals]')?.checked,
          atomic: this.dialog.querySelector('[data-atomic-mode]')?.value ?? 'keep',
          skipValidation: true, // already validated above
          onProgress: ({ current, total, asset }) => {
            progressEl.textContent = t('export.packaging', { current, total, asset });
          },
        });
        for (const { filename, blob } of artifacts) downloadBlob(filename, blob);
      }
      progressEl.textContent = t('export.done');
      this.toast(t('export.exported', { count: checked.length }));
    } catch (err) {
      progressEl.textContent = String(err?.message || err);
      this.toast(t('export.failed'), 'error');
    } finally {
      runBtn.disabled = false;
    }
  }
}

/** Options that only matter for snapshots taken from an Elementor-built page. */
function elementorOptionsHtml(snapshot) {
  if (!snapshot?.meta?.elementor) return '';
  let hasAtomic = false;
  (function walk(n) {
    if (!n || hasAtomic) return;
    if (n.semantic?.elementorNative?.atomic) { hasAtomic = true; return; }
    for (const c of n.children ?? []) walk(c);
  })(snapshot.tree);
  return `
    <fieldset class="export-elementor">
      <legend>${t('export.elementorOptions')}</legend>
      <label><input type="checkbox" data-keep-globals style="width:auto"> ${t('export.keepGlobals')}</label>
      ${hasAtomic ? `
      <label>${t('export.atomicMode')}
        <select data-atomic-mode>
          <option value="keep">${t('export.atomicKeep')}</option>
          <option value="classic">${t('export.atomicClassic')}</option>
        </select>
      </label>` : ''}
    </fieldset>`;
}

function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
