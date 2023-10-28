import { createSlice, PayloadAction } from '@reduxjs/toolkit';

import {
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
}

// Retrieve settings from localStorage
const settingsDataLocal = loadFromLocalStorage('settingsData');

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

    updateLastReviewRequestTime: (state) => {
      state.lastReviewRequestTime = Date.now();

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
} = settingsDataStateSlice.actions;

export default settingsDataStateSlice.reducer;
