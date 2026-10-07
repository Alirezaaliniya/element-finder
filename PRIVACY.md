# Privacy Policy — Element Finder Studio

_Last updated: October 7, 2026_

Element Finder Studio ("the extension") is a browser extension by NIAS (https://nias.ir/) that converts a web page the user chooses into an Elementor template.

## Data we collect

**None.** The extension does not collect, transmit, sell or share any personal or user data. It has no analytics, no tracking, no accounts and no remote servers.

## How the extension handles page content

- The extension reads the content and styles of a web page **only when the user explicitly clicks "Extract full page" or "Pick an element"** in the extension popup.
- All processing happens **locally in the user's browser**.
- To rebuild the page, the extension may download that page's own public resources (stylesheets, fonts, images) from the site and its asset hosts (CDNs), and the site's public WordPress media endpoint (`/wp-json/wp/v2/media`). These requests go only to the site being extracted; no data is sent to the developer or any third party.

## Local storage

- Projects and page snapshots are stored locally in the browser (`chrome.storage.local` and IndexedDB). They never leave the device.
- The selected interface language is stored locally.
- Exports (JSON, HTML, ZIP) are saved to the user's computer through the browser's downloads feature.
- Users can delete their data at any time by deleting projects in the builder or removing the extension.

## Permissions

- `activeTab`, `scripting`: inject the extractor into the current tab only after a user action.
- `storage`, `unlimitedStorage`: save projects and settings locally.
- `downloads`: save exported files.
- Host access (`<all_urls>`): read the extracted page's cross-origin stylesheets, fonts and images.

## Changes

Any change to this policy will be published in this file in the project repository.

## Contact

- Website: https://nias.ir/
- Issues: https://github.com/Alirezaaliniya/element-finder/issues
- Telegram: https://t.me/niasir
