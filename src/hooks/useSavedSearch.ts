import { useSelector } from 'react-redux';

import type { RootState } from '../redux/store';
import { searchTermOf } from '../utils/functions/openNowSearch';
import { isSearchActive } from '../utils/functions/local';

export interface SavedSearch {
  // Exactly what the field shows.
  text: string;
  // searchTermOf(text): trimmed and lower-cased, null when there is none.
  term: string | null;
  // isSearchActive(text). Every saved-side gate (hide, drag, carry) reads this.
  isSearching: boolean;
}

// The saved search's one copy of the query: Redux, never stored or synced.
export function useSavedSearch(): SavedSearch {
  const text = useSelector(
    (state: RootState) => state.globalState.searchInputText
  );
  return {
    text,
    term: searchTermOf(text),
    isSearching: isSearchActive(text),
  };
}
