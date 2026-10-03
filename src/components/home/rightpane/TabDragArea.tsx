// The tab list: one `tabs` drag area over the windows it is given (KAN-132).
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
import { useTabDrop } from './useTabDrop';
import type { PaneWindows } from './rowDrag/dropRules';
import { markNewWindowTarget } from './newWindowTarget';
import { tabCarryOut } from './carryOut';

export const TabDragArea: React.FC<{
  // Must keep its identity between renders while its windows are unchanged:
  // the area re-binds its listeners whenever what this derives changes.
  tabList: PaneWindows;
  // The phantom row a carried tab is drawn as, which this list adopts
  // when the pointer comes in (KAN-350). Undefined unless one is carried
  // and the session on screen can take it.
  adoptRowId?: string;
  // The row the adopted item lands as, followed into view after a committed
  // drop (KAN-155): its own row here, once the move has re-rendered.
  adoptedRowLandsAs?: string;
  children: ReactNode;
}> = ({ tabList, adoptRowId, adoptedRowLandsAs, children }) => {
  const hasTabGroupsPermission = useSelector(
    (state: RootState) => state.globalState.hasTabGroupsPermission
  );
  const { isSearching } = useSavedSearch();
  const tabDrop = useTabDrop(tabList, hasTabGroupsPermission);
  const keepWindowOpen = useKeepWindowOpen(tabList.tabGroupId);
  const carryOut = useCallback(
    (rowId: string) => tabCarryOut(tabList, rowId),
    [tabList]
  );

  return (
    <RowDragArea
      scope="tabs"
      rowIds={tabDrop.rowIds}
      onMove={tabDrop.onMove}
      dragKind="tab"
      // A tab may be dropped into another saved window. Paired with onMove's
      // routing on the window it is handed -- see dropsAcrossWindows.
      dropsAcrossWindows
      resolveDrop={tabDrop.resolveDrop}
      onDropTargetChange={tabDrop.onDropTargetChange}
      landsBesideFixedRow={tabDrop.landsBesideFixedRow}
      fixedRowsRemovedBy={tabDrop.fixedRowsRemovedBy}
      gapChangesBy={tabDrop.gapChangesBy}
      // Each group's title row and tail marker are drawn in this list but never
      // dragged in it -- in a window's `items` list a group is one row that
      // CONTAINS its title, so it is declared here only.
      fixedRowSelector="[data-fixed-row-id]"
      // Onto the session list, a tab is carried to another session
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
