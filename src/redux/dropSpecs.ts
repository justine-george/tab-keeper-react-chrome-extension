// KAN-279 D12. What each kind of drop tells dropOnTop: the list its move
// reducer applies toIndex to, whether the held row still exists, and the move
// itself. One builder per reducer family, pure, so the drag handlers and the
// tests use the SAME closures -- a test that built its own could pass while a
// handler read the wrong window.
//
// Every targetIds returns exactly the id list its reducer splices toIndex
// into (KAN-131: an index is only valid in the list that produced it).
import type { UnknownAction } from '@reduxjs/toolkit';
import { v4 as uuidv4 } from 'uuid';

import type { DropOnTop } from './dropOnTop';
import {
  moveChromeGroupAcrossWindowsInternal,
  moveChromeGroupInternal,
  moveSessionInternal,
  moveTabAcrossWindowsInternal,
  moveTabInternal,
  isTabMove,
  isWindowMove,
  moveToSessionInternal,
  moveWindowInternal,
  type CarriedRef,
  type NewWindowPlace,
  type SessionMove,
  type TabMasterContainer,
} from './slices/tabContainerDataStateSlice';
import { landedRowId } from '../utils/functions/carriedView';
import {
  groupItemIdOf,
  isCarriedStillThere,
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

// KAN-350. The destination of a tab or group dropped as a new first window
// (S2 A, S3 A). The id is minted HERE, by the caller's side, so the reducer
// stays pure and a test can pass its own.
export function intoNewWindow(
  tabGroupId: string,
  at: NewWindowPlace
): {
  tabGroupId: string;
  newWindowId: string;
  at: NewWindowPlace;
} {
  return { tabGroupId, newWindowId: uuidv4(), at };
}

// KAN-350. moveToSessionInternal applies toIndex to the destination window's
// tabs (a tab, not yet in it), to its items (a group, not yet among them), or
// to the destination session's windows (a window). A new window has no index
// of its own: 'first' is aimed at index 0 of the session's windows and 'last'
// past the end of them, so a change that arrived while carried keeps the drop
// at that edge (reaimIndex), and the move ignores the re-aimed index and
// places the window by its `at`. rowExists is the carried item in its
// SOURCE, which is another session or, for a new window, maybe this one.
export function sessionMoveDrop(move: SessionMove): DropOnTop {
  const { carried, to } = move;

  const targetIds = (s: TabMasterContainer): string[] | null => {
    const target = sessionIn(s, to.tabGroupId);
    if (!target) return null;
    if (!('windowId' in to)) return target.windows.map((w) => w.windowId);
    const w = target.windows.find((x) => x.windowId === to.windowId);
    if (!w) return null;
    if (carried.kind === 'group') {
      return partitionTabsIntoItems(w.tabs, w.chromeTabGroups).map(itemIdOf);
    }
    const toChromeGroupId =
      'toChromeGroupId' in to ? to.toChromeGroupId : undefined;
    if (
      toChromeGroupId !== undefined &&
      !(w.chromeTabGroups ?? []).some((g) => g.groupId === toChromeGroupId)
    ) {
      return null;
    }
    return w.tabs.map((t) => t.tabId);
  };

  const rowId = landedRowId(carried);

  const rowExists = (s: TabMasterContainer): boolean =>
    isCarriedStillThere(s.tabGroups, carried);

  return {
    rowId,
    toIndex:
      'toIndex' in to
        ? to.toIndex
        : to.at === 'first'
          ? 0
          : Number.MAX_SAFE_INTEGER,
    targetIds,
    rowExists,
    move: (i) => moveToSessionInternal(withToIndex(move, i)),
  };
}

// The same move, aimed at another index of the same list. A new window has
// no index to aim: its `at` says where it goes.
function withToIndex(move: SessionMove, toIndex: number): SessionMove {
  if (isWindowMove(move)) {
    return { carried: move.carried, to: { ...move.to, toIndex } };
  }
  if (isTabMove(move)) {
    return 'newWindowId' in move.to
      ? move
      : { carried: move.carried, to: { ...move.to, toIndex } };
  }
  return 'newWindowId' in move.to
    ? move
    : { carried: move.carried, to: { ...move.to, toIndex } };
}

// KAN-394. A carried item dropped on the save row. A new session has no list
// to re-aim in, so targetIds is empty and toIndex is 0; `moveAction` is built
// once by the caller (it mints the new session's id) and ignores the index.
// rowExists repeats the reducer's own check (D20) as belt and braces.
export function newSessionDrop(
  carried: CarriedRef,
  moveAction: UnknownAction
): DropOnTop {
  return {
    rowId: landedRowId(carried),
    toIndex: 0,
    targetIds: () => [],
    rowExists: (s) => isCarriedStillThere(s.tabGroups, carried),
    move: () => moveAction,
  };
}
