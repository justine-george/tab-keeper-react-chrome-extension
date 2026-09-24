import { useEffect } from 'react';
import { useDispatch, useStore } from 'react-redux';

import type { AppDispatch, RootState } from '../redux/store';
import { syncStateWithFirestore } from '../redux/slices/globalStateSlice';
import { timedCloudReadAllowed } from '../redux/slices/settingsDataStateSlice';
import { isTabView } from '../utils/functions/viewMode';
import { startCloudReads } from '../utils/functions/cloudReadScheduler';

/**
 * KAN-279 D11. The popup reads the cloud once, on open, and then dies. The
 * tab view is long-lived and would otherwise never see another device's
 * changes, so it re-reads when it becomes visible again (with a minimum gap)
 * and periodically while it stays visible -- never while hidden.
 *
 * Only runs in the tab view: `isTabView()` gates the whole effect, so the
 * popup (which mounts the same App) never starts this scheduler.
 *
 * Reads go through the existing sync thunk -- `syncStateWithFirestore()` --
 * rather than a raw Firestore read, so an in-flight sync is handled by the
 * KAN-269 queue exactly as any other sync starter is.
 *
 * `canRead` is `timedCloudReadAllowed`, NOT `cloudSyncAllowed`/the
 * drainQueuedSync gate: see that function's own comment for why a timed read
 * needs the stricter, App-startup gate.
 */
export function useTabCloudReads(): void {
  const dispatch: AppDispatch = useDispatch();
  const reduxStore = useStore<RootState>();

  useEffect(() => {
    if (!isTabView()) return;
    return startCloudReads(
      document,
      () => {
        dispatch(syncStateWithFirestore());
      },
      () => timedCloudReadAllowed(reduxStore.getState())
    );
  }, [dispatch, reduxStore]);
}
