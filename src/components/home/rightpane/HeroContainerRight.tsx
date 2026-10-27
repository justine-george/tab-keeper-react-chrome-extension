import { useEffect, useRef, useState } from 'react';

import { useDispatch, useSelector } from 'react-redux';

import { css } from '@emotion/react';

import { renameKeyDown } from '../../../utils/functions/renameKeyDown';
import { useFocusOnRemount } from '../../../hooks/useFocusOnRemount';
import { DropBoxLabel } from '../../common/dropBox';
import { dropBoxStyle } from '../../common/dropBoxStyle';
import Icon from '../../common/Icon';
import FoldAllGlyph from '../../common/FoldAllGlyph';
import OverflowMenu from '../../common/OverflowMenu';
import Button from '../../common/Button';
import ClickableRow from '../../common/ClickableRow';
import { focusRingOverTickCss, whileKeyNav } from '../../common/focusRing';
import { renameOnClickStyle } from '../../common/renameOnClickStyle';
import { NormalLabel } from '../../common/Label';
import { useFontFamily } from '../../../hooks/useFontFamily';
import { useThemeColors } from '../../../hooks/useThemeColors';
import { AppDispatch, RootState } from '../../../redux/store';
import { useToday } from '../../../hooks/useToday';
import {
  sessionDateLabel,
  sessionDateTitle,
} from '../../../utils/functions/sessionDate';
import {
  formatGroupCounts,
  selectVisibleTabGroups,
} from '../../../utils/functions/local';
import { useSavedSearch } from '../../../hooks/useSavedSearch';
import { useIsOpenBlockedByTour } from '../../../hooks/useIsOpenBlockedByTour';
import { useRowContextMenu } from '../../common/rowMenu/useRowContextMenu';
import { sessionMenuItems, useSessionDeleteKey } from '../sessionMenuItems';
import {
  replaceSessionWithOpenWindows,
  openAllTabContainer,
  requestFocusTabContainer,
  updateTabGroupTitle,
} from '../../../redux/slices/tabContainerDataStateSlice';
import {
  clearSessionRenameRequest,
  collapsedWindowIdsOf,
  endSavedSessionPeek,
  setAllWindowsCollapsed,
} from '../../../redux/slices/globalStateSlice';
import { showSessionAndAddCurrentWindow } from '../../../redux/showSessionAndAddCurrentWindow';
import { isTabView } from '../../../utils/functions/viewMode';
import { useMediaQuery } from '../../../hooks/useMediaQuery';
import { OPEN_NOW_RAIL_QUERY } from '../opennow/railQuery';
import { OPEN_NOW_FOLD_ICON } from '../opennow/foldIcon';
import { runPaneMotion } from '../paneMotion';
import { selectIsOpenNowFolded } from '../../../redux/savedSessionFold';
import { setFoldOpenNowInTabView } from '../../../redux/slices/settingsDataStateSlice';
import { useTranslation } from 'react-i18next';
import { DURATION, ICON, TYPE } from '../../../styles/scale';
import { useNewFirstWindowReceiver } from './useNewFirstWindowReceiver';
import { selectRunHoldsDelete } from '../../../redux/firstRun';
import { onFirstClickOnly } from '../../common/firstClickOnly';

export default function HeroContainerRight() {
  const COLORS = useThemeColors();
  const FONT_FAMILY = useFontFamily();
  const { t, i18n } = useTranslation();
  // The session being renamed, so a draft never carries over to another session.
  const [editingTabGroupId, setEditingTabGroupId] = useState<string | null>(
    null
  );
  const [editableTitle, setEditableTitle] = useState('');
  const [isContainerHovered, setIsContainerHovered] = useState<boolean>(false);
  const dispatch: AppDispatch = useDispatch();
  // KAN-808. The full view folds Open now from the title line. Not in the
  // popup, which has no Open now, nor narrow, where Open now is already the
  // rail: there the slot keeps its pencil.
  const isNarrow = useMediaQuery(OPEN_NOW_RAIL_QUERY);
  const hasOpenNowFold = isTabView() && !isNarrow;
  const isOpenNowFolded = useSelector(selectIsOpenNowFolded);
  const openNowFoldLabel = isOpenNowFolded
    ? t('Show Open now')
    : t('Fold Open now away');

  const tabContainerDataList = useSelector(
    (state: RootState) => state.tabContainerDataState
  );

  const { text: searchText, isSearching } = useSavedSearch();

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
  const timeFormat = useSelector(
    (state: RootState) => state.settingsDataState.timeFormat
  );
  // Redraws the date when the local day changes (KAN-347).
  const today = useToday();

  // the same list RightPane derives its mount guard from
  const selectedTabGroup = selectVisibleTabGroups(
    tabContainerDataList.tabGroups,
    searchText,
    hasTabGroupsPermission
  )[0];
  const isEditing =
    editingTabGroupId !== null &&
    editingTabGroupId === selectedTabGroup?.tabGroupId;

  // A draft ends when its session leaves the list, so it cannot reopen if the id returns.
  const editedSessionIsListed = tabContainerDataList.tabGroups.some(
    (g) => g.tabGroupId === editingTabGroupId
  );
  if (editingTabGroupId !== null && !editedSessionIsListed) {
    setEditingTabGroupId(null);
  }

  // KAN-361 (N1 B). The toolbar row's New window target takes a carry let go
  // on it, into the session on screen. Above the early return, as every hook
  // here must be.
  const newWindowTargetRef = useRef<HTMLDivElement>(null);
  // Set by Esc so the blur that follows in the same batch commits nothing.
  const renameCancelled = useRef(false);
  // KAN-805. A menu's Rename session opens this title once the session shows here (set during render, as above).
  const renameRequest = useSelector(
    (state: RootState) => state.globalState.sessionRenameRequest
  );
  const isRenameRequestedHere =
    renameRequest !== null && renameRequest === selectedTabGroup?.tabGroupId;
  if (
    isRenameRequestedHere &&
    selectedTabGroup !== undefined &&
    editingTabGroupId !== renameRequest
  ) {
    setEditableTitle(selectedTabGroup.title);
    setEditingTabGroupId(renameRequest);
  }
  // Spent once seen: one for a session not shown here is dropped, so it cannot open a title later.
  useEffect(() => {
    if (renameRequest === null) return;
    if (isRenameRequestedHere) renameCancelled.current = false;
    dispatch(clearSessionRenameRequest());
  }, [renameRequest, isRenameRequestedHere, dispatch]);
  // Enter, Esc and the tick end a rename on the title button (KAN-389); a blur leaves focus where it went.
  const titleFocus = useFocusOnRemount();
  useNewFirstWindowReceiver(newWindowTargetRef, selectedTabGroup?.tabGroupId);

  // KAN-413. Open and Switch on the tour's own sample wait for it, dimmed as Undo is.
  const isOpenBlocked = useIsOpenBlockedByTour(selectedTabGroup?.tabGroupId);
  // KAN-592, KAN-638. The row's Delete key also deletes from the open ⋮.
  const deleteKey = useSessionDeleteKey();
  // KAN-708. The header ⋮'s ctx; the header's right-click differs only in its place (KAN-793).
  const menuCtx = {
    t,
    language: i18n.language,
    dispatch,
    deleteKey,
    place: 'headerMenuButton' as const,
  };
  // KAN-708, KAN-793. Right-clicking the header opens its buttons, then the ⋮ items; none while searching, when the ⋮ is hidden.
  const headerMenu = useRowContextMenu({
    kind: 'session',
    ariaLabel: (id) =>
      `${t('More actions')}: ${
        id === selectedTabGroup?.tabGroupId ? selectedTabGroup.title : ''
      }`,
    itemsFor: (id) =>
      isSearching ||
      selectedTabGroup === undefined ||
      id !== selectedTabGroup.tabGroupId
        ? null
        : sessionMenuItems(selectedTabGroup, {
            ...menuCtx,
            place: 'headerRightClick',
          }),
  });
  // KAN-582. The tour's Delete step points at this ⋮, which then explains only (hard rule 2).
  const holdsDelete = useSelector(
    (state: RootState) =>
      selectedTabGroup !== undefined &&
      selectRunHoldsDelete(state, selectedTabGroup.tabGroupId)
  );

  // Belt and braces: RightPane does not mount this component when the list is
  // empty, so this should be unreachable -- but it is what makes the component
  // safe on its own terms rather than safe because of its only caller (KAN-16).
  // It sits below every hook deliberately: an early return above the
  // useSelector calls this component makes would change the hook count
  // between the nothing-selected and selected renders, and React throws
  // "Rendered more hooks than during the previous render" on that transition.
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
    renameCancelled.current = false;
    setEditableTitle(selectedTabGroup.title);
    setEditingTabGroupId(selectedTabGroup.tabGroupId);
  };

  const handleBlur = () => {
    if (renameCancelled.current) return;
    setEditingTabGroupId(null);
    if (selectedTabGroup.title !== editableTitle) {
      dispatch(updateTabGroupTitle({ tabGroupId, editableTitle }));
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setEditableTitle(e.target.value);
  };

  const { tabGroupId, title, windowCount, tabCount } = selectedTabGroup;
  // Each button says which one waits (KAN-586).
  const afterTheTour = isOpenBlocked
    ? {
        open: t('Open works after the tour'),
        switch: t('Switch works after the tour'),
        replace: t('Replace works after the tour'),
      }
    : null;

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

  const cancelRename = () => {
    renameCancelled.current = true;
    setEditingTabGroupId(null);
  };

  const containerStyle = css`
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    justify-content: space-between;
    border: 1px solid ${COLORS.PANEL_BORDER_COLOR};
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
    /* The New window target's box (KAN-361). */
    position: relative;
    display: flex;
    flex-direction: row;
    justify-content: space-between;
    align-items: flex-end;
    width: 100%;
  `;

  // KAN-361 (N1 B). While a saved tab or group is dragged -- in this session,
  // or carried from another -- the New window target stands in this row in
  // place of its controls, from the frame the drag starts. Always drawn,
  // hidden at rest; App.css swaps the two while the document carries
  // data-drag-new-window, which the drag engine writes before it measures
  // and a carry for its whole life (setDragNewWindow).
  //
  // OVER the row, not in its flow, so neither state changes the header's
  // height and nothing below it moves. It covers the controls' strip and 2px
  // of the 8px padding above it: 34px, as the trailing box is (Justine's R5
  // pick), from 6px below the row's top to the row's bottom, inset 8px from
  // the row's sides. aria-hidden, since only a
  // pointer's drag ever shows it, and it never takes the pointer: the
  // controls keep it at rest, and a drag's release is the engine's.
  const newWindowTargetStyle = css`
    position: absolute;
    inset: 6px 8px 0;
    visibility: hidden;
    pointer-events: none;
  `;

  const titleLabel = (
    <NormalLabel
      value={title}
      size={TYPE.SECTION}
      color={COLORS.TEXT_COLOR}
      style="height: 32px; padding-left: 8px; margin-right: 8px; max-width: 100%;"
    />
  );

  return (
    <>
      <div
        css={containerStyle}
        {...headerMenu.rowProps(tabGroupId)}
        onMouseEnter={() => setIsContainerHovered(true)}
        onMouseLeave={() => setIsContainerHovered(false)}
      >
        <div css={topStyle}>
          <div
            css={css`
              display: flex;
              flex-direction: row;
              justify-content: space-between;
              align-items: center;
              width: 100%;
              /* Room for the fold button, which is always shown, so a long title truncates before it. */
              ${hasOpenNowFold && !isEditing && `padding-right: calc(${ICON.DEFAULT} + 8px);`}
              ${focusRingOverTickCss(COLORS, '&:has(> input:focus-visible)')}
            `}
          >
            {isEditing ? (
              <input
                value={editableTitle}
                onBlur={handleBlur}
                onChange={handleChange}
                onKeyDown={(e) =>
                  renameKeyDown(
                    e,
                    () => {
                      titleFocus.ask('title');
                      handleBlur();
                    },
                    () => {
                      titleFocus.ask('title');
                      cancelRename();
                    }
                  )
                }
                autoFocus
                data-tour-anchor="title"
                css={css`
                  color: ${COLORS.TEXT_COLOR};
                  background-color: ${COLORS.PRIMARY_COLOR};
                  border: 1px solid ${COLORS.CONTROL_BORDER_COLOR};
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
            ) : (
              // KAN-77. Click-to-rename used to be an onClick on the NormalLabel,
              // which renders a bare `<div onClick>` -- no role, no tab stop. The
              // accessible name has to CONTAIN the visible title rather than
              // replace it (WCAG 2.5.3): a bare "Rename session" would leave a
              // voice-control user saying "click Research" with nothing to hit.
              // Same `action + ': ' + target` shape as WindowEntryContainer:269.
              <ClickableRow
                ariaLabel={t('Rename session') + ': ' + title}
                onClick={startEditing}
                // KAN-825. On the button, so a keyboard focus finds it too (the pencil covers the end on hover).
                tooltipText={title}
                announceTooltip={false}
                buttonRef={titleFocus.refFor('title')}
                tourAnchor="title"
                // min-width: 0 is load-bearing. A <button> has `overflow:
                // visible`, so its `min-width: auto` does NOT collapse to zero
                // the way the bare label's did, and without this the title stops
                // truncating and runs under the action block.
                style={
                  'display: flex; align-items: center; min-width: 0;' +
                  renameOnClickStyle(COLORS, COLORS.SECONDARY_COLOR)
                }
              >
                {titleLabel}
              </ClickableRow>
            )}
            <div
              // KAN-810. Rides the session's edge as Currently open folds.
              data-pane-layer="saved-title-action"
              css={css`
                position: absolute;
                top: 50%;
                right: 0;
                transform: translateY(-50%);
                /* The tick is the edit's save control, shown for the whole edit as the window's is (KAN-677). */
                opacity: ${isEditing || isContainerHovered || hasOpenNowFold ? 1 : 0};
                transition: opacity ${DURATION.COLOR} ease-out;
                /* The keyboard's equivalent of the hover reveal (KAN-68); keyboard focus only (KAN-636). */
                ${whileKeyNav('&:has(:focus-visible)')} {
                  opacity: 1;
                }
              `}
            >
              {/* Editing swaps the pencil for a tick rather than leaving the
                block empty, matching the window rename below. Enter and
                clicking away both already committed, but neither is an
                affordance a pointer user can see -- "click somewhere else to
                save" is not something an interface can ask of anyone. */}
              {isEditing ? (
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
                    onClick={(e) => {
                      e.stopPropagation();
                      titleFocus.ask('title');
                      handleBlur();
                    }}
                  />
                </span>
              ) : hasOpenNowFold ? (
                <Icon
                  tooltipText={openNowFoldLabel}
                  ariaLabel={openNowFoldLabel}
                  type={
                    isOpenNowFolded
                      ? OPEN_NOW_FOLD_ICON.folded
                      : OPEN_NOW_FOLD_ICON.unfolded
                  }
                  backgroundColor={COLORS.SECONDARY_COLOR}
                  onClick={(e) => {
                    e.stopPropagation();
                    // As Open now's own fold button: the press ends a peek.
                    runPaneMotion(
                      () => {
                        dispatch(setFoldOpenNowInTabView(!isOpenNowFolded));
                        dispatch(endSavedSessionPeek());
                      },
                      'openNow',
                      isOpenNowFolded ? 'unfold' : 'fold'
                    );
                  }}
                />
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
              )}
            </div>
          </div>
          <NormalLabel
            value={formatGroupCounts(windowCount, tabCount, isSearching, t)}
            size={TYPE.META}
            color={COLORS.LABEL_L1_COLOR}
            style={`padding-top: 2px; padding-left: 8px;`}
          />
          <NormalLabel
            // Same helper as the left pane row, so the two panes cannot show
            // the same session two different dates (KAN-141).
            // i18n.language, not a constant: the date is formatted in the user's
            // own locale (KAN-85). Trimmed, with the full timestamp on hover
            // (KAN-347).
            value={sessionDateLabel(
              selectedTabGroup,
              sessionDateBasis,
              i18n.language,
              timeFormat,
              t,
              today
            )}
            tooltipText={sessionDateTitle(
              selectedTabGroup,
              sessionDateBasis,
              i18n.language,
              timeFormat
            )}
            size={TYPE.META}
            color={COLORS.LABEL_L2_COLOR}
            style="padding-top: 2px; padding-left: 8px;"
          />
        </div>
        <div css={bottomStyle} data-session-toolbar>
          <div
            css={css`
              display: flex;
              padding-top: 8px;
            `}
          >
            {/* KAN-206. Folds every window in this session, or unfolds them all.
              First, as in Open now (KAN-377); the overflow stays last.

              unfold_less/unfold_more rather than a doubled expand_less: every
              window row already wears that chevron, and a header control built
              from the same shape reads as a fourth window chevron that wandered
              up here. Compared in a browser at 1.5rem before choosing.

              MAJORITY RULES rather than a remembered boolean. The question it
              asks is about the windows on screen -- "is any of them open?" --
              so opening one by hand between two presses cannot leave the
              control offering the opposite of what the pane needs. A boolean
              alternating on each press disagrees in exactly that case, which is
              what collapseAllWindows.test.tsx pins. */}
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
              // KAN-756. Keyed by session: another session's glyph is drawn, not slid to.
              renderGlyph={(glyphCss) => (
                <FoldAllGlyph
                  key={tabGroupId}
                  folds={anyWindowOpen}
                  glyphCss={glyphCss}
                />
              )}
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
            {!isSearching && (
              <span
                data-tour-anchor="open"
                css={css`
                  display: flex;
                `}
              >
                <Icon
                  tooltipText={afterTheTour?.open ?? t('Open session')}
                  ariaLabel={afterTheTour?.open ?? t('Open session')}
                  type="reopen_window"
                  disable={isOpenBlocked}
                  style={isOpenBlocked ? 'opacity: 0.3;' : undefined}
                  // KAN-698. A double-click opens once.
                  onClick={onFirstClickOnly(() => {
                    const goToURLText: string = t('Go to URL');
                    dispatch(openAllTabContainer({ tabGroupId, goToURLText }));
                  })}
                />
              </span>
            )}
            {/* KAN-279 D7. Switching closes the windows hosting Tab Keeper
              itself when this page IS the tab view, so hidden there. */}
            {!isSearching && !isTabView() && (
              <Icon
                tooltipText={afterTheTour?.switch ?? t('Switch to session')}
                ariaLabel={afterTheTour?.switch ?? t('Switch to session')}
                type="filter_center_focus"
                disable={isOpenBlocked}
                style={isOpenBlocked ? 'opacity: 0.3;' : undefined}
                onClick={onFirstClickOnly(() => {
                  dispatch(
                    requestFocusTabContainer({
                      tabGroupId,
                      goToURLText: t('Go to URL'),
                      saveTitle: t('FocusAutoSaveTitle'),
                    })
                  );
                })}
              />
            )}
            {/* KAN-468, KAN-581. Every open window replaces this session's; one ⌘Z undoes it. */}
            {!isSearching && (
              <Icon
                tooltipText={
                  afterTheTour?.replace ??
                  t('Replace this session with open windows')
                }
                ariaLabel={
                  afterTheTour?.replace ??
                  t('Replace this session with open windows')
                }
                type="browser_updated"
                disable={isOpenBlocked}
                style={isOpenBlocked ? 'opacity: 0.3;' : undefined}
                onClick={() =>
                  void dispatch(replaceSessionWithOpenWindows(tabGroupId))
                }
              />
            )}
            {/* KAN-193. Export and Delete live behind one trigger rather than as
              two more icons. A menu item carries words, so export cannot be
              misread the way its download glyph was once the flow began with
              a preview; and Delete stops sitting one mis-click from the two
              everyday actions. Deleting stays one menu away from recoverable:
              it is a captured action, so Undo restores it. */}
            {!isSearching && (
              <div
                data-tour-anchor="session-menu"
                css={css`
                  display: flex;
                `}
              >
                <OverflowMenu
                  ariaLabel={t('More actions')}
                  disabled={holdsDelete}
                  // The trigger sits near the START of the row, so the menu opens
                  // rightward, inside this pane. End-aligned, it crossed the pane
                  // divider and covered the session list.
                  align="start"
                  items={sessionMenuItems(selectedTabGroup, menuCtx)}
                />
              </div>
            )}
          </div>
          <div
            // KAN-810. Rides the session's edge as Currently open folds.
            data-pane-layer="saved-add-window"
            css={css`
              display: flex;
            `}
          >
            {!isSearching && (
              <Button
                text={t('Add window')}
                iconSize={ICON.SMALL}
                tooltipText={t('Add current window')}
                ariaLabel={t('Add window')}
                // Not a bare plus. The two saves wear a plus badge on a window
                // (KAN-780: one window, two windows) and both CREATE a session;
                // this one appends to the session already on screen. Theirs is a
                // plus on a container, which is what makes them read as a pair;
                // `playlist_add` has none, and says "add this to the list you are
                // looking at", which is what a session is.
                //
                // Measured 79.1% / 76.2% distinct from those two (KAN-5's ink
                // comparison, e2e/save-glyphs.spec.ts), against the 56.2% they
                // measure from each other. A bare `add` scored 76.6% from the old
                // add_box and was still the confusable one: the collision was in
                // the meaning, which an ink metric cannot see.
                iconType="playlist_add"
                onClick={() =>
                  void dispatch(showSessionAndAddCurrentWindow(tabGroupId))
                }
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
            )}
          </div>
          <div
            ref={newWindowTargetRef}
            data-new-window-target="first"
            aria-hidden="true"
            css={[dropBoxStyle(COLORS), newWindowTargetStyle]}
          >
            <DropBoxLabel text={t('CarryNewWindowTarget')} />
          </div>
        </div>
      </div>
      {/* KAN-708. Beside the header, not inside it: a portal's events bubble through the React tree (R1). */}
      {headerMenu.menu}
    </>
  );
}
