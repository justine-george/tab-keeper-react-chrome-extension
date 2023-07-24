import { createSlice } from "@reduxjs/toolkit";

export interface SettingsState {
  isDarkMode: boolean;
  footerText: string;
}

const initialState: SettingsState = {
  isDarkMode: false,
  footerText: "Made by Justine George.",
};

export const settingsStateSlice = createSlice({
  name: "global",
  initialState,
  reducers: {
    toggleDarkMode: (state) => {
      state.isDarkMode = !state.isDarkMode;
    },
  },
});

export const { toggleDarkMode } = settingsStateSlice.actions;

export default settingsStateSlice.reducer;
