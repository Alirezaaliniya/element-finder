/**
 * Content-script entry (ES module, loaded by bootstrap.js).
 * Assembles the extraction pipeline, answers popup/background commands and
 * ships the finished snapshot to the service worker.
 */

import { MSG } from '../common/constants.js';
import { rootLogger } from '../common/Logger.js';
import { ExtractionPipeline } from '../core/ExtractionPipeline.js';
import { buildPhases } from '../core/phases.js';
import { aiAssist } from '../ai/AiAssistService.js';
import { ElementPicker } from './ElementPicker.js';

const log = rootLogger.child('content');
const picker = new ElementPicker();
let running = false;

function buildPipeline() {
  return new ExtractionPipeline(buildPhases({ aiAssist }));
}

async function extract(rootElement) {
  if (running) throw new Error('Extraction already in progress');
  running = true;
  try {
    const pipeline = buildPipeline();
    pipeline.events.on('phase:start', ({ name, index, total }) => {
      void chrome.runtime.sendMessage({
        type: MSG.EXTRACTION_PROGRESS,
        phase: name, index, total,
      }).catch(() => {});
    });
    const snapshot = await pipeline.run(document, rootElement);
    await chrome.runtime.sendMessage({ type: MSG.EXTRACTION_COMPLETE, snapshot });
    log.info('extraction complete', snapshot.stats);
    return { ok: true, stats: snapshot.stats };
  } catch (err) {
    log.error('extraction failed', err);
    await chrome.runtime.sendMessage({
      type: MSG.EXTRACTION_FAILED,
      error: String(err?.message || err),
    }).catch(() => {});
    return { ok: false, error: String(err?.message || err) };
  } finally {
    running = false;
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  switch (msg?.type) {
    case MSG.PING:
      sendResponse({ ok: true });
      return false;

    // Extraction can take a while on large pages (stylesheet fetches, media
    // library lookups), longer than the popup's message channel lives. Reply
    // at once; progress and the result travel through the service worker
    // (EXTRACTION_PROGRESS / COMPLETE / FAILED -> stored status).
    case MSG.EXTRACT_PAGE:
      if (running) { sendResponse({ ok: false, error: 'Extraction already in progress' }); return false; }
      void extract(document.body);
      sendResponse({ ok: true, started: true });
      return false;

    case MSG.PICK_ELEMENT:
      sendResponse({ ok: true, started: true });
      picker.pick().then((el) => { if (el) void extract(el); });
      return false;

    case MSG.CANCEL_PICK:
      picker.cancel();
      sendResponse({ ok: true });
      return false;

    default:
      return false;
  }
});

log.info('Element Finder content module ready');
