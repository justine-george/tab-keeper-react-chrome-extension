import { useSelector } from 'react-redux';

import type { RootState } from '../redux/store';
import { selectTourHere } from '../redux/sampleTour';

// KAN-413. True while this page's tour runs on this session: its opens wait for the tour to end.
export function useIsOpenBlockedByTour(
  tabGroupId: string | undefined
): boolean {
  return useSelector(
    (state: RootState) =>
      tabGroupId !== undefined && selectTourHere(state)?.sampleId === tabGroupId
  );
}
