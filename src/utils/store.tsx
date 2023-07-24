import { configureStore } from "@reduxjs/toolkit";
import globalStateReducer from "../components/slice/globalStateSlice";
import settingsStateReducer from "../components/slice/settingsStateSlice";

export const store = configureStore({
  reducer: {
    globalState: globalStateReducer,
    settingsState: settingsStateReducer,
  },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
