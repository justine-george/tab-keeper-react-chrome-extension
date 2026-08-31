// Working in-memory fakes for the chrome APIs the app actually calls. A fake
// over a mock on purpose: tests assert on resulting state rather than on the
// fact that a function was invoked.
//
// Covers the 17 members in use as of 2026-08-31 -- tabs.query/create/update/
// get/onActivated, windows.getAll/getCurrent/create/remove,
// storage.sync.get/set/remove/clear, runtime.sendMessage/onMessage/getURL/
// lastError. Widen this when the app calls something new.

export type ChromeSeed = {
  tabs?: Partial<chrome.tabs.Tab>[];
  windows?: Partial<chrome.windows.Window>[];
  storage?: Record<string, unknown>;
};

export type ChromeFakeHandle = {
  sentMessages: unknown[];
  createdTabs: chrome.tabs.CreateProperties[];
  removedWindowIds: number[];
  restore(): void;
};

// Callers pass either a callback or use the returned promise. Supporting both
// is not optional: App.tsx uses the promise form, capture.ts the callback one.
function settle<T>(value: T, callback?: (value: T) => void): Promise<T> {
  if (callback) callback(value);
  return Promise.resolve(value);
}

export function setupChromeFake(seed: ChromeSeed = {}): ChromeFakeHandle {
  const storage = new Map<string, unknown>(Object.entries(seed.storage ?? {}));
  let nextId = 1000;
  const tabs: chrome.tabs.Tab[] = (seed.tabs ?? []).map(
    (tab) =>
      ({
        id: nextId++,
        index: 0,
        url: '',
        title: '',
        active: false,
        windowId: 1,
        ...tab,
      }) as chrome.tabs.Tab
  );
  const windows: chrome.windows.Window[] = (seed.windows ?? []).map(
    (win) =>
      ({
        id: nextId++,
        focused: false,
        tabs: [],
        ...win,
      }) as chrome.windows.Window
  );

  const handle: ChromeFakeHandle = {
    sentMessages: [],
    createdTabs: [],
    removedWindowIds: [],
    restore() {
      delete (globalThis as { chrome?: unknown }).chrome;
    },
  };

  // `get` accepts an array of keys or an object of defaults. App.tsx relies on
  // the defaults form, so both are implemented rather than only the easy one.
  const readStorage = (
    keys?: string[] | Record<string, unknown> | null
  ): Record<string, unknown> => {
    if (keys == null) return Object.fromEntries(storage);
    if (Array.isArray(keys)) {
      const result: Record<string, unknown> = {};
      for (const key of keys) {
        if (storage.has(key)) result[key] = storage.get(key);
      }
      return result;
    }
    const result: Record<string, unknown> = {};
    for (const [key, fallback] of Object.entries(keys)) {
      result[key] = storage.has(key) ? storage.get(key) : fallback;
    }
    return result;
  };

  const chromeFake = {
    storage: {
      sync: {
        get: (
          keys?: string[] | Record<string, unknown> | null,
          cb?: (items: Record<string, unknown>) => void
        ) => settle(readStorage(keys), cb),
        set: (items: Record<string, unknown>, cb?: () => void) => {
          for (const [key, value] of Object.entries(items)) {
            storage.set(key, value);
          }
          return settle(undefined as void, cb);
        },
        remove: (keys: string | string[], cb?: () => void) => {
          for (const key of Array.isArray(keys) ? keys : [keys]) {
            storage.delete(key);
          }
          return settle(undefined as void, cb);
        },
        clear: (cb?: () => void) => {
          storage.clear();
          return settle(undefined as void, cb);
        },
      },
    },

    tabs: {
      query: (
        queryInfo: chrome.tabs.QueryInfo,
        cb?: (result: chrome.tabs.Tab[]) => void
      ) => {
        const matched = tabs.filter((tab) =>
          queryInfo.active === undefined
            ? true
            : tab.active === queryInfo.active
        );
        return settle(matched, cb);
      },
      create: (
        props: chrome.tabs.CreateProperties,
        cb?: (tab: chrome.tabs.Tab) => void
      ) => {
        handle.createdTabs.push(props);
        const created = {
          id: nextId++,
          index: tabs.length,
          url: props.url ?? '',
          title: '',
          active: props.active ?? true,
          windowId: props.windowId ?? 1,
        } as chrome.tabs.Tab;
        tabs.push(created);
        return settle(created, cb);
      },
      update: (
        tabId: number,
        props: chrome.tabs.UpdateProperties,
        cb?: (tab?: chrome.tabs.Tab) => void
      ) => {
        const target = tabs.find((tab) => tab.id === tabId);
        if (target) Object.assign(target, props);
        return settle(target, cb);
      },
      get: (tabId: number, cb?: (tab: chrome.tabs.Tab) => void) =>
        settle(tabs.find((tab) => tab.id === tabId) as chrome.tabs.Tab, cb),
      onActivated: {
        addListener: () => undefined,
        removeListener: () => undefined,
      },
    },

    windows: {
      getAll: (
        _info: chrome.windows.QueryOptions,
        cb?: (result: chrome.windows.Window[]) => void
      ) => settle(windows, cb),
      getCurrent: (
        _info: chrome.windows.QueryOptions,
        cb?: (result: chrome.windows.Window) => void
      ) => settle(windows[0], cb),
      create: (
        data: chrome.windows.CreateData,
        cb?: (win?: chrome.windows.Window) => void
      ) => {
        const created = {
          id: nextId++,
          focused: data.focused ?? false,
          tabs: [],
        } as unknown as chrome.windows.Window;
        windows.push(created);
        return settle(created, cb);
      },
      remove: (windowId: number, cb?: () => void) => {
        handle.removedWindowIds.push(windowId);
        const index = windows.findIndex((win) => win.id === windowId);
        if (index >= 0) windows.splice(index, 1);
        return settle(undefined as void, cb);
      },
    },

    runtime: {
      sendMessage: (message: unknown, cb?: (response: unknown) => void) => {
        handle.sentMessages.push(message);
        return settle(undefined, cb);
      },
      onMessage: {
        addListener: () => undefined,
        removeListener: () => undefined,
      },
      getURL: (path: string) => `chrome-extension://faketestid/${path}`,
      lastError: undefined as chrome.runtime.LastError | undefined,
    },
  };

  (globalThis as { chrome?: unknown }).chrome = chromeFake;
  return handle;
}
