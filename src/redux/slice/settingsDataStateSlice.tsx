import { PayloadAction, createSlice } from "@reduxjs/toolkit";

export interface SettingsData {
  isDarkMode: boolean;
  footerText: string;
}

export const initialState: SettingsData = {
  isDarkMode: false,
  footerText: "Made by Justine George.",
};

export const settingsDataStateSlice = createSlice({
  name: "settingsDataState",
  initialState,
  reducers: {
    toggleDarkMode: (state) => {
      state.isDarkMode = !state.isDarkMode;
    },

    replaceState: (state, action: PayloadAction<typeof state>) =>
      action.payload,
  },
});

export const { toggleDarkMode } = settingsDataStateSlice.actions;

export default settingsDataStateSlice.reducer;
