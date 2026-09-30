import { useCallback, useMemo } from 'react';
import { useDispatch, useSelector } from 'react-redux';

import { css } from '@emotion/react';

import { NormalLabel } from '../../common/Label';
import { useThemeColors } from '../../../hooks/useThemeColors';
import WindowEntryContainer from './WindowEntryContainer';
import { AppDispatch, RootState } from '../../../redux/store';
import {
  isEmptyObject,
  selectVisibleTabGroups,
} from '../../../utils/functions/local';
import {
  addCurrTabToWindow,
  deleteWindow,
  openTabsInAWindow,
  updateWindowGroupTitle,
} from '../../../redux/slices/tabContainerDataStateSlice';
import { useTranslation } from 'react-i18next';
import { isTabKeeperPage, toStoredTab } from '../../../utils/functions/capture';
import { RowDragArea, DraggableRow } from './rowDrag/RowDragArea';
import { TabDragArea } from './TabDragArea';
import { GroupDragArea } from './GroupDragArea';
import { dropOnTop } from '../../../redux/dropOnTop';
import { windowDrop } from '../../../redux/dropSpecs';
import { currentCarry, endCarry, useCarried } from '../../../redux/carry';
import { dropCarriedWindow } from '../../../redux/dropCarried';
import {
  CARRY_NEW_WINDOW_ID,
  carriedRowId,
  carriedView,
  landingView,
} from '../../../utils/functions/carriedView';
import { windowCarryOut } from './carryOut';

export default function TabGroupDetailsContainer() {
  const COLORS = useThemeColors();
  const { t } = useTranslation();
  const dispatch: AppDispatch = useDispatch();

  const tabContainerDataList = useSelector(
    (state: RootState) => state.tabContainerDataState
  );

  const isSearchPanel = useSelector(
    (state: RootState) => state.globalState.isSearchPanel
  );

  const searchInputText = useSelector(
    (state: RootState) => state.globalState.searchInputText
  );

  const hasTabGroupsPermission = useSelector(
    (state: RootState) => state.globalState.hasTabGroupsPermission
  );

  // the same list RightPane derives its mount guard from
  const selectedTabGroup = selectVisibleTabGroups(
    tabContainerDataList.tabGroups,
    isSearchPanel,
    searchInputText,
    hasTabGroupsPermission
  )[0];

  // KAN-350. While something is carried, the session as the carry leaves it:
  // the carried item hidden from its source, so the list closes up behind it
  // -- and, where the session can take it at an exact spot, the item drawn
  // first as a PHANTOM row (landingView): a tab or group inside the New
  // window target, a window as the first window. The list of that kind
  // adopts the phantom as its drag when the pointer comes in.
  //
  // With nothing carried, the selected session itself -- the same object, so
  // the drag areas below see exactly what they always did. Reads only WHAT is
  // carried, which holds still for the whole carry: the pointer moving does
  // not re-render this.
  const carried = useCarried();
  const { shownSession, phantomRowId } = useMemo(() => {
    if (carried === null || selectedTabGroup === undefined) {
      return { shownSession: selectedTabGroup, phantomRowId: undefined };
    }
    const landing = landingView(
      tabContainerDataList.tabGroups,
      selectedTabGroup.tabGroupId,
      carried
    );
    if (landing !== null) {
      return { shownSession: landing, phantomRowId: carriedRowId(carried) };
    }
    return {
      shownSession:
        carriedView(
          tabContainerDataList.tabGroups,
          selectedTabGroup.tabGroupId,
          carried
        ) ?? selectedTabGroup,
      phantomRowId: undefined,
    };
  }, [carried, selectedTabGroup, tabContainerDataList.tabGroups]);
  // Only the list that drags the carried kind adopts it.
  const adoptRowIdFor = (kind: 'tab' | 'group' | 'window') =>
    carried?.kind === kind ? phantomRowId : undefined;

  // The windows on screen, in render order. Index into this is what a drop
  // reports, which is why the guard below matters.
  //
  // Memoized, and ABOVE the early return with the other hooks -- a hook below
  // it would change the hook count between the nothing-selected and selected
  // renders and React would throw on the transition. Both of these feed
  // RowDragArea's effect deps, and a fresh identity re-binds its window
  // listeners -- cheap, but pointless on every render. useTabDrop memoizes the
  // tab list's row ids and callbacks for the same reason.
  //
  // No longer load-bearing for correctness. The re-bind used to clear the drag
  // flag mid-drag, and this memo was the mitigation -- which only held while
  // the session object survived. A sync replaces it, and the flag went anyway
  // (KAN-159). The flag is now cleared on unmount alone.
  //
  // The New window target is not one of them (KAN-350): it is a window only
  // to the tab and item lists, which may land in it, and no window drag may.
  const windowIds = useMemo(
    () =>
      shownSession?.windows
        .map((w) => w.windowId)
        .filter((id) => id !== CARRY_NEW_WINDOW_ID) ?? [],
    [shownSession]
  );

  const movedTabGroupId = selectedTabGroup?.tabGroupId;
  // A CARRIED window (KAN-350) is the phantom this list adopted: it is let
  // go between this session's windows, and the carry ends as committed only
  // if it moved -- see dropCarriedWindow.
  const handleMoveWindow = useCallback(
    (windowId: string, toIndex: number) => {
      if (!movedTabGroupId) return;
      const carriedNow = currentCarry()?.carried;
      if (carriedNow?.kind === 'window') {
        const moved = dispatch(
          dropCarriedWindow(carriedNow, {
            tabGroupId: movedTabGroupId,
            toIndex,
          })
        );
        endCarry(moved ? 'committed' : 'cancelled');
        return;
      }
      dispatch(dropOnTop(windowDrop(movedTabGroupId, windowId, toIndex)));
    },
    [dispatch, movedTabGroupId]
  );

  // KAN-350. Out of the pane sideways, a whole window is carried to another
  // session.
  const carryWindowOut = useCallback(
    (windowId: string) =>
      shownSession === undefined
        ? null
        : windowCarryOut(shownSession, windowId),
    [shownSession]
  );

  // Belt and braces: RightPane does not mount this component when the list is
  // empty, so this should be unreachable -- but it is what makes the component
  // safe on its own terms rather than safe because of its only caller (KAN-39).
  // Must stay below every hook: an early return above one would change the hook
  // count between renders and React would throw on the transition.
  if (!selectedTabGroup || !shownSession) return null;

  const tabGroupId = selectedTabGroup.tabGroupId;

  // KAN-131, one level up from the tab list. A live search narrows windows[]
  // as well as a window's tabs, so a drop index counted over the rendered
  // windows would be applied to a longer stored array. KAN-140 widened the
  // guard from "a query is narrowing something" to "the search panel is open"
  // -- see TabGroupEntryContainer for why.

  async function handleAddCurrTabToWindowClick(
    tabGroupId: string,
    windowId: string
  ) {
    const [tab] = await chrome.tabs.query({
      active: true,
      lastFocusedWindow: true,
    });
    // KAN-299. A Tab Keeper page (the pinned tab view, say) must never be
    // added to a window as if it were a saved tab -- the same silent no-op
    // as an empty window elsewhere in this file.
    if (!tab || isTabKeeperPage(tab)) return;
    // KAN-211. See toStoredTab: the normalising is done in one place so the
    // three ways to save a tab cannot disagree about what a tab is.
    const tabData = toStoredTab(tab);
    dispatch(addCurrTabToWindow({ tabGroupId, windowId, tabData }));
  }

  const handleUpdateWindowGroupTitle = async (
    tabGroupId: string,
    windowId: string,
    editableTitle: string
  ) => {
    dispatch(updateWindowGroupTitle({ tabGroupId, windowId, editableTitle }));
  };

  const containerStyle = css`
    display: flex;
    flex-direction: column;
    flex-grow: 1;
    margin-top: 8px;
    border: 1px solid ${COLORS.BORDER_COLOR};
    overflow: auto;
    user-select: none;
  `;

  const emptyContainerStyle = css`
    display: flex;
    height: 100%;
    justify-content: center;
    align-items: center;
  `;

  const filledContainerStyle = css``;

  return (
    <div css={containerStyle}>
      {isEmptyObject(selectedTabGroup) ? (
        <div css={emptyContainerStyle}>
          {/* KAN-86, same bare literal as TabGroupEntryContainer. */}
          <NormalLabel value={t('Empty')} />
        </div>
      ) : (
        <div css={filledContainerStyle}>
          {/* KAN-132. ONE tab list for the whole session, rather than one per
              window, so that a tab drag can name a row in another window.

              OUTSIDE the windows area, not inside it. The windows area and
              its rows declare no scope, so window rows join it as the
              nearest list; tab rows name scope="tabs" and reach this one
              directly -- there is no per-window items list any more, only
              the ONE items list a few lines below. Both resolve correctly
              with no context factory (spec 5.1). */}
          <TabDragArea tabList={shownSession} adoptRowId={adoptRowIdFor('tab')}>
            {/* KAN-132, one level up from the tab list. ONE items list for the
                whole session -- each loose tab and each Chrome group as one
                row -- rather than one per window.

                INSIDE the tab list and outside the windows area, which is where
                a window's own items list sat relative to both. Item rows name
                scope="items" and tab rows name scope="tabs", so each reaches
                its own list through the other; window rows declare no scope and
                still join the nearest list, the windows area below. */}
            <GroupDragArea
              itemList={shownSession}
              adoptRowId={adoptRowIdFor('group')}
            >
              {/* KAN-129. handleSelector is what keeps this area and the tab list
              around it from both claiming one pointerdown: the
              draggable node below wraps a window's whole block, tabs
              included, so only a press that starts on the window's header
              begins a window drag.

              No resolveDrop: a window belongs to nothing, so unlike a tab its
              drop rule really is just an index. */}
              <RowDragArea
                rowIds={windowIds}
                onMove={handleMoveWindow}
                handleSelector="[data-window-drag-handle]"
                dragKind="window"
                clampDropToEnds
                restoreScrollIfNoDrop
                carryOut={carryWindowOut}
                adoptRowId={adoptRowIdFor('window')}
                // The mode, not the box's contents -- see KAN-140 on
                // TabGroupEntryContainer for why this is not isFilteredView.
                disabled={isSearchPanel}
              >
                {shownSession.windows.map(
                  ({ windowId, title, tabs, chromeTabGroups }) => {
                    const entry = (
                      <WindowEntryContainer
                        title={title}
                        tabs={tabs}
                        chromeTabGroups={chromeTabGroups}
                        tabGroupId={tabGroupId}
                        windowId={windowId}
                        onUpdateWindowGroupTitle={(newTitle) =>
                          handleUpdateWindowGroupTitle(
                            tabGroupId,
                            windowId,
                            newTitle
                          )
                        }
                        onAddCurrTabToWindowClick={() =>
                          handleAddCurrTabToWindowClick(tabGroupId, windowId)
                        }
                        onDeleteClick={() =>
                          dispatch(deleteWindow({ tabGroupId, windowId }))
                        }
                        onWindowTitleClick={() => {
                          const goToURLText: string = t('Go to URL');
                          dispatch(
                            openTabsInAWindow({
                              tabGroupId,
                              windowId,
                              goToURLText,
                            })
                          );
                        }}
                      />
                    );
                    // Keyed by windowId, not by index: WindowEntryContainer owns
                    // collapse and rename state, and an index key is identical to
                    // the positional default React already uses, so it would
                    // leave that state bleeding onto the wrong window after a
                    // deletion.
                    //
                    // This key is also what resets collapse state when the user
                    // switches sessions. Window ids are uuidv4 minted in exactly
                    // two places (capture.ts and HeroContainerRight) and nothing
                    // clones a session, so no id is shared between two tab
                    // groups -- selecting a different one swaps the whole key
                    // set and React remounts every row, which re-runs
                    // useState(true). WindowEntryContainer used to do that reset
                    // with an effect on tabGroupId; it was deleted as redundant
                    // with this key (KAN-51). Weaken this key and that reset
                    // goes with it -- renameDrafts.test.tsx covers it.
                    //
                    // DraggableRow is what carries that key now. It replaces the
                    // plain wrapper div rather than nesting inside one: it renders
                    // exactly one element per window, so the tree keeps its shape.
                    //
                    // KAN-350. The New window target is no row of this list:
                    // nothing drags it, and it drags nothing.
                    return windowId === CARRY_NEW_WINDOW_ID ? (
                      <div key={windowId}>{entry}</div>
                    ) : (
                      <DraggableRow key={windowId} rowId={windowId}>
                        {entry}
                      </DraggableRow>
                    );
                  }
                )}
              </RowDragArea>
            </GroupDragArea>
          </TabDragArea>
        </div>
      )}
    </div>
  );
}
