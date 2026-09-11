import { useCallback, useMemo } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { useDispatch, useSelector } from 'react-redux';

import { css } from '@emotion/react';

import { NormalLabel } from '../../common/Label';
import { useThemeColors } from '../../../hooks/useThemeColors';
import WindowEntryContainer from './WindowEntryContainer';
import { AppDispatch, RootState } from '../../../redux/store';
import {
  resolveTabUrl,
  isEmptyObject,
  selectVisibleTabGroups,
} from '../../../utils/functions/local';
import {
  addCurrTabToWindow,
  deleteWindow,
  moveWindowInternal,
  openTabsInAWindow,
  tabData,
  updateWindowGroupTitle,
} from '../../../redux/slices/tabContainerDataStateSlice';
import { useTranslation } from 'react-i18next';
import { RowDragArea, DraggableRow } from './rowDrag/RowDragArea';

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

  // The windows on screen, in render order. Index into this is what a drop
  // reports, which is why the guard below matters.
  //
  // Memoized, and ABOVE the early return with the other hooks -- a hook below
  // it would change the hook count between the nothing-selected and selected
  // renders and React would throw on the transition. Both of these feed
  // RowDragArea's effect deps, and a fresh identity every render re-binds its
  // window listeners; the cleanup that runs on each re-bind clears the
  // `grabbing` cursor, so an unmemoized value drops the drag cursor whenever
  // anything else re-renders this pane mid-drag. WindowEntryContainer
  // memoizes its own tabIds and handleMove for the same reason.
  const windowIds = useMemo(
    () => selectedTabGroup?.windows.map((w) => w.windowId) ?? [],
    [selectedTabGroup]
  );

  const movedTabGroupId = selectedTabGroup?.tabGroupId;
  const handleMoveWindow = useCallback(
    (windowId: string, toIndex: number) => {
      if (!movedTabGroupId) return;
      dispatch(
        moveWindowInternal({ tabGroupId: movedTabGroupId, windowId, toIndex })
      );
    },
    [dispatch, movedTabGroupId]
  );

  // Belt and braces: RightPane does not mount this component when the list is
  // empty, so this should be unreachable -- but it is what makes the component
  // safe on its own terms rather than safe because of its only caller (KAN-39).
  // Must stay below every hook: an early return above one would change the hook
  // count between renders and React would throw on the transition.
  if (!selectedTabGroup) return null;

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
    const tabData: tabData = {
      tabId: uuidv4(),
      favicon: tab.favIconUrl || '',
      title: tab.title || '',
      url: resolveTabUrl(tab.url || ''),
    };
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
          {/* KAN-129. handleSelector is what keeps this area and the tab area
              inside each window from both claiming one pointerdown: the
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
            // The mode, not the box's contents -- see KAN-140 on
            // TabGroupEntryContainer for why this is not isFilteredView.
            disabled={isSearchPanel}
          >
            {selectedTabGroup.windows.map(
              ({ windowId, title, tabs, chromeTabGroups }, windowIndex) => {
                return (
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
                  <DraggableRow
                    key={windowId}
                    rowId={windowId}
                    index={windowIndex}
                  >
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
                  </DraggableRow>
                );
              }
            )}
          </RowDragArea>
        </div>
      )}
    </div>
  );
}
