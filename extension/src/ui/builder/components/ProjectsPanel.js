/**
 * ProjectsPanel — saved-projects dialog: open, delete, list frozen versions,
 * restore a version into the working copy, and compare a version against
 * the current state (structural diff from the Storage Engine).
 */

import { escapeHtml } from '../../../common/utils.js';
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
    this.dialog.innerHTML = `
      <div class="dialog-head"><span>Projects</span><button data-close>✕</button></div>
      <div class="dialog-body" data-list>
        ${projects.length ? '' : '<p style="color:var(--muted)">No saved projects yet. Use 💾 Save in the toolbar.</p>'}
      </div>
      <div class="dialog-foot"><button data-close>Close</button></div>`;

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
    row.innerHTML = `
      <div class="grow">
        <strong>${escapeHtml(p.name)}</strong>
        <small>${escapeHtml(shortUrl(p.sourceUrl))} · ${p.elementCount} elements · updated ${new Date(p.updatedAt).toLocaleString()}</small>
        <div class="version-list" data-versions></div>
      </div>
      <button data-open>Open</button>
      <button data-history title="Show saved versions">🏷</button>
      <button class="danger" data-delete>🗑</button>`;

    row.querySelector('[data-open]').addEventListener('click', async () => {
      const full = await this.storage.getProject(p.id);
      if (!full) { this.toast('Project not found.', 'error'); return; }
      this.store.loadProject(full);
      this.dialog.close();
      this.toast(`Opened "${full.name}".`);
    });

    row.querySelector('[data-delete]').addEventListener('click', async () => {
      if (!confirm(`Delete project "${p.name}" and all its versions?`)) return;
      await this.storage.deleteProject(p.id);
      row.remove();
      this.toast('Project deleted.');
    });

    row.querySelector('[data-history]').addEventListener('click', async () => {
      const holder = row.querySelector('[data-versions]');
      if (holder.classList.toggle('open')) await this.#renderVersions(holder, p.id);
    });

    return row;
  }

  async #renderVersions(holder, projectId) {
    const versions = await this.storage.listVersions(projectId);
    holder.innerHTML = versions.length ? '' : '<div class="version-row">No frozen versions.</div>';
    for (const v of versions) {
      const vr = document.createElement('div');
      vr.className = 'version-row';
      vr.innerHTML = `
        <span>${escapeHtml(v.label)} · ${v.elementCount} elements</span>
        <button data-restore>Restore</button>
        <button data-compare>Compare to current</button>
        <span class="diff-summary" data-diff></span>`;

      vr.querySelector('[data-restore]').addEventListener('click', async () => {
        const full = await this.storage.getVersion(v.id);
        if (!full) return;
        const project = this.store.project ?? await this.storage.getProject(projectId);
        project.snapshot = full.snapshot;
        this.store.loadProject(project);
        this.dialog.close();
        this.toast(`Restored "${v.label}". Save to keep it.`);
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
