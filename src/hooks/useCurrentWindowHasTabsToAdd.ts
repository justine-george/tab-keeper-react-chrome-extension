import { useEffect, useState } from 'react';

import { addableTabs } from '../utils/functions/capture';

// KAN-886. A burst of tab events (a page load, a drag) shares one read.
export const ADDABLE_REFRESH_COALESCE_MS = 50;

/**
 * KAN-886. Whether the current window holds a tab Add current window would
 * add (`addableTabs`), kept live: read on mount, then again after any tab
 * event that can change the answer, or when the page is shown or focused.
 *
 * Offered (`true`) until the first read settles, so the common case never
 * flashes dim. A failed read keeps the last answer; an older read settling
 * after a newer one is dropped.
 */
export function useCurrentWindowHasTabsToAdd(): boolean {
  const [hasTabsToAdd, setHasTabsToAdd] = useState(true);

  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let readSeq = 0;
    let appliedSeq = 0;

    const read = async (): Promise<void> => {
      const mine = ++readSeq;
      try {
        const current = await chrome.windows.getCurrent({ populate: true });
        if (!live || mine <= appliedSeq) return;
        appliedSeq = mine;
        setHasTabsToAdd(addableTabs(current).length > 0);
      } catch {
        // Keeps the last answer; the next event reads again.
      }
    };

    const schedule = (): void => {
      if (timer !== null) return;
      timer = setTimeout(() => {
        timer = null;
        void read();
      }, ADDABLE_REFRESH_COALESCE_MS);
    };

    const onUpdated = (
      _tabId: number,
      changeInfo: chrome.tabs.OnUpdatedInfo
    ): void => {
      // Only an address change can turn a tab into, or out of, a Tab Keeper page.
      if (changeInfo.url !== undefined) schedule();
    };
    const onShown = (): void => {
      if (document.visibilityState !== 'hidden') schedule();
    };

    const events = [
      chrome.tabs.onCreated,
      chrome.tabs.onRemoved,
      chrome.tabs.onAttached,
      chrome.tabs.onDetached,
      chrome.tabs.onReplaced,
    ];
    // Held, so teardown removes from the same objects it added to.
    const updated = chrome.tabs.onUpdated;
    for (const event of events) event.addListener(schedule);
    updated.addListener(onUpdated);
    document.addEventListener('visibilitychange', onShown);
    window.addEventListener('focus', onShown);
    void read();

    return () => {
      live = false;
      if (timer !== null) clearTimeout(timer);
      for (const event of events) event.removeListener(schedule);
      updated.removeListener(onUpdated);
      document.removeEventListener('visibilitychange', onShown);
      window.removeEventListener('focus', onShown);
    };
  }, []);

  return hasTabsToAdd;
}
