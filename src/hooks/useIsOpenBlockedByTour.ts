import { useSelector } from 'react-redux';

import type { RootState } from '../redux/store';
import { selectRunHere } from '../redux/firstRun';

// True while this page's run points at this session: its opens wait for the run to end.
export function useIsOpenBlockedByTour(
  tabGroupId: string | undefined
): boolean {
  return useSelector(
    (state: RootState) =>
      tabGroupId !== undefined && selectRunHere(state)?.sessionId === tabGroupId
  );
}
