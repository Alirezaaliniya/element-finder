/** Probe: what does the live DOM say about the carousel slide backgrounds? */
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import puppeteer from 'puppeteer-core';

const ROOT = resolve(import.meta.dirname, '../..');
const PORT = 8124;
const PAGE = encodeURIComponent('نمایندگی رسمی سایپا.htm');

const MIME = { '.html': 'text/html', '.htm': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer(async (req, res) => {
  try {
    const file = join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!existsSync(file)) { res.writeHead(404); res.end(); return; }
    const ext = file.endsWith('.download') ? '.js' : extname(file).toLowerCase();
    res.writeHead(200, { 'content-type': MIME[ext] ?? 'application/octet-stream' });
    res.end(await readFile(file));
  } catch { res.writeHead(500); res.end(); }
});
await new Promise((r) => server.listen(PORT, r));

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: 'new',
  args: ['--no-sandbox'],
  defaultViewport: { width: 1440, height: 900 },
});
const page = await browser.newPage();
await page.goto(`http://localhost:${PORT}/${PAGE}`, { waitUntil: 'networkidle2', timeout: 60_000 }).catch(() => {});
await new Promise((r) => setTimeout(r, 1200));

const info = await page.evaluate(() => {
  const out = [];
  for (const sel of ['19eadfd', '71c5748a', '1b1d575', '2338650d']) {
    const el = document.querySelector(`.elementor-element-${sel}`);
    if (!el) { out.push({ sel, found: false }); continue; }
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    out.push({
      sel, found: true,
      display: cs.display, visibility: cs.visibility,
      rect: { w: Math.round(r.width), h: Math.round(r.height) },
      bg: cs.backgroundImage.slice(0, 90),
      cls: el.className.slice(0, 110),
      hiddenAncestor: (() => {
        let cur = el;
        while (cur && cur !== document.body) {
          const s = getComputedStyle(cur);
          if (s.display === 'none' || s.visibility === 'hidden') return cur.className.slice(0, 80) || cur.tagName;
          cur = cur.parentElement;
        }
        return null;
      })(),
    });
  }
  // count all elements whose computed bg has url(
  let bgCount = 0;
  for (const el of document.querySelectorAll('*')) {
    if (getComputedStyle(el).backgroundImage.includes('url(')) bgCount++;
  }
  return { out, bgCount };
});
console.log(JSON.stringify(info, null, 1));
await browser.close();
server.close();
