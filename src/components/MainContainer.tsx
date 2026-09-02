import { useEffect } from 'react';

import { useDispatch, useSelector } from 'react-redux';

import { css } from '@emotion/react';

import LeftPane from './home/leftpane/LeftPane';
import { Toast } from './common/Toast';
import RightPane from './home/rightpane/RightPane';
import { useThemeColors } from '../hooks/useThemeColors';
import { APP_HEIGHT } from '../utils/constants/common';
import { AppDispatch, RootState } from '../redux/store';
import { redo, undo } from '../redux/slices/undoRedoSlice';
import LeftPaneSettings from './settings/leftpane/LeftPaneSettings';
import RightPaneSettings from './settings/rightpane/RightPaneSettings';
import { closeToast } from '../redux/slices/globalStateSlice';
import { RateAndReviewModal } from './modals/RateAndReviewModal';
import { FocusConfirmModal } from './modals/FocusConfirmModal';

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

  const isToastOpen = useSelector(
    (state: RootState) => state.globalState.isToastOpen
  );

  const isSettingsPage = useSelector(
    (state: RootState) => state.globalState.isSettingsPage
  );

  const isRateAndReviewModalOpen = useSelector(
    (state: RootState) => state.globalState.isRateAndReviewModalOpen
  );

  const focusRequest = useSelector(
    (state: RootState) => state.globalState.focusRequest
  );

  // Keyboard shortcut listener for undo/redo
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      // Guard the whole handler, not just undo: redo is native inside a text
      // field too (cmd+shift+z on macOS, ctrl+y on Windows).
      if (isNativelyUndoableTarget(event.target)) return;

      if (!isSettingsPage) {
        // check for ctrl+z
        if (event.ctrlKey && event.key === 'z') {
          dispatch(undo());
          dispatch(closeToast());
          event.preventDefault();
        }

        // check for command+z
        if (event.metaKey && event.key === 'z') {
          dispatch(undo());
          dispatch(closeToast());
          event.preventDefault();
        }

        // check for ctrl+y or ctrl+shift+z
        if (
          (event.ctrlKey && event.key === 'y') ||
          (event.ctrlKey && event.shiftKey && event.key === 'z')
        ) {
          dispatch(redo());
          dispatch(closeToast());
          event.preventDefault();
        }

        // check for command+y or command+shift+z
        if (
          (event.metaKey && event.key === 'y') ||
          (event.metaKey && event.shiftKey && event.key === 'z')
        ) {
          dispatch(redo());
          dispatch(closeToast());
          event.preventDefault();
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown);

    // cleanup
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isSettingsPage, dispatch]);

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

  return (
    <div>
      {!isSettingsPage ? (
        <div css={containerStyle}>
          <div css={leftPaneStyle}>
            <LeftPane />
          </div>
          <div css={rightPaneStyle}>
            <RightPane />
          </div>
        </div>
      ) : (
        <div css={containerStyle}>
          <div css={leftPaneSettingsStyle}>
            <LeftPaneSettings />
          </div>
          <div css={rightPaneSettingsStyle}>
            <RightPaneSettings />
          </div>
        </div>
      )}
      {isToastOpen && <Toast />}
      {isRateAndReviewModalOpen && <RateAndReviewModal />}
      {focusRequest && <FocusConfirmModal />}
    </div>
  );
}
