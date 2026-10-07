# Publishing on Firefox Add-ons (AMO)

## Build

```
node tools/build-release.mjs firefox
```

This writes two outputs:

- `releases/element-finder-studio-v<version>-firefox.zip`: upload this file to AMO.
- `dist/firefox/`: the same files unpacked, for local testing.

The Firefox manifest is generated from `extension/manifest.json`, which is the Chrome manifest:

| Change | Why |
|---|---|
| `background.scripts` instead of `background.service_worker` | Firefox MV3 has no service workers. The same module runs as an event page. |
| `browser_specific_settings.gecko.id` = `element-finder@nias.ir` | Required by AMO. **Never change it after the first upload.** |
| `gecko.strict_min_version` = `140.0`, `gecko_android.strict_min_version` = `142.0` | Required by the `data_collection_permissions` key. |
| `gecko.data_collection_permissions.required` = `["none"]` | The extension transmits no data. |
| `minimum_chrome_version` removed | Chrome-only key. |

## Check and test locally

```
npx web-ext lint --source-dir dist/firefox
npx web-ext run  --source-dir dist/firefox        # opens Firefox with the add-on
node tools/e2e/firefox-run.mjs <url>              # automated: extract a page in real Firefox
```

You can also install it by hand: open `about:debugging` → This Firefox → Load Temporary Add-on → `dist/firefox/manifest.json`.

Expected lint result: 0 errors. There are 20 `UNSAFE_VAR_ASSIGNMENT` notices about `innerHTML`; they are explained in the reviewer notes below.

## Host access in Firefox

Firefox lets users withhold or revoke MV3 host permissions. Without "access to all websites", the extension can still extract the current tab after the popup is clicked (`activeTab`). What it can no longer do is read:

- cross-origin stylesheets and fonts;
- the source site's media library (used to recover uploaded SVG icons).

When the permission is missing, the popup shows an **Allow access** banner, which calls `permissions.request`.

## Submission checklist

1. Create or sign in to a developer account at <https://addons.mozilla.org/developers/>.
2. Submit a New Add-on → **On this site** (listed) → upload the Firefox zip.
3. Platforms: select **Firefox (desktop)** only. The UI is built for desktop, so leave Android unticked.
4. Source code: answer **No**. Nothing is minified, transpiled or bundled; the files are the source.
5. Fill in the listing details:
   - Name: Element Finder Studio
   - Category: Web Development
   - Support site: https://nias.ir/
   - Homepage: the GitHub repository
   - License: the repository's license
6. Add screenshots of the popup and the builder.
7. Paste the reviewer notes below.
8. Bundled third-party assets:
   - Vazirmatn font (SIL OFL 1.1);
   - Iconsax icons. Confirm their license allows redistribution before submitting.

## Notes for reviewers (paste into "Notes to Reviewer")

> Element Finder Studio converts the page in the active tab into an Elementor (WordPress page builder) template, which the user edits in a local builder page and downloads.
>
> - **No data collection or remote servers.** The extension sends nothing anywhere. All processing happens locally. Projects are stored in IndexedDB / storage.local; exports are downloaded files.
> - **`<all_urls>` host permission:** used only on pages the user explicitly extracts. It lets the extension read that page's stylesheets, fonts and images, which are often hosted on other domains (CDNs), and the site's public WordPress media endpoint (`/wp-json/wp/v2/media`) to recover the original files of inlined SVG icons. Requests go only to the extracted site and its asset hosts.
> - **`scripting` + `activeTab`:** the content script is injected on demand when the user clicks "Extract" or "Pick an element". There are no persistent content scripts.
> - **`downloads`, `unlimitedStorage`:** for export files and for saved projects (large page snapshots).
> - **`innerHTML` assignments:** UI markup is built from fixed templates with `escapeHtml()` applied to every dynamic value, plus a bundled static SVG icon set. Page-derived HTML is used in only two places:
>   - *content extraction*: page HTML is parsed in an inert `<template>` and reduced to an allow-list of tags;
>   - *preview*: the reconstruction is shown in the builder's preview frame after `sanitizeMarkup()` (`src/ui/builder/components/PreviewPane.js`) removes script-like elements, `on*` attributes and `javascript:` URLs. The extension CSP blocks inline scripts as an additional layer.
> - The code is not minified or generated. `src/engines/elementor/data/controls-map.json` is a data file: Elementor's control definitions, exported by `tools/elementor-dump/dump-controls.php` in the GitHub repository.
