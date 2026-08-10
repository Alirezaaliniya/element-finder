/** Popup controller — injects the content module and triggers extraction. */

import { MSG, STORAGE_KEYS } from '../../common/constants.js';
import { getLang, initI18n, setLang, t } from '../../common/i18n.js';

await initI18n(document);

const statusEl = document.getElementById('status');
const buttons = {
  extract: document.getElementById('extract-page'),
  pick: document.getElementById('pick-element'),
  builder: document.getElementById('open-builder'),
};

const langToggle = document.getElementById('lang-toggle');
langToggle.textContent = getLang() === 'fa' ? 'EN' : 'فا';
langToggle.addEventListener('click', async () => {
  await setLang(getLang() === 'fa' ? 'en' : 'fa');
  location.reload();
});

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
  throw new Error(t('popup.initFailed'));
}

async function runCommand(commandType, pendingLabel) {
  const tab = await activeTab();
  if (!tab?.id || /^(chrome|edge|about|chrome-extension):/.test(tab.url ?? '')) {
    setStatus(t('popup.cannotExtract'), 'error');
    return;
  }
  setBusy(true);
  setStatus(pendingLabel, 'working');
  try {
    await ensureContentScript(tab.id);
    const res = await chrome.tabs.sendMessage(tab.id, { type: commandType });
    if (res?.cancelled) { setStatus(t('popup.cancelled'), 'idle'); return; }
    if (!res?.ok) throw new Error(res?.error || t('popup.extractFailed'));
    setStatus(t('popup.extracted', { count: res.stats.nodesExtracted }), 'ok');
    window.close();
  } catch (err) {
    setStatus(String(err?.message || err), 'error');
  } finally {
    setBusy(false);
  }
}

buttons.extract.addEventListener('click', () => runCommand(MSG.EXTRACT_PAGE, t('popup.analyzing')));
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
  if (s.state === 'complete') setStatus(t('popup.lastRun', { count: s.nodes, host: shortUrl(s.url) }), 'ok');
  if (s.state === 'failed') setStatus(t('popup.lastRunFailed', { error: s.error }), 'error');
});

function shortUrl(url) {
  try { return new URL(url).host; } catch { return url; }
}
