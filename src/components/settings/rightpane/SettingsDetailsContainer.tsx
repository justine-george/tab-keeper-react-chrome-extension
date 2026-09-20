import { Fragment } from 'react';

import { useDispatch, useSelector } from 'react-redux';

import { css } from '@emotion/react';

import Button from '../../common/Button';
import Icon from '../../common/Icon';
import ThemeSwatch from './ThemeSwatch';
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
  setUserRatedAndReviewed,
  toggleAutoSync,
  toggleLazyLoad,
} from '../../../redux/slices/settingsDataStateSlice';
import {
  APP_CHROME_WEBSTORE_LINK,
  APP_VERSION,
  DEV_EMAIL,
  FEEDBACK_MAIL_SUBJECT,
  IMPORT_ERROR_FRAME,
  NON_INTERACTIVE_ICON_STYLE,
  SHARE_X_TEXT,
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
import { CONTROL, TYPE } from '../../../styles/scale';

// The theme picker's swatches live in ThemeSwatch (KAN-237), which also carries
// the KAN-88/KAN-95 marker rule and its reasoning.

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
            /* Matched on both sides. The inset used to be left-only, so every
               settings section sat off-centre in its pane -- measured on the
               Language grid, 50px of gutter on the left and 9px on the right.
               The content inside is flexible, so reserving the right simply
               narrows it; nothing needed resizing by hand. */
            padding-left: clamp(16px, 8%, 72px);
            padding-right: clamp(16px, 8%, 72px);
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
              size={TYPE.BODY}
              color={COLORS.LABEL_L1_COLOR}
            />
          </div>

          <div
            css={css`
              display: flex;
              justify-content: flex-start;
              align-items: center;
              flex-wrap: wrap;
              gap: 10px;
              max-width: 100%;
              margin-top: 8px;
            `}
          >
            {/* t() is called on a quoted literal in each row, not on the
                mapped variable: keyCoverage.test finds keys by scanning the
                source for quoted t() arguments, and a computed key is
                invisible to it. */}
            {(
              [
                [Theme.LIGHT, LIGHT_THEME, t('Paper')],
                [Theme.WARM_LIGHT, WARM_LIGHT_THEME, t('Parchment')],
                [Theme.BB_PINK, BB_PINK_THEME, t('Petal')],
                [Theme.DARKENHEIMER, DARKENHEIMER_THEME, t('Graphite')],
                [Theme.BLUE, BLUE_THEME, t('Ink')],
              ] as const
            ).map(([theme, palette, name]) => (
              <ThemeSwatch
                key={theme}
                palette={palette}
                name={name}
                isActive={settingsData.theme === theme}
                onSelect={() => dispatch(setTheme(theme))}
              />
            ))}
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
            padding-right: clamp(16px, 8%, 72px);
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
              size={TYPE.BODY}
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
            padding-right: clamp(16px, 8%, 72px);
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
              size={TYPE.BODY}
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
            padding-right: clamp(16px, 8%, 72px);
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
              size={TYPE.BODY}
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
            padding-right: clamp(16px, 8%, 72px);
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
              size={TYPE.BODY}
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
            padding-right: clamp(16px, 8%, 72px);
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
              size={TYPE.BODY}
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
            padding-right: clamp(16px, 8%, 72px);
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
              size={TYPE.BODY}
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
    // KAN-241. Built as sections under the same inset as the four panes
    // above, where it used to be the one centred pane: a thank-you heading,
    // three buttons, and the version pushed to the floor in LABEL_L3 -- the
    // marker token, 2.56:1 on Paper -- so the one line a bug report needs was
    // the hardest on the page to read.
    settingsOptionsDiv = (
      <div
        css={css`
          display: flex;
          flex-direction: column;
          justify-content: flex-start;
          align-items: center;
        `}
      >
        {/* Nameplate: the mark on the name line, the way the header's gear
            sits on "Settings"; then the version and the credit on one line. */}
        <div
          css={css`
            display: flex;
            flex-direction: column;
            align-items: flex-start;
            padding-left: clamp(16px, 8%, 72px);
            padding-right: clamp(16px, 8%, 72px);
            width: 100%;
            margin-top: 20px;
          `}
        >
          <div
            css={css`
              display: flex;
              align-items: center;
            `}
          >
            {/* 4px into the inset, so the mark's box -- not its padding --
                sits on the edge the version and the section label below
                start from. Without it the floppy read as indented. */}
            <Icon
              type="tab_keeper"
              style={`${NON_INTERACTIVE_ICON_STYLE} margin-left: -4px;`}
            />
            <NormalLabel
              value={t('Tab Keeper')}
              size={TYPE.SECTION}
              color={COLORS.TEXT_COLOR}
              style="padding-left: 4px;"
            />
          </div>
          <div
            css={css`
              display: flex;
              align-items: center;
              margin-top: 6px;
            `}
          >
            {/* LABEL_L1, not L2: L2 is 4.32:1 on Graphite, and this is the
                line that has to be readable. */}
            <NormalLabel
              value={`v${APP_VERSION}`}
              size={TYPE.SECONDARY}
              color={COLORS.LABEL_L1_COLOR}
            />
            {/* The separator is drawn, not written, so it is neither
                translated nor announced. */}
            <NormalLabel
              value={t(`Crafted with ❤️ by Justine George`)}
              size={TYPE.SECONDARY}
              color={COLORS.LABEL_L2_COLOR}
              style="&::before { content: '·'; margin: 0 6px; }"
            />
          </div>
        </div>

        {/* Feedback & Share */}
        <div
          css={css`
            display: flex;
            flex-direction: column;
            align-items: flex-start;
            padding-left: clamp(16px, 8%, 72px);
            padding-right: clamp(16px, 8%, 72px);
            width: 100%;
            /* One row (CONTROL.ROW) under the nameplate rather than the 20px
               two settings get from each other: a header wants more under it
               than a setting does, and at 20 the label sat as close to the
               credit as the buttons sit to the label. The section itself keeps
               the shared rhythm so it still matches the other panes. */
            margin-top: ${CONTROL.ROW};
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
              value={t('Feedback & Share')}
              size={TYPE.BODY}
              color={COLORS.LABEL_L1_COLOR}
            />
          </div>

          {/* The Backup & Restore stack. Not a row: the three natural widths
              total ~560px in English against the 435px available here, so a
              row would wrap differently in every locale. */}
          <div
            css={css`
              display: flex;
              flex-direction: column;
              /* A definite width, so the buttons' width: 100% resolves against
                 the column rather than against their own text. */
              width: 100%;
              align-items: flex-start;
              margin-top: 8px;
            `}
          >
            <Button
              text={t('Rate this app')}
              iconType="thumb_up"
              onClick={() => {
                window.open(APP_CHROME_WEBSTORE_LINK + '/reviews');
                // KAN-149. The modal's own CTA has always recorded this; this
                // button never did, so someone who rated from here kept being
                // asked by the modal afterwards.
                //
                // It records INTENT, not a confirmed review -- the store tells
                // us nothing about what the user does once they arrive, so a
                // click is the only evidence available. Someone who clicks and
                // then does not review is never asked again, which is the
                // right way round: the cost of asking someone who already went
                // is worse than the cost of missing a review we were never
                // owed.
                dispatch(setUserRatedAndReviewed());
              }}
              style="width: 100%;
              max-width: 250px; justify-content: center;"
            />
            <Button
              text={t('Share your feedback')}
              iconType="mail"
              onClick={() =>
                (window.location.href = `mailto:${DEV_EMAIL}?subject=${FEEDBACK_MAIL_SUBJECT}`)
              }
              style="width: 100%;
              max-width: 250px; justify-content: center; margin-top: 12px;"
            />
            <Button
              text={t('Share on X')}
              iconType="x"
              onClick={() => window.open(SHARE_X_TEXT)}
              style="width: 100%;
              max-width: 250px; justify-content: center; margin-top: 12px;"
            />
          </div>
        </div>
      </div>
    );
  }

  // Keyed on the category so React remounts the panel instead of reconciling
  // one against the next (KAN-44). The five branches above all render into this
  // one position, so without a key React matched them element by element and
  // handed the Display panel's first theme swatch <button> to Sync & Privacy's
  // Auto Sync button. A swatch is hardcoded to LIGHT_THEME.PRIMARY_COLOR, and
  // Button carries `transition: background-color ${DURATION.MOVE}`, so on a dark theme the
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
