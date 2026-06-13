/**
 * Validation rule set. Each rule inspects one node (or the whole snapshot
 * for `scope: 'snapshot'` rules) and yields issues:
 *
 *   { severity: 'error'|'warning'|'info', code, message, nodeId?,
 *     fix?: { label, apply(node, snapshotHelpers) } }
 *
 * Fixes mutate the IR; the builder offers them as one-click actions
 * before export.
 */

import { EL_TYPES, MAPPING_SOURCES } from '../../common/constants.js';
import { walkTree } from '../../common/utils.js';
import { widgetInfo, isProWidget } from '../mapping/widget-catalog.js';

export const SEVERITY = { ERROR: 'error', WARNING: 'warning', INFO: 'info' };

export const NODE_RULES = [
  {
    code: 'missing-mapping',
    check(node) {
      if (node.mapping) return null;
      return {
        severity: SEVERITY.ERROR,
        message: 'Node has no widget mapping and would be dropped from the export.',
        fix: {
          label: 'Map to HTML widget',
          apply(n) { n.mapping = { elType: EL_TYPES.WIDGET, widgetType: 'html', confidence: 0.3, source: MAPPING_SOURCES.USER, alternatives: [] }; },
        },
      };
    },
  },
  {
    code: 'unknown-widget',
    check(node) {
      const wt = node.mapping?.widgetType;
      if (!wt || node.mapping.elType !== EL_TYPES.WIDGET || widgetInfo(wt)) return null;
      return {
        severity: SEVERITY.WARNING,
        message: `Widget type "${wt}" is not in the known Elementor catalog (third-party add-on?). Elementor will show it as missing unless the add-on is installed.`,
        fix: {
          label: 'Convert to HTML widget',
          apply(n) { n.mapping.widgetType = 'html'; n.mapping.source = MAPPING_SOURCES.USER; },
        },
      };
    },
  },
  {
    code: 'pro-widget',
    check(node) {
      const wt = node.mapping?.widgetType;
      if (!wt || !isProWidget(wt)) return null;
      return {
        severity: SEVERITY.INFO,
        message: `"${widgetInfo(wt)?.label ?? wt}" requires ${widgetInfo(wt)?.tier === 'woocommerce' ? 'WooCommerce + Elementor Pro' : 'Elementor Pro'}.`,
      };
    },
  },
  {
    code: 'low-confidence-mapping',
    check(node) {
      const m = node.mapping;
      if (!m || m.elType !== EL_TYPES.WIDGET || m.confidence >= 0.5 || m.source === MAPPING_SOURCES.USER) return null;
      return {
        severity: SEVERITY.WARNING,
        message: `Low-confidence mapping to "${m.widgetType}" (${Math.round(m.confidence * 100)}%). Review or re-map this node.`,
      };
    },
  },
  {
    code: 'image-missing-src',
    check(node) {
      if (node.mapping?.widgetType !== 'image') return null;
      if (node.content.src || node.assets.length) return null;
      return {
        severity: SEVERITY.ERROR,
        message: 'Image widget has no source URL.',
        fix: { label: 'Remove node', apply(n) { n.hidden = true; } },
      };
    },
  },
  {
    code: 'heading-empty',
    check(node) {
      if (node.mapping?.widgetType !== 'heading' || node.content.text) return null;
      return {
        severity: SEVERITY.ERROR,
        message: 'Heading widget has no text.',
        fix: { label: 'Remove node', apply(n) { n.hidden = true; } },
      };
    },
  },
  {
    code: 'button-missing-link',
    check(node) {
      if (node.mapping?.widgetType !== 'button') return null;
      if (node.content.href) return null;
      return { severity: SEVERITY.INFO, message: 'Button has no link URL; it will export without a destination.' };
    },
  },
  {
    code: 'empty-container',
    check(node) {
      if (node.mapping?.elType !== EL_TYPES.CONTAINER) return null;
      const visible = node.children.filter((c) => !c.hidden);
      if (visible.length > 0 || node.settings.desktop.background_image || node.settings.desktop.background_color || node.settings.desktop.min_height) return null;
      return {
        severity: SEVERITY.WARNING,
        message: 'Empty container with no visual styling — likely an artifact.',
        fix: { label: 'Remove container', apply(n) { n.hidden = true; } },
      };
    },
  },
  {
    code: 'absolute-position',
    check(node) {
      if (node.settings.desktop?._position !== 'absolute' && node.settings.desktop?._position !== 'fixed') return null;
      return {
        severity: SEVERITY.INFO,
        message: 'Uses absolute/fixed positioning — verify offsets after import; Elementor positions relative to its container.',
      };
    },
  },
  {
    code: 'dynamic-placeholder',
    check(node) {
      if (!node.content.dynamicPlaceholder) return null;
      return {
        severity: SEVERITY.WARNING,
        message: `Dynamic content detected (${node.content.dynamicPlaceholder.slice(0, 60)}…). Re-bind to an Elementor dynamic tag after import.`,
      };
    },
  },
  {
    code: 'unsupported-element',
    check(node) {
      if (node.mapping?.widgetType !== 'html' || !node.warnings.some((w) => w.includes('no Elementor equivalent'))) return null;
      return {
        severity: SEVERITY.WARNING,
        message: `<${node.tag}> exported as raw HTML — Elementor cannot edit its internals.`,
      };
    },
  },
];

export const SNAPSHOT_RULES = [
  {
    code: 'deep-nesting',
    check(snapshot) {
      const issues = [];
      walkTree(snapshot.tree, (node, parent, depth) => {
        if (depth === 12) {
          issues.push({
            severity: SEVERITY.WARNING, nodeId: node.id,
            message: 'Nesting deeper than 12 levels — Elementor performance and editing degrade; consider flattening.',
          });
          return false;
        }
      });
      return issues;
    },
  },
  {
    code: 'duplicate-ids',
    check(snapshot) {
      const seen = new Set();
      const issues = [];
      walkTree(snapshot.tree, (node) => {
        if (seen.has(node.id)) {
          issues.push({ severity: SEVERITY.ERROR, nodeId: node.id, message: `Duplicate element id "${node.id}" — export would corrupt the template.` });
        }
        seen.add(node.id);
      });
      return issues;
    },
  },
  {
    code: 'huge-template',
    check(snapshot) {
      let count = 0;
      walkTree(snapshot.tree, (n) => { if (!n.hidden) count++; });
      if (count <= 1500) return [];
      return [{
        severity: SEVERITY.WARNING,
        message: `Template contains ${count} elements; Elementor editors become slow beyond ~1500. Consider extracting sections separately.`,
      }];
    },
  },
  {
    code: 'cross-origin-styles',
    check(snapshot) {
      const w = snapshot.tree?.warnings?.find((x) => x.includes('cross-origin stylesheet'));
      return w ? [{ severity: SEVERITY.INFO, message: w }] : [];
    },
  },
];
