import { useEffect, useRef } from 'react';

import { useDispatch, useSelector } from 'react-redux';

import { css } from '@emotion/react';

import { isTabView } from '../utils/functions/viewMode';
import LeftPane from './home/leftpane/LeftPane';
import { Toast } from './common/Toast';
import RightPane from './home/rightpane/RightPane';
import OpenNowColumn from './home/opennow/OpenNowColumn';
import { OPEN_NOW_RAIL_QUERY } from './home/opennow/railQuery';
import { useThemeColors } from '../hooks/useThemeColors';
import { APP_HEIGHT } from '../utils/constants/common';
import { AppDispatch, RootState } from '../redux/store';
import { redo, undo } from '../redux/slices/undoRedoSlice';
import { selectIsSavedSessionFolded } from '../redux/savedSessionFold';
import LeftPaneSettings from './settings/leftpane/LeftPaneSettings';
import RightPaneSettings from './settings/rightpane/RightPaneSettings';
import { closeToast } from '../redux/slices/globalStateSlice';
import { reopenFromOffer } from '../redux/reopenOffer';
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

  // KAN-311 (O8c). Set when the key takes a Reopen offer, while that press
  // may still be held: its repeats would otherwise go on to undo
  // saved-session edits once the toast has gone.
  const heldAfterReopen = useRef(false);

  // Keyboard shortcut listener for undo/redo
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      // A held key's repeats after it took the offer are dropped. Any fresh
      // press ends the hold, so it cannot stick if a keyup never arrives.
      if (heldAfterReopen.current) {
        if (event.repeat && event.key.toLowerCase() === 'z') {
          event.preventDefault();
          return;
        }
        if (!event.repeat) heldAfterReopen.current = false;
      }

      // Guard the whole handler, not just undo: redo is native inside a text
      // field too (cmd+shift+z on macOS, ctrl+y on Windows).
      if (isNativelyUndoableTarget(event.target)) return;

      if (isSettingsPage) return;

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

      // While a Reopen offer shows, the key takes it, as pressing Reopen does,
      // and undoes nothing (O8c). A second press before this re-renders finds
      // the offer taken and does nothing either.
      if (key === 'z' && shownReopenOfferId !== null) {
        void dispatch(reopenFromOffer(shownReopenOfferId));
        heldAfterReopen.current = true;
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
        heldAfterReopen.current = false;
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    // cleanup
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [isSettingsPage, shownReopenOfferId, dispatch]);

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
  // KAN-280 O1/O4. The third column is Open now's, side by side: 340px, 420px
  // from 1600px wide. Below 1100px it is the 44px rail's (O2). Folded it is 0
  // at every width, and Open now sits in `detail` instead: the same grid
  // either way, so nothing changes sides.
  const tabContainerStyle = css`
    display: grid;
    grid-template-columns: 356px minmax(0, 1fr) ${folded ? '0' : '340px'};
    grid-template-areas: 'sessions detail active-session';
    ${!folded &&
    css`
      @media (min-width: 1600px) {
        grid-template-columns: 356px minmax(0, 1fr) 420px;
      }
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

  const isTab = isTabView();

  return (
    <div>
      {!isSettingsPage ? (
        <div css={isTab ? tabContainerStyle : containerStyle}>
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
