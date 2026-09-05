import { Fragment } from 'react';

import { useDispatch, useSelector } from 'react-redux';

import { css } from '@emotion/react';

import Button from '../../common/Button';
import { NormalLabel } from '../../common/Label';
import {
  BB_PINK_THEME,
  WARM_LIGHT_THEME,
  BLUE_THEME,
  LIGHT_THEME,
  DARKENHEIMER_THEME,
  useThemeColors,
} from '../../../hooks/useThemeColors';
import { AppDispatch, RootState } from '../../../redux/store';
import {
  saveToFirestoreIfDirty,
  setIsDirty,
  showToast,
  syncStateWithFirestore,
} from '../../../redux/slices/globalStateSlice';
import {
  Language,
  Theme,
  setLanguage,
  setTheme,
  toggleAutoSync,
  toggleLazyLoad,
} from '../../../redux/slices/settingsDataStateSlice';
import {
  APP_CHROME_WEBSTORE_LINK,
  APP_VERSION,
  DEV_EMAIL,
  FEEDBACK_MAIL_SUBJECT,
  IMPORT_ERROR_FRAME,
  SHARE_TWITTER_TEXT,
  TOAST_MESSAGES,
} from '../../../utils/constants/common';
import { SettingsCategoryContainer } from '../leftpane/SettingsCategoryContainer';
import {
  TabMasterContainer,
  restoreContainer,
} from '../../../redux/slices/tabContainerDataStateSlice';
import {
  readImportedContainer,
  TranslatableError,
} from '../../../utils/functions/local';
import {
  removeTabGroupsPermission,
  requestTabGroupsPermission,
} from '../../../utils/functions/permissions';
import { SettingsCategory } from '../../../redux/slices/settingsCategoryStateSlice';
import LoggedIn from './Account/LoggedIn';
import NotLoggedIn from './Account/NotLoggedIn';
import { useTranslation } from 'react-i18next';

// KAN-88. The five theme swatches were visually and semantically identical --
// same border, no ARIA state -- so nothing said which theme was actually in
// use. The only thing that differed was each swatch's own fill, which is the
// theme's colour, not a selection marker, and on a dark theme the active one
// is the swatch that blends into the background.
//
// The marker is the swatch's OWN border, thickened (KAN-95).
//
// It was an outline in TEXT_COLOR, for a reason that was sound and a weight
// that was not. Sound: a border changes the box, and growing one would shove
// the other four swatches sideways as selection moved, so an outline avoided
// the layout entirely. Not sound: TEXT_COLOR measures 9.2-13.8:1 against the
// page, which is focus-ring weight on a passive state marker, and 2px of
// outline plus 2px of offset exactly consumed the row's 4px gap, so the ring
// touched its neighbours. With the swatch's own 1px border still underneath,
// the active one drew two concentric lines. Reported as cramped, and rejected
// for the same reason KAN-87's accent bar was: contrast is the right axis to
// MEASURE and the wrong one to MAXIMISE.
//
// Growing the border is safe here because App.css sets `* { box-sizing:
// border-box }` globally, so the swatch keeps its size and the row never
// reflows. That is a property of the app, not of this helper -- an earlier
// version of this comment claimed the helper established it, which was wrong:
// a mutation removing the declaration changed nothing, because the global
// reset had already done the work. themeSwatchMarker.spec's size assertion is
// what holds the app to it, and it dies if this element is ever forced back to
// content-box.
//
// LABEL_L3_COLOR, not BORDER_COLOR: measured against the page, BORDER_COLOR is
// 1.38-1.73:1 on four of the five themes and would be invisible. LABEL_L3 is
// the only existing token in a sane band (2.56-4.03:1).
const themeSwatchMarker = (isActive: boolean, markerColor: string): string =>
  isActive ? `border-color: ${markerColor}; border-width: 2px;` : '';

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

  const hasTabGroups = useSelector(
    (state: RootState) => state.globalState.hasTabGroupsPermission
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
    /* Contain this pane's content. Several settings rows are still laid out at
       fixed pixel widths, so without this they push the whole popup wide
       instead of scrolling within the pane. */
    overflow: auto;
    min-width: 0;
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

  const handleToggleLazyLoadTabs = () => {
    dispatch(toggleLazyLoad());
  };

  // Fire-and-forget on purpose -- see requestTabGroupsPermission. The button's
  // label is driven by hasTabGroupsPermission from the store, which is
  // refreshed by the change listener or by the next popup open, so the UI
  // catches up even when this popup is destroyed by the native prompt.
  const handleToggleTabGroups = () => {
    if (hasTabGroups) {
      removeTabGroupsPermission();
    } else {
      requestTabGroupsPermission();
    }
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

      // async so the cloud write below can be awaited. Its rejection used to
      // land after this callback had already returned, which put it outside
      // the try and left the success toast already fired (KAN-43).
      reader.onload = async (fileEvent) => {
        try {
          const content = fileEvent.target!.result as string;
          // Parses, validates the structure, and refuses anything that would
          // not fit in a Firestore document (KAN-27). Throws on every one of
          // those, which the catch below turns into the error toast.
          const tabDataFromJSON: TabMasterContainer =
            readImportedContainer(content);

          // update timestamp
          tabDataFromJSON.lastModified = Date.now();

          // restoreContainer, not replaceState: a backup written before a
          // session was deleted still contains it and carries no tombstone,
          // but the cloud may hold the one that delete pushed up. Replacing
          // blind lets the next merge re-apply the delete, so the import
          // appears to work and then silently drops that session.
          dispatch(restoreContainer(tabDataFromJSON));
          dispatch(setIsDirty());

          // The restore is already done and persisted at this point, so what
          // is being reported below is the state of the *cloud write*, not of
          // the import. requestStatus rather than .unwrap(): unwrap would
          // throw into the catch and produce "Error restoring tabs", which is
          // the one thing that is definitely untrue here.
          const saveResult = await dispatch(saveToFirestoreIfDirty());
          const syncFailed = saveResult.meta.requestStatus === 'rejected';

          dispatch(
            showToast({
              toastText: syncFailed
                ? TOAST_MESSAGES.IMPORT_SYNC_FAILED
                : TOAST_MESSAGES.IMPORT_SUCCESS,
              duration: 3000,
            })
          );
        } catch (error: any) {
          console.warn('Error restoring tabs', error);
          // KAN-86. This used to dispatch a concatenated sentence, which
          // matched no i18n key, so t() handed it straight back and every
          // locale saw English on the one path a user most needs to read.
          //
          // Two kinds of failure arrive here and they cannot be treated alike.
          // Our own refusals are TranslatableErrors carrying a key, so they
          // translate. A platform error -- JSON.parse's SyntaxError, which
          // names the offending token -- is an unbounded English string with
          // no key to have; it is passed through as raw technical detail
          // inside a translated frame, which is strictly better than dropping
          // the only part that says what is actually wrong with the file.
          dispatch(
            showToast({
              toastText: IMPORT_ERROR_FRAME,
              toastParams: {
                detail:
                  error instanceof TranslatableError
                    ? t(error.i18nKey, error.i18nParams)
                    : error.message,
              },
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
            padding-left: clamp(16px, 8%, 72px);
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
              flex-wrap: wrap;
              gap: 4px;
              max-width: 100%;
              margin-top: 8px;
            `}
          >
            <Button
              tooltipText={t('Light')}
              ariaPressed={settingsData.theme === Theme.LIGHT}
              onClick={() => dispatch(setTheme(Theme.LIGHT))}
              style={`
              width: 60px;
              border: 1px solid ${COLORS.BORDER_COLOR};
              background-color: ${LIGHT_THEME.PRIMARY_COLOR};
              ${themeSwatchMarker(
                settingsData.theme === Theme.LIGHT,
                COLORS.LABEL_L3_COLOR
              )}
              &:hover {
                background-color: ${LIGHT_THEME.PRIMARY_COLOR};
              }
            `}
            />
            <Button
              tooltipText={t('Warm Light')}
              ariaPressed={settingsData.theme === Theme.WARM_LIGHT}
              onClick={() => dispatch(setTheme(Theme.WARM_LIGHT))}
              style={`
              width: 60px;
              border: 1px solid ${COLORS.BORDER_COLOR};
              background-color: ${WARM_LIGHT_THEME.PRIMARY_COLOR};
              ${themeSwatchMarker(
                settingsData.theme === Theme.WARM_LIGHT,
                COLORS.LABEL_L3_COLOR
              )}
              &:hover {
                background-color: ${WARM_LIGHT_THEME.PRIMARY_COLOR};
              }
            `}
            />

            <Button
              tooltipText={t('BB Pink')}
              ariaPressed={settingsData.theme === Theme.BB_PINK}
              onClick={() => dispatch(setTheme(Theme.BB_PINK))}
              style={`
              width: 60px;
              border: 1px solid ${COLORS.BORDER_COLOR};
              background-color: ${BB_PINK_THEME.PRIMARY_COLOR};
              ${themeSwatchMarker(
                settingsData.theme === Theme.BB_PINK,
                COLORS.LABEL_L3_COLOR
              )}
              &:hover {
                background-color: ${BB_PINK_THEME.PRIMARY_COLOR};
              }
            `}
            />
            <Button
              tooltipText={t('Darkenheimer')}
              ariaPressed={settingsData.theme === Theme.DARKENHEIMER}
              onClick={() => dispatch(setTheme(Theme.DARKENHEIMER))}
              style={`
              width: 60px;
              border: 1px solid ${COLORS.BORDER_COLOR};
              background-color: ${DARKENHEIMER_THEME.PRIMARY_COLOR};
              ${themeSwatchMarker(
                settingsData.theme === Theme.DARKENHEIMER,
                COLORS.LABEL_L3_COLOR
              )}
              &:hover {
                background-color: ${DARKENHEIMER_THEME.PRIMARY_COLOR};
              }
            `}
            />
            <Button
              tooltipText={t('Blue')}
              ariaPressed={settingsData.theme === Theme.BLUE}
              onClick={() => dispatch(setTheme(Theme.BLUE))}
              style={`
              width: 60px;
              border: 1px solid ${COLORS.BORDER_COLOR};
              background-color: ${BLUE_THEME.PRIMARY_COLOR};
              ${themeSwatchMarker(
                settingsData.theme === Theme.BLUE,
                COLORS.LABEL_L3_COLOR
              )}
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
            padding-left: clamp(16px, 8%, 72px);
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
              width: 100%;
              max-width: 250px;
              margin-top: 8px;
            `}
          >
            <Button
              text={settingsData.isAutoSync ? t(`On`) : t(`Off`)}
              // KAN-88. The button's whole visible text is its VALUE, and the
              // setting's name is an unassociated sibling label, so the
              // accessible name used to be just "On" -- announced with no
              // indication of what was on.
              //
              // The name has to CONTAIN the visible text (WCAG 2.5.3), so it
              // is "<setting>: <value>" rather than the setting alone; a bare
              // "Auto Sync" over a button reading "On" would fail the Label in
              // Name check this repo already enforces. aria-pressed carries
              // the state as state, so a change is announced as one.
              ariaLabel={`${t('Auto Sync')}: ${
                settingsData.isAutoSync ? t(`On`) : t(`Off`)
              }`}
              ariaPressed={settingsData.isAutoSync}
              onClick={handleToggleAutoSync}
              style={`
              width: 100%;
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
            padding-left: clamp(16px, 8%, 72px);
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
        {/* Lazy Load Tabs */}
        <div
          css={css`
            display: flex;
            flex-direction: column;
            align-items: flex-start;
            padding-left: clamp(16px, 8%, 72px);
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
              value={t('Lazy Load Tabs')}
              size="1rem"
              color={COLORS.LABEL_L1_COLOR}
            />
          </div>

          <div
            css={css`
              display: flex;
              justify-content: space-between;
              align-items: center;
              width: 100%;
              max-width: 250px;
              margin-top: 8px;
            `}
          >
            <Button
              text={settingsData.isLazyLoad ? t(`On`) : t(`Off`)}
              // KAN-88. The button's whole visible text is its VALUE, and the
              // setting's name is an unassociated sibling label, so the
              // accessible name used to be just "On" -- announced with no
              // indication of what was on.
              //
              // The name has to CONTAIN the visible text (WCAG 2.5.3), so it
              // is "<setting>: <value>" rather than the setting alone; a bare
              // "Auto Sync" over a button reading "On" would fail the Label in
              // Name check this repo already enforces. aria-pressed carries
              // the state as state, so a change is announced as one.
              ariaLabel={`${t('Lazy Load Tabs')}: ${
                settingsData.isLazyLoad ? t(`On`) : t(`Off`)
              }`}
              ariaPressed={settingsData.isLazyLoad}
              onClick={handleToggleLazyLoadTabs}
              style={`
              width: 100%;
            `}
            />
          </div>
        </div>

        {/* Save Tab Groups */}
        <div
          css={css`
            padding-left: clamp(16px, 8%, 72px);
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
              value={t('Save Tab Groups')}
              size="1rem"
              color={COLORS.LABEL_L1_COLOR}
            />
          </div>

          <div
            css={css`
              display: flex;
              justify-content: space-between;
              align-items: center;
              width: 100%;
              max-width: 250px;
              margin-top: 8px;
            `}
          >
            <Button
              text={hasTabGroups ? t(`On`) : t(`Off`)}
              // KAN-88. The button's whole visible text is its VALUE, and the
              // setting's name is an unassociated sibling label, so the
              // accessible name used to be just "On" -- announced with no
              // indication of what was on.
              //
              // The name has to CONTAIN the visible text (WCAG 2.5.3), so it
              // is "<setting>: <value>" rather than the setting alone; a bare
              // "Auto Sync" over a button reading "On" would fail the Label in
              // Name check this repo already enforces. aria-pressed carries
              // the state as state, so a change is announced as one.
              ariaLabel={`${t('Save Tab Groups')}: ${
                hasTabGroups ? t(`On`) : t(`Off`)
              }`}
              ariaPressed={hasTabGroups}
              onClick={handleToggleTabGroups}
              style={`
              width: 100%;
            `}
            />
          </div>
        </div>

        {/* Backup & Restore */}
        <div
          css={css`
            display: flex;
            flex-direction: column;
            align-items: flex-start;
            padding-left: clamp(16px, 8%, 72px);
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
              /* A definite width, so the buttons' width: 100% resolves against
                 the row rather than against their own text. */
              width: 100%;
              align-items: flex-start;
              margin-top: 8px;
            `}
          >
            <Button
              text={t(`Backup App Data to File`)}
              iconType="publish"
              onClick={handleExportJSON}
              style="width: 100%;
              max-width: 260px; justify-content: center;"
            />
            <Button
              text={t('Restore App Data from File')}
              iconType="get_app"
              onClick={handleImportJSON}
              style="width: 100%;
              max-width: 260px; justify-content: center; margin-top: 12px;"
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
            padding-left: clamp(16px, 8%, 72px);
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
              /* Two columns at every size. Without a definite width the grid
                 shrink-wraps and auto-fit collapses to a single column. */
              grid-template-columns: 1fr 1fr;
              width: 100%;
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
              style="width: 100%; min-width: 0; justify-content: center;"
            />
            <Button
              text={t(`German`)}
              onClick={() => {
                i18n.changeLanguage('de');
                dispatch(setLanguage(Language.DE));
              }}
              style="width: 100%; min-width: 0; justify-content: center;"
            />
            <Button
              text={t('Chinese')}
              onClick={() => {
                i18n.changeLanguage('zh');
                dispatch(setLanguage(Language.ZH));
              }}
              style="width: 100%; min-width: 0; justify-content: center;"
            />
            <Button
              text={t('Japanese')}
              onClick={() => {
                i18n.changeLanguage('ja');
                dispatch(setLanguage(Language.JA));
              }}
              style="width: 100%; min-width: 0; justify-content: center;"
            />
            <Button
              text={t(`French`)}
              onClick={() => {
                i18n.changeLanguage('fr');
                dispatch(setLanguage(Language.FR));
              }}
              style="width: 100%; min-width: 0; justify-content: center;"
            />
            <Button
              text={t(`Portuguese`)}
              onClick={() => {
                i18n.changeLanguage('pt');
                dispatch(setLanguage(Language.PT));
              }}
              style="width: 100%; min-width: 0; justify-content: center;"
            />
            <Button
              text={t(`Russian`)}
              onClick={() => {
                i18n.changeLanguage('ru');
                dispatch(setLanguage(Language.RU));
              }}
              style="width: 100%; min-width: 0; justify-content: center;"
            />
            <Button
              text={t(`Spanish`)}
              onClick={() => {
                i18n.changeLanguage('es');
                dispatch(setLanguage(Language.ES));
              }}
              style="width: 100%; min-width: 0; justify-content: center;"
            />
            <Button
              text={t(`Italian`)}
              onClick={() => {
                i18n.changeLanguage('it');
                dispatch(setLanguage(Language.IT));
              }}
              style="width: 100%; min-width: 0; justify-content: center;"
            />
            <Button
              text={t(`Hindi`)}
              onClick={() => {
                i18n.changeLanguage('hi');
                dispatch(setLanguage(Language.HI));
              }}
              style="width: 100%; min-width: 0; justify-content: center;"
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
          /* Definite width, so the buttons below size to the column rather
             than each to its own label. */
          width: 100%;
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
          onClick={() => window.open(APP_CHROME_WEBSTORE_LINK + '/reviews')}
          style="width: 100%;
              max-width: 250px; justify-content: center; margin-top: 40px;"
        />
        <Button
          text={t('Share your thoughts')}
          iconType="mail"
          onClick={() =>
            (window.location.href = `mailto:${DEV_EMAIL}?subject=${FEEDBACK_MAIL_SUBJECT}`)
          }
          style="width: 100%;
              max-width: 250px; justify-content: center; margin-top: 16px;"
        />
        <Button
          text={t('Share on Twitter (X)')}
          iconType="send"
          onClick={() => window.open(SHARE_TWITTER_TEXT)}
          style="width: 100%;
              max-width: 250px; justify-content: center; margin-top: 16px;"
        />
        <NormalLabel
          color={COLORS.LABEL_L3_COLOR}
          value={`v${APP_VERSION}`}
          style={`margin: auto auto 30px;`}
        />
      </div>
    );
  }

  // Keyed on the category so React remounts the panel instead of reconciling
  // one against the next (KAN-44). The five branches above all render into this
  // one position, so without a key React matched them element by element and
  // handed the Display panel's first theme swatch <button> to Sync & Privacy's
  // Auto Sync button. A swatch is hardcoded to LIGHT_THEME.PRIMARY_COLOR, and
  // Button carries `transition: background-color 0.2s`, so on a dark theme the
  // recycled node animated white -> black over 200ms.
  //
  // A Fragment rather than a wrapper div: this is a flex context and an extra
  // element would change the layout. Fragments take a key as long as they are
  // written out in full -- the <> shorthand cannot, the same constraint as
  // SettingsCategoryContainer in KAN-28.
  return (
    <div css={containerStyle}>
      <Fragment key={selectedSettingsCategory.name}>
        {settingsOptionsDiv}
      </Fragment>
    </div>
  );
};

export default SettingsDetailsContainer;
