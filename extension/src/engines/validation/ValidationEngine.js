/**
 * Validation Engine
 * -----------------
 * Runs in the builder before export (and on demand). Walks the IR with the
 * declarative rule set, producing a report of errors / warnings / info with
 * optional one-click fixes. The Export Engine refuses (configurable) to
 * export while errors remain.
 *
 * The AI assist hook lets a future provider propose fixes for issues that
 * have no static remedy.
 */

import { walkTree } from '../../common/utils.js';
import { NODE_RULES, SNAPSHOT_RULES, SEVERITY } from './validation-rules.js';

export class ValidationEngine {
  constructor(options = {}) {
    this.nodeRules = [...NODE_RULES, ...(options.customNodeRules ?? [])];
    this.snapshotRules = [...SNAPSHOT_RULES, ...(options.customSnapshotRules ?? [])];
    this.aiAssist = options.aiAssist ?? null;
  }

  /**
   * @returns {{issues: Array, counts: {error:number,warning:number,info:number}, ok: boolean}}
   */
  validate(snapshot) {
    const issues = [];
    if (!snapshot?.tree) {
      return { issues: [{ severity: SEVERITY.ERROR, code: 'no-tree', message: 'Snapshot has no extracted tree.' }], counts: { error: 1, warning: 0, info: 0 }, ok: false };
    }

    walkTree(snapshot.tree, (node) => {
      if (node.hidden) return false; // skip removed subtrees
      for (const rule of this.nodeRules) {
        let result;
        try { result = rule.check(node); } catch { continue; }
        if (!result) continue;
        for (const issue of Array.isArray(result) ? result : [result]) {
          issues.push({ code: rule.code, nodeId: node.id, nodeLabel: node.label, ...issue });
        }
      }
    });

    for (const rule of this.snapshotRules) {
      let results;
      try { results = rule.check(snapshot) || []; } catch { continue; }
      for (const issue of results) issues.push({ code: rule.code, ...issue });
    }

    const order = { error: 0, warning: 1, info: 2 };
    issues.sort((a, b) => order[a.severity] - order[b.severity]);

    const counts = { error: 0, warning: 0, info: 0 };
    for (const i of issues) counts[i.severity]++;
    return { issues, counts, ok: counts.error === 0 };
  }

  /** Apply a rule-provided fix to its node; returns true when applied. */
  applyFix(snapshot, issue) {
    if (!issue?.fix || !issue.nodeId) return false;
    let applied = false;
    walkTree(snapshot.tree, (node) => {
      if (node.id !== issue.nodeId) return;
      try { issue.fix.apply(node, { snapshot }); applied = true; } catch { /* surfaced by re-validate */ }
      return false;
    });
    return applied;
  }

  /** Ask the AI provider (when present) for fixes on otherwise-unfixable issues. */
  async suggestAiFixes(snapshot, issues) {
    if (!this.aiAssist?.isEnabled()) return [];
    const suggestions = [];
    for (const issue of issues.filter((i) => !i.fix && i.nodeId)) {
      let node = null;
      walkTree(snapshot.tree, (n) => { if (n.id === issue.nodeId) { node = n; return false; } });
      if (!node) continue;
      const s = await this.aiAssist.suggestFix(issue, node).catch(() => null);
      if (s) suggestions.push({ issue, suggestion: s });
    }
    return suggestions;
  }
}
