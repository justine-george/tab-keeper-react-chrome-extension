import { v4 as uuidv4 } from 'uuid';
import { useDispatch, useSelector } from 'react-redux';

import { css } from '@emotion/react';

import { NormalLabel } from '../common/Label';
import { useThemeColors } from '../hook/useThemeColors';
import WindowEntryContainer from './WindowEntryContainer';
import { AppDispatch, RootState } from '../../redux/store';
import {
  decodeDataUrl,
  filterTabGroups,
  isEmptyObject,
} from '../../utils/helperFunctions';
import {
  addCurrTabToWindow,
  deleteWindow,
  openTabsInAWindow,
  tabData,
  updateWindowGroupTitle,
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
      url: decodeDataUrl(tab.url || ''),
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
                  onUpdateWindowGroupTitle={(newTitle) =>
                    handleUpdateWindowGroupTitle(tabGroupId, windowId, newTitle)
                  }
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
