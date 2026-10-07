import { setSafeHTML } from '../../common/safe-html.js';
/** Popup controller — injects the content module and triggers extraction. */

import { MSG, STORAGE_KEYS } from '../../common/constants.js';
import { getLang, initI18n, setLang, t } from '../../common/i18n.js';
import { hydrateIcons } from '../shared/icons.js';
import { aboutHtml } from '../shared/about.js';

await initI18n(document);
hydrateIcons(document);

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
    const startedAt = Date.now();
    const res = await chrome.tabs.sendMessage(tab.id, { type: commandType });
    if (!res?.ok) throw new Error(res?.error || t('popup.extractFailed'));
    // The run continues in the page; follow it through the stored status.
    // Closing the popup is safe — the builder opens when extraction ends.
    await followExtraction(startedAt);
  } catch (err) {
    setStatus(String(err?.message || err), 'error');
  } finally {
    setBusy(false);
  }
}

/** Resolve when the stored status reports the end of a run started after `since`. */
function followExtraction(since) {
  return new Promise((resolve, reject) => {
    const onChange = (changes, area) => {
      const s = area === 'local' ? changes[STORAGE_KEYS.LAST_STATUS]?.newValue : null;
      if (!s || s.at < since) return;
      if (s.state === 'extracting') {
        setStatus(t('popup.progress', { index: (s.index ?? 0) + 1, total: s.total ?? '?', phase: s.phase ?? '' }), 'working');
      } else if (s.state === 'complete') {
        chrome.storage.onChanged.removeListener(onChange);
        setStatus(t('popup.extracted', { count: s.nodes }), 'ok');
        resolve();
        setTimeout(() => window.close(), 600);
      } else if (s.state === 'failed') {
        chrome.storage.onChanged.removeListener(onChange);
        reject(new Error(s.error || t('popup.extractFailed')));
      }
    };
    chrome.storage.onChanged.addListener(onChange);
  });
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
const aboutPanel = document.getElementById('about-panel');
document.getElementById('about-toggle').addEventListener('click', () => {
  setSafeHTML(aboutPanel.querySelector('[data-about]'), aboutHtml());
  aboutPanel.showModal();
});
aboutPanel.querySelector('[data-close]').addEventListener('click', () => aboutPanel.close());

buttons.builder.addEventListener('click', () => {
  void chrome.runtime.sendMessage({ type: MSG.OPEN_BUILDER });
  window.close();
});

// Host access: Chrome grants <all_urls> at install; Firefox lets the user
// withhold or revoke it. Without it cross-origin stylesheets, fonts and the
// media library cannot be read, so offer to grant it.
const ALL_SITES = { origins: ['<all_urls>'] };
const hostAccess = document.getElementById('host-access');
chrome.permissions.contains(ALL_SITES).then((granted) => { hostAccess.hidden = granted; }).catch(() => {});
document.getElementById('grant-access').addEventListener('click', () => {
  // Must be called directly from the click (user gesture), before any await.
  chrome.permissions.request(ALL_SITES).then((granted) => { hostAccess.hidden = granted; }).catch(() => {});
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
