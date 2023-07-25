import { PayloadAction, createSlice } from "@reduxjs/toolkit";

export interface SettingsCategoryState {
  name: string;
  isSelected: boolean;
}

const initialState: SettingsCategoryState[] = [
  {
    name: "General",
    isSelected: true,
  },
  {
    name: "Credits",
    isSelected: false,
  },
];

export const settingsCategoryStateSlice = createSlice({
  name: "settingsData",
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
  },
});

export const { selectCategory } = settingsCategoryStateSlice.actions;

export default settingsCategoryStateSlice.reducer;
