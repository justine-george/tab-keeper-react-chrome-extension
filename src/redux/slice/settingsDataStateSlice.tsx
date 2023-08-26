import { PayloadAction, createSlice } from "@reduxjs/toolkit";
import {
  loadFromLocalStorage,
  saveToLocalStorage,
} from "../../utils/helperFunctions";

export interface SettingsData {
  isDarkMode: boolean;
  isAutoSync: boolean;
}

// Retrieve settings from localStorage
const settingsDataLocal = loadFromLocalStorage("settingsData");

export const initialState: SettingsData = settingsDataLocal
  ? settingsDataLocal
  : {
      isDarkMode: false,
      isAutoSync: true,
    };

export const settingsDataStateSlice = createSlice({
  name: "settingsDataState",
  initialState,
  reducers: {
    toggleDarkMode: (state) => {
      state.isDarkMode = !state.isDarkMode;

      // Save updated state to localStorage
      saveToLocalStorage("settingsData", state);
    },

    toggleAutoSync: (state) => {
      state.isAutoSync = !state.isAutoSync;

      // Save updated state to localStorage
      saveToLocalStorage("settingsData", state);
    },

    replaceState: (state, action: PayloadAction<typeof state>) => {
      // Save updated state to localStorage
      saveToLocalStorage("settingsData", state);

      return action.payload;
    },
  },
});

export const { toggleDarkMode, toggleAutoSync } =
  settingsDataStateSlice.actions;

export default settingsDataStateSlice.reducer;
