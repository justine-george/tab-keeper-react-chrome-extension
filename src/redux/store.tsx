import { configureStore } from "@reduxjs/toolkit";
import globalStateReducer from "./slice/globalStateSlice";
import settingsDataStateReducer from "./slice/settingsDataStateSlice";
import settingsCategoryStateReducer from "./slice/settingsCategoryStateSlice";
import tabContainerDataStateReducer from "./slice/tabContainerDataStateSlice";

export const store = configureStore({
  reducer: {
    globalState: globalStateReducer,
    settingsDataState: settingsDataStateReducer,
    settingsCategoryState: settingsCategoryStateReducer,
    tabContainerDataState: tabContainerDataStateReducer,
  },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
