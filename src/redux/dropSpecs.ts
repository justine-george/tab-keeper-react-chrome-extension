// KAN-279 D12. What each kind of drop tells dropOnTop: the list its move
// reducer applies toIndex to, whether the held row still exists, and the move
// itself. One builder per reducer family, pure, so the drag handlers and the
// tests use the SAME closures -- a test that built its own could pass while a
// handler read the wrong window.
//
// Every targetIds returns exactly the id list its reducer splices toIndex
// into (KAN-131: an index is only valid in the list that produced it).
import type { DropOnTop } from './dropOnTop';
import {
  moveChromeGroupAcrossWindowsInternal,
  moveChromeGroupInternal,
  moveSessionInternal,
  moveTabAcrossWindowsInternal,
  moveTabInternal,
  moveWindowInternal,
  type TabMasterContainer,
} from './slices/tabContainerDataStateSlice';
import {
  groupItemIdOf,
  itemIdOf,
  partitionTabsIntoItems,
} from '../utils/functions/tabGroups';

const sessionIn = (s: TabMasterContainer, tabGroupId: string) =>
  s.tabGroups.find((g) => g.tabGroupId === tabGroupId);

const windowIn = (
  s: TabMasterContainer,
  tabGroupId: string,
  windowId: string
) => sessionIn(s, tabGroupId)?.windows.find((w) => w.windowId === windowId);

// moveSessionInternal: toIndex indexes state.tabGroups. Session drag is
// disabled while searching, so the rendered list is the stored one.
export function sessionDrop(tabGroupId: string, toIndex: number): DropOnTop {
  return {
    rowId: tabGroupId,
    toIndex,
    targetIds: (s) => s.tabGroups.map((g) => g.tabGroupId),
    rowExists: (s) => s.tabGroups.some((g) => g.tabGroupId === tabGroupId),
    move: (i) => moveSessionInternal({ tabGroupId, toIndex: i }),
  };
}

// moveWindowInternal: toIndex indexes the session's windows[].
export function windowDrop(
  tabGroupId: string,
  windowId: string,
  toIndex: number
): DropOnTop {
  return {
    rowId: windowId,
    toIndex,
    targetIds: (s) =>
      sessionIn(s, tabGroupId)?.windows.map((w) => w.windowId) ?? null,
    rowExists: (s) =>
      sessionIn(s, tabGroupId)?.windows.some((w) => w.windowId === windowId) ??
      false,
    move: (i) => moveWindowInternal({ tabGroupId, windowId, toIndex: i }),
  };
}

export interface TabDropParams {
  tabGroupId: string;
  tabId: string;
  fromWindowId: string;
  toWindowId: string;
  toIndex: number;
  toChromeGroupId?: string;
}

// Both tab reducers apply toIndex to the DESTINATION window's tabs[]:
// moveTabInternal to the one window (the tab still in it),
// moveTabAcrossWindowsInternal to toWindowId's (the tab not yet in it). A band
// the drop joins must still be in that window, or there is nothing to join.
export function tabDrop({
  tabGroupId,
  tabId,
  fromWindowId,
  toWindowId,
  toIndex,
  toChromeGroupId,
}: TabDropParams): DropOnTop {
  return {
    rowId: tabId,
    toIndex,
    targetIds: (s) => {
      const to = windowIn(s, tabGroupId, toWindowId);
      if (!to) return null;
      if (
        toChromeGroupId !== undefined &&
        !(to.chromeTabGroups ?? []).some((g) => g.groupId === toChromeGroupId)
      ) {
        return null;
      }
      return to.tabs.map((t) => t.tabId);
    },
    rowExists: (s) =>
      windowIn(s, tabGroupId, fromWindowId)?.tabs.some(
        (t) => t.tabId === tabId
      ) ?? false,
    move: (i) =>
      fromWindowId === toWindowId
        ? moveTabInternal({
            tabGroupId,
            windowId: fromWindowId,
            tabId,
            toIndex: i,
            toChromeGroupId,
          })
        : moveTabAcrossWindowsInternal({
            tabGroupId,
            fromWindowId,
            toWindowId,
            tabId,
            toIndex: i,
            toChromeGroupId,
          }),
  };
}

export interface GroupDropParams {
  tabGroupId: string;
  groupId: string;
  fromWindowId: string;
  toWindowId: string;
  toIndex: number;
}

// Both group reducers apply toIndex to a window's ITEMS, rebuilt with exactly
// this partition call -- no permission gate there, unlike the render --
// moveChromeGroupInternal in its own window (the group among them),
// moveChromeGroupAcrossWindowsInternal in toWindowId's (not yet among them).
export function groupDrop({
  tabGroupId,
  groupId,
  fromWindowId,
  toWindowId,
  toIndex,
}: GroupDropParams): DropOnTop {
  const itemIdsIn = (s: TabMasterContainer, windowId: string) => {
    const w = windowIn(s, tabGroupId, windowId);
    return w
      ? partitionTabsIntoItems(w.tabs, w.chromeTabGroups).map(itemIdOf)
      : null;
  };
  const rowId = groupItemIdOf(groupId);
  return {
    rowId,
    toIndex,
    targetIds: (s) => itemIdsIn(s, toWindowId),
    rowExists: (s) => itemIdsIn(s, fromWindowId)?.includes(rowId) ?? false,
    move: (i) =>
      fromWindowId === toWindowId
        ? moveChromeGroupInternal({
            tabGroupId,
            windowId: fromWindowId,
            groupId,
            toIndex: i,
          })
        : moveChromeGroupAcrossWindowsInternal({
            tabGroupId,
            fromWindowId,
            toWindowId,
            groupId,
            toIndex: i,
          }),
  };
}
