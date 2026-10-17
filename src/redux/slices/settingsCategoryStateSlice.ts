import { PayloadAction, createSlice } from '@reduxjs/toolkit';

export enum SettingsCategory {
  DISPLAY = 'Display',
  SYNC = 'Sync & Backup',
  SESSIONS = 'Sessions',
  QUICK_ACCESS = 'Quick access',
  RECENTLY_DELETED = 'Recently deleted',
  LANGUAGE = 'Language',
  ABOUT = 'About',
  HELP = 'Help',
}

export interface SettingsCategoryContainer {
  name: SettingsCategory;
  isSelected: boolean;
}

// Two pairs, then About and Help (KAN-253): how it looks (Display,
// Language), then what it does with your data (Sync & Backup, then Sessions
// -- the consequential one first). Display stays first: it is the pane the
// gear opens, and Sessions is one toggle on an otherwise empty pane.
export const initialState: SettingsCategoryContainer[] = [
  {
    name: SettingsCategory.DISPLAY,
    isSelected: true,
  },
  {
    name: SettingsCategory.LANGUAGE,
    isSelected: false,
  },
  // KAN-652. How Tab Keeper itself opens (Default view, the pin, the
  // shortcut), split from Sessions, which is about what a save keeps. After
  // Language: like the first pair, it is about Tab Keeper, not your data.
  {
    name: SettingsCategory.QUICK_ACCESS,
    isSelected: false,
  },
  {
    name: SettingsCategory.SYNC,
    isSelected: false,
  },
  {
    name: SettingsCategory.SESSIONS,
    isSelected: false,
  },
  // KAN-595. After Sessions: both are about what you have saved.
  {
    name: SettingsCategory.RECENTLY_DELETED,
    isSelected: false,
  },
  {
    name: SettingsCategory.ABOUT,
    isSelected: false,
  },
  // Help comes last.
  {
    name: SettingsCategory.HELP,
    isSelected: false,
  },
];

export const settingsCategoryStateSlice = createSlice({
  name: 'settingsCategoryState',
  initialState,
  reducers: {
    selectCategory: (state, action: PayloadAction<SettingsCategory>) => {
      const name = action.payload;
      // mutate the state such that if name matches state[].name,
      // set isSelected as true and if no match, set as false
      state.forEach((category) => {
        if (category.name === name) {
          category.isSelected = true;
        } else {
          category.isSelected = false;
        }
      });
    },

    replaceState: (state, action: PayloadAction<typeof state>) =>
      action.payload,
  },
});

export const { selectCategory } = settingsCategoryStateSlice.actions;

export default settingsCategoryStateSlice.reducer;
