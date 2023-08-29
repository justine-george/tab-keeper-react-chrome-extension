import { css } from '@emotion/react';
import LeftPane from './home/LeftPane';
import RightPane from './home/RightPane';
import { useSelector } from 'react-redux';
import { RootState } from '../redux/store';
import LeftPaneSettings from './settings/LeftPaneSettings';
import RightPaneSettings from './settings/RightPaneSettings';
import { useThemeColors } from './hook/useThemeColors';
import { APP_HEIGHT } from '../utils/constants/common';
import { Toast } from './common/Toast';
import { ConflictModal } from './common/ConflictModal';

export default function MainContainer() {
  const COLORS = useThemeColors();

  const isToastOpen = useSelector(
    (state: RootState) => state.globalState.isToastOpen
  );

  const isSettingsPage = useSelector(
    (state: RootState) => state.globalState.isSettingsPage
  );

  const isConflictModalOpen = useSelector(
    (state: RootState) => state.globalState.isConflictModalOpen
  );

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
