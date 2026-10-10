import { useCallback, useEffect, useRef, useState } from 'react';

import { useDispatch, useSelector } from 'react-redux';

import { css } from '@emotion/react';

import Button from '../../common/Button';
import { DropBoxLabel } from '../../common/dropBox';
import { dropBoxStyle } from '../../common/dropBoxStyle';
import OverflowMenu from '../../common/OverflowMenu';
import { NormalLabel } from '../../common/Label';
import TextBox from '../../common/TextBox';
import { useSavedSearch } from '../../../hooks/useSavedSearch';
import { useThemeColors } from '../../../hooks/useThemeColors';
import { TYPE } from '../../../styles/scale';
import { AppDispatch } from '../../../redux/store';
import {
  captureOpenWindows,
  isNameSourceNoise,
  isNotANameSource,
  isTabKeeperPage,
  type CaptureScope,
} from '../../../utils/functions/capture';
import { dropNotificationCount } from '../../../utils/functions/sessionExportHtml';
import { selectRunAwaitsSave, takeRunSave } from '../../../redux/firstRun';
import { saveToTabContainer } from '../../../redux/slices/tabContainerDataStateSlice';
import { normalizeTitle } from '../../../utils/functions/local';
import {
  isTabView,
  pickNameSourceTab,
} from '../../../utils/functions/viewMode';
import { useTranslation } from 'react-i18next';
import { useNewSessionReceiver } from './useNewSessionReceiver';

export default function UserInputContainer() {
  const { t } = useTranslation();
  const COLORS = useThemeColors();
  const dispatch: AppDispatch = useDispatch();
  const { isSearching } = useSavedSearch();

  const [newTitle, setNewTitle] = useState<string>('');
  const [currentTabName, setCurrentTabName] = useState<string>('');
  const awaitsRunSave = useSelector(selectRunAwaitsSave);
  // Once touched, the field is the user's for the rest of the page's run.
  const [isPrefillDropped, setPrefillDropped] = useState(false);
  // §8: an untouched field shows the name an empty save would use right now.
  const prefill =
    awaitsRunSave &&
    !isPrefillDropped &&
    newTitle === '' &&
    currentTabName !== ''
      ? normalizeTitle(currentTabName) || t('New Tab Group')
      : null;

  // Only a stored session consumes the name, and never text typed since.
  const consumeName = useCallback(
    (typed: string) => setNewTitle((now) => (now === typed ? '' : now)),
    []
  );

  // KAN-394 P3. From a carriable drag's pick-up the row is a New session target.
  const rowRef = useRef<HTMLDivElement>(null);
  const targetRef = useRef<HTMLDivElement>(null);
  const takesCarry = useNewSessionReceiver(
    rowRef,
    targetRef,
    newTitle,
    consumeName
  );

  useEffect(() => {
    // Guards loadSuggestion below against setting state after this
    // component has unmounted -- its query crosses an await, and a popup
    // that closes mid-query must not resume into a dead component.
    // handleVisibilityChange (further down) does NOT read this: it only
    // ever runs in the tab view, whose page is not torn down the way the
    // popup is, and removeEventListener (its own cleanup, below) is what
    // stops it from running at all once this effect unmounts.
    let cancelled = false;

    // A "(3) Gmail" badge is stale the moment it is saved.
    function cleanSuggestion(title: string | undefined): string {
      return title ? dropNotificationCount(title) : t('New Tab Group');
    }

    async function fetchSuggestedTitle(): Promise<string | undefined> {
      if (isTabView()) {
        // In the tab the active tab is Tab Keeper: the most recent tab that names something (D15).
        const tabsOfWindow = await new Promise<chrome.tabs.Tab[]>((resolve) =>
          chrome.tabs.query({ currentWindow: true }, (tabs) => resolve(tabs))
        );
        return pickNameSourceTab(tabsOfWindow, isNotANameSource)?.title;
      }
      // KAN-299. A popup over Tab Keeper's own page falls back the same way.
      const [activeTab] = await new Promise<chrome.tabs.Tab[]>((resolve) =>
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) =>
          resolve(tabs)
        )
      );
      if (activeTab === undefined || isNameSourceNoise(activeTab))
        return undefined;
      if (!isTabKeeperPage(activeTab)) return activeTab.title;
      const tabsOfWindow = await new Promise<chrome.tabs.Tab[]>((resolve) =>
        chrome.tabs.query({ currentWindow: true }, (tabs) => resolve(tabs))
      );
      return pickNameSourceTab(tabsOfWindow, isNotANameSource)?.title;
    }

    async function loadSuggestion() {
      const suggested = cleanSuggestion(await fetchSuggestedTitle());
      if (cancelled) return;
      setCurrentTabName(suggested);
    }

    loadSuggestion();

    // KAN-299. Tab-view only: the popup remounts on every open, so its
    // mount-once suggestion above is never stale enough to matter, but the
    // tab can sit open for days -- long enough for the tab this suggestion
    // was drawn from to no longer be the most recently used one. Recompute
    // whenever the page becomes visible again.
    if (!isTabView()) {
      return () => {
        cancelled = true;
      };
    }

    async function handleVisibilityChange() {
      if (document.visibilityState !== 'visible') return;
      const suggested = cleanSuggestion(await fetchSuggestedTitle());

      // The name an empty save uses must follow the current tab.
      setCurrentTabName(suggested);
    }

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
    // `t` is deliberately not a dependency. The mount-time suggestion above
    // must run only once, on mount; re-running the whole effect on a
    // language change would re-attach the visibility listener a second time.
    // Nothing is lost by omitting it either -- the language can only be
    // changed from the settings page, which unmounts this component, so the
    // next mount already picks up the new language.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function updateUserInput(e: React.ChangeEvent<HTMLInputElement>) {
    setNewTitle(e.target.value);
    if (awaitsRunSave) setPrefillDropped(true);
  }

  // The scope is the button's word, not a stored preference (KAN-5). Focus
  // mode saves through this same captureOpenWindows before closing every
  // window, so nothing it does not pass itself may reach that path.
  async function createTabGroup(scope: CaptureScope) {
    const typed = newTitle;
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
      normalizeTitle(prefill ?? newTitle) ||
      normalizeTitle(currentTabName) ||
      t('New Tab Group');

    // KAN-279 D6 / KAN-300. In the tab, "the current window" includes Tab
    // Keeper's own page -- captureOpenWindows leaves every Tab Keeper page
    // out of its own accord now (isTabKeeperPage, capture.ts), so there is
    // nothing left for this call site to ask for.
    const containerData = await captureOpenWindows(title, scope);
    if (!containerData) return;

    await dispatch(saveToTabContainer({ container: containerData, scope }));
    consumeName(typed);
    // The run's save step takes its first save; any later one is ordinary (R6).
    dispatch(takeRunSave(containerData.tabGroupId));
  }

  const containerStyle = css`
    position: relative;
    display: flex;
    justify-content: space-between;
    align-items: stretch;
  `;

  // Over the whole row; App.css shows it on the New session marker (setDragNewSession).
  const sessionTargetStyle = css`
    position: absolute;
    inset: 0;
    visibility: hidden;
    pointer-events: none;
  `;

  /**
   * The row's height, set by an invisible column rather than a number (KAN-492).
   *
   * The session header card beside this column is a title line, two caption
   * lines and a row of icons; the header above this row is the same icons in
   * 24px of padding. The row makes up the difference so the two end on one
   * line: two of the card's caption lines, drawn here, plus 26px for the
   * card's 8px offset, 2px of border, 32px title line and 8px above its icons,
   * less this header's 24px. The captions' height comes from the font, not a
   * constant, so only the same labels keep pace at every font size. Pinned by
   * e2e/searchRowAlignment.spec.ts.
   */
  const rowHeightStyle = css`
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
    width: 0;
    padding-top: 26px;
    overflow: hidden;
    visibility: hidden;
  `;
  const captionLine = (
    <NormalLabel value={'\u00a0'} size={TYPE.META} style="padding-top: 2px;" />
  );

  // The save button and the menu trigger share one border and one height with
  // the field beside them, so the row reads as one block. Box-sizing is
  // border-box globally (App.css), so the group's own border sits inside that
  // height and the row stays flush -- the segments take 100% of what is left.
  const saveGroupStyle = css`
    display: flex;
    flex-shrink: 0;
    border: 1px solid ${COLORS.BORDER_COLOR};
  `;

  return (
    <div
      ref={rowRef}
      data-save-row=""
      css={containerStyle}
      data-tour-anchor="save"
    >
      <TextBox
        id="name"
        name="name"
        value={prefill ?? newTitle}
        placeholder={t('Name the new session')}
        autoComplete="off"
        onChange={updateUserInput}
        onKeyEnter={
          isSearching ? undefined : () => createTabGroup('all-windows')
        }
        style={`${isSearching ? '' : 'margin-right: 8px; '}height: auto;`}
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

          Labels instead of a glyph would beat icons outright and do not fit:
          the row is 339px and the German pair alone needed 318px of it. A menu
          item, though, carries words for free -- which is the whole reason the
          secondary save reads better there than it did as a glyph. */}
      {!isSearching && (
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
            // Icon otherwise adds 4px all round. Its height comes from
            // fillsHeight: the group inside its border, as the Button beside it
            // gets through `height: 100%`.
            fillsHeight
            triggerStyle={`width: 28px; padding: 0;
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
                    url: chrome.runtime.getURL(
                      'export.html?source=open-windows'
                    ),
                  });
                },
              },
            ]}
          />
        </div>
      )}
      <span aria-hidden="true" css={rowHeightStyle}>
        {captionLine}
        {captionLine}
      </span>
      {takesCarry && (
        <div
          ref={targetRef}
          data-new-session-target=""
          aria-hidden="true"
          css={[dropBoxStyle(COLORS), sessionTargetStyle]}
        >
          <DropBoxLabel text={t('CarryNewSessionTarget')} />
        </div>
      )}
    </div>
  );
}
