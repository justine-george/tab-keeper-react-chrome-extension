import { useEffect } from 'react';

import { useDispatch, useSelector } from 'react-redux';

import { css } from '@emotion/react';

import LeftPane from './home/LeftPane';
import { Toast } from './common/Toast';
import RightPane from './home/RightPane';
import { useThemeColors } from './hook/useThemeColors';
import { APP_HEIGHT } from '../utils/constants/common';
import { ConflictModal } from './common/ConflictModal';
import { AppDispatch, RootState } from '../redux/store';
import { redo, undo } from '../redux/slice/undoRedoSlice';
import LeftPaneSettings from './settings/LeftPaneSettings';
import RightPaneSettings from './settings/RightPaneSettings';
import { closeToast } from '../redux/slice/globalStateSlice';

export default function MainContainer() {
  const COLORS = useThemeColors();
  const dispatch: AppDispatch = useDispatch();

  const isToastOpen = useSelector(
    (state: RootState) => state.globalState.isToastOpen
  );

  const isSettingsPage = useSelector(
    (state: RootState) => state.globalState.isSettingsPage
  );

  const isConflictModalOpen = useSelector(
    (state: RootState) => state.globalState.isConflictModalOpen
  );

  // Keyboard shortcut listener for undo/redo
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (!isSettingsPage) {
        // check for ctrl+z
        if (event.ctrlKey && event.key === 'z') {
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
    width: 50%;
    height: ${APP_HEIGHT};
    border: 1px solid ${COLORS.BORDER_COLOR};
    border-right: none;
  `;

  const rightPaneStyle = css`
    width: 50%;
    height: ${APP_HEIGHT};
    border: 1px solid ${COLORS.BORDER_COLOR};
  `;

  const leftPaneSettingsStyle = css`
    width: 30%;
    height: ${APP_HEIGHT};
    border: 1px solid ${COLORS.BORDER_COLOR};
    border-right: none;
  `;

  const rightPaneSettingsStyle = css`
    width: 70%;
    height: ${APP_HEIGHT};
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
      {isConflictModalOpen && <ConflictModal />}
    </div>
  );
}
