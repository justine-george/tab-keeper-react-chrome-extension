import { PayloadAction, createSlice } from '@reduxjs/toolkit';

export enum SettingsCategory {
  DISPLAY = 'Display',
  SYNC = 'Sync & Privacy',
  DATA_MANAGEMENT = 'Data Management',
  LANGUAGE = 'Language',
  ABOUT = 'About',
}

export interface SettingsCategoryContainer {
  name: SettingsCategory;
  isSelected: boolean;
}

export const initialState: SettingsCategoryContainer[] = [
  {
    name: SettingsCategory.DISPLAY,
    isSelected: true,
  },
  {
    name: SettingsCategory.SYNC,
    isSelected: false,
  },
  {
    name: SettingsCategory.DATA_MANAGEMENT,
    isSelected: false,
  },
  {
    name: SettingsCategory.LANGUAGE,
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
