import { useSelector } from 'react-redux';

import type { RootState } from '../redux/store';
import { selectIsSavedSessionFolded } from '../redux/savedSessionFold';
import { filterTabGroups } from '../utils/functions/local';
import { isTabView } from '../utils/functions/viewMode';
import { useSavedSearch } from './useSavedSearch';

export interface NoMatchPlace {
  // The trimmed query.
  query: string;
  // Where the no-match block draws: the detail pane when one is drawn, else the
  // list; null when something matches or nothing is typed.
  place: 'detail' | 'list' | null;
}

// Both panes read this, so exactly one of them draws the block.
export function useNoMatchPlace(): NoMatchPlace {
  const { text, term, isSearching } = useSavedSearch();
  const tabGroups = useSelector(
    (state: RootState) => state.tabContainerDataState.tabGroups
  );
  const hasTabGroupsPermission = useSelector(
    (state: RootState) => state.globalState.hasTabGroupsPermission
  );
  const folded = useSelector(selectIsSavedSessionFolded);

  const matchesNothing =
    isSearching &&
    term !== null &&
    filterTabGroups(term, tabGroups, hasTabGroupsPermission).length === 0;
  if (!matchesNothing) return { query: text.trim(), place: null };

  // Only the tab view folds its detail column away.
  const hasDetailPane = !(isTabView() && folded);
  return { query: text.trim(), place: hasDetailPane ? 'detail' : 'list' };
}
