import { placeholderTarget } from './utils/functions/local';
import {
  isOpenInTabRequest,
  openOrFocusTabView,
  TabApi,
} from './utils/functions/popOut';
import {
  createWindowWithRetries,
  isRestoreSessionRequest,
  planWindowClosure,
  RestoreSessionRequest,
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

// Every restore runs here -- see RestoreSessionRequest. Focus mode is this
// plus closeOtherWindows. Focus mode has to run here for the same reason the
// listener above does: the popup is destroyed the moment the first restored
// window takes focus, and every step after that point still has to happen.
// The popup has already saved the windows this is about to close before it
// sends this message.
async function restoreSession(request: RestoreSessionRequest) {
  // Only focus mode closes anything, so only focus mode needs the snapshot.
  const snapshotIds = request.closeOtherWindows
    ? (await chrome.windows.getAll({ windowTypes: ['normal'] }))
        .map((openWindow) => openWindow.id)
        .filter((id): id is number => id !== undefined)
    : [];

  const created = await Promise.all(
    request.specs.map((spec) =>
      createWindowWithRetries(spec, request.goToURLText, 2)
    )
  );

  if (!request.closeOtherWindows) return;

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

// The real TabApi (see popOut.ts), pointed at chrome.tabs/chrome.windows.
// windows.update's `{ focused: true }` is what chrome.tabs.update itself has
// no equivalent for -- activating a tab does not raise its window.
const chromeTabApi: TabApi = {
  getURL: (path) => chrome.runtime.getURL(path),
  query: (q) => chrome.tabs.query(q),
  update: (tabId, props) => chrome.tabs.update(tabId, props),
  focusWindow: (windowId) => chrome.windows.update(windowId, { focused: true }),
  create: (props) => chrome.tabs.create(props),
};

chrome.runtime.onMessage.addListener((message) => {
  if (isRestoreSessionRequest(message)) {
    // No response is sent: by the time this finishes there is no popup left
    // to receive one.
    void restoreSession(message);
    return;
  }

  if (isOpenInTabRequest(message)) {
    void openOrFocusTabView(chromeTabApi, message);
  }
});
