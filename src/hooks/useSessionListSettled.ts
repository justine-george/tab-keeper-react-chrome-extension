import { useState } from 'react';
import { useSelector } from 'react-redux';

import type { RootState } from '../redux/store';
import { isSessionListSettled } from '../utils/functions/firstRun';
import { storedSessionCount } from '../utils/functions/storedSessions';

// The saved list is loaded, or there was nothing on disk to load.
export function useSessionListSettled(): boolean {
  const holdsPlaceholder = useSelector(
    (state: RootState) => state.globalState.holdsPlaceholderSessions
  );
  const [storedAtMount] = useState(storedSessionCount);
  return isSessionListSettled(holdsPlaceholder, storedAtMount);
}
