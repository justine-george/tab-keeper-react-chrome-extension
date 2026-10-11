// KAN-507. The tab ⤢ was pressed on, so Open compact view can go back to it.
// Kept for one visit: any other tab becoming active in the full view's window drops it.
// Worker-safe: chrome types only. In chrome.storage.session, like recentTabs.ts.
import type { SessionArea } from './recentTabs';

// One record per window: the full view shown there, and the tab it was opened from.
export const fullViewOriginKey = (windowId: number): string =>
  `fullViewOrigin.${windowId}`;

interface OriginRecord {
  fullViewTabId: number;
  originTabId: number;
}

const isOriginRecord = (value: unknown): value is OriginRecord =>
  typeof value === 'object' &&
  value !== null &&
  'fullViewTabId' in value &&
  typeof value.fullViewTabId === 'number' &&
  'originTabId' in value &&
  typeof value.originTabId === 'number';

// A stored record's origin, if it names this full view.
export const originIn = (
  value: unknown,
  fullViewTabId: number
): number | undefined =>
  isOriginRecord(value) && value.fullViewTabId === fullViewTabId
    ? value.originTabId
    : undefined;

// KAN-507/509. Where going back lands: the origin if still open, else the newest open tab in the window's record.
export function tabToReturnTo(
  origin: number | undefined,
  recent: readonly number[],
  openTabIds: readonly number[]
): number | undefined {
  if (origin !== undefined && openTabIds.includes(origin)) return origin;
  return recent.find((id) => openTabIds.includes(id));
}

export interface FullViewTabRef {
  tabId: number;
  windowId: number;
}

export interface FullViewOrigins {
  remember(fullView: FullViewTabRef, originTabId: number): Promise<void>;
  // undefined when no record names this full view.
  originOf(fullView: FullViewTabRef): Promise<number | undefined>;
  activated(info: { tabId: number; windowId: number }): Promise<void>;
  windowRemoved(windowId: number): Promise<void>;
}

// Writes run one at a time, in the order asked, so a remember after an activation is not undone by it.
export function fullViewOrigins(area: SessionArea): FullViewOrigins {
  let queue: Promise<void> = Promise.resolve();
  const enqueue = (work: () => Promise<void>): Promise<void> => {
    queue = queue.then(work).catch((error: unknown) => {
      console.warn(
        'Could not record where the full view was opened from:',
        error
      );
    });
    return queue;
  };
  const read = async (windowId: number): Promise<OriginRecord | undefined> => {
    const key = fullViewOriginKey(windowId);
    const value = (await area.get([key]))[key];
    return isOriginRecord(value) ? value : undefined;
  };

  return {
    remember: ({ tabId, windowId }, originTabId) =>
      enqueue(() =>
        area.set({
          [fullViewOriginKey(windowId)]: {
            fullViewTabId: tabId,
            originTabId,
          } satisfies OriginRecord,
        })
      ),
    originOf: async ({ tabId, windowId }) => {
      await queue;
      return originIn(
        (await area.get([fullViewOriginKey(windowId)]))[
          fullViewOriginKey(windowId)
        ],
        tabId
      );
    },
    activated: ({ tabId, windowId }) =>
      enqueue(async () => {
        const record = await read(windowId);
        if (record && record.fullViewTabId !== tabId) {
          await area.remove([fullViewOriginKey(windowId)]);
        }
      }),
    windowRemoved: (windowId) =>
      enqueue(() => area.remove([fullViewOriginKey(windowId)])),
  };
}

// The worker's store and listeners, registered at its top level so an activation wakes it.
export const chromeFullViewOrigins = fullViewOrigins({
  get: (keys) => chrome.storage.session.get(keys),
  set: (items) => chrome.storage.session.set(items),
  remove: (keys) => chrome.storage.session.remove(keys),
});

export function recordFullViewOrigins(): void {
  chrome.tabs.onActivated.addListener(
    (info) => void chromeFullViewOrigins.activated(info)
  );
  chrome.windows.onRemoved.addListener(
    (windowId) => void chromeFullViewOrigins.windowRemoved(windowId)
  );
}
