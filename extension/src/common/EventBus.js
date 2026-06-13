/**
 * Minimal synchronous pub/sub used inside a single context
 * (pipeline progress, builder UI state changes).
 */
export class EventBus {
  #handlers = new Map();

  on(event, handler) {
    if (!this.#handlers.has(event)) this.#handlers.set(event, new Set());
    this.#handlers.get(event).add(handler);
    return () => this.off(event, handler);
  }

  once(event, handler) {
    const off = this.on(event, (...args) => { off(); handler(...args); });
    return off;
  }

  off(event, handler) {
    this.#handlers.get(event)?.delete(handler);
  }

  emit(event, payload) {
    for (const handler of this.#handlers.get(event) || []) {
      try { handler(payload); } catch (err) {
        // A faulty listener must never break the emitter.
        console.error(`[EventBus] handler for "${event}" failed`, err);
      }
    }
    for (const handler of this.#handlers.get('*') || []) {
      try { handler(event, payload); } catch { /* ignore */ }
    }
  }
}
