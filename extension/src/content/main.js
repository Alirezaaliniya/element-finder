/**
 * Content-script entry (ES module, loaded by bootstrap.js).
 * Assembles the extraction pipeline, answers popup/background commands and
 * ships the finished snapshot to the service worker.
 */

import { MSG } from '../common/constants.js';
import { rootLogger } from '../common/Logger.js';
import { ExtractionPipeline } from '../core/ExtractionPipeline.js';
import { DomAnalysisEngine } from '../engines/dom/DomAnalysisEngine.js';
import { ContentExtractionEngine } from '../engines/content/ContentExtractionEngine.js';
import { CssInterpretationEngine } from '../engines/css/CssInterpretationEngine.js';
import { ResponsiveAnalysisEngine } from '../engines/responsive/ResponsiveAnalysisEngine.js';
import { AssetCollectionEngine } from '../engines/assets/AssetCollectionEngine.js';
import { WidgetMappingEngine } from '../engines/mapping/WidgetMappingEngine.js';
import { aiAssist } from '../ai/AiAssistService.js';
import { ElementPicker } from './ElementPicker.js';

const log = rootLogger.child('content');
const picker = new ElementPicker();
let running = false;

function buildPipeline() {
  return new ExtractionPipeline([
    { name: DomAnalysisEngine.phaseName, engine: new DomAnalysisEngine() },
    { name: ContentExtractionEngine.phaseName, engine: new ContentExtractionEngine() },
    { name: CssInterpretationEngine.phaseName, engine: new CssInterpretationEngine() },
    { name: ResponsiveAnalysisEngine.phaseName, engine: new ResponsiveAnalysisEngine() },
    { name: AssetCollectionEngine.phaseName, engine: new AssetCollectionEngine() },
    { name: WidgetMappingEngine.phaseName, engine: new WidgetMappingEngine({ aiAssist }) },
  ]);
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

    case MSG.EXTRACT_PAGE:
      extract(document.body).then(sendResponse);
      return true; // async response

    case MSG.PICK_ELEMENT:
      picker.pick().then((el) => {
        if (!el) { sendResponse({ ok: false, cancelled: true }); return; }
        extract(el).then(sendResponse);
      });
      return true;

    case MSG.CANCEL_PICK:
      picker.cancel();
      sendResponse({ ok: true });
      return false;

    default:
      return false;
  }
});

log.info('Element Finder content module ready');
