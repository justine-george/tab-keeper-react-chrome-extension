import { createSlice, PayloadAction } from '@reduxjs/toolkit';

import {
  asPartialSettings,
  loadFromLocalStorage,
  saveToLocalStorage,
} from '../../utils/functions/local';

export enum Theme {
  LIGHT = 'Light',
  WARM_LIGHT = 'WarmLight',
  BB_PINK = 'BBPink',
  DARKENHEIMER = 'Darkenheimer',
  BLUE = 'Blue',
}

export enum Language {
  DE = 'de',
  EN = 'en',
  ES = 'es',
  FR = 'fr',
  HI = 'hi',
  IT = 'it',
  JA = 'ja',
  PT = 'pt',
  RU = 'ru',
  ZH = 'zh',
}

export interface SettingsData {
  theme: Theme;
  language: Language;
  isAutoSync: boolean;
  isLazyLoad: boolean;
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

const defaultSettings: SettingsData = {
  language: Language.EN, // Default language is 'en'
  theme: Theme.LIGHT,
  isAutoSync: true,
  isLazyLoad: true,
  extensionInstalledTime: '',
  isSkippedUserReviewOnce: false,
  isUserRatedAndReviewed: false,
  isNeverAskAgainToRate: false,
  lastReviewRequestTime: '',
  lastValueMomentTime: '',
  isTabGroupsPromptAnsweredOnce: false,
  isNeverAskAgainForTabGroups: false,
  sessionDateBasis: 'edited',
};

export const initialState: SettingsData = {
  ...defaultSettings,
  ...settingsDataLocal,
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

    toggleAutoSync: (state) => {
      state.isAutoSync = !state.isAutoSync;

      // Save updated state to localStorage
      saveToLocalStorage('settingsData', state);
    },

    toggleLazyLoad: (state) => {
      state.isLazyLoad = !state.isLazyLoad;

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
  toggleLazyLoad,
  setNeverAskAgainToRate,
  setUserRatedAndReviewed,
  setSkippedUserReviewOnce,
  setExtensionInstalledTime,
  updateLastReviewRequestTime,
  recordValueMoment,
  setTabGroupsPromptAnsweredOnce,
  setNeverAskAgainForTabGroups,
  setSessionDateBasis,
} = settingsDataStateSlice.actions;

export default settingsDataStateSlice.reducer;
