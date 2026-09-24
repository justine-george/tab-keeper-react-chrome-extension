// Working in-memory fakes for the chrome APIs the app actually calls. A fake
// over a mock on purpose: tests assert on resulting state rather than on the
// fact that a function was invoked.
//
// Covers 26 members production code calls as of 2026-09-24 --
// tabs.query/create/update/get/getCurrent/onActivated/group, windows.getAll/
// getCurrent/create/remove/update, storage.sync.get/set, runtime.
// sendMessage/onMessage/getURL/lastError, tabGroups.query/update/
// TAB_GROUP_ID_NONE, permissions.contains/request/remove/onAdded/onRemoved
// -- plus storage.sync.remove/clear, permissions.getAll and tabs.remove/
// windows.get/tabGroups.get (added ahead of the production callers Part B's
// later tasks add), none of which have a production call site today but are
// implemented for API fidelity and exercised by this fake's own tests.
// Widen this when the app calls something new.
//
// KAN-280 (Open now pane) adds live event registries with no production
// caller yet -- tabs.onCreated/onRemoved/onUpdated/onMoved/onAttached/
// onDetached, windows.onCreated/onRemoved, tabGroups.onCreated/onUpdated/
// onRemoved/onMoved -- plus ChromeFakeHandle.browser, which models the
// BROWSER's own hand (open/close/update/move/activate a tab, close a
// window, set a group) by mutating state and firing the matching event, and
// liveEventListenerCount()/windowsGetAllCalls for proving an unmount detached
// everything and a refresh coalesced its reads.
//
// KAN-280 O8 (Reopen): Reopen closes and recreates tabs and windows through
// these same extension calls, and Open now refreshes off the events Chrome
// fires for them -- so an extension's OWN calls have to fire events too,
// not just handle.browser.*'s simulated user actions. tabs.remove fires
// tabs.onRemoved (and windows.onRemoved when a window's last tab goes with
// it), tabs.create and windows.create (per tab) fire tabs.onCreated,
// windows.create also fires windows.onCreated, and tabGroups.update fires
// tabGroups.onUpdated. See the registries comment below for the full split.

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
  // Urls tabs.create and windows.create refuse, as Chrome does for a
  // file:// page without file access or some chrome:// pages -- Reopen
  // (KAN-280 O8) recreates a tab at its real address and has to survive
  // Chrome declining some of them.
  refusedUrls?: string[];
};

export type ChromeFakeHandle = {
  sentMessages: unknown[];
  // Every chrome.tabs.create() CALL, in order -- including one that goes on
  // to be refused. Pushed before the window/url checks run, so a refused
  // create still shows up here.
  createdTabs: chrome.tabs.CreateProperties[];
  // Every chrome.windows.remove() CALL, in order -- including one that goes
  // on to reject for an unknown id. Pushed before that check runs.
  removedWindowIds: number[];
  // Every tab id chrome.tabs.remove() actually CLOSED, in the order it
  // closed them -- not every id the call was given. tabs.remove below stops
  // at the first unknown id in a batch, so only the ids before it are ever
  // pushed here. Close tab/Close window (KAN-280 O8) prove against this
  // rather than re-deriving it from onRemoved, which a second close of an
  // already-gone tab fires zero times for.
  removedTabIds: number[];
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
    // The user switching tabs: `active` moves to this tab within its own
    // window (other windows keep theirs) and onActivated fires. Throws on an
    // unknown id, like closeTab.
    activateTab(tabId: number): void;
    setGroup(
      groupId: number,
      patch: Partial<
        Pick<chrome.tabGroups.TabGroup, 'title' | 'color' | 'collapsed'>
      >
    ): void;
  };
  // The listeners attached to the live-event registries KAN-280 added
  // (tabs.onCreated/onRemoved/onUpdated/onMoved/onAttached/onDetached/
  // onActivated, windows.onCreated/onRemoved, tabGroups.onCreated/onUpdated/
  // onRemoved/onMoved), and no others. Tests use it to prove an unmount
  // detached everything, not just that the component stopped reacting to
  // one of them.
  liveEventListenerCount(): number;
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

  // Chrome (MV3) never rejects a callback-style call -- a failure is
  // reported through chrome.runtime.lastError instead, and background.ts's
  // `chrome.windows.remove(id, () => { void chrome.runtime.lastError; })`
  // (closing a window the user may already have closed) depends on exactly
  // that: an unhandled rejection there would crash the service worker.
  // `fail` is `settle`'s failure counterpart: with a callback, lastError is
  // set for the callback's duration, the callback fires once with
  // `undefined`, then lastError clears and the call resolves; with no
  // callback, it rejects, as every promise-form failure here already does.
  let lastError: chrome.runtime.LastError | undefined;
  function fail<T>(
    message: string,
    cb?: (value?: T) => void
  ): Promise<T | undefined> {
    if (!cb) return Promise.reject(new Error(message));
    lastError = { message };
    cb(undefined);
    lastError = undefined;
    return Promise.resolve(undefined);
  }

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

  // KAN-280 live event registries. tabs.remove, tabs.create, windows.create
  // and tabGroups.update (all below) DO fire these back to their own
  // caller, matching real Chrome -- an extension is not exempt from its own
  // events. windows.remove fires tabs.onRemoved per tab then
  // windows.onRemoved. Everything else here (onUpdated/onMoved/onAttached/
  // onDetached/onActivated, tabGroups.onCreated/onRemoved/onMoved) has no
  // extension-call trigger in this file -- only handle.browser.* below,
  // which models the BROWSER's own hand, fires those.
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
    removedTabIds: [],
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
        if (!target) {
          throw new Error(`browser.updateTab: no seeded tab with id ${tabId}`);
        }
        Object.assign(target, patch);
        tabsOnUpdated.fire(tabId, patch, target);
      },
      moveTabToWindow(tabId, windowId) {
        const index = tabs.findIndex((tab) => tab.id === tabId);
        if (index === -1) {
          throw new Error(
            `browser.moveTabToWindow: no seeded tab with id ${tabId}`
          );
        }
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
      activateTab(tabId) {
        const target = tabs.find((tab) => tab.id === tabId);
        if (!target) {
          throw new Error(
            `browser.activateTab: no seeded tab with id ${tabId}`
          );
        }
        for (const tab of tabs) {
          if (tab.windowId === target.windowId) tab.active = tab === target;
        }
        tabsOnActivated.fire({ tabId, windowId: target.windowId });
      },
      setGroup(groupId, patch) {
        const target = tabGroups.find((group) => group.id === groupId);
        if (!target) {
          throw new Error(
            `browser.setGroup: no seeded group with id ${groupId}`
          );
        }
        Object.assign(target, patch);
        tabGroupsOnUpdated.fire(target);
      },
    },
    liveEventListenerCount() {
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
    get: (
      groupId: number,
      cb?: (group?: chrome.tabGroups.TabGroup) => void
    ) => {
      const target = tabGroups.find((group) => group.id === groupId);
      if (!target) {
        return fail<chrome.tabGroups.TabGroup>(
          `No group with id: ${groupId}.`,
          cb
        );
      }
      return settle(target, cb);
    },
    update: (
      groupId: number,
      props: chrome.tabGroups.UpdateProperties,
      cb?: (group?: chrome.tabGroups.TabGroup) => void
    ) => {
      const target = tabGroups.find((group) => group.id === groupId);
      if (!target) {
        return fail<chrome.tabGroups.TabGroup>(
          `No group with id: ${groupId}.`,
          cb
        );
      }
      Object.assign(target, props);
      tabGroupsOnUpdated.fire(target);
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
      //
      // A copy, as Chrome's answer is (it crosses a process boundary). The
      // live object would follow a later moveTabToWindow, so a caller that
      // read getCurrent once and kept the answer would still see the move,
      // and a test of "re-read every refresh" (KAN-280) could not fail.
      getCurrent: (cb?: (tab?: chrome.tabs.Tab) => void) => {
        const current =
          seed.currentTabId === undefined
            ? undefined
            : tabs.find((tab) => tab.id === seed.currentTabId);
        return settle(current && { ...current }, cb);
      },
      // Chrome's own `index` clamp: the requested slot lands within [0,
      // count], then a pinned tab is pushed back into the pinned run at the
      // front and an unpinned one pushed past it -- a pinned tab can never
      // sit after an unpinned one (KAN-280).
      create: (
        props: chrome.tabs.CreateProperties,
        cb?: (tab?: chrome.tabs.Tab) => void
      ) => {
        handle.createdTabs.push(props);
        // No windowId names the CURRENT window, as Chrome does -- the first
        // window this seed declared, matching `currentWindowId` above.
        // Falls to DEFAULT_WINDOW_ID only when the seed declares no window
        // at all.
        const windowId = props.windowId ?? currentWindowId ?? DEFAULT_WINDOW_ID;
        if (!windows.some((win) => win.id === windowId)) {
          return fail<chrome.tabs.Tab>(`No window with id: ${windowId}.`, cb);
        }
        const url = props.url ?? '';
        if ((seed.refusedUrls ?? []).includes(url)) {
          return fail<chrome.tabs.Tab>(
            `Cannot create a tab with url: ${url}`,
            cb
          );
        }
        const active = props.active ?? true;
        const pinned = props.pinned ?? false;
        const created = makeTab({ url, active, pinned }, windowId);

        const own = tabs
          .filter((tab) => tab.windowId === windowId)
          .sort((a, b) => a.index - b.index);
        const pinnedCount = own.filter((tab) => tab.pinned).length;
        const rawWant = Math.min(
          Math.max(props.index ?? own.length, 0),
          own.length
        );
        const want = pinned
          ? Math.min(rawWant, pinnedCount)
          : Math.max(rawWant, pinnedCount);

        if (want < own.length) {
          tabs.splice(tabs.indexOf(own[want]), 0, created);
        } else if (own.length === 0) {
          tabs.push(created);
        } else {
          tabs.splice(tabs.indexOf(own[own.length - 1]) + 1, 0, created);
        }
        reindexWindow(windowId);

        if (active) {
          for (const tab of tabs) {
            if (tab.windowId === windowId && tab !== created) {
              tab.active = false;
            }
          }
        }

        tabsOnCreated.fire(created);
        return settle(created, cb);
      },
      // Normalised to an array so the single-id and multi-id overloads share
      // one path. Matches Chromium's TabsRemoveFunction::Run
      // (chrome/browser/extensions/api/tabs/tabs_api.cc): each id closes in
      // order, and the FIRST unknown id stops the loop right there and
      // reports it -- ids before it are already closed, ids after it are
      // untouched. A second close of an already-gone tab (KAN-280 O8's
      // double-click guard) hits exactly that id and stops, without
      // touching a sibling it was never asked about.
      remove: (ids: number | number[], cb?: () => void) => {
        const idList = Array.isArray(ids) ? ids : [ids];
        for (const id of idList) {
          const index = tabs.findIndex((tab) => tab.id === id);
          if (index === -1) {
            return fail<void>(`No tab with id: ${id}.`, cb);
          }
          const [removed] = tabs.splice(index, 1);
          handle.removedTabIds.push(id);
          reindexWindow(removed.windowId);
          const windowStillHasTabs = tabs.some(
            (tab) => tab.windowId === removed.windowId
          );
          tabsOnRemoved.fire(id, {
            windowId: removed.windowId,
            isWindowClosing: !windowStillHasTabs,
          });
          if (!windowStillHasTabs) {
            const windowIndex = windows.findIndex(
              (win) => win.id === removed.windowId
            );
            // Only a window the seed actually declared closes with its
            // last tab -- the implicit DEFAULT_WINDOW_ID a bare `tabs:
            // [...]` seed falls back to was never a real window, so
            // nothing here reports one removed.
            if (windowIndex !== -1) {
              windows.splice(windowIndex, 1);
              windowsOnRemoved.fire(removed.windowId);
            }
          }
        }
        return settle(undefined, cb);
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
      //
      // No `url` at all opens a single chrome://newtab/ tab, as Chrome does
      // (KAN-280 Part B). Only the FIRST tab is made active, matching a real
      // multi-url window.create().
      create: (
        data: chrome.windows.CreateData,
        cb?: (win?: chrome.windows.Window) => void
      ) => {
        const urls =
          typeof data.url === 'string'
            ? [data.url]
            : data.url ?? ['chrome://newtab/'];
        const refused = urls.find((url) =>
          (seed.refusedUrls ?? []).includes(url)
        );
        if (refused !== undefined) {
          return fail<chrome.windows.Window>(
            `Cannot create a tab with url: ${refused}`,
            cb
          );
        }
        const created = {
          id: nextId++,
          focused: data.focused ?? false,
          type: data.type ?? 'normal',
          left: data.left,
          top: data.top,
          width: data.width,
          height: data.height,
          state: data.state,
          incognito: data.incognito ?? false,
        } as unknown as chrome.windows.Window;
        const windowId = created.id as number;
        windows.push(created);
        urls.forEach((url, i) => {
          tabs.push(makeTab({ url, active: i === 0 }, windowId));
        });
        reindexWindow(windowId);
        windowsOnCreated.fire(created);
        for (const tab of tabs) {
          if (tab.windowId === windowId) tabsOnCreated.fire(tab);
        }
        return settle(populate(created), cb);
      },
      // Rejects on an unknown id -- but only after removedWindowIds sees the
      // attempt, since existing tests read that list regardless of outcome.
      // Each closing tab fires tabs.onRemoved with isWindowClosing: true
      // BEFORE windows.onRemoved, matching real Chrome (KAN-280 Part B).
      remove: (windowId: number, cb?: () => void) => {
        handle.removedWindowIds.push(windowId);
        const index = windows.findIndex((win) => win.id === windowId);
        if (index === -1) {
          return fail<void>(`No window with id: ${windowId}.`, cb);
        }
        windows.splice(index, 1);
        const closingTabs = tabs.filter((tab) => tab.windowId === windowId);
        for (const tab of closingTabs) {
          const tabIndex = tabs.indexOf(tab);
          if (tabIndex !== -1) tabs.splice(tabIndex, 1);
          if (tab.id !== undefined) {
            tabsOnRemoved.fire(tab.id, { windowId, isWindowClosing: true });
          }
        }
        windowsOnRemoved.fire(windowId);
        return settle(undefined, cb);
      },
      get: (
        windowId: number,
        info?: chrome.windows.QueryOptions,
        cb?: (win?: chrome.windows.Window) => void
      ) => {
        const target = windows.find((win) => win.id === windowId);
        if (!target) {
          return fail<chrome.windows.Window>(
            `No window with id: ${windowId}.`,
            cb
          );
        }
        return settle(info?.populate ? populate(target) : { ...target }, cb);
      },
      // Only `focused` is sent today (switchToOpenTab, KAN-280 O6), but
      // every UpdateInfo field is applied -- narrowing to just `focused`
      // would silently drop whatever a later caller sends alongside it.
      update: (
        windowId: number,
        props: chrome.windows.UpdateInfo,
        cb?: (win?: chrome.windows.Window) => void
      ) => {
        const target = windows.find((win) => win.id === windowId);
        if (!target) {
          return fail<chrome.windows.Window>(
            `No window with id: ${windowId}.`,
            cb
          );
        }
        Object.assign(target, props);
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
      // A live read of `fail`'s own state above, not a static field -- a
      // caller reading this mid-callback has to see what `fail` just set.
      get lastError(): chrome.runtime.LastError | undefined {
        return lastError;
      },
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
