import { placeholderTarget } from './utils/functions/local';

// Lazy load restores every tab past the first as a placeholder document, and
// something has to turn that placeholder into the real page when the user
// finally opens it. The popup cannot: restoring focuses the new window, Chrome
// destroys the popup, and any listener it registered dies with it well before
// the user clicks anything. A service worker outlives the popup, and Chrome
// revives it per event, so the swap also survives a browser restart.
chrome.tabs.onActivated.addListener(({ tabId }) => {
  chrome.tabs.get(tabId, (tab) => {
    // The tab can be gone by the time this runs. Reading a closed tab sets
    // lastError, and leaving it unread logs an unchecked-error warning.
    if (chrome.runtime.lastError || !tab?.url) return;

    const target = placeholderTarget(tab.url);
    if (target) {
      chrome.tabs.update(tabId, { url: target });
    }
  });
});
