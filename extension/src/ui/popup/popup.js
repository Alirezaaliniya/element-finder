/** Popup controller — injects the content module and triggers extraction. */

import { MSG, STORAGE_KEYS } from '../../common/constants.js';

const statusEl = document.getElementById('status');
const buttons = {
  extract: document.getElementById('extract-page'),
  pick: document.getElementById('pick-element'),
  builder: document.getElementById('open-builder'),
};

function setStatus(text, kind = 'idle') {
  statusEl.textContent = text;
  statusEl.className = `status ${kind}`;
}

function setBusy(busy) {
  buttons.extract.disabled = busy;
  buttons.pick.disabled = busy;
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

/** Inject bootstrap (idempotent), then verify the module answers a ping. */
async function ensureContentScript(tabId) {
  await chrome.scripting.executeScript({ target: { tabId }, files: ['src/content/bootstrap.js'] });
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      const res = await chrome.tabs.sendMessage(tabId, { type: MSG.PING });
      if (res?.ok) return;
    } catch { /* module still loading */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Could not initialize on this page (restricted URL?)');
}

async function runCommand(commandType, pendingLabel) {
  const tab = await activeTab();
  if (!tab?.id || /^(chrome|edge|about|chrome-extension):/.test(tab.url ?? '')) {
    setStatus('This page cannot be extracted (browser-internal URL).', 'error');
    return;
  }
  setBusy(true);
  setStatus(pendingLabel, 'working');
  try {
    await ensureContentScript(tab.id);
    const res = await chrome.tabs.sendMessage(tab.id, { type: commandType });
    if (res?.cancelled) { setStatus('Selection cancelled.', 'idle'); return; }
    if (!res?.ok) throw new Error(res?.error || 'Extraction failed');
    setStatus(`Extracted ${res.stats.nodesExtracted} elements — opening builder…`, 'ok');
    window.close();
  } catch (err) {
    setStatus(String(err?.message || err), 'error');
  } finally {
    setBusy(false);
  }
}

buttons.extract.addEventListener('click', () => runCommand(MSG.EXTRACT_PAGE, 'Analyzing page…'));
buttons.pick.addEventListener('click', async () => {
  // Close the popup so the user can interact with the page; the content
  // script keeps running and the background opens the builder when done.
  const tab = await activeTab();
  if (!tab?.id) return;
  try {
    await ensureContentScript(tab.id);
    void chrome.tabs.sendMessage(tab.id, { type: MSG.PICK_ELEMENT });
    window.close();
  } catch (err) {
    setStatus(String(err?.message || err), 'error');
  }
});
buttons.builder.addEventListener('click', () => {
  void chrome.runtime.sendMessage({ type: MSG.OPEN_BUILDER });
  window.close();
});

// Restore last status on open.
chrome.storage.local.get(STORAGE_KEYS.LAST_STATUS).then((data) => {
  const s = data[STORAGE_KEYS.LAST_STATUS];
  if (!s || Date.now() - s.at > 5 * 60_000) return;
  if (s.state === 'complete') setStatus(`Last run: ${s.nodes} elements from ${shortUrl(s.url)}`, 'ok');
  if (s.state === 'failed') setStatus(`Last run failed: ${s.error}`, 'error');
});

function shortUrl(url) {
  try { return new URL(url).host; } catch { return url; }
}
