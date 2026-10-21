import {
  configureStore,
  isAction,
  type Action,
  type Middleware,
} from '@reduxjs/toolkit';

import { rootReducer } from '../../redux/storeConfig';
import { customMiddleware } from '../../redux/middleware/customMiddleware';
import { toastMiddleware } from '../../redux/middleware/toastMiddleware';
import { storageFullMiddleware } from '../../redux/middleware/storageFullMiddleware';
import { otherPageWriteMiddleware } from '../../redux/middleware/otherPageWriteMiddleware';
import { initialState } from '../../redux/slices/settingsDataStateSlice';
import { Theme } from '../../utils/constants/theme';
import { noteStoredSettingsSeen } from '../../utils/functions/localSettings';

// Mirrors src/redux/store.tsx via the shared rootReducer, plus a recorder so
// tests can assert on the action sequence the middleware produces. Thunks
// arrive as functions and have no `.type`. serializableCheck is off because
// the recorder sees thunk functions, which the default check would flag.
// `actions` keeps the whole action, for a test that must pin a payload and not
// only a type.
export function makeTestStore() {
  const seen: string[] = [];
  const actions: Action<string>[] = [];
  const recorder: Middleware = () => (next) => (action: unknown) => {
    if (isAction(action)) actions.push(action);
    seen.push(
      typeof action === 'function'
        ? 'THUNK'
        : String((action as { type?: unknown })?.type)
    );
    return next(action as never);
  };

  const store = configureStore({
    reducer: rootReducer,
    // KAN-731. The harness is a user on Paper; the default is pinned by its own tests.
    preloadedState: {
      settingsDataState: { ...initialState, theme: Theme.LIGHT },
    },
    middleware: (g) =>
      g({ serializableCheck: false })
        .prepend(recorder)
        .concat(
          otherPageWriteMiddleware,
          customMiddleware,
          toastMiddleware,
          storageFullMiddleware
        ),
  });
  // KAN-661. As a page's load does: its saves merge against what it loaded.
  noteStoredSettingsSeen(store.getState().settingsDataState);

  return { store, seen, actions };
}
