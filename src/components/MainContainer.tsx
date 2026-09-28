import { useCallback, useEffect, useRef, useState } from 'react';

import { useDispatch, useSelector } from 'react-redux';

import { css } from '@emotion/react';

import { isTabView } from '../utils/functions/viewMode';
import LeftPane from './home/leftpane/LeftPane';
import { Toast } from './common/Toast';
import RightPane from './home/rightpane/RightPane';
import OpenNowColumn from './home/opennow/OpenNowColumn';
import OpenNowResizeGrip from './home/opennow/OpenNowResizeGrip';
import { OPEN_NOW_RAIL_QUERY } from './home/opennow/railQuery';
import { shownOpenNowWidth } from './home/opennow/openNowWidth';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { useThemeColors } from '../hooks/useThemeColors';
import { useViewportWidth } from '../hooks/useViewportWidth';
import { APP_HEIGHT } from '../utils/constants/common';
import { AppDispatch, RootState } from '../redux/store';
import { redo, undo } from '../redux/slices/undoRedoSlice';
import { selectIsSavedSessionFolded } from '../redux/savedSessionFold';
import LeftPaneSettings from './settings/leftpane/LeftPaneSettings';
import RightPaneSettings from './settings/rightpane/RightPaneSettings';
import { closeToast } from '../redux/slices/globalStateSlice';
import { reopenFromOffer } from '../redux/reopenOffer';
import { takeOpenNowDrop } from '../redux/openNowMoveUndo';
import { undoOpenNowDrop } from '../utils/functions/openNowMoves';
import { RateAndReviewModal } from './modals/RateAndReviewModal';
import { FocusConfirmModal } from './modals/FocusConfirmModal';
import { DeleteCloudDataModal } from './modals/DeleteCloudDataModal';
import { LoadBackupModal } from './modals/LoadBackupModal';
import { CloudConsentModal } from './modals/CloudConsentModal';
import { TabGroupsPermissionModal } from './modals/TabGroupsPermissionModal';

// KAN-52. The undo/redo shortcuts are registered on `window`, so they also see
// keystrokes aimed at a text field. When they do, the browser's own undo stack
// is the right handler and this one must stand down -- both by not dispatching
// the app's session-level undo, and by not calling preventDefault(), which is
// what actually suppresses the native undo.
//
// Deliberately a blanket tagName test rather than a list of text-ish input
// types: every <input> in this app is a text field -- there are no checkboxes
// or radios anywhere in src/ -- so there is nothing for the broader check to
// get wrong today, and no type list to drift out of sync with the platform.
// Revisit if a non-text input is ever added, since this would then also
// silence the app shortcut while that control has focus.
//
// `target` is an EventTarget (no tagName, and nullable), so it has to be
// narrowed before it can be inspected.
function isNativelyUndoableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.isContentEditable
  );
}

export default function MainContainer() {
  const COLORS = useThemeColors();
  const dispatch: AppDispatch = useDispatch();

  const isSettingsPage = useSelector(
    (state: RootState) => state.globalState.isSettingsPage
  );

  const isRateAndReviewModalOpen = useSelector(
    (state: RootState) => state.globalState.isRateAndReviewModalOpen
  );

  const focusRequest = useSelector(
    (state: RootState) => state.globalState.focusRequest
  );
  const isDeleteCloudDataModalOpen = useSelector(
    (state: RootState) => state.globalState.isDeleteCloudDataModalOpen
  );
  const pendingImport = useSelector(
    (state: RootState) => state.globalState.pendingImport
  );
  const isCloudConsentModalOpen = useSelector(
    (state: RootState) => state.globalState.isCloudConsentModalOpen
  );

  const tabGroupsPromptCount = useSelector(
    (state: RootState) => state.globalState.tabGroupsPromptCount
  );

  // KAN-311 (O8c). The close the Reopen toast offers, while it shows. The
  // slice keeps the id after the toast closes, so both are read.
  const shownReopenOfferId = useSelector((state: RootState) =>
    state.globalState.isToastOpen ? state.globalState.toastReopenOfferId : null
  );

  // KAN-280 O4/O5. Folded, Open now takes the saved session's column.
  const folded = useSelector(selectIsSavedSessionFolded);

  // KAN-321 O1/O1a. The user's dragged width (or null, the default) and the
  // window's current CSS width; shownOpenNowWidth (openNowWidth.ts) turns
  // the two into the side-by-side track below.
  const openNowWidth = useSelector(
    (state: RootState) => state.settingsDataState.openNowWidth
  );
  const viewportWidth = useViewportWidth();
  // The width a grip drag in flight is showing (null when there is none).
  // Held here, not in the grip, because the grid track below is drawn from
  // it; the store only takes the width on release.
  const [liveOpenNowWidth, setLiveOpenNowWidth] = useState<number | null>(null);
  // O2. Below 1100px Open now's column is the rail, with no line to drag.
  const isNarrow = useMediaQuery(OPEN_NOW_RAIL_QUERY);

  // Open now's drawn width, in px: the drag in flight, else the stored width
  // (or the default), clamped to this window (openNowWidth.ts) -- the live
  // width too, so a window that narrows mid-drag clamps it at once, not at
  // the next pointermove. Computed once here and used two places, so they
  // cannot disagree: it reaches the grid as --open-now-width, set on the grid
  // element below (not through its Emotion class: a drag changes it on every
  // pointermove, and a class per width would insert a stylesheet rule per
  // pixel), and it is handed to the grip as drawnWidth.
  const openNowTrackWidth = shownOpenNowWidth(
    liveOpenNowWidth ?? openNowWidth,
    viewportWidth
  );
  const isTab = isTabView();
  // A callback ref, not an effect keyed on the width: React calls it each
  // time the grid element attaches, not only when the width changes. That
  // matters leaving Settings: React reuses this same <div> for Settings' grid
  // (same type, same slot) and detaches the ref there, so an effect would
  // find no element, and on the way back the width it wrote before Settings
  // would stay, even if the window was resized meanwhile. A new width is a
  // new callback, which React also attaches. Both run in the commit, before
  // paint. The popup never attaches it.
  const tabGridRef = useCallback(
    (grid: HTMLDivElement | null) => {
      grid?.style.setProperty('--open-now-width', `${openNowTrackWidth}px`);
    },
    [openNowTrackWidth]
  );

  // KAN-280 O11f. An Open now drop's undo sets a group's look only with the
  // grant.
  const hasTabGroupsPermission = useSelector(
    (state: RootState) => state.globalState.hasTabGroupsPermission
  );

  // Set when the key takes a Reopen offer (KAN-311, O8c) or undoes an Open
  // now drop (KAN-280 O11f) -- each done once -- while that press may still
  // be held: its repeats would otherwise go on to undo saved-session edits.
  const heldAfterOneTimeUndo = useRef(false);

  // Keyboard shortcut listener for undo/redo
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      // Any fresh press ends a hold after a one-time undo (KAN-311), wherever
      // it lands, a text field included, so the hold cannot outlive the
      // gesture if a keyup never arrives. Only clears; it prevents nothing.
      if (!event.repeat) heldAfterOneTimeUndo.current = false;

      // Guard the whole handler, not just undo: redo is native inside a text
      // field too (cmd+shift+z on macOS, ctrl+y on Windows).
      if (isNativelyUndoableTarget(event.target)) return;

      if (isSettingsPage) return;

      // A held key's repeats after it took the offer or undid a drop are
      // dropped, so they cannot go on to undo saved-session edits. Below the
      // guards: a repeat landing in a text field is still the field's own
      // undo.
      if (
        heldAfterOneTimeUndo.current &&
        event.repeat &&
        event.key.toLowerCase() === 'z'
      ) {
        event.preventDefault();
        return;
      }

      // Every chord needs a platform modifier. ctrl and meta are treated
      // interchangeably so one handler serves Windows/Linux and macOS.
      if (!event.ctrlKey && !event.metaKey) return;

      // KAN-54. `event.key` carries the SHIFTED character, so a real
      // Shift+Z arrives as 'Z' -- and as 'z' when CapsLock inverts Shift for
      // letters. Comparing against a lowercase literal missed the first case
      // entirely, which is why macOS redo did nothing. Normalise instead.
      const key = event.key.toLowerCase();

      // Redo is tested first and returns. That ordering is what keeps the
      // chords mutually exclusive: shift+z has to stop here, or it goes on to
      // satisfy the plain-undo branch as well and the two cancel out.
      //
      // KAN-311 (O8c). An undo or redo dismisses a plain toast, but not a
      // Reopen offer: the offer is still there to take.
      if (key === 'y' || (key === 'z' && event.shiftKey)) {
        dispatch(redo());
        if (shownReopenOfferId === null) dispatch(closeToast());
        event.preventDefault();
        return;
      }

      // KAN-280 O11f. An Open now drop, when it is the most recent Tab Keeper
      // action (a Reopen offer shown or a saved-session change since would
      // have retired it), is what the key undoes -- and only that. A drop
      // whose tabs have moved or closed since does nothing, and the key does
      // not fall through to an older action. It is taken either way, and has
      // no redo (ledger R5). Only the tab view has Open now, so the popup
      // never keeps a drop and its key works as before.
      if (key === 'z') {
        const drop = takeOpenNowDrop();
        if (drop !== null) {
          void undoOpenNowDrop(drop, hasTabGroupsPermission);
          heldAfterOneTimeUndo.current = true;
          event.preventDefault();
          return;
        }
      }

      // While a Reopen offer shows, the key takes it, as pressing Reopen does,
      // and undoes nothing (O8c). A second press before this re-renders finds
      // the offer taken and does nothing either.
      if (key === 'z' && shownReopenOfferId !== null) {
        void dispatch(reopenFromOffer(shownReopenOfferId));
        heldAfterOneTimeUndo.current = true;
        event.preventDefault();
        return;
      }

      if (key === 'z') {
        dispatch(undo());
        dispatch(closeToast());
        event.preventDefault();
      }
    }
    // The hold ends when Z is let go, or the modifier is: macOS Chrome sends
    // no Z keyup while ⌘ is still down.
    function handleKeyUp(event: KeyboardEvent) {
      if (
        event.key.toLowerCase() === 'z' ||
        event.key === 'Meta' ||
        event.key === 'Control'
      ) {
        heldAfterOneTimeUndo.current = false;
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    // cleanup
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [isSettingsPage, shownReopenOfferId, hasTabGroupsPermission, dispatch]);

  const containerStyle = css`
    display: flex;
    justify-content: space-between;
    align-content: center;
  `;

  const leftPaneStyle = css`
    width: 45%;
    height: ${APP_HEIGHT};
    min-width: 0;
    border: 1px solid ${COLORS.BORDER_COLOR};
    border-right: none;
  `;

  const rightPaneStyle = css`
    width: 55%;
    height: ${APP_HEIGHT};
    min-width: 0;
    border: 1px solid ${COLORS.BORDER_COLOR};
  `;

  const leftPaneSettingsStyle = css`
    width: 30%;
    height: ${APP_HEIGHT};
    min-width: 0;
    border: 1px solid ${COLORS.BORDER_COLOR};
    border-right: none;
  `;

  const rightPaneSettingsStyle = css`
    width: 70%;
    height: ${APP_HEIGHT};
    min-width: 0;
    border: 1px solid ${COLORS.BORDER_COLOR};
  `;

  // KAN-279 D1/D2. The tab view fills the window instead of sitting in the
  // popup's fixed 790x550 box. 356px and 238px are the popup's own 45% and
  // 30% of 790px, rounded, so the left pane reads the same size it does in
  // the popup.
  //
  // KAN-280 O1/O4. The third column is Open now's, side by side: its width
  // is --open-now-width (openNowTrackWidth above). Below 1100px it is the
  // 44px rail's (O2). Folded it is 0 at every width, and Open now sits in
  // `detail` instead: the same grid either way, so nothing changes sides.
  const tabContainerStyle = css`
    display: grid;
    grid-template-columns: 356px minmax(0, 1fr) ${folded
        ? '0'
        : 'var(--open-now-width)'};
    grid-template-areas: 'sessions detail active-session';
    ${!folded &&
    css`
      @media ${OPEN_NOW_RAIL_QUERY} {
        grid-template-columns: 356px minmax(0, 1fr) 44px;
      }
    `}
  `;

  const tabContainerSettingsStyle = css`
    display: grid;
    grid-template-columns: 238px minmax(0, 1fr) 0;
    grid-template-areas: 'sessions detail active-session';
  `;

  // width: auto overrides the popup panes' 45%/55%/30%/70% -- in a grid
  // those would shrink the item inside its track instead of letting the
  // track itself set the width. height: 100vh (not the popup's fixed
  // APP_HEIGHT) is what lets the pane fill the tab's viewport.
  const tabPaneStyle = css`
    grid-area: sessions;
    width: auto;
    height: 100vh;
    min-width: 0;
    border: 1px solid ${COLORS.BORDER_COLOR};
    border-right: none;
  `;

  const tabDetailPaneStyle = css`
    grid-area: detail;
    width: auto;
    height: 100vh;
    min-width: 0;
    border: 1px solid ${COLORS.BORDER_COLOR};
  `;

  const tabOpenNowPaneStyle = css`
    grid-area: ${folded ? 'detail' : 'active-session'};
    width: auto;
    height: 100vh;
    min-width: 0;
    overflow: hidden;
    border: 1px solid ${COLORS.BORDER_COLOR};
    /* Side by side, the detail pane's right border is already this edge. */
    ${!folded && 'border-left: none;'}
  `;

  // KAN-321 O1a. Only side by side is there a line between the saved
  // session and Open now to drag. Settings needs no test here: it renders
  // its own grid below, with no Open now and no grip.
  const showResizeGrip = isTab && !folded && !isNarrow;

  return (
    <div>
      {!isSettingsPage ? (
        <div
          ref={isTab ? tabGridRef : undefined}
          css={isTab ? tabContainerStyle : containerStyle}
        >
          <div css={isTab ? tabPaneStyle : leftPaneStyle} data-pane="sessions">
            <LeftPane />
          </div>
          {/* KAN-280 O4. Folded, the saved detail is not rendered at all.
              This slot stays in place either way, so Open now keeps its
              position among the children and is not remounted by a fold. */}
          {!(isTab && folded) && (
            <div
              css={isTab ? tabDetailPaneStyle : rightPaneStyle}
              data-pane="detail"
            >
              <RightPane />
            </div>
          )}
          {/* KAN-321 O1a. A grid item of its own on the line; inside no
              pane, so a press on it is inside no row list and starts no row
              drag. Between the two panes it resizes, so Tab and a screen
              reader reach it after the saved detail and before Open now
              (WCAG 2.4.3, the APG window splitter); its z-index, not its
              place, paints it over their padding. Like the detail's, this
              slot stays in place when the grip is hidden (false), so Open
              now is not remounted when it comes or goes. */}
          {showResizeGrip && (
            <OpenNowResizeGrip
              drawnWidth={openNowTrackWidth}
              onLiveWidth={setLiveOpenNowWidth}
            />
          )}
          {/* KAN-280. The tab view only: in the popup a click on a live tab
              would switch to it and close the popup. */}
          {isTab && (
            <div css={tabOpenNowPaneStyle} data-pane="open-now">
              <OpenNowColumn folded={folded} />
            </div>
          )}
        </div>
      ) : (
        <div css={isTab ? tabContainerSettingsStyle : containerStyle}>
          <div
            css={isTab ? tabPaneStyle : leftPaneSettingsStyle}
            data-pane="sessions"
          >
            <LeftPaneSettings />
          </div>
          <div
            css={isTab ? tabDetailPaneStyle : rightPaneSettingsStyle}
            data-pane="detail"
          >
            <RightPaneSettings />
          </div>
        </div>
      )}
      {/* Always mounted: its role="status" region has to exist before a
          toast's text arrives for a screen reader to hear it (KAN-280 O8a). */}
      <Toast />
      {isRateAndReviewModalOpen && <RateAndReviewModal />}
      {tabGroupsPromptCount !== null && <TabGroupsPermissionModal />}
      {focusRequest && <FocusConfirmModal />}
      {isDeleteCloudDataModalOpen && <DeleteCloudDataModal />}
      {pendingImport !== null && <LoadBackupModal />}
      {isCloudConsentModalOpen && <CloudConsentModal />}
    </div>
  );
}
