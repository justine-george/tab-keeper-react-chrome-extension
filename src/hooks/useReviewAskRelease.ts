import { useEffect } from 'react';
import { useDispatch, useStore } from 'react-redux';

import type { AppDispatch, RootState } from '../redux/store';
import { freshPendingAsk, releasePendingAsk } from '../redux/reviewAsk';

// KAN-653. How long the page must stay clear before the card shows. It bridges
// the gap between one cover closing and the next opening: setup closes, and
// the pin guide opens only once offerPinGuide's readToolbarPin has answered.
export const REVIEW_CARD_SETTLE_MS = 300;

// Nothing covers the page: no run here, no note, setup, pin guide,
// full-view callout, first-save pop (KAN-875), modal dialog or card on screen, and the person is looking at this page. A
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
    !g.isFirstSavePopping &&
    g.reviewCard === null &&
    doc.querySelector('dialog:modal') === null &&
    doc.hasFocus()
  );
}

// Shows the stored pending ask once nothing covers the page. Nothing is
// checked until the open has decided its dialogs: a modal or the callout the
// queue is about to open would land on the card. From then on, checked at
// once, on every store change, and when the page gets focus or becomes
// visible again; each check replaces the last and runs REVIEW_CARD_SETTLE_MS
// later.
export function useReviewAskRelease(areOpenDialogsDecided: boolean): void {
  const store = useStore<RootState>();
  const dispatch = useDispatch<AppDispatch>();

  useEffect(() => {
    if (!areOpenDialogsDecided) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let isMounted = true;
    const release = () => {
      const pending = freshPendingAsk(Date.now());
      if (pending === null) return;
      if (!isClearForReviewCard(store.getState(), document)) return;
      dispatch(releasePendingAsk(pending));
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
  }, [areOpenDialogsDecided, store, dispatch]);
}
