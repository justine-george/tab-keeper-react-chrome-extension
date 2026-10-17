import { useEffect } from 'react';
import { useDispatch, useStore } from 'react-redux';

import type { AppDispatch, RootState } from '../redux/store';
import { freshPendingAsk, showReviewCard } from '../redux/reviewAsk';
import { whenQuietCardSettles } from '../redux/quietCards';

// KAN-653. How long the page must stay clear before the card shows. It bridges
// the gap between one cover closing and the next opening: setup closes, and
// the pin guide opens only once offerPinGuide's readToolbarPin has answered.
export const REVIEW_CARD_SETTLE_MS = 300;

// Nothing covers the page: no run here, no note, setup, pin guide,
// full-view callout, modal dialog or card on screen, and the person is looking at this page. A
// full-view restore opens focused windows over it, so focus is what says they
// came back.
export function isClearForReviewCard(state: RootState, doc: Document): boolean {
  const g = state.globalState;
  return (
    !g.isRunHere &&
    !g.isReplayNoteOpen &&
    !g.isSetupOpen &&
    !g.isPinGuideOpen &&
    !g.isFullViewCalloutOpen &&
    g.reviewCard === null &&
    doc.querySelector('dialog:modal') === null &&
    doc.hasFocus()
  );
}

// Shows the stored pending ask once nothing covers the page. Checked on mount,
// on every store change, and when the page gets focus or becomes visible
// again; each check replaces the last and runs REVIEW_CARD_SETTLE_MS later.
export function useReviewAskRelease(): void {
  const store = useStore<RootState>();
  const dispatch = useDispatch<AppDispatch>();

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let isMounted = true;
    const release = () => {
      const pending = freshPendingAsk(Date.now());
      if (pending === null) return;
      // A quiet card (the full-view callout) still deciding: check again once
      // it has shown, and so covers the page, or been skipped.
      const quietCard = whenQuietCardSettles();
      if (quietCard !== null) {
        void quietCard.then(check);
        return;
      }
      if (!isClearForReviewCard(store.getState(), document)) return;
      dispatch(showReviewCard(pending.moment));
    };
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
  }, [store, dispatch]);
}
