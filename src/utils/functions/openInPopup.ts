// KAN-437. The full view's "Open in popup": the page only asks; the worker closes the full view, then opens the popup.
// Measured headed (KAN-437, 2026-10-06): a popup opened before its tab closes dies with that tab.
// Worker-safe, like popOut.ts: no window, no redux, chrome types only.
import { popupFor } from './defaultView';
import { TAB_VIEW_PATH } from './pinnedTabKeeper';

export const OPEN_IN_POPUP_MESSAGE = 'openInPopup';

export interface OpenInPopupRequest {
  type: typeof OPEN_IN_POPUP_MESSAGE;
}

export function isOpenInPopupRequest(
  message: unknown
): message is OpenInPopupRequest {
  return (
    typeof message === 'object' &&
    message !== null &&
    'type' in message &&
    message.type === OPEN_IN_POPUP_MESSAGE
  );
}

// The page's half: its tab is about to close, so it waits for nothing.
export function requestPopup(): void {
  const request: OpenInPopupRequest = { type: OPEN_IN_POPUP_MESSAGE };
  chrome.runtime.sendMessage(request).catch((error: unknown) => {
    console.warn('Could not ask for the popup:', error);
  });
}

// What openInPopup reads of the full view's tab.
export interface FullViewTab {
  index: number;
  pinned: boolean;
  windowId: number;
}

// The chrome.* calls openInPopup needs, named for what each is for.
export interface PopupApi {
  getURL(path: string): string;
  // Rejects for a tab that is gone.
  getTab(tabId: number): Promise<FullViewTab>;
  // Every tab id in Chrome's normal windows.
  normalTabIds(): Promise<number[]>;
  removeTab(tabId: number): Promise<unknown>;
  windowExists(windowId: number): Promise<boolean>;
  // A full URL, or '' while Default view is Full (KAN-7 §7).
  getPopup(): Promise<string>;
  setPopup(popup: string): Promise<unknown>;
  // undefined: Chrome uses the last-focused window.
  openPopup(windowId: number | undefined): Promise<unknown>;
  createTab(props: {
    url: string;
    active: boolean;
    windowId?: number;
    index?: number;
  }): Promise<unknown>;
}

// The real PopupApi; it reads chrome.* at each call, so a test can replace one member.
export const chromePopupApi: PopupApi = {
  getURL: (path) => chrome.runtime.getURL(path),
  getTab: async (tabId) => {
    const { index, pinned, windowId } = await chrome.tabs.get(tabId);
    return { index, pinned, windowId };
  },
  normalTabIds: async () =>
    (await chrome.windows.getAll({ populate: true, windowTypes: ['normal'] }))
      .flatMap((win) => win.tabs ?? [])
      .flatMap((tab) => (tab.id === undefined ? [] : [tab.id])),
  removeTab: (tabId) => chrome.tabs.remove(tabId),
  windowExists: (windowId) =>
    chrome.windows.get(windowId).then(
      () => true,
      () => false
    ),
  getPopup: () => chrome.action.getPopup({}),
  setPopup: (popup) => chrome.action.setPopup({ popup }),
  openPopup: (windowId) =>
    windowId === undefined
      ? chrome.action.openPopup()
      : chrome.action.openPopup({ windowId }),
  createTab: (props) => chrome.tabs.create(props),
};

// Under Default view Full there is no popup to open, so set one for this open and put '' back after.
async function openPopupOnce(
  api: PopupApi,
  windowId: number | undefined
): Promise<void> {
  const isFullDefault = (await api.getPopup()) === '';
  if (isFullDefault) await api.setPopup(popupFor('compact'));
  try {
    await api.openPopup(windowId);
  } finally {
    if (isFullDefault) {
      await api.setPopup(popupFor('full')).catch((error: unknown) => {
        console.warn('Could not restore the default view:', error);
      });
    }
  }
}

// Never rejects: the page waits for no answer, so every failure is logged, as openOrFocusTabView's are.
export async function openInPopup(
  api: PopupApi,
  fromTabId: number | undefined
): Promise<void> {
  try {
    if (fromTabId === undefined) {
      await openPopupOnce(api, undefined);
      return;
    }
    const tab = await api.getTab(fromTabId);
    const otherTabs = (await api.normalTabIds()).filter(
      (id) => id !== fromTabId
    );
    // A pinned full view, or the last tab Chrome has, stays; the popup opens over it.
    if (tab.pinned || otherTabs.length === 0) {
      await openPopupOnce(api, tab.windowId);
      return;
    }
    await api.removeTab(fromTabId);
    // A tab alone in its window took the window with it; naming that window rejects.
    const windowLeft = await api.windowExists(tab.windowId);
    try {
      await openPopupOnce(api, windowLeft ? tab.windowId : undefined);
    } catch (error) {
      console.warn('No popup opened; reopening the full view:', error);
      await api.createTab({
        url: api.getURL(TAB_VIEW_PATH),
        active: true,
        ...(windowLeft ? { windowId: tab.windowId, index: tab.index } : {}),
      });
    }
  } catch (error) {
    console.warn('Could not open the popup:', error);
  }
}
