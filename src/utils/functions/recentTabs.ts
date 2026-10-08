// KAN-458 A4. Each window's recently activated tabs, newest first, recorded by the worker.
// Worker-safe: chrome types only. In chrome.storage.session so it outlives a worker's sleep.

// Small: the newest entry is often the Tab Keeper page itself, so a few more than one.
export const RECENT_TABS_CAP = 5;

export const recentTabsKey = (windowId: number): string =>
  `recentTabs.${windowId}`;

const isTabIdList = (value: unknown): value is number[] =>
  Array.isArray(value) && value.every((id) => typeof id === 'number');

export function withActivated(
  list: readonly number[],
  tabId: number
): number[] {
  return [tabId, ...list.filter((id) => id !== tabId)].slice(
    0,
    RECENT_TABS_CAP
  );
}

export interface SessionArea {
  get(keys: string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string[]): Promise<void>;
}

export interface RecentTabsRecorder {
  activated(info: { tabId: number; windowId: number }): Promise<void>;
  tabRemoved(tabId: number, info: { windowId: number }): Promise<void>;
  replaced(
    windowId: number,
    addedTabId: number,
    removedTabId: number
  ): Promise<void>;
  windowRemoved(windowId: number): Promise<void>;
}

// One write at a time: two quick activations would otherwise both read the old list and one would be lost.
export function recentTabsRecorder(area: SessionArea): RecentTabsRecorder {
  let queue: Promise<void> = Promise.resolve();
  const enqueue = (work: () => Promise<void>): Promise<void> => {
    queue = queue.then(work).catch((error: unknown) => {
      console.warn('Could not record the active tab:', error);
    });
    return queue;
  };
  const read = async (windowId: number): Promise<number[]> => {
    const key = recentTabsKey(windowId);
    const value = (await area.get([key]))[key];
    return isTabIdList(value) ? value : [];
  };

  return {
    activated: ({ tabId, windowId }) =>
      enqueue(async () => {
        await area.set({
          [recentTabsKey(windowId)]: withActivated(await read(windowId), tabId),
        });
      }),
    tabRemoved: (tabId, { windowId }) =>
      enqueue(async () => {
        const list = await read(windowId);
        if (!list.includes(tabId)) return;
        await area.set({
          [recentTabsKey(windowId)]: list.filter((id) => id !== tabId),
        });
      }),
    // Chrome swaps a tab's id (prerender); the old id would never match again and Save would pick an older tab.
    replaced: (windowId, addedTabId, removedTabId) =>
      enqueue(async () => {
        const list = await read(windowId);
        if (!list.includes(removedTabId)) return;
        await area.set({
          [recentTabsKey(windowId)]: list.map((id) =>
            id === removedTabId ? addedTabId : id
          ),
        });
      }),
    windowRemoved: (windowId) =>
      enqueue(() => area.remove([recentTabsKey(windowId)])),
  };
}

// The worker's listeners, registered at its top level so an activation wakes it.
export function recordRecentTabs(): void {
  const recorder = recentTabsRecorder({
    get: (keys) => chrome.storage.session.get(keys),
    set: (items) => chrome.storage.session.set(items),
    remove: (keys) => chrome.storage.session.remove(keys),
  });
  chrome.tabs.onActivated.addListener((info) => void recorder.activated(info));
  chrome.tabs.onRemoved.addListener(
    (tabId, info) => void recorder.tabRemoved(tabId, info)
  );
  chrome.tabs.onReplaced.addListener((addedTabId, removedTabId) => {
    chrome.tabs
      .get(addedTabId)
      .then((tab) => recorder.replaced(tab.windowId, addedTabId, removedTabId))
      .catch(() => {});
  });
  chrome.windows.onRemoved.addListener(
    (windowId) => void recorder.windowRemoved(windowId)
  );
}

// A window's list, empty when it has none or the read failed (capture then falls back).
export type RecentTabsOf = (windowId: number | undefined) => readonly number[];

export async function readRecentTabs(
  windowIds: readonly number[]
): Promise<RecentTabsOf> {
  const recent = new Map<number, number[]>();
  const of: RecentTabsOf = (windowId) =>
    (windowId === undefined ? undefined : recent.get(windowId)) ?? [];
  if (windowIds.length === 0) return of;
  let items: Record<string, unknown>;
  try {
    items = await chrome.storage.session.get(windowIds.map(recentTabsKey));
  } catch (error) {
    console.warn('Could not read the recent tabs:', error);
    return of;
  }
  for (const windowId of windowIds) {
    const value = items[recentTabsKey(windowId)];
    if (isTabIdList(value)) recent.set(windowId, value);
  }
  return of;
}
