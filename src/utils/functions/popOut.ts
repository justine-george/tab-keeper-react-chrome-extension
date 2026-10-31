// KAN-279 (Part D). The popup's "Open full view" button sends
// OpenInTabRequest; the worker is what actually finds or creates the tab
// view, for the same reason restoreSession in background.ts has to: the
// popup would be destroyed the moment a different tab took focus, before it
// could see the result.
//
// Worker-safe on purpose, like windows.ts: no import from redux/ or
// utils/constants/common.ts (window.screen at module load), and no call
// into viewMode.ts's isTabView() -- it assumes it is running in a tab,
// which the worker never is. chrome.* is read only inside calls, never at
// load: chromeTabApi below implements TabApi against the real APIs for
// background.ts, and tests implement it against a fake.

import { chromeFullViewOrigins, type FullViewTabRef } from './fullViewOrigin';
import { STUB_PATH, TAB_VIEW_PATH, tabKeeperPageOf } from './pinnedTabKeeper';

export const OPEN_IN_TAB_MESSAGE = 'openInTab';

// What the full view is asked to show as it opens or is focused: a dialog, (KAN-579) a backup file step, or (KAN-624) the run.
export type FullViewShow =
  'setup' | 'pinGuide' | 'saveBackup' | 'loadBackup' | 'run';

const FULL_VIEW_SHOWS: readonly unknown[] = [
  'setup',
  'pinGuide',
  'saveBackup',
  'loadBackup',
  'run',
] satisfies FullViewShow[];

export const isFullViewShow = (value: unknown): value is FullViewShow =>
  FULL_VIEW_SHOWS.includes(value);

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
  }): Promise<{ id?: number; windowId: number }>;
  // Tells the extension's pages; only the full view it names acts.
  announce(message: ShowInFullViewMessage): Promise<unknown>;
  // undefined window: the last-focused one. undefined result: it has no active tab.
  activeTabId(windowId: number | undefined): Promise<number | undefined>;
  // KAN-507. The tab the full view was opened from, for Open compact view to go back to.
  rememberOrigin(
    fullView: FullViewTabRef,
    originTabId: number
  ): Promise<unknown>;
}

// The real TabApi, pointed at chrome.tabs/chrome.windows; it reads chrome.* at each call.
// windows.update's `{ focused: true }` is what chrome.tabs.update itself has
// no equivalent for -- activating a tab does not raise its window.
export const chromeTabApi: TabApi = {
  getURL: (path) => chrome.runtime.getURL(path),
  query: (q) => chrome.tabs.query(q),
  update: (tabId, props) => chrome.tabs.update(tabId, props),
  focusWindow: (windowId) => chrome.windows.update(windowId, { focused: true }),
  create: (props) => chrome.tabs.create(props),
  announce: (message) => chrome.runtime.sendMessage(message),
  activeTabId: async (windowId) =>
    (
      await chrome.tabs.query(
        windowId === undefined
          ? { active: true, lastFocusedWindow: true }
          : { active: true, windowId }
      )
    )[0]?.id,
  rememberOrigin: (fullView, originTabId) =>
    chromeFullViewOrigins.remember(fullView, originTabId),
};

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
    // KAN-507. Read before anything below moves the asking window's focus.
    const origin = await api
      .activeTabId(request.windowId)
      .catch(() => undefined);
    const remember = async (fullView: FullViewTabRef) => {
      if (origin === undefined || origin === fullView.tabId) return;
      await api.rememberOrigin(fullView, origin).catch((error: unknown) => {
        console.warn(
          'Could not remember where the full view was opened from:',
          error
        );
      });
    };
    const url = api.getURL(TAB_VIEW_PATH);
    const stubUrl = api.getURL(STUB_PATH);
    // KAN-624. Only a focused full view is told about the run; any page that opens resumes it itself.
    const addressShow = request.show === 'run' ? undefined : request.show;
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
      const isStubTab = tabKeeperPageOf(existing, api.getURL) === 'stub';
      if (isStubTab && request.show !== undefined) {
        // A stub cannot hear the announcement; send it to the full view with the dialog.
        await api.update(existing.id, {
          active: true,
          url: addressShow === undefined ? url : `${url}&show=${addressShow}`,
        });
        await api.focusWindow(existing.windowId);
        await remember({ tabId: existing.id, windowId: existing.windowId });
        return;
      }
      await api.update(existing.id, { active: true });
      await api.focusWindow(existing.windowId);
      await remember({ tabId: existing.id, windowId: existing.windowId });
      if (request.show !== undefined) {
        await api.announce({
          type: SHOW_IN_FULL_VIEW_MESSAGE,
          tabId: existing.id,
          show: request.show,
        });
      }
      return;
    }

    const created = await api.create({
      url: addressShow === undefined ? url : `${url}&show=${addressShow}`,
      index: 0,
      ...(request.windowId === undefined ? {} : { windowId: request.windowId }),
      active: true,
    });
    if (created.id !== undefined) {
      await remember({ tabId: created.id, windowId: created.windowId });
    }
  } catch (error) {
    console.warn('Could not open or focus the tab view:', error);
  }
}
