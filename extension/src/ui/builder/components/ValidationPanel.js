/**
 * ValidationPanel — renders the Validation Engine report under the preview.
 * Issues link to their node (click selects it); rule-provided fixes apply
 * with one click and trigger re-validation.
 */

export class ValidationPanel {
  /**
   * @param {HTMLElement} root
   * @param {import('../store.js').BuilderStore} store
   * @param {import('../../../engines/validation/ValidationEngine.js').ValidationEngine} engine
   */
  constructor(root, store, engine) {
    this.root = root;
    this.store = store;
    this.engine = engine;
    store.events.on('validation', (report) => this.render(report));
  }

  runValidation() {
    const report = this.engine.validate(this.store.snapshot);
    this.store.setValidation(report);
    return report;
  }

  render(report) {
    this.root.textContent = '';
    if (!report) { this.root.classList.add('hidden'); return; }
    this.root.classList.remove('hidden');

    const head = document.createElement('div');
    head.className = 'validation-head';
    const title = document.createElement('strong');
    title.textContent = report.ok ? '✓ Export-ready' : '✗ Issues found';
    title.style.color = report.ok ? 'var(--ok)' : 'var(--danger)';
    const counts = document.createElement('span');
    counts.className = 'vp-count';
    counts.textContent = `${report.counts.error} errors · ${report.counts.warning} warnings · ${report.counts.info} notes`;
    const close = document.createElement('button');
    close.className = 'close';
    close.textContent = '✕';
    close.addEventListener('click', () => this.root.classList.add('hidden'));
    head.append(title, counts, close);
    this.root.appendChild(head);

    for (const issue of report.issues.slice(0, 200)) {
      this.root.appendChild(this.#issueRow(issue));
    }
  }

  #issueRow(issue) {
    const row = document.createElement('div');
    row.className = 'vp-issue';

    const dot = document.createElement('span');
    dot.className = `vp-sev ${issue.severity}`;
    row.appendChild(dot);

    const text = document.createElement('span');
    text.textContent = (issue.nodeLabel ? `[${issue.nodeLabel}] ` : '') + issue.message;
    row.appendChild(text);

    if (issue.nodeId) {
      row.addEventListener('click', () => this.store.select(issue.nodeId));
    }

    if (issue.fix) {
      const fixBtn = document.createElement('button');
      fixBtn.className = 'vp-fix';
      fixBtn.textContent = `Fix: ${issue.fix.label}`;
      fixBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        // Route through the store so the fix is undoable and re-renders.
        const applied = this.store.mutateNode(issue.nodeId, (node) => issue.fix.apply(node, { snapshot: this.store.snapshot }));
        if (applied) this.runValidation();
      });
      row.appendChild(fixBtn);
    }
    return row;
  }
}
