import { useEffect } from 'react';

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

  const selectedTabGroupId = tabContainerDataList.selectedTabGroupId;

  // filter the tab group list
  let filteredTabGroups: tabContainerData[] = tabContainerDataList.tabGroups;
  if (isSearchActive(isSearchPanel, searchInputText)) {
    filteredTabGroups = filterTabGroups(searchInputText, filteredTabGroups);
  }

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
          {filteredTabGroups.map((tabGroupData, index) => {
            return (
              // tabGroupId, not index: this list is filtered by search and
              // reordered by save, so positions are not stable identities.
              <div key={tabGroupData.tabGroupId}>
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
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
