/**
 * Widget Mapping Engine
 * ---------------------
 * Phase 6 (final content-side phase). Decides, for every IR node, which
 * Elementor element it becomes:
 *
 *   1. Elementor-native passthrough — if the source page was built with
 *      Elementor, `data-element_type` / `data-widget_type` win outright.
 *   2. Custom rules — user/integration-registered, highest priority.
 *   3. Default rule set — heuristic catalog matching.
 *   4. AI suggestion hook — consulted for low-confidence nodes when an
 *      AI provider is registered (see src/ai/AiAssistService.js).
 *   5. Fallback strategy chain — container for structure, text-editor for
 *      texty leftovers, html widget as the universal last resort.
 *
 * Every decision records source + confidence + ranked alternatives so the
 * builder UI and the validation engine can expose and revise it.
 */

import { EL_TYPES, MAPPING_SOURCES, NODE_ROLES } from '../../common/constants.js';
import { walkTree } from '../../common/utils.js';
import { hoistAll } from './content-hoisting.js';
import { DEFAULT_RULES, UNSUPPORTED_TAGS } from './default-rules.js';
import { widgetInfo } from './widget-catalog.js';

export class WidgetMappingEngine {
  static phaseName = 'widget-mapping';

  /**
   * @param {object} [options]
   * @param {Array}  [options.customRules] same shape as DEFAULT_RULES entries
   * @param {object} [options.aiAssist]    AiAssistService instance (optional)
   * @param {number} [options.aiThreshold] consult AI below this confidence
   */
  constructor(options = {}) {
    this.rules = [...(options.customRules ?? []), ...DEFAULT_RULES]
      .sort((a, b) => b.priority - a.priority);
    this.aiAssist = options.aiAssist ?? null;
    this.aiThreshold = options.aiThreshold ?? 0.5;
  }

  async run(ctx) {
    const { snapshot, logger } = ctx;
    const log = logger.child('mapping');
    if (!snapshot.tree) return;

    const counts = { native: 0, rule: 0, fallback: 0, ai: 0 };
    const lowConfidence = [];

    walkTree(snapshot.tree, (node) => {
      node.mapping = this.mapNode(node);
      switch (node.mapping.source) {
        case MAPPING_SOURCES.ELEMENTOR_NATIVE: counts.native++; break;
        case MAPPING_SOURCES.RULE: counts.rule++; break;
        default: counts.fallback++; break;
      }
      if (node.mapping.confidence < this.aiThreshold && node.mapping.elType === EL_TYPES.WIDGET) {
        lowConfidence.push(node);
      }
    });

    // AI pass — only for uncertain widgets, only when a provider is wired.
    if (this.aiAssist?.isEnabled() && lowConfidence.length) {
      for (const node of lowConfidence) {
        try {
          const suggestion = await this.aiAssist.suggestMapping(node);
          if (suggestion?.widgetType && widgetInfo(suggestion.widgetType)) {
            node.mapping.alternatives.unshift({ ...node.mapping });
            node.mapping = {
              elType: EL_TYPES.WIDGET,
              widgetType: suggestion.widgetType,
              confidence: suggestion.confidence ?? 0.75,
              source: MAPPING_SOURCES.AI,
              alternatives: node.mapping.alternatives,
            };
            counts.ai++;
          }
        } catch (err) {
          log.warn('AI suggestion failed for node', node.id, err);
        }
      }
    }

    // Widgets mapped onto wrapper elements (the normal case on
    // Elementor-built pages) absorb content + text styles from their
    // primary descendants — see content-hoisting.js.
    const hoisted = hoistAll(snapshot.tree);

    log.info(`mapped: ${counts.native} native, ${counts.rule} rule, ${counts.fallback} fallback, ${counts.ai} ai, ${hoisted} hoisted`);
  }

  /** Map a single node. Pure on the IR — also used by the builder for re-mapping. */
  mapNode(node) {
    // 1) Elementor-native passthrough -------------------------------------
    const native = node.semantic.elementorNative;
    if (native) {
      if (native.widgetType && widgetInfo(native.widgetType)) {
        return decision(EL_TYPES.WIDGET, native.widgetType, 1, MAPPING_SOURCES.ELEMENTOR_NATIVE);
      }
      if (native.elType === 'container' || native.elType === 'section' || native.elType === 'column') {
        return decision(EL_TYPES.CONTAINER, null, 1, MAPPING_SOURCES.ELEMENTOR_NATIVE);
      }
      if (native.widgetType) {
        // Unknown third-party widget — keep the name, flag it for validation.
        return decision(EL_TYPES.WIDGET, native.widgetType, 0.8, MAPPING_SOURCES.ELEMENTOR_NATIVE);
      }
    }

    // 2) Unsupported tags — straight to html fallback with low confidence.
    if (UNSUPPORTED_TAGS.has(node.tag)) {
      const d = decision(EL_TYPES.WIDGET, 'html', 0.3, MAPPING_SOURCES.FALLBACK);
      node.warnings.push(`<${node.tag}> has no Elementor equivalent; exported as an HTML widget.`);
      return d;
    }

    // 3) Rule evaluation ------------------------------------------------------
    const scored = [];
    for (const rule of this.rules) {
      let confidence = 0;
      try { confidence = rule.match(node) || 0; } catch { confidence = 0; }
      if (confidence > 0) {
        scored.push({
          elType: rule.elType ?? EL_TYPES.WIDGET,
          widgetType: rule.widgetType ?? null,
          confidence,
          ruleId: rule.id,
        });
      }
    }
    scored.sort((a, b) => b.confidence - a.confidence || 0);

    if (scored.length) {
      const best = scored[0];
      const d = decision(best.elType, best.widgetType, best.confidence, MAPPING_SOURCES.RULE);
      d.ruleId = best.ruleId;
      d.alternatives = scored.slice(1, 4).map((s) => ({
        elType: s.elType, widgetType: s.widgetType, confidence: s.confidence, ruleId: s.ruleId,
      }));
      return d;
    }

    // 4) Fallback strategy chain ------------------------------------------------
    if (node.role === NODE_ROLES.CONTAINER) {
      return decision(EL_TYPES.CONTAINER, null, 0.5, MAPPING_SOURCES.FALLBACK);
    }
    if (node.content.text) {
      return decision(EL_TYPES.WIDGET, 'text-editor', 0.45, MAPPING_SOURCES.FALLBACK);
    }
    return decision(EL_TYPES.WIDGET, 'html', 0.25, MAPPING_SOURCES.FALLBACK);
  }
}

function decision(elType, widgetType, confidence, source) {
  return { elType, widgetType, confidence, source, alternatives: [] };
}
