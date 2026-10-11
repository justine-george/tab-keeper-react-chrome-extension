import { useEffect, useState } from 'react';

import { planBack, type BackPlan } from '../utils/functions/backFromFullView';
import { fullViewOriginKey, originIn } from '../utils/functions/fullViewOrigin';
import { asTabIdList, recentTabsKey } from '../utils/functions/recentTabs';

// Tab events in a burst share one re-read.
const COALESCE_MS = 50;

interface ChromeEvent {
  addListener(cb: () => void): void;
  removeListener(cb: () => void): void;
}

/**
 * KAN-509. What Back in this full view would do, kept live from the same
 * facts the worker reads (planBack is shared). `null` until the first read,
 * and while `enabled` is false (nothing is read or listened to then).
 */
export function useBackPlan(enabled: boolean): BackPlan | null {
  const [plan, setPlan] = useState<BackPlan | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let readSeq = 0;
    // The two records the last read used; a change to either reads again.
    let watched: string[] = [];

    const read = async (): Promise<void> => {
      const mine = ++readSeq;
      try {
        const self = await chrome.tabs.getCurrent();
        if (self?.id === undefined) return;
        const keys = [
          fullViewOriginKey(self.windowId),
          recentTabsKey(self.windowId),
        ];
        watched = keys;
        const [windows, stored] = await Promise.all([
          chrome.windows.getAll({ populate: true, windowTypes: ['normal'] }),
          chrome.storage.session.get(keys),
        ]);
        if (!live || mine !== readSeq) return;
        const ids = (tabs: chrome.tabs.Tab[] | undefined) =>
          (tabs ?? []).flatMap((tab) => (tab.id === undefined ? [] : [tab.id]));
        setPlan(
          planBack({
            fullView: {
              tabId: self.id,
              windowId: self.windowId,
              pinned: self.pinned,
            },
            origin: originIn(stored[keys[0]], self.id),
            recent: asTabIdList(stored[keys[1]]),
            windowTabIds: ids(
              windows.find((win) => win.id === self.windowId)?.tabs
            ),
            openTabIds: windows.flatMap((win) => ids(win.tabs)),
          })
        );
      } catch (error) {
        console.warn('Could not read where Back would go:', error);
      }
    };

    const schedule = (): void => {
      if (timer !== null) return;
      timer = setTimeout(() => {
        timer = null;
        void read();
      }, COALESCE_MS);
    };
    const onStorage = (
      changes: Record<string, chrome.storage.StorageChange>
    ) => {
      if (watched.some((key) => key in changes)) schedule();
    };

    const events: ChromeEvent[] = [
      chrome.tabs.onCreated,
      chrome.tabs.onRemoved,
      chrome.tabs.onUpdated,
      chrome.tabs.onAttached,
      chrome.tabs.onDetached,
      chrome.windows.onRemoved,
    ];
    for (const event of events) event.addListener(schedule);
    chrome.storage.session.onChanged.addListener(onStorage);
    void read();
    return () => {
      live = false;
      if (timer !== null) clearTimeout(timer);
      for (const event of events) event.removeListener(schedule);
      chrome.storage.session.onChanged.removeListener(onStorage);
    };
  }, [enabled]);

  return enabled ? plan : null;
}
