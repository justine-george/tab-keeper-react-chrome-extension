// The items list: one `items` drag area over the windows it is given
// (KAN-132), where a loose tab is one row and a whole Chrome group is another.
//
// The pane is the only caller, over every window in the session -- a window
// never provides one of its own. ONE component rather than the per-window area
// each window used to build for itself, so the wiring behind it can only be
// changed in one place.
import React, { type ReactNode } from 'react';
import { useSelector } from 'react-redux';

import type { RootState } from '../../../redux/store';
import { RowDragArea } from './rowDrag/RowDragArea';
import { useGroupDrop } from './useGroupDrop';
import type { PaneWindows } from './useTabDrop';

export const GroupDragArea: React.FC<{
  // Must keep its identity between renders while its windows are unchanged:
  // the area re-binds its listeners whenever what this derives changes.
  itemList: PaneWindows;
  children: ReactNode;
}> = ({ itemList, children }) => {
  const hasTabGroupsPermission = useSelector(
    (state: RootState) => state.globalState.hasTabGroupsPermission
  );
  const isSearchPanel = useSelector(
    (state: RootState) => state.globalState.isSearchPanel
  );
  const groupDrop = useGroupDrop(itemList, hasTabGroupsPermission);

  return (
    <RowDragArea
      scope="items"
      rowIds={groupDrop.rowIds}
      onMove={groupDrop.onMove}
      dragKind="group"
      // Only a group's title row is a handle, so a press on a tab reaches this
      // list's begin, finds no handle, and is left to the tab list.
      handleSelector="[data-group-drag-handle]"
      // No clampDropToEnds: outside a window's rows means out of the window,
      // which must be refused. restoreScrollIfNoDrop, because compressing the
      // held group can shrink the list and clamp the scroll.
      restoreScrollIfNoDrop
      // No dropsAcrossWindows: a group cannot leave its window yet, so every
      // release is judged among that window's rows -- see useGroupDrop.
      //
      // The mode, not the box's contents -- see KAN-140 on
      // TabGroupEntryContainer for why this is not isFilteredView.
      disabled={isSearchPanel}
    >
      {children}
    </RowDragArea>
  );
};
