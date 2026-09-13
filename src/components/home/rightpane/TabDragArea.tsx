// The tab list: one `tabs` drag area over the windows it is given (KAN-132).
//
// The pane renders it over every window in the session; a window rendered on
// its own renders it over itself (see WindowEntryContainer's ownsTabList). ONE
// component for both, so the two can never be wired differently -- they were
// two copies of the same nine props, and the next change to that wiring would
// have had to be made twice.
import React, { type ReactNode } from 'react';
import { useSelector } from 'react-redux';

import type { RootState } from '../../../redux/store';
import { RowDragArea } from './rowDrag/RowDragArea';
import { useTabDrop, type TabListWindows } from './useTabDrop';

export const TabDragArea: React.FC<{
  // Must keep its identity between renders while its windows are unchanged:
  // the area re-binds its listeners whenever what this derives changes.
  tabList: TabListWindows;
  children: ReactNode;
}> = ({ tabList, children }) => {
  const hasTabGroupsPermission = useSelector(
    (state: RootState) => state.globalState.hasTabGroupsPermission
  );
  const isSearchPanel = useSelector(
    (state: RootState) => state.globalState.isSearchPanel
  );
  const tabDrop = useTabDrop(tabList, hasTabGroupsPermission);

  return (
    <RowDragArea
      scope="tabs"
      rowIds={tabDrop.rowIds}
      onMove={tabDrop.onMove}
      dragKind="tab"
      resolveDrop={tabDrop.resolveDrop}
      onDropTargetChange={tabDrop.onDropTargetChange}
      landsBesideFixedRow={tabDrop.landsBesideFixedRow}
      // Each group's title row and tail marker are drawn in this list but never
      // dragged in it -- in a window's `items` list a group is one row that
      // CONTAINS its title, so it is declared here only.
      fixedRowSelector="[data-fixed-row-id]"
      // The mode, not the box's contents -- see KAN-140 on
      // TabGroupEntryContainer for why this is not isFilteredView.
      disabled={isSearchPanel}
    >
      {children}
    </RowDragArea>
  );
};
