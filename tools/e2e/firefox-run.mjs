/**
 * Runs the Firefox build (dist/firefox, from `node tools/build-release.mjs firefox`)
 * in real Firefox: installs it as a temporary add-on, extracts a page through
 * the content script, waits for the builder and screenshots popup + builder.
 *
 *   node tools/e2e/firefox-run.mjs <url> [outDir]
 *
 * It also revokes <all_urls> first and clicks the popup's "Allow access"
 * banner to restore it (Firefox lets users withhold host permissions).
 *
 * WebDriver BiDi cannot navigate to moz-extension:// pages or evaluate in the
 * background context, so the test installs a COPY of the build whose
 * background script carries a small hook: a tab whose URL ends in `#ef-e2e`
 * gets the content script injected, extraction started, and the popup opened
 * in a tab — exactly the calls the real popup makes. dist/firefox is untouched.
 */
import { cp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import puppeteer from 'puppeteer-core';

const url = process.argv[2] ?? 'http://localhost/saipa/';
const OUT = process.argv[3] ?? resolve(import.meta.dirname, 'out');
const BUILD = resolve(import.meta.dirname, '../../dist/firefox');
const TEST_EXT = join(tmpdir(), `ef-firefox-e2e-${process.pid}`);

const HOOK = `
// ---- e2e hook (tools/e2e/firefox-run.mjs only) ----
const efE2eLog = (step) => chrome.storage.local.get('ef:e2e').then((d) => chrome.storage.local.set({ 'ef:e2e': { ...(d['ef:e2e'] ?? {}), [step]: Date.now() } }));
chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  if (info.status !== 'complete' || !(tab.url ?? '').endsWith('#ef-e2e')) return;
  try {
    await efE2eLog('matched');
    await chrome.scripting.executeScript({ target: { tabId }, files: ['/src/content/bootstrap.js'] });
    await efE2eLog('injected');
    for (let i = 0; i < 60; i++) {
      try { if ((await chrome.tabs.sendMessage(tabId, { type: MSG.PING }))?.ok) break; } catch { /* loading */ }
      await new Promise((r) => setTimeout(r, 200));
    }
    await efE2eLog('pinged');
    await chrome.tabs.sendMessage(tabId, { type: MSG.EXTRACT_PAGE });
  } catch (err) {
    await chrome.tabs.create({ url: chrome.runtime.getURL('src/ui/popup/popup.html') + '#error=' + encodeURIComponent(String(err?.message || err)) });
  }
});
// Open the popup UI in a tab so the test can drive it.
chrome.tabs.create({ url: chrome.runtime.getURL('src/ui/popup/popup.html') });
`;

await rm(TEST_EXT, { recursive: true, force: true });
await cp(BUILD, TEST_EXT, { recursive: true });
const sw = join(TEST_EXT, 'src/background/service-worker.js');
await writeFile(sw, (await readFile(sw, 'utf8')) + HOOK);
// Host access is optional (granted from the popup banner); automation cannot
// answer a permission prompt, so the test copy pre-grants it.
const manifestPath = join(TEST_EXT, 'manifest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
manifest.host_permissions = ['<all_urls>'];
await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

const browser = await puppeteer.launch({
  browser: 'firefox',
  executablePath: 'C:/Program Files/Mozilla Firefox/firefox.exe',
  headless: true,
  // A separate instance even when the user's Firefox is already running.
  args: ['--new-instance', '--no-remote', '--remote-allow-system-access'],
  defaultViewport: { width: 1280, height: 760 },
  // Grant MV3 host permissions at install, as a normal (non-temporary) install does.
  // Accept permissions.request() prompts automatically (headless has no UI).
  extraPrefsFirefox: { 'extensions.webextOptionalPermissionPrompts': false },
});
const errors = [];
const findPage = async (part, timeoutMs) => {
  for (let waited = 0; waited < timeoutMs; waited += 500) {
    // Extension pages report about:blank to BiDi; ask the page itself.
    for (const page of await browser.pages()) {
      const href = await page.evaluate(() => location.href).catch(() => page.url());
      if (href.includes(part)) return page;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return null;
};

try {
  await browser.installExtension(TEST_EXT);
  const popup = await findPage('/popup.html', 30_000);
  if (!popup) throw new Error('popup did not open (background failed to start?)');
  popup.on('pageerror', (e) => errors.push(`popup: ${e}`));
  await popup.setViewport({ width: 320, height: 560 }).catch(() => {}); // not allowed on privileged pages
  await new Promise((r) => setTimeout(r, 800));
  const started = Date.now();
  const site = await browser.newPage();
  await site.goto(`${url}#ef-e2e`, { waitUntil: 'load', timeout: 120_000 });
  const e2e = { hostAccessGranted: await popup.evaluate(() => chrome.permissions.contains({ origins: ['<all_urls>'] })) };

  const builder = await findPage('/builder.html', 180_000);
  if (!builder) throw new Error('builder did not open (extraction failed?)');
  builder.on('pageerror', (e) => errors.push(`builder: ${e}`));
  await builder.setViewport({ width: 1280, height: 760 }).catch(() => {}); // not allowed on privileged pages
  await new Promise((r) => setTimeout(r, 3500));
  const state = await builder.evaluate(() => ({
    treeRows: document.querySelectorAll('.tree-row').length,
    native: document.querySelectorAll('.tree-native').length,
    project: document.getElementById('project-name')?.value,
    previewNodes: document.querySelector('iframe')?.contentDocument?.querySelectorAll('[data-ef-id]').length ?? null,
  }));
  await builder.screenshot({ path: `${OUT}/firefox-builder.png` }).catch(() => errors.push("screenshot unsupported on privileged page"));
  const elapsedMs = Date.now() - started;

  // A user who revoked "access to all websites" in about:addons: the popup
  // must show the banner. (Its button needs a real user gesture, which
  // automation cannot produce on privileged pages — click it by hand.)
  await popup.evaluate(() => chrome.permissions.remove({ origins: ['<all_urls>'] }));
  await popup.evaluate(() => { setTimeout(() => location.reload(), 0); });
  await new Promise((r) => setTimeout(r, 1500));
  const revoked = await popup.evaluate(async () => ({
    granted: await chrome.permissions.contains({ origins: ['<all_urls>'] }),
    bannerVisible: !document.getElementById('host-access').hidden,
    bannerText: document.querySelector('#host-access p')?.textContent.slice(0, 60),
  }));

  console.log(JSON.stringify({ ...e2e, elapsedMs, ...state, revoked, errors }, null, 1));
} finally {
  await browser.close();
  await rm(TEST_EXT, { recursive: true, force: true });
}
