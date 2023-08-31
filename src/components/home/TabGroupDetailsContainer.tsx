import { css } from '@emotion/react';
import { NormalLabel } from '../common/Label';
import WindowEntryContainer from './WindowEntryContainer';
import { filterTabGroups, isEmptyObject } from '../../utils/helperFunctions';
import { useThemeColors } from '../hook/useThemeColors';
import { useDispatch, useSelector } from 'react-redux';
import { AppDispatch, RootState } from '../../redux/store';
import { v4 as uuidv4 } from 'uuid';
import {
  addCurrTabToWindow,
  deleteWindow,
  openTabsInAWindow,
  tabData,
} from '../../redux/slice/tabContainerDataStateSlice';

export default function TabGroupDetailsContainer() {
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
  let filteredTabGroups = tabContainerDataList.tabGroups.filter(
    (tabGroup) => tabGroup.isSelected
  );
  if (isSearchPanel && searchInputText) {
    filteredTabGroups = filterTabGroups(searchInputText, filteredTabGroups);
  }
  const selectedTabGroup = filteredTabGroups[0];

  const tabGroupId = selectedTabGroup.tabGroupId;

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

  async function handleAddCurrTabToWindowClick(
    tabGroupId: string,
    windowId: string
  ) {
    let [tab] = await chrome.tabs.query({
      active: true,
      lastFocusedWindow: true,
    });
    const tabData: tabData = {
      tabId: uuidv4(),
      favicon: tab.favIconUrl || '',
      title: tab.title || '',
      url: tab.url || '',
    };
    dispatch(addCurrTabToWindow({ tabGroupId, windowId, tabData }));
  }

  return (
    <div css={containerStyle}>
      {isEmptyObject(selectedTabGroup) ? (
        <div css={emptyContainerStyle}>
          <NormalLabel value="Empty" />
        </div>
      ) : (
        <div css={filledContainerStyle}>
          {selectedTabGroup.windows.map(({ windowId, title, tabs }, _) => {
            return (
              <div>
                <WindowEntryContainer
                  title={title}
                  tabs={tabs}
                  tabGroupId={tabGroupId}
                  windowId={windowId}
                  onAddCurrTabToWindowClick={() =>
                    handleAddCurrTabToWindowClick(tabGroupId, windowId)
                  }
                  onDeleteClick={() =>
                    dispatch(deleteWindow({ tabGroupId, windowId }))
                  }
                  onWindowTitleClick={() =>
                    dispatch(openTabsInAWindow({ tabGroupId, windowId }))
                  }
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
