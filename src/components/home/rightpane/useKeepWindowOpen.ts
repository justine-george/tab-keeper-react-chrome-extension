// KAN-379 Q3 A. A window a drag opened, kept open in the stored fold.
import { useCallback } from 'react';
import { useDispatch } from 'react-redux';

import type { AppDispatch } from '../../../redux/store';
import { expandWindow } from '../../../redux/slices/globalStateSlice';

export function useKeepWindowOpen(
  tabGroupId: string
): (windowId: string) => void {
  const dispatch: AppDispatch = useDispatch();
  return useCallback(
    (windowId: string) => {
      dispatch(expandWindow({ tabGroupId, windowId }));
    },
    [dispatch, tabGroupId]
  );
}
