import { setSafeHTML } from '../../../common/safe-html.js';
/**
 * ProjectsPanel — saved-projects dialog: open, delete, list frozen versions,
 * restore a version into the working copy, and compare a version against
 * the current state (structural diff from the Storage Engine).
 */

import { escapeHtml } from '../../../common/utils.js';
import { getLang, t } from '../../../common/i18n.js';
import { icon } from '../../shared/icons.js';
import { ProjectStorageEngine } from '../../../engines/storage/ProjectStorageEngine.js';

export class ProjectsPanel {
  /**
   * @param {HTMLDialogElement} dialog
   * @param {import('../store.js').BuilderStore} store
   * @param {ProjectStorageEngine} storage
   * @param {(msg: string, kind?: string) => void} toast
   */
  constructor(dialog, store, storage, toast) {
    this.dialog = dialog;
    this.store = store;
    this.storage = storage;
    this.toast = toast;
  }

  async open() {
    const projects = await this.storage.listProjects();
    setSafeHTML(this.dialog, `
      <div class="dialog-head"><span>${t('projects.title')}</span><button data-close title="${escapeHtml(t('export.cancel'))}">${icon('close', { size: 16 })}</button></div>
      <div class="dialog-body" data-list>
        ${projects.length ? '' : `<p style="color:var(--muted)">${t('projects.none')}</p>`}
      </div>
      <div class="dialog-foot"><button data-close>${t('projects.close')}</button></div>`);

    const list = this.dialog.querySelector('[data-list]');
    for (const p of projects) list.appendChild(this.#projectRow(p));
    for (const btn of this.dialog.querySelectorAll('[data-close]')) {
      btn.addEventListener('click', () => this.dialog.close());
    }
    this.dialog.showModal();
  }

  #projectRow(p) {
    const row = document.createElement('div');
    row.className = 'project-row';
    setSafeHTML(row, `
      <div class="grow">
        <strong>${escapeHtml(p.name)}</strong>
        <small>${escapeHtml(t('projects.meta', {
          host: shortUrl(p.sourceUrl),
          count: p.elementCount,
          date: new Date(p.updatedAt).toLocaleString(getLang() === 'fa' ? 'fa-IR' : undefined),
        }))}</small>
        <div class="version-list" data-versions></div>
      </div>
      <button data-open>${t('projects.open')}</button>
      <button data-history title="${escapeHtml(t('projects.historyTitle'))}">${icon('version', { size: 16 })}</button>
      <button class="danger" data-delete>${icon('trash', { size: 16 })}</button>`);

    row.querySelector('[data-open]').addEventListener('click', async () => {
      const full = await this.storage.getProject(p.id);
      if (!full) { this.toast(t('projects.notFound'), 'error'); return; }
      this.store.loadProject(full);
      this.dialog.close();
      this.toast(t('projects.opened', { name: full.name }));
    });

    row.querySelector('[data-delete]').addEventListener('click', async () => {
      if (!confirm(t('projects.deleteConfirm', { name: p.name }))) return;
      await this.storage.deleteProject(p.id);
      row.remove();
      this.toast(t('projects.deleted'));
    });

    row.querySelector('[data-history]').addEventListener('click', async () => {
      const holder = row.querySelector('[data-versions]');
      if (holder.classList.toggle('open')) await this.#renderVersions(holder, p.id);
    });

    return row;
  }

  async #renderVersions(holder, projectId) {
    const versions = await this.storage.listVersions(projectId);
    setSafeHTML(holder, versions.length ? '' : `<div class="version-row">${t('projects.noVersions')}</div>`);
    for (const v of versions) {
      const vr = document.createElement('div');
      vr.className = 'version-row';
      setSafeHTML(vr, `
        <span>${escapeHtml(t('projects.versionMeta', { label: v.label, count: v.elementCount }))}</span>
        <button data-restore>${t('projects.restore')}</button>
        <button data-compare>${t('projects.compare')}</button>
        <span class="diff-summary" data-diff></span>`);

      vr.querySelector('[data-restore]').addEventListener('click', async () => {
        const full = await this.storage.getVersion(v.id);
        if (!full) return;
        const project = this.store.project ?? await this.storage.getProject(projectId);
        project.snapshot = full.snapshot;
        this.store.loadProject(project);
        this.dialog.close();
        this.toast(t('projects.restored', { label: v.label }));
      });

      vr.querySelector('[data-compare]').addEventListener('click', async () => {
        const full = await this.storage.getVersion(v.id);
        if (!full || !this.store.snapshot) return;
        const diff = ProjectStorageEngine.compareSnapshots(full.snapshot, this.store.snapshot);
        vr.querySelector('[data-diff]').textContent = diff.summary;
      });

      holder.appendChild(vr);
    }
  }
}

function shortUrl(url) {
  try { return new URL(url).host + new URL(url).pathname; } catch { return url || 'unknown source'; }
}
