import { placeholderTarget } from './utils/functions/local';
import {
  DEFAULT_VIEW_KEY,
  openFullViewFromToolbar,
  reapplyDefaultView,
  type ActionApi,
  type DefaultViewStore,
} from './utils/functions/defaultView';
import {
  chromeBackApi,
  isReturnFromFullViewRequest,
  returnFromFullView,
} from './utils/functions/backFromFullView';
import { recordFullViewOrigins } from './utils/functions/fullViewOrigin';
import {
  chromeTabApi,
  isOpenInTabRequest,
  openOrFocusTabView,
} from './utils/functions/popOut';
import {
  chromePopupApi,
  isOpenInPopupRequest,
  openInPopup,
} from './utils/functions/openInPopup';
import { keepPinnedTabKeeperWindows } from './utils/functions/pinnedTabKeeperWindows';
import { recordRecentTabs } from './utils/functions/recentTabs';
import { reopenPreferringHistory } from './utils/functions/reopen';
import type { Reopened } from './utils/functions/reopen';
import { isReopenPreferringHistoryRequest } from './utils/functions/reopenRequest';
import { restoreSession } from './utils/functions/restoreSession';
import { readUiLanguage } from './utils/functions/uiLanguage';
import {
  UNINSTALL_SURVEY_FORM_KEY,
  UNINSTALL_SURVEY_LANGUAGE_KEY,
  uninstallSurveyInOrder,
} from './utils/functions/uninstallSurvey';
import { isRestoreSessionRequest } from './utils/functions/windows';

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

    const target = placeholderTarget(tab.url, chrome.runtime.id);
    if (target) {
      // KAN-561. Chrome refuses some (chrome://crash, file: without file access): the placeholder stays.
      chrome.tabs.update(tabId, { url: target }).catch((error) => {
        console.warn('Could not load a restored tab:', error);
      });
    }
  });
});

// KAN-458 A4. A save made from a Tab Keeper page reads which tab the user was on before it.
recordRecentTabs();

// KAN-507. Open compact view goes back to the tab ⤢ was pressed on.
recordFullViewOrigins();

// KAN-470 A. An update closes every Tab Keeper tab: the windows that pinned one get a stub back.
keepPinnedTabKeeperWindows();

// KAN-7 §7. Default view, applied again at every start: Task 1 measured whether Chrome keeps setPopup itself.
const chromeActionApi: ActionApi = {
  setPopup: (details) => chrome.action.setPopup(details),
};
const defaultViewStore: DefaultViewStore = {
  read: () =>
    chrome.storage.local
      .get(DEFAULT_VIEW_KEY)
      .then((items) => items[DEFAULT_VIEW_KEY]),
};
// Never rejects (reapplyDefaultView logs its own failures), so a press chained on it always runs.
// Chained, so it settles only once every reapply has (load and onInstalled both run at install).
let defaultViewApplied: Promise<unknown> = Promise.resolve();
const reapplyDefaultViewNow = () => {
  defaultViewApplied = defaultViewApplied.then(() =>
    reapplyDefaultView(defaultViewStore, chromeActionApi)
  );
};
// Also at load: disabling then enabling resets the popup and fires neither event.
reapplyDefaultViewNow();
chrome.runtime.onStartup.addListener(reapplyDefaultViewNow);
chrome.runtime.onInstalled.addListener(reapplyDefaultViewNow);
// KAN-518. A spec that stages Default view waits on this, or a reapply that read before it lands after it.
Object.assign(globalThis, {
  tabKeeperDefaultViewApplied: () => defaultViewApplied,
});

// KAN-642. Chrome keeps the URL across restarts; it changes only on install/update or a language change.
const applyUninstallSurvey = uninstallSurveyInOrder(
  {
    setUninstallURL: (url) => chrome.runtime.setUninstallURL(url),
    version: () => chrome.runtime.getManifest().version,
    uiLanguage: readUiLanguage,
    // Called through, so a spec can stub the draw in the worker.
    random: () => Math.random(),
  },
  {
    readLanguage: () =>
      chrome.storage.local
        .get(UNINSTALL_SURVEY_LANGUAGE_KEY)
        .then((items) => items[UNINSTALL_SURVEY_LANGUAGE_KEY]),
    readForm: () =>
      chrome.storage.local
        .get(UNINSTALL_SURVEY_FORM_KEY)
        .then((items) => items[UNINSTALL_SURVEY_FORM_KEY]),
    writeForm: (form) =>
      chrome.storage.local.set({ [UNINSTALL_SURVEY_FORM_KEY]: form }),
  }
);
// The newest apply settles last (they queue), so this is the URL Chrome holds.
let uninstallSurveyApplied: Promise<string | undefined> =
  Promise.resolve(undefined);
const reapplyUninstallSurvey = () => {
  uninstallSurveyApplied = applyUninstallSurvey();
};
chrome.runtime.onInstalled.addListener(reapplyUninstallSurvey);
chrome.storage.local.onChanged.addListener((changes) => {
  if (UNINSTALL_SURVEY_LANGUAGE_KEY in changes) reapplyUninstallSurvey();
});
// A spec uninstalls only once the URL it expects is set; Chrome opens nothing before.
Object.assign(globalThis, {
  tabKeeperUninstallSurveyApplied: () => uninstallSurveyApplied,
});

// Fires only while the popup is '' (Default view = Full); the shortcut and the puzzle menu follow.
// One open at a time: a double click would otherwise query before either create.
let openingFullView: Promise<void> | undefined;
const onToolbarClick = (tab: chrome.tabs.Tab): Promise<void> =>
  (openingFullView ??= openFullViewFromToolbar(chromeTabApi, tab).finally(
    () => {
      openingFullView = undefined;
    }
  ));
chrome.action.onClicked.addListener((tab) => void onToolbarClick(tab));
// The e2e harness cannot click the toolbar; it calls this instead.
Object.assign(globalThis, { tabKeeperToolbarClick: onToolbarClick });

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Open now's Reopen with history (KAN-280 Part D). Here, not in the page:
  // the restore focuses a window, and the undo after it has to outlive the
  // popup. The answer carries the new ids for the tab view's row focus
  // (KAN-311); returning true keeps the channel open for it. A popup is gone
  // by then, and never reads it. It ALWAYS answers: a throw answers null, so
  // the page never mistakes silence for "nothing ran" and reopens a second
  // time.
  if (isReopenPreferringHistoryRequest(message)) {
    // sendResponse can throw: the popup that asked may already be gone by
    // the time the answer is ready. That is not a double reopen (the item
    // already came back or was recreated either way), so it only warns.
    const answer = (value: Reopened | null) => {
      try {
        sendResponse(value);
      } catch (error) {
        console.warn('Could not answer Reopen: ', error);
      }
    };
    void reopenPreferringHistory(message.item, message.pinTabKeeper).then(
      answer,
      (error) => {
        console.warn('Reopen failed: ', error);
        answer(null);
      }
    );
    return true;
  }

  if (isRestoreSessionRequest(message)) {
    // No response is sent: by the time this finishes there is no popup left
    // to receive one.
    void restoreSession(message);
    return;
  }

  if (isOpenInTabRequest(message)) {
    void openOrFocusTabView(chromeTabApi, message);
  }

  // KAN-437. The asking tab is the full view: the worker closes it, then opens the popup.
  // After the worker's startup reapply, which otherwise races it (measured: a set right after worker start was overwritten, 1 of 8 probe runs).
  // KAN-509. Under Default view Full, Back: the asking tab is the full view; no popup is involved.
  if (isReturnFromFullViewRequest(message)) {
    void returnFromFullView(chromeBackApi, sender.tab?.id);
  }

  if (isOpenInPopupRequest(message)) {
    void defaultViewApplied.then(() =>
      openInPopup(chromePopupApi, sender.tab?.id)
    );
  }
});
