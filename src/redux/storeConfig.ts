import globalStateReducer from './slices/globalStateSlice';
import settingsDataStateReducer from './slices/settingsDataStateSlice';
import settingsCategoryStateReducer from './slices/settingsCategoryStateSlice';
import tabContainerDataStateReducer from './slices/tabContainerDataStateSlice';
import undoRedoReducer from './slices/undoRedoSlice';

// The single declaration of the store's shape. src/redux/store.tsx and
// src/tests/setup/makeStore.ts both build from this, so a slice added to the
// app cannot go missing from tests.
export const rootReducer = {
  undoRedo: undoRedoReducer,
  globalState: globalStateReducer,
  settingsDataState: settingsDataStateReducer,
  settingsCategoryState: settingsCategoryStateReducer,
  tabContainerDataState: tabContainerDataStateReducer,
};
