import { useEffect } from 'react';
import { useDispatch } from 'react-redux';

import type { AppDispatch } from '../redux/store';
import { applyOtherPageSessions } from '../redux/otherPageChanges';
import { useOtherPageSettings } from './useOtherPageSettings';

/**
 * KAN-279 D9. Takes in what another open page of the extension (the popup, or
 * the pop-out tab) wrote to localStorage, without a reload: the sessions here,
 * the settings through useOtherPageSettings.
 *
 * The browser fires `storage` in every OTHER page of the origin when one
 * writes, never in the writer. The thunk re-reads localStorage rather than
 * trusting `e.newValue`, so a burst of writes lands on the latest. A `clear()`
 * (key null) and a `removeItem` (newValue null) are ignored: nothing in the
 * app does either, and there is no value to take in.
 *
 * The html `lang` mirror follows i18n's own languageChanged event
 * (documentLanguage.ts), and the theme is read from the store, so a settings
 * change needs no other side effect here.
 */
export function useOtherPageChanges(): void {
  const dispatch: AppDispatch = useDispatch();
  useOtherPageSettings();

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== 'tabContainerData' || e.newValue === null) return;
      dispatch(applyOtherPageSessions());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [dispatch]);
}
