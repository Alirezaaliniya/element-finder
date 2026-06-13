/**
 * Builder store — single source of truth for the builder UI.
 * Holds the working snapshot, selection, device, validation report and an
 * undo/redo history. Components subscribe through the event bus and render
 * from state; all mutations go through named actions so history stays sound.
 *
 * Events: snapshot, tree, selection, device, validation, project, saving
 */

import { EventBus } from '../../common/EventBus.js';
import { BREAKPOINTS, EL_TYPES, MAPPING_SOURCES } from '../../common/constants.js';
import { deepClone, findNode, findParent, walkTree } from '../../common/utils.js';
import { hoistWidgetContent } from '../../engines/mapping/content-hoisting.js';

const HISTORY_LIMIT = 50;

export class BuilderStore {
  constructor() {
    this.events = new EventBus();
    this.project = null;       // { id, name, ... } persisted wrapper
    this.snapshot = null;      // working IR snapshot
    this.selectedId = null;
    this.device = BREAKPOINTS.DESKTOP;
    this.validation = null;
    this.dirty = false;
    this.#undoStack = [];
    this.#redoStack = [];
  }

  #undoStack;
  #redoStack;

  /* ---------------- loading ---------------- */

  loadProject(project) {
    this.project = project;
    this.snapshot = project.snapshot;
    this.selectedId = null;
    this.validation = null;
    this.dirty = false;
    this.#undoStack = [];
    this.#redoStack = [];
    this.events.emit('project', project);
    this.events.emit('snapshot', this.snapshot);
  }

  get tree() {
    return this.snapshot?.tree ?? null;
  }

  node(id) {
    return this.tree ? findNode(this.tree, id) : null;
  }

  selectedNode() {
    return this.selectedId ? this.node(this.selectedId) : null;
  }

  /* ---------------- selection / device ---------------- */

  select(id) {
    if (this.selectedId === id) return;
    this.selectedId = id;
    this.events.emit('selection', id);
  }

  setDevice(device) {
    if (this.device === device) return;
    this.device = device;
    this.events.emit('device', device);
  }

  /* ---------------- mutations ---------------- */

  #beginMutation() {
    this.#undoStack.push(deepClone(this.snapshot.tree));
    if (this.#undoStack.length > HISTORY_LIMIT) this.#undoStack.shift();
    this.#redoStack = [];
  }

  #commit() {
    this.dirty = true;
    this.validation = null;
    this.events.emit('tree', this.tree);
  }

  /** Run `fn(node)` against a node as one undoable mutation. */
  mutateNode(id, fn) {
    const node = this.node(id);
    if (!node) return false;
    this.#beginMutation();
    fn(node);
    this.#commit();
    return true;
  }

  updateText(id, text) {
    return this.mutateNode(id, (n) => {
      n.content.text = text;
      if (n.content.html) n.content.html = `<p>${escapeBasic(text)}</p>`;
      if (n.label.includes(':')) n.label = `${n.label.split(':')[0]}: ${text.slice(0, 32)}`;
    });
  }

  updateLink(id, href) {
    return this.mutateNode(id, (n) => { n.content.href = href; });
  }

  replaceImage(id, url) {
    return this.mutateNode(id, (n) => {
      n.content.src = url;
      n.content.replacedImage = true;
    });
  }

  changeMapping(id, { elType, widgetType }) {
    return this.mutateNode(id, (n) => {
      const prev = n.mapping ? { ...n.mapping, alternatives: [] } : null;
      n.mapping = {
        elType: elType ?? (widgetType ? EL_TYPES.WIDGET : EL_TYPES.CONTAINER),
        widgetType: widgetType ?? null,
        confidence: 1,
        source: MAPPING_SOURCES.USER,
        alternatives: prev ? [prev, ...(n.mapping?.alternatives ?? [])].slice(0, 4) : [],
      };
      // The new widget type may pull its content from descendants
      // (e.g. user maps a wrapper div to "image" — absorb the inner <img>).
      hoistWidgetContent(n);
    });
  }

  removeNode(id) {
    return this.mutateNode(id, (n) => { n.hidden = true; });
  }

  restoreNode(id) {
    return this.mutateNode(id, (n) => { n.hidden = false; });
  }

  /**
   * Drag & drop move.
   * @param {string} sourceId
   * @param {string} targetId
   * @param {'before'|'after'|'inside'} position
   */
  moveNode(sourceId, targetId, position) {
    if (sourceId === targetId || !this.tree) return false;
    const source = findNode(this.tree, sourceId);
    const target = findNode(this.tree, targetId);
    if (!source || !target) return false;
    // No moving an ancestor into its own descendant.
    if (findNode(source, targetId)) return false;
    if (position === 'inside' && target.mapping?.elType !== EL_TYPES.CONTAINER) return false;

    const sourceParent = findParent(this.tree, sourceId);
    const targetParent = position === 'inside' ? target : findParent(this.tree, targetId);
    if (!sourceParent || !targetParent) return false;

    this.#beginMutation();
    sourceParent.children.splice(sourceParent.children.indexOf(source), 1);
    if (position === 'inside') {
      target.children.push(source);
    } else {
      const idx = targetParent.children.indexOf(target);
      targetParent.children.splice(position === 'after' ? idx + 1 : idx, 0, source);
    }
    this.#commit();
    return true;
  }

  /* ---------------- history ---------------- */

  undo() {
    if (!this.#undoStack.length) return false;
    this.#redoStack.push(deepClone(this.snapshot.tree));
    this.snapshot.tree = this.#undoStack.pop();
    this.dirty = true;
    this.validation = null;
    this.events.emit('tree', this.tree);
    return true;
  }

  redo() {
    if (!this.#redoStack.length) return false;
    this.#undoStack.push(deepClone(this.snapshot.tree));
    this.snapshot.tree = this.#redoStack.pop();
    this.dirty = true;
    this.validation = null;
    this.events.emit('tree', this.tree);
    return true;
  }

  get canUndo() { return this.#undoStack.length > 0; }
  get canRedo() { return this.#redoStack.length > 0; }

  /* ---------------- validation ---------------- */

  setValidation(report) {
    this.validation = report;
    this.events.emit('validation', report);
  }

  /* ---------------- stats ---------------- */

  visibleCount() {
    let count = 0;
    if (this.tree) walkTree(this.tree, (n) => { if (n.hidden) return false; count++; });
    return count;
  }
}

function escapeBasic(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
