import { useDispatch, useSelector } from 'react-redux';

import { css } from '@emotion/react';

import Button from '../common/Button';
import { NormalLabel } from '../common/Label';
import {
  DARK_THEME,
  LIGHT_THEME,
  // CORPORATE_THEME,
  // DARCULA_THEME,
  // SOLARIZED_LIGHT_THEME,
  useThemeColors,
} from '../hook/useThemeColors';
import { AppDispatch, RootState } from '../../redux/store';
import {
  saveToFirestoreIfDirty,
  setIsDirty,
  showToast,
  syncStateWithFirestore,
} from '../../redux/slice/globalStateSlice';
import {
  Theme,
  setTheme,
  toggleAutoSync,
} from '../../redux/slice/settingsDataStateSlice';
import {
  APP_VERSION,
  DEV_APPRECIATION,
  DEV_EMAIL,
  FEEDBACK_MAIL_SUBJECT,
  FEEDBACK_REQUEST,
  SHARE_TWITTER_TEXT,
} from '../../utils/constants/common';
import { SettingsCategoryContainer } from './SettingsCategoryContainer';
import {
  TabMasterContainer,
  replaceState,
} from '../../redux/slice/tabContainerDataStateSlice';
import { setPresentStartup } from '../../redux/slice/undoRedoSlice';
import { isValidTabMasterContainer } from '../../utils/helperFunctions';
import { SettingsCategory } from '../../redux/slice/settingsCategoryStateSlice';
import LoggedIn from './Account/LoggedIn';
import NotLoggedIn from './Account/NotLoggedIn';
import Icon from '../common/Icon';

const SettingsDetailsContainer: React.FC = () => {
  const COLORS = useThemeColors();

  const dispatch: AppDispatch = useDispatch();

  const settingsCategoryList = useSelector(
    (state: RootState) => state.settingsCategoryState
  );

  const settingsData = useSelector(
    (state: RootState) => state.settingsDataState
  );

  const isSignedIn = useSelector(
    (state: RootState) => state.globalState.isSignedIn
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
    // overflow: auto;
    user-select: none;
  `;

  const selectedSettingsCategory: SettingsCategoryContainer =
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
  if (selectedSettingsCategory.name === SettingsCategory.DISPLAY) {
    settingsOptionsDiv = (
      <div
        css={css`
          display: flex;
          flex-direction: column;
          justify-content: flex-start;
          align-items: center;
        `}
      >
        {/* Theme Section */}
        <div
          css={css`
            display: flex;
            flex-direction: column;
            align-items: flex-start;
            margin-left: 72px;
            width: 100%;
            margin-top: 20px;
          `}
        >
          <div
            css={css`
              display: flex;
              align-items: flex-start;
              width: 100%;
            `}
          >
            <NormalLabel
              value="Themes"
              size="1rem"
              color={COLORS.LABEL_L1_COLOR}
            />
          </div>

          <div
            css={css`
              display: flex;
              justify-content: flex-start;
              align-items: center;
              width: 250px;
              margin-top: 8px;
            `}
          >
            <Button
              onClick={() => dispatch(setTheme(Theme.LIGHT))}
              style={`
              width: 60px;
              border: 1px solid ${COLORS.BORDER_COLOR};
              background-color: ${LIGHT_THEME.PRIMARY_COLOR};
              &:hover {
                background-color: ${LIGHT_THEME.PRIMARY_COLOR};
              }
            `}
            />
            <Button
              onClick={() => dispatch(setTheme(Theme.DARK))}
              style={`
              margin-left: 16px;
              width: 60px;
              border: 1px solid ${COLORS.BORDER_COLOR};
              background-color: ${DARK_THEME.PRIMARY_COLOR};
              &:hover {
                background-color: ${DARK_THEME.PRIMARY_COLOR};
              }
            `}
            />
            {/* <Button
              onClick={() => dispatch(setTheme(Theme.CORPORATE))}
              style={`
              margin-left: 16px;
              width: 60px;
              border: 1px solid ${COLORS.BORDER_COLOR};
              background-color: ${CORPORATE_THEME.PRIMARY_COLOR};
              &:hover {
                background-color: ${CORPORATE_THEME.PRIMARY_COLOR};
              }
            `}
            />
            <Button
              onClick={() => dispatch(setTheme(Theme.SOLARIZED_LIGHT))}
              style={`
              margin-left: 16px;
              width: 60px;
              border: 1px solid ${COLORS.BORDER_COLOR};
              background-color: ${SOLARIZED_LIGHT_THEME.PRIMARY_COLOR};
              &:hover {
                background-color: ${SOLARIZED_LIGHT_THEME.PRIMARY_COLOR};
              }
            `}
            />
            <Button
              onClick={() => dispatch(setTheme(Theme.DARCULA))}
              style={`
              margin-left: 16px;
              width: 60px;
              border: 1px solid ${COLORS.BORDER_COLOR};
              background-color: ${DARCULA_THEME.PRIMARY_COLOR};
              &:hover {
                background-color: ${DARCULA_THEME.PRIMARY_COLOR};
              }
            `}
            /> */}
          </div>
        </div>
      </div>
    );
  } else if (selectedSettingsCategory.name === SettingsCategory.SYNC) {
    settingsOptionsDiv = (
      <div
        css={css`
          display: flex;
          flex-direction: column;
          justify-content: flex-start;
          align-items: center;
        `}
      >
        {/* Auto Sync */}
        <div
          css={css`
            display: flex;
            flex-direction: column;
            align-items: flex-start;
            margin-left: 72px;
            width: 100%;
            margin-top: 20px;
          `}
        >
          <div
            css={css`
              display: flex;
              align-items: flex-start;
              width: 100%;
            `}
          >
            <NormalLabel
              value="Auto Sync"
              size="1rem"
              color={COLORS.LABEL_L1_COLOR}
            />
          </div>

          <div
            css={css`
              display: flex;
              justify-content: space-between;
              align-items: center;
              width: 250px;
              margin-top: 8px;
            `}
          >
            <Button
              text={settingsData.isAutoSync ? `On` : `Off`}
              onClick={handleToggleAutoSync}
              style={`
              width: 120px;
            `}
            />
          </div>
        </div>

        {/* Sync Status */}
        <div
          css={css`
            display: flex;
            flex-direction: column;
            align-items: flex-start;
            margin-left: 72px;
            width: 100%;
            margin-top: 20px;
          `}
        >
          <div
            css={css`
              display: flex;
              align-items: flex-start;
              width: 100%;
            `}
          >
            <NormalLabel
              value="Sync Status"
              size="1rem"
              color={COLORS.LABEL_L1_COLOR}
            />
          </div>
          {isSignedIn ? <LoggedIn /> : <NotLoggedIn />}
        </div>
      </div>
    );
  } else if (
    selectedSettingsCategory.name === SettingsCategory.DATA_MANAGEMENT
  ) {
    settingsOptionsDiv = (
      <div
        css={css`
          display: flex;
          flex-direction: column;
          justify-content: flex-start;
          align-items: center;
        `}
      >
        {/* Backup & Restore */}
        <div
          css={css`
            display: flex;
            flex-direction: column;
            align-items: flex-start;
            margin-left: 72px;
            width: 100%;
            margin-top: 20px;
          `}
        >
          <div
            css={css`
              display: flex;
              align-items: flex-start;
              width: 100%;
            `}
          >
            <NormalLabel
              value="Backup & Restore"
              size="1rem"
              color={COLORS.LABEL_L1_COLOR}
            />
          </div>

          <div
            css={css`
              display: flex;
              flex-direction: column;
              justify-content: space-between;
              align-items: center;
              margin-top: 8px;
            `}
          >
            <Button
              text={`Backup App Data to File`}
              iconType="publish"
              onClick={handleExportJSON}
              style="width: 260px; justify-content: center;"
            />
            <Button
              text={'Restore App Data from File'}
              iconType="get_app"
              onClick={handleImportJSON}
              style="width: 260px; justify-content: center; margin-top: 12px;"
            />
          </div>
        </div>
      </div>
    );
  } else if (selectedSettingsCategory.name === SettingsCategory.ABOUT) {
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
        <div
          css={css`
            display: flex;
            flex-direction: row;
            margin-top: 30px;
          `}
        >
          <NormalLabel color={COLORS.LABEL_L1_COLOR} value={`Crafted with`} />
          <Icon
            type="favorite"
            disable={true}
            focusable={false}
            size="1.1rem"
            style={`
            color: ${COLORS.LABEL_L1_COLOR}
            `}
          />
          <NormalLabel
            color={COLORS.LABEL_L1_COLOR}
            value={`by Justine George`}
          />
        </div>

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
