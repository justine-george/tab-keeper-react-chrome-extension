import { PayloadAction, createSlice } from "@reduxjs/toolkit";

export interface SettingsData {
  isDarkMode: boolean;
  isAutoSync: boolean;
  footerText: string;
}

export const initialState: SettingsData = {
  isDarkMode: false,
  isAutoSync: true,
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

    replaceState: (state, action: PayloadAction<typeof state>) =>
      action.payload,
  },
});

export const { toggleDarkMode, toggleAutoSync } =
  settingsDataStateSlice.actions;

export default settingsDataStateSlice.reducer;
