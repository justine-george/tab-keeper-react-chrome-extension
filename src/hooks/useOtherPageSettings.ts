import { useEffect } from 'react';
import { useDispatch } from 'react-redux';
import { useTranslation } from 'react-i18next';

import type { AppDispatch } from '../redux/store';
import { applyOtherPageSettings } from '../redux/otherPageChanges';

/**
 * KAN-279 D9, the settings half. Takes in the settings another open page of
 * the extension wrote to localStorage, without a reload.
 *
 * Every page that saves settings needs it (KAN-305): each settings reducer
 * saves the WHOLE object, so a page holding a stale copy would undo, on its
 * next save, whatever another page changed meanwhile.
 *
 * The browser fires `storage` in every OTHER page of the origin when one
 * writes, never in the writer. The thunk re-reads localStorage rather than
 * trusting `e.newValue`, so a burst of writes lands on the latest. A
 * `removeItem` or `clear()` (newValue null) is ignored: nothing in the app
 * does either, and there is no value to take in.
 */
export function useOtherPageSettings(): void {
  const dispatch: AppDispatch = useDispatch();
  const { i18n } = useTranslation();

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== 'settingsData' || e.newValue === null) return;
      const { languageChanged } = dispatch(applyOtherPageSettings());
      if (languageChanged !== null) void i18n.changeLanguage(languageChanged);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [dispatch, i18n]);
}
