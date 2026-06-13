/**
 * Build a distributable release ZIP of the extension.
 *
 *   node tools/build-release.mjs
 *
 * Produces releases/element-finder-studio-v<version>.zip with manifest.json at
 * the archive root (Chrome Web Store / load-unpacked layout), excluding
 * dev-only artifacts. Reuses the extension's own ZipWriter.
 */

import { readFile, readdir, stat, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve, relative } from 'node:path';
import { ZipWriter } from '../extension/src/engines/export/ZipWriter.js';

const ROOT = resolve(import.meta.dirname, '..');
const SRC = join(ROOT, 'extension');
const RELEASE_DIR = join(ROOT, 'releases');

// Dev-only files/dirs that must not ship.
const EXCLUDE_NAMES = new Set(['smoke-test.mjs', 'node_modules', '.DS_Store', 'Thumbs.db']);

const manifest = JSON.parse(await readFile(join(SRC, 'manifest.json'), 'utf8'));
const version = manifest.version;

async function collect(dir, files = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (EXCLUDE_NAMES.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) await collect(full, files);
    else files.push(full);
  }
  return files;
}

const files = await collect(SRC);
files.sort();

const zip = new ZipWriter();
for (const file of files) {
  const rel = relative(SRC, file).replace(/\\/g, '/');
  zip.addFile(rel, new Uint8Array(await readFile(file)));
}

await mkdir(RELEASE_DIR, { recursive: true });
const blob = zip.build();
const buf = Buffer.from(await blob.arrayBuffer());
const outPath = join(RELEASE_DIR, `element-finder-studio-v${version}.zip`);
await writeFile(outPath, buf);

console.log(`Packaged ${files.length} files (manifest v${version})`);
console.log(`→ ${relative(ROOT, outPath)}  (${(buf.length / 1024).toFixed(1)} KB)`);
console.log('\nIncluded:');
for (const f of files) console.log('  ' + relative(SRC, f).replace(/\\/g, '/'));
