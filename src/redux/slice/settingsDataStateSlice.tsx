import { PayloadAction, createSlice } from '@reduxjs/toolkit';
import {
  loadFromLocalStorage,
  saveToLocalStorage,
} from '../../utils/helperFunctions';

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
}

// Retrieve settings from localStorage
const settingsDataLocal = loadFromLocalStorage('settingsData');

export const initialState: SettingsData = settingsDataLocal
  ? settingsDataLocal
  : {
      language: 'en', // Default language is 'en'
      theme: Theme.LIGHT,
      isAutoSync: true,
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
      saveToLocalStorage('i18nextLng', action.payload);
    },

    toggleAutoSync: (state) => {
      state.isAutoSync = !state.isAutoSync;

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

export const { setTheme, setLanguage, toggleAutoSync } =
  settingsDataStateSlice.actions;

export default settingsDataStateSlice.reducer;
