/**
 * End-to-end through the REAL extension: loads extension/ unpacked, opens a
 * page, injects the content bootstrap from the service worker exactly as the
 * popup does, triggers EXTRACT_PAGE and reads the snapshot the service worker
 * parks in chrome.storage.local.
 *
 *   node tools/e2e/extension-run.mjs <url>
 */
import { resolve } from 'node:path';
import puppeteer from 'puppeteer-core';

const url = process.argv[2] ?? 'http://localhost/saipa/';
const EXT = resolve(import.meta.dirname, '../../extension');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  // Branded Chrome ignores --load-extension; load through CDP instead.
  pipe: true,
  enableExtensions: [EXT],
  args: ['--no-sandbox', '--window-size=1440,900'],
  defaultViewport: { width: 1440, height: 900 },
});

try {
  const swTarget = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().includes('service-worker.js'), { timeout: 15_000 });
  const sw = await swTarget.worker();

  const page = await browser.newPage();
  page.on('console', (m) => { if (m.type() === 'error') console.log('[page]', m.text().slice(0, 300)); });
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 90_000 });
  await page.bringToFront();

  const result = await sw.evaluate(async (pageUrl) => {
    const [tab] = await chrome.tabs.query({ url: pageUrl.replace(/\/$/, '') + '*' });
    if (!tab) return { ok: false, error: 'tab not found' };
    await chrome.storage.local.remove('ef:lastSnapshot');
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['src/content/bootstrap.js'] });
    // Wait for the module graph to come up.
    for (let i = 0; i < 50; i++) {
      try { const pong = await chrome.tabs.sendMessage(tab.id, { type: 'EF_PING' }); if (pong?.ok) break; } catch { /* not ready */ }
      await new Promise((r) => setTimeout(r, 200));
    }
    const reply = await chrome.tabs.sendMessage(tab.id, { type: 'EF_EXTRACT_PAGE' });
    const stored = await chrome.storage.local.get('ef:lastSnapshot');
    const snap = stored['ef:lastSnapshot'];
    if (!snap) return { ok: false, reply };
    let native = 0; let exact = 0; let atomic = 0; let customCss = 0;
    (function walk(n) {
      const nat = n.semantic?.elementorNative;
      if (nat) native++;
      if (nat?.exact?.controlsKnown) exact++;
      if (nat?.atomic) atomic++;
      if (nat?.exact?.customCss) customCss++;
      for (const c of n.children ?? []) walk(c);
    })(snap.tree);
    return { ok: true, reply, phases: snap.stats.enginePhases, elementor: snap.meta.elementor, native, exact, atomic, customCss, nodes: snap.stats.nodesExtracted };
  }, url);

  console.log(JSON.stringify(result, null, 1).slice(0, 2500));
  if (!result.ok || !result.phases?.['elementor-native']?.ok || !result.exact) process.exitCode = 1;

  // The service worker opens the builder on completion; make sure it renders
  // the snapshot, the Inspector shows exact settings and export runs.
  const builderTarget = await browser.waitForTarget((t) => t.url().includes('builder.html'), { timeout: 15_000 }).catch(() => null);
  if (builderTarget) {
    const builder = await builderTarget.page();
    const errors = [];
    builder.on('pageerror', (e) => errors.push(String(e)));
    await builder.setViewport({ width: 1440, height: 900 });
    await new Promise((r) => setTimeout(r, 2500));
    const shot = process.argv[3];
    // Select the first native widget in the structure tree.
    const picked = await builder.evaluate(() => {
      const row = [...document.querySelectorAll('[data-node-id], [data-id]')].find((r) => /⚡|e-/.test(r.textContent));
      row?.click();
      return row?.textContent?.trim().slice(0, 60) ?? null;
    });
    await new Promise((r) => setTimeout(r, 800));
    const inspector = await builder.evaluate(() => document.body.innerText.includes('Exact Elementor settings') || document.body.innerText.includes('تنظیمات دقیق المنتور') || document.body.innerText.includes('Atomic (V4) settings'));
    if (shot) await builder.screenshot({ path: shot });
    console.log(JSON.stringify({ builder: true, picked, inspectorShowsExact: inspector, pageErrors: errors }));
    if (errors.length) process.exitCode = 1;
  } else {
    console.log('builder tab did not open');
  }
} finally {
  await browser.close();
}
