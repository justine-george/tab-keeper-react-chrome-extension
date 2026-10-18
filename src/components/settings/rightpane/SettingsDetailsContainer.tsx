import { Fragment, useId, useState } from 'react';

import { useDispatch, useSelector } from 'react-redux';

import { css } from '@emotion/react';

import Button from '../../common/Button';
import { focusRingOutsideCss } from '../../common/focusRing';
import { RecentlyDeleted } from './RecentlyDeleted';
import ClickableTabKeeperMark from '../../common/ClickableTabKeeperMark';
import { HeartGlyph } from '../../common/glyphs';
import HelpSettings from './HelpSettings';
import ThemeSwatch from './ThemeSwatch';
import { chromeLanguageOrder } from './languageOptions';
import { pressedCellStyle } from '../../common/pressedCellStyle';
import { slidingPairColors } from '../../common/slidingPairColors';
import { themeChoices } from './themeChoices';
import { NormalLabel } from '../../common/Label';
import { useThemeColors } from '../../../hooks/useThemeColors';
import { AppDispatch, RootState } from '../../../redux/store';
import { chooseLanguage } from '../../../redux/languageChoice';
import {
  openDeleteCloudDataModal,
  openCloudConsentModal,
} from '../../../redux/slices/globalStateSlice';
import {
  setTheme,
  setPinTabKeeperInNewWindows,
  setTimeFormat,
  setUserRatedAndReviewed,
  toggleAutoSync,
} from '../../../redux/slices/settingsDataStateSlice';
import {
  APP_CHROME_WEBSTORE_LINK,
  APP_VERSION,
  DEV_EMAIL,
  FEEDBACK_MAIL_SUBJECT,
  PRIVACY_POLICY_LINK,
} from '../../../utils/constants/common';
import { SettingsCategoryContainer } from '../leftpane/SettingsCategoryContainer';
import { loadBackupFile, saveBackupFile } from '../../../redux/backupFile';
import { requestTabView } from '../../../utils/functions/popOut';
import { isTabView } from '../../../utils/functions/viewMode';
import {
  removeTabGroupsPermission,
  requestTabGroupsPermission,
} from '../../../utils/functions/permissions';
import { SettingsCategory } from '../../../redux/slices/settingsCategoryStateSlice';
import SyncStatus from './Account/SyncStatus';
import SlidingPair from '../../common/SlidingPair';
import DefaultSaveChoice from './DefaultSaveChoice';
import { SETTINGS_PAIR_METRICS } from '../../common/slidingPairMetrics';
import { useTranslation } from 'react-i18next';
import { CONTROL, ICON, TYPE } from '../../../styles/scale';
import {
  openShortcutsBeside,
  usePopupShortcut,
} from '../../../hooks/usePopupShortcut';
import { shortcutKeys } from '../../../utils/functions/shortcutKeys';
import { KEYS_SLOT, ShortcutSentence } from '../../common/ShortcutSentence';
import { useFontFamily } from '../../../hooks/useFontFamily';
import { chooseDefaultView } from '../../../redux/defaultViewChoice';

// The theme picker's swatches live in ThemeSwatch (KAN-237), which also carries
// the KAN-88/KAN-95 marker rule and its reasoning.

// Sections after the first on a pane sit 32px apart, the spacing About's
// blocks use (KAN-241); the first keeps 20px from the pane top. Written on
// each section rather than as a constant so a section reads as a unit; the
// settingsRail test holds them to it.

const HEART_SLOT = '\u2063';

const SettingsDetailsContainer: React.FC = () => {
  const COLORS = useThemeColors();
  const FONT_FAMILY = useFontFamily();

  // The settings secondary style: a help line 8px under its control, capped at a reading width.
  const helpLineStyle = css`
    margin: 8px 0 0;
    max-width: 36rem;
    font-family: ${FONT_FAMILY};
    font-size: ${TYPE.SECONDARY};
    line-height: 1.45;
    color: ${COLORS.LABEL_L1_COLOR};
  `;
  const pinTabKeeperHelpId = useId();
  const defaultSaveHelpId = useId();
  const popupShortcut = usePopupShortcut();
  const { i18n } = useTranslation();
  const { t } = useTranslation();

  const dispatch: AppDispatch = useDispatch();

  // Chrome's language doesn't change while the page is open.
  const [languageCells] = useState(chromeLanguageOrder);
  const pressed = slidingPairColors(COLORS);

  const settingsCategoryList = useSelector(
    (state: RootState) => state.settingsCategoryState
  );

  const settingsData = useSelector(
    (state: RootState) => state.settingsDataState
  );

  const hasTabGroups = useSelector(
    (state: RootState) => state.globalState.hasTabGroupsPermission
  );

  const containerStyle = css`
    display: flex;
    flex-direction: column;
    padding: 8px;
    flex-grow: 1;
    margin-top: 8px;
    border: 1px solid ${COLORS.PANEL_BORDER_COLOR};
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

  // KAN-290. Only the flag. App's sync effect depends on syncAllowed
  // (consent AND Auto Sync), so turning Auto Sync on already starts the
  // sign-in there and syncs once isFirebaseAuthed flips -- including for a
  // user who declined and said yes from Settings, who has never contacted
  // Firebase until now. This used to ALSO start the sign-in and a sync in the
  // same tick: the read beat the sign-in, the rules refused it, and the card
  // said "Last sync failed" for a moment on a working connection.
  const handleToggleAutoSync = () => {
    dispatch(toggleAutoSync());
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

  // KAN-579. A native file picker takes the focus, and Chrome closes a popup
  // that loses it -- Cancel or Esc there closed the popup. So the popup asks the
  // full view (requestTabView), which opens on this pane and does the file step.
  const handleExportJSON = () => {
    if (isTabView()) dispatch(saveBackupFile());
    else void requestTabView('saveBackup');
  };

  const handleImportJSON = () => {
    if (isTabView()) dispatch(loadBackupFile(i18n));
    else void requestTabView('loadBackup');
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
          data-settings-section
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
              /* KAN-247. 14, not 16: in ja two katakana captions are wider
                 than their tiles and 16px is the exact ceiling before Ink
                 wraps at 790px; the katakana come from the system font. */
              gap: 14px;
              max-width: 100%;
              margin-top: 8px;
            `}
          >
            {themeChoices(t).map(([theme, palette, name]) => (
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

        {/* KAN-587. 12-hour unless picked; every time in the app follows it. */}
        <div
          data-settings-section
          css={css`
            display: flex;
            flex-direction: column;
            align-items: flex-start;
            padding-left: clamp(16px, 8%, 72px);
            padding-right: clamp(16px, 8%, 72px);
            width: 100%;
            margin-top: 32px;
          `}
        >
          <NormalLabel
            value={t('Time format')}
            size={TYPE.BODY}
            color={COLORS.LABEL_L1_COLOR}
          />
          <div
            css={css`
              margin-top: 8px;
            `}
          >
            <SlidingPair
              label={t('Time format')}
              options={[
                { value: 'h12', label: t('12-hour') },
                { value: 'h23', label: t('24-hour') },
              ]}
              value={settingsData.timeFormat}
              onChange={(next) => dispatch(setTimeFormat(next))}
              metrics={SETTINGS_PAIR_METRICS}
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
          data-settings-section
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
              margin-top: 8px;
            `}
          >
            {/* KAN-248. Was one Button whose whole text was its value ("On"),
                which read as either the state or the action. The pair shows
                both sides with the pressed one marked. KAN-88's concern -- the
                name must say which setting -- is met by the group's name;
                each side's name is its own word, so Label in Name holds. */}
            <SlidingPair
              label={t('Auto Sync')}
              options={[
                { value: 'on', label: t('On') },
                { value: 'off', label: t('Off') },
              ]}
              value={settingsData.isAutoSync ? 'on' : 'off'}
              onChange={(next) => {
                // KAN-259. Turning it on without consent asks the cloud
                // question instead: the answer sets the flag. Off is off.
                if (next === 'on' && settingsData.cloudConsent !== 'granted') {
                  dispatch(
                    openCloudConsentModal({
                      variant: 'enable',
                      then: 'autoSync',
                    })
                  );
                  return;
                }
                if ((next === 'on') !== settingsData.isAutoSync) {
                  handleToggleAutoSync();
                }
              }}
              metrics={SETTINGS_PAIR_METRICS}
            />
          </div>
        </div>

        {/* Sync Status */}
        <div
          data-settings-section
          css={css`
            display: flex;
            flex-direction: column;
            align-items: flex-start;
            padding-left: clamp(16px, 8%, 72px);
            padding-right: clamp(16px, 8%, 72px);
            width: 100%;
            margin-top: 32px;
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
          <SyncStatus />
        </div>

        {/* Backup. KAN-251: the buttons name what they do to SESSIONS --
            "Restore" is this app's verb for opening a saved session, and
            "App Data" promised settings the file does not carry -- and the
            icons point the way the browser's do: save is a download, replace
            an upload. "Replace" because that is what loading a backup does to
            what is there (KAN-252 holds the question of whether it should). */}
        <div
          data-settings-section
          css={css`
            display: flex;
            flex-direction: column;
            align-items: flex-start;
            padding-left: clamp(16px, 8%, 72px);
            padding-right: clamp(16px, 8%, 72px);
            width: 100%;
            margin-top: 32px;
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
              value={t('Backup')}
              size={TYPE.BODY}
              color={COLORS.LABEL_L1_COLOR}
            />
          </div>

          <div
            css={css`
              /* One column sized to the wider label, so the two buttons share
                 an edge in every locale and neither wraps; capped at the
                 pane so a long translation narrows rather than overflows. The
                 old 260px cap wrapped both German labels. */
              display: inline-grid;
              grid-template-columns: minmax(0, max-content);
              row-gap: 12px;
              max-width: 100%;
              margin-top: 8px;
            `}
          >
            <Button
              text={t('Save sessions to a file')}
              iconType="download"
              onClick={handleExportJSON}
              style="width: 100%; justify-content: center;"
            />
            <Button
              text={t('Load sessions from a backup')}
              iconType="upload"
              onClick={handleImportJSON}
              style="width: 100%; justify-content: center;"
            />
          </div>
        </div>

        {/* Cloud data. KAN-254: the one way to make the Firestore document
            stop existing. Last on the pane, as destructive actions are; the
            dialog it opens says what else it does (auto sync off here) and
            what it cannot do (other devices' copies). */}
        <div
          data-settings-section
          css={css`
            display: flex;
            flex-direction: column;
            align-items: flex-start;
            padding-left: clamp(16px, 8%, 72px);
            padding-right: clamp(16px, 8%, 72px);
            width: 100%;
            margin-top: 32px;
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
              value={t('Cloud data')}
              size={TYPE.BODY}
              color={COLORS.LABEL_L1_COLOR}
            />
          </div>
          <div
            css={css`
              margin-top: 8px;
            `}
          >
            <Button
              text={t('Delete cloud data')}
              iconType="delete"
              variant="danger"
              onClick={() => dispatch(openDeleteCloudDataModal())}
            />
          </div>
        </div>
      </div>
    );
  } else if (
    selectedSettingsCategory.name === SettingsCategory.RECENTLY_DELETED
  ) {
    settingsOptionsDiv = (
      <div
        css={css`
          display: flex;
          flex-direction: column;
          align-items: center;
        `}
      >
        <RecentlyDeleted />
      </div>
    );
  } else if (selectedSettingsCategory.name === SettingsCategory.SESSIONS) {
    settingsOptionsDiv = (
      <div
        css={css`
          display: flex;
          flex-direction: column;
          justify-content: flex-start;
          align-items: center;
        `}
      >
        {/* KAN-635. What the save button and Enter save. */}
        <div
          data-settings-section
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
              value={t('Default save')}
              size={TYPE.BODY}
              color={COLORS.LABEL_L1_COLOR}
            />
          </div>
          <div
            css={css`
              margin-top: 8px;
            `}
          >
            <DefaultSaveChoice describedBy={defaultSaveHelpId} />
          </div>
          <p id={defaultSaveHelpId} css={helpLineStyle}>
            {t(
              'Used by the save button and the Enter key. The other save is in the ⋮ menu.'
            )}
          </p>
        </div>

        {/* Save Tab Groups */}
        <div
          data-settings-section
          css={css`
            padding-left: clamp(16px, 8%, 72px);
            padding-right: clamp(16px, 8%, 72px);
            width: 100%;
            margin-top: 32px;
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
              margin-top: 8px;
            `}
          >
            {/* KAN-249. Not a store toggle: On asks Chrome for the permission,
                Off gives it back, and the pressed side follows
                hasTabGroupsPermission, written by the change listener or the
                next popup open -- permissions.request() may close this popup
                before it settles (KAN-226), so the knob may not move here. */}
            <SlidingPair
              label={t('Save Tab Groups')}
              options={[
                { value: 'on', label: t('On') },
                { value: 'off', label: t('Off') },
              ]}
              value={hasTabGroups ? 'on' : 'off'}
              onChange={(next) => {
                if ((next === 'on') !== hasTabGroups) {
                  handleToggleTabGroups();
                }
              }}
              metrics={SETTINGS_PAIR_METRICS}
            />
          </div>
        </div>
      </div>
    );
  } else if (selectedSettingsCategory.name === SettingsCategory.QUICK_ACCESS) {
    // KAN-652. How Tab Keeper itself opens, moved out of Sessions.
    settingsOptionsDiv = (
      <div
        css={css`
          display: flex;
          flex-direction: column;
          justify-content: flex-start;
          align-items: center;
        `}
      >
        {/* KAN-7 §7. What the toolbar icon, its shortcut and the puzzle menu open. */}
        <div
          data-settings-section
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
              value={t('Default view')}
              size={TYPE.BODY}
              color={COLORS.LABEL_L1_COLOR}
            />
          </div>
          <div
            css={css`
              margin-top: 8px;
            `}
          >
            <SlidingPair
              label={t('Default view')}
              options={[
                { value: 'compact', label: t('Compact view') },
                { value: 'full', label: t('Full view') },
              ]}
              value={settingsData.defaultView}
              onChange={(next) => void dispatch(chooseDefaultView(next))}
              metrics={SETTINGS_PAIR_METRICS}
            />
          </div>
        </div>

        {/* KAN-459. Whether windows Tab Keeper opens start with it pinned. */}
        <div
          data-settings-section
          css={css`
            padding-left: clamp(16px, 8%, 72px);
            padding-right: clamp(16px, 8%, 72px);
            width: 100%;
            margin-top: 32px;
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
              value={t('Pin Tab Keeper in new windows')}
              size={TYPE.BODY}
              color={COLORS.LABEL_L1_COLOR}
            />
          </div>
          <div
            css={css`
              margin-top: 8px;
            `}
          >
            <SlidingPair
              label={t('Pin Tab Keeper in new windows')}
              options={[
                { value: 'on', label: t('On') },
                { value: 'off', label: t('Off') },
              ]}
              value={settingsData.pinTabKeeperInNewWindows ? 'on' : 'off'}
              onChange={(next) =>
                dispatch(setPinTabKeeperInNewWindows(next === 'on'))
              }
              metrics={SETTINGS_PAIR_METRICS}
              describedBy={pinTabKeeperHelpId}
            />
          </div>
          <p id={pinTabKeeperHelpId} css={helpLineStyle}>
            {t(
              'Windows Tab Keeper opens or switches to start with Tab Keeper pinned.'
            )}
          </p>
        </div>

        {/* Keyboard shortcut. KAN-256: a sentence that says what the key
            does, with the binding Chrome actually assigned -- read from
            chrome.commands, never the manifest's suggestion, which Chrome
            honours only when the key is free -- drawn as one keycap per key,
            and a button to the one page where it can be changed. */}
        <div
          data-settings-section
          css={css`
            padding-left: clamp(16px, 8%, 72px);
            padding-right: clamp(16px, 8%, 72px);
            width: 100%;
            margin-top: 32px;
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
              value={t('Keyboard shortcut')}
              size={TYPE.BODY}
              color={COLORS.LABEL_L1_COLOR}
            />
          </div>
          {popupShortcut !== undefined && (
            <p
              data-testid="popup-shortcut"
              css={css`
                margin: 8px 0 0;
                font-size: ${TYPE.BODY};
                line-height: 1.6;
                color: ${COLORS.LABEL_L1_COLOR};
              `}
            >
              {popupShortcut === '' ? (
                t('No shortcut is set to open Tab Keeper.')
              ) : (
                <ShortcutSentence
                  sentence={t('Press {{keys}} to open Tab Keeper.', {
                    keys: KEYS_SLOT,
                  })}
                  keys={shortcutKeys(popupShortcut)}
                />
              )}
            </p>
          )}
          <div
            css={css`
              margin-top: 8px;
            `}
          >
            <Button
              text={t('Change or remove shortcut')}
              iconType="keyboard"
              onClick={() => {
                void openShortcutsBeside();
              }}
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
          data-settings-section
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
              /* KAN-510. Two 200px columns from the label's edge: half the
                 pane each grew to 745px at 1920. The pane's inner width is
                 434px at every root size, so two always fit. */
              grid-template-columns: repeat(2, 200px);
              gap: 12px;
              align-items: center;
              margin-top: 8px;
            `}
          >
            {languageCells.map(([language, endonym]) => {
              const isActive = settingsData.language === language;
              return (
                <Button
                  key={language}
                  text={endonym}
                  ariaPressed={isActive}
                  iconType={isActive ? 'check' : undefined}
                  iconSize={ICON.SMALL}
                  iconColor={pressed.labelOnKnob}
                  onClick={() => {
                    dispatch(chooseLanguage(language, i18n));
                  }}
                  // Border-box and a fixed height, so the check moves nothing.
                  style={`width: 100%; min-width: 0; justify-content: center; ${
                    isActive ? pressedCellStyle(COLORS) : ''
                  }`}
                />
              );
            })}
          </div>
        </div>
      </div>
    );
  } else if (selectedSettingsCategory.name === SettingsCategory.ABOUT) {
    // An invisible separator marks where the heart goes, so each locale can put it anywhere.
    const [creditBefore, creditAfter = ''] = t(
      'Made with {{heart}} by Justine George',
      { heart: HEART_SLOT }
    ).split(HEART_SLOT);
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
        {/* Nameplate (KAN-521): the header's mark beside the name and the version, then the credit. */}
        <div
          data-settings-section
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
              gap: 12px;
            `}
          >
            <ClickableTabKeeperMark markSize={ICON.NAMEPLATE} />
            <div
              css={css`
                display: flex;
                flex-direction: column;
                gap: 2px;
              `}
            >
              <NormalLabel
                value={t('Tab Keeper')}
                size={TYPE.SECTION}
                color={COLORS.TEXT_COLOR}
              />
              {/* LABEL_L1, not L2: L2 is 4.32:1 on Graphite, and this is the
                  line a bug report has to be able to read. */}
              <NormalLabel
                value={t('Version {{version}}', { version: APP_VERSION })}
                size={TYPE.SECONDARY}
                color={COLORS.LABEL_L1_COLOR}
              />
            </div>
          </div>
          {/* The heart is drawn in the line's own grey, where the locale puts it. */}
          <span
            css={css`
              margin-top: 14px;
              font-size: ${TYPE.SECONDARY};
              color: ${COLORS.LABEL_L2_COLOR};
            `}
          >
            {creditBefore}
            <HeartGlyph size="1em" label={t('love')} />
            {creditAfter}
          </span>
          {/* KAN-260. The policy, on its own line under the version at the
              same step and 6px rhythm: a third fact about the product, not a
              fourth action. In the text colour, as the consent dialog sets its
              link, so it reads as a link and not as another label. Opened in a
              tab: a popup that follows a link navigates itself away. */}
          <a
            href={PRIVACY_POLICY_LINK}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => {
              e.preventDefault();
              chrome.tabs.create({ url: PRIVACY_POLICY_LINK });
            }}
            css={css`
              margin-top: 6px;
              font-size: ${TYPE.SECONDARY};
              color: ${COLORS.TEXT_COLOR};
              ${focusRingOutsideCss(COLORS)}
            `}
          >
            {t('Privacy policy')}
          </a>
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
              value={t('Feedback')}
              size={TYPE.BODY}
              color={COLORS.LABEL_L1_COLOR}
            />
          </div>

          {/* The Backup & Restore stack. Not a row: a stack keeps one shape in
              every locale. */}
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
            {/* KAN-511. The one thing the page asks for, drawn as the dialogs draw their main action, with the rating dialog's star. */}
            <Button
              text={t('Rate this app')}
              iconType="star"
              variant="primary"
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
          </div>
        </div>
      </div>
    );
  } else if (selectedSettingsCategory.name === SettingsCategory.HELP) {
    settingsOptionsDiv = <HelpSettings />;
  }

  // Keyed on the category so React remounts the panel instead of reconciling
  // one against the next (KAN-44). Every branch above renders into this
  // one position, so without a key React matched them element by element and
  // handed the Display panel's first theme swatch <button> to Sync & Backup's
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
