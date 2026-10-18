import type {
  Middleware,
  StateFromReducersMapObject,
  ThunkDispatch,
  UnknownAction,
} from '@reduxjs/toolkit';
import i18next from 'i18next';

import { rootReducer } from '../storeConfig';
import {
  applyOtherPageSessions,
  applyOtherPageSettings,
} from '../otherPageChanges';
import { takeOtherPageWriteMerged } from '../../utils/functions/localSessions';
import { takeOtherPageSettingsMerged } from '../../utils/functions/localSettings';

// Typed from the reducer map, not RootState, as toastMiddleware is.
type State = StateFromReducersMapObject<typeof rootReducer>;

// KAN-666. A save that merged in another page's unheard write takes it in on
// screen, as the storage event would have: a held row waits, undo resets.
// Outside customMiddleware, so the reset also clears the step it records.
// KAN-661. Settings the same, language included.
export const otherPageWriteMiddleware: Middleware<
  object,
  State,
  ThunkDispatch<State, unknown, UnknownAction>
> = (api) => (next) => (action) => {
  const result = next(action);
  if (takeOtherPageWriteMerged()) void api.dispatch(applyOtherPageSessions());
  if (takeOtherPageSettingsMerged()) {
    const { languageChanged } = api.dispatch(applyOtherPageSettings());
    if (languageChanged !== null) void i18next.changeLanguage(languageChanged);
  }
  return result;
};
