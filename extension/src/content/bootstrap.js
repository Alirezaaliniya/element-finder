/**
 * Content-script bootstrap (classic script, injected on demand via
 * chrome.scripting). MV3 content scripts can't be ES modules directly, so
 * this loader dynamic-imports the module entry point exactly once.
 */
(() => {
  if (window.__EF_BOOTSTRAPPED__) return;
  window.__EF_BOOTSTRAPPED__ = true;
  import(chrome.runtime.getURL('src/content/main.js')).catch((err) => {
    console.error('[ef] failed to load content module', err);
    window.__EF_BOOTSTRAPPED__ = false;
  });
})();
