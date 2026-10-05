import { useEffect, useRef } from 'react';
import { useDispatch, useSelector } from 'react-redux';

import type { AppDispatch, RootState } from '../redux/store';
import { endTourIfInterrupted } from '../redux/sampleTour';

// KAN-413. Once per open, after the first load; <html data-tour-check> is the e2e barrier.
export function useInterruptedTourCleanup(): void {
  const dispatch: AppDispatch = useDispatch();
  const isLoaded = useSelector(
    (state: RootState) => !state.globalState.holdsPlaceholderSessions
  );
  const checked = useRef(false);
  useEffect(() => {
    if (!isLoaded || checked.current) return;
    checked.current = true;
    void dispatch(endTourIfInterrupted()).then((outcome) => {
      document.documentElement.dataset.tourCheck = outcome;
    });
  }, [isLoaded, dispatch]);
}
