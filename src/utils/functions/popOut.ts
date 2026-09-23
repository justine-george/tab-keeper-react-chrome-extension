// KAN-279 (Part D). The popup's "Open in a tab" button sends
// OpenInTabRequest; the worker is what actually finds or creates the tab
// view, for the same reason restoreSession in background.ts has to: the
// popup would be destroyed the moment a different tab took focus, before it
// could see the result.
//
// Worker-safe on purpose, like windows.ts: no import from redux/ or
// utils/constants/common.ts (window.screen at module load), and no call
// into viewMode.ts's isTabView()/ownTabId() -- both assume they are running
// in a tab, which the worker never is. Only @types/chrome's ambient `chrome`
// types are used, and only as types -- TabApi below is what background.ts
// implements against the real chrome.* APIs, and what tests implement
// against a fake.

export const OPEN_IN_TAB_MESSAGE = 'openInTab';

export interface OpenInTabRequest {
  type: typeof OPEN_IN_TAB_MESSAGE;
  // The window the popup was sent from. Used only when no tab view exists
  // yet, to open the new one there. `undefined` is a normal value here (the
  // popup's own chrome.windows.getCurrent() can itself answer undefined),
  // not a missing field -- create() below treats it as "let Chrome use the
  // last-focused window" rather than defaulting it to anything.
  windowId: number | undefined;
}

export function isOpenInTabRequest(
  message: unknown
): message is OpenInTabRequest {
  if (typeof message !== 'object' || message === null) return false;
  if (!('type' in message) || message.type !== OPEN_IN_TAB_MESSAGE) {
    return false;
  }
  if (!('windowId' in message)) return true;
  return typeof message.windowId === 'number' || message.windowId === undefined;
}

// The chrome.* surface openOrFocusTabView needs, narrowed to the promise
// forms and named to say what each call is for -- not a 1:1 wrapper of
// chrome.tabs/chrome.windows. background.ts supplies the real
// implementation; tests supply a fake that records calls instead.
export interface TabApi {
  getURL(path: string): string;
  query(q: { url: string }): Promise<chrome.tabs.Tab[]>;
  update(tabId: number, p: { active: boolean }): Promise<unknown>;
  focusWindow(windowId: number): Promise<unknown>;
  create(p: {
    url: string;
    index: number;
    windowId?: number;
    active: boolean;
  }): Promise<unknown>;
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
    const url = api.getURL('index.html?view=tab');
    const matches = await api.query({ url: `${url}*` });

    // chrome.tabs.Tab's `id` is optional (Chrome can omit it for a tab this
    // extension cannot see the id of); `windowId` is not. A match with no id
    // is nothing update()/focusWindow() can act on, so it is treated as no
    // match at all rather than as a reason to throw.
    const existing = matches.find(
      (tab): tab is chrome.tabs.Tab & { id: number } => tab.id !== undefined
    );

    if (existing) {
      await api.update(existing.id, { active: true });
      await api.focusWindow(existing.windowId);
      return;
    }

    await api.create({
      url,
      index: 0,
      ...(request.windowId === undefined ? {} : { windowId: request.windowId }),
      active: true,
    });
  } catch (error) {
    console.warn('Could not open or focus the tab view:', error);
  }
}
