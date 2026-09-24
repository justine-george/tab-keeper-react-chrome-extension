// Working in-memory fakes for the chrome APIs the app actually calls. A fake
// over a mock on purpose: tests assert on resulting state rather than on the
// fact that a function was invoked.
//
// Covers 25 members production code calls as of 2026-09-17 --
// tabs.query/create/update/get/getCurrent/onActivated/group,
// windows.getAll/getCurrent/
// create/remove, storage.sync.get/set, runtime.sendMessage/onMessage/getURL/
// lastError, tabGroups.query/update/TAB_GROUP_ID_NONE, permissions.contains/
// request/remove/onAdded/onRemoved -- plus storage.sync.remove/clear and
// permissions.getAll, which have no production call site today but are
// implemented for API fidelity and exercised by this fake's own tests.
// Widen this when the app calls something new.
//
// KAN-280 (Open now pane) adds live event registries with no production
// caller yet -- tabs.onCreated/onRemoved/onUpdated/onMoved/onAttached/
// onDetached, windows.onCreated/onRemoved/update, tabGroups.onCreated/
// onUpdated/onRemoved/onMoved -- plus ChromeFakeHandle.browser, which models
// the BROWSER's own hand (open/close/update/move a tab, close a window, set
// a group) by mutating state and firing the matching event, and
// listenerCount()/windowsGetAllCalls for proving an unmount detached
// everything and a refresh coalesced its reads.

export type ChromeSeed = {
  tabs?: Partial<chrome.tabs.Tab>[];
  // The tab the calling page IS, for tabs.getCurrent(): the id of a seeded
  // tab. Absent means the code is not running in a tab -- the popup, the
  // worker -- which Chrome reports as undefined.
  currentTabId?: number;
  // An inline tab is Partial<Tab> like the top-level `tabs` above, not the
  // full chrome.tabs.Tab that Partial<Window>'s own `tabs` field carries --
  // without this override, a seed literal naming just `{ url }` needs a cast
  // to satisfy chrome.windows.Window['tabs'], which every new call site here
  // is written not to need.
  windows?: (Omit<Partial<chrome.windows.Window>, 'tabs'> & {
    tabs?: Partial<chrome.tabs.Tab>[];
  })[];
  storage?: Record<string, unknown>;
  tabGroups?: Partial<chrome.tabGroups.TabGroup>[];
  // Optional permissions the profile already holds. Defaults to none, which is
  // what a fresh install looks like.
  grantedPermissions?: chrome.runtime.ManifestPermission[];
  // What chrome.commands.getAll() reports (KAN-256). Absent means no
  // commands are declared -- an empty list, as Chrome returns for an
  // extension without a `commands` block.
  commands?: chrome.commands.Command[];
  // Model the measured production behaviour where the popup is destroyed
  // before permissions.request() settles. See the KAN-11 spike.
  requestNeverSettles?: boolean;
  // Chrome leaves chrome.tabGroups undefined while the tabGroups permission
  // is ungranted, and the Open now pane (KAN-280) must survive that. True
  // omits the member entirely from the installed fake, so a caller sees
  // exactly what an ungranted profile sees rather than a stub with nothing
  // in it.
  tabGroupsApiAbsent?: boolean;
};

export type ChromeFakeHandle = {
  sentMessages: unknown[];
  createdTabs: chrome.tabs.CreateProperties[];
  removedWindowIds: number[];
  groupedTabs: { groupId: number; windowId: number; tabIds: number[] }[];
  // Every chrome.tabs.query() call, in order. Exists for tests that have to
  // prove a listener was genuinely DETACHED rather than merely guarded --
  // e.g. a `cancelled` flag can make a leaked visibilitychange listener's
  // state-setting invisible without making the listener itself, or the
  // chrome call it goes on to make, invisible too. Reading THIS is what
  // still catches that leak.
  tabsQueryCalls: chrome.tabs.QueryInfo[];
  // Simulates the BROWSER changing a seeded tab on its own -- `title` and
  // `lastAccessed` change from the user's own navigation and tab-switching,
  // never from an extension call, so real chrome.tabs.update() has no field
  // for either and this is not that method's fake. `patch` is narrowed to
  // exactly those two fields for the same reason: widening it to
  // Partial<chrome.tabs.Tab> would let a test set something only an
  // extension call can change (`pinned`, say) through a seam meant to model
  // the browser's own hand. Tests that need to simulate the window changing
  // while this page was in the background (KAN-299/KAN-300) have no other
  // seam to reach through. Throws on an unknown id so a typo'd tab id fails
  // the test loudly rather than silently doing nothing.
  simulateBrowserTabChange(
    tabId: number,
    patch: Partial<Pick<chrome.tabs.Tab, 'title' | 'lastAccessed'>>
  ): void;
  // Every chrome.windows.getAll() call, in order it happened. Task 3's
  // refresh-coalescing test proves a burst of events caused ONE re-read (or
  // two, at the edges of the window) rather than one per event -- a count a
  // fired listener can't show on its own.
  windowsGetAllCalls: number;
  // The BROWSER's own hand -- a real tab, window or group change that was
  // never routed through an extension call (unlike tabs.create/update
  // above). Each method mutates the fake's state, the single source of
  // truth `browser.*` and the extension-facing chrome.* surface both read,
  // then fires the matching event(s), so a listener registered through
  // chrome.tabs.onCreated etc. sees exactly what a real one would.
  browser: {
    openTab(windowId: number, tab: Partial<chrome.tabs.Tab>): chrome.tabs.Tab;
    // Throws on an unknown id, like simulateBrowserTabChange above -- a
    // typo'd tab id should fail the test loudly, not silently no-op.
    closeTab(tabId: number): void;
    updateTab(
      tabId: number,
      patch: Partial<
        Pick<
          chrome.tabs.Tab,
          'title' | 'url' | 'favIconUrl' | 'audible' | 'status'
        >
      >
    ): void;
    moveTabToWindow(tabId: number, windowId: number): void;
    closeWindow(windowId: number): void;
    setGroup(
      groupId: number,
      patch: Partial<
        Pick<chrome.tabGroups.TabGroup, 'title' | 'color' | 'collapsed'>
      >
    ): void;
  };
  // The total listeners live across every KAN-280 registry (tabs.onCreated/
  // onRemoved/onUpdated/onMoved/onAttached/onDetached/onActivated,
  // windows.onCreated/onRemoved, tabGroups.onCreated/onUpdated/onRemoved/
  // onMoved). Tests use it to prove an unmount detached everything, not just
  // that the component stopped reacting to one of them.
  listenerCount(): number;
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

// One of these per KAN-280 live event. `fire`/`size` are the fake's own
// levers -- production code only ever gets addListener/removeListener/
// hasListener, the same three members the real chrome.events.Event carries.
type Registry<F extends (...args: never[]) => void> = {
  addListener(fn: F): void;
  removeListener(fn: F): void;
  hasListener(fn: F): boolean;
  fire(...args: Parameters<F>): void;
  size(): number;
};
function registry<F extends (...args: never[]) => void>(): Registry<F> {
  const fns = new Set<F>();
  return {
    addListener: (fn) => void fns.add(fn),
    removeListener: (fn) => void fns.delete(fn),
    hasListener: (fn) => fns.has(fn),
    fire: (...args) => fns.forEach((fn) => fn(...args)),
    size: () => fns.size,
  };
}

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
  ): chrome.tabs.Tab => {
    // A seed's own `windowId` must agree with the window it is being placed
    // IN. Without this, a seed literal naming its own `windowId` (a typed
    // builder's default, say) would silently win over this parameter via
    // the `...tab` spread below, moving the tab into the wrong window with
    // no error -- a second-window tab built from a default `windowId: 1`
    // would land in window 1 instead of the window it is nested under.
    if (tab.windowId !== undefined && tab.windowId !== windowId) {
      throw new Error(
        `makeTab: seed names windowId ${tab.windowId}, but this tab is being placed in window ${windowId} -- drop the explicit windowId (it is inferred from where the tab is seeded) or make the two agree.`
      );
    }
    return {
      id: nextId++,
      index: 0,
      url: '',
      title: '',
      active: false,
      // -1 is chrome.tabGroups.TAB_GROUP_ID_NONE. Defaulting to undefined
      // would let a capture that reads tab.groupId silently treat every tab as
      // grouped-into-nothing rather than ungrouped.
      groupId: -1,
      ...tab,
      windowId,
    } as chrome.tabs.Tab;
  };

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

  // Whether `currentWindow` in a tabs.query can be honoured at all.
  //
  // Honouring it needs a seed that places every tab in a window it actually
  // declared. Several seeds do not: they declare `windows: [{id: 7, ...}]` for
  // the capture path AND a separate top-level `tabs: [{active: true}]` for the
  // name pre-fill, and that second tab falls to DEFAULT_WINDOW_ID. Filtering
  // those on currentWindow would erase the active tab and break the seed's
  // own intent, so such seeds keep the historical "currentWindow means any
  // window" behaviour.
  //
  // Inferred from the seed rather than set by a flag, because the inference is
  // exactly the precondition -- a seed that IS window-consistent can only
  // benefit from the higher fidelity, and one that is not could only be broken
  // by it. Snapshotted here rather than recomputed per query so that a later
  // tabs.create() cannot silently flip the semantics mid-test.
  const declaredWindowIds = new Set(windows.map((win) => win.id));
  const currentWindowId = windows[0]?.id;
  const seedPlacesEveryTabInADeclaredWindow =
    windows.length > 0 &&
    tabs.every((tab) => declaredWindowIds.has(tab.windowId));

  // Chrome omits `tabs` entirely unless populate was asked for, so the two
  // cases are deliberately different shapes rather than one with an empty
  // array -- a test that forgets populate should see what production sees.
  const populate = (win: chrome.windows.Window): chrome.windows.Window => ({
    ...win,
    tabs: tabs.filter((tab) => tab.windowId === win.id),
  });

  // Chrome's `index` is the tab's position among its OWN window's tabs, not
  // the flat `tabs` array. Called after every browser.* add, remove or move
  // so it stays truthful, in the order those tabs already sit in `tabs` --
  // which is also why a move re-homes the tab at the END of the array (see
  // browser.moveTabToWindow below) rather than leaving it in place.
  const reindexWindow = (windowId: number): void => {
    tabs
      .filter((tab) => tab.windowId === windowId)
      .forEach((tab, index) => {
        tab.index = index;
      });
  };

  const tabGroups: chrome.tabGroups.TabGroup[] = (seed.tabGroups ?? []).map(
    (group) =>
      ({
        id: group.id ?? nextId++,
        collapsed: false,
        color: 'grey',
        shared: false,
        title: '',
        windowId: DEFAULT_WINDOW_ID,
        ...group,
      }) as chrome.tabGroups.TabGroup
  );

  // KAN-280 live event registries. Not fired by any chrome.tabs/windows/
  // tabGroups call above (those model an EXTENSION's own actions, which
  // Chrome does not echo back as events to the caller) -- only by
  // handle.browser.* below, which models the browser's hand.
  const tabsOnCreated = registry<(tab: chrome.tabs.Tab) => void>();
  const tabsOnRemoved =
    registry<(tabId: number, info: chrome.tabs.OnRemovedInfo) => void>();
  const tabsOnUpdated =
    registry<
      (
        tabId: number,
        changeInfo: chrome.tabs.OnUpdatedInfo,
        tab: chrome.tabs.Tab
      ) => void
    >();
  const tabsOnMoved =
    registry<(tabId: number, moveInfo: chrome.tabs.OnMovedInfo) => void>();
  const tabsOnAttached =
    registry<(tabId: number, info: chrome.tabs.OnAttachedInfo) => void>();
  const tabsOnDetached =
    registry<(tabId: number, info: chrome.tabs.OnDetachedInfo) => void>();
  const tabsOnActivated =
    registry<(info: chrome.tabs.OnActivatedInfo) => void>();
  const windowsOnCreated = registry<(win: chrome.windows.Window) => void>();
  const windowsOnRemoved = registry<(windowId: number) => void>();
  const tabGroupsOnCreated =
    registry<(group: chrome.tabGroups.TabGroup) => void>();
  const tabGroupsOnUpdated =
    registry<(group: chrome.tabGroups.TabGroup) => void>();
  const tabGroupsOnRemoved =
    registry<(group: chrome.tabGroups.TabGroup) => void>();
  const tabGroupsOnMoved =
    registry<(group: chrome.tabGroups.TabGroup) => void>();

  const granted = new Set(seed.grantedPermissions ?? []);
  const permissionListeners = {
    added: [] as ((p: chrome.permissions.Permissions) => void)[],
    removed: [] as ((p: chrome.permissions.Permissions) => void)[],
  };

  const handle: ChromeFakeHandle = {
    sentMessages: [],
    createdTabs: [],
    removedWindowIds: [],
    groupedTabs: [],
    tabsQueryCalls: [],
    windowsGetAllCalls: 0,
    simulateBrowserTabChange(tabId, patch) {
      const target = tabs.find((t) => t.id === tabId);
      if (!target) {
        throw new Error(
          `simulateBrowserTabChange: no seeded tab with id ${tabId}`
        );
      }
      Object.assign(target, patch);
    },
    browser: {
      openTab(windowId, tab) {
        const created = makeTab(tab, windowId);
        tabs.push(created);
        reindexWindow(windowId);
        tabsOnCreated.fire(created);
        return created;
      },
      closeTab(tabId) {
        const index = tabs.findIndex((tab) => tab.id === tabId);
        if (index === -1) {
          throw new Error(`browser.closeTab: no seeded tab with id ${tabId}`);
        }
        const [removed] = tabs.splice(index, 1);
        reindexWindow(removed.windowId);
        tabsOnRemoved.fire(tabId, {
          isWindowClosing: false,
          windowId: removed.windowId,
        });
      },
      updateTab(tabId, patch) {
        const target = tabs.find((tab) => tab.id === tabId);
        if (!target) return;
        Object.assign(target, patch);
        tabsOnUpdated.fire(tabId, patch, target);
      },
      moveTabToWindow(tabId, windowId) {
        const index = tabs.findIndex((tab) => tab.id === tabId);
        if (index === -1) return;
        const [moved] = tabs.splice(index, 1);
        const oldWindowId = moved.windowId;
        tabsOnDetached.fire(tabId, {
          oldWindowId,
          oldPosition: moved.index,
        });
        moved.windowId = windowId;
        tabs.push(moved);
        reindexWindow(oldWindowId);
        reindexWindow(windowId);
        tabsOnAttached.fire(tabId, {
          newWindowId: windowId,
          newPosition: moved.index,
        });
      },
      closeWindow(windowId) {
        const index = windows.findIndex((win) => win.id === windowId);
        if (index !== -1) windows.splice(index, 1);
        for (let i = tabs.length - 1; i >= 0; i -= 1) {
          if (tabs[i].windowId === windowId) tabs.splice(i, 1);
        }
        windowsOnRemoved.fire(windowId);
      },
      setGroup(groupId, patch) {
        const target = tabGroups.find((group) => group.id === groupId);
        if (!target) return;
        Object.assign(target, patch);
        tabGroupsOnUpdated.fire(target);
      },
    },
    listenerCount() {
      return [
        tabsOnCreated,
        tabsOnRemoved,
        tabsOnUpdated,
        tabsOnMoved,
        tabsOnAttached,
        tabsOnDetached,
        tabsOnActivated,
        windowsOnCreated,
        windowsOnRemoved,
        tabGroupsOnCreated,
        tabGroupsOnUpdated,
        tabGroupsOnRemoved,
        tabGroupsOnMoved,
      ].reduce((total, r) => total + r.size(), 0);
    },
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

  const tabGroupsApi = {
    TAB_GROUP_ID_NONE: -1 as const,
    query: (
      queryInfo: chrome.tabGroups.QueryInfo,
      cb?: (result: chrome.tabGroups.TabGroup[]) => void
    ) =>
      settle(
        tabGroups.filter(
          (group) =>
            queryInfo.windowId === undefined ||
            group.windowId === queryInfo.windowId
        ),
        cb
      ),
    update: (
      groupId: number,
      props: chrome.tabGroups.UpdateProperties,
      cb?: (group?: chrome.tabGroups.TabGroup) => void
    ) => {
      const target = tabGroups.find((group) => group.id === groupId);
      if (target) Object.assign(target, props);
      return settle(target, cb);
    },
    onCreated: tabGroupsOnCreated,
    onUpdated: tabGroupsOnUpdated,
    onRemoved: tabGroupsOnRemoved,
    onMoved: tabGroupsOnMoved,
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
      // `active` and `windowId` are always honoured. `currentWindow` is
      // honoured only for window-consistent seeds (see
      // `seedPlacesEveryTabInADeclaredWindow` above); `lastFocusedWindow` is
      // still deliberately NOT honoured at all.
      //
      // Widened for KAN-74. countOpenTabGroups() must count across ALL
      // windows, and while `currentWindow` was ignored outright the fake
      // answered query({}) and query({currentWindow:true}) identically -- so
      // the multi-window test asserting all-windows behaviour passed against a
      // deliberately broken implementation that asked for the current window
      // only. The mutation survived; this is what kills it.
      query: (
        queryInfo: chrome.tabs.QueryInfo,
        cb?: (result: chrome.tabs.Tab[]) => void
      ) => {
        handle.tabsQueryCalls.push(queryInfo);
        const matched = tabs.filter(
          (tab) =>
            (queryInfo.active === undefined ||
              tab.active === queryInfo.active) &&
            (queryInfo.windowId === undefined ||
              tab.windowId === queryInfo.windowId) &&
            (queryInfo.currentWindow === undefined ||
              !seedPlacesEveryTabInADeclaredWindow ||
              (queryInfo.currentWindow
                ? tab.windowId === currentWindowId
                : tab.windowId !== currentWindowId))
        );
        return settle(matched, cb);
      },
      // What Chrome answers when the caller is itself a tab -- the export page
      // (KAN-208) asks so it can leave itself out of a capture. Undefined from
      // a context that is not a tab, as in Chrome, and undefined for an id no
      // seeded tab carries: minting one here would hide a seed that names the
      // wrong tab.
      getCurrent: (cb?: (tab?: chrome.tabs.Tab) => void) =>
        settle(
          seed.currentTabId === undefined
            ? undefined
            : tabs.find((tab) => tab.id === seed.currentTabId),
          cb
        ),
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
      onCreated: tabsOnCreated,
      onRemoved: tabsOnRemoved,
      onUpdated: tabsOnUpdated,
      onMoved: tabsOnMoved,
      onAttached: tabsOnAttached,
      onDetached: tabsOnDetached,
      // Was a no-op stub; background.ts:20 registers a real listener here on
      // every tab switch, so a real registry must keep that working exactly
      // as it did.
      onActivated: tabsOnActivated,
      group: (
        options: chrome.tabs.GroupOptions,
        cb?: (groupId: number) => void
      ) => {
        const tabIds = Array.isArray(options.tabIds)
          ? options.tabIds
          : [options.tabIds as number];
        const windowId =
          options.createProperties?.windowId ?? DEFAULT_WINDOW_ID;
        const groupId = options.groupId ?? nextId++;

        if (!tabGroups.some((group) => group.id === groupId)) {
          tabGroups.push({
            id: groupId,
            collapsed: false,
            color: 'grey',
            shared: false,
            title: '',
            windowId,
          } as chrome.tabGroups.TabGroup);
        }
        for (const tabId of tabIds) {
          const target = tabs.find((tab) => tab.id === tabId);
          if (target) target.groupId = groupId;
        }
        handle.groupedTabs.push({ groupId, windowId, tabIds });
        return settle(groupId, cb);
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
        handle.windowsGetAllCalls += 1;
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
      // Only `focused` is exercised today (Task 3's "This window" tag), but
      // every UpdateInfo field is applied -- narrowing to just `focused`
      // would silently drop whatever a later caller sends alongside it.
      update: (
        windowId: number,
        props: chrome.windows.UpdateInfo,
        cb?: (win?: chrome.windows.Window) => void
      ) => {
        const target = windows.find((win) => win.id === windowId);
        if (target) Object.assign(target, props);
        return settle(target, cb);
      },
      onCreated: windowsOnCreated,
      onRemoved: windowsOnRemoved,
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

    // Absent entirely (not present-but-undefined) when the seed says the
    // permission is ungranted, matching what Chrome hands an ungranted
    // profile: the member is missing from the namespace, not a stub with
    // nothing in it, and code that reaches for it without checking first
    // must fail the same way it would in a real browser.
    ...(seed.tabGroupsApiAbsent ? {} : { tabGroups: tabGroupsApi }),

    commands: {
      getAll: (cb?: (commands: chrome.commands.Command[]) => void) =>
        settle(seed.commands ?? [], cb),
    },
    permissions: {
      contains: (
        permissions: chrome.permissions.Permissions,
        cb?: (result: boolean) => void
      ) =>
        settle(
          (permissions.permissions ?? []).every((name) => granted.has(name)),
          cb
        ),
      request: (
        permissions: chrome.permissions.Permissions,
        cb?: (granted: boolean) => void
      ) => {
        // Production measurement: the popup can be destroyed before this
        // settles, so a caller must never depend on the result. Seeding
        // requestNeverSettles lets a test reproduce that shape exactly.
        if (seed.requestNeverSettles) return new Promise<boolean>(() => {});
        for (const name of permissions.permissions ?? []) granted.add(name);
        permissionListeners.added.forEach((listener) => listener(permissions));
        return settle(true, cb);
      },
      remove: (
        permissions: chrome.permissions.Permissions,
        cb?: (removed: boolean) => void
      ) => {
        for (const name of permissions.permissions ?? []) granted.delete(name);
        permissionListeners.removed.forEach((listener) =>
          listener(permissions)
        );
        return settle(true, cb);
      },
      getAll: (cb?: (p: chrome.permissions.Permissions) => void) =>
        settle({ permissions: [...granted], origins: [] }, cb),
      onAdded: {
        addListener: (fn: (p: chrome.permissions.Permissions) => void) => {
          permissionListeners.added.push(fn);
        },
        removeListener: () => undefined,
      },
      onRemoved: {
        addListener: (fn: (p: chrome.permissions.Permissions) => void) => {
          permissionListeners.removed.push(fn);
        },
        removeListener: () => undefined,
      },
    },
  };

  (globalThis as { chrome?: unknown }).chrome = chromeFake;
  return handle;
}
