import { useEffect, useState } from 'react';

import { v4 as uuidv4 } from 'uuid';
import { useDispatch, useSelector } from 'react-redux';

import { css } from '@emotion/react';

import Button from '../../common/Button';
import TextBox from '../../common/TextBox';
import { AppDispatch, RootState } from '../../../redux/store';
import { setSearchInputText } from '../../../redux/slices/globalStateSlice';
import { decodeDataUrl, getStringDate } from '../../../utils/functions/local';
import {
  saveToTabContainer,
  tabContainerData,
  windowGroupData,
} from '../../../redux/slices/tabContainerDataStateSlice';
import { useTranslation } from 'react-i18next';

export default function UserInputContainer() {
  const { t } = useTranslation();
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
    // fetch all the windows
    const allWindows = await new Promise<chrome.windows.Window[]>((resolve) =>
      chrome.windows.getAll({ populate: true }, (result) => resolve(result))
    );

    // fetch current window
    const currentWindow = await new Promise<chrome.windows.Window>((resolve) =>
      chrome.windows.getCurrent({ populate: true }, (result) => resolve(result))
    );

    // filter out current window
    let windowList = allWindows.filter(
      (window) => window.id !== currentWindow.id
    );

    // add current window to the beginning
    windowList.unshift(currentWindow);

    let tabCount = 0;

    const windowsGroupData: windowGroupData[] = windowList.map((window) => {
      // for each window, map its tabs
      const tabsData = window.tabs!.map((tab) => {
        return {
          tabId: uuidv4(),
          favicon: tab.favIconUrl || '',
          title: tab.title || '',
          url: decodeDataUrl(tab.url || ''),
        };
      });

      tabCount += tabsData.length;

      return {
        windowId: uuidv4(),
        windowHeight: window.height!,
        windowWidth: window.width!,
        windowOffsetTop: window.top!,
        windowOffsetLeft: window.left!,
        tabCount: tabsData.length,
        title: tabsData[0].title,
        tabs: tabsData,
      };
    });

    const containerData: tabContainerData = {
      tabGroupId: uuidv4(),
      title: newTitle || currentTabName,
      createdTime: getStringDate(new Date()),
      windowCount: windowList.length,
      tabCount: tabCount,
      isAutoSave: false,
      isSelected: true,
      windows: windowsGroupData,
    };

    dispatch(saveToTabContainer(containerData));
  }

  const containerStyle = css`
    display: flex;
    justify-content: space-between;
    align-items: center;
  `;

  return isSearchPanel ? (
    <div css={containerStyle}>
      <TextBox
        id="searchInput"
        name="searchInput"
        value={searchInput}
        placeholder={t('Search among sessions')}
        autoComplete="off"
        onChange={handleSearchInputChange}
        onKeyEnter={filterResults}
        style="margin-right: 8px;"
      />
      {/* <Button text="Search" onClick={createTabGroup} /> */}
      <Button
        tooltipText={t('Search')}
        iconType="search"
        ariaLabel="search"
        onClick={filterResults}
        style="padding: 12px;"
        focusableButton={true}
      />
    </div>
  ) : (
    <div css={containerStyle}>
      <TextBox
        id="name"
        name="name"
        value={newTitle}
        placeholder={t('Save all open windows as a session')}
        autoComplete="off"
        onChange={updateUserInput}
        onKeyEnter={createTabGroup}
        style="margin-right: 8px;"
      />
      {/* <Button text="Save" onClick={createTabGroup} /> */}
      <Button
        tooltipText={t('Save all windows')}
        ariaLabel="save session"
        iconType="add"
        onClick={createTabGroup}
        style="padding: 12px;"
        focusableButton={true}
      />
    </div>
  );
}
