import { PayloadAction, createSlice } from '@reduxjs/toolkit';
import { SETTINGS_CATEGORIES } from '../../utils/constants/common';

export interface SettingsCategory {
  name: string;
  isSelected: boolean;
}

export const initialState: SettingsCategory[] = [
  {
    name: SETTINGS_CATEGORIES.GENERAL,
    isSelected: true,
  },
  {
    name: SETTINGS_CATEGORIES.SYNC,
    isSelected: false,
  },
  {
    name: SETTINGS_CATEGORIES.DATA_MANAGEMENT,
    isSelected: false,
  },
  {
    name: SETTINGS_CATEGORIES.CREDITS,
    isSelected: false,
  },
];

export const settingsCategoryStateSlice = createSlice({
  name: 'settingsCategoryState',
  initialState,
  reducers: {
    selectCategory: (state, action: PayloadAction<string>) => {
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
