/**
 * Builder application entry — composes the store, the builder-side engines
 * (validation, export, storage, reconstruction) and the UI components.
 *
 * Boot flow:
 *   ?import=last  -> pick up the snapshot parked by the service worker,
 *                    create a project from it and start editing
 *   otherwise     -> open the most recent project, or show the projects dialog
 */

import { STORAGE_KEYS } from '../../common/constants.js';
import { aiAssist } from '../../ai/AiAssistService.js';
import { ValidationEngine } from '../../engines/validation/ValidationEngine.js';
import { ExportEngine } from '../../engines/export/ExportEngine.js';
import { ProjectStorageEngine } from '../../engines/storage/ProjectStorageEngine.js';
import { BuilderStore } from './store.js';
import { TreeView } from './components/TreeView.js';
import { Inspector } from './components/Inspector.js';
import { PreviewPane } from './components/PreviewPane.js';
import { ValidationPanel } from './components/ValidationPanel.js';
import { ExportDialog } from './components/ExportDialog.js';
import { ProjectsPanel } from './components/ProjectsPanel.js';

/* ---------------- composition root ---------------- */

const store = new BuilderStore();
const storage = new ProjectStorageEngine();
const validationEngine = new ValidationEngine({ aiAssist });
const exportEngine = new ExportEngine({ validationEngine });

const toastEl = document.getElementById('toast');
let toastTimer;
function toast(message, kind = '') {
  toastEl.textContent = message;
  toastEl.className = `toast ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.add('hidden'), 3500);
}

new TreeView(document.getElementById('tree'), store);
new Inspector(document.getElementById('inspector'), store);
new PreviewPane(document.getElementById('preview'), store);
const validationPanel = new ValidationPanel(document.getElementById('validation-panel'), store, validationEngine);
const exportDialog = new ExportDialog(document.getElementById('export-dialog'), store, exportEngine, validationPanel, toast);
const projectsPanel = new ProjectsPanel(document.getElementById('projects-dialog'), store, storage, toast);

/* ---------------- toolbar ---------------- */

const $ = (id) => document.getElementById(id);

$('btn-validate').addEventListener('click', () => {
  const report = validationPanel.runValidation();
  toast(report.ok ? 'Validation passed — export-ready.' : `${report.counts.error} error(s), ${report.counts.warning} warning(s).`, report.ok ? '' : 'error');
});

$('btn-save').addEventListener('click', saveProject);
$('btn-version').addEventListener('click', async () => {
  if (!store.project) { toast('Nothing to version yet.', 'error'); return; }
  await saveProject();
  const label = prompt('Version label:', `v${new Date().toLocaleDateString()}`);
  if (label === null) return;
  await storage.saveVersion(store.project.id, store.snapshot, label);
  toast(`Version "${label}" frozen.`);
});
$('btn-projects').addEventListener('click', () => projectsPanel.open());
$('btn-export').addEventListener('click', () => {
  if (!store.snapshot) { toast('Nothing to export.', 'error'); return; }
  exportDialog.open();
});
$('btn-undo').addEventListener('click', () => store.undo());
$('btn-redo').addEventListener('click', () => store.redo());

for (const btn of document.querySelectorAll('.device-switch button')) {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.device-switch button').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    store.setDevice(btn.dataset.device);
  });
}

$('project-name').addEventListener('change', (e) => {
  if (store.project) {
    store.project.name = e.target.value || 'Untitled project';
    store.dirty = true;
  }
});

document.addEventListener('keydown', (e) => {
  if (!(e.ctrlKey || e.metaKey)) return;
  const k = e.key.toLowerCase();
  if (k === 'z' && !e.shiftKey) { e.preventDefault(); store.undo(); }
  if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); store.redo(); }
  if (k === 's') { e.preventDefault(); void saveProject(); }
});

store.events.on('tree', refreshChrome);
store.events.on('project', refreshChrome);
store.events.on('snapshot', refreshChrome);

function refreshChrome() {
  $('btn-undo').disabled = !store.canUndo;
  $('btn-redo').disabled = !store.canRedo;
  $('project-name').value = store.project?.name ?? '';
  const meta = store.snapshot?.meta;
  $('project-meta').textContent = meta
    ? `${meta.url} · extracted ${new Date(meta.extractedAt).toLocaleString()} · ${store.visibleCount()} elements`
    : '';
}

async function saveProject() {
  if (!store.snapshot) { toast('Nothing to save.', 'error'); return; }
  if (!store.project?.id) {
    store.project = await storage.createProject($('project-name').value, store.snapshot);
  } else {
    store.project.snapshot = store.snapshot;
    store.project.name = $('project-name').value || store.project.name;
    await storage.saveProject(store.project);
  }
  store.dirty = false;
  toast('Project saved.');
  refreshChrome();
}

window.addEventListener('beforeunload', (e) => {
  if (store.dirty) e.preventDefault();
});

/* ---------------- boot ---------------- */

async function boot() {
  const params = new URLSearchParams(location.search);

  if (params.get('import') === 'last') {
    const data = await chrome.storage.local.get(STORAGE_KEYS.LAST_SNAPSHOT);
    const snapshot = data[STORAGE_KEYS.LAST_SNAPSHOT];
    if (snapshot) {
      // Hand-off consumed; clear so a stale snapshot is never re-imported.
      await chrome.storage.local.remove(STORAGE_KEYS.LAST_SNAPSHOT);
      const project = await storage.createProject(snapshot.meta?.title, snapshot);
      store.loadProject(project);
      toast(`Imported ${snapshot.stats?.nodesExtracted ?? '?'} elements from ${hostOf(snapshot.meta?.url)}.`);
      // Surface extraction quality immediately.
      validationPanel.runValidation();
      return;
    }
  }

  const projects = await storage.listProjects();
  if (projects.length) {
    const full = await storage.getProject(projects[0].id);
    if (full) { store.loadProject(full); return; }
  }
  await projectsPanel.open().catch(() => {});
}

function hostOf(url) {
  try { return new URL(url).host; } catch { return 'page'; }
}

void boot();
