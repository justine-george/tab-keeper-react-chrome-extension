import { useCallback, useEffect, useMemo, useRef } from 'react';

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
  openAllTabContainer,
  requestFocusTabContainer,
  selectTabContainer,
  tabContainerData,
} from '../../../redux/slices/tabContainerDataStateSlice';
import { useTranslation } from 'react-i18next';
import { RowDragArea, DraggableRow } from '../rightpane/rowDrag/RowDragArea';
import { dropOnTop } from '../../../redux/dropOnTop';
import { sessionDrop } from '../../../redux/dropSpecs';
import { peekSavedSession } from '../../../redux/slices/globalStateSlice';
import { selectIsSavedSessionFolded } from '../../../redux/savedSessionFold';
import { isTabView } from '../../../utils/functions/viewMode';
import { TYPE } from '../../../styles/scale';

export default function TabGroupEntryContainer() {
  const COLORS = useThemeColors();
  const { t } = useTranslation();
  const dispatch: AppDispatch = useDispatch();

  // The scrolling element, so KAN-143's effect scopes its lookup to this list
  // rather than searching the whole document.
  const listRef = useRef<HTMLDivElement>(null);

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

  // KAN-280 O5. Whether the tab view has the saved session folded away right
  // now; the selector MainContainer lays the grid out by.
  const isSavedSessionFolded = useSelector(selectIsSavedSessionFolded);

  const selectedTabGroupId = tabContainerDataList.selectedTabGroupId;

  // KAN-131, at the session level and more exposed than the panes below it:
  // search filters sessions directly, so an index counted over the rendered
  // list would be applied to a longer stored one.

  const handleMoveSession = useCallback(
    (tabGroupId: string, toIndex: number) => {
      dispatch(dropOnTop(sessionDrop(tabGroupId, toIndex)));
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

  // KAN-143. Follow the selected session when the list rearranges under it.
  //
  // Editing a session moves it to the top (KAN-141), and the edit is made in
  // the RIGHT pane -- a rename, adding a tab -- so the user is not watching the
  // left pane when it happens. Select a session, scroll the list to look at
  // others, edit it, and the row simply vanishes with nothing to say where it
  // went.
  //
  // IT ONLY REPRODUCES WHILE THE ROW IS OFF SCREEN, and that is worth knowing
  // before you test this. When the row is visible, Chrome's scroll anchoring
  // has already picked it as the anchor and follows it to its new position by
  // itself -- measured, with no script writing scrollTop at all -- so both a
  // fixed and an unfixed build keep it in view and this effect looks like a
  // no-op. Off screen it anchors nothing: measured on an unfixed build, a row
  // 201px above the fold moved to the top and the pane did not budge, leaving
  // it 886px away.
  //
  // KEYED ON WHERE THE SELECTED ROW IS, not on every render. That is what keeps
  // it from fighting the user: scrolling the list by hand changes neither the
  // index nor the id, so a hand-scrolled list is never yanked back. It re-runs
  // on the id too, because the same index can hold a different session -- and
  // that costs nothing, since a row the user just clicked is on screen already.
  //
  // `block: 'nearest'` is what makes that true: it scrolls the minimum needed
  // and does nothing at all when the row is already visible, which is the
  // common case for every re-run except the one this exists for. It is also
  // what keeps this from second-guessing the browser -- in the visible case
  // above, where anchoring has already done the right thing, 'nearest' has
  // nothing left to do.
  //
  // -1 when nothing is selected, which deleting the selected session produces.
  // It is a trigger and nothing else -- the lookup below goes by id, so this is
  // read only as a dependency.
  const selectedIndex =
    selectedTabGroupId === null ? -1 : sessionIds.indexOf(selectedTabGroupId);
  useEffect(() => {
    if (selectedTabGroupId === null) return;
    // Missing whenever the selection is not on screen -- filtered out by a
    // search, or already gone. There is nothing to scroll to, and skipping is
    // the whole handling. An index guard here would be dead code: it can only
    // be out of range in the cases this lookup already misses (verified by
    // mutation -- removing it failed nothing).
    const row = listRef.current?.querySelector<HTMLElement>(
      `[data-drag-row-id="${CSS.escape(selectedTabGroupId)}"]`
    );
    row?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex, selectedTabGroupId]);

  // The session list's frame, one declaration for both views, so the popup's
  // list and the tab view's list box cannot drift apart (KAN-280 O3a).
  const listFrameStyle = css`
    border: 1px solid ${COLORS.BORDER_COLOR};
    margin: 8px 0;
    user-select: none;
  `;

  // The popup's list: the frame and the scroller in one element.
  const popupListStyle = css`
    display: flex;
    flex-direction: column;
    height: 100%;
    ${listFrameStyle}
    overflow: auto;
  `;

  // KAN-280 O3a. In the tab view the list box is two parts: the caption, then
  // the scroller. The box keeps the frame and height the popup's list has,
  // so the scroller gives up the caption's height and the box does not grow.
  // min-height: 0 lets it shrink in LeftPane's column as the lone scroller
  // did (a scroll container's automatic minimum is 0; this box is not one).
  const tabListBoxStyle = css`
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    ${listFrameStyle}
  `;

  const tabScrollerStyle = css`
    display: flex;
    flex-direction: column;
    flex: 1 1 0;
    min-height: 0;
    overflow: auto;
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

  const isTab = isTabView();

  const scroller = (
    <div css={isTab ? tabScrollerStyle : popupListStyle} ref={listRef}>
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
            dragKind="session"
            clampDropToEnds
            disabled={isSearchPanel}
          >
            {filteredTabGroups.map((tabGroupData, index) => {
              return (
                // tabGroupId, not index: this list is filtered by search and
                // reordered by save, so positions are not stable identities.
                <DraggableRow
                  key={tabGroupData.tabGroupId}
                  rowId={tabGroupData.tabGroupId}
                >
                  <TabGroupEntry
                    tabGroupData={tabGroupData}
                    onTabGroupClick={() => {
                      // KAN-280 O5. Folded, a click shows the session for
                      // now; the selected row included, since it is the
                      // natural one to click to see it. Only while folded: a
                      // peek left set side by side would keep this page open
                      // through a later fold from another page's settings.
                      if (isTab && isSavedSessionFolded) {
                        dispatch(peekSavedSession());
                      }
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

  // The popup has no Open now, so it has no caption either: its list is the
  // scroller alone, as it always was.
  if (!isTab) return scroller;

  // KAN-280 O3/O3a. Beside Open now, the list says which sessions these are.
  // Pinned by sitting OUTSIDE the scroller, not by position: sticky inside
  // it: the drag engine measures the scroller as all rows and auto-scrolls
  // from its edges, and a caption laid over the top rows would put hidden
  // rows under the pointer.
  return (
    <div css={tabListBoxStyle}>
      <div
        data-caption="saved-sessions"
        css={css`
          flex-shrink: 0;
        `}
      >
        <NormalLabel
          value={t('Saved sessions')}
          size={TYPE.META}
          color={COLORS.LABEL_L2_COLOR}
          style="padding: 8px 8px 4px 8px;"
        />
      </div>
      {scroller}
    </div>
  );
}
