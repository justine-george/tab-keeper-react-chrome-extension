import { useDispatch, useSelector } from 'react-redux';

import { css } from '@emotion/react';

import Button from '../common/Button';
import { NormalLabel } from '../common/Label';
import {
  BB_PINK_THEME,
  WARM_LIGHT_THEME,
  BLUE_THEME,
  LIGHT_THEME,
  DARKENHEIMER_THEME,
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
  Language,
  Theme,
  setLanguage,
  setTheme,
  toggleAutoSync,
} from '../../redux/slice/settingsDataStateSlice';
import {
  APP_CHROME_WEBSTORE_LINK,
  APP_VERSION,
  DEV_EMAIL,
  FEEDBACK_MAIL_SUBJECT,
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
import { useTranslation } from 'react-i18next';

const SettingsDetailsContainer: React.FC = () => {
  const COLORS = useThemeColors();
  const { i18n } = useTranslation();
  const { t } = useTranslation();

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
              value={t('Themes')}
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
              tooltipText={t('Light')}
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
              tooltipText={t('Warm Light')}
              onClick={() => dispatch(setTheme(Theme.WARM_LIGHT))}
              style={`
              margin-left: 16px;
              width: 60px;
              border: 1px solid ${COLORS.BORDER_COLOR};
              background-color: ${WARM_LIGHT_THEME.PRIMARY_COLOR};
              &:hover {
                background-color: ${WARM_LIGHT_THEME.PRIMARY_COLOR};
              }
            `}
            />

            <Button
              tooltipText={t('BB Pink')}
              onClick={() => dispatch(setTheme(Theme.BB_PINK))}
              style={`
              margin-left: 16px;
              width: 60px;
              border: 1px solid ${COLORS.BORDER_COLOR};
              background-color: ${BB_PINK_THEME.PRIMARY_COLOR};
              &:hover {
                background-color: ${BB_PINK_THEME.PRIMARY_COLOR};
              }
            `}
            />
            <Button
              tooltipText={t('Darkenheimer')}
              onClick={() => dispatch(setTheme(Theme.DARKENHEIMER))}
              style={`
              margin-left: 16px;
              width: 60px;
              border: 1px solid ${COLORS.BORDER_COLOR};
              background-color: ${DARKENHEIMER_THEME.PRIMARY_COLOR};
              &:hover {
                background-color: ${DARKENHEIMER_THEME.PRIMARY_COLOR};
              }
            `}
            />
            <Button
              tooltipText={t('Blue')}
              onClick={() => dispatch(setTheme(Theme.BLUE))}
              style={`
              margin-left: 16px;
              width: 60px;
              border: 1px solid ${COLORS.BORDER_COLOR};
              background-color: ${BLUE_THEME.PRIMARY_COLOR};
              &:hover {
                background-color: ${BLUE_THEME.PRIMARY_COLOR};
              }
            `}
            />
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
              value={t('Auto Sync')}
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
              text={settingsData.isAutoSync ? t(`On`) : t(`Off`)}
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
              value={t('Sync Status')}
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
              value={t('Backup & Restore')}
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
              text={t(`Backup App Data to File`)}
              iconType="publish"
              onClick={handleExportJSON}
              style="width: 260px; justify-content: center;"
            />
            <Button
              text={t('Restore App Data from File')}
              iconType="get_app"
              onClick={handleImportJSON}
              style="width: 260px; justify-content: center; margin-top: 12px;"
            />
          </div>
        </div>
      </div>
    );
  } else if (selectedSettingsCategory.name === SettingsCategory.LANGUAGE) {
    settingsOptionsDiv = (
      <div
        css={css`
          display: flex;
          flex-direction: column;
          justify-content: flex-start;
          align-items: center;
        `}
      >
        {/* Language Switcher */}
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
              value={t('Choose Language')}
              size="1rem"
              color={COLORS.LABEL_L1_COLOR}
            />
          </div>

          <div
            css={css`
              display: grid;
              grid-template-columns: 1fr 1fr;
              gap: 12px;
              align-items: center;
              margin-top: 8px;
            `}
          >
            <Button
              text={t(`English`)}
              onClick={() => {
                i18n.changeLanguage('en');
                dispatch(setLanguage(Language.EN));
              }}
              style="width: 217px; justify-content: center;"
            />
            <Button
              text={t(`German`)}
              onClick={() => {
                i18n.changeLanguage('de');
                dispatch(setLanguage(Language.DE));
              }}
              style="width: 217px; justify-content: center;"
            />
            <Button
              text={t('Chinese')}
              onClick={() => {
                i18n.changeLanguage('zh');
                dispatch(setLanguage(Language.ZH));
              }}
              style="width: 217px; justify-content: center;"
            />
            <Button
              text={t('Japanese')}
              onClick={() => {
                i18n.changeLanguage('ja');
                dispatch(setLanguage(Language.JA));
              }}
              style="width: 217px; justify-content: center;"
            />
            <Button
              text={t(`French`)}
              onClick={() => {
                i18n.changeLanguage('fr');
                dispatch(setLanguage(Language.FR));
              }}
              style="width: 217px; justify-content: center;"
            />
            <Button
              text={t(`Portuguese`)}
              onClick={() => {
                i18n.changeLanguage('pt');
                dispatch(setLanguage(Language.PT));
              }}
              style="width: 217px; justify-content: center;"
            />
            <Button
              text={t(`Russian`)}
              onClick={() => {
                i18n.changeLanguage('ru');
                dispatch(setLanguage(Language.RU));
              }}
              style="width: 217px; justify-content: center;"
            />
            <Button
              text={t(`Spanish`)}
              onClick={() => {
                i18n.changeLanguage('es');
                dispatch(setLanguage(Language.ES));
              }}
              style="width: 217px; justify-content: center;"
            />
            <Button
              text={t(`Italian`)}
              onClick={() => {
                i18n.changeLanguage('it');
                dispatch(setLanguage(Language.IT));
              }}
              style="width: 217px; justify-content: center;"
            />
            <Button
              text={t(`Hindi`)}
              onClick={() => {
                i18n.changeLanguage('hi');
                dispatch(setLanguage(Language.HI));
              }}
              style="width: 217px; justify-content: center;"
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
          value={t('Thank you for using this app!')}
          size="1.15rem"
        />
        <div
          css={css`
            display: flex;
            flex-direction: row;
            margin-top: 30px;
          `}
        >
          <NormalLabel
            color={COLORS.LABEL_L1_COLOR}
            value={t(`Crafted with ❤️ by Justine George`)}
          />
        </div>

        <Button
          text={t('Rate this app')}
          iconType="thumb_up"
          onClick={() => window.open(APP_CHROME_WEBSTORE_LINK)}
          style="width: 250px; justify-content: center; margin-top: 40px;"
        />
        <Button
          text={t('Share your thoughts')}
          iconType="mail"
          onClick={() =>
            (window.location.href = `mailto:${DEV_EMAIL}?subject=${FEEDBACK_MAIL_SUBJECT}`)
          }
          style="width: 250px; justify-content: center; margin-top: 16px;"
        />
        <Button
          text={t('Share on Twitter (X)')}
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
