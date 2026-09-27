import { toOpenWindowBounds } from './openNow';
import type {
  OpenGroup,
  OpenTab,
  OpenWindow,
  OpenWindowBounds,
} from './openNow';
import { hasSessionsPermission } from './permissions';
import { sanitizeTabGroupColor } from './tabGroups';

// Close a live tab or window from the Open now pane, and put it back exactly
// with Reopen (KAN-280 O8). DOM-free -- no `window`, no `document`, and never
// src/utils/constants/common.ts, which reads window.screen at load: the
// service worker imports this file for Reopen with history (KAN-280 Part D).

// What a close leaves behind for Reopen (KAN-280 O8): the snapshot Open now
// held at the moment of closing. Never stored.
//
// `restorableSessionId` is the id of Chrome's own recently closed entry for
// this close, recorded the moment it closed -- Reopen can come after other
// closes, so it is never searched for later (KAN-280 Part D). null when the
// `sessions` permission is not held or no entry matched.
export type ClosedItem =
  | { kind: 'window'; window: OpenWindow; restorableSessionId: string | null }
  // `window` is the tab's whole window as it was, so a window that closed
  // with its last tab can be rebuilt in its old place.
  | {
      kind: 'tab';
      tab: OpenTab;
      group: OpenGroup | null;
      window: OpenWindow;
      restorableSessionId: string | null;
    };

// The snapshot with the window's bounds and state as Chrome reports them
// now (KAN-280 rule 5, KAN-308). A move, resize or maximize fires no event
// Open now re-reads on, so the snapshot can hold the window's old place. Read
// before the remove: a tab close can take its window with it. A failed read
// keeps the snapshot's place, and the close still goes ahead.
async function withCurrentPlacement(
  openWindow: OpenWindow
): Promise<OpenWindow> {
  try {
    const current = await chrome.windows.get(openWindow.id);
    return {
      ...openWindow,
      bounds: toOpenWindowBounds(current),
      state: current.state ?? 'normal',
    };
  } catch {
    return openWindow;
  }
}

// Whether the `sessions` permission is held right now. Held means both:
// chrome.sessions is there (it is undefined before the first grant) and the
// grant is (after a revoke the member stays, but every call on it throws at
// once, Task 1 Q4).
async function sessionsHeld(): Promise<boolean> {
  return chrome.sessions !== undefined && (await hasSessionsPermission());
}

// Chrome's recently closed list, newest first, or null when `sessions` is not
// held. A close reads it just before its remove and again straight after: the
// entry is already listed by then (Task 1, Q1).
async function recentlyClosed(): Promise<chrome.sessions.Session[] | null> {
  try {
    if (!(await sessionsHeld())) return null;
    return await chrome.sessions.getRecentlyClosed();
  } catch (error) {
    console.warn('Could not read the recently closed list: ', error);
    return null;
  }
}

// The ids of the entries Chrome lists now, read just before a close so the
// entry that close adds can be told apart from any already there. null when
// `sessions` is not held or the read failed.
async function listedEntryIds(): Promise<ReadonlySet<string> | null> {
  const entries = await recentlyClosed();
  if (entries === null) return null;
  return new Set(
    entries.flatMap((entry) => {
      const id = entry.tab?.sessionId ?? entry.window?.sessionId;
      return id === undefined ? [] : [id];
    })
  );
}

// The id of the ONE entry the close added that `idIfMatching` accepts, else
// null. When unsure, null: a missing id only costs the history (Reopen
// recreates), but a wrong one would restore the wrong tab or window.
//
// Never simply the newest entry: two closes issued together list the second
// first (Task 1, Q1). And never the first match either: ambiguity must be
// null, never a guess -- two same-address tabs closed together leave two
// new entries nothing in them tells apart.
async function addedEntryId(
  listedBefore: ReadonlySet<string> | null,
  idIfMatching: (entry: chrome.sessions.Session) => string | undefined
): Promise<string | null> {
  if (listedBefore === null) return null;
  const added = ((await recentlyClosed()) ?? []).flatMap((entry) => {
    const id = idIfMatching(entry);
    return id === undefined || listedBefore.has(id) ? [] : [id];
  });
  const [only, ...others] = added;
  return only !== undefined && others.length === 0 ? only : null;
}

// The kind follows the call, not the tab count -- a tabs.remove always leaves
// a tab entry -- so only a tab entry can be a tab's.
function tabEntryIdIfMatching(
  tab: OpenTab
): (entry: chrome.sessions.Session) => string | undefined {
  return (entry) =>
    entry.tab?.url === tab.url ? entry.tab.sessionId : undefined;
}

// Only a window entry, holding the snapshot's addresses in the same order.
function windowEntryIdIfMatching(
  openWindow: OpenWindow
): (entry: chrome.sessions.Session) => string | undefined {
  const urls = openWindow.tabs.map((tab) => tab.url);
  return (entry) => {
    const closedTabs = entry.window?.tabs;
    return closedTabs !== undefined &&
      closedTabs.length === urls.length &&
      closedTabs.every((closed, index) => closed.url === urls[index])
      ? entry.window?.sessionId
      : undefined;
  };
}

// Resolves to the ClosedItem when Chrome closed it, or null when it could not
// (the tab or window was already gone). Never rejects: the close stands even
// when its recently closed entry cannot be read.
export async function closeOpenTab(
  openWindow: OpenWindow,
  tab: OpenTab
): Promise<ClosedItem | null> {
  const placed = await withCurrentPlacement(openWindow);
  const listedBefore = await listedEntryIds();
  try {
    await chrome.tabs.remove(tab.id);
  } catch {
    return null;
  }
  return {
    kind: 'tab',
    tab,
    group: openWindow.groups.find((group) => group.id === tab.groupId) ?? null,
    window: placed,
    restorableSessionId: await addedEntryId(
      listedBefore,
      tabEntryIdIfMatching(tab)
    ),
  };
}

export async function closeOpenWindow(
  openWindow: OpenWindow
): Promise<ClosedItem | null> {
  const placed = await withCurrentPlacement(openWindow);
  const listedBefore = await listedEntryIds();
  try {
    await chrome.windows.remove(openWindow.id);
  } catch {
    return null;
  }
  return {
    kind: 'window',
    window: placed,
    restorableSessionId: await addedEntryId(
      listedBefore,
      windowEntryIdIfMatching(openWindow)
    ),
  };
}

// What Reopen brought back, by the new id Chrome gave it: focus goes to its
// row once Open now lists it (KAN-311, O8c). A tab whose window had gone is
// still a tab, in the window made around it.
export type Reopened =
  | { kind: 'tab'; tabId: number }
  | { kind: 'window'; windowId: number };

// Reopen, from the page (the toast's button and ⌘Z / Ctrl+Z, KAN-311). An
// item with Chrome's recently closed id goes to the service worker, which
// restores it with its history (reopenWithHistory): the popup cannot finish
// that, because the restore's focus change destroys it part-way (measured
// 6/6, KAN-280 Part D). In the popup the answer then never arrives, which is
// accepted (P1); the tab view gets it, for KAN-311's row focus. An item with
// no id is recreated here, as before.
//
// Only a message that never reached the worker is recreated here: then
// nothing ran. Any answer means the worker ran it, so the page never adds a
// second, local recreate after a restore -- and there is no timeout, for the
// same reason. Resolves to what came back, or null. Never rejects.
export async function reopenClosed(item: ClosedItem): Promise<Reopened | null> {
  if (item.restorableSessionId === null) return recreateClosed(item);
  const request: ReopenWithHistoryRequest = {
    type: REOPEN_WITH_HISTORY_MESSAGE,
    item,
  };
  let answer: unknown;
  try {
    answer = await chrome.runtime.sendMessage<
      ReopenWithHistoryRequest,
      unknown
    >(request);
  } catch (error) {
    console.warn(
      'Could not reach the service worker, so reopening here: ',
      error
    );
    return recreateClosed(item);
  }
  if (answer === null || isReopened(answer)) return answer;
  // The worker answers every request it accepts with a Reopened or null, so
  // this is a request it did not run -- or a worker from another build.
  // Nothing is recreated: that could double a restore.
  console.warn('The service worker answered Reopen with: ', answer);
  return null;
}

// Recreates a ClosedItem exactly (KAN-280 O8, rules 5, 6, 7 and 10), with a
// new history. Resolves to what came back, or null when nothing could. Never
// rejects.
export async function recreateClosed(
  item: ClosedItem
): Promise<Reopened | null> {
  try {
    if (item.kind === 'tab') return await recreateTab(item);
    const rebuilt = await recreateWindow(item.window);
    return rebuilt && { kind: 'window', windowId: rebuilt.windowId };
  } catch (error) {
    console.warn('Could not reopen: ', error);
    return null;
  }
}

// What the page asks the service worker for (KAN-280 Part D). The item
// arrives as a structured clone, checked by isReopenWithHistoryRequest.
export const REOPEN_WITH_HISTORY_MESSAGE = 'reopenWithHistory';

export interface ReopenWithHistoryRequest {
  type: typeof REOPEN_WITH_HISTORY_MESSAGE;
  item: ClosedItem;
}

// Runs in the service worker. Brings the item back through Chrome's recently
// closed list, so its Back and Forward pages come back too, and then undoes
// everything else the restore changed, so the end state is exactly what
// recreateClosed leaves (Justine, 2026-09-27: B). The one difference is the
// history.
//
// Recreates instead when `sessions` is not held, the id is null, or Chrome
// refuses the id (already restored, e.g. with Ctrl+Shift+T, or pushed out of
// its list of 25: `Invalid session id`), or the call throws at once (revoked
// mid-way, Task 1 Q4). Once the restore has run, nothing is ever recreated:
// a failed undo step only warns, because the item did come back. Resolves to
// what came back, or null. Never rejects.
export async function reopenWithHistory(
  item: ClosedItem
): Promise<Reopened | null> {
  try {
    const sessionId = item.restorableSessionId;
    if (sessionId === null || !(await sessionsHeld())) {
      return await recreateClosed(item);
    }
    // Read before the restore, which changes all of it.
    const focusedWindowId = await lastFocusedWindowId();
    if (item.kind === 'tab') {
      const place = await tabPlaceNow(item);
      const restored = await restoreEntry(sessionId);
      return restored
        ? await undoTabRestore(item, restored, focusedWindowId, place)
        : await recreateClosed(item);
    }
    const restored = await restoreEntry(sessionId);
    return restored
      ? await undoWindowRestore(item.window, restored, focusedWindowId)
      : await recreateClosed(item);
  } catch (error) {
    console.warn('Could not reopen: ', error);
    return null;
  }
}

// Chrome's restore of one recently closed entry, or null when it refused: a
// spent or unknown id rejects with `Invalid session id: "<id>".` and changes
// nothing (Task 1, Q3); after a revoke the call throws at once (Q4). Either
// way nothing came back, so recreating is safe.
async function restoreEntry(
  sessionId: string
): Promise<chrome.sessions.Session | null> {
  try {
    return await chrome.sessions.restore(sessionId);
  } catch (error) {
    console.warn('Could not reopen through Chrome, so recreating: ', error);
    return null;
  }
}

// One undo step: a failure warns and the rest still run.
async function step(failure: string, run: () => Promise<unknown>) {
  try {
    await run();
  } catch (error) {
    console.warn(failure, error);
  }
}

async function lastFocusedWindowId(): Promise<number | null> {
  try {
    return (await chrome.windows.getLastFocused()).id ?? null;
  } catch (error) {
    console.warn('Could not read the focused window: ', error);
    return null;
  }
}

// Undo step one, always FIRST: the focus goes back where it was. Measured
// (headed, 2026-09-27): focus first gave today's end state 12/12 with a
// ~35 ms flash; focusing last lengthens the flash.
async function refocus(windowId: number | null): Promise<void> {
  if (windowId === null) return;
  await step('Could not give the focus back: ', () =>
    chrome.windows.update(windowId, { focused: true })
  );
}

// Where a closed tab would go back to now, and what recreateTab would leave
// there -- read before the restore.
type TabPlace = {
  // False when the tab's window has gone (it was the window's last tab):
  // the restore then makes a new window, as recreate does (Task 1, Q1b).
  windowStillOpen: boolean;
  // The tab in front of that window now. recreateTab brings the reopened tab
  // to the front only if it was in front when it closed.
  frontTabId: number | null;
  // The collapsed state recreate leaves the tab's group in, or null for no
  // group. recreateTab rejoins a group still in the window AS IT IS NOW, or
  // makes a new one as the snapshot had it; bringing the tab to the front
  // then expands it. In a new window (recreateWindow) the group is collapsed
  // last, as the snapshot had it.
  groupCollapsed: boolean | null;
};

async function tabPlaceNow(
  item: Extract<ClosedItem, { kind: 'tab' }>
): Promise<TabPlace> {
  const windowId = item.window.id;
  try {
    await chrome.windows.get(windowId);
  } catch {
    return {
      windowStillOpen: false,
      frontTabId: null,
      groupCollapsed: item.group?.collapsed ?? null,
    };
  }
  let frontTabId: number | null = null;
  try {
    const [front] = await chrome.tabs.query({ windowId, active: true });
    frontTabId = front?.id ?? null;
  } catch (error) {
    console.warn('Could not read the front tab: ', error);
  }
  let groupCollapsed: boolean | null = null;
  if (item.group) {
    const live = chrome.tabGroups
      ? await chrome.tabGroups.get(item.group.id).catch(() => null)
      : null;
    const asNow =
      live && live.windowId === windowId
        ? live.collapsed
        : item.group.collapsed;
    groupCollapsed = item.tab.active ? false : asNow;
  }
  return { windowStillOpen: true, frontTabId, groupCollapsed };
}

// A restored tab is made active, its window focused, a collapsed group it
// lands in expanded, and, in a group that still has tabs, it lands at the
// group's END (Task 1, Q2, Q2b). Each is put back as recreateTab leaves it.
async function undoTabRestore(
  item: Extract<ClosedItem, { kind: 'tab' }>,
  restored: chrome.sessions.Session,
  focusedWindowId: number | null,
  place: TabPlace
): Promise<Reopened | null> {
  await refocus(focusedWindowId);
  const tab = restored.tab;
  const tabId = tab?.id;
  if (tab === undefined || tabId === undefined) {
    // It came back, but there is nothing to undo on or to focus.
    console.warn('Chrome restored a tab without saying which');
    return null;
  }
  const windowId = tab.windowId;

  if (place.windowStillOpen) {
    await step('Could not move a reopened tab back to its place: ', () =>
      chrome.tabs.move(tabId, { index: item.tab.index })
    );
  } else if (item.window.bounds) {
    await placeWindow(windowId, item.window.bounds);
  }
  // Undefined while tabGroups is not held; recreate then leaves groups
  // alone too.
  if (chrome.tabGroups) {
    await step('Could not regroup a reopened tab: ', () =>
      settleGroup(tabId, windowId, tab.groupId, item.group)
    );
  }
  const frontTabId = place.frontTabId;
  if (!item.tab.active && frontTabId !== null) {
    await step('Could not bring the front tab back: ', () =>
      chrome.tabs.update(frontTabId, { active: true })
    );
  }
  // After the front tab, so a collapse never hides the tab in front.
  const collapsed = place.groupCollapsed;
  if (chrome.tabGroups && collapsed !== null) {
    await step('Could not collapse a reopened tab group: ', async () => {
      const { groupId } = await chrome.tabs.get(tabId);
      if (groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
        await chrome.tabGroups.update(groupId, { collapsed });
      }
    });
  }
  if (!place.windowStillOpen) {
    await restoreWindowState(windowId, item.window.state);
  }
  return { kind: 'tab', tabId };
}

// After the move, the tab is in its group, or in none, as recreateTab leaves
// it: a move can take it out of its group or into another (Chrome keeps a
// group contiguous).
async function settleGroup(
  tabId: number,
  windowId: number,
  restoredGroupId: number,
  group: OpenGroup | null
): Promise<void> {
  const none = chrome.tabGroups.TAB_GROUP_ID_NONE;
  const { groupId } = await chrome.tabs.get(tabId);
  if (group === null) {
    if (groupId !== none) await leaveGroup(tabId);
    return;
  }
  if (restoredGroupId === none) {
    await regroup(tabId, windowId, group);
  } else if (groupId !== restoredGroupId) {
    await chrome.tabs.group({ groupId: restoredGroupId, tabIds: [tabId] });
  }
}

// A restored window comes back focused, with its first tab active when its
// active tab was in a group, and `normal` when it was maximized (Task 1, Q2,
// Q2b). Put back as recreateWindow leaves it: unfocused, the snapshot's
// active tab in front, each group as the snapshot had it, the snapshot's
// bounds, then its state last.
async function undoWindowRestore(
  snapshot: OpenWindow,
  restored: chrome.sessions.Session,
  focusedWindowId: number | null
): Promise<Reopened | null> {
  await refocus(focusedWindowId);
  const windowId = restored.window?.id;
  if (windowId === undefined) {
    console.warn('Chrome restored a window without saying which');
    return null;
  }
  if (snapshot.bounds) await placeWindow(windowId, snapshot.bounds);

  // Chrome brings the tabs back in the snapshot's order: the entry was
  // matched on exactly these addresses at close (Task 5). A different count
  // leaves the front tab and groups as Chrome made them.
  const restoredTabs = restored.window?.tabs ?? [];
  if (restoredTabs.length === snapshot.tabs.length) {
    const activeAt = snapshot.tabs.findIndex((tab) => tab.active);
    const activeId = restoredTabs[Math.max(activeAt, 0)]?.id;
    if (activeId !== undefined) {
      await step('Could not activate a reopened tab: ', () =>
        chrome.tabs.update(activeId, { active: true })
      );
    }
    if (chrome.tabGroups) {
      for (const group of snapshot.groups) {
        const at = snapshot.tabs.findIndex((tab) => tab.groupId === group.id);
        const groupId = restoredTabs[at]?.groupId;
        if (
          groupId === undefined ||
          groupId === chrome.tabGroups.TAB_GROUP_ID_NONE
        ) {
          continue;
        }
        await step('Could not restore a reopened tab group: ', () =>
          chrome.tabGroups.update(groupId, {
            title: group.title,
            color: group.color,
            collapsed: group.collapsed,
          })
        );
      }
    }
  } else {
    console.warn('Chrome restored a window with different tabs');
  }

  await restoreWindowState(windowId, snapshot.state);
  return { kind: 'window', windowId };
}

async function placeWindow(
  windowId: number,
  bounds: OpenWindowBounds
): Promise<void> {
  await step('Could not put a reopened window back in its place: ', () =>
    chrome.windows.update(windowId, { ...bounds })
  );
}

function isReopened(value: unknown): value is Reopened {
  if (!isRecord(value)) return false;
  if (value.kind === 'tab') return typeof value.tabId === 'number';
  if (value.kind === 'window') return typeof value.windowId === 'number';
  return false;
}

type WindowSnapshot = Pick<
  OpenWindow,
  'bounds' | 'state' | 'incognito' | 'tabs' | 'groups'
>;

// A recreated window, and each tab that came back into it: the new tab id by
// the old one. Never empty: a window nothing came back into is removed.
type RebuiltWindow = {
  windowId: number;
  createdByOldId: ReadonlyMap<number, number>;
};

// Rule 5: the window comes back unfocused, in its old bounds and state.
//
// It is created EMPTY -- Chrome opens a seed chrome://newtab/ tab -- and the
// real tabs are added one by one. A window created with a refused first url
// rejects outright, so passing the urls to windows.create would lose every
// tab to one that Chrome declines (rule 10). The seed goes once the real tabs
// are in.
async function recreateWindow(
  snapshot: WindowSnapshot
): Promise<RebuiltWindow | null> {
  let created: chrome.windows.Window | undefined;
  try {
    created = await chrome.windows.create({
      focused: false,
      incognito: snapshot.incognito,
      ...(snapshot.bounds ?? {}),
    });
  } catch (error) {
    console.warn('Could not reopen a window: ', error);
    return null;
  }
  const windowId = created?.id;
  if (windowId === undefined) return null;
  const seedTabId = created?.tabs?.[0]?.id;

  // Rule 7: each tab loads its real address, never the lazy-load placeholder
  // a session restore uses. One at a time, so `index` is the count so far.
  const createdByOldId = new Map<number, number>();
  for (const tab of snapshot.tabs) {
    try {
      const reopened = await chrome.tabs.create({
        windowId,
        url: tab.url,
        index: createdByOldId.size,
        pinned: tab.pinned,
        active: false,
      });
      if (reopened.id !== undefined) createdByOldId.set(tab.id, reopened.id);
    } catch (error) {
      // Rule 10: a tab Chrome refuses is skipped; the rest still come back.
      console.warn('Could not reopen a tab: ', error);
    }
  }

  const [firstCreatedId] = createdByOldId.values();
  if (firstCreatedId === undefined) {
    // Rule 10: nothing came back, so leave no empty window behind.
    try {
      await chrome.windows.remove(windowId);
    } catch (error) {
      console.warn('Could not remove an empty reopened window: ', error);
    }
    return null;
  }

  const activeTab = snapshot.tabs.find((tab) => tab.active);
  const activeId =
    (activeTab && createdByOldId.get(activeTab.id)) ?? firstCreatedId;
  try {
    await chrome.tabs.update(activeId, { active: true });
  } catch (error) {
    console.warn('Could not activate a reopened tab: ', error);
  }

  // Undefined -- not throwing -- while the tabGroups permission is
  // ungranted, which it may have become since the close (the tabs then come
  // back ungrouped). Grouping runs after activation: the active tab is never
  // in a collapsed group in a real snapshot, and collapsing last keeps it so.
  if (chrome.tabGroups) {
    for (const group of snapshot.groups) {
      const tabIds = snapshot.tabs
        .filter((tab) => tab.groupId === group.id)
        .flatMap((tab) => {
          const newId = createdByOldId.get(tab.id);
          return newId === undefined ? [] : [newId];
        });
      if (tabIds.length === 0) continue;
      try {
        const [firstTabId, ...restTabIds] = tabIds;
        const groupId = await chrome.tabs.group({
          createProperties: { windowId },
          tabIds: [firstTabId, ...restTabIds],
        });
        await chrome.tabGroups.update(groupId, {
          title: group.title,
          color: group.color,
          collapsed: group.collapsed,
        });
      } catch (error) {
        console.warn('Could not reopen a tab group: ', error);
      }
    }
  }

  if (seedTabId !== undefined) {
    try {
      await chrome.tabs.remove(seedTabId);
    } catch (error) {
      console.warn('Could not remove the seed tab: ', error);
    }
  }

  await restoreWindowState(windowId, snapshot.state);
  return { windowId, createdByOldId };
}

// Last, because windows.create cannot combine `focused: false` with a
// maximized or fullscreen state. 'locked-fullscreen' needs a kiosk
// permission this extension does not hold, so it comes back normal.
async function restoreWindowState(
  windowId: number,
  state: OpenWindow['state']
): Promise<void> {
  if (
    state === 'minimized' ||
    state === 'maximized' ||
    state === 'fullscreen'
  ) {
    await step('Could not restore a reopened window state: ', () =>
      chrome.windows.update(windowId, { state })
    );
  }
}

// Rule 6: the tab goes back to its window at its Chrome index, pinned or
// not, active or not, and into its group. If the window has gone -- it was
// the window's last tab, say -- the window is recreated around it.
async function recreateTab(
  item: Extract<ClosedItem, { kind: 'tab' }>
): Promise<Reopened | null> {
  try {
    await chrome.windows.get(item.window.id);
  } catch {
    const rebuilt = await recreateWindow({
      ...item.window,
      tabs: [item.tab],
      groups: item.group ? [item.group] : [],
    });
    const tabId = rebuilt?.createdByOldId.get(item.tab.id);
    return tabId === undefined ? null : { kind: 'tab', tabId };
  }

  let reopened: chrome.tabs.Tab;
  try {
    // Created in the background even when it was the front tab: Chrome
    // expands a collapsed group a tab is created into active, and taking the
    // tab back out leaves that group expanded (KAN-280 rule 6, KAN-310). An
    // index past the end is clamped by Chrome.
    reopened = await chrome.tabs.create({
      windowId: item.window.id,
      url: item.tab.url,
      index: item.tab.index,
      pinned: item.tab.pinned,
      active: false,
    });
  } catch (error) {
    console.warn('Could not reopen a tab: ', error);
    return null;
  }
  // Chrome gives every tab it creates an id. Without one there is nothing to
  // group, raise or focus, and no way to tell the tab apart from any other.
  if (reopened.id === undefined) {
    console.warn('Chrome gave a reopened tab no id');
    return null;
  }

  // Undefined while the tabGroups permission is ungranted; the snapshot
  // then could not see groups, so an ungrouped tab is not known to be one.
  if (chrome.tabGroups) {
    if (item.group) {
      await regroup(reopened.id, item.window.id, item.group);
    } else if (reopened.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
      await leaveGroup(reopened.id);
    }
  }

  // To the front only once it is in its own group or none (KAN-310). This
  // raises it within its window without focusing the window (rule 5). Its
  // own group, if collapsed, expands to show it, as it would in Chrome.
  if (item.tab.active) {
    try {
      await chrome.tabs.update(reopened.id, { active: true });
    } catch (error) {
      console.warn('Could not bring a reopened tab to the front: ', error);
    }
  }
  return { kind: 'tab', tabId: reopened.id };
}

// Chrome puts a tab created strictly between two tabs of one group into that
// group. A tab that was ungrouped when it closed comes back ungrouped
// (KAN-280 rule 6, KAN-309). It is still reopened if this fails, so it only
// warns.
async function leaveGroup(tabId: number): Promise<void> {
  try {
    await chrome.tabs.ungroup(tabId);
  } catch (error) {
    console.warn('Could not take a reopened tab out of a group: ', error);
  }
}

// Joins the old group if it still exists in the tab's window; otherwise makes
// a new one with the old name, colour and collapsed state (rule 6). A tab
// that comes back ungrouped is still reopened, so this only warns.
async function regroup(
  tabId: number,
  windowId: number,
  group: OpenGroup
): Promise<void> {
  try {
    const existing = await chrome.tabGroups.get(group.id).catch(() => null);
    if (existing && existing.windowId === windowId) {
      await chrome.tabs.group({ groupId: group.id, tabIds: [tabId] });
      return;
    }
    const groupId = await chrome.tabs.group({
      createProperties: { windowId },
      tabIds: [tabId],
    });
    await chrome.tabGroups.update(groupId, {
      title: group.title,
      color: group.color,
      collapsed: group.collapsed,
    });
  } catch (error) {
    console.warn('Could not regroup a reopened tab: ', error);
  }
}

// The request guard. The item crosses from the page as a structured clone, so
// every field reopening reads is checked here, in the worker, before it is
// trusted.
export function isReopenWithHistoryRequest(
  message: unknown
): message is ReopenWithHistoryRequest {
  return (
    isRecord(message) &&
    message.type === REOPEN_WITH_HISTORY_MESSAGE &&
    isClosedItem(message.item)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isClosedItem(value: unknown): value is ClosedItem {
  if (!isRecord(value)) return false;
  if (
    typeof value.restorableSessionId !== 'string' &&
    value.restorableSessionId !== null
  ) {
    return false;
  }
  if (!isOpenWindow(value.window)) return false;
  if (value.kind === 'window') return true;
  return (
    value.kind === 'tab' &&
    isOpenTab(value.tab) &&
    (value.group === null || isOpenGroup(value.group))
  );
}

const WINDOW_STATES: readonly unknown[] = [
  'normal',
  'minimized',
  'maximized',
  'fullscreen',
  'locked-fullscreen',
];

function isOpenWindow(value: unknown): value is OpenWindow {
  return (
    isRecord(value) &&
    typeof value.id === 'number' &&
    typeof value.isThisWindow === 'boolean' &&
    Array.isArray(value.tabs) &&
    value.tabs.every(isOpenTab) &&
    Array.isArray(value.groups) &&
    value.groups.every(isOpenGroup) &&
    (value.bounds === null || isBounds(value.bounds)) &&
    WINDOW_STATES.includes(value.state) &&
    typeof value.incognito === 'boolean'
  );
}

function isBounds(value: unknown): value is OpenWindowBounds {
  return (
    isRecord(value) &&
    typeof value.left === 'number' &&
    typeof value.top === 'number' &&
    typeof value.width === 'number' &&
    typeof value.height === 'number'
  );
}

function isOpenTab(value: unknown): value is OpenTab {
  return (
    isRecord(value) &&
    typeof value.id === 'number' &&
    typeof value.windowId === 'number' &&
    typeof value.title === 'string' &&
    typeof value.url === 'string' &&
    typeof value.favIconUrl === 'string' &&
    typeof value.active === 'boolean' &&
    typeof value.pinned === 'boolean' &&
    typeof value.audible === 'boolean' &&
    typeof value.muted === 'boolean' &&
    (value.groupId === null || typeof value.groupId === 'number') &&
    typeof value.index === 'number'
  );
}

function isOpenGroup(value: unknown): value is OpenGroup {
  return (
    isRecord(value) &&
    typeof value.id === 'number' &&
    typeof value.title === 'string' &&
    typeof value.color === 'string' &&
    sanitizeTabGroupColor(value.color) === value.color &&
    typeof value.collapsed === 'boolean'
  );
}
