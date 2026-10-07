/**
 * Build distributable release packages of the extension.
 *
 *   node tools/build-release.mjs              # chrome + firefox
 *   node tools/build-release.mjs chrome       # one target
 *   node tools/build-release.mjs firefox
 *
 * Produces, per target, releases/element-finder-studio-v<version>-<target>.zip
 * with manifest.json at the archive root, excluding dev-only artifacts. The
 * Firefox target also writes an unpacked copy to dist/firefox/ (for
 * `web-ext lint` / `web-ext run` / about:debugging → Load Temporary Add-on).
 *
 * The source manifest (extension/manifest.json) is the Chrome one. The
 * Firefox manifest is derived from it:
 *   - background: Firefox MV3 has no service workers — the same module runs
 *     as an event page (`background.scripts`);
 *   - browser_specific_settings.gecko: add-on id, minimum version and the
 *     data-collection declaration AMO requires (the extension sends no data
 *     anywhere; it only reads the page being extracted);
 *   - Chrome-only keys removed.
 */

import { readFile, readdir, mkdir, writeFile, rm } from 'node:fs/promises';
import { dirname, join, resolve, relative } from 'node:path';
import { ZipWriter } from '../extension/src/engines/export/ZipWriter.js';

const ROOT = resolve(import.meta.dirname, '..');
const SRC = join(ROOT, 'extension');
const RELEASE_DIR = join(ROOT, 'releases');
const DIST_DIR = join(ROOT, 'dist');

/** Add-on id on addons.mozilla.org — never change it after the first upload. */
const GECKO_ID = 'element-finder@nias.ir';
const GECKO_MIN_VERSION = '140.0';

// Dev-only files/dirs that must not ship.
const EXCLUDE_NAMES = new Set(['smoke-test.mjs', 'node_modules', '.DS_Store', 'Thumbs.db']);

const sourceManifest = JSON.parse(await readFile(join(SRC, 'manifest.json'), 'utf8'));
const version = sourceManifest.version;

// Store limits: Chrome Web Store rejects a description over 132 characters
// and a name over 75 (AMO allows more; the stricter limit applies to both).
for (const [key, max] of [['description', 132], ['name', 75]]) {
  const len = (sourceManifest[key] ?? '').length;
  if (len > max) throw new Error(`manifest.${key} is ${len} characters; the limit is ${max}`);
}

const TARGETS = {
  chrome: (m) => m,
  firefox: (m) => {
    const out = structuredClone(m);
    delete out.minimum_chrome_version;
    out.background = {
      scripts: [m.background.service_worker],
      type: m.background.type,
    };
    out.browser_specific_settings = {
      gecko: {
        id: GECKO_ID,
        strict_min_version: GECKO_MIN_VERSION,
        data_collection_permissions: { required: ['none'] },
      },
      // The data-collection key needs Firefox for Android 142+.
      gecko_android: { strict_min_version: '142.0' },
    };
    return out;
  },
};

async function collect(dir, files = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (EXCLUDE_NAMES.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) await collect(full, files);
    else files.push(full);
  }
  return files;
}

const files = (await collect(SRC)).sort();
const requested = process.argv.slice(2).filter((a) => TARGETS[a]);
const targets = requested.length ? requested : Object.keys(TARGETS);

await mkdir(RELEASE_DIR, { recursive: true });

for (const target of targets) {
  const manifest = TARGETS[target](sourceManifest);
  const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
  const zip = new ZipWriter();
  const unpackedDir = target === 'firefox' ? join(DIST_DIR, target) : null;
  if (unpackedDir) await rm(unpackedDir, { recursive: true, force: true });

  for (const file of files) {
    const rel = relative(SRC, file).replace(/\\/g, '/');
    const data = rel === 'manifest.json' ? Buffer.from(manifestText, 'utf8') : await readFile(file);
    zip.addFile(rel, new Uint8Array(data));
    if (unpackedDir) {
      const dest = join(unpackedDir, rel);
      await mkdir(dirname(dest), { recursive: true });
      await writeFile(dest, data);
    }
  }

  const buf = Buffer.from(await zip.build().arrayBuffer());
  const outPath = join(RELEASE_DIR, `element-finder-studio-v${version}-${target}.zip`);
  await writeFile(outPath, buf);
  console.log(`[${target}] ${files.length} files → ${relative(ROOT, outPath)} (${(buf.length / 1024).toFixed(1)} KB)`);
  if (unpackedDir) console.log(`[${target}] unpacked → ${relative(ROOT, unpackedDir)}`);
}
