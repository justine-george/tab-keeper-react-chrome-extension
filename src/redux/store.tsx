import { configureStore } from '@reduxjs/toolkit';
import globalStateReducer from './slices/globalStateSlice';
import settingsDataStateReducer from './slices/settingsDataStateSlice';
import settingsCategoryStateReducer from './slices/settingsCategoryStateSlice';
import tabContainerDataStateReducer from './slices/tabContainerDataStateSlice';
import undoRedoReducer from './slices/undoRedoSlice';
import { customMiddleware } from './middleware/customMiddleware';

export const store = configureStore({
  reducer: {
    undoRedo: undoRedoReducer,
    globalState: globalStateReducer,
    settingsDataState: settingsDataStateReducer,
    settingsCategoryState: settingsCategoryStateReducer,
    tabContainerDataState: tabContainerDataStateReducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware().concat(customMiddleware),
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
