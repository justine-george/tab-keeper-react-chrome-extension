import { css } from '@emotion/react';
import Button from '../common/Button';
import TextBox from '../common/TextBox';
import { useDispatch, useSelector } from 'react-redux';
import { useEffect, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import {
  saveToTabContainer,
  tabContainerData,
  windowGroupData,
} from '../../redux/slice/tabContainerDataStateSlice';
import { AppDispatch, RootState } from '../../redux/store';
import { setSearchInputText } from '../../redux/slice/globalStateSlice';
import { getStringDate } from '../../utils/helperFunctions';

export default function UserInputContainer() {
  const dispatch: AppDispatch = useDispatch();

  const [newTitle, setNewTitle] = useState<string>('');
  const [currentTabName, setCurrentTabName] = useState<string>('');
  const [searchInput, setSearchInput] = useState<string>('');

  const isSearchPanel = useSelector(
    (state: RootState) => state.globalState.isSearchPanel
  );

  useEffect(() => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const currentTab = tabs[0];
      if (currentTab && currentTab.title) {
        setCurrentTabName(currentTab.title);
        setNewTitle(currentTab.title);
      } else {
        setCurrentTabName('New Tab Group');
        setNewTitle('New Tab Group');
      }
    });
  }, []);

  const containerStyle = css`
    display: flex;
    justify-content: space-between;
    align-items: center;
  `;

  function updateUserInput(e: React.ChangeEvent<HTMLInputElement>) {
    setNewTitle(e.target.value);
  }

  function handleSearchInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    setSearchInput(e.target.value);
    dispatch(setSearchInputText(e.target.value));
  }

  function filterResults() {
    // dispatch(setSearchInputText(searchInput));
  }

  async function createTabGroup() {
    let tabCount = 0;

    // Fetch all the windows.
    const windows = await new Promise<chrome.windows.Window[]>((resolve) =>
      chrome.windows.getAll({ populate: true }, (result) => resolve(result))
    );

    const windowsGroupData: windowGroupData[] = windows.map((window) => {
      // For each window, map its tabs.
      const tabsData = window.tabs!.map((tab) => {
        return {
          tabId: uuidv4(),
          favicon: tab.favIconUrl || '',
          title: tab.title || '',
          url: tab.url || '',
        };
      });

      tabCount += tabsData.length;

      return {
        windowId: uuidv4(),
        tabCount: tabsData.length,
        title: tabsData[0].title,
        tabs: tabsData,
      };
    });

    const containerData: tabContainerData = {
      tabGroupId: uuidv4(),
      title: newTitle || currentTabName,
      createdTime: getStringDate(new Date()),
      windowCount: windows.length,
      tabCount: tabCount,
      isAutoSave: false,
      isSelected: true,
      windows: windowsGroupData,
    };

    dispatch(saveToTabContainer(containerData));
  }

  return isSearchPanel ? (
    <div css={containerStyle}>
      <TextBox
        id="searchInput"
        name="searchInput"
        value={searchInput}
        placeholder="Search tab groups"
        autoComplete="off"
        onChange={handleSearchInputChange}
        onKeyEnter={filterResults}
        style="margin-right: 8px;"
      />
      {/* <Button text="Search" onClick={createTabGroup} /> */}
      <Button
        tooltipText="Search"
        iconType="search"
        ariaLabel="search"
        onClick={filterResults}
        style="padding: 12px;"
      />
    </div>
  ) : (
    <div css={containerStyle}>
      <TextBox
        id="name"
        name="name"
        value={newTitle}
        placeholder="Save all open windows as a tab group"
        autoComplete="off"
        onChange={updateUserInput}
        onKeyEnter={createTabGroup}
        style="margin-right: 8px;"
      />
      {/* <Button text="Save" onClick={createTabGroup} /> */}
      <Button
        tooltipText="Save all windows"
        ariaLabel="add"
        iconType="add"
        onClick={createTabGroup}
        style="padding: 12px;"
      />
    </div>
  );
}
