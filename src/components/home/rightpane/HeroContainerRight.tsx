import { useEffect, useState } from 'react';

import { useDispatch, useSelector } from 'react-redux';

import { css } from '@emotion/react';

import Icon from '../../common/Icon';
import OverflowMenu from '../../common/OverflowMenu';
import Button from '../../common/Button';
import ClickableRow from '../../common/ClickableRow';
import { NormalLabel } from '../../common/Label';
import { useFontFamily } from '../../../hooks/useFontFamily';
import { useThemeColors } from '../../../hooks/useThemeColors';
import { AppDispatch, RootState } from '../../../redux/store';
import { sessionDateLabel } from '../../../utils/functions/sessionDate';
import {
  readCurrentWindowGroups,
  toWindowGroupData,
} from '../../../utils/functions/capture';
import {
  formatGroupCounts,
  isSearchActive,
  selectVisibleTabGroups,
} from '../../../utils/functions/local';
import {
  addCurrWindowToTabGroup,
  deleteTabContainer,
  openAllTabContainer,
  requestFocusTabContainer,
  updateTabGroupTitle,
} from '../../../redux/slices/tabContainerDataStateSlice';
import {
  collapsedWindowIdsOf,
  setAllWindowsCollapsed,
  showToast,
} from '../../../redux/slices/globalStateSlice';
import { copySessionLinks } from '../../../utils/functions/copySessionLinks';
import { tidySessionForExport } from '../../../utils/functions/sessionExportHtml';
import { TOAST_MESSAGES } from '../../../utils/constants/common';
import { useTranslation } from 'react-i18next';
import { DURATION, ICON, TYPE } from '../../../styles/scale';

export default function HeroContainerRight() {
  const COLORS = useThemeColors();
  const FONT_FAMILY = useFontFamily();
  const { t, i18n } = useTranslation();
  const [isEditing, setIsEditing] = useState(false);
  const [editableTitle, setEditableTitle] = useState('');
  const [currentTabName, setCurrentTabName] = useState<string>('New Tab');
  const [isContainerHovered, setIsContainerHovered] = useState<boolean>(false);
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

  const hasTabGroupsPermission = useSelector(
    (state: RootState) => state.globalState.hasTabGroupsPermission
  );

  // KAN-206. The folded set, read raw so the ownership comparison below can be
  // made against this session. A stable object reference (or null), so unlike
  // the window rows' boolean selector this is safe to hand back from
  // useSelector directly.
  //
  // Up here with the other hooks, above the early return, for the reason its
  // comment gives: a hook below that guard changes the hook count between the
  // nothing-selected and selected renders.
  const collapsedWindows = useSelector(
    (state: RootState) => state.globalState.collapsedWindows
  );

  // Which date to show. Device-local, set by the sort menu (KAN-141). Read
  // here as well as in the row so the two panes cannot disagree about the same
  // session.
  const sessionDateBasis = useSelector(
    (state: RootState) => state.settingsDataState.sessionDateBasis
  );

  useEffect(() => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const currentTab = tabs[0];
      if (currentTab && currentTab.title) {
        setCurrentTabName(currentTab.title);
      } else {
        setCurrentTabName('New Tab');
      }
    });
  }, []);

  // the same list RightPane derives its mount guard from
  const selectedTabGroup = selectVisibleTabGroups(
    tabContainerDataList.tabGroups,
    isSearchPanel,
    searchInputText,
    hasTabGroupsPermission
  )[0];

  // Belt and braces: RightPane does not mount this component when the list is
  // empty, so this should be unreachable -- but it is what makes the component
  // safe on its own terms rather than safe because of its only caller (KAN-16).
  // It sits below every hook deliberately: an early return above the useEffect
  // that reads the current tab name would change the hook count between the
  // nothing-selected and selected renders, and React throws "Rendered more
  // hooks than during the previous render" on that transition.
  if (!selectedTabGroup) return null;

  // `editableTitle` is a DRAFT: nothing reads it unless `isEditing` is true, so
  // it is seeded at the moment editing starts rather than kept in step with the
  // prop by an effect.
  //
  // The effect this replaces depended on the whole selectedTabGroup object, so
  // any change to the selected session re-seeded the draft -- including changes
  // the user did not make. customMiddleware dispatches syncStateWithFirestore()
  // with no user action, and the merge lands replaceState(merged), so a sync
  // tick arriving mid-rename threw away what had been typed. KAN-51.
  const startEditing = () => {
    setEditableTitle(selectedTabGroup.title);
    setIsEditing(true);
  };

  const handleTabGroupTitleClick = () => {
    if (!isSearchPanel) {
      startEditing();
    }
  };

  const handleBlur = () => {
    setIsEditing(false);
    if (selectedTabGroup.title !== editableTitle) {
      dispatch(updateTabGroupTitle({ tabGroupId, editableTitle }));
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setEditableTitle(e.target.value);
  };

  const { tabGroupId, title, windowCount, tabCount } = selectedTabGroup;

  // KAN-206. What the collapse control offers, asked of the windows themselves
  // rather than of a remembered press. `collapsedWindowIdsOf` is the one place
  // the "does this set belong to this session?" rule is written; asking it here
  // is what makes the control expand-only for a session that is fully folded
  // and collapse-only for every other state, mixed included.
  //
  // A session always has at least one window, so there is no empty-list case
  // where this would be vacuously false.
  const collapsedIds = collapsedWindowIdsOf(collapsedWindows, tabGroupId);
  const anyWindowOpen = selectedTabGroup.windows.some(
    (w) => !collapsedIds.includes(w.windowId)
  );

  const handleAddCurrWindowClick = async () => {
    // fetch current window
    const windowData = await new Promise<chrome.windows.Window>((resolve) =>
      chrome.windows.getCurrent({ populate: true }, (result) => resolve(result))
    );

    const read = await readCurrentWindowGroups(windowData.id);
    const window = toWindowGroupData(
      windowData,
      currentTabName,
      read?.groups,
      read?.idByChromeId ?? new Map()
    );

    dispatch(addCurrWindowToTabGroup({ tabGroupId, window }));
  };

  function handleKeyPressOnEditTitle(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Enter') {
      handleBlur();
    }
  }

  const containerStyle = css`
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    justify-content: space-between;
    border: 1px solid ${COLORS.BORDER_COLOR};
    font-family: ${FONT_FAMILY};
    user-select: none;
    background-color: ${COLORS.SECONDARY_COLOR};
    width: 100%;
  `;

  const topStyle = css`
    display: flex;
    flex-direction: column;
    width: 100%;
  `;

  const bottomStyle = css`
    display: flex;
    flex-direction: row;
    justify-content: space-between;
    align-items: flex-end;
    width: 100%;
    ${isSearchPanel && 'visibility: hidden;'}
  `;

  // Shared by both non-editing branches so the search-mode label and the
  // rename button cannot drift apart visually.
  const titleLabel = (
    <NormalLabel
      tooltipText={title}
      value={title}
      size={TYPE.SECTION}
      color={COLORS.TEXT_COLOR}
      style="height: 32px; padding-left: 8px; margin-right: 8px; max-width: 100%;"
    />
  );

  return (
    <div
      css={containerStyle}
      onMouseEnter={() => setIsContainerHovered(true)}
      onMouseLeave={() => setIsContainerHovered(false)}
    >
      <div css={topStyle}>
        <div
          css={css`
            position: relative;
            display: flex;
            flex-direction: row;
            justify-content: space-between;
            align-items: center;
            width: 100%;
          `}
        >
          {isEditing && !isSearchPanel ? (
            <input
              value={editableTitle}
              onBlur={handleBlur}
              onChange={handleChange}
              onKeyDown={(e) => handleKeyPressOnEditTitle(e)}
              autoFocus
              css={css`
                color: ${COLORS.TEXT_COLOR};
                background-color: ${COLORS.PRIMARY_COLOR};
                border: 1px solid ${COLORS.BORDER_COLOR};
                display: flex;
                align-items: center;
                font-family: ${FONT_FAMILY};
                font-size: ${TYPE.SECTION};
                height: 32px;
                padding-left: 8px;
                padding-right: 8px;
                flex-grow: 1;
                &:focus {
                  outline: none;
                }
              `}
            />
          ) : isSearchPanel ? (
            // Read-only while searching: the action block and the whole bottom
            // row are `visibility: hidden` here, so exposing the title as a
            // button would advertise the one action still on offer in a pane
            // where nothing else can be done.
            //
            // This branch, not handleTabGroupTitleClick's own `!isSearchPanel`
            // check, is what makes that true now -- the handler is never wired
            // here at all, so that check no longer has a reachable call site.
            titleLabel
          ) : (
            // KAN-77. Click-to-rename used to be an onClick on the NormalLabel,
            // which renders a bare `<div onClick>` -- no role, no tab stop. The
            // accessible name has to CONTAIN the visible title rather than
            // replace it (WCAG 2.5.3): a bare "Rename session" would leave a
            // voice-control user saying "click Research" with nothing to hit.
            // Same `action + ': ' + target` shape as WindowEntryContainer:269.
            <ClickableRow
              ariaLabel={t('Rename session') + ': ' + title}
              onClick={handleTabGroupTitleClick}
              // min-width: 0 is load-bearing. A <button> has `overflow:
              // visible`, so its `min-width: auto` does NOT collapse to zero
              // the way the bare label's did, and without this the title stops
              // truncating and runs under the action block.
              style="display: flex; align-items: center; min-width: 0;"
            >
              {titleLabel}
            </ClickableRow>
          )}
          <div
            css={css`
              position: absolute;
              top: 50%;
              right: 0;
              transform: translateY(-50%);
              opacity: ${isContainerHovered ? 1 : 0};
              transition: opacity ${DURATION.COLOR} ease-out;
              /* The keyboard's equivalent of the hover reveal (KAN-68). */
              &:focus-within {
                opacity: 1;
              }
              ${isSearchPanel && 'visibility: hidden;'}
            `}
          >
            {/* Editing swaps the pencil for a tick rather than leaving the
                block empty, matching the window rename below. Enter and
                clicking away both already committed, but neither is an
                affordance a pointer user can see -- "click somewhere else to
                save" is not something an interface can ask of anyone. */}
            {!isSearchPanel &&
              (isEditing ? (
                // The wrapper exists to carry onMouseDown, which Icon does not
                // expose. preventDefault keeps focus in the input so the tick
                // does not blur it, which makes onClick below the SINGLE commit
                // path rather than one of two racing ones (blur, then click).
                //
                // Measured: the wrapper alone is what stops the editor
                // reopening -- without any wrapper, the tick unmounts on commit
                // and the click retargets onto the pencil that replaced it. The
                // preventDefault is pinned separately, by asserting the
                // mousedown is defaultPrevented.
                <span onMouseDown={(e) => e.preventDefault()}>
                  <Icon
                    tooltipText={t('Save changes')}
                    ariaLabel={t('Save changes')}
                    type="done"
                    backgroundColor={COLORS.SECONDARY_COLOR}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleBlur();
                    }}
                  />
                </span>
              ) : (
                <Icon
                  tooltipText={t('Rename session')}
                  ariaLabel={t('Rename session')}
                  type="edit"
                  backgroundColor={COLORS.SECONDARY_COLOR}
                  onClick={(e) => {
                    e.stopPropagation();
                    startEditing();
                  }}
                />
              ))}
          </div>
        </div>
        <NormalLabel
          value={formatGroupCounts(
            windowCount,
            tabCount,
            isSearchActive(isSearchPanel, searchInputText),
            t
          )}
          size={TYPE.META}
          color={COLORS.LABEL_L1_COLOR}
          style={`padding-top: 2px; padding-left: 8px;`}
        />
        <NormalLabel
          // Same helper as the left pane row, so the two panes cannot show
          // the same session two different dates (KAN-141).
          // i18n.language, not a constant: the date is formatted in the user's
          // own locale (KAN-85).
          value={sessionDateLabel(
            selectedTabGroup,
            sessionDateBasis,
            i18n.language,
            t
          )}
          size={TYPE.META}
          color={COLORS.LABEL_L2_COLOR}
          style="padding-top: 2px; padding-left: 8px;"
        />
      </div>
      <div css={bottomStyle}>
        <div
          css={css`
            display: flex;
            padding-top: 8px;
          `}
        >
          <Icon
            tooltipText={t('Open session')}
            ariaLabel={t('Open session')}
            type="reopen_window"
            onClick={() => {
              const goToURLText: string = t('Go to URL');
              dispatch(openAllTabContainer({ tabGroupId, goToURLText }));
            }}
          />
          <Icon
            tooltipText={t('Switch to session')}
            ariaLabel={t('Switch to session')}
            type="filter_center_focus"
            onClick={() => {
              dispatch(
                requestFocusTabContainer({
                  tabGroupId,
                  goToURLText: t('Go to URL'),
                  saveTitle: t('FocusAutoSaveTitle'),
                })
              );
            }}
          />
          {/* KAN-206. Folds every window in this session, or unfolds them all.
              Third in the strip so the overflow stays last, which is the only
              position that reads as "everything after me is secondary".

              unfold_less/unfold_more rather than a doubled expand_less: every
              window row already wears that chevron, and a header control built
              from the same shape reads as a fourth window chevron that wandered
              up here. Compared in a browser at 1.5rem before choosing.

              MAJORITY RULES rather than a remembered boolean. The question it
              asks is about the windows on screen -- "is any of them open?" --
              so opening one by hand between two presses cannot leave the
              control offering the opposite of what the pane needs. A boolean
              alternating on each press disagrees in exactly that case, which is
              what collapseAllWindows.test.tsx pins.

              No isSearchPanel guard: bottomStyle hides this whole row while
              searching, and a second guard would be a second answer to one
              question. */}
          <Icon
            tooltipText={
              anyWindowOpen
                ? t('Collapse all windows')
                : t('Expand all windows')
            }
            ariaLabel={
              anyWindowOpen
                ? t('Collapse all windows')
                : t('Expand all windows')
            }
            type={anyWindowOpen ? 'unfold_less' : 'unfold_more'}
            onClick={() =>
              dispatch(
                setAllWindowsCollapsed({
                  tabGroupId,
                  // The ids to fold, or none at all. Read off the session's own
                  // windows rather than accumulated from presses, so a window
                  // added or removed since the last press is accounted for.
                  windowIds: anyWindowOpen
                    ? selectedTabGroup.windows.map((w) => w.windowId)
                    : [],
                })
              )
            }
          />
          {/* KAN-193. Export and Delete live behind one trigger rather than as
              two more icons. A menu item carries words, so export cannot be
              misread the way its download glyph was once the flow began with
              a preview; and Delete stops sitting one mis-click from the two
              everyday actions. Deleting stays one menu away from recoverable:
              it is a captured action, so Undo restores it. */}
          <OverflowMenu
            ariaLabel={t('More actions')}
            // The trigger sits near the START of the row, so the menu opens
            // rightward, inside this pane. End-aligned, it crossed the pane
            // divider and covered the session list.
            align="start"
            items={[
              {
                // KAN-209. The one output that needs no preview: Copy ignores
                // the layout and colour choices the export page exists to
                // offer, so reaching it through a new tab was a detour.
                //
                // FIRST, because it is the only item here that finishes where
                // it started -- Export opens a tab, Delete changes the session
                // -- so the menu reads cheap, heavier, destructive.
                //
                // TIDIED, exactly as the export page's Copy is (KAN-210).
                // KAN-202's clean-ups -- dropping a site's notification count
                // from a title, and unwrapping a suspended tab's real address
                // -- are not a preview concern: they are wrong in anything
                // anyone shares, whichever button produced it. This shipped
                // passing the raw session, so the shortcut gave the worse of
                // two answers for the same command.
                //
                // No edits applied: there is no preview here to respect, which
                // is the only difference left between the two call sites.
                key: 'copy',
                label: t('Copy all links'),
                icon: 'link',
                onSelect: async () => {
                  await copySessionLinks(
                    tidySessionForExport(selectedTabGroup),
                    t,
                    i18n.language
                  );
                  // The clipboard says nothing of its own, and unlike the
                  // export page there is no room here for an inline note.
                  dispatch(
                    showToast({
                      toastText: TOAST_MESSAGES.COPY_LINKS_SUCCESS,
                      duration: 3000,
                    })
                  );
                },
              },
              {
                key: 'export',
                label: t('Export session'),
                icon: 'file_export',
                onSelect: () => {
                  // Opening a tab takes focus, which destroys the popup.
                  // Nothing may be sequenced after this call -- the whole
                  // address is built first, so there is nothing left to do
                  // when the context dies.
                  chrome.tabs.create({
                    url: chrome.runtime.getURL(
                      `export.html?session=${encodeURIComponent(tabGroupId)}`
                    ),
                  });
                },
              },
              {
                key: 'delete',
                label: t('Delete session'),
                icon: 'delete',
                danger: true,
                onSelect: () => dispatch(deleteTabContainer(tabGroupId)),
              },
            ]}
          />
        </div>
        <div
          css={css`
            display: flex;
          `}
        >
          <Button
            text={t('Add window')}
            iconSize={ICON.SMALL}
            tooltipText={t('Add current window')}
            ariaLabel={t('Add window')}
            // Not a bare plus. The left pane carries two plus-bearing controls
            // -- `add_box` and `library_add` -- and both CREATE a session; this
            // one appends to the session already on screen. Both of theirs are
            // a plus inside a container, which is what makes them read as a
            // pair; `playlist_add` has none, and says "add this to the list you
            // are looking at", which is what a session is.
            //
            // Measured 79.7% / 81.1% distinct from those two (KAN-5's ink
            // comparison), against the 54.1% they already measure from each
            // other. A bare `add` scored 76.6% and was still the confusable one:
            // the collision was in the meaning, which an ink metric cannot see.
            iconType="playlist_add"
            onClick={handleAddCurrWindowClick}
            iconStyle={`
              padding: 4px 4px 2px 4px;
            `}
            // KAN-214. A tinted chip: no border, and a resting fill of its own,
            // flush in the card's bottom-right corner so the fill runs to the
            // card's border there. The chip variant carries the whole ladder --
            // CHIP_COLOR at rest, the icon tokens for hover and press.
            //
            // History, because each step was a defect the next one fixed
            // (KAN-213). It was a borderless HOVER_COLOR fill, 1.047:1 against
            // this card and so invisible. Then an outlined box with no fill --
            // `quiet`'s PRIMARY_COLOR had read as a raised bevel here, because
            // this sits on a SECONDARY_COLOR card, not the page's ground. Now a
            // chip at 1.20:1, not the 1.35:1 first picked: at 1.35 there was no
            // room left above it for a visible hover and a readable press.
            //
            // Padding is the outlined version's plus the 1px top and left border
            // it no longer draws, so the glyph, the label and the width all stay
            // where they were: add-window-button.spec.ts pins 156.4 / 210 /
            // 185.2 in en/de/ru. Height is pinned at 32px so the header -- and
            // the 1 + 56 + 58 = 115 cross-pane line -- does not move.
            variant="chip"
            style={`
              height: 32px;
              font-size: ${TYPE.SECONDARY};
              padding: 5px 6px 3px 3px;
            `}
          />
        </div>
      </div>
    </div>
  );
}
