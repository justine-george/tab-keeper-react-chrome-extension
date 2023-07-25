import { configureStore } from "@reduxjs/toolkit";
import globalStateReducer from "../components/slice/globalStateSlice";
import settingsDataStateReducer from "../components/slice/settingsDataStateSlice";
import settingsCategoryStateReducer from "../components/slice/settingsCategoryStateSlice";

export const store = configureStore({
  reducer: {
    globalState: globalStateReducer,
    settingsDataState: settingsDataStateReducer,
    settingsCategoryState: settingsCategoryStateReducer,
  },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
