import { configureStore } from "@reduxjs/toolkit";
import globalStateReducer from "./slice/globalStateSlice";
import settingsDataStateReducer from "./slice/settingsDataStateSlice";
import settingsCategoryStateReducer from "./slice/settingsCategoryStateSlice";
import tabContainerDataStateReducer from "./slice/tabContainerDataStateSlice";
import undoRedoReducer from "./slice/undoRedoSlice";
import { undoRedoMiddleware } from "./middleware/undoRedoMiddleware";

export const store = configureStore({
  reducer: {
    undoRedo: undoRedoReducer,
    globalState: globalStateReducer,
    settingsDataState: settingsDataStateReducer,
    settingsCategoryState: settingsCategoryStateReducer,
    tabContainerDataState: tabContainerDataStateReducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware().concat(undoRedoMiddleware),
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
