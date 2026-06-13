/**
 * Project Storage Engine
 * ----------------------
 * Local-first persistence on IndexedDB (builder context).
 *
 *   projects: { id, name, sourceUrl, createdAt, updatedAt, snapshot }
 *   versions: { id, projectId, label, createdAt, snapshot }   (immutable)
 *
 * Saving a project always keeps the live working copy in `projects`;
 * `saveVersion` freezes the current state for restore/compare. Version
 * comparison diffs the trees structurally (added/removed/re-mapped/edited).
 */

import { uuid, walkTree } from '../../common/utils.js';

const DB_NAME = 'element-finder-studio';
const DB_VERSION = 1;

export class ProjectStorageEngine {
  #dbPromise = null;

  #db() {
    if (!this.#dbPromise) {
      this.#dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('projects')) {
            const store = db.createObjectStore('projects', { keyPath: 'id' });
            store.createIndex('updatedAt', 'updatedAt');
          }
          if (!db.objectStoreNames.contains('versions')) {
            const store = db.createObjectStore('versions', { keyPath: 'id' });
            store.createIndex('projectId', 'projectId');
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return this.#dbPromise;
  }

  async #tx(storeName, mode, fn) {
    const db = await this.#db();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const store = tx.objectStore(storeName);
      const result = fn(store);
      tx.oncomplete = () => resolve(result?.result ?? result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  // ---- Projects -----------------------------------------------------------

  async createProject(name, snapshot) {
    const now = new Date().toISOString();
    const project = {
      id: uuid(),
      name: name || snapshot?.meta?.title || 'Untitled project',
      sourceUrl: snapshot?.meta?.url ?? '',
      createdAt: now,
      updatedAt: now,
      snapshot,
    };
    await this.#tx('projects', 'readwrite', (s) => s.put(project));
    return project;
  }

  async saveProject(project) {
    project.updatedAt = new Date().toISOString();
    await this.#tx('projects', 'readwrite', (s) => s.put(project));
    return project;
  }

  async getProject(id) {
    return this.#tx('projects', 'readonly', (s) => s.get(id));
  }

  async listProjects() {
    const all = await this.#tx('projects', 'readonly', (s) => s.getAll());
    return (all ?? [])
      .map(({ snapshot, ...meta }) => ({ ...meta, elementCount: countTree(snapshot) }))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async deleteProject(id) {
    await this.#tx('projects', 'readwrite', (s) => s.delete(id));
    const versions = await this.listVersions(id);
    for (const v of versions) {
      await this.#tx('versions', 'readwrite', (s) => s.delete(v.id));
    }
  }

  // ---- Versions ------------------------------------------------------------

  async saveVersion(projectId, snapshot, label = '') {
    const version = {
      id: uuid(),
      projectId,
      label: label || `Version ${new Date().toLocaleString()}`,
      createdAt: new Date().toISOString(),
      snapshot,
    };
    await this.#tx('versions', 'readwrite', (s) => s.put(version));
    return version;
  }

  async listVersions(projectId) {
    const db = await this.#db();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('versions', 'readonly');
      const req = tx.objectStore('versions').index('projectId').getAll(projectId);
      req.onsuccess = () => resolve(
        (req.result ?? [])
          .map(({ snapshot, ...meta }) => ({ ...meta, elementCount: countTree(snapshot) }))
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      );
      req.onerror = () => reject(req.error);
    });
  }

  async getVersion(id) {
    return this.#tx('versions', 'readonly', (s) => s.get(id));
  }

  /**
   * Structural diff between two snapshots.
   * @returns {{added: Array, removed: Array, remapped: Array, contentChanged: Array, summary: string}}
   */
  static compareSnapshots(a, b) {
    const mapA = indexById(a);
    const mapB = indexById(b);
    const added = [];
    const removed = [];
    const remapped = [];
    const contentChanged = [];

    for (const [id, node] of mapB) {
      const prev = mapA.get(id);
      if (!prev) { added.push(describe(node)); continue; }
      if ((prev.mapping?.widgetType ?? prev.mapping?.elType) !== (node.mapping?.widgetType ?? node.mapping?.elType)) {
        remapped.push({ ...describe(node), from: prev.mapping?.widgetType ?? prev.mapping?.elType, to: node.mapping?.widgetType ?? node.mapping?.elType });
      }
      if (JSON.stringify(prev.content) !== JSON.stringify(node.content) || prev.hidden !== node.hidden) {
        contentChanged.push(describe(node));
      }
    }
    for (const [id, node] of mapA) {
      if (!mapB.has(id)) removed.push(describe(node));
    }

    return {
      added, removed, remapped, contentChanged,
      summary: `${added.length} added · ${removed.length} removed · ${remapped.length} re-mapped · ${contentChanged.length} edited`,
    };
  }
}

function indexById(snapshot) {
  const map = new Map();
  if (snapshot?.tree) walkTree(snapshot.tree, (n) => { map.set(n.id, n); });
  return map;
}

function describe(node) {
  return { id: node.id, label: node.label, widget: node.mapping?.widgetType ?? node.mapping?.elType ?? '?' };
}

function countTree(snapshot) {
  let count = 0;
  if (snapshot?.tree) walkTree(snapshot.tree, () => { count++; });
  return count;
}
