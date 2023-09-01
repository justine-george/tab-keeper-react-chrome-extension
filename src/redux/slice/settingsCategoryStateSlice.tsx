import { PayloadAction, createSlice } from '@reduxjs/toolkit';

export interface SettingsCategory {
  name: string;
  isSelected: boolean;
}

export const initialState: SettingsCategory[] = [
  {
    name: 'General',
    isSelected: true,
  },
  {
    name: 'Sync & Privacy',
    isSelected: false,
  },
  {
    name: 'Credits',
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
