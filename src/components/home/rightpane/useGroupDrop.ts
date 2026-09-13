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
// IT STILL ONLY MOVES A GROUP WITHIN ITS OWN WINDOW. The area does not opt into
// `dropsAcrossWindows`, so the engine judges every release in the window the
// group came from and refuses one anywhere else -- exactly what the per-window
// areas did. Turning that on is what wiring moveChromeGroupAcrossWindowsInternal
// up to this hook means.
import { useCallback, useMemo } from 'react';
import { useDispatch } from 'react-redux';

import type { AppDispatch } from '../../../redux/store';
import { moveChromeGroupInternal } from '../../../redux/slices/tabContainerDataStateSlice';
import {
  partitionTabsIntoItems,
  itemIdOf,
  groupIdOfItemId,
} from '../../../utils/functions/tabGroups';
import type { PaneWindows } from './useTabDrop';

/**
 * Everything an `items` drag area needs from the windows it lists. Read by
 * GroupDragArea, the one place an items list is wired up.
 */
export function useGroupDrop(
  itemList: PaneWindows,
  hasTabGroupsPermission: boolean
) {
  const dispatch: AppDispatch = useDispatch();
  const { windows, tabGroupId } = itemList;

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
  // release landed in, which is the index moveChromeGroupInternal applies to
  // that window's own items.
  //
  // The area also names that window, and this ignores it: with
  // `dropsAcrossWindows` off the landing window is always the group's own, and
  // a release anywhere else is refused before it gets here. The window comes
  // from the group instead, which is the one the reducer needs either way.
  const onMove = useCallback(
    (itemId: string, toIndex: number) => {
      const groupId = groupIdOfItemId(itemId);
      // Only a group row has a handle, so a loose tab's id never arrives.
      if (groupId === undefined) return;
      const windowId = windowOfGroup.get(groupId);
      if (windowId === undefined) return;
      dispatch(
        moveChromeGroupInternal({ tabGroupId, windowId, groupId, toIndex })
      );
    },
    [dispatch, tabGroupId, windowOfGroup]
  );

  return { rowIds, onMove };
}
