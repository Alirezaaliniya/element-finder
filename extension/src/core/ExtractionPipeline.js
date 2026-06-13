/**
 * ExtractionPipeline — orchestrates the content-side engines as ordered
 * phases over a shared context. Each engine is independent and communicates
 * exclusively through the snapshot IR, which keeps the system modular and
 * lets future engines (e.g. AI mapping) slot in without touching others.
 *
 *   DOM Analysis ──► Content Extraction ──► CSS Interpretation
 *        │                                        │
 *        ▼                                        ▼
 *   Responsive Analysis ──► Asset Collection ──► Widget Mapping
 */

import { EventBus } from '../common/EventBus.js';
import { rootLogger } from '../common/Logger.js';
import { createSnapshot } from './model.js';

export class ExtractionPipeline {
  /**
   * @param {Array<{name: string, engine: {run(ctx): Promise<void>|void}}>} phases
   * @param {object} [options]
   */
  constructor(phases, options = {}) {
    this.phases = phases;
    this.options = options;
    this.events = new EventBus();
    this.logger = rootLogger.child('pipeline');
  }

  /**
   * @param {Document} document
   * @param {Element} rootElement element to extract (document.body for full page)
   * @returns {Promise<object>} completed snapshot
   */
  async run(document, rootElement) {
    const startedAt = performance.now();
    const snapshot = createSnapshot({
      meta: {
        url: document.location?.href ?? '',
        title: document.title ?? '',
        lang: document.documentElement.lang || '',
        dir: document.documentElement.dir || getComputedStyle(document.documentElement).direction || 'ltr',
        extractedAt: new Date().toISOString(),
        viewport: { width: window.innerWidth, height: window.innerHeight },
        scope: rootElement === document.body ? 'page' : 'element',
      },
    });

    const ctx = {
      document,
      window: document.defaultView || window,
      rootElement,
      snapshot,
      options: this.options,
      events: this.events,
      logger: this.logger,
      /** Per-run scratch space engines may use to pass non-serializable data
       *  (e.g. node-id -> Element map). Never serialized. */
      scratch: new Map(),
    };

    const total = this.phases.length;
    for (let i = 0; i < total; i++) {
      const { name, engine } = this.phases[i];
      const phaseStart = performance.now();
      this.events.emit('phase:start', { name, index: i, total });
      try {
        await engine.run(ctx);
      } catch (err) {
        // One failing engine degrades the result, it must not lose the run.
        this.logger.error(`phase "${name}" failed`, err);
        snapshot.stats.enginePhases[name] = { ok: false, error: String(err?.message || err) };
        this.events.emit('phase:error', { name, error: err });
        continue;
      }
      const durationMs = Math.round(performance.now() - phaseStart);
      snapshot.stats.enginePhases[name] = { ok: true, durationMs };
      this.events.emit('phase:done', { name, index: i, total, durationMs });
    }

    snapshot.stats.durationMs = Math.round(performance.now() - startedAt);
    this.events.emit('done', snapshot);
    return snapshot;
  }
}
