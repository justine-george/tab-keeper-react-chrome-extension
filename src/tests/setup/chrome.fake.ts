// Working in-memory fakes for the chrome APIs the app actually calls. A fake
// over a mock on purpose: tests assert on resulting state rather than on the
// fact that a function was invoked.
//
// Covers 31 members production code calls as of 2026-09-24 (plus
// sessions.getRecentlyClosed/restore, modelled ahead of KAN-280 Part D's
// Reopen calling them -- see below) --
// tabs.query/create/update/get/getCurrent/onActivated/group/ungroup/remove,
// windows.getAll/getCurrent/create/remove/update/get, storage.sync.get/set,
// runtime.sendMessage/onMessage/getURL/lastError/getPlatformInfo (the Reopen
// button's ⌘Z or Ctrl+Z hint, KAN-311), tabGroups.query/update/get/
// TAB_GROUP_ID_NONE, permissions.contains/request/remove/onAdded/onRemoved --
// tabs.remove, windows.get and tabGroups.get are reopen.ts's calls (KAN-280
// O8): tabs.remove closes a tab and drops the seed tab a recreated window
// opens with; windows.get checks whether a tab's old window is still open
// before reopening into it; tabGroups.get checks whether an old group still
// exists before rejoining it. Plus storage.sync.remove/clear and
// permissions.getAll, implemented for API fidelity and exercised by this
// fake's own tests, with no production call site today.
// Widen this when the app calls something new.
//
// KAN-280 (Open now pane) adds live event registries, which
// src/hooks/useOpenWindows.ts listens on to keep the pane current --
// tabs.onCreated/onRemoved/onUpdated/onMoved/onAttached/onDetached,
// windows.onCreated/onRemoved, tabGroups.onCreated/onUpdated/onRemoved/
// onMoved -- plus ChromeFakeHandle.browser, which models the
// BROWSER's own hand (open/close/update/mute/move/activate a tab, close a
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
//
// KAN-280 Part D (Reopen through chrome.sessions): sessions.getRecentlyClosed/
// restore, present only once `sessions` has been granted, fed by this fake's
// own tabs.remove and windows.remove. Every rule is one Task 1 measured in
// Chromium 151 (docs/superpowers/plans/2026-09-27-open-now-part-d.md, "Task 1
// results"), cited as "Task 1, Qn" where it is modelled. Reopen then undoes
// what a restore did to focus and order, so the fake also keeps one front tab
// per window and one focused window, and adds tabs.move,
// windows.getLastFocused and a runtime.onMessage that sendMessage reaches
// (the page asks the service worker, and reads its answer).

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
  // what a fresh install looks like. Holding `sessions` here makes
  // chrome.sessions present from the start (Task 1, Q4).
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
  // What runtime.getPlatformInfo() reports as the os (KAN-311: the Reopen
  // button hints ⌘Z on a Mac, Ctrl+Z elsewhere). Absent means 'linux', the
  // non-Mac form, so a test that seeds nothing never sees the Mac one.
  platformOs?: chrome.runtime.PlatformInfo['os'];
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
  // Every chrome.windows.getAll() call, in order it happened. The
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
          'title' | 'url' | 'favIconUrl' | 'audible' | 'status' | 'mutedInfo'
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
  // Whether this tab came back through chrome.sessions.restore rather than
  // being made by tabs.create, windows.create or the seed. Chrome's own
  // evidence is the page's history.length (Task 1, Q2: 3 after a restore, 1
  // after a recreate), and the fake has no page to hold one -- this is that
  // evidence, and nothing is added to chrome.tabs.Tab for it. Throws on an id
  // no open tab carries, so a typo'd id fails loudly.
  restoredFromSession(tabId: number): boolean;
  restore(): void;
};

// A tab's group as it was when the tab closed -- what sessions.restore needs
// to bring the group back with the same title and colour (Task 1, Q2).
type ClosedGroup = Pick<
  chrome.tabGroups.TabGroup,
  'id' | 'title' | 'color' | 'collapsed'
>;
// A closed tab as the fake remembers it: the tab exactly as it was (its REAL
// windowId, groupId and index -- the Session view hides them, as Chrome
// does), its group, and the session id Chrome would hand out for it.
type ClosedTab = {
  sessionId: string;
  tab: chrome.tabs.Tab;
  group: ClosedGroup | undefined;
};
// One recently-closed entry. Its kind follows the CALL that closed it, not
// how many tabs went (Task 1, Q1b): tabs.remove makes a 'tab' entry even for
// a window's only tab, windows.remove makes a 'window' entry even for one tab.
type ClosedEntry =
  | { kind: 'tab'; lastModified: number; closed: ClosedTab }
  | {
      kind: 'window';
      lastModified: number;
      sessionId: string;
      window: chrome.windows.Window;
      tabs: ClosedTab[];
    };

// Chrome's cap on the recently-closed list (Task 1, Q3: 30 later closes
// pushed an id out, and the oldest id still listed restored).
const MAX_SESSION_RESULTS = 25;

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
  // Tabs whose seed literal named its own `index`, tracked by reference --
  // the seed-time reindex below (KAN-280 O8) must not clobber a value the
  // test asked for on purpose (e.g. RateAndReviewModal's `index: 3`).
  const explicitIndexTabs = new WeakSet<chrome.tabs.Tab>();

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
    const created = {
      id: nextId++,
      index: 0,
      url: '',
      title: '',
      active: false,
      // -1 is chrome.tabGroups.TAB_GROUP_ID_NONE. Defaulting to undefined
      // would let a capture that reads tab.groupId silently treat every tab as
      // grouped-into-nothing rather than ungrouped.
      groupId: -1,
      // No real tab is ever missing these (KAN-280 O10). A seed's own values
      // still win via the `...tab` spread below.
      pinned: false,
      audible: false,
      mutedInfo: { muted: false },
      ...tab,
      windowId,
    } as chrome.tabs.Tab;
    if (tab.index !== undefined) explicitIndexTabs.add(created);
    return created;
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
      // `incognito` is a required boolean on chrome.windows.Window, so a
      // seed that omits it must still match what Chrome always reports
      // (KAN-280 O8) rather than leaving the field undefined.
      incognito: false,
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

  // A seeded tab's `index` defaults to 0 (makeTab above), which is only
  // truthful for the first tab of its window -- so every DECLARED window
  // whose tabs named no explicit index gets reindexed here, once, matching
  // the order they were seeded in (KAN-280 O8's real-index requirement). A
  // window with even one explicit index is left alone entirely: reindexing
  // around it would need to invent a rule for how the named and unnamed
  // tabs interleave, and no seed in this repo asks for that.
  for (const win of windows) {
    if (typeof win.id !== 'number') continue;
    const windowTabs = tabs.filter((tab) => tab.windowId === win.id);
    if (windowTabs.every((tab) => !explicitIndexTabs.has(tab))) {
      reindexWindow(win.id);
    }
  }

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
  // windows.onRemoved. tabs.remove and windows.remove also fire
  // tabGroups.onRemoved for a group whose last tab they closed (KAN-280 Part
  // D). sessions.restore fires what tabs.create/windows.create/
  // tabGroups.update fire for the same change, plus tabGroups.onCreated for
  // a group it brings back. Everything else here (onUpdated/onMoved/
  // onAttached/onDetached/onActivated, tabGroups.onMoved) has no
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

  // runtime.onMessage's listeners. Not a Registry: a listener's RETURN
  // value matters here (true keeps the channel open for sendResponse).
  type MessageListener = (
    message: unknown,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void
  ) => boolean | void;
  const messageListeners = new Set<MessageListener>();

  const granted = new Set(seed.grantedPermissions ?? []);
  const permissionListeners = {
    added: [] as ((p: chrome.permissions.Permissions) => void)[],
    removed: [] as ((p: chrome.permissions.Permissions) => void)[],
  };

  // A window's tabs in strip order, for working out where a tab lands.
  const windowTabsInOrder = (windowId: number): chrome.tabs.Tab[] =>
    tabs
      .filter((tab) => tab.windowId === windowId)
      .sort((a, b) => a.index - b.index);

  // Chrome's own `index` clamp: the requested slot lands within [0,
  // count], then a pinned tab is pushed back into the pinned run at the
  // front and an unpinned one pushed past it -- a pinned tab can never
  // sit after an unpinned one (KAN-280).
  const clampSlot = (
    own: chrome.tabs.Tab[],
    requested: number | undefined,
    pinned: boolean
  ): number => {
    const pinnedCount = own.filter((tab) => tab.pinned).length;
    const rawWant = Math.min(Math.max(requested ?? own.length, 0), own.length);
    return pinned
      ? Math.min(rawWant, pinnedCount)
      : Math.max(rawWant, pinnedCount);
  };

  // Puts `tab` into the flat `tabs` list so it sits at `slot` among `own`
  // (its window's tabs in order), then reindexes that window.
  const insertAtSlot = (
    tab: chrome.tabs.Tab,
    own: chrome.tabs.Tab[],
    slot: number
  ): void => {
    if (slot < own.length) {
      tabs.splice(tabs.indexOf(own[slot]), 0, tab);
    } else if (own.length === 0) {
      tabs.push(tab);
    } else {
      tabs.splice(tabs.indexOf(own[own.length - 1]) + 1, 0, tab);
    }
    reindexWindow(tab.windowId);
  };

  // Chrome removes a group with its last tab (the reopen.ts tests already
  // rely on tabGroups.get rejecting for it), and sessions.restore brings
  // such a group back under its old id (Task 1, Q2) -- which the fake can
  // only show if the group really went.
  const dropGroupIfEmpty = (groupId: number): void => {
    if (groupId === -1 || tabs.some((tab) => tab.groupId === groupId)) return;
    const index = tabGroups.findIndex((group) => group.id === groupId);
    if (index === -1) return;
    const [gone] = tabGroups.splice(index, 1);
    tabGroupsOnRemoved.fire(gone);
  };

  // Only one window has focus, and the one that has it is what
  // windows.getLastFocused answers. A restore takes it (Task 1, Q2b: the
  // target window became focused and getLastFocused, 16/16 observable), and
  // so does windows.update({focused: true}) -- Reopen's undo refocuses the
  // window that had it before (KAN-280 Part D).
  let lastFocusedWindowId = windows.find((win) => win.focused)?.id;
  const focusWindow = (windowId: number): void => {
    for (const win of windows) win.focused = win.id === windowId;
    lastFocusedWindowId = windowId;
  };

  // The recently-closed list, newest first. Recorded whatever the grant --
  // Chrome keeps its list regardless of the extension's permission; only
  // the API calls are gated.
  const recentlyClosed: ClosedEntry[] = [];
  let nextSessionId = 1;
  // Tabs sessions.restore made, for handle.restoredFromSession. By
  // reference, so a tab closed and reopened by other means never inherits it.
  const restoredTabs = new WeakSet<chrome.tabs.Tab>();

  // Called with the tab ALREADY out of `tabs` but its group not yet
  // dropped, so the group can still be read (Task 1, Q2 needs its title and
  // colour).
  const rememberClosedTab = (tab: chrome.tabs.Tab): ClosedTab => {
    const group = tabGroups.find((g) => g.id === tab.groupId);
    return {
      sessionId: String(nextSessionId++),
      tab: { ...tab },
      group: group && {
        id: group.id,
        title: group.title,
        color: group.color,
        collapsed: group.collapsed,
      },
    };
  };
  // Task 1, Q1: the entry is there the moment the remove resolves, and at
  // most MAX_SESSION_RESULTS are kept -- the oldest drop off.
  const recordClosed = (entry: ClosedEntry): void => {
    recentlyClosed.unshift(entry);
    recentlyClosed.splice(MAX_SESSION_RESULTS);
  };
  // Task 1, Q1: lastModified is whole seconds.
  const nowInSeconds = (): number => Math.floor(Date.now() / 1000);

  // What getRecentlyClosed hands out (Task 1, Q1): no `id`, and windowId
  // and groupId always 0, grouped or not -- neither identifies anything.
  const sessionTabView = ({ sessionId, tab }: ClosedTab): chrome.tabs.Tab => {
    const view: chrome.tabs.Tab = {
      ...tab,
      windowId: 0,
      groupId: 0,
      sessionId,
    };
    delete view.id;
    return view;
  };
  const sessionView = (entry: ClosedEntry): chrome.sessions.Session => {
    if (entry.kind === 'tab') {
      return {
        lastModified: entry.lastModified,
        tab: sessionTabView(entry.closed),
      };
    }
    const view: chrome.windows.Window = {
      ...entry.window,
      sessionId: entry.sessionId,
      focused: false,
      tabs: entry.tabs.map(sessionTabView),
    };
    delete view.id;
    return { lastModified: entry.lastModified, window: view };
  };

  // Opens a window for a restore and returns its id. Unfocused here; the
  // caller focuses it once its tabs are in.
  const openRestoredWindow = (
    from: Pick<
      chrome.windows.Window,
      | 'left'
      | 'top'
      | 'width'
      | 'height'
      | 'state'
      | 'type'
      | 'incognito'
      | 'alwaysOnTop'
    >
  ): { id: number; window: chrome.windows.Window } => {
    const id = nextId++;
    const win: chrome.windows.Window = { ...from, id, focused: false };
    windows.push(win);
    return { id, window: win };
  };

  // Task 1, Q2 and Q2b. The tab returns to its old window if that is still
  // open, else to a NEW window (Q1b). It keeps its index -- except that when
  // its old group still has other tabs there, it lands at the END of that
  // group (1 -> 2, 5/5) -- its pinned state, and its group id, recreating
  // the group with the same id, title and colour if it had gone (7/7). It
  // is made active, its window takes the focus, and a collapsed group it
  // lands in is expanded (3/3). The other windows' active tabs are untouched
  // (25/25). The ORDER of the events it fires was not measured.
  //
  // A tab whose group the seed never declared (a groupId with no
  // tabGroups record) comes back with that groupId and still no record: the
  // fake repeats the seed's own gap rather than inventing a title or colour.
  const restoreTabEntry = (
    entry: Extract<ClosedEntry, { kind: 'tab' }>
  ): chrome.sessions.Session => {
    const { tab: was, group } = entry.closed;
    const stillOpen = windows.some((win) => win.id === was.windowId);
    const opened = stillOpen
      ? undefined
      : openRestoredWindow({
          type: 'normal',
          incognito: was.incognito,
          alwaysOnTop: false,
        });
    const windowId = opened?.id ?? was.windowId;

    const own = windowTabsInOrder(windowId);
    const groupMates =
      was.groupId === -1 ? [] : own.filter((t) => t.groupId === was.groupId);
    const lastMate = groupMates[groupMates.length - 1];
    const slot =
      lastMate === undefined
        ? clampSlot(own, was.index, was.pinned)
        : lastMate.index + 1;
    const created = makeTab(
      {
        url: was.url,
        title: was.title,
        favIconUrl: was.favIconUrl,
        pinned: was.pinned,
        groupId: was.groupId,
        active: true,
      },
      windowId
    );
    insertAtSlot(created, own, slot);
    for (const tab of own) tab.active = false;
    restoredTabs.add(created);
    focusWindow(windowId);

    if (opened) windowsOnCreated.fire(opened.window);
    tabsOnCreated.fire(created);
    if (group) {
      const existing = tabGroups.find((g) => g.id === group.id);
      if (!existing) {
        const recreated: chrome.tabGroups.TabGroup = {
          ...group,
          collapsed: false,
          shared: false,
          windowId,
        };
        tabGroups.push(recreated);
        tabGroupsOnCreated.fire(recreated);
      } else if (existing.collapsed) {
        existing.collapsed = false;
        tabGroupsOnUpdated.fire(existing);
      }
    }
    return { lastModified: entry.lastModified, tab: { ...created } };
  };

  // Task 1, Q2 and Q2b. A NEW window with the entry's bounds and tabs, pinned
  // kept, each group under a NEW id with the same title, colour and
  // collapsed state (9/9), and the focus. Its active tab is the one active at
  // close -- unless that tab was in a group, when tab 0 comes back active
  // instead (2/2). A tab whose group was never declared comes back
  // ungrouped: a new id needs a record to copy, and there is none.
  const restoreWindowEntry = (
    entry: Extract<ClosedEntry, { kind: 'window' }>
  ): chrome.sessions.Session => {
    // Task 1, Q2: a maximized window came back `normal` (2/2). Only
    // maximized was measured; every state comes back normal here.
    const { left, top, width, height, type, incognito, alwaysOnTop } =
      entry.window;
    const opened = openRestoredWindow({
      left,
      top,
      width,
      height,
      state: 'normal',
      type,
      incognito,
      alwaysOnTop,
    });
    const windowId = opened.id;

    const newGroups = new Map<number, chrome.tabGroups.TabGroup>();
    for (const { group } of entry.tabs) {
      if (group && !newGroups.has(group.id)) {
        newGroups.set(group.id, {
          id: nextId++,
          title: group.title,
          color: group.color,
          collapsed: group.collapsed,
          shared: false,
          windowId,
        });
      }
    }
    const activeAtClose = entry.tabs.find(({ tab }) => tab.active);
    const activeSlot =
      activeAtClose === undefined || activeAtClose.tab.groupId !== -1
        ? 0
        : entry.tabs.indexOf(activeAtClose);
    const created = entry.tabs.map(({ tab: was }, slot) => {
      const tab = makeTab(
        {
          url: was.url,
          title: was.title,
          favIconUrl: was.favIconUrl,
          pinned: was.pinned,
          groupId: newGroups.get(was.groupId)?.id ?? -1,
          active: slot === activeSlot,
        },
        windowId
      );
      tabs.push(tab);
      restoredTabs.add(tab);
      return tab;
    });
    reindexWindow(windowId);
    tabGroups.push(...newGroups.values());
    focusWindow(windowId);

    windowsOnCreated.fire(opened.window);
    for (const tab of created) tabsOnCreated.fire(tab);
    for (const group of newGroups.values()) tabGroupsOnCreated.fire(group);
    return {
      lastModified: entry.lastModified,
      window: populate(opened.window),
    };
  };

  // Task 1, Q4: after a revoke chrome.sessions stays defined, but every call
  // throws SYNCHRONOUSLY with this message -- not a rejected promise.
  const assertSessionsGranted = (method: string): void => {
    if (!granted.has('sessions')) {
      throw new Error(`'sessions.${method}' is not available in this context.`);
    }
  };

  const sessionsApi = {
    MAX_SESSION_RESULTS,
    getRecentlyClosed: (
      filter?: chrome.sessions.Filter,
      cb?: (sessions: chrome.sessions.Session[]) => void
    ) => {
      assertSessionsGranted('getRecentlyClosed');
      return settle(
        recentlyClosed
          .slice(0, filter?.maxResults ?? MAX_SESSION_RESULTS)
          .map(sessionView),
        cb
      );
    },
    restore: (
      sessionId?: string,
      cb?: (session?: chrome.sessions.Session) => void
    ) => {
      assertSessionsGranted('restore');
      // No product code calls either form below. Thrown, not rejected, so a
      // future caller that reaches for one notices at once.
      if (sessionId === undefined) {
        throw new Error(
          'sessions.restore() with no sessionId is not modelled by the chrome fake -- model it before depending on it.'
        );
      }
      if (
        recentlyClosed.some(
          (entry) =>
            entry.kind === 'window' &&
            entry.tabs.some((closed) => closed.sessionId === sessionId)
        )
      ) {
        throw new Error(
          `sessions.restore("${sessionId}") names one tab inside a window entry, which is not modelled by the chrome fake -- model it before depending on it.`
        );
      }
      // Task 1, Q3: an id that never existed, was already restored or was
      // pushed out of the list rejects with exactly this, and changes
      // nothing. Restoring consumes the entry.
      const index = recentlyClosed.findIndex((entry) =>
        entry.kind === 'tab'
          ? entry.closed.sessionId === sessionId
          : entry.sessionId === sessionId
      );
      if (index === -1) {
        return fail<chrome.sessions.Session>(
          `Invalid session id: "${sessionId}".`,
          cb
        );
      }
      const [entry] = recentlyClosed.splice(index, 1);
      return settle(
        entry.kind === 'tab'
          ? restoreTabEntry(entry)
          : restoreWindowEntry(entry),
        cb
      );
    },
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
    restoredFromSession(tabId) {
      const target = tabs.find((tab) => tab.id === tabId);
      if (!target) {
        throw new Error(`restoredFromSession: no tab with id ${tabId}`);
      }
      return restoredTabs.has(target);
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
      // Chrome's own `index` clamp (clampSlot above).
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

        const own = windowTabsInOrder(windowId);
        const want = clampSlot(own, props.index, pinned);

        // Chrome's rule for a tab inserted inside a group's run: strictly
        // between two tabs of one group, it joins that group (Chromium's
        // TabStripModel keeps a group contiguous). Measured 2026-09-24 in
        // the real browser: inside a run it joins; at the run's first slot
        // or one past its last it does not. Reopen (KAN-280, KAN-309) has to
        // undo this for a tab that was ungrouped.
        const before = own[want - 1];
        const after = own[want];
        if (
          before !== undefined &&
          after !== undefined &&
          before.groupId !== -1 &&
          before.groupId === after.groupId
        ) {
          created.groupId = before.groupId;
        }

        insertAtSlot(created, own, want);

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
          // Task 1, Q1b: a tabs.remove always leaves a TAB entry, even for
          // a window's only tab.
          recordClosed({
            kind: 'tab',
            lastModified: nowInSeconds(),
            closed: rememberClosedTab(removed),
          });
          reindexWindow(removed.windowId);
          const windowStillHasTabs = tabs.some(
            (tab) => tab.windowId === removed.windowId
          );
          tabsOnRemoved.fire(id, {
            windowId: removed.windowId,
            isWindowClosing: !windowStillHasTabs,
          });
          dropGroupIfEmpty(removed.groupId);
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
        if (!target)
          return fail<chrome.tabs.Tab>(`No tab with id: ${tabId}.`, cb);
        const { muted, ...rest } = props;
        Object.assign(target, rest);
        // A window has one front tab: activating one takes the front from
        // the rest of its window, and from no other window (Task 1, Q2b:
        // other windows' front tabs were untouched, 25/25). A tab in a
        // collapsed group expands that group to show it, as reopen.ts's
        // recreateTab relies on (KAN-310; measured 2026-09-24 for a tab
        // CREATED active, not measured for tabs.update).
        if (rest.active === true) {
          for (const tab of tabs) {
            if (tab.windowId === target.windowId && tab !== target) {
              tab.active = false;
            }
          }
          const group = tabGroups.find((g) => g.id === target.groupId);
          if (group?.collapsed) {
            group.collapsed = false;
            tabGroupsOnUpdated.fire(group);
          }
        }
        if (
          muted !== undefined &&
          muted !== (target.mutedInfo?.muted ?? false)
        ) {
          // Measured (KAN-280 O10): Chrome reports an extension's mute this way,
          // and a mute that changes nothing fires nothing.
          target.mutedInfo = {
            muted,
            reason: 'extension',
            extensionId: 'faketestid',
          };
          tabsOnUpdated.fire(tabId, { mutedInfo: target.mutedInfo }, target);
        }
        return settle(target, cb);
      },
      get: (tabId: number, cb?: (tab: chrome.tabs.Tab) => void) =>
        settle(tabs.find((tab) => tab.id === tabId) as chrome.tabs.Tab, cb),
      // One tab, within its own window (no product code moves a tab to
      // another window with this). The index is clamped the way tabs.create
      // clamps it (clampSlot), with -1 meaning the end. Afterwards the tab's
      // group follows Chromium's contiguity rule, the one tabs.create above
      // follows (measured 2026-09-24 for a create; for a move it is modelled
      // on the same rule, not measured): strictly inside another group's run
      // it joins that group; cut off from the rest of its own group it
      // leaves it.
      move: (
        tabId: number,
        props: chrome.tabs.MoveProperties,
        cb?: (tab?: chrome.tabs.Tab) => void
      ) => {
        const target = tabs.find((tab) => tab.id === tabId);
        if (!target)
          return fail<chrome.tabs.Tab>(`No tab with id: ${tabId}.`, cb);
        if (
          props.windowId !== undefined &&
          props.windowId !== target.windowId
        ) {
          throw new Error(
            'tabs.move to another window is not modelled by the chrome fake -- model it before depending on it.'
          );
        }
        const windowId = target.windowId;
        const fromIndex = target.index;
        const others = windowTabsInOrder(windowId).filter((t) => t !== target);
        const slot = clampSlot(
          others,
          props.index === -1 ? others.length : props.index,
          target.pinned
        );
        tabs.splice(tabs.indexOf(target), 1);
        insertAtSlot(target, others, slot);

        const left = others[slot - 1];
        const right = others[slot];
        const own = target.groupId;
        if (own !== left?.groupId && own !== right?.groupId) {
          if (
            left !== undefined &&
            right !== undefined &&
            left.groupId !== -1 &&
            left.groupId === right.groupId
          ) {
            target.groupId = left.groupId;
            dropGroupIfEmpty(own);
          } else if (own !== -1 && others.some((t) => t.groupId === own)) {
            target.groupId = -1;
          }
        }

        if (target.index !== fromIndex) {
          tabsOnMoved.fire(tabId, {
            windowId,
            fromIndex,
            toIndex: target.index,
          });
        }
        return settle(target, cb);
      },
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
      // Every id is checked before any tab changes; an unknown one rejects
      // (or, with a callback, sets lastError) and leaves every tab as it
      // was. Only `groupId` changes: real Chrome also moves a tab ungrouped
      // from inside a run out of it (measured 2026-09-24: from between the
      // run's two tabs to just after them), which this fake does not model
      // (KAN-309).
      ungroup: (tabIds: number | number[], cb?: () => void) => {
        const idList = Array.isArray(tabIds) ? tabIds : [tabIds];
        const unknown = idList.find((id) => !tabs.some((tab) => tab.id === id));
        if (unknown !== undefined) {
          return fail<void>(`No tab with id: ${unknown}.`, cb);
        }
        for (const tab of tabs) {
          if (tab.id !== undefined && idList.includes(tab.id)) tab.groupId = -1;
        }
        return settle(undefined, cb);
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
      // (KAN-280 O8). Only the FIRST tab is made active, matching a real
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
      // BEFORE windows.onRemoved, matching real Chrome (KAN-280 O8).
      remove: (windowId: number, cb?: () => void) => {
        handle.removedWindowIds.push(windowId);
        const index = windows.findIndex((win) => win.id === windowId);
        if (index === -1) {
          return fail<void>(`No window with id: ${windowId}.`, cb);
        }
        const [closing] = windows.splice(index, 1);
        const closingTabs = windowTabsInOrder(windowId);
        for (const tab of closingTabs) {
          const tabIndex = tabs.indexOf(tab);
          if (tabIndex !== -1) tabs.splice(tabIndex, 1);
        }
        // Task 1, Q1b: a windows.remove always leaves a WINDOW entry, even
        // for a one-tab window, and each tab in it gets its own sessionId.
        // Read before dropGroupIfEmpty below, while the groups still exist.
        recordClosed({
          kind: 'window',
          lastModified: nowInSeconds(),
          sessionId: String(nextSessionId++),
          window: { ...closing },
          tabs: closingTabs.map(rememberClosedTab),
        });
        for (const tab of closingTabs) {
          if (tab.id !== undefined) {
            tabsOnRemoved.fire(tab.id, { windowId, isWindowClosing: true });
          }
        }
        for (const tab of closingTabs) dropGroupIfEmpty(tab.groupId);
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
        const { focused, ...rest } = props;
        Object.assign(target, rest);
        // Focusing one window unfocuses every other (focusWindow above).
        // `focused: false` is only recorded: Chrome would hand the focus to
        // another window, and no product code sends it.
        if (focused === true) focusWindow(windowId);
        else if (focused === false) target.focused = false;
        return settle(target, cb);
      },
      // The window focusWindow last focused; if that one has closed, the
      // first window still open (Chrome picks the next most recent, which
      // the fake does not track).
      getLastFocused: (
        info?: chrome.windows.QueryOptions,
        cb?: (win?: chrome.windows.Window) => void
      ) => {
        const target =
          windows.find((win) => win.id === lastFocusedWindowId) ?? windows[0];
        if (!target) {
          return fail<chrome.windows.Window>('No last-focused window', cb);
        }
        return settle(info?.populate ? populate(target) : { ...target }, cb);
      },
      onCreated: windowsOnCreated,
      onRemoved: windowsOnRemoved,
    },

    runtime: {
      // The id an extension mute stamps onto mutedInfo.extensionId
      // (KAN-280 O10), and what getURL already builds its path on.
      id: 'faketestid',
      // Delivered to every onMessage listener, as the service worker's are
      // (KAN-280 Part D: Reopen asks the worker and reads its answer). A
      // listener that answers with sendResponse settles the call with that
      // answer; one that returns true keeps it open until it does. When no
      // listener does either, it settles undefined (the fake's choice:
      // Chrome's answer there was not measured, and no product code relies on
      // it). With no listener at all it resolves undefined, as this fake
      // always has --
      // Chrome would reject ("Could not establish connection. Receiving end
      // does not exist."), but the existing callers send without a listener
      // and without catching, and a rejection there would fail their tests
      // for a reason that is not theirs. A test of the rejection stubs it.
      sendMessage: (message: unknown, cb?: (response: unknown) => void) => {
        handle.sentMessages.push(message);
        if (messageListeners.size === 0) return settle(undefined, cb);
        return new Promise<unknown>((resolve) => {
          let answered = false;
          const sendResponse = (response?: unknown) => {
            if (answered) return;
            answered = true;
            cb?.(response);
            resolve(response);
          };
          let keptOpen = false;
          for (const listener of [...messageListeners]) {
            if (
              listener(message, { id: 'faketestid' }, sendResponse) === true
            ) {
              keptOpen = true;
            }
          }
          if (!keptOpen) sendResponse(undefined);
        });
      },
      onMessage: {
        addListener: (listener: MessageListener) =>
          void messageListeners.add(listener),
        removeListener: (listener: MessageListener) =>
          void messageListeners.delete(listener),
        hasListener: (listener: MessageListener) =>
          messageListeners.has(listener),
      },
      getURL: (path: string) => `chrome-extension://faketestid/${path}`,
      getPlatformInfo: (cb?: (info: chrome.runtime.PlatformInfo) => void) =>
        settle<chrome.runtime.PlatformInfo>(
          { os: seed.platformOs ?? 'linux', arch: 'x86-64' },
          cb
        ),
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

    // Task 1, Q4: undefined until `sessions` is first granted -- the member
    // is missing, like tabGroups above. A grant later in the test adds it to
    // this same object (see permissions.request); a revoke never takes it
    // away (assertSessionsGranted above).
    ...(granted.has('sessions') ? { sessions: sessionsApi } : {}),

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
        // Task 1, Q4: a grant makes chrome.sessions usable in the SAME page
        // with no reload. Added before onAdded fires, so a listener can use
        // it (that ordering is this fake's choice; Task 1 did not measure it).
        if (granted.has('sessions')) {
          Object.assign(chromeFake, { sessions: sessionsApi });
        }
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
