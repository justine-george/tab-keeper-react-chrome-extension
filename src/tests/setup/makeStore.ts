import {
  configureStore,
  isAction,
  type Action,
  type Middleware,
} from '@reduxjs/toolkit';

import { rootReducer } from '../../redux/storeConfig';
import { customMiddleware } from '../../redux/middleware/customMiddleware';

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
    middleware: (g) =>
      g({ serializableCheck: false })
        .prepend(recorder)
        .concat(customMiddleware),
  });

  return { store, seen, actions };
}
