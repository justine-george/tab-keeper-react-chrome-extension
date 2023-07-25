import { createSlice } from "@reduxjs/toolkit";

export interface SettingsDataState {
  isDarkMode: boolean;
  footerText: string;
}

const initialState: SettingsDataState = {
  isDarkMode: false,
  footerText: "Made by Justine George.",
};

export const settingsDataStateSlice = createSlice({
  name: "global",
  initialState,
  reducers: {
    toggleDarkMode: (state) => {
      state.isDarkMode = !state.isDarkMode;
    },
  },
});

export const { toggleDarkMode } = settingsDataStateSlice.actions;

export default settingsDataStateSlice.reducer;
