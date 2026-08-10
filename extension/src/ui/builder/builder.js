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
import { getLang, initI18n, setLang, t } from '../../common/i18n.js';
import { aiAssist } from '../../ai/AiAssistService.js';

// Localize BEFORE any component renders (top-level await, ESM).
await initI18n(document);
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
  toast(report.ok ? t('builder.validationPassed') : t('builder.validationIssues', {
    errors: report.counts.error, warnings: report.counts.warning,
  }), report.ok ? '' : 'error');
});

$('btn-save').addEventListener('click', saveProject);
$('btn-version').addEventListener('click', async () => {
  if (!store.project) { toast(t('builder.nothingToVersion'), 'error'); return; }
  await saveProject();
  const label = prompt(t('builder.versionLabelPrompt'), `v${new Date().toLocaleDateString()}`);
  if (label === null) return;
  await storage.saveVersion(store.project.id, store.snapshot, label);
  toast(t('builder.versionFrozen', { label }));
});
$('btn-projects').addEventListener('click', () => projectsPanel.open());
$('btn-export').addEventListener('click', () => {
  if (!store.snapshot) { toast(t('builder.nothingToExport'), 'error'); return; }
  exportDialog.open();
});
$('btn-undo').addEventListener('click', () => store.undo());
$('btn-redo').addEventListener('click', () => store.redo());

$('btn-lang').textContent = getLang() === 'fa' ? 'EN' : 'فا';
$('btn-lang').addEventListener('click', async () => {
  await setLang(getLang() === 'fa' ? 'en' : 'fa');
  // Full reload re-renders every component in the new language; the
  // beforeunload guard still protects unsaved work.
  location.reload();
});

for (const btn of document.querySelectorAll('.device-switch button')) {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.device-switch button').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    store.setDevice(btn.dataset.device);
  });
}

$('project-name').placeholder = t('builder.untitled');
$('project-name').addEventListener('change', (e) => {
  if (store.project) {
    store.project.name = e.target.value || t('builder.untitled');
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
    ? t('builder.metaLine', {
        url: meta.url,
        date: new Date(meta.extractedAt).toLocaleString(getLang() === 'fa' ? 'fa-IR' : undefined),
        count: store.visibleCount(),
      })
    : '';
}

async function saveProject() {
  if (!store.snapshot) { toast(t('builder.nothingToSave'), 'error'); return; }
  if (!store.project?.id) {
    store.project = await storage.createProject($('project-name').value, store.snapshot);
  } else {
    store.project.snapshot = store.snapshot;
    store.project.name = $('project-name').value || store.project.name;
    await storage.saveProject(store.project);
  }
  store.dirty = false;
  toast(t('builder.projectSaved'));
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
      toast(t('builder.imported', { count: snapshot.stats?.nodesExtracted ?? '?', host: hostOf(snapshot.meta?.url) }));
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
