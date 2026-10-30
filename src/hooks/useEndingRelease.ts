import { useCallback } from 'react';
import { useDispatch, useStore } from 'react-redux';

import type { AppDispatch, RootState } from '../redux/store';
import { isEndingVisibleHere, showEnding } from '../redux/onboardingEnding';
import { useSettledRelease } from './useReviewAskRelease';

// KAN-879. Shows the asked-for ending once it could be seen, with no modal dialog or review card open.
export function useEndingRelease(areOpenDialogsDecided: boolean): void {
  const store = useStore<RootState>();
  const dispatch = useDispatch<AppDispatch>();
  const release = useCallback(() => {
    const state = store.getState();
    if (state.globalState.endingCard !== 'pending') return;
    if (!isEndingVisibleHere(state)) return;
    // Never over the review card.
    if (state.globalState.reviewCard !== null) return;
    if (document.querySelector('dialog:modal') !== null) return;
    dispatch(showEnding());
  }, [store, dispatch]);
  useSettledRelease(areOpenDialogsDecided, release);
}
