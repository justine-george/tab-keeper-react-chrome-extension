// KAN-880. The Save as PDF preview's "Back to Tab Keeper": the page only asks; the worker switches, closes the preview, then opens the popup.
// Worker-safe, like openInPopup.ts: no window, no redux, chrome types only.
import {
  canOpenPopup,
  chromePopupApi,
  goBack,
  openPopupOnce,
} from './openInPopup';
import type { PopupApi } from './openInPopup';
import {
  chromeTabApi,
  OPEN_IN_TAB_MESSAGE,
  openOrFocusTabView,
} from './popOut';
import { isTabKeeperTab } from './pinnedTabKeeper';
import type { PreviewFrom } from './previewFrom';

export const RETURN_FROM_PREVIEW_MESSAGE = 'returnFromPreview';

export interface ReturnFromPreviewRequest {
  type: typeof RETURN_FROM_PREVIEW_MESSAGE;
  from: PreviewFrom;
}

export function isReturnFromPreviewRequest(
  message: unknown
): message is ReturnFromPreviewRequest {
  return (
    typeof message === 'object' &&
    message !== null &&
    'type' in message &&
    message.type === RETURN_FROM_PREVIEW_MESSAGE &&
    'from' in message &&
    (message.from === 'full' || message.from === 'popup')
  );
}

// The page's half: true once the worker has the request (its tab is about to close); false, logged, when the send failed. Never rejects.
export async function requestReturnFromPreview(
  from: PreviewFrom
): Promise<boolean> {
  const request: ReturnFromPreviewRequest = {
    type: RETURN_FROM_PREVIEW_MESSAGE,
    from,
  };
  try {
    await chrome.runtime.sendMessage(request);
    return true;
  } catch (error) {
    console.warn('Could not ask to go back from the preview:', error);
    return false;
  }
}

export interface PreviewBackApi extends PopupApi {
  // Chrome's current opener of the tab, if it is still open: a closed opener's own opener is handed on.
  openerOf(tabId: number): Promise<number | undefined>;
  // A full view or the pinned stub; false for a tab that is gone.
  isTabKeeperTab(tabId: number): Promise<boolean>;
  canOpenPopup(): boolean;
  // Focuses a full view, or opens one in that window (undefined: where Chrome chooses).
  openFullView(windowId: number | undefined): Promise<void>;
}

export const chromePreviewBackApi: PreviewBackApi = {
  ...chromePopupApi,
  openerOf: async (tabId) => {
    const { openerTabId } = await chrome.tabs.get(tabId);
    if (openerTabId === undefined) return undefined;
    return chrome.tabs.get(openerTabId).then(
      () => openerTabId,
      () => undefined
    );
  },
  isTabKeeperTab: (tabId) =>
    chrome.tabs.get(tabId).then(isTabKeeperTab, () => false),
  canOpenPopup,
  openFullView: (windowId) =>
    openOrFocusTabView(chromeTabApi, { type: OPEN_IN_TAB_MESSAGE, windowId }),
};

// Never rejects: the page waits for no answer, so every failure is logged.
export async function returnFromPreview(
  api: PreviewBackApi,
  previewTabId: number | undefined,
  from: PreviewFrom
): Promise<void> {
  if (previewTabId === undefined) return;
  try {
    const preview = await api.getTab(previewTabId);
    const others = (await api.normalTabIds()).filter(
      (id) => id !== previewTabId
    );
    const lastTab = others.length === 0;
    const opener = lastTab ? undefined : await api.openerOf(previewTabId);
    // KAN-880. From the full view, an opener that is not Tab Keeper was handed on by Chrome: counts as gone.
    const backTo =
      from === 'full' &&
      opener !== undefined &&
      !(await api.isTabKeeperTab(opener))
        ? undefined
        : opener;
    // The window the user is back in; undefined when there is no opener or the switch failed.
    const backInWindow = await goBack(api, backTo);

    if (from === 'full') {
      // No tab to land on: a full view opens first, so the window keeps a tab.
      if (backInWindow === undefined) await api.openFullView(preview.windowId);
      await api.removeTab(previewTabId);
      return;
    }

    // KAN-437. The popup opens after the preview closes: one opened first dies with its tab.
    if (!lastTab) await api.removeTab(previewTabId);
    if (!api.canOpenPopup()) return;
    const windowLeft = lastTab || (await api.windowExists(preview.windowId));
    const popupWindow =
      backInWindow ?? (windowLeft ? preview.windowId : undefined);
    try {
      await openPopupOnce(api, popupWindow);
    } catch (error) {
      console.warn('No popup opened; opening the full view:', error);
      await api.openFullView(popupWindow);
    }
  } catch (error) {
    console.warn('Could not go back from the preview:', error);
  }
}
