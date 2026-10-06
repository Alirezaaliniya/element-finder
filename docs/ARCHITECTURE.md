# Element Finder Studio — Architecture

## Design principles

1. **Engines, not scripts.** Every responsibility is a dedicated engine with a
   single entry point. Engines never call each other directly; they read and
   write the shared **Intermediate Representation (IR)** — a plain-JSON
   snapshot — so they can be developed, tested and replaced independently.
2. **Two execution domains.** Extraction engines need the live DOM and run in
   the content script. Refinement engines (reconstruction, validation,
   storage, export) are DOM-free and run in the builder page. The IR is the
   only thing that crosses the boundary.
3. **Decisions carry provenance.** Every widget mapping records its source
   (`elementor-native | rule | heuristic | ai | user | fallback`), confidence
   and ranked alternatives — the builder UI and validation are built on this.
4. **Fail soft.** A failing engine phase logs into `stats.enginePhases` and the
   pipeline continues; a failing asset download lands in the manifest instead
   of aborting the package; cross-origin stylesheets become a warning.
5. **No build step.** Native ES modules everywhere; MV3 constraints handled by
   a classic bootstrap that dynamic-imports the module graph.

## The Intermediate Representation

```jsonc
// Snapshot
{
  "meta":    { "url", "title", "lang", "dir", "extractedAt", "viewport", "scope" },
  "tree":    { /* root ExtractedNode */ },
  "assets":  [ { "id", "type", "url|inline", "filename", "meta", "usedBy" } ],
  "globals": { "colors": [], "fonts": [] },          // page design tokens
  "stats":   { "nodesExtracted", "enginePhases", ... }
}

// ExtractedNode (recursive)
{
  "id": "7e1df36",                  // Elementor-style hex id, stable across edits
  "tag": "div", "role": "container|widget",
  "label": "hero (section)", "domPath": "body>div:nth-child(2)…",
  "semantic": { "kind": "hero", "isRepeated": false, "patternKey": null,
                "elementorNative": { "elType", "widgetType", "settings" } },
  "layout":  { "display", "direction", "gap", "justify", "align", "columns" },
  "rect":    { "x", "y", "width", "height" },
  "content": { "text", "html", "href", "src", "fields", "menu", … },
  "styles":   { "desktop": {raw CSS}, "tablet": {overrides}, "mobile": {overrides} },
  "settings": { "desktop": {Elementor}, "tablet": {…}, "mobile": {…} },
  "mapping": { "elType", "widgetType", "confidence", "source", "alternatives" },
  "assets": ["a1b2c3"], "hidden": false, "warnings": [], "children": […]
}
```

## Pipeline (content-script domain)

`core/ExtractionPipeline.js` runs ordered phases over a shared context
(`document`, `snapshot`, `scratch` map for non-serializable hand-offs such as
the node-id → Element map):

| # | Engine | Output |
|---|--------|--------|
| 1 | **DOM Analysis** (`engines/dom`) | IR tree: hierarchy, container/widget roles, flex/grid layout facts, semantic kinds (hero/header/card/slider/…), repeating-pattern detection (loop-grid candidates), Elementor-native metadata, wrapper-chain collapsing |
| 2 | **Content Extraction** (`engines/content`) | text/rich HTML (sanitized), links, button detection, form field schemas, menu trees, media refs, dynamic-content placeholders (shortcodes, moustache) |
| 3 | **CSS Interpretation** (`engines/css`) | curated computed-style capture (allowlist of ~60 props) → Elementor settings: spacing, typography, sizing, borders, radius, shadows, backgrounds (color/image/gradient), positioning, flex container/item settings; page palette + font tokens |
| 4 | **Responsive Analysis** (`engines/responsive`) | StylesheetIndex buckets media-query rules into Elementor breakpoints (tablet ≤1024, mobile ≤767); per-node override resolution through the *same* converter as desktop; diffed against baseline; visibility → `hide_tablet`/`hide_mobile` |
| 5 | **Asset Collection** (`engines/assets`) | deduplicated catalog: `<img>`+srcset, inline SVG, icon-font glyphs, video+poster, embeds, CSS backgrounds per device, `@font-face` fonts, favicon |
| 6 | **Elementor Native** (`engines/elementor`) | Elementor-built pages only: exact control settings reversed from the generated post CSS, wrapper-class settings, Pro custom CSS (verbatim), native widget content from render templates, atomic (V4) elements, styles and global classes (see below) |
| 7 | **Widget Mapping** (`engines/mapping`) | decision per node: native passthrough → custom rules → default rules → AI hook → fallback chain (container / text-editor / html) |

The phase list lives in `core/phases.js`, shared by the content script and
the e2e harnesses so they always run the same pipeline.

## Builder domain engines

| Engine | Role |
|--------|------|
| **Visual Reconstruction** (`engines/reconstruction`) | IR → standalone preview document (iframe `srcdoc`, sandboxed `allow-scripts` only): per-widget renderers, generated per-node CSS incl. media queries, two-way selection sync via `postMessage` |
| **Validation** (`engines/validation`) | declarative node rules + snapshot rules → errors/warnings/info with optional one-click `fix` closures; export is blocked on errors (override available); AI fix-suggestion hook |
| **Project Storage** (`engines/storage`) | IndexedDB: working projects + immutable frozen versions; structural snapshot diff (added/removed/re-mapped/edited) |
| **Export** (`engines/export`) | format strategy registry: Elementor template JSON (v0.4, control names resolved per element type by `widget-controls.js`, `_tablet`/`_mobile` suffixes only where Elementor registers a responsive control), Structure JSON, Raw JSON, HTML snapshot, Assets ZIP (dependency-free STORE ZipWriter with CRC-32, failure manifest) |

## Elementor-built pages: reversing Elementor's own rendering

Computed style is a lossy view of what Elementor saved: inherited values,
kit defaults, `var()` globals and hover/responsive variants all collapse into
one resolved number. On a page built with Elementor the exact settings are
recoverable, because Elementor writes every style control into post CSS
through that control's `selectors` template
(`core/files/css/base.php::add_control_rules`):

```
title_color  {{WRAPPER}} .elementor-heading-title  =>  color: {{VALUE}};
                     ↓ rendered as
.elementor-15 .elementor-element.elementor-element-7168490 .elementor-heading-title{color:#F47421;}
```

`engines/elementor` runs that in reverse:

| Module | Role |
|--------|------|
| `data/controls-map.json` | Every element's style controls, dumped from the installed plugins by `tools/elementor-dump/dump-controls.php`: selectors, dictionaries, unit dictionaries, group/responsive info, `prefix_class`, conditions, defaults and options. It also holds the atomic Style_Schema with enums. Regenerate it whenever Elementor, Pro or a third-party widget plugin changes. |
| `css-text.js` | Raw stylesheet text from inline `<style>` and fetched sheets (through the service worker when the page's CORS blocks the content script), plus a small parser. It reads raw text rather than CSSOM, because CSSOM rewrites hex to `rgb()`, collapses shorthands and drops comments. Pro marks per-element custom CSS only with `/* Start custom CSS for <widget>, class: .elementor-element-<id> */` comments, and each region's text is kept verbatim. Link-level media (`local-…-tablet.css` loaded with `media=(max-width:1024px)`) is folded into each rule. |
| `controls-index.js` | Compiles the map per element type into matchers keyed by normalized selector. Placeholders (`{{VALUE}}`, `{{SIZE}}{{UNIT}}`, `{{TOP}}…`, external `{{other.VALUE}}`) become capture regexes. Dictionary and unit-dictionary values expand into variants, and shorthands also match their CSSOM longhands. |
| `css-reverse.js` | Groups an element's rules by selector, breakpoint and repeater item, then matches them to controls. It builds typed values (slider, dimensions, gaps, colour, media, box/text shadow, font…) and recognises kit globals: `var( --e-global-color-x )` becomes a `__globals__` reference plus the resolved value. It also reverses wrapper classes written through `prefix_class`, satisfies control conditions (including per-device and repeater-item ones) and drops defaults. Anything no control explains is returned as `custom_css`, with the wrapper rewritten to `selector`. |
| `native-content.js` | Reads content back through each widget's render template: heading tag and link, button text, size and icon, icons (`e-fas-user` → `fas fa-user`), icon and image boxes, icon lists, social icons with their repeater `_id`s, counters, HTML, logos and hover animations. |
| `atomic.js` | Handles V4 elements. Atomic containers render `data-element_type="e-flexbox"`; atomic widgets render no wrapper and are recognised by their `<type>-base` class. It reads typed settings from the DOM and converts CSS to typed style props that are valid under Style_Schema (logical box sides, enums checked). Anything else goes to the variant's `custom_css`. |
| `ElementorNativeEngine.js` | The pipeline phase that ties these together. It reads the site's real breakpoints from `elementorFrontendConfig`. |

Results live on `node.semantic.elementorNative` (`exact`, `content`,
`atomicData`). The exporter uses them while the node keeps its native mapping;
if the user re-maps a node, it falls back to the generic computed-style path.

Export options (builder → Export, shown for Elementor-source pages only):

- **Keep global references**: also exports `__globals__`. Use it only when
  importing into the same site, because Elementor skips a style whose global
  is missing. By default the export carries resolved values only, which keeps
  it portable.
- **Atomic elements**: keep them as V4 JSON (typed settings, `styles`, and a
  template `global_classes` snapshot that Elementor merges on import), or
  convert them to classic widgets for sites without Elementor 4.

Other Elementor-specific handling:

- Elements hidden only on desktop (`elementor-hidden-desktop`) are kept.
- Closed nested-widget panels (mega-menu dropdowns, inactive tabs) are kept.
- Content hidden by an entrance animation (`visibility:hidden`) is no longer dropped.
- Elementor's structural wrappers (`.e-con-inner`, `.elementor-widget-wrap`,
  document wrappers) are flattened.
- Nested widgets get one child container per repeater item, placed by
  `data-tab-index`.
- Full-page exports contain only the Elementor documents' elements.

Some things cannot be recovered from a rendered page. These are flagged
rather than guessed:

- uploaded SVG icons, which Elementor inlines from the attachment by id;
- WordPress menu ids;
- dynamic tags;
- values Elementor saved but never renders, such as an icon size on an icon
  box that has no icon.

### Verifying fidelity

`tools/e2e/fidelity.mjs <url>` runs the real pipeline in headless Chrome and
scores the export element by element against the documents' saved
`_elementor_data` (read through `tools/e2e/elementor-data.php`):

```
node tools/e2e/fidelity.mjs http://localhost/saipa/ --verbose
```

The other tools:

- `tools/e2e/extension-run.mjs <url>` runs the same extraction through the
  real unpacked extension: service worker → content script → builder.
- `tools/e2e/reverse-debug.mjs <post.css> --id <id> --type <widget>` reverses
  a single element offline.
- `tools/elementor-dump/make-atomic-fixture.php` builds a test page with
  atomic elements, local styles, a global class and Pro custom CSS.

## Control-name resolution

Elementor has no single name per visual property. `padding` is `padding` on a
container but `_padding` on a widget; text colour is `title_color` on a
heading, `text_color` on a text editor, `content_content_color` on a
testimonial; background is `background_*` on a container but `_background_*`
on a widget's Advanced tab; custom classes are `css_classes` on a container and
`_css_classes` on a widget. A setting written under the wrong name imports
without error and is then never rendered — the style is silently lost.

`export/widget-controls.js` is the map that prevents that. It holds, per widget
type, the group name of its primary typography, its text-colour / alignment /
padding controls and any box-styling groups it owns, plus the set of canonical
keys whose control is *not* responsive (colours, typography switches, font
family/weight, `_position`, `css_classes`). `resolveSettingKey(key, widgetType)`
returns the real control name or `null` to drop the setting; the exporter never
writes a key it could not resolve. Every entry is transcribed from the
Elementor / Elementor Pro plugin source rather than inferred.

## Widget mapping in depth

- **Catalog** (`widget-catalog.js`): every supported widget with tier
  (free / pro / theme-builder / woocommerce) — drives the inspector dropdown
  and "requires Pro" validation notes.
- **Rules** (`default-rules.js`): priority-ordered matchers over the IR
  returning confidence 0..1. Composite detectors (icon-box, image-box,
  social-icons, gallery, loop-grid via pattern keys, testimonial/pricing/tabs/
  accordion/slider via semantic kinds). Custom rules can be injected via the
  engine constructor — the same path a SaaS rule-editor would use.
- **Elementor-native passthrough**: pages already built with Elementor expose
  `data-element_type` / `data-widget_type` / `data-settings`; these map with
  confidence 1.0 and unknown third-party widgets keep their name + settings,
  flagged by validation. Skin variants (`loop-carousel.product`) split into
  widget type + `_skin` setting, matching Elementor's own export format.
- **Content hoisting** (`content-hoisting.js`): widgets usually map onto
  *wrapper* elements while content and text styling live on descendants
  (`div[data-widget_type=heading] > … > h2`). Since Elementor widgets cannot
  carry child elements, every widget-mapped node absorbs its primary
  descendant's content (text/src/href/fields/menu) and the style settings
  that belong to the widget (typography/color from text, box styles from
  buttons). Runs post-order after mapping; re-runs when the user re-maps a
  node in the builder. Composite widgets (icon-box, testimonial, …) collect a
  structured `content.composite` payload. As a safety net, the exporter
  converts an unknown composite widget *with* children into a container
  rather than dropping its subtree.
- **Lazy-asset rescue**: lazy-loaded `<img>` (data-src/srcset/picture) resolve
  through `image-utils.js`; backgrounds that lazy-load gates force to `none`
  at computed-style time (Elementor's `.e-lazyloaded`) are rescued from the
  declared stylesheet rules with URLs resolved against each stylesheet.
- **Fidelity on Elementor pages** (verified by diffing a real Elementor
  section export against the extension's output):
  - *Inherited-style suppression*: typography/color/align are captured only
    when they differ from the DOM parent, so images/buttons/containers don't
    inherit the page's body font as if it were their own setting.
  - *Custom CSS classes*: framework/builder classes are filtered
    (`customClassTokens`), leaving authored classes (`nias-pop-animation`,
    `ns-button`) which export as `_css_classes` — and the page's matching
    custom CSS is recovered from inline `<style>` (scope prefix stripped) into
    `page_settings.custom_css`, so custom styling keeps working post-import.
  - *Authored widths*: Elementor's `--width` custom property (which keeps
    `47%`/`1200px`, unlike the computed px longhand) maps to container `width`
    /`content_width` or a widget's `_element_width`/`_element_custom_width`.
  - *Native data-settings merge*: frontend `data-settings` (sparse —
    `background_background`, `_position`, menu/swiper config) overlay our
    derived settings for native elements; inline CSS supplies the rest.
  - *Not recoverable from a static page* (documented, not silently dropped):
    `motion_fx_*` scroll/scale effects (applied by JS from server-only data),
    WordPress media `id`s, and `__globals__`/`__dynamic__` references — for the
    latter two the extension exports the **resolved** value (hex color, real
    URL), which is more portable across sites.
- **Fallback chain**: container → text-editor → html. Nothing is dropped
  silently; low confidence is visible in the tree (red chip) and validation.

## Messaging & hand-off

```
popup ── scripting.executeScript(bootstrap) ──► content module
popup ── EXTRACT_PAGE / PICK_ELEMENT ─────────► content module
content ── EXTRACTION_PROGRESS/COMPLETE ──────► service worker
service worker ── storage.local[lastSnapshot] + open builder tab
builder ── ?import=last → consume snapshot → create project (IndexedDB)
```

`unlimitedStorage` covers large snapshots; the hand-off key is cleared on
consumption so stale snapshots are never re-imported.

## AI extensibility

`src/ai/AiAssistService.js` defines the provider contract
(`suggestMapping`, `suggestFix`, `correctStructure`, `optimizeDesign`,
`convertUnsupported`). Hooks already consume it:

- Widget Mapping: consults `suggestMapping` for widgets below the confidence
  threshold and records the decision with `source: "ai"` + previous decision
  as an alternative.
- Validation: `suggestAiFixes` for issues without a static fix.
- Builder: AI affordances render only when `isEnabled()`.

Registering a provider is one call; no engine changes are required.

## Limits & safeguards

- `LIMITS` in `common/constants.js`: 6000 nodes, depth 24, 1500 assets,
  20 KB text per node, 200 KB inline SVG.
- Rich HTML is sanitized to a semantic-inline allowlist before storage.
- Preview iframe is sandboxed (`allow-scripts`, no same-origin).
- Captured `data-settings` parsing is try/caught; malformed JSON is ignored.
- The builder warns before unload with unsaved changes; mutations are
  undoable (50-step history).
