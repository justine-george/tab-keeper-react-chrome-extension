import { useEffect, useMemo, useState } from 'react';
import { useSelector } from 'react-redux';

import type { RootState } from '../redux/store';
import {
  RECENTLY_DELETED_KEY,
  emptyDeleted,
  readDeleted,
  shownDeleted,
  type DeletedSession,
} from '../utils/functions/recentlyDeleted';

// KAN-595. The deleted sessions to show: stored ones, minus any live again.
// Re-read on every change to the stored list, so a delete in another page shows here.
// `now` is when the list was read: render stays pure, and the countdown is that read's.
export function useRecentlyDeleted(): {
  shown: DeletedSession[];
  now: number;
  empty: () => Promise<void>;
} {
  const [read, setRead] = useState<{ list: DeletedSession[]; at: number }>({
    list: [],
    at: 0,
  });
  const tabGroups = useSelector(
    (state: RootState) => state.tabContainerDataState.tabGroups
  );

  useEffect(() => {
    let mounted = true;
    const load = () =>
      void readDeleted().then((list) => {
        if (mounted) setRead({ list, at: Date.now() });
      });
    const onChanged = (
      changes: Record<string, chrome.storage.StorageChange>
    ) => {
      if (RECENTLY_DELETED_KEY in changes) load();
    };
    load();
    chrome.storage.local.onChanged.addListener(onChanged);
    return () => {
      mounted = false;
      chrome.storage.local.onChanged.removeListener(onChanged);
    };
  }, []);

  const shown = useMemo(
    () =>
      shownDeleted(
        read.list,
        new Set(tabGroups.map((g) => g.tabGroupId)),
        read.at
      ),
    [read, tabGroups]
  );

  return { shown, now: read.at, empty: emptyDeleted };
}
