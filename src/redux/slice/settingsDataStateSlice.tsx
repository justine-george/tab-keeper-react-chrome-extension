import { createSlice } from "@reduxjs/toolkit";

export interface SettingsData {
  isDarkMode: boolean;
  footerText: string;
}

const initialState: SettingsData = {
  isDarkMode: false,
  footerText: "Made by Justine George.",
};

export const settingsDataStateSlice = createSlice({
  name: "settingsData",
  initialState,
  reducers: {
    toggleDarkMode: (state) => {
      state.isDarkMode = !state.isDarkMode;
    },
  },
});

export const { toggleDarkMode } = settingsDataStateSlice.actions;

export default settingsDataStateSlice.reducer;
