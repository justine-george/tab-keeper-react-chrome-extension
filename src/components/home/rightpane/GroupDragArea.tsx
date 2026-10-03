// The items list: one `items` drag area over the windows it is given
// (KAN-132), where a loose tab is one row and a whole Chrome group is another.
//
// The pane is the only production caller, over every window in the session --
// a window never provides one of its own. ONE component rather than the
// per-window area each window used to build for itself, so the wiring behind
// it can only be changed in one place.
import React, { useCallback, type ReactNode } from 'react';
import { useSelector } from 'react-redux';

import type { RootState } from '../../../redux/store';
import { RowDragArea } from './rowDrag/RowDragArea';
import { useKeepWindowOpen } from './useKeepWindowOpen';
import { useSavedSearch } from '../../../hooks/useSavedSearch';
import { useGroupDrop } from './useGroupDrop';
import type { PaneWindows } from './rowDrag/dropRules';
import { markNewWindowTarget } from './newWindowTarget';
import { groupCarryOut } from './carryOut';

export const GroupDragArea: React.FC<{
  // Must keep its identity between renders while its windows are unchanged:
  // the area re-binds its listeners whenever what this derives changes.
  itemList: PaneWindows;
  // The phantom row a carried group is drawn as, which this list adopts
  // when the pointer comes in (KAN-350). Undefined unless one is carried
  // and the session on screen can take it.
  adoptRowId?: string;
  // The row the adopted item lands as, followed into view after a committed
  // drop (KAN-155): its own row here, once the move has re-rendered.
  adoptedRowLandsAs?: string;
  children: ReactNode;
}> = ({ itemList, adoptRowId, adoptedRowLandsAs, children }) => {
  const hasTabGroupsPermission = useSelector(
    (state: RootState) => state.globalState.hasTabGroupsPermission
  );
  const { isSearching } = useSavedSearch();
  const groupDrop = useGroupDrop(itemList, hasTabGroupsPermission);
  const keepWindowOpen = useKeepWindowOpen(itemList.tabGroupId);
  const carryOut = useCallback(
    (rowId: string) => groupCarryOut(itemList, rowId),
    [itemList]
  );

  return (
    <RowDragArea
      scope="items"
      rowIds={groupDrop.rowIds}
      onMove={groupDrop.onMove}
      dragKind="group"
      // A whole group may be dropped into another saved window (KAN-132
      // §11.3), so the window under the pointer decides the landing -- its
      // header and a collapsed window included -- and each window is previewed
      // in its own frame.
      //
      // PAIRED WITH useGroupDrop's ROUTING, and neither half is safe alone.
      // This flag lets the area name a window that is not the held group's;
      // the one reducer that existed before applies `toIndex` to the SOURCE
      // window, so without the routing below it a foreign index would be
      // applied to the group's own window -- a silent wrong move that dirties
      // the session for a cloud write (measured, Task 11 fix round 1).
      dropsAcrossWindows
      // Only a group's title row is a handle, so a press on a tab reaches this
      // list's begin, finds no handle, and is left to the tab list.
      handleSelector="[data-group-drag-handle]"
      // No clampDropToEnds: outside every window's block means out of the
      // session's windows, which must be refused. restoreScrollIfNoDrop,
      // because compressing the held group can shrink the list and clamp the
      // scroll.
      restoreScrollIfNoDrop
      // Onto the session list, a whole group is carried to another session
      // (KAN-350, KAN-352).
      carryOut={carryOut}
      // Back in the pane, the carried item's phantom becomes this list's
      // drag. A New window target -- the header's, or the trailing block
      // below the last window -- lights up while a release would land in it
      // (KAN-350, KAN-361, KAN-366 B).
      adoptRowId={adoptRowId}
      adoptedRowLandsAs={adoptedRowLandsAs}
      onLandingWindowChange={markNewWindowTarget}
      // From pick-up, the toolbar row's New window target stands in for the
      // session header's controls (KAN-361 N1 B).
      offersNewWindow
      // Resting on a collapsed window's title opens it (KAN-379).
      keepWindowOpen={keepWindowOpen}
      // Off while searching (KAN-385).
      disabled={isSearching}
    >
      {children}
    </RowDragArea>
  );
};
