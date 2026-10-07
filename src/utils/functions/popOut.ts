// KAN-279 (Part D). The popup's "Open full view" button sends
// OpenInTabRequest; the worker is what actually finds or creates the tab
// view, for the same reason restoreSession in background.ts has to: the
// popup would be destroyed the moment a different tab took focus, before it
// could see the result.
//
// Worker-safe on purpose, like windows.ts: no import from redux/ or
// utils/constants/common.ts (window.screen at module load), and no call
// into viewMode.ts's isTabView() -- it assumes it is running in a tab,
// which the worker never is. Only @types/chrome's ambient `chrome` types
// are used, and only as types -- TabApi below is what background.ts
// implements against the real chrome.* APIs, and what tests implement
// against a fake.

import { STUB_PATH, TAB_VIEW_PATH } from './pinnedTabKeeper';

export const OPEN_IN_TAB_MESSAGE = 'openInTab';

// A dialog the full view is asked to show as it opens or is focused.
export type FullViewShow = 'setup' | 'pinGuide';

export const isFullViewShow = (value: unknown): value is FullViewShow =>
  value === 'setup' || value === 'pinGuide';

export interface OpenInTabRequest {
  type: typeof OPEN_IN_TAB_MESSAGE;
  // The window the popup was sent from. Used only when no tab view exists
  // yet, to open the new one there. `undefined` is a normal value here (the
  // popup's own chrome.windows.getCurrent() can itself answer undefined),
  // not a missing field -- create() below treats it as "let Chrome use the
  // last-focused window" rather than defaulting it to anything.
  windowId: number | undefined;
  // The dialog to show there; absent for a plain open.
  show?: FullViewShow;
}

export function isOpenInTabRequest(
  message: unknown
): message is OpenInTabRequest {
  if (typeof message !== 'object' || message === null) return false;
  if (!('type' in message) || message.type !== OPEN_IN_TAB_MESSAGE) {
    return false;
  }
  if (
    'show' in message &&
    message.show !== undefined &&
    !isFullViewShow(message.show)
  ) {
    return false;
  }
  if (!('windowId' in message)) return true;
  return typeof message.windowId === 'number' || message.windowId === undefined;
}

// The worker's word to a full view it focused: show this dialog.
export const SHOW_IN_FULL_VIEW_MESSAGE = 'showInFullView';

export interface ShowInFullViewMessage {
  type: typeof SHOW_IN_FULL_VIEW_MESSAGE;
  // The tab the worker focused; every other full view ignores the message.
  tabId: number;
  show: FullViewShow;
}

export function isShowInFullViewMessage(
  message: unknown
): message is ShowInFullViewMessage {
  if (typeof message !== 'object' || message === null) return false;
  return (
    'type' in message &&
    message.type === SHOW_IN_FULL_VIEW_MESSAGE &&
    'tabId' in message &&
    typeof message.tabId === 'number' &&
    'show' in message &&
    isFullViewShow(message.show)
  );
}

// The page's half (KAN-279): ask the worker, which outlives this popup. A
// window it cannot name still sends, as undefined: "use the last-focused one".
export async function requestTabView(show?: FullViewShow): Promise<void> {
  let windowId: number | undefined;
  try {
    windowId = (await chrome.windows.getCurrent()).id;
  } catch {
    windowId = undefined;
  }
  const request: OpenInTabRequest = {
    type: OPEN_IN_TAB_MESSAGE,
    windowId,
    ...(show === undefined ? {} : { show }),
  };
  chrome.runtime.sendMessage(request);
}

// The chrome.* surface openOrFocusTabView needs, narrowed to the promise
// forms and named to say what each call is for -- not a 1:1 wrapper of
// chrome.tabs/chrome.windows. background.ts supplies the real
// implementation; tests supply a fake that records calls instead.
export interface TabApi {
  getURL(path: string): string;
  query(q: { url: string }): Promise<chrome.tabs.Tab[]>;
  update(tabId: number, p: { active: boolean; url?: string }): Promise<unknown>;
  focusWindow(windowId: number): Promise<unknown>;
  create(p: {
    url: string;
    index: number;
    windowId?: number;
    active: boolean;
  }): Promise<unknown>;
  // Tells the extension's pages; only the full view it names acts.
  announce(message: ShowInFullViewMessage): Promise<unknown>;
}

// Finds the extension's own tab-view tab and focuses it, or opens a new one.
//
// Never throws and never returns a rejected promise: like applyTabGroups in
// windows.ts, a query/update/create rejection here has no popup left to
// report to (there may never have been one waiting on a reply -- no response
// is sent either way), so it is logged and swallowed rather than left to
// become an unhandled rejection that could take out onMessage's other
// branch in background.ts.
export async function openOrFocusTabView(
  api: TabApi,
  request: OpenInTabRequest
): Promise<void> {
  try {
    const url = api.getURL(TAB_VIEW_PATH);
    const stubUrl = api.getURL(STUB_PATH);
    // Tab views before stubs, so a loaded one wins within a window.
    // chrome.tabs.Tab's `id` is optional; a match with no id is nothing
    // update()/focusWindow() can act on, so it counts as no match.
    const matches = [
      ...(await api.query({ url: `${url}*` })),
      ...(await api.query({ url: `${stubUrl}*` })),
    ].filter(
      (tab): tab is chrome.tabs.Tab & { id: number } => tab.id !== undefined
    );
    // With a Tab Keeper tab pinned in every window, the asking window's is the one to show.
    const existing =
      matches.find((tab) => tab.windowId === request.windowId) ?? matches[0];

    if (existing) {
      const isStubTab = (existing.url || existing.pendingUrl || '').startsWith(
        stubUrl
      );
      if (isStubTab && request.show !== undefined) {
        // A stub cannot hear the announcement; send it to the full view with the dialog.
        await api.update(existing.id, {
          active: true,
          url: `${url}&show=${request.show}`,
        });
        await api.focusWindow(existing.windowId);
        return;
      }
      await api.update(existing.id, { active: true });
      await api.focusWindow(existing.windowId);
      if (request.show !== undefined) {
        await api.announce({
          type: SHOW_IN_FULL_VIEW_MESSAGE,
          tabId: existing.id,
          show: request.show,
        });
      }
      return;
    }

    await api.create({
      url: request.show === undefined ? url : `${url}&show=${request.show}`,
      index: 0,
      ...(request.windowId === undefined ? {} : { windowId: request.windowId }),
      active: true,
    });
  } catch (error) {
    console.warn('Could not open or focus the tab view:', error);
  }
}
