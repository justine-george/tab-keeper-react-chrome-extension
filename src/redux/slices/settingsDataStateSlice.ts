import { createSlice, PayloadAction } from '@reduxjs/toolkit';

import {
  asPartialSettings,
  loadFromLocalStorage,
  saveToLocalStorage,
} from '../../utils/functions/local';
// `import type`, so nothing is emitted: the generator imports this slice's
// tabContainerData type in the other direction, and a value edge either way
// would complete a cycle. Same reason as the RootState note in the container
// slice.
import type { ExportLayout } from '../../utils/functions/sessionExportHtml';
import {
  matchUiLanguage,
  readUiLanguage,
} from '../../utils/functions/uiLanguage';

export enum Theme {
  LIGHT = 'Light',
  WARM_LIGHT = 'WarmLight',
  BB_PINK = 'BBPink',
  DARKENHEIMER = 'Darkenheimer',
  BLUE = 'Blue',
}

export type CloudConsent = 'granted' | 'declined' | '';

export enum Language {
  DE = 'de',
  EN = 'en',
  ES = 'es',
  FR = 'fr',
  HI = 'hi',
  IT = 'it',
  JA = 'ja',
  KO = 'ko',
  PT = 'pt',
  RU = 'ru',
  SV = 'sv',
  // Simplified. A BCP 47 tag, hyphenated, because the value goes straight to
  // Intl -- the manifest's zh_TW spelling throws there (KAN-283).
  ZH = 'zh',
  ZH_TW = 'zh-TW',
}

export interface SettingsData {
  theme: Theme;
  /**
   * Which layout an exported session uses (KAN-190). Chosen on the export
   * preview page rather than in Settings, because there the effect is visible.
   *
   * DEVICE-LOCAL, like everything else here: saveToFirestore sends
   * tabContainerData and nothing else.
   */
  exportLayout: ExportLayout;
  language: Language;
  isAutoSync: boolean;
  // KAN-259. Whether the user has answered the cloud question. '' means not
  // yet: the welcome opens on the next popup open, and no sync runs and no
  // Firebase sign-in happens until it is answered. The effective permission
  // to sync is `isAutoSync && cloudConsent === 'granted'`; see cloudSyncAllowed.
  cloudConsent: CloudConsent;
  extensionInstalledTime: number | '';
  isSkippedUserReviewOnce: boolean;
  isUserRatedAndReviewed: boolean;
  isNeverAskAgainToRate: boolean;
  lastReviewRequestTime: number | '';
  /**
   * When the extension last visibly paid off for this user -- a session
   * restored, a substantial save, sessions arriving from another device
   * (KAN-149). It is what the review prompt waits for, in place of the install
   * date it used to wait on.
   *
   * DEVICE-LOCAL, like everything else here: saveToFirestore sends
   * tabContainerData and nothing else, so this needs no merge rule and cannot
   * make one device's payoff into another device's prompt.
   */
  lastValueMomentTime: number | '';
  // KAN-255. When this device last completed a sync, ms since epoch; '' until
  // the first. Per device, like the rest of this slice: the other device's
  // last sync is its own fact.
  lastSyncedTime: number | '';
  // KAN-74. The tab-groups permission offer. Two flags and no timestamp: the
  // offer fires on every popup open that finds groups open, so there is
  // nothing to schedule -- only an escalating opt-out to remember.
  //
  // Neither flag mirrors whether the permission is GRANTED. That stays
  // hasTabGroupsPermission()'s job, so a user who grants and later revokes
  // from chrome://extensions -- the most explicit "no" available -- cannot be
  // re-armed into being asked again by a stale boolean.
  isTabGroupsPromptAnsweredOnce: boolean;
  isNeverAskAgainForTabGroups: boolean;
  /**
   * Which date the session rows show, and therefore which word labels it
   * (KAN-141). Set by the two date items in the sort menu, so the number on
   * the row always describes the order the list is in.
   *
   * It lives HERE, in device-local settings, rather than on the container.
   * `saveToFirestore` sends tabContainerData and nothing else, so a preference
   * kept here needs no merge rule -- the same reasoning that kept the sort mode
   * derived in KAN-130 and KAN-136 rather than stored.
   *
   * The consequence is accepted and documented: the ORDER syncs, through ranks,
   * and this does not. Sort by date saved here, open on another device, and
   * that device shows edited dates in created order until its own menu is
   * touched. Cosmetic, confined to the multi-device-plus-explicit-sort corner,
   * and cheaper than a container field with its own last-writer-wins rule.
   */
  sessionDateBasis: SessionDateBasis;
}

/**
 * `edited` is the default because it is what the list is ordered by when
 * nothing has been pinned.
 */
export type SessionDateBasis = 'edited' | 'created';

// Retrieve settings from localStorage
const settingsDataLocal = asPartialSettings<SettingsData>(
  loadFromLocalStorage('settingsData')
);

const SHIPPED_LANGUAGES = Object.values(Language);

/**
 * The language the popup opens in (KAN-282): the one saved here, else the
 * browser's UI language mapped onto one this build ships, else English.
 *
 * Every user who has ever changed any setting has `language` saved, because
 * each setting write persists the whole object -- so detection only ever
 * decides a first run, and never moves an existing user.
 *
 * A saved value this build does not ship counts as nothing saved rather than
 * being handed to i18next, which would fetch a locale file that does not exist
 * (#42). The quote strip predates this: #42's `i18nextLng` key was JSON-quoted.
 */
export function startupLanguage(stored: unknown, uiTag: unknown): Language {
  const saved =
    typeof stored === 'string'
      ? SHIPPED_LANGUAGES.find((l) => l === stored.replace(/"/g, ''))
      : undefined;
  return saved ?? matchUiLanguage(uiTag, SHIPPED_LANGUAGES) ?? Language.EN;
}

const defaultSettings: SettingsData = {
  language: Language.EN, // overridden by startupLanguage in initialState
  theme: Theme.LIGHT,
  exportLayout: 'compact',
  isAutoSync: true,
  cloudConsent: '',
  extensionInstalledTime: '',
  isSkippedUserReviewOnce: false,
  isUserRatedAndReviewed: false,
  isNeverAskAgainToRate: false,
  lastReviewRequestTime: '',
  lastValueMomentTime: '',
  lastSyncedTime: '',
  isTabGroupsPromptAnsweredOnce: false,
  isNeverAskAgainForTabGroups: false,
  sessionDateBasis: 'edited',
};

export const initialState: SettingsData = {
  ...defaultSettings,
  ...settingsDataLocal,
  // KAN-282. Decided here, and read by i18n.tsx from here, so what renders
  // and what the first setting write saves are the same language. Detecting
  // only in i18n.tsx showed German once: this still held `en`, the first-run
  // consent answer saved it, and every later open was English.
  language: startupLanguage(settingsDataLocal.language, readUiLanguage()),
};

export const settingsDataStateSlice = createSlice({
  name: 'settingsDataState',
  initialState,
  reducers: {
    setTheme: (state, action: PayloadAction<Theme>) => {
      state.theme = action.payload;

      // Save updated state to localStorage
      saveToLocalStorage('settingsData', state);
    },

    setLanguage: (state, action: PayloadAction<Language>) => {
      state.language = action.payload;

      // Save updated state to localStorage
      saveToLocalStorage('settingsData', state);
    },

    // KAN-259. The two answers. Declining turns Auto Sync off. Granting
    // records the yes and leaves the flag to the caller: the welcome and the
    // toggle turn it on, the cloud button does NOT -- a user who asked for
    // one sync did not ask for a setting. Turning the flag on with consent
    // declined re-asks (Settings) rather than uploading.
    grantCloudConsent: (state) => {
      state.cloudConsent = 'granted';
      saveToLocalStorage('settingsData', state);
    },

    declineCloudConsent: (state) => {
      state.cloudConsent = 'declined';
      state.isAutoSync = false;
      saveToLocalStorage('settingsData', state);
    },

    // KAN-254. Deleting cloud data turns auto sync off; a toggle would flip
    // whatever it was, and it must land on off.
    setAutoSync: (state, action: PayloadAction<boolean>) => {
      state.isAutoSync = action.payload;

      // Save updated state to localStorage
      saveToLocalStorage('settingsData', state);
    },

    toggleAutoSync: (state) => {
      state.isAutoSync = !state.isAutoSync;

      // Save updated state to localStorage
      saveToLocalStorage('settingsData', state);
    },

    setExtensionInstalledTime: (state) => {
      state.extensionInstalledTime = Date.now();

      // Save updated state to localStorage
      saveToLocalStorage('settingsData', state);
    },

    setSkippedUserReviewOnce: (state) => {
      state.isSkippedUserReviewOnce = true;

      // Save updated state to localStorage
      saveToLocalStorage('settingsData', state);
    },

    setUserRatedAndReviewed: (state) => {
      state.isUserRatedAndReviewed = true;

      // Save updated state to localStorage
      saveToLocalStorage('settingsData', state);
    },

    setNeverAskAgainToRate: (state) => {
      state.isNeverAskAgainToRate = true;

      // Save updated state to localStorage
      saveToLocalStorage('settingsData', state);
    },

    /**
     * Record that the extension just did something worth being asked about.
     *
     * Deliberately last-write-wins on a single timestamp rather than a count:
     * the prompt only ever asks "has anything happened since I last asked",
     * so a tally would be state nothing reads.
     */
    // KAN-255. Stamped by the sync thunk on the success path only; a failed
    // or refused sync leaves the last true time standing.
    recordSyncedNow: (state) => {
      state.lastSyncedTime = Date.now();
      saveToLocalStorage('settingsData', state);
    },

    // For tests and seeds; the app stamps through recordSyncedNow.
    setLastSyncedTime: (state, action: PayloadAction<number | ''>) => {
      state.lastSyncedTime = action.payload;
      saveToLocalStorage('settingsData', state);
    },

    recordValueMoment: (state) => {
      state.lastValueMomentTime = Date.now();

      // Save updated state to localStorage
      saveToLocalStorage('settingsData', state);
    },

    updateLastReviewRequestTime: (state) => {
      state.lastReviewRequestTime = Date.now();

      // Save updated state to localStorage
      saveToLocalStorage('settingsData', state);
    },

    setTabGroupsPromptAnsweredOnce: (state) => {
      state.isTabGroupsPromptAnsweredOnce = true;

      // Save updated state to localStorage
      saveToLocalStorage('settingsData', state);
    },

    setNeverAskAgainForTabGroups: (state) => {
      state.isNeverAskAgainForTabGroups = true;

      // Save updated state to localStorage
      saveToLocalStorage('settingsData', state);
    },

    setExportLayout: (state, action: PayloadAction<ExportLayout>) => {
      state.exportLayout = action.payload;

      // Save updated state to localStorage
      saveToLocalStorage('settingsData', state);
    },

    setSessionDateBasis: (state, action: PayloadAction<SessionDateBasis>) => {
      state.sessionDateBasis = action.payload;

      // Save updated state to localStorage
      saveToLocalStorage('settingsData', state);
    },

    replaceState: (state, action: PayloadAction<typeof state>) => {
      // Save updated state to localStorage
      saveToLocalStorage('settingsData', state);

      return action.payload;
    },
  },
});

export const {
  setTheme,
  setLanguage,
  toggleAutoSync,
  setAutoSync,
  grantCloudConsent,
  declineCloudConsent,
  setNeverAskAgainToRate,
  setUserRatedAndReviewed,
  setSkippedUserReviewOnce,
  setExtensionInstalledTime,
  updateLastReviewRequestTime,
  recordValueMoment,
  recordSyncedNow,
  setLastSyncedTime,
  setTabGroupsPromptAnsweredOnce,
  setNeverAskAgainForTabGroups,
  setSessionDateBasis,
  setExportLayout,
} = settingsDataStateSlice.actions;

export default settingsDataStateSlice.reducer;

/**
 * Whether this device may sync right now (KAN-259): the user said yes, and
 * has not since turned Auto Sync off. Every sync starter reads this, never
 * `isAutoSync` alone.
 */
export const cloudSyncAllowed = (settings: SettingsData): boolean =>
  settings.isAutoSync && settings.cloudConsent === 'granted';
