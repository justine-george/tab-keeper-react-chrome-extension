import { placeholderTarget } from './utils/functions/local';
import {
  createWindowWithRetries,
  FocusSessionRequest,
  isFocusSessionRequest,
  planWindowClosure,
} from './utils/functions/windows';

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

// Focus mode runs here for the same reason the listener above does: the popup
// is destroyed the moment the first restored window takes focus, and every
// step after that point still has to happen. The popup has already saved the
// windows this is about to close before it sends this message.
async function focusSession(request: FocusSessionRequest) {
  const openWindows = await chrome.windows.getAll({ windowTypes: ['normal'] });
  const snapshotIds = openWindows
    .map((openWindow) => openWindow.id)
    .filter((id): id is number => id !== undefined);

  const created = await Promise.all(
    request.specs.map((spec) =>
      createWindowWithRetries(spec, request.goToURLText, request.isLazyLoad, 2)
    )
  );

  const toClose = planWindowClosure(snapshotIds, created);

  // Null means at least one window never opened. Leaving everything as it is
  // costs the user a tidy-up; the alternative costs them their browser state.
  if (!toClose) return;

  toClose.forEach((id) =>
    chrome.windows.remove(id, () => {
      // A window the user closed themselves while this was running sets
      // lastError. Reading it is what keeps it from being logged as unchecked.
      void chrome.runtime.lastError;
    })
  );
}

chrome.runtime.onMessage.addListener((message) => {
  if (!isFocusSessionRequest(message)) return;

  // No response is sent: by the time this finishes there is no popup left to
  // receive one.
  void focusSession(message);
});
