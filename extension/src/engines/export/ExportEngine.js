/**
 * Export Engine
 * -------------
 * Strategy registry of export formats. Each format produces one or more
 * downloadable artifacts ({ filename, blob }). New formats register without
 * touching consumers — the builder's export dialog enumerates `formats()`.
 *
 * Built-in formats:
 *   elementor   Elementor template JSON (import via Templates > Import)
 *   structure   widget/container hierarchy only (integration-friendly)
 *   raw         the full IR snapshot (lossless, re-importable)
 *   html        standalone HTML snapshot from the Reconstruction Engine
 *   assets      ZIP package of all collected assets + manifest
 */

import { slugify, walkTree } from '../../common/utils.js';
import { ReconstructionEngine } from '../reconstruction/ReconstructionEngine.js';
import { exportElementorTemplate } from './elementor-exporter.js';
import { ZipWriter } from './ZipWriter.js';

export class ExportEngine {
  constructor(options = {}) {
    this.validationEngine = options.validationEngine ?? null;
    this.#registerBuiltins();
  }

  /** @type {Map<string, {id,label,description,extension,run(snapshot,opts):Promise<Array<{filename,blob}>>}>} */
  #formats = new Map();

  registerFormat(format) {
    this.#formats.set(format.id, format);
  }

  formats() {
    return [...this.#formats.values()].map(({ run, ...meta }) => meta);
  }

  /**
   * @param {string} formatId
   * @param {object} snapshot
   * @param {object} [opts] { title, skipValidation, onProgress }
   * @returns {Promise<{artifacts: Array<{filename, blob}>, validation: object|null}>}
   */
  async export(formatId, snapshot, opts = {}) {
    const format = this.#formats.get(formatId);
    if (!format) throw new Error(`Unknown export format "${formatId}"`);

    let validation = null;
    if (this.validationEngine && !opts.skipValidation) {
      validation = this.validationEngine.validate(snapshot);
      if (!validation.ok && format.requiresValidSnapshot) {
        const err = new Error(`Export blocked: ${validation.counts.error} validation error(s). Fix them or export with skipValidation.`);
        err.validation = validation;
        throw err;
      }
    }

    const artifacts = await format.run(snapshot, opts);
    return { artifacts, validation };
  }

  #registerBuiltins() {
    this.registerFormat({
      id: 'elementor',
      label: 'Elementor Template JSON',
      description: 'Importable via Elementor → Templates → Import. Containers + mapped widgets with responsive settings.',
      extension: 'json',
      requiresValidSnapshot: true,
      run: async (snapshot, opts) => {
        const template = exportElementorTemplate(snapshot, {
          title: opts.title,
          keepGlobals: opts.keepGlobals,
          atomic: opts.atomic,
        });
        return [jsonArtifact(`elementor-${baseName(snapshot, opts)}.json`, template)];
      },
    });

    this.registerFormat({
      id: 'structure',
      label: 'Structure JSON',
      description: 'Lightweight hierarchy: ids, labels, mappings and content. For integrations and review.',
      extension: 'json',
      run: async (snapshot, opts) => {
        const structure = {
          meta: snapshot.meta,
          stats: snapshot.stats,
          tree: simplifyNode(snapshot.tree),
        };
        return [jsonArtifact(`structure-${baseName(snapshot, opts)}.json`, structure)];
      },
    });

    this.registerFormat({
      id: 'raw',
      label: 'Raw Data JSON',
      description: 'The complete extraction snapshot (styles, settings, assets, mappings). Lossless project backup.',
      extension: 'json',
      run: async (snapshot, opts) => [jsonArtifact(`raw-${baseName(snapshot, opts)}.json`, snapshot)],
    });

    this.registerFormat({
      id: 'html',
      label: 'HTML Snapshot',
      description: 'Standalone HTML document rebuilt from the extracted structure (the builder preview).',
      extension: 'html',
      run: async (snapshot, opts) => {
        const html = new ReconstructionEngine().buildPreviewDocument(snapshot);
        return [{ filename: `snapshot-${baseName(snapshot, opts)}.html`, blob: new Blob([html], { type: 'text/html' }) }];
      },
    });

    this.registerFormat({
      id: 'assets',
      label: 'Assets Package (ZIP)',
      description: 'Downloads every collected image/SVG/font/video poster into a ZIP with a manifest.json.',
      extension: 'zip',
      run: async (snapshot, opts) => {
        const blob = await buildAssetsPackage(snapshot, opts.onProgress);
        return [{ filename: `assets-${baseName(snapshot, opts)}.zip`, blob }];
      },
    });
  }
}

/* ------------------------------------------------------------------ */

function baseName(snapshot, opts) {
  return slugify(opts.title || snapshot.meta.title, 'export');
}

function jsonArtifact(filename, data) {
  return { filename, blob: new Blob([JSON.stringify(data)], { type: 'application/json' }) };
}

function simplifyNode(node) {
  if (!node || node.hidden) return null;
  return {
    id: node.id,
    label: node.label,
    tag: node.tag,
    elType: node.mapping?.elType ?? null,
    widgetType: node.mapping?.widgetType ?? null,
    confidence: node.mapping?.confidence ?? null,
    semantic: node.semantic.kind,
    content: pickContent(node.content),
    children: (node.children ?? []).map(simplifyNode).filter(Boolean),
  };
}

function pickContent(c) {
  const { html, svgMarkup, ...rest } = c ?? {};
  return rest;
}

/**
 * Fetch every catalogued asset and pack it. Failures (CORS, 404, opaque
 * responses) are recorded in the manifest instead of aborting the package.
 */
async function buildAssetsPackage(snapshot, onProgress) {
  const zip = new ZipWriter();
  const manifest = [];
  const assets = snapshot.assets ?? [];
  const usedNames = new Set();

  for (let i = 0; i < assets.length; i++) {
    const asset = assets[i];
    onProgress?.({ current: i + 1, total: assets.length, asset: asset.filename || asset.id });
    const entry = {
      id: asset.id, type: asset.type, url: asset.url, origin: asset.origin,
      usedBy: asset.usedBy, meta: asset.meta, status: 'skipped', file: null,
    };

    try {
      if (asset.inline && asset.type === 'svg') {
        entry.file = uniqueName(usedNames, asset.type, asset.filename || `${asset.id}.svg`);
        zip.addFile(`assets/${asset.type}/${entry.file}`, asset.inline);
        entry.status = 'inline';
      } else if (asset.inline && asset.type === 'icon') {
        entry.status = 'icon-class';
        entry.iconClasses = asset.meta?.classes ?? asset.inline;
      } else if (asset.url && !asset.url.startsWith('data:')) {
        const res = await fetch(asset.url, { credentials: 'omit' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buf = await res.arrayBuffer();
        entry.file = uniqueName(usedNames, asset.type, asset.filename || `${asset.id}`);
        entry.bytes = buf.byteLength;
        zip.addFile(`assets/${asset.type}/${entry.file}`, buf);
        entry.status = 'ok';
      } else if (asset.url?.startsWith('data:')) {
        entry.status = 'data-uri';
      }
    } catch (err) {
      entry.status = 'failed';
      entry.error = String(err?.message || err);
    }
    manifest.push(entry);
  }

  zip.addFile('manifest.json', JSON.stringify({
    source: snapshot.meta.url,
    exportedAt: new Date().toISOString(),
    total: assets.length,
    fetched: manifest.filter((m) => m.status === 'ok' || m.status === 'inline').length,
    failed: manifest.filter((m) => m.status === 'failed').length,
    assets: manifest,
  }, null, 2));

  return zip.build();
}

function uniqueName(used, type, name) {
  let candidate = name.replace(/[^\w.\-]+/g, '_').slice(-80) || 'asset';
  let i = 1;
  while (used.has(`${type}/${candidate}`)) {
    candidate = candidate.replace(/(\.\w+)?$/, (ext) => `-${i++}${ext || ''}`);
  }
  used.add(`${type}/${candidate}`);
  return candidate;
}

/** Count of exportable (visible) elements — used by the export dialog. */
export function exportableElementCount(snapshot) {
  let count = 0;
  if (snapshot?.tree) walkTree(snapshot.tree, (n) => { if (n.hidden) return false; count++; });
  return count;
}
