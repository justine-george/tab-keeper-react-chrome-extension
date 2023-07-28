import { createSlice } from "@reduxjs/toolkit";
import { isLotteryWon } from "../../utils/helperFunctions";

export interface SettingsData {
  isDarkMode: boolean;
  footerText: string;
}

const initialState: SettingsData = {
  isDarkMode: isLotteryWon(),
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
