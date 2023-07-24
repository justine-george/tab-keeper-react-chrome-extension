import { PayloadAction, createSlice } from "@reduxjs/toolkit";

export interface GlobalState {
  isSettingsPage: boolean;
  value: number;
}

const initialState: GlobalState = {
  isSettingsPage: false,
  value: 0,
};

export const globalStateSlice = createSlice({
  name: "global",
  initialState,
  reducers: {
    openSettingsPage: (state) => {
      state.isSettingsPage = !state.isSettingsPage;
    },
    // action: {type: "global/incrementByAmount", payload: <value passed as args>}
    incrementByAmount: (state, action: PayloadAction<number>) => {
      state.value += action.payload;
    },
  },
});

export const { openSettingsPage, incrementByAmount } = globalStateSlice.actions;

export default globalStateSlice.reducer;
