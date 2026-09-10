import { useCallback, useEffect, useMemo } from 'react';

import { useDispatch, useSelector } from 'react-redux';

import { css } from '@emotion/react';

import Divider from '../../common/Divider';
import TabGroupEntry from './TabGroupEntry';
import { NormalLabel } from '../../common/Label';
import { useThemeColors } from '../../../hooks/useThemeColors';
import { AppDispatch, RootState } from '../../../redux/store';
import {
  filterTabGroups,
  isSearchActive,
} from '../../../utils/functions/local';
import {
  deleteTabContainer,
  moveSessionInternal,
  openAllTabContainer,
  requestFocusTabContainer,
  selectTabContainer,
  tabContainerData,
} from '../../../redux/slices/tabContainerDataStateSlice';
import { useTranslation } from 'react-i18next';
import { RowDragArea, DraggableRow } from '../rightpane/rowDrag/RowDragArea';

export default function TabGroupEntryContainer() {
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

  const selectedTabGroupId = tabContainerDataList.selectedTabGroupId;

  // KAN-131, at the session level and more exposed than the panes below it:
  // search filters sessions directly, so an index counted over the rendered
  // list would be applied to a longer stored one.

  const handleMoveSession = useCallback(
    (tabGroupId: string, toIndex: number) => {
      dispatch(moveSessionInternal({ tabGroupId, toIndex }));
    },
    [dispatch]
  );

  // filter the tab group list
  let filteredTabGroups: tabContainerData[] = tabContainerDataList.tabGroups;
  if (isSearchActive(isSearchPanel, searchInputText)) {
    filteredTabGroups = filterTabGroups(
      searchInputText,
      filteredTabGroups,
      hasTabGroupsPermission
    );
  }

  // In render order, which is what a drop's index counts against.
  const sessionIds = useMemo(
    () => filteredTabGroups.map((g) => g.tabGroupId),
    [filteredTabGroups]
  );

  // Select the first match as the query narrows -- but only while a search is
  // actually running.
  //
  // KAN-90. This used to key on `searchInputText` alone, which made the two
  // ways out of search disagree. Clearing the box changes the text, so the
  // effect re-ran; by then `isSearchActive` was false, so `filteredTabGroups`
  // was the WHOLE list and [0] was simply the newest session. Pressing "Back"
  // leaves the text alone, so the effect never fired and the match survived.
  // From one starting point that gave BETA one way and ALPHA the other, and
  // BETA was neither the session selected before the search nor the one
  // searched for.
  //
  // "Back" was already the shipped answer to what leaving a search should do,
  // so clearing is made to agree with it rather than inventing a third
  // behaviour. Restoring the pre-search selection instead would need somewhere
  // to remember it -- new state for a case the app already has an answer to.
  //
  // The second guard keeps the selection when it still matches, so typing more
  // of a query no longer walks the user back to the top of the results on
  // every keystroke.
  useEffect(() => {
    if (!isSearchActive(isSearchPanel, searchInputText)) return;
    if (filteredTabGroups.length === 0) return;
    if (filteredTabGroups.some((g) => g.tabGroupId === selectedTabGroupId)) {
      return;
    }
    dispatch(selectTabContainer(filteredTabGroups[0].tabGroupId));
  }, [searchInputText, isSearchPanel]);

  const containerStyle = css`
    display: flex;
    flex-direction: column;
    height: 100%;
    border: 1px solid ${COLORS.BORDER_COLOR};
    margin: 8px 0;
    overflow: auto;
    user-select: none;
  `;

  const emptyContainerStyle = css`
    display: flex;
    height: 100%;
    justify-content: center;
    align-items: center;
  `;

  const filledContainerStyle = css`
    display: flex;
    flex-direction: column;
  `;

  return (
    <div css={containerStyle}>
      {filteredTabGroups.length === 0 ? (
        <div css={emptyContainerStyle}>
          {/* KAN-86. Was the bare literal "Empty", which rendered in English
              in all nine non-English locales while every string around it
              was translated. */}
          <NormalLabel value={t('Empty')} />
        </div>
      ) : (
        <div css={filledContainerStyle}>
          {/* KAN-130. No handleSelector -- a session row contains no nested
              drag area, so the whole row is the handle. No resolveDrop -- a
              session belongs to nothing. */}
          {/* Guarded on the MODE, not on whether the box currently holds
              text (KAN-140). `isFilteredView` would leave dragging live while
              the panel is open and empty, then silently kill it on the first
              keystroke -- the same gesture on the same rows, decided by a
              transient value, with rows rendering `cursor: pointer` either way
              so nothing tells the user which state they are in.

              KAN-131 argued the other way and was right about safety: an empty
              box filters nothing, so the rendered list IS the stored one and
              the index cannot cross between two arrays. It was wrong about
              what the guard is for. Search is a mode entered to FIND
              something, and a value guard also makes the safety property
              depend on the ordering of a keystroke against a pointer gesture,
              which a mode guard removes entirely. */}
          <RowDragArea
            rowIds={sessionIds}
            onMove={handleMoveSession}
            disabled={isSearchPanel}
          >
            {filteredTabGroups.map((tabGroupData, index) => {
              return (
                // tabGroupId, not index: this list is filtered by search and
                // reordered by save, so positions are not stable identities.
                <DraggableRow
                  key={tabGroupData.tabGroupId}
                  rowId={tabGroupData.tabGroupId}
                  index={index}
                >
                  <TabGroupEntry
                    tabGroupData={tabGroupData}
                    onTabGroupClick={() => {
                      if (selectedTabGroupId === tabGroupData.tabGroupId) {
                        return;
                      }
                      dispatch(selectTabContainer(tabGroupData.tabGroupId));
                    }}
                    onOpenAllClick={() => {
                      const goToURLText: string = t('Go to URL');
                      dispatch(
                        openAllTabContainer({
                          tabGroupId: tabGroupData.tabGroupId,
                          goToURLText,
                        })
                      );
                    }}
                    onFocusClick={() => {
                      dispatch(
                        requestFocusTabContainer({
                          tabGroupId: tabGroupData.tabGroupId,
                          goToURLText: t('Go to URL'),
                          saveTitle: t('FocusAutoSaveTitle'),
                        })
                      );
                    }}
                    onDeleteClick={() =>
                      dispatch(deleteTabContainer(tabGroupData.tabGroupId))
                    }
                  />
                  {/* <Divider /> */}
                  {index != filteredTabGroups.length - 1 && <Divider />}
                </DraggableRow>
              );
            })}
          </RowDragArea>
        </div>
      )}
    </div>
  );
}
