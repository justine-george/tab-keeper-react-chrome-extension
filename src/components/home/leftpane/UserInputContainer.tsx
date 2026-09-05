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
import { normalizeTitle } from '../../../utils/functions/local';
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
        // Translated, so this agrees with createTabGroup's last-resort
        // fallback below (KAN-84). Leaving one of the two as a bare literal
        // would show a German user "New Tab Group" prefilled while storing the
        // translated name, or the reverse, depending on which path ran.
        setCurrentTabName(t('New Tab Group'));
        setNewTitle(t('New Tab Group'));
      }
    });
    // `t` is deliberately not a dependency. This effect exists to seed the
    // name box ONCE, on mount; re-running it would overwrite whatever the user
    // has since typed. Nothing is lost by omitting it either -- the language
    // can only be changed from the settings page, which unmounts this
    // component, so the next mount already picks up the new language.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    // KAN-84. This was `newTitle || currentTabName`, which already intended a
    // fallback but only caught the empty string -- a whitespace-only name is
    // truthy, so it passed straight through and produced a session with no
    // visible name and no accessible name on its row.
    //
    // A fallback rather than a refusal, unlike the rename path: there is no
    // prior title here to keep, so refusing would leave the user with no
    // session at all for a keystroke they may not have noticed. The last
    // resort is translated, because it is a name the user will see and can
    // rename.
    const title =
      normalizeTitle(newTitle) ||
      normalizeTitle(currentTabName) ||
      t('New Tab Group');

    const containerData = await captureOpenWindows(title, scope);
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
        ariaLabel={t('Search')}
        onClick={filterResults}
        style="padding: 12px; flex-shrink: 0;"
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
      {/* The two tooltips are a parallel pair, differing only where the
          actions differ -- "all open windows" against "current window". They
          used to read "Save current session" and "Save current window as a
          session": both opened with "Save current", and the all-windows one
          never said "all windows" in any of the ten locales.

          It has its own key rather than borrowing the placeholder's, even
          though both describe the same operation. The placeholder is squeezed
          into a 231px field and several locales shortened it to fit -- German
          drops "alle" and French drops "toutes", which is the very word that
          has to survive here. A tooltip has no width limit, so the two want
          different strings and get different keys.

          One bordered group rather than two free-standing buttons: these are
          two variants of a single action, and reading as a pair is the point.
          Inside it size does the ranking -- save-all keeps the wide segment
          and its place at the right, where the only save button used to be;
          save-current-window is the narrow one.

          Both segments carry a "+" because both are saves, and the stack
          behind the primary is what says "all of them". add_box and
          library_add are the same mark in Material's set -- library_add is
          add_box with a second layer behind it -- so the only thing that
          differs is the count, which is exactly the only thing that differs
          about the two actions.

          An earlier pair (add_to_queue + library_add) failed here: two plus-
          bearing glyphs that were too alike to tell apart. Measured as pixel
          overlap at equal size, that pair is 52% distinct; this one is 75%.
          For reference a plain window glyph against a bare "+" is 97%, so
          putting a + on both does cost separation -- it buys back the fact
          that both buttons now read as saves. Re-measure before swapping
          either glyph; 52% is what "twins" looks like as a number.

          The divider is load-bearing -- without it the two icons float in one
          box and stop looking separately clickable. Recessing the secondary
          instead would be wrong here: a muted fill is how this UI says
          "disabled" (there is no disabled attribute anywhere).

          Labels would beat icons outright and do not fit: the row is 339px and
          the German pair alone needs 318px, leaving 21px for the name box. */}
      <div css={saveGroupStyle}>
        <Button
          tooltipText={t('Save current window as a session')}
          ariaLabel={t('Save current window as a session')}
          iconType="add_box"
          iconSize="20px"
          onClick={() => createTabGroup('current-window')}
          style={`width: 40px; height: 100%; padding: 0; flex-shrink: 0;
                  border: none; border-right: 1px solid ${COLORS.BORDER_COLOR};`}
        />
        <Button
          tooltipText={t('Save every open window as a session')}
          ariaLabel={t('Save every open window as a session')}
          iconType="library_add"
          onClick={() => createTabGroup('all-windows')}
          style="width: 58px; height: 100%; padding: 0; flex-shrink: 0; border: none;"
        />
      </div>
    </div>
  );
}
