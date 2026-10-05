import type { ThunkAction, UnknownAction } from '@reduxjs/toolkit';

import type { RootState } from './store';
import { setLanguage, type Language } from './slices/settingsDataStateSlice';

// The part of the i18n instance a pick needs, so the caller hands in its own.
interface Translator {
  changeLanguage: (language: string) => Promise<unknown>;
}

// KAN-7. The one way a language is picked, in Settings and in the setup.
export const chooseLanguage =
  (
    language: Language,
    i18n: Translator
  ): ThunkAction<void, RootState, unknown, UnknownAction> =>
  (dispatch) => {
    void i18n.changeLanguage(language);
    dispatch(setLanguage(language));
  };
