// Working in-memory fakes for the chrome APIs the app actually calls. A fake
// over a mock on purpose: tests assert on resulting state rather than on the
// fact that a function was invoked.
//
// Covers 15 members production code calls as of 2026-08-31 --
// tabs.query/create/update/get/onActivated, windows.getAll/getCurrent/
// create/remove, storage.sync.get/set, runtime.sendMessage/onMessage/getURL/
// lastError -- plus storage.sync.remove/clear, which have no production call
// site today but are implemented for API fidelity and exercised by this
// fake's own tests. Widen this when the app calls something new.

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

// A tab seeded without an explicit windowId belongs to this window. Kept at 1
// so a seed of `{ tabs: [...] }` alone behaves as it always has.
const DEFAULT_WINDOW_ID = 1;

export function setupChromeFake(seed: ChromeSeed = {}): ChromeFakeHandle {
  const storage = new Map<string, unknown>(Object.entries(seed.storage ?? {}));
  let nextId = 1000;

  // Chrome's model is that a window OWNS its tabs and getAll({populate:true})
  // is what reveals them. Holding a flat tab list beside windows that each
  // carry their own `tabs` array is two sources of truth, and they drifted: a
  // tab could exist while no window contained it. capture.ts:74 drops every
  // window whose tabs array is empty, so captureOpenWindows returned null for
  // anything this fake created -- silently, since a fake that models storage
  // shape rather than the query contract still answers every call.
  //
  // So `tabs` below is the single source of truth and windows derive their
  // contents from it by windowId. Seeded windows may still carry inline tabs;
  // those are folded into the flat list rather than stored on the window.
  const windows: chrome.windows.Window[] = [];
  const tabs: chrome.tabs.Tab[] = [];

  const makeTab = (
    tab: Partial<chrome.tabs.Tab>,
    windowId: number
  ): chrome.tabs.Tab =>
    ({
      id: nextId++,
      index: 0,
      url: '',
      title: '',
      active: false,
      windowId,
      ...tab,
    }) as chrome.tabs.Tab;

  for (const win of seed.windows ?? []) {
    const { tabs: inlineTabs, ...rest } = win;
    const created = {
      id: nextId++,
      focused: false,
      // Chrome never returns a window without a type, and getAll filters on
      // it, so a window that defaulted to undefined would be invisible to
      // every query. Explicit `type` in the seed still wins.
      type: 'normal',
      ...rest,
    } as chrome.windows.Window;
    windows.push(created);
    for (const tab of inlineTabs ?? []) {
      tabs.push(makeTab(tab, created.id as number));
    }
  }

  for (const tab of seed.tabs ?? []) {
    tabs.push(makeTab(tab, tab.windowId ?? DEFAULT_WINDOW_ID));
  }

  // Chrome omits `tabs` entirely unless populate was asked for, so the two
  // cases are deliberately different shapes rather than one with an empty
  // array -- a test that forgets populate should see what production sees.
  const populate = (win: chrome.windows.Window): chrome.windows.Window => ({
    ...win,
    tabs: tabs.filter((tab) => tab.windowId === win.id),
  });

  const handle: ChromeFakeHandle = {
    sentMessages: [],
    createdTabs: [],
    removedWindowIds: [],
    restore() {
      delete (globalThis as { chrome?: unknown }).chrome;
    },
  };

  // `get` accepts an array of keys or an object of defaults. Production code
  // only ever calls the array form (App.tsx:57, :66); the defaults form is
  // implemented for API fidelity and is exercised by this fake's own tests,
  // not by anything production calls today.
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
      // `active` and `windowId` are honoured. `currentWindow` and
      // `lastFocusedWindow` are deliberately NOT: production passes them
      // (UserInputContainer.tsx:28, TabGroupDetailsContainer.tsx:56) but
      // honouring them would require every seed to place its tabs in a real
      // window, which today's seeds do not. Treating them as "any window"
      // keeps single-window tests honest; a multi-window test that depends on
      // the distinction must not use this fake until that is fixed.
      query: (
        queryInfo: chrome.tabs.QueryInfo,
        cb?: (result: chrome.tabs.Tab[]) => void
      ) => {
        const matched = tabs.filter(
          (tab) =>
            (queryInfo.active === undefined ||
              tab.active === queryInfo.active) &&
            (queryInfo.windowId === undefined ||
              tab.windowId === queryInfo.windowId)
        );
        return settle(matched, cb);
      },
      create: (
        props: chrome.tabs.CreateProperties,
        cb?: (tab: chrome.tabs.Tab) => void
      ) => {
        handle.createdTabs.push(props);
        const created = makeTab(
          {
            index: tabs.length,
            url: props.url ?? '',
            active: props.active ?? true,
          },
          props.windowId ?? DEFAULT_WINDOW_ID
        );
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
      // `windowTypes` is part of the query contract, not decoration: capture
      // passes ['normal'] to keep popup windows out of a saved session
      // (KAN-50), and background.ts passes it to pick what focus mode closes.
      // A fake that ignored it would hand those callers popups anyway and
      // report the bug fixed while it was not. Chrome's documented default
      // when the caller omits it is ['normal', 'popup'].
      getAll: (
        info: chrome.windows.QueryOptions,
        cb?: (result: chrome.windows.Window[]) => void
      ) => {
        // `${WindowType}` and not WindowType: the enum's string form is what
        // the API surface actually uses, and what a caller can pass literally.
        const wanted: `${chrome.windows.WindowType}`[] = info?.windowTypes ?? [
          'normal',
          'popup',
        ];
        return settle(
          windows
            .filter(
              (win) => win.type !== undefined && wanted.includes(win.type)
            )
            .map((win) => (info?.populate ? populate(win) : { ...win })),
          cb
        );
      },
      getCurrent: (
        info: chrome.windows.QueryOptions,
        cb?: (result: chrome.windows.Window) => void
      ) => {
        const current = windows[0];
        if (!current) return settle(current, cb);
        return settle(info?.populate ? populate(current) : { ...current }, cb);
      },
      // A `url` opens as the window's first tab, matching Chrome. The restore
      // path depends on exactly this: windows.ts:67 creates the window with
      // tabs[0].url and then tabs.create()s the rest against its windowId, so
      // a fake that dropped the initial tab would make a restored window come
      // back one tab short.
      create: (
        data: chrome.windows.CreateData,
        cb?: (win?: chrome.windows.Window) => void
      ) => {
        const created = {
          id: nextId++,
          focused: data.focused ?? false,
          type: data.type ?? 'normal',
        } as unknown as chrome.windows.Window;
        windows.push(created);
        for (const url of typeof data.url === 'string'
          ? [data.url]
          : data.url ?? []) {
          tabs.push(makeTab({ url, active: true }, created.id as number));
        }
        return settle(populate(created), cb);
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
