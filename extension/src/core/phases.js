/**
 * The content-side pipeline definition, shared by the content script and the
 * e2e harnesses so both always run the exact same phases in the same order.
 */

import { DomAnalysisEngine } from '../engines/dom/DomAnalysisEngine.js';
import { ContentExtractionEngine } from '../engines/content/ContentExtractionEngine.js';
import { CssInterpretationEngine } from '../engines/css/CssInterpretationEngine.js';
import { ResponsiveAnalysisEngine } from '../engines/responsive/ResponsiveAnalysisEngine.js';
import { AssetCollectionEngine } from '../engines/assets/AssetCollectionEngine.js';
import { ElementorNativeEngine } from '../engines/elementor/ElementorNativeEngine.js';
import { WidgetMappingEngine } from '../engines/mapping/WidgetMappingEngine.js';

/**
 * @param {object} [options]
 * @param {object} [options.aiAssist] AiAssistService instance for the mapping phase
 */
export function buildPhases(options = {}) {
  return [
    { name: DomAnalysisEngine.phaseName, engine: new DomAnalysisEngine() },
    { name: ContentExtractionEngine.phaseName, engine: new ContentExtractionEngine() },
    { name: CssInterpretationEngine.phaseName, engine: new CssInterpretationEngine() },
    { name: ResponsiveAnalysisEngine.phaseName, engine: new ResponsiveAnalysisEngine() },
    { name: AssetCollectionEngine.phaseName, engine: new AssetCollectionEngine() },
    // Elementor-built pages only: exact settings from the generated CSS.
    { name: ElementorNativeEngine.phaseName, engine: new ElementorNativeEngine() },
    { name: WidgetMappingEngine.phaseName, engine: new WidgetMappingEngine({ aiAssist: options.aiAssist }) },
  ];
}
