import type {
  Middleware,
  StateFromReducersMapObject,
  ThunkDispatch,
  UnknownAction,
} from '@reduxjs/toolkit';

import { rootReducer } from '../storeConfig';
import { showToast } from '../slices/globalStateSlice';
import { TOAST_MESSAGES } from '../../utils/constants/common';
import { hydrateSettingsFromOtherPage } from '../slices/settingsDataStateSlice';
import { clearUnsavedSettings, noteUnsavedSettings } from '../unsavedSettings';
import {
  isStoredBehindPage,
  takeStorageFull,
} from '../../utils/functions/local';

// Typed from the reducer map, not RootState, as toastMiddleware is.
type State = StateFromReducersMapObject<typeof rootReducer>;

// KAN-593. A save the localStorage quota refused says so, once per action. The
// change stays on screen, and the next save that fits writes it with the rest.
export const storageFullMiddleware: Middleware<
  object,
  State,
  ThunkDispatch<State, unknown, UnknownAction>
> = (api) => (next) => (action) => {
  const before = api.getState().settingsDataState;
  const result = next(action);
  // KAN-615. What this page changed while its settings saves are refused; a
  // value taken from another page is that page's, not this one's.
  const after = api.getState().settingsDataState;
  if (!isStoredBehindPage('settingsData')) {
    clearUnsavedSettings();
  } else if (after !== before && !hydrateSettingsFromOtherPage.match(action)) {
    noteUnsavedSettings(before, after);
  }
  // Taken before the toast is dispatched: it passes through here too, and a
  // note still set would toast again, without end.
  if (takeStorageFull()) {
    void api.dispatch(showToast({ toastText: TOAST_MESSAGES.STORAGE_FULL }));
  }
  return result;
};
