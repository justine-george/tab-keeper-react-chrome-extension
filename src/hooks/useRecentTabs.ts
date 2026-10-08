import { useEffect, useState } from 'react';

import { readRecentTabs, recentTabsKey } from '../utils/functions/recentTabs';

const NONE: readonly number[] = [];

/**
 * KAN-475. One window's recently activated tabs, newest first, as the worker
 * records them (KAN-458), kept live: read on mount and again whenever the
 * worker writes that window's entry. Empty for no window, before the first
 * read, and when there is no record.
 */
export function useRecentTabs(windowId: number | null): readonly number[] {
  const [recent, setRecent] = useState<readonly number[]>(NONE);

  useEffect(() => {
    setRecent(NONE);
    if (windowId === null) return;
    let live = true;
    const key = recentTabsKey(windowId);
    const read = () =>
      void readRecentTabs([windowId]).then((of) => {
        if (live) setRecent(of(windowId));
      });
    const onChanged = (
      changes: Record<string, chrome.storage.StorageChange>
    ) => {
      if (key in changes) read();
    };
    chrome.storage.session.onChanged.addListener(onChanged);
    read();
    return () => {
      live = false;
      chrome.storage.session.onChanged.removeListener(onChanged);
    };
  }, [windowId]);

  return recent;
}
