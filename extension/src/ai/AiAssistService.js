/**
 * AI Assist Service — the extensibility seam for future AI features.
 *
 * The platform consults this service at well-defined hook points; today the
 * default provider is a no-op, so everything works fully offline. Shipping
 * an AI feature later means registering a provider — no engine changes.
 *
 * Hook points already wired:
 *   - WidgetMappingEngine: suggestMapping(node) for low-confidence widgets
 *   - ValidationEngine:    suggestFix(issue, node) for unresolved issues
 *   - Builder UI:          "AI suggestions" affordances render only when
 *                          isEnabled() returns true
 *
 * Planned hooks (interface reserved): correctStructure, optimizeDesign,
 * convertUnsupported.
 */

/**
 * Provider contract. All methods are optional; absent methods are treated
 * as "no opinion". Implementations may call remote APIs — every consumer
 * awaits and tolerates rejections.
 *
 * @typedef {object} AiProvider
 * @property {string} name
 * @property {(node: object) => Promise<{widgetType: string, confidence?: number, reason?: string}|null>} [suggestMapping]
 * @property {(tree: object) => Promise<object|null>} [correctStructure]   returns a revised tree
 * @property {(issue: object, node: object) => Promise<{label: string, patch: object}|null>} [suggestFix]
 * @property {(tree: object) => Promise<Array<{nodeId: string, advice: string}>>} [optimizeDesign]
 * @property {(node: object) => Promise<{widgetType: string, settings: object}|null>} [convertUnsupported]
 */

export class AiAssistService {
  /** @type {AiProvider|null} */
  #provider = null;

  registerProvider(provider) {
    if (!provider || typeof provider.name !== 'string') {
      throw new Error('AI provider must have a name');
    }
    this.#provider = provider;
  }

  unregisterProvider() {
    this.#provider = null;
  }

  isEnabled() {
    return this.#provider !== null;
  }

  get providerName() {
    return this.#provider?.name ?? null;
  }

  async suggestMapping(node) {
    return this.#call('suggestMapping', node);
  }

  async correctStructure(tree) {
    return this.#call('correctStructure', tree);
  }

  async suggestFix(issue, node) {
    return this.#call('suggestFix', issue, node);
  }

  async optimizeDesign(tree) {
    return (await this.#call('optimizeDesign', tree)) ?? [];
  }

  async convertUnsupported(node) {
    return this.#call('convertUnsupported', node);
  }

  async #call(method, ...args) {
    const fn = this.#provider?.[method];
    if (typeof fn !== 'function') return null;
    return fn.apply(this.#provider, args);
  }
}

/** Shared singleton — contexts that want isolation can construct their own. */
export const aiAssist = new AiAssistService();
