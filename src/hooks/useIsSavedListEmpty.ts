import { useSelector } from 'react-redux';

import type { RootState } from '../redux/store';
import { useSavedSearch } from './useSavedSearch';
import { useSessionListSettled } from './useSessionListSettled';

export interface SavedListInputs {
  sessionCount: number;
  isSearching: boolean;
  isSettled: boolean;
}

// An empty list, no search, and not before a first load: an existing user would see it for a frame.
export function isSavedListEmpty({
  sessionCount,
  isSearching,
  isSettled,
}: SavedListInputs): boolean {
  return sessionCount === 0 && !isSearching && isSettled;
}

export function useIsSavedListEmpty(): boolean {
  const sessionCount = useSelector(
    (state: RootState) => state.tabContainerDataState.tabGroups.length
  );
  const { isSearching } = useSavedSearch();
  const isSettled = useSessionListSettled();
  return isSavedListEmpty({ sessionCount, isSearching, isSettled });
}
