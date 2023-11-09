import { useEffect } from 'react';

import { useDispatch, useSelector } from 'react-redux';

import { css } from '@emotion/react';

import Divider from '../../common/Divider';
import TabGroupEntry from './TabGroupEntry';
import { NormalLabel } from '../../common/Label';
import { useThemeColors } from '../../../hooks/useThemeColors';
import { AppDispatch, RootState } from '../../../redux/store';
import { filterTabGroups } from '../../../utils/functions/local';
import {
  deleteTabContainer,
  openAllTabContainer,
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

  let filteredTabGroups: tabContainerData[] =
    isSearchPanel && searchInputText
      ? filterTabGroups(searchInputText, tabContainerDataList.tabGroups)
      : tabContainerDataList.tabGroups;

  let selectedTabGroupId: string | undefined = filteredTabGroups.find(
    (tabGroup) => tabGroup.isSelected
  )?.tabGroupId;

  useEffect(() => {
    if (selectedTabGroupId) {
      dispatch(selectTabContainer(selectedTabGroupId));
    }
  }, [selectedTabGroupId, dispatch]);

  useEffect(() => {
    if (!selectedTabGroupId && filteredTabGroups.length > 0) {
      dispatch(selectTabContainer(filteredTabGroups[0].tabGroupId));
    }
  }, [searchInputText, filteredTabGroups, dispatch]);

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
          <NormalLabel value="Empty" />
        </div>
      ) : (
        <div css={filledContainerStyle}>
          {filteredTabGroups.map((tabGroupData, index) => {
            return (
              <div>
                <TabGroupEntry
                  tabGroupData={tabGroupData}
                  onTabGroupClick={() => {
                    if (tabGroupData.tabGroupId !== selectedTabGroupId) {
                      dispatch(selectTabContainer(tabGroupData.tabGroupId));
                    }
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
