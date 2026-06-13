/** Probe 2: walk the ancestor chain of a missing slide and apply the same
 *  skip/classify logic the DOM engine uses, to find where it gets dropped. */
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import puppeteer from 'puppeteer-core';

const ROOT = resolve(import.meta.dirname, '../..');
const PORT = 8125;
const PAGE = encodeURIComponent('نمایندگی رسمی سایپا.htm');
const MIME = { '.html': 'text/html', '.htm': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp' };
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
  headless: 'new', args: ['--no-sandbox'], defaultViewport: { width: 1440, height: 900 },
});
const page = await browser.newPage();
await page.goto(`http://localhost:${PORT}/${PAGE}`, { waitUntil: 'networkidle2', timeout: 60_000 }).catch(() => {});
await new Promise((r) => setTimeout(r, 1200));

const chain = await page.evaluate(() => {
  const target = document.querySelector('.elementor-element-19eadfd');
  if (!target) return 'target not found';
  const out = [];
  let el = target;
  let depth = 0;
  while (el && el !== document.documentElement) {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    out.push({
      tag: el.tagName.toLowerCase(),
      cls: (typeof el.className === 'string' ? el.className : '').slice(0, 90),
      display: cs.display, visibility: cs.visibility,
      rect: `${Math.round(r.width)}x${Math.round(r.height)}`,
      children: el.childElementCount,
      textLen: (el.textContent ?? '').trim().length,
    });
    el = el.parentElement;
    if (++depth > 30) break;
  }
  return out.reverse();
});
console.log(JSON.stringify(chain, null, 1));
await browser.close();
server.close();
