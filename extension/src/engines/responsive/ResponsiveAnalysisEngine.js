/**
 * Responsive Analysis Engine
 * --------------------------
 * Phase 4. Detects tablet/mobile styling differences without resizing the
 * viewport: it indexes every accessible stylesheet's media-query rules
 * (StylesheetIndex), resolves which override declarations match each node,
 * and runs them through the same CSS->Elementor converter used for desktop —
 * producing `settings.tablet` / `settings.mobile` ready for the `_tablet` /
 * `_mobile` suffixes at export time.
 *
 * Only *differences* against the desktop baseline are kept, mirroring how
 * Elementor inherits desktop values downward.
 */

import { BREAKPOINTS, NODE_ROLES } from '../../common/constants.js';
import { walkTree } from '../../common/utils.js';
import { declarationsToSettings } from '../css/converters.js';
import { CAPTURED_PROPS } from '../css/CssInterpretationEngine.js';
import { containsVar, resolveCssVars } from '../css/var-resolver.js';
import { StylesheetIndex } from './StylesheetIndex.js';

export class ResponsiveAnalysisEngine {
  static phaseName = 'responsive-analysis';

  run(ctx) {
    const { snapshot, document, logger } = ctx;
    const log = logger.child('responsive');
    const elements = ctx.scratch.get('elementsByNodeId');
    if (!elements || !snapshot.tree) return;

    // Reuse the index built by the CSS Interpretation Engine when present.
    const index = ctx.scratch.get('stylesheetIndex') ?? new StylesheetIndex(document).build();
    ctx.scratch.set('stylesheetIndex', index); // asset engine reads font-faces

    if (index.inaccessibleSheets > 0) {
      snapshot.tree.warnings.push(
        `${index.inaccessibleSheets} cross-origin stylesheet(s) could not be read; ` +
        'some responsive styles may be missing.',
      );
    }

    let tabletNodes = 0;
    let mobileNodes = 0;

    const win = ctx.window ?? document.defaultView;

    walkTree(snapshot.tree, (node) => {
      const el = elements.get(node.id);
      if (!el) return;
      const isContainer = node.role === NODE_ROLES.CONTAINER;

      for (const device of [BREAKPOINTS.TABLET, BREAKPOINTS.MOBILE]) {
        const overrides = index.overridesFor(el, device, CAPTURED_PROPS);
        if (!Object.keys(overrides).length) continue;

        // Override declarations are authored CSS and may reference variables
        // (`color: var(--e-global-color-accent)`); the converters can't parse
        // var() so unresolved values would silently vanish from the export.
        // Desktop-computed variable values are a fair stand-in — variables
        // are rarely redefined per-breakpoint.
        if (win && Object.values(overrides).some(containsVar)) {
          const style = win.getComputedStyle(el);
          for (const [prop, value] of Object.entries(overrides)) {
            if (containsVar(value)) {
              overrides[prop] = resolveCssVars(value, (name) => style.getPropertyValue(name));
            }
          }
        }

        // Drop overrides identical to the desktop baseline value.
        const meaningful = {};
        for (const [prop, value] of Object.entries(overrides)) {
          if (node.styles.desktop[prop] !== value) meaningful[prop] = value;
        }
        if (!Object.keys(meaningful).length) continue;

        node.styles[device] = meaningful;

        // Convert with the desktop raw as context so shorthand-relative
        // values (e.g. partial padding overrides) resolve sensibly.
        const merged = { ...pickRelated(node.styles.desktop, meaningful), ...meaningful };
        const settings = declarationsToSettings(merged, { isContainer });
        node.settings[device] = diffSettings(node.settings.desktop, settings);

        // Visibility toggles map to Elementor hide controls.
        if (meaningful.display === 'none') {
          node.settings[device][`hide_${device}`] = `hidden-${device}`;
        }
        if (device === BREAKPOINTS.TABLET) tabletNodes++; else mobileNodes++;
      }
    });

    log.info(`responsive overrides: ${tabletNodes} tablet node(s), ${mobileNodes} mobile node(s)`);
  }
}

/**
 * When an override touches one side of a box property, include the other
 * sides from desktop so dimension controls export complete values.
 */
const RELATED_GROUPS = [
  ['padding-top', 'padding-right', 'padding-bottom', 'padding-left'],
  ['margin-top', 'margin-right', 'margin-bottom', 'margin-left'],
  ['border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius'],
  ['row-gap', 'column-gap'],
];

function pickRelated(desktopRaw, overrides) {
  const out = {};
  for (const group of RELATED_GROUPS) {
    if (group.some((p) => p in overrides)) {
      for (const p of group) if (desktopRaw[p]) out[p] = desktopRaw[p];
    }
  }
  // flex conversions need display context
  if (overrides['flex-direction'] || overrides['justify-content'] || overrides['align-items']) {
    if (desktopRaw['display']) out['display'] = desktopRaw['display'];
  }
  return out;
}

/** Keep only settings that differ from the desktop baseline. */
function diffSettings(desktop, device) {
  const out = {};
  for (const [key, value] of Object.entries(device)) {
    if (JSON.stringify(desktop[key]) !== JSON.stringify(value)) out[key] = value;
  }
  return out;
}
