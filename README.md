# Element Finder Studio

A professional **extraction & reconstruction platform** delivered as a Chrome extension: analyze any web page, map its structure to Elementor widgets, refine the result in a visual builder, and export Elementor-ready JSON together with a complete assets package.

> This is not an HTML-to-JSON converter. It is a modular pipeline of dedicated engines with a builder UI, validation, project storage with versioning, and an extensibility seam for AI-assisted mapping.

## Repository layout

```
extension/            The Chrome extension (Manifest V3, ES modules, no build step)
├── manifest.json
├── smoke-test.mjs    Node-runnable tests for the DOM-free engine modules
└── src/
    ├── common/       constants, utils, Logger, EventBus (context-agnostic)
    ├── core/         IR data model + ExtractionPipeline orchestrator
    ├── engines/      the 10 engines (see docs/ARCHITECTURE.md)
    ├── ai/           AiAssistService — pluggable AI provider seam
    ├── content/      content-script bootstrap, pipeline runner, element picker
    ├── background/   service worker (message routing, snapshot hand-off)
    └── ui/           popup + visual builder (tree, preview, inspector, dialogs)
docs/ARCHITECTURE.md  Engine-by-engine architecture reference
elementor-*.json      Real Elementor template export used as format ground truth
نمایندگی رسمی سایپا*  Saved Elementor-built page used as a test fixture
```

## Install (development)

1. Open `chrome://extensions`, enable **Developer mode**.
2. **Load unpacked** → select the `extension/` folder.
3. Pin "Element Finder Studio".

No build tooling is required — the codebase is plain ES modules loaded natively.

## Usage

1. Open any page (great first test: a site built with Elementor — the extractor
   detects `data-element_type` / `data-widget_type` and passes widgets through
   with 100% confidence).
2. Click the extension icon →
   - **Extract full page** — run the pipeline on `<body>`, or
   - **Pick an element** — click any section on the page to extract just it.
3. The **builder** opens automatically:
   - **Structure** panel: expand/collapse, drag & drop to reorder/reparent,
     `Delete` key or 🗑 to remove nodes, double-click to restore.
   - **Preview**: live reconstruction; click elements to select; switch
     desktop / tablet / mobile.
   - **Inspector**: edit text, edit links, replace images, re-map any node to
     another widget (full Free/Pro catalog), inspect per-device Elementor
     settings, see warnings.
   - **✓ Validate**: errors/warnings/suggestions with one-click fixes.
   - **💾 Save / 🏷 Version / 📁 Projects**: local IndexedDB storage, frozen
     versions, restore and structural compare.
4. **⤓ Export** — any combination of:
   - **Elementor Template JSON** (`version: 0.4`; import via Elementor →
     Templates → Saved Templates → Import)
   - **Structure JSON** (lightweight hierarchy for integrations)
   - **Raw Data JSON** (lossless snapshot backup)
   - **HTML Snapshot** (standalone reconstruction document)
   - **Assets Package** (ZIP of images/SVGs/fonts/posters + manifest)

## Engineering notes

- **Engines communicate only through the snapshot IR** (plain JSON), so each
  engine is independently testable and replaceable.
- One failing engine degrades the result instead of losing the run (the
  pipeline records per-phase status in `snapshot.stats.enginePhases`).
- Bounded extraction: node/depth/asset caps in `src/common/constants.js`
  keep pathological pages from hanging the tab.
- Responsive analysis reads media-query rules from accessible stylesheets and
  maps them to Elementor's tablet (≤1024px) / mobile (≤767px) breakpoints;
  cross-origin stylesheets are counted and surfaced as a warning.
- The AI seam (`src/ai/AiAssistService.js`) is live but inert: register a
  provider implementing `suggestMapping` / `suggestFix` / `correctStructure`
  and the mapping + validation engines consume it automatically.

## Release

```
node tools/build-release.mjs
```

Produces `releases/element-finder-studio-v<version>.zip` with `manifest.json`
at the archive root (the layout the Chrome Web Store and "Load unpacked"
expect), excluding dev-only files. The version is read from `manifest.json`.

## Tests

```
cd extension
node smoke-test.mjs
```

Covers CSS converters, widget mapping (rules + native passthrough +
fallbacks), the Elementor exporter (responsive suffixes, setting renames,
hidden-node dropping), the ZIP writer and the validation engine.

## Roadmap candidates

- AI provider implementation (automatic widget recognition / structure correction)
- Promote extracted palette/fonts to Elementor Global colors & typography
- WordPress companion plugin for one-click import with asset side-loading
- Section/template library and team sync (SaaS backend)
