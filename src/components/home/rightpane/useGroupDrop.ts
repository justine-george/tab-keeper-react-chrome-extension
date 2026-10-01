// The group drag's rules, for an `items` list spanning any number of saved
// windows (KAN-132).
//
// The same move the tab list made, one level up. A group drag used to be one
// drag area per window, over that window's top-level rows -- each loose tab, and
// each Chrome group as ONE row (KAN-160) -- and each window answered its own
// drop questions. A group must be able to name a row in ANOTHER window, which a
// per-window area cannot do, so the pane has one `items` area over the whole
// session and its questions are answered here.
//
// A GROUP MAY NOW LEAVE ITS WINDOW (§11.3). The area opts into
// `dropsAcrossWindows`, so the engine takes the landing window from the block
// under the pointer, and onMove below routes on it: the group's own window is a
// reorder, any other window is a move between windows. Those two facts are one
// change -- the flag without the routing hands a foreign window's index to a
// reducer that applies it to the group's own (measured, and silent).
//
// A release over NO window is still refused, by the engine: with no block under
// the pointer the landing falls back to the source window and is judged against
// its rows, which is the "drag it to the end" forgiveness every list has had.
import { useCallback, useMemo } from 'react';
import { useDispatch } from 'react-redux';

import type { AppDispatch } from '../../../redux/store';
import { dropOnTop } from '../../../redux/dropOnTop';
import { groupDrop, intoNewWindow } from '../../../redux/dropSpecs';
import { dropCarriedGroup } from '../../../redux/dropCarried';
import { moveToSession } from '../../../redux/moveToSession';
import { currentCarry, endCarry } from '../../../redux/carry';
import { newWindowPlacement } from './newWindowTarget';
import {
  partitionTabsIntoItems,
  itemIdOf,
  groupIdOfItemId,
} from '../../../utils/functions/tabGroups';
import type { DragWindows, GroupMove, PaneWindows } from './rowDrag/dropRules';

/**
 * Everything an `items` drag area needs from the windows it lists, except what
 * a drop does: the rows, and what a release would move where
 * (describeGroupMove). Asks nothing of Redux, so any list of windows that can
 * name its tabs and groups by string id can use it.
 */
export function useGroupDropGeometry(
  windows: DragWindows,
  hasTabGroupsPermission: boolean
) {
  // Each window's top-level rows as drawn, built from the same partition
  // WindowEntryContainer renders -- including the permission gate, so the
  // positions are those of the rows the user actually sees, and
  // moveChromeGroupInternal rebuilds the same list with the same function
  // (KAN-131: an index is only valid in the list that produced it).
  const itemIdsByWindow = useMemo(
    () =>
      windows.map((w) => ({
        windowId: w.windowId,
        itemIds: partitionTabsIntoItems(
          w.tabs,
          hasTabGroupsPermission ? w.chromeTabGroups : undefined
        ).map(itemIdOf),
      })),
    [windows, hasTabGroupsPermission]
  );

  // Every window's items, in render order. A group drag must be able to name a
  // row in ANOTHER window, which a per-window area cannot do.
  const rowIds = useMemo(
    () => itemIdsByWindow.flatMap((w) => w.itemIds),
    [itemIdsByWindow]
  );

  // Which window each group belongs to. The pane-wide area knows only row ids,
  // and which window owns a row is the list's own knowledge. Read off the same
  // partition as the rows, so the two cannot disagree about which groups exist.
  const windowOfGroup = useMemo(() => {
    const byId = new Map<string, string>();
    for (const { windowId, itemIds } of itemIdsByWindow) {
      for (const itemId of itemIds) {
        const groupId = groupIdOfItemId(itemId);
        if (groupId !== undefined) byId.set(groupId, windowId);
      }
    }
    return byId;
  }, [itemIdsByWindow]);

  // `toIndex` is WINDOW-LOCAL: the area counts only the rows of the window the
  // release landed in. Only a group row has a handle, so a loose tab's id
  // never arrives; if one did, or the drop names no window, it describes no
  // move.
  const describeGroupMove = useCallback(
    (
      rowId: string,
      toIndex: number,
      toWindowId: string | undefined
    ): GroupMove | undefined => {
      const groupId = groupIdOfItemId(rowId);
      if (groupId === undefined) return undefined;
      const fromWindowId = windowOfGroup.get(groupId);
      if (fromWindowId === undefined || toWindowId === undefined) {
        return undefined;
      }
      return { groupId, fromWindowId, toWindowId, toIndex };
    },
    [windowOfGroup]
  );

  return { rowIds, describeGroupMove };
}

/**
 * Everything an `items` drag area needs from a saved session's windows. Read
 * by GroupDragArea, the one place a saved items list is wired up.
 */
export function useGroupDrop(
  itemList: PaneWindows,
  hasTabGroupsPermission: boolean
) {
  const dispatch: AppDispatch = useDispatch();
  const { windows, tabGroupId } = itemList;
  const { rowIds, describeGroupMove } = useGroupDropGeometry(
    windows,
    hasTabGroupsPermission
  );

  // The move's `toIndex` counts the LANDING window's items, which is why the
  // landing window is routed on rather than ignored. The two
  // reducers count `toIndex` in different lists: moveChromeGroupInternal in the
  // source window's items (where the group still sits, so the last slot is
  // `length - 1`), moveChromeGroupAcrossWindowsInternal in the DESTINATION's
  // with the group not yet among them (so the last slot is `length`). Handing
  // either one the other's index is a silent wrong move that dirties the
  // session for a cloud write -- measured, not assumed (KAN-131, KAN-132).
  // groupDrop picks between them on the two window ids.
  //
  // Two reducers, not one widened one (§11.4), for the reason §7 gives for
  // tabs: the reorder's no-op guard compares one window's item indices, and it
  // rebuilds windowGroup.tabs by flattening the items of a single window.
  //
  // A drop that names no window has nowhere to go, and is the engine's refusal
  // arriving here.
  const onMove = useCallback(
    (
      itemId: string,
      toIndex: number,
      // The band a release lands in, which an items list never asks about: it
      // declares no resolveDrop, so this is always undefined here. That is also
      // the mechanism behind "a group never lands INSIDE another group".
      _dropTargetId: string | undefined,
      toWindowId?: string
    ) => {
      const move = describeGroupMove(itemId, toIndex, toWindowId);
      if (move === undefined) return;
      // A CARRIED group (KAN-350): let go where the drop landed, from the
      // window the carry took it out of -- see dropCarriedGroup.
      const carried = currentCarry()?.carried;
      if (carried?.kind === 'group') {
        const moved = dispatch(
          dropCarriedGroup(carried, {
            tabGroupId,
            toWindowId: move.toWindowId,
            toIndex: move.toIndex,
          })
        );
        endCarry(moved ? 'committed' : 'cancelled');
        return;
      }
      // On a New window target: the group, its entry with it, becomes a new
      // window of its own session -- first, from the header's (KAN-361 N1
      // B), last, from the trailing block below the last window (KAN-366 B)
      // -- one move and so one undo. No Moved toast: the move is on screen
      // (S5 A).
      const at = newWindowPlacement(move.toWindowId);
      if (at !== undefined) {
        dispatch(
          moveToSession({
            move: {
              carried: {
                kind: 'group',
                tabGroupId,
                windowId: move.fromWindowId,
                groupId: move.groupId,
              },
              to: intoNewWindow(tabGroupId, at),
            },
            announceMoved: false,
          })
        );
        return;
      }
      dispatch(
        dropOnTop(
          groupDrop({
            tabGroupId,
            groupId: move.groupId,
            fromWindowId: move.fromWindowId,
            toWindowId: move.toWindowId,
            toIndex: move.toIndex,
          })
        )
      );
    },
    [dispatch, tabGroupId, describeGroupMove]
  );

  return { rowIds, onMove };
}
