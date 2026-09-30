import type { Middleware, StateFromReducersMapObject } from '@reduxjs/toolkit';

import { rootReducer } from '../storeConfig';
import { dropReopenOffer } from '../reopenOfferStore';
import { pruneToastTimers } from '../toastTimers';

// Typed from the reducer map, not RootState: RootState is read off the store
// this middleware is part of, and the type would refer to itself.
type State = StateFromReducersMapObject<typeof rootReducer>;

// KAN-349. After any change to the toast list, whichever action made it (a
// toast added, one timing out, the cap pushing the oldest out, a close):
// - timers for toasts no longer on screen stop and go;
// - the Reopen registry agrees with the list. An offer whose toast has left
//   is dropped from memory, so no old close can be reopened from under other
//   messages (KAN-280 O8a).
export const toastMiddleware: Middleware<object, State> =
  (api) => (next) => (action) => {
    const before = api.getState().globalState.toasts;
    const result = next(action);
    const toasts = api.getState().globalState.toasts;
    if (toasts === before) return result;
    pruneToastTimers(new Set(toasts.map((t) => t.id)));
    if (!toasts.some((t) => t.reopenOffer !== null)) dropReopenOffer();
    return result;
  };
