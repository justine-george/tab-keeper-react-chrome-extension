import { useCallback, useEffect, useRef, useState } from 'react';

import { useDispatch, useSelector, useStore } from 'react-redux';

import { css } from '@emotion/react';

import { isTabView } from '../utils/functions/viewMode';
import LeftPane from './home/leftpane/LeftPane';
import { Toast } from './common/Toast';
import { CarryLayer } from './home/CarryLayer';
import { TooltipLayer } from './common/TooltipLayer';
import FirstRun from './tour/FirstRun';
import ReplayNote from './tour/ReplayNote';
import RightPane from './home/rightpane/RightPane';
import OpenNowColumn from './home/opennow/OpenNowColumn';
import PaneResizeGrip from './home/PaneResizeGrip';
import { OPEN_NOW_RAIL_QUERY } from './home/opennow/railQuery';
import { paneWidths } from './home/paneWidths';
import { useThemeColors } from '../hooks/useThemeColors';
import { useViewportWidth } from '../hooks/useViewportWidth';
import { useIsOpenNowGripShown } from '../hooks/useIsOpenNowGripShown';
import { useIsListGripShown } from '../hooks/useIsListGripShown';
import { useDialogEscape } from '../hooks/useDialogEscape';
import { APP_HEIGHT, SETTINGS_COLUMN } from '../utils/constants/common';
import { AppDispatch, RootState } from '../redux/store';
import { selectNextStep } from '../redux/slices/undoRedoSlice';
import { redoStep, undoStep } from '../redux/undoHistory';
import { selectIsSavedSessionFolded } from '../redux/savedSessionFold';
import LeftPaneSettings from './settings/leftpane/LeftPaneSettings';
import RightPaneSettings from './settings/rightpane/RightPaneSettings';
import {
  closePlainToasts,
  selectUndoKeyTarget,
} from '../redux/slices/globalStateSlice';
import { reopenFromOffer } from '../redux/reopenOffer';
import { ReviewCard } from './reviewCard/ReviewCard';
import { FocusConfirmModal } from './modals/FocusConfirmModal';
import { DeleteCloudDataModal } from './modals/DeleteCloudDataModal';
import { LoadBackupModal } from './modals/LoadBackupModal';
import { CloudConsentModal } from './modals/CloudConsentModal';
import { PinGuideModal } from './modals/PinGuideModal';
import { SetupModal } from './modals/SetupModal';
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
  // The key handler reads the store at keydown, never a value from the last render (KAN-744).
  const store = useStore<RootState>();
  useDialogEscape();

  const isSettingsPage = useSelector(
    (state: RootState) => state.globalState.isSettingsPage
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

  const isPinGuideOpen = useSelector(
    (state: RootState) => state.globalState.isPinGuideOpen
  );
  const isSetupOpen = useSelector(
    (state: RootState) => state.globalState.isSetupOpen
  );

  const tabGroupsPromptCount = useSelector(
    (state: RootState) => state.globalState.tabGroupsPromptCount
  );

  // KAN-280 O4/O5. Folded, Open now takes the saved session's column.
  const folded = useSelector(selectIsSavedSessionFolded);
  // Settings needs no test here: it renders its own grid, with no Open now and no grip.
  const showResizeGrip = useIsOpenNowGripShown();
  const showListGrip = useIsListGripShown();

  // KAN-321 O1/O1a and KAN-687. The widths the user dragged Open now and
  // the list to (or null, the default) and the window's current CSS width;
  // paneWidths.ts turns them into the tab view's tracks below.
  const openNowWidth = useSelector(
    (state: RootState) => state.settingsDataState.openNowWidth
  );
  const listWidth = useSelector(
    (state: RootState) => state.settingsDataState.listWidth
  );
  const viewportWidth = useViewportWidth();
  // The width a grip drag in flight is showing (null when there is none).
  // Held here, not in the grip, because the grid tracks below are drawn from
  // it; the store only takes the width on release.
  const [liveOpenNowWidth, setLiveOpenNowWidth] = useState<number | null>(null);
  const [liveListWidth, setLiveListWidth] = useState<number | null>(null);

  // The drawn widths, in px: a drag in flight, else the stored width (or
  // the default), clamped to this window -- the live width too, so a window
  // that narrows mid-drag clamps it at once, not at the next pointermove.
  // Computed once here and used two places, so they cannot disagree: they
  // reach the grid as --list-width and --open-now-width, set on the grid
  // element below (not through its Emotion class: a drag changes one on
  // every pointermove, and a class per width would insert a stylesheet rule
  // per pixel), and they are handed to the grips.
  const drawn = paneWidths(viewportWidth, folded, {
    list: liveListWidth ?? listWidth,
    openNow: liveOpenNowWidth ?? openNowWidth,
  });
  // What a press or an arrow key starts from: the stored widths alone.
  const resting = paneWidths(viewportWidth, folded, {
    list: listWidth,
    openNow: openNowWidth,
  });
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
      grid?.style.setProperty('--list-width', `${drawn.list}px`);
      grid?.style.setProperty('--open-now-width', `${drawn.openNow}px`);
    },
    [drawn.list, drawn.openNow]
  );

  // KAN-744 R20. While true, a held undo or redo key's repeats are dropped, so
  // they cannot roll back tab moves, take a Reopen offer or go past a refusal.
  // Set when a press takes an offer, runs a live step or is refused, or when a
  // repeat reaches a live step or an offer; ends on keyup.
  const repeatsDropped = useRef(false);
  // Counts fresh presses, so a result that lands after a newer press cannot
  // start a hold for the old one.
  const freshPresses = useRef(0);

  // Keyboard shortcut listener for undo/redo
  useEffect(() => {
    // The hold starts from the result, which lands after keydown returns. A
    // repeat before that finds the step still live and is dropped itself.
    // A 'busy' press (a step or an Open now move still running) starts none.
    function holdAfterRun(press: number, run: Promise<unknown>) {
      void run.then((action) => {
        if (press !== freshPresses.current) return;
        if (
          !undoStep.fulfilled.match(action) &&
          !redoStep.fulfilled.match(action)
        ) {
          return;
        }
        const result = action.payload;
        if (result === 'live' || result === 'refused' || result === 'failed') {
          repeatsDropped.current = true;
        }
      });
    }

    function handleKeyDown(event: KeyboardEvent) {
      // Any fresh press ends a hold (KAN-311, R20), wherever it lands, a text
      // field included, so the hold cannot outlive the gesture if a keyup
      // never arrives. Only clears; it prevents nothing.
      if (!event.repeat) {
        repeatsDropped.current = false;
        freshPresses.current += 1;
      }

      // Guard the whole handler, not just undo: redo is native inside a text
      // field too (cmd+shift+z on macOS, ctrl+y on Windows).
      if (isNativelyUndoableTarget(event.target)) return;

      if (isSettingsPage) return;

      // KAN-54. `event.key` carries the SHIFTED character, so a real
      // Shift+Z arrives as 'Z' -- and as 'z' when CapsLock inverts Shift for
      // letters. Comparing against a lowercase literal missed the first case
      // entirely, which is why macOS redo did nothing. Normalise instead.
      const key = event.key.toLowerCase();

      // KAN-744 R20. A held key's repeats are dropped once the hold is on.
      // Below the guards: a repeat landing in a text field is still the
      // field's own undo.
      if (
        repeatsDropped.current &&
        event.repeat &&
        (key === 'z' || key === 'y')
      ) {
        event.preventDefault();
        return;
      }

      // Every chord needs a platform modifier. ctrl and meta are treated
      // interchangeably so one handler serves Windows/Linux and macOS.
      if (!event.ctrlKey && !event.metaKey) return;

      // Redo is tested first and returns. That ordering is what keeps the
      // chords mutually exclusive: shift+z has to stop here, or it goes on to
      // satisfy the plain-undo branch as well and the two cancel out.
      //
      // KAN-744 R2. Redo takes the step undone last, saved or live, and
      // never a Reopen offer. An undo or redo dismisses a plain toast, but not
      // an offer: it is still there to take (KAN-311, O8c).
      if (key === 'y' || (key === 'z' && event.shiftKey)) {
        const nextRedo = selectNextStep(store.getState(), 'redo');
        // KAN-744 R20. A repeat never runs a live step; it starts the hold.
        if (event.repeat && nextRedo === 'live') {
          repeatsDropped.current = true;
          event.preventDefault();
          return;
        }
        // KAN-349. A press with nothing to redo still closes plain toasts; redoStep closes them for a step.
        if (nextRedo === null) dispatch(closePlainToasts());
        holdAfterRun(freshPresses.current, dispatch(redoStep()));
        event.preventDefault();
        return;
      }

      if (key !== 'z') return;
      event.preventDefault();
      // KAN-744 R17. Read at keydown, so two presses before a re-render
      // cannot both take one offer: the offer when it came after the newest
      // live step (as pressing Reopen does, undoing nothing, O8c), else the
      // newest step in the history.
      const state = store.getState();
      const target = selectUndoKeyTarget(state);
      const next = selectNextStep(state, 'undo');
      // KAN-744 R20. A repeat never takes an offer or runs a live step; it starts the hold.
      if (event.repeat && (target?.kind === 'offer' || next === 'live')) {
        repeatsDropped.current = true;
        return;
      }
      if (target?.kind === 'offer') {
        void dispatch(reopenFromOffer(target.offerId));
        repeatsDropped.current = true;
        return;
      }
      // KAN-349. A press with nothing to undo still closes plain toasts; undoStep closes them for a step.
      if (next === null) dispatch(closePlainToasts());
      holdAfterRun(freshPresses.current, dispatch(undoStep()));
    }
    // The hold ends when Z or Y is let go, or the modifier is: macOS Chrome
    // sends no Z keyup while ⌘ is still down.
    function handleKeyUp(event: KeyboardEvent) {
      if (
        event.key.toLowerCase() === 'z' ||
        event.key.toLowerCase() === 'y' ||
        event.key === 'Meta' ||
        event.key === 'Control'
      ) {
        repeatsDropped.current = false;
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    // cleanup
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [isSettingsPage, store, dispatch]);

  const containerStyle = css`
    display: flex;
    justify-content: space-between;
    align-content: center;
  `;

  const leftPaneStyle = css`
    width: 45%;
    height: ${APP_HEIGHT};
    min-width: 0;
    border: 1px solid ${COLORS.PANEL_BORDER_COLOR};
    border-right: none;
  `;

  const rightPaneStyle = css`
    width: 55%;
    height: ${APP_HEIGHT};
    min-width: 0;
    border: 1px solid ${COLORS.PANEL_BORDER_COLOR};
  `;

  const leftPaneSettingsStyle = css`
    width: ${SETTINGS_COLUMN.POPUP_PERCENT}%;
    height: ${APP_HEIGHT};
    min-width: 0;
    border: 1px solid ${COLORS.PANEL_BORDER_COLOR};
    border-right: none;
  `;

  const rightPaneSettingsStyle = css`
    width: ${100 - SETTINGS_COLUMN.POPUP_PERCENT}%;
    height: ${APP_HEIGHT};
    min-width: 0;
    border: 1px solid ${COLORS.PANEL_BORDER_COLOR};
  `;

  // KAN-279 D1/D2. The tab view fills the window instead of sitting in the
  // popup's fixed 790x550 box. KAN-687: the list's column is --list-width
  // (paneWidths.ts), never under 356px, the popup's own 45% of 790px;
  // Settings' 238px is its 30%.
  //
  // KAN-280 O1/O4. The third column is Open now's, side by side: its width
  // is --open-now-width (openNowTrackWidth above). Below 1100px it is the
  // 44px rail's (O2). Folded it is 0 at every width, and Open now sits in
  // `detail` instead: the same grid either way, so nothing changes sides.
  const tabContainerStyle = css`
    display: grid;
    grid-template-columns: var(--list-width) minmax(0, 1fr) ${
        folded ? '0' : 'var(--open-now-width)'
      };
    grid-template-areas: 'sessions detail active-session';
    ${
      !folded &&
      css`
        @media ${OPEN_NOW_RAIL_QUERY} {
          grid-template-columns: 356px minmax(0, 1fr) 44px;
        }
      `
    }
  `;

  const tabContainerSettingsStyle = css`
    display: grid;
    grid-template-columns: ${SETTINGS_COLUMN.TAB_PX}px minmax(0, 1fr) 0;
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
    border: 1px solid ${COLORS.PANEL_BORDER_COLOR};
    border-right: none;
  `;

  const tabDetailPaneStyle = css`
    grid-area: detail;
    width: auto;
    height: 100vh;
    min-width: 0;
    border: 1px solid ${COLORS.PANEL_BORDER_COLOR};
  `;

  const tabOpenNowPaneStyle = css`
    grid-area: ${folded ? 'detail' : 'active-session'};
    width: auto;
    height: 100vh;
    min-width: 0;
    overflow: hidden;
    border: 1px solid ${COLORS.PANEL_BORDER_COLOR};
    /* Side by side, the detail pane's right border is already this edge. */
    ${!folded && 'border-left: none;'}
  `;

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
          {/* KAN-687. On the list's right edge, between the list and the
              pane beside it in Tab order. Like the other grip's, this slot
              stays in place when hidden (false). */}
          {showListGrip && (
            <PaneResizeGrip
              pane="list"
              drawnWidth={drawn.list}
              restingWidth={resting.list}
              range={drawn.listRange}
              onLiveWidth={setLiveListWidth}
            />
          )}
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
            <PaneResizeGrip
              pane="openNow"
              drawnWidth={drawn.openNow}
              restingWidth={resting.openNow}
              range={drawn.openNowRange}
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
      {/* KAN-350. Outside every pane, so it outlives the area a carried
          drag started in. Draws nothing unless something is carried, or a
          saved list's drag shows its card at the pointer (KAN-354). */}
      <CarryLayer />
      {/* KAN-695. The one tooltip chip for this page, outside every pane. */}
      <TooltipLayer />
      {/* Draws nothing unless this page shows the run; R3 hides its card while Settings is open. */}
      <FirstRun />
      <ReplayNote />
      <ReviewCard />
      {tabGroupsPromptCount !== null && <TabGroupsPermissionModal />}
      {focusRequest && <FocusConfirmModal />}
      {isDeleteCloudDataModalOpen && <DeleteCloudDataModal />}
      {pendingImport !== null && <LoadBackupModal />}
      {isCloudConsentModalOpen && <CloudConsentModal />}
      {isPinGuideOpen && <PinGuideModal />}
      {isSetupOpen && <SetupModal />}
    </div>
  );
}
