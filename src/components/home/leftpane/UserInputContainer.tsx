import { useEffect, useState } from 'react';

import { useDispatch, useSelector } from 'react-redux';

import { css } from '@emotion/react';

import Button from '../../common/Button';
import TextBox from '../../common/TextBox';
import { AppDispatch, RootState } from '../../../redux/store';
import { setSearchInputText } from '../../../redux/slices/globalStateSlice';
import {
  captureOpenWindows,
  type CaptureScope,
} from '../../../utils/functions/capture';
import { saveToTabContainer } from '../../../redux/slices/tabContainerDataStateSlice';
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

  // The scope is the button's word, not a stored preference (KAN-5). Focus
  // mode saves through this same captureOpenWindows before closing every
  // window, so nothing it does not pass itself may reach that path.
  async function createTabGroup(scope: CaptureScope) {
    const containerData = await captureOpenWindows(
      newTitle || currentTabName,
      scope
    );
    if (!containerData) return;

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
        style="padding: 12px; flex-shrink: 0;"
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
        onKeyEnter={() => createTabGroup('all-windows')}
        style="margin-right: 8px;"
      />
      {/* Left of the save-all button, which keeps its place: this is a second
          way to save, not a replacement for the one already in muscle memory.
          Its tooltip cannot be "Save current window" -- the en locale already
          renders that for HeroContainerRight's "Add current window", which
          adds a window to the session already selected rather than saving a
          new one. */}
      <Button
        tooltipText={t('Save current window as a session')}
        ariaLabel="save current window"
        iconType="web_asset"
        onClick={() => createTabGroup('current-window')}
        style="padding: 12px; flex-shrink: 0; margin-right: 8px;"
        focusableButton={true}
      />
      <Button
        tooltipText={t('Save all windows')}
        ariaLabel="save session"
        iconType="add"
        onClick={() => createTabGroup('all-windows')}
        style="padding: 12px; flex-shrink: 0;"
        focusableButton={true}
      />
    </div>
  );
}
