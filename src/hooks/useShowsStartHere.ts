import { useState } from 'react';
import { useSelector } from 'react-redux';

import type { RootState } from '../redux/store';
import { useSavedSearch } from './useSavedSearch';
import { storedSessionCount } from '../utils/functions/storedSessions';

export interface StartHereInputs {
  sessionCount: number;
  isSearching: boolean;
  holdsPlaceholder: boolean;
  storedAtMount: number;
}

// KAN-7 §2. An empty list, no search; and not while a first load of stored
// sessions is still to come, or an existing user would see it for a frame.
export function showsStartHere({
  sessionCount,
  isSearching,
  holdsPlaceholder,
  storedAtMount,
}: StartHereInputs): boolean {
  if (sessionCount > 0 || isSearching) return false;
  return !(holdsPlaceholder && storedAtMount > 0);
}

export function useShowsStartHere(): boolean {
  const sessionCount = useSelector(
    (state: RootState) => state.tabContainerDataState.tabGroups.length
  );
  const holdsPlaceholder = useSelector(
    (state: RootState) => state.globalState.holdsPlaceholderSessions
  );
  const { isSearching } = useSavedSearch();
  const [storedAtMount] = useState(storedSessionCount);
  return showsStartHere({
    sessionCount,
    isSearching,
    holdsPlaceholder,
    storedAtMount,
  });
}
