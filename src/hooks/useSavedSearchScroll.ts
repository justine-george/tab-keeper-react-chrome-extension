import { useEffect, useLayoutEffect, useRef } from 'react';

import { searchScrollAfter } from '../components/home/opennow/searchScroll';
import { useSavedSearch } from './useSavedSearch';

const SAVED_LIST = '[data-panel="windows"]';

interface SearchPlace {
  term: string | null;
  // The list's place before the search began.
  before: number | null;
  // The session that place belongs to.
  sessionId: string | null;
}

// KAN-837 (as KAN-339 B): each new term puts the saved detail list at the top;
// clearing the search puts it back, unless the search moved to another session,
// whose list that place means nothing in. Lives above the list, so the place
// outlasts a term with no match, which unmounts it.
export function useSavedSearchScroll(shownId: string | null): void {
  const { term } = useSavedSearch();
  // The place from before this commit: a shorter list has already clamped the DOM's.
  const lastTop = useRef(0);
  const search = useRef<SearchPlace>({
    term,
    before: null,
    sessionId: shownId,
  });

  useEffect(() => {
    const track = (event: Event) => {
      const el = event.target;
      if (el instanceof HTMLElement && el.matches(SAVED_LIST)) {
        lastTop.current = el.scrollTop;
      }
    };
    document.addEventListener('scroll', track, true);
    return () => document.removeEventListener('scroll', track, true);
  }, []);

  useLayoutEffect(() => {
    const was = search.current;
    const { scrollTo, before } = searchScrollAfter(
      was.term,
      term,
      lastTop.current,
      was.before
    );
    const isStarting = was.term === null && term !== null;
    const isOtherSession = term === null && was.sessionId !== shownId;
    search.current = {
      term,
      before,
      sessionId: isStarting ? shownId : was.sessionId,
    };
    if (scrollTo === null || isOtherSession) return;
    const list = document.querySelector(SAVED_LIST);
    if (list !== null) list.scrollTop = scrollTo;
  }, [term, shownId]);
}
