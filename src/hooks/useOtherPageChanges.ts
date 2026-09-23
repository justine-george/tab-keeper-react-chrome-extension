import { useEffect } from 'react';
import { useDispatch } from 'react-redux';
import { useTranslation } from 'react-i18next';

import type { AppDispatch } from '../redux/store';
import {
  applyOtherPageSessions,
  applyOtherPageSettings,
} from '../redux/otherPageChanges';

/**
 * KAN-279 D9. Takes in what another open page of the extension (the popup, or
 * the pop-out tab) wrote to localStorage, without a reload.
 *
 * The browser fires `storage` in every OTHER page of the origin when one
 * writes, never in the writer. Only the two keys the app writes are acted on;
 * the thunks re-read localStorage rather than trusting `e.newValue`, so a
 * burst of writes lands on the latest. A `clear()` (key null) and a
 * `removeItem` (newValue null) are ignored: nothing in the app does either,
 * and there is no value to take in.
 *
 * The html `lang` mirror follows i18n's own languageChanged event
 * (documentLanguage.ts), and the theme is read from the store, so a settings
 * change needs no other side effect here.
 */
export function useOtherPageChanges(): void {
  const dispatch: AppDispatch = useDispatch();
  const { i18n } = useTranslation();

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === null || e.newValue === null) return;
      if (e.key === 'tabContainerData') {
        dispatch(applyOtherPageSessions());
      } else if (e.key === 'settingsData') {
        const { languageChanged } = dispatch(applyOtherPageSettings());
        if (languageChanged !== null) void i18n.changeLanguage(languageChanged);
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [dispatch, i18n]);
}
