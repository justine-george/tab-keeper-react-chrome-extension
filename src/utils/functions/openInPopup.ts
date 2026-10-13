// KAN-437. The full view's "Open compact view": the page only asks; the worker closes the full view, then opens the popup.
// Measured headed (KAN-437, 2026-10-06): a popup opened before its tab closes dies with that tab.
// Worker-safe, like popOut.ts: no window, no redux, chrome types only.
import { popupFor } from './defaultView';
import {
  chromeFullViewOrigins,
  tabToReturnTo,
  type FullViewTabRef,
} from './fullViewOrigin';
import { readRecentTabs } from './recentTabs';
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

// action.openPopup is Chrome 127+ for every extension; on older Chrome the full view has no way back to offer.
export function canOpenPopup(): boolean {
  const action: Partial<typeof chrome.action> | undefined =
    typeof chrome === 'undefined' ? undefined : chrome.action;
  return typeof action?.openPopup === 'function';
}

// The page's half: its tab is about to close, so it waits for nothing.
export function requestPopup(): void {
  const request: OpenInPopupRequest = { type: OPEN_IN_POPUP_MESSAGE };
  chrome.runtime.sendMessage(request).catch((error: unknown) => {
    console.warn('Could not ask for the popup:', error);
  });
}

// KAN-578. The page's read of whether its press would close it; rejects outside a tab.
export async function compactViewWouldClose(): Promise<boolean> {
  const self = await chrome.tabs.getCurrent();
  if (self?.id === undefined) throw new Error('Not in a tab.');
  const others = (await chromePopupApi.normalTabIds()).filter(
    (id) => id !== self.id
  );
  return compactViewCloses(self.pinned, others.length);
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
  // KAN-507. The tab ⤢ was pressed on, if a record names this full view.
  originOf(fullView: FullViewTabRef): Promise<number | undefined>;
  // A window's recently used tabs, newest first.
  recentTabsIn(windowId: number): Promise<readonly number[]>;
  // Makes the tab active and focuses its window; resolves to that window.
  activate(tabId: number): Promise<number>;
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
  originOf: (fullView) => chromeFullViewOrigins.originOf(fullView),
  recentTabsIn: async (windowId) =>
    (await readRecentTabs([windowId]))(windowId),
  activate: async (tabId) => {
    const tab = await chrome.tabs.update(tabId, { active: true });
    if (!tab) throw new Error(`No tab with id: ${tabId}.`);
    await chrome.windows.update(tab.windowId, { focused: true });
    return tab.windowId;
  },
};

// KAN-507. The tab ⤢ was pressed on, else the last one used beside the full view; undefined when neither is open.
async function tabToGoBackTo(
  api: PopupApi,
  fullView: FullViewTabRef,
  openTabIds: readonly number[]
): Promise<number | undefined> {
  try {
    return tabToReturnTo(
      await api.originOf(fullView),
      await api.recentTabsIn(fullView.windowId),
      openTabIds
    );
  } catch (error) {
    console.warn('Could not read where to go back to:', error);
    return undefined;
  }
}

// Resolves to the window the user is back in, or undefined when the switch failed.
async function goBack(
  api: PopupApi,
  tabId: number | undefined
): Promise<number | undefined> {
  if (tabId === undefined) return undefined;
  try {
    return await api.activate(tabId);
  } catch (error) {
    console.warn('Could not go back to the tab:', error);
    return undefined;
  }
}

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

// KAN-578: an unpinned full view closes, unless it is the last tab Chrome has.
export function compactViewCloses(
  pinned: boolean,
  otherTabCount: number
): boolean {
  return !pinned && otherTabCount > 0;
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
    // The last tab Chrome has stays; the popup opens over it.
    if (otherTabs.length === 0) {
      await openPopupOnce(api, tab.windowId);
      return;
    }
    // Switched to first: the popup must open after the full view closes, on the tab it lands on.
    const backInWindow = await goBack(
      api,
      await tabToGoBackTo(
        api,
        { tabId: fromTabId, windowId: tab.windowId },
        otherTabs
      )
    );
    if (!compactViewCloses(tab.pinned, otherTabs.length)) {
      await openPopupOnce(api, backInWindow ?? tab.windowId);
      return;
    }
    await api.removeTab(fromTabId);
    // A tab alone in its window took the window with it; naming that window rejects.
    const windowLeft = await api.windowExists(tab.windowId);
    try {
      await openPopupOnce(
        api,
        backInWindow ?? (windowLeft ? tab.windowId : undefined)
      );
    } catch (error) {
      console.warn('No popup opened; reopening the full view:', error);
      const url = api.getURL(TAB_VIEW_PATH);
      const reopenWhereChromeChooses = () =>
        api.createTab({ url, active: true });
      // Its window can close meanwhile; then Chrome chooses where, once.
      await (windowLeft
        ? api
            .createTab({
              url,
              active: true,
              windowId: tab.windowId,
              index: tab.index,
            })
            .catch(reopenWhereChromeChooses)
        : reopenWhereChromeChooses());
    }
  } catch (error) {
    console.warn('Could not open the popup:', error);
  }
}
