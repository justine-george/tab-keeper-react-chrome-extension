import { PayloadAction, createSlice } from "@reduxjs/toolkit";

export interface SettingsData {
  isDarkMode: boolean;
  isAutoSync: boolean;
  isAutoSave: boolean;
  footerText: string;
}

export const initialState: SettingsData = {
  isDarkMode: false,
  isAutoSync: true,
  isAutoSave: true,
  footerText: "Made by Justine George.",
};

export const settingsDataStateSlice = createSlice({
  name: "settingsDataState",
  initialState,
  reducers: {
    toggleDarkMode: (state) => {
      state.isDarkMode = !state.isDarkMode;
    },

    toggleAutoSync: (state) => {
      state.isAutoSync = !state.isAutoSync;
    },

    toggleAutoSave: (state) => {
      state.isAutoSave = !state.isAutoSave;
    },

    replaceState: (state, action: PayloadAction<typeof state>) =>
      action.payload,
  },
});

export const { toggleDarkMode, toggleAutoSync, toggleAutoSave } =
  settingsDataStateSlice.actions;

export default settingsDataStateSlice.reducer;
