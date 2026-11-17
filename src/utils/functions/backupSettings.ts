// KAN-961. The settings a backup file carries: the user's choices, written only where they differ from a new install.
import {
  defaultSettings,
  SHIPPED_LANGUAGES,
  startupLanguage,
  USUAL_CLOCK,
  type SettingsData,
} from '../../redux/slices/settingsDataStateSlice';
import { isTheme } from '../constants/theme';

export const BACKUP_SETTING_KEYS = [
  'theme',
  'language',
  'timeFormat',
  'sessionDateBasis',
  'exportLayout',
  'defaultView',
  'toolbarIcon',
  'pinTabKeeperInNewWindows',
  'defaultSaveScope',
  'copyLinksLayout',
  'openSavedWindowsIn',
  'skipDuplicateTabs',
  'skipTabsAlreadyOpen',
  'foldSavedSessionInTabView',
  'foldOpenNowInTabView',
] as const satisfies readonly (keyof SettingsData)[];

export type BackupSettingKey = (typeof BACKUP_SETTING_KEYS)[number];
export type BackupSettings = Partial<Pick<SettingsData, BackupSettingKey>>;
type AllBackupSettings = Pick<SettingsData, BackupSettingKey>;

// KAN-961. This computer's own state: never written to a backup, never read from one.
export const PER_DEVICE_SETTING_KEYS: readonly Exclude<
  keyof SettingsData,
  BackupSettingKey
>[] = [
  'isAutoSync',
  'cloudConsent',
  'extensionInstalledTime',
  'isSkippedUserReviewOnce',
  'isUserRatedAndReviewed',
  'isNeverAskAgainToRate',
  'lastReviewRequestTime',
  'pendingReviewAsk',
  'isTimeAskDone',
  'lastSyncedTime',
  'cloudConsentGrantedAt',
  'cloudDeletedElsewhere',
  'isNeverAskAgainForTabGroups',
  'openNowWidth',
  'listWidth',
  'setupState',
  'isPinGuideDismissed',
  'hasOpenedFullView',
  'isFullViewCalloutSeen',
  'firstRun',
  'isWhatsNew2Seen',
  'isClosesThisTabCardAnswered',
  'hasHadSavedSession',
  'hasHadOnlyImportedSessions',
  'saveAsPdfPresses',
  'isChalkCharcoalMoveApplied',
  'isPopupEndingSeen',
  'isFullViewEndingSeen',
  'importedSessionIds',
  'importedBookmarks',
];

const isOneOf =
  <T>(values: readonly T[]) =>
  (value: unknown): value is T =>
    values.some((v) => v === value);
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isFlag = (value: unknown): value is boolean => typeof value === 'boolean';

// Strict: yes or no. The startup as* guards turn a bad value into the default, which would overwrite this computer's choice.
const IS_VALID: {
  [K in BackupSettingKey]: (value: unknown) => value is SettingsData[K];
} = {
  theme: isTheme,
  language: isOneOf(SHIPPED_LANGUAGES),
  timeFormat: isOneOf(['h12', 'h23'] as const),
  sessionDateBasis: isOneOf(['edited', 'created'] as const),
  exportLayout: isOneOf(['compact', 'comfortable'] as const),
  defaultView: isOneOf(['compact', 'full'] as const),
  toolbarIcon: isOneOf(['colour', 'monochrome'] as const),
  pinTabKeeperInNewWindows: isFlag,
  defaultSaveScope: isOneOf(['all-windows', 'current-window'] as const),
  copyLinksLayout: isOneOf(['links-only', 'with-headings'] as const),
  openSavedWindowsIn: isOneOf(['new-window', 'this-window'] as const),
  skipDuplicateTabs: isFlag,
  skipTabsAlreadyOpen: isFlag,
  foldSavedSessionInTabView: isFlag,
  foldOpenNowInTabView: isFlag,
};

const copyKey = <K extends BackupSettingKey>(
  to: BackupSettings,
  from: AllBackupSettings,
  key: K
): void => {
  to[key] = from[key];
};

const takeIfValid = <K extends BackupSettingKey>(
  to: BackupSettings,
  raw: Record<string, unknown>,
  key: K
): void => {
  const value = raw[key];
  if (IS_VALID[key](value)) to[key] = value;
};

/**
 * The settings a backup writes: those that differ from what a new install on
 * this Chrome starts with, or undefined when none do. The clock goes with the
 * language, and the two folds go together.
 */
export function backupSettingsFrom(
  settings: SettingsData,
  uiLanguage: string | undefined
): BackupSettings | undefined {
  const newInstall: AllBackupSettings = {
    ...defaultSettings,
    language: startupLanguage(undefined, uiLanguage),
    timeFormat: USUAL_CLOCK[settings.language],
  };
  const written: BackupSettings = {};
  for (const key of BACKUP_SETTING_KEYS) {
    if (settings[key] !== newInstall[key]) copyKey(written, settings, key);
  }
  if ('language' in written) copyKey(written, settings, 'timeFormat');
  if (
    'foldSavedSessionInTabView' in written ||
    'foldOpenNowInTabView' in written
  ) {
    copyKey(written, settings, 'foldSavedSessionInTabView');
    copyKey(written, settings, 'foldOpenNowInTabView');
  }
  return Object.keys(written).length > 0 ? written : undefined;
}

/**
 * A backup file's settings, each checked strictly: an unknown key or a bad
 * value is dropped, so this computer keeps its own. Null when the field is not
 * an object or nothing valid is left.
 */
export function readBackupSettings(raw: unknown): BackupSettings | null {
  if (!isRecord(raw)) return null;
  const read: BackupSettings = {};
  for (const key of BACKUP_SETTING_KEYS) takeIfValid(read, raw, key);

  // A new install in that language starts on its usual clock.
  if (read.language !== undefined && read.timeFormat === undefined) {
    read.timeFormat = USUAL_CLOCK[read.language];
  }
  // One fold at a time, as startup keeps it; the saved session's wins.
  if (read.foldSavedSessionInTabView === true) {
    read.foldOpenNowInTabView = false;
  } else if (read.foldOpenNowInTabView === true) {
    read.foldSavedSessionInTabView = false;
  }
  return Object.keys(read).length > 0 ? read : null;
}
