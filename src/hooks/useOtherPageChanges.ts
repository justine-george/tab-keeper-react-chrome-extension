import { useEffect } from 'react';
import { useDispatch } from 'react-redux';

import type { AppDispatch } from '../redux/store';
import { applyOtherPageSessions } from '../redux/otherPageChanges';
import { useOtherPageSettings } from './useOtherPageSettings';
import { onOtherPageWrite } from '../utils/functions/otherPageSignal';

/**
 * KAN-279 D9. Takes in what another open page of the extension (the popup, or
 * the pop-out tab) wrote to localStorage, without a reload: the sessions here,
 * the settings through useOtherPageSettings.
 *
 * The browser fires `storage` in every OTHER page of the origin when one
 * writes, never in the writer, and not always even there: the writer's post
 * is the second signal (KAN-925, otherPageSignal.ts). The thunk re-reads
 * localStorage, so a burst of writes lands on the latest.
 *
 * The html `lang` mirror follows i18n's own languageChanged event
 * (documentLanguage.ts), and the theme is read from the store, so a settings
 * change needs no other side effect here.
 */
export function useOtherPageChanges(): void {
  const dispatch: AppDispatch = useDispatch();
  useOtherPageSettings();

  useEffect(
    () =>
      onOtherPageWrite('tabContainerData', () =>
        dispatch(applyOtherPageSessions())
      ),
    [dispatch]
  );
}
