/**
 * Service worker — thin message router and snapshot hand-off.
 *
 * Responsibilities (deliberately minimal; the heavy lifting lives in the
 * content engines and the builder page):
 *   - inject the content bootstrap on demand (popup commands)
 *   - receive completed snapshots, park them in chrome.storage.local
 *     (unlimitedStorage) and open the builder tab
 *   - surface progress/status to the popup
 */

import { MSG, STORAGE_KEYS } from '../common/constants.js';

const BUILDER_URL = chrome.runtime.getURL('src/ui/builder/builder.html');

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg?.type) {
    case MSG.EXTRACTION_PROGRESS:
      void setStatus({ state: 'extracting', phase: msg.phase, index: msg.index, total: msg.total });
      return false;

    case MSG.EXTRACTION_COMPLETE:
      handleExtractionComplete(msg.snapshot).then(() => sendResponse({ ok: true }));
      return true;

    case MSG.EXTRACTION_FAILED:
      void setStatus({ state: 'failed', error: msg.error });
      return false;

    case MSG.FETCH_TEXT:
      // Content scripts are bound by the page's CORS policy; stylesheet text
      // (needed to reverse Elementor's generated CSS) is fetched here, where
      // the extension's host permissions apply. Only http(s) and only from a
      // content script of this extension.
      if (!sender.tab || !/^https?:\/\//i.test(msg.url ?? '')) { sendResponse({ ok: false }); return false; }
      fetchText(msg.url).then(sendResponse);
      return true;

    case MSG.OPEN_BUILDER:
      void openBuilder(msg.query ?? '');
      sendResponse({ ok: true });
      return false;

    default:
      return false;
  }
});

async function handleExtractionComplete(snapshot) {
  try {
    await chrome.storage.local.set({ [STORAGE_KEYS.LAST_SNAPSHOT]: snapshot });
    await setStatus({
      state: 'complete',
      nodes: snapshot?.stats?.nodesExtracted ?? 0,
      assets: snapshot?.stats?.assetsCollected ?? 0,
      url: snapshot?.meta?.url ?? '',
    });
    await openBuilder('?import=last');
  } catch (err) {
    console.error('[ef:bg] failed to store snapshot', err);
    await setStatus({ state: 'failed', error: String(err?.message || err) });
  }
}

async function fetchText(url) {
  try {
    const res = await fetch(url, { credentials: 'omit' });
    if (!res.ok) return { ok: false, status: res.status };
    return { ok: true, text: await res.text() };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
}

async function openBuilder(query = '') {
  const url = BUILDER_URL + query;
  // Reuse an existing builder tab when possible.
  // Filter instead of a `url` match pattern: Firefox rejects extension URLs
  // (moz-extension://) as tabs.query patterns.
  const tabs = (await chrome.tabs.query({})).filter((tab) => (tab.url ?? '').startsWith(BUILDER_URL));
  if (tabs.length) {
    await chrome.tabs.update(tabs[0].id, { active: true, url });
    await chrome.windows.update(tabs[0].windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url });
  }
}

async function setStatus(status) {
  await chrome.storage.local.set({
    [STORAGE_KEYS.LAST_STATUS]: { ...status, at: Date.now() },
  });
}
