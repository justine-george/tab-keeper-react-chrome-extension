import { useDispatch, useSelector } from 'react-redux';

import { css } from '@emotion/react';

import Account from './Account';
import Button from '../common/Button';
import { NormalLabel } from '../common/Label';
import { useThemeColors } from '../hook/useThemeColors';
import { AppDispatch, RootState } from '../../redux/store';
import {
  saveToFirestoreIfDirty,
  setIsDirty,
  showToast,
  syncStateWithFirestore,
} from '../../redux/slice/globalStateSlice';
import {
  toggleAutoSync,
  toggleDarkMode,
} from '../../redux/slice/settingsDataStateSlice';
import {
  APP_VERSION,
  DEV_APPRECIATION,
  DEV_CREDITS,
  DEV_EMAIL,
  FEEDBACK_MAIL_SUBJECT,
  FEEDBACK_REQUEST,
  SETTINGS_CATEGORIES,
  SHARE_TWITTER_TEXT,
} from '../../utils/constants/common';
import { SettingsCategory } from './SettingsCategoryContainer';
import {
  TabMasterContainer,
  replaceState,
} from '../../redux/slice/tabContainerDataStateSlice';
import { setPresentStartup } from '../../redux/slice/undoRedoSlice';
import { isValidTabMasterContainer } from '../../utils/helperFunctions';

const SettingsDetailsContainer: React.FC = () => {
  const COLORS = useThemeColors();

  const dispatch: AppDispatch = useDispatch();

  const settingsCategoryList = useSelector(
    (state: RootState) => state.settingsCategoryState
  );

  const settingsData = useSelector(
    (state: RootState) => state.settingsDataState
  );

  const tabMasterContainer: TabMasterContainer = useSelector(
    (state: RootState) => state.tabContainerDataState
  );

  const containerStyle = css`
    display: flex;
    flex-direction: column;
    padding: 8px;
    flex-grow: 1;
    margin-top: 8px;
    border: 1px solid ${COLORS.BORDER_COLOR};
    overflow: auto;
    user-select: none;
  `;

  const settingsItemStyle = css`
    display: flex;
    justify-content: space-between;
    align-items: center;
    width: 250px;
    margin-bottom: 16px;
  `;

  const selectedSettingsCategory: SettingsCategory =
    settingsCategoryList.filter((settings) => settings.isSelected)[0];

  if (!selectedSettingsCategory) {
    return null;
  }

  const handleToggleAutoSync = () => {
    if (!settingsData.isAutoSync) {
      dispatch(syncStateWithFirestore());
    }
    dispatch(toggleAutoSync());
  };

  const handleExportJSON = () => {
    const dataStr =
      'data:text/json;charset=utf-8,' +
      encodeURIComponent(JSON.stringify(tabMasterContainer));
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute('href', dataStr);
    downloadAnchorNode.setAttribute(
      'download',
      `tabkeeper_backup_${APP_VERSION}_${Date.now().toString()}.json`
    );
    document.body.appendChild(downloadAnchorNode);
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
  };

  const handleImportJSON = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';

    input.onchange = (event) => {
      const file = (event.target as HTMLInputElement).files![0];
      const reader = new FileReader();

      reader.onload = (fileEvent) => {
        try {
          const content = fileEvent.target!.result as string;
          const tabDataFromJSON: TabMasterContainer = JSON.parse(content);
          // validate read JSON
          if (!isValidTabMasterContainer(tabDataFromJSON)) {
            throw new Error('Invalid JSON structure.');
          }

          // update timestamp
          tabDataFromJSON.lastModified = Date.now();

          // Dispatch the action to replace the current state
          dispatch(replaceState(tabDataFromJSON));
          dispatch(setIsDirty());
          dispatch(saveToFirestoreIfDirty());
          // reset presentState in the undoRedoState
          dispatch(
            setPresentStartup({
              tabContainerDataState: tabDataFromJSON,
            })
          );
          dispatch(
            showToast({
              toastText: `Restored tabs successfully!`,
              duration: 3000,
            })
          );
        } catch (error: any) {
          console.warn('Error restoring tabs', error);
          // Error restoring tabs
          dispatch(
            showToast({
              toastText: `Error restoring tabs: ${error.message}`,
              duration: 3000,
            })
          );
        }
      };
      reader.readAsText(file);
    };

    input.click();
  };

  let settingsOptionsDiv;
  if (selectedSettingsCategory.name === SETTINGS_CATEGORIES.GENERAL) {
    settingsOptionsDiv = (
      <div
        css={css`
          display: flex;
          flex-direction: column;
          justify-content: flex-start;
          align-items: center;
          margin-top: 40px;
        `}
      >
        <div css={settingsItemStyle}>
          <NormalLabel
            value="Toggle Theme"
            size="1rem"
            color={COLORS.LABEL_L1_COLOR}
          />
          <Button
            text={settingsData.isDarkMode ? `Light` : `Dark`}
            onClick={() => dispatch(toggleDarkMode())}
            style={`
              margin-left: 16px;
              width: 120px;
              &:hover {
                background-color: ${COLORS.INVERSE_PRIMARY_COLOR};
                border: 1px solid ${COLORS.INVERSE_PRIMARY_COLOR};
                color: ${COLORS.PRIMARY_COLOR};
              }
            `}
          />
        </div>
        <div css={settingsItemStyle}>
          <NormalLabel
            value="Auto Sync"
            size="1rem"
            color={COLORS.LABEL_L1_COLOR}
          />
          <Button
            text={settingsData.isAutoSync ? `On` : `Off`}
            onClick={handleToggleAutoSync}
            style={`
              margin-left: 16px;
              width: 120px;
            `}
          />
        </div>
      </div>
    );
  } else if (selectedSettingsCategory.name === SETTINGS_CATEGORIES.SYNC) {
    settingsOptionsDiv = (
      <div
        css={css`
          display: flex;
          justify-content: center;
          align-items: flex-start;
          margin-top: 40px;
          height: 100%;
        `}
      >
        <Account />
      </div>
    );
  } else if (
    selectedSettingsCategory.name === SETTINGS_CATEGORIES.DATA_MANAGEMENT
  ) {
    settingsOptionsDiv = (
      <div
        css={css`
          display: flex;
          flex-direction: column;
          justify-content: flex-start;
          height: 100%;
          align-items: center;
          margin-top: 40px;
          flex-grow: 1;
        `}
      >
        <Button
          text={`Backup to File`}
          iconType="publish"
          onClick={handleExportJSON}
          style="width: 250px; justify-content: center;"
        />
        <Button
          text={'Restore from File'}
          iconType="get_app"
          onClick={handleImportJSON}
          style="width: 250px; justify-content: center; margin-top: 16px;"
        />
      </div>
    );
  } else if (selectedSettingsCategory.name === SETTINGS_CATEGORIES.CREDITS) {
    settingsOptionsDiv = (
      <div
        css={css`
          display: flex;
          flex-direction: column;
          justify-content: flex-start;
          height: 100%;
          align-items: center;
          margin-top: 40px;
          flex-grow: 1;
        `}
      >
        <NormalLabel
          color={COLORS.LABEL_L1_COLOR}
          value={DEV_APPRECIATION}
          size="1.2rem"
        />
        <NormalLabel
          color={COLORS.LABEL_L1_COLOR}
          value={DEV_CREDITS}
          style="margin-top: 30px;"
        />
        <Button
          text={FEEDBACK_REQUEST}
          iconType="mail"
          onClick={() =>
            (window.location.href = `mailto:${DEV_EMAIL}?subject=${FEEDBACK_MAIL_SUBJECT}`)
          }
          style="width: 250px; justify-content: center; margin-top: 24px;"
        />
        <Button
          text={'Share on Twitter (X)'}
          iconType="send"
          onClick={() => window.open(SHARE_TWITTER_TEXT)}
          style="width: 250px; justify-content: center; margin-top: 16px;"
        />
        <NormalLabel
          color={COLORS.LABEL_L3_COLOR}
          value={`v${APP_VERSION}`}
          style={`margin: auto auto 30px;`}
        />
      </div>
    );
  }

  return <div css={containerStyle}>{settingsOptionsDiv}</div>;
};

export default SettingsDetailsContainer;
