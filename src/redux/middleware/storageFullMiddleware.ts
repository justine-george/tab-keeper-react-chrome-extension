import type {
  Middleware,
  StateFromReducersMapObject,
  ThunkDispatch,
  UnknownAction,
} from '@reduxjs/toolkit';

import { rootReducer } from '../storeConfig';
import { showToast } from '../slices/globalStateSlice';
import { TOAST_MESSAGES } from '../../utils/constants/common';
import { takeStorageFull } from '../../utils/functions/local';

// Typed from the reducer map, not RootState, as toastMiddleware is.
type State = StateFromReducersMapObject<typeof rootReducer>;

// KAN-593. A save the localStorage quota refused says so, once per action. The
// change stays on screen, and the next save that fits writes it with the rest.
export const storageFullMiddleware: Middleware<
  object,
  State,
  ThunkDispatch<State, unknown, UnknownAction>
> = (api) => (next) => (action) => {
  const result = next(action);
  // Taken before the toast is dispatched: it passes through here too, and a
  // note still set would toast again, without end.
  if (takeStorageFull()) {
    void api.dispatch(showToast({ toastText: TOAST_MESSAGES.STORAGE_FULL }));
  }
  return result;
};
