import type {
  Middleware,
  StateFromReducersMapObject,
  ThunkDispatch,
  UnknownAction,
} from '@reduxjs/toolkit';

import { rootReducer } from '../storeConfig';
import { applyOtherPageSessions } from '../otherPageChanges';
import { takeOtherPageWriteMerged } from '../../utils/functions/localSessions';

// Typed from the reducer map, not RootState, as toastMiddleware is.
type State = StateFromReducersMapObject<typeof rootReducer>;

// KAN-666. A save that merged in another page's unheard write takes it in on
// screen, as the storage event would have: a held row waits, undo resets.
// Outside customMiddleware, so the reset also clears the step it records.
export const otherPageWriteMiddleware: Middleware<
  object,
  State,
  ThunkDispatch<State, unknown, UnknownAction>
> = (api) => (next) => (action) => {
  const result = next(action);
  if (takeOtherPageWriteMerged()) void api.dispatch(applyOtherPageSessions());
  return result;
};
