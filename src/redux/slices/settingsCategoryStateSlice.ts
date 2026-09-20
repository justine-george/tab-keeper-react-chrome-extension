import { PayloadAction, createSlice } from '@reduxjs/toolkit';

export enum SettingsCategory {
  DISPLAY = 'Display',
  SYNC = 'Sync & Backup',
  SESSIONS = 'Sessions',
  LANGUAGE = 'Language',
  ABOUT = 'About',
}

export interface SettingsCategoryContainer {
  name: SettingsCategory;
  isSelected: boolean;
}

// Two pairs, then About (KAN-253): how it looks (Display, Language), then
// what it does with your data (Sync & Backup, then Sessions -- the
// consequential one first). Display stays first: it is the pane the gear
// opens, and Sessions is one toggle on an otherwise empty pane.
export const initialState: SettingsCategoryContainer[] = [
  {
    name: SettingsCategory.DISPLAY,
    isSelected: true,
  },
  {
    name: SettingsCategory.LANGUAGE,
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
  {
    name: SettingsCategory.ABOUT,
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
