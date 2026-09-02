import { useEffect, useState } from 'react';

import { useDispatch, useSelector } from 'react-redux';

import { css } from '@emotion/react';

import Button from '../../common/Button';
import TextBox from '../../common/TextBox';
import { useThemeColors } from '../../../hooks/useThemeColors';
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
  const COLORS = useThemeColors();
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

    dispatch(saveToTabContainer({ container: containerData, scope }));
  }

  const containerStyle = css`
    display: flex;
    justify-content: space-between;
    align-items: center;
  `;

  // The two save buttons share one border and one height, so they read as a
  // pair. 3.5rem matches TextBox, and box-sizing is border-box globally
  // (App.css), so the group's own border sits inside that height and the row
  // stays flush -- the segments take 100% of what is left.
  const saveGroupStyle = css`
    display: flex;
    flex-shrink: 0;
    height: 3.5rem;
    border: 1px solid ${COLORS.BORDER_COLOR};
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
      {/* One bordered group rather than two free-standing buttons: these are
          two variants of a single action, and reading as a pair is the point.
          Inside it size does the ranking -- save-all keeps the wide segment
          and the "+" already in muscle memory, save-current-window is narrow.

          Both carrying a "+" is what made them confusable before: it turned
          the + into shared vocabulary instead of distinguishing vocabulary,
          leaving two near-identical glyphs. Only the primary carries it now.
          The secondary is the plain window glyph this app already uses for a
          window group (WindowEntryContainer).

          The divider is load-bearing -- without it the two icons float in one
          box and stop looking separately clickable. Recessing the secondary
          instead would be wrong here: a muted fill is how this UI says
          "disabled" (there is no disabled attribute anywhere).

          Labels would beat icons outright and do not fit: the row is 339px and
          the German pair alone needs 318px, leaving 21px for the name box. */}
      <div css={saveGroupStyle}>
        <Button
          tooltipText={t('Save current window as a session')}
          ariaLabel="save current window"
          iconType="web_asset"
          iconSize="20px"
          onClick={() => createTabGroup('current-window')}
          style={`width: 40px; height: 100%; padding: 0; flex-shrink: 0;
                  border: none; border-right: 1px solid ${COLORS.BORDER_COLOR};`}
          focusableButton={true}
        />
        <Button
          tooltipText={t('Save all windows')}
          ariaLabel="save session"
          iconType="add"
          onClick={() => createTabGroup('all-windows')}
          style="width: 58px; height: 100%; padding: 0; flex-shrink: 0; border: none;"
          focusableButton={true}
        />
      </div>
    </div>
  );
}
