import { configureStore, Middleware } from '@reduxjs/toolkit';

import globalStateReducer from '../../redux/slices/globalStateSlice';
import settingsDataStateReducer from '../../redux/slices/settingsDataStateSlice';
import settingsCategoryStateReducer from '../../redux/slices/settingsCategoryStateSlice';
import tabContainerDataStateReducer from '../../redux/slices/tabContainerDataStateSlice';
import undoRedoReducer from '../../redux/slices/undoRedoSlice';
import { customMiddleware } from '../../redux/middleware/customMiddleware';

// Mirrors src/redux/store.tsx, plus a recorder so tests can assert on the
// action sequence the middleware produces. Thunks arrive as functions and have
// no `.type`. serializableCheck is off because the recorder sees thunk
// functions, which the default check would flag.
export function makeTestStore() {
  const seen: string[] = [];
  const recorder: Middleware = () => (next) => (action: unknown) => {
    seen.push(
      typeof action === 'function'
        ? 'THUNK'
        : String((action as { type?: unknown })?.type)
    );
    return next(action as never);
  };

  const store = configureStore({
    reducer: {
      undoRedo: undoRedoReducer,
      globalState: globalStateReducer,
      settingsDataState: settingsDataStateReducer,
      settingsCategoryState: settingsCategoryStateReducer,
      tabContainerDataState: tabContainerDataStateReducer,
    },
    middleware: (g) =>
      g({ serializableCheck: false })
        .prepend(recorder)
        .concat(customMiddleware),
  });

  return { store, seen };
}
