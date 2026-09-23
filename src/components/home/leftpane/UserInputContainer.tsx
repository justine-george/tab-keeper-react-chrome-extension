import { useEffect, useState } from 'react';

import { useDispatch, useSelector } from 'react-redux';

import { css } from '@emotion/react';

import Button from '../../common/Button';
import OverflowMenu from '../../common/OverflowMenu';
import TextBox from '../../common/TextBox';
import { useThemeColors } from '../../../hooks/useThemeColors';
import { AppDispatch, RootState } from '../../../redux/store';
import { setSearchInputText } from '../../../redux/slices/globalStateSlice';
import {
  captureOpenWindows,
  type CaptureScope,
} from '../../../utils/functions/capture';
import { dropNotificationCount } from '../../../utils/functions/sessionExportHtml';
import { saveToTabContainer } from '../../../redux/slices/tabContainerDataStateSlice';
import { normalizeTitle } from '../../../utils/functions/local';
import {
  isTabView,
  ownTabId,
  pickNameSourceTab,
} from '../../../utils/functions/viewMode';
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
    // Guards both branches below against setting state after this component
    // has unmounted -- ownTabId() and the tab-view query each cross an await,
    // and a popup that closes mid-query must not resume into a dead component.
    let cancelled = false;

    // KAN-211/KAN-279 D15. The name box is a SUGGESTION, so it is cleaned like
    // any other derived title -- offering "(3) Gmail" as a session name
    // proposes storing a badge that is stale the moment it is saved. What the
    // user then types is theirs and is never touched.
    function applySuggestion(title: string | undefined) {
      if (cancelled) return;
      if (title) {
        const suggested = dropNotificationCount(title);
        setCurrentTabName(suggested);
        setNewTitle(suggested);
      } else {
        // Translated, so this agrees with createTabGroup's last-resort
        // fallback below (KAN-84). Leaving one of the two as a bare literal
        // would show a German user "New Tab Group" prefilled while storing the
        // translated name, or the reverse, depending on which path ran.
        setCurrentTabName(t('New Tab Group'));
        setNewTitle(t('New Tab Group'));
      }
    }

    async function loadSuggestion() {
      if (isTabView()) {
        // In the tab, the active tab IS Tab Keeper, so the suggestion comes
        // from the most recently used OTHER tab in this window instead (D15).
        const ownId = await ownTabId();
        const tabsOfWindow = await new Promise<chrome.tabs.Tab[]>((resolve) =>
          chrome.tabs.query({ currentWindow: true }, (tabs) => resolve(tabs))
        );
        applySuggestion(pickNameSourceTab(tabsOfWindow, ownId)?.title);
      } else {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          applySuggestion(tabs[0]?.title);
        });
      }
    }

    loadSuggestion();

    return () => {
      cancelled = true;
    };
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

    // KAN-279 D6. In the tab, "the current window" includes Tab Keeper's own
    // page -- captured by id, not cached from render, so this can never save
    // against a stale or undefined own id (ownTabId() is undefined in the
    // popup, where this is a no-op -- see captureOpenWindows's own guard).
    const containerData = await captureOpenWindows(title, scope, {
      excludeTabId: await ownTabId(),
    });
    if (!containerData) return;

    dispatch(saveToTabContainer({ container: containerData, scope }));
  }

  const containerStyle = css`
    display: flex;
    justify-content: space-between;
    align-items: center;
  `;

  /**
   * An ALIGNMENT, not a control size -- which is why it is here and not in the
   * scale, and why it is not a multiple of anything.
   *
   * The left column stacks a content-sized header (32px of controls in 12px of
   * padding, so 56px) above this row; the right pane's session header card is
   * content-sized at 106px and starts 8px lower. This is the height at which
   * the two panes' first blocks end on the same line:
   *
   *     1 (border) + 56 (header) + 58 (this) = 115 = the card's bottom
   *
   * Every term in that sum can move. If the session title ever wraps to a
   * second line, or either pane's padding changes, this number is wrong and the
   * edges part again -- so it is pinned by e2e/searchRowAlignment.spec.ts
   * rather than left to be noticed in a screenshot months later. It has already
   * caught one such change: shortening the header by 16px.
   */
  const ROW_HEIGHT = '58px';

  // The save button and the menu trigger share one border and one height with
  // the field beside them, so the row reads as one block. Box-sizing is
  // border-box globally (App.css), so the group's own border sits inside that
  // height and the row stays flush -- the segments take 100% of what is left.
  const saveGroupStyle = css`
    display: flex;
    flex-shrink: 0;
    height: ${ROW_HEIGHT};
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
        style={`margin-right: 8px; height: ${ROW_HEIGHT};`}
      />
      {/* <Button text="Search" onClick={createTabGroup} /> */}
      <Button
        tooltipText={t('Search')}
        iconType="search"
        ariaLabel={t('Search')}
        onClick={filterResults}
        // ROW_HEIGHT like the box beside it (KAN-216). Padding alone left it
        // 48px, 5px short at each edge of the row. 58px wide already, so it is
        // square -- the size of the save panel's save-all segment in this spot.
        style={`padding: 12px; flex-shrink: 0; height: ${ROW_HEIGHT};`}
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
        style={`margin-right: 8px; height: ${ROW_HEIGHT};`}
      />
      {/* One wide save and a menu (KAN-208).

          The save-all button keeps the wide segment and its place at the
          right, where the only save button has always been. What moved is the
          narrow one: saving just the current window is now a menu item, beside
          the export of what is open.

          Two SAVES need two scopes, because a save is permanent and the wrong
          scope leaves clutter in the list. Export creates nothing until a
          button on the preview is pressed, and the preview's edit mode can
          hide a whole window -- so there is ONE export item, covering
          everything open, and the scope is chosen after seeing it rather than
          blind. That also matches a saved session, whose menu has one Export…
          whatever it holds.

          A third plus-bearing glyph in this group was ruled out: the group
          would then mean two different things (KAN-213's rule). The pair that
          used to live here measured 75% distinct, and the pair before that
          52% -- which is what "twins" looks like as a number. Re-measure
          before putting any second glyph back in this box.

          The tooltip has its own key rather than borrowing the placeholder's,
          even though both describe the same operation: the placeholder is
          squeezed into a 231px field and several locales shortened it to fit
          -- German drops "alle" and French drops "toutes", the very word that
          has to survive here.

          Labels instead of a glyph would beat icons outright and do not fit:
          the row is 339px and the German pair alone needed 318px of it. A menu
          item, though, carries words for free -- which is the whole reason the
          secondary save reads better there than it did as a glyph. */}
      <div css={saveGroupStyle}>
        <Button
          tooltipText={t('Save every open window as a session')}
          ariaLabel={t('Save every open window as a session')}
          iconType="library_add"
          onClick={() => createTabGroup('all-windows')}
          style="width: 58px; height: 100%; padding: 0; flex-shrink: 0; border: none;"
        />
        <OverflowMenu
          // The same name the session header's and the group row's menus
          // carry. Three controls in the popup now answer to it, which is
          // fine for a user -- each is read in its own context -- but it does
          // mean an e2e locator written on the name alone is ambiguous, and
          // Playwright's strict mode refuses it. The specs scope to this row
          // by the name box beside it.
          ariaLabel={t('More actions')}
          // The trigger sits at the END of the row, so the menu opens
          // leftward, staying inside this pane -- the opposite call from the
          // session header (KAN-193), whose trigger is near the start.
          //
          // The group is flex-shrink: 0, so every pixel here comes straight
          // out of the name box beside it, and `more_vert` inks only 4px of
          // its 24px box -- the rest is air worth giving back. Measured at
          // 790x550, the name box went 231 -> 239 -> 243 as this went
          // 40 -> 32 -> 28.
          //
          // 24px is the FLOOR, and this sits one step above it: below 24 two
          // things break at once -- the 24px glyph box overflows its own
          // control, and the target drops under WCAG 2.2 SC 2.5.8's 24x24
          // minimum. The spacing exception does not rescue it, because the
          // save button is 1px away, so a 24px circle centred here overlaps
          // its neighbour. 28 keeps 12px of air around the dots, so the
          // hover and pressed fills still read as a button rather than as a
          // box drawn tight around the glyph.
          //
          // `padding: 0` is what lets the box be narrower than 32 at all:
          // Icon otherwise adds 4px all round. Height is separate -- 2px is
          // the group's own top and bottom borders, which border-box puts
          // inside ROW_HEIGHT, and the Button beside it reaches the same 56px
          // through `height: 100%`, which an Icon inside the menu's
          // relatively-positioned wrapper cannot see.
          triggerStyle={`width: 28px; height: calc(${ROW_HEIGHT} - 2px); padding: 0;
                         border-left: 1px solid ${COLORS.BORDER_COLOR};`}
          items={[
            {
              key: 'save-current-window',
              label: t('Save current window as a session'),
              icon: 'add_box',
              onSelect: () => createTabGroup('current-window'),
            },
            {
              key: 'export-open-windows',
              label: t('Export open windows'),
              icon: 'ios_share',
              onSelect: () => {
                // Opening a tab takes focus, which destroys the popup.
                // Nothing may be sequenced after this call -- the page
                // captures the windows for itself when it loads, which is
                // also why no snapshot is handed over here.
                chrome.tabs.create({
                  url: chrome.runtime.getURL('export.html?source=open-windows'),
                });
              },
            },
          ]}
        />
      </div>
    </div>
  );
}
