import { css } from '@emotion/react';
import TabGroupEntry from './TabGroupEntry';
import Divider from '../common/Divider';
import { NormalLabel } from '../common/Label';
import { useThemeColors } from '../hook/useThemeColors';
import { useDispatch, useSelector } from 'react-redux';
import { AppDispatch, RootState } from '../../redux/store';
import {
  deleteTabContainer,
  openAllTabContainer,
  selectTabContainer,
  tabContainerData,
} from '../../redux/slice/tabContainerDataStateSlice';

export default function TabGroupEntryContainer() {
  const COLORS = useThemeColors();
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

  // filter the tab group list
  let filteredTabGroups: tabContainerData[] = tabContainerDataList.tabGroups;
  if (isSearchPanel && searchInputText) {
    const loweredSearchText = searchInputText.toLowerCase();

    filteredTabGroups = filteredTabGroups.filter((tabGroup) => {
      if (tabGroup.title.toLowerCase().includes(loweredSearchText)) {
        return true;
      }

      return tabGroup.windows.some(
        (window) =>
          window.title.toLowerCase().includes(loweredSearchText) ||
          window.tabs.some((tab) =>
            tab.title.toLowerCase().includes(loweredSearchText)
          )
      );
    });

    if (filteredTabGroups.length !== 0) {
      dispatch(selectTabContainer(filteredTabGroups[0].tabGroupId));
    }
  }

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
              <div
              // key={tabGroupData.tabGroupId}
              >
                <TabGroupEntry
                  tabGroupData={tabGroupData}
                  onTabGroupClick={() =>
                    dispatch(selectTabContainer(tabGroupData.tabGroupId))
                  }
                  onOpenAllClick={() =>
                    dispatch(openAllTabContainer(tabGroupData.tabGroupId))
                  }
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
