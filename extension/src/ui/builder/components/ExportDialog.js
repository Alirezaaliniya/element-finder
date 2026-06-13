/**
 * ExportDialog — format picker driven by the Export Engine registry,
 * runs validation first, streams asset-package progress, and downloads
 * the produced artifacts.
 */

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
        <span>Export — ${count} elements</span>
        <button data-close>✕</button>
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
        <div class="export-progress" data-progress></div>
      </div>
      <div class="dialog-foot">
        <label style="margin-inline-end:auto;display:flex;gap:6px;align-items:center;font-size:12px;color:var(--muted)">
          <input type="checkbox" data-skip-validation style="width:auto"> Skip validation errors
        </label>
        <button data-close>Cancel</button>
        <button class="primary" data-run>Export selected</button>
      </div>`;

    for (const btn of this.dialog.querySelectorAll('[data-close]')) {
      btn.addEventListener('click', () => this.dialog.close());
    }
    this.dialog.querySelector('[data-run]').addEventListener('click', () => this.#run());
    this.dialog.showModal();
  }

  async #run() {
    const checked = [...this.dialog.querySelectorAll('.export-format input:checked')].map((i) => i.value);
    if (!checked.length) { this.toast('Pick at least one format.', 'error'); return; }
    const skipValidation = this.dialog.querySelector('[data-skip-validation]').checked;
    const progressEl = this.dialog.querySelector('[data-progress]');
    const runBtn = this.dialog.querySelector('[data-run]');
    runBtn.disabled = true;

    try {
      // Validate once up front so the report shows in the main panel too.
      if (!skipValidation) {
        const report = this.validationPanel.runValidation();
        if (!report.ok) {
          progressEl.textContent = `Blocked: ${report.counts.error} validation error(s). Fix them below or tick "Skip validation errors".`;
          runBtn.disabled = false;
          return;
        }
      }

      for (const formatId of checked) {
        progressEl.textContent = `Building ${formatId}…`;
        const { artifacts } = await this.exportEngine.export(formatId, this.store.snapshot, {
          title: this.store.project?.name,
          skipValidation: true, // already validated above
          onProgress: ({ current, total, asset }) => {
            progressEl.textContent = `Packaging assets ${current}/${total} — ${asset}`;
          },
        });
        for (const { filename, blob } of artifacts) downloadBlob(filename, blob);
      }
      progressEl.textContent = 'Done — check your downloads.';
      this.toast(`Exported ${checked.length} format(s).`);
    } catch (err) {
      progressEl.textContent = String(err?.message || err);
      this.toast('Export failed — see dialog for details.', 'error');
    } finally {
      runBtn.disabled = false;
    }
  }
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
