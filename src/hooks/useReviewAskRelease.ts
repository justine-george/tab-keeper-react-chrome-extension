import { useCallback, useEffect } from 'react';
import { useDispatch, useStore } from 'react-redux';

import type { AppDispatch, RootState } from '../redux/store';
import { freshPendingAsk, releasePendingAsk } from '../redux/reviewAsk';
import { hasPageCover } from '../redux/pageCovers';

// KAN-653. How long the page must stay clear before the card shows. It bridges
// the gap between one cover closing and the next opening: setup closes, and
// the pin guide opens only once offerPinGuide's readToolbarPin has answered.
export const REVIEW_CARD_SETTLE_MS = 300;

// No page cover or modal dialog, no onboarding ending asked for or shown
// (KAN-879), no card on screen, and the person is looking at this page. A full-view restore opens focused windows over it, so focus is
// what says they came back.
export function isClearForReviewCard(state: RootState, doc: Document): boolean {
  const g = state.globalState;
  return (
    !hasPageCover(state) &&
    doc.querySelector('dialog:modal') === null &&
    g.endingCard === null &&
    g.reviewCard === null &&
    doc.hasFocus()
  );
}

// Nothing is checked until the open has decided its dialogs: a modal or the
// callout the queue is about to open would land on the card. From then on,
// `release` runs REVIEW_CARD_SETTLE_MS after each store change, focus, and
// return to the page; each check replaces the last. `release` must be stable.
export function useSettledRelease(
  areOpenDialogsDecided: boolean,
  release: () => void
): void {
  const store = useStore<RootState>();

  useEffect(() => {
    if (!areOpenDialogsDecided) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let isMounted = true;
    const check = () => {
      if (!isMounted) return;
      clearTimeout(timer);
      timer = setTimeout(release, REVIEW_CARD_SETTLE_MS);
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') check();
    };

    check();
    const unsubscribe = store.subscribe(check);
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      isMounted = false;
      clearTimeout(timer);
      unsubscribe();
      window.removeEventListener('focus', check);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [areOpenDialogsDecided, store, release]);
}

// Shows the stored pending ask once nothing covers the page.
export function useReviewAskRelease(areOpenDialogsDecided: boolean): void {
  const store = useStore<RootState>();
  const dispatch = useDispatch<AppDispatch>();
  const release = useCallback(() => {
    const pending = freshPendingAsk(Date.now());
    if (pending === null) return;
    if (!isClearForReviewCard(store.getState(), document)) return;
    dispatch(releasePendingAsk(pending));
  }, [store, dispatch]);
  useSettledRelease(areOpenDialogsDecided, release);
}
