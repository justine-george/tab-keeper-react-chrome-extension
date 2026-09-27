import { afterEach, describe, expect, test, vi } from 'vitest';

import { toOpenWindows } from '../../../utils/functions/openNow';
import type { OpenTab, OpenWindow } from '../../../utils/functions/openNow';
import {
  closeOpenTab,
  closeOpenWindow,
  isReopenWithHistoryRequest,
  recreateClosed,
  REOPEN_WITH_HISTORY_MESSAGE,
  reopenClosed,
  reopenWithHistory,
} from '../../../utils/functions/reopen';
import type { ClosedItem, Reopened } from '../../../utils/functions/reopen';
import { setupChromeFake } from '../../setup/chrome.fake';
import type { ChromeFakeHandle, ChromeSeed } from '../../setup/chrome.fake';

// KAN-280 Part D, Task 6. With `sessions` held, Reopen brings a closed tab or
// window back through chrome.sessions.restore, so its Back/Forward history
// comes back. Chrome's restore also activates the tab, focuses its window,
// expands a collapsed group it lands in and puts it at the END of a group
// that still has tabs (Task 1, Q2/Q2b). The settled behaviour (Justine,
// 2026-09-27, B) is that everything else ends up EXACTLY as today's recreate
// leaves it -- so the contract here is equivalence: the same seed, reopened
// both ways, ends in the same state.

let handle: ChromeFakeHandle | undefined;

afterEach(() => {
  handle?.restore();
  handle = undefined;
  vi.restoreAllMocks();
});

const url = (name: string) => `https://${name}.test/`;
const TAB_VIEW_URL = 'chrome-extension://faketestid/index.html';

async function openWindow(id: number): Promise<OpenWindow> {
  const all = await chrome.windows.getAll({
    populate: true,
    windowTypes: ['normal'],
  });
  const groups = chrome.tabGroups ? await chrome.tabGroups.query({}) : null;
  const found = toOpenWindows(all, groups, null).find((w) => w.id === id);
  if (!found) throw new Error(`no open window ${id}`);
  return found;
}

function tabIn(openWin: OpenWindow, name: string): OpenTab {
  const found = openWin.tabs.find((tab) => tab.url === url(name));
  if (!found) throw new Error(`no tab ${name} in window ${openWin.id}`);
  return found;
}

async function tabIdNamed(name: string): Promise<number> {
  const found = (await chrome.tabs.query({})).find((t) => t.url === url(name));
  if (found?.id === undefined) throw new Error(`no tab ${name}`);
  return found.id;
}

async function closeTab(windowId: number, name: string) {
  const openWin = await openWindow(windowId);
  return closeOpenTab(openWin, tabIn(openWin, name));
}

async function closeWindow(windowId: number) {
  return closeOpenWindow(await openWindow(windowId));
}

// Everything Reopen could change, with ids left out: a restore and a
// recreate hand out different ids, so windows are named by their order and
// groups by what they show.
async function describeWorld() {
  const all = await chrome.windows.getAll({ populate: true });
  const lastFocused = await chrome.windows.getLastFocused();
  const groups = await chrome.tabGroups.query({});
  const groupOf = (groupId: number) => {
    if (groupId === -1) return null;
    const group = groups.find((g) => g.id === groupId);
    return group
      ? { title: group.title, color: group.color, collapsed: group.collapsed }
      : 'undeclared';
  };
  return {
    lastFocused: all.findIndex((w) => w.id === lastFocused.id),
    windows: all.map((w) => ({
      focused: w.focused,
      bounds: [w.left, w.top, w.width, w.height],
      state: w.state,
      tabs: (w.tabs ?? [])
        .sort((a, b) => a.index - b.index)
        .map((t) => ({
          url: t.url,
          active: t.active,
          pinned: t.pinned,
          group: groupOf(t.groupId),
        })),
    })),
  };
}

// Whether what came back came through chrome.sessions (Task 2's marker for
// history.length): a tab, or every tab of a window.
async function cameBackWithHistory(
  fake: ChromeFakeHandle,
  reopened: Reopened
): Promise<boolean> {
  if (reopened.kind === 'tab') return fake.restoredFromSession(reopened.tabId);
  const tabs = await chrome.tabs.query({ windowId: reopened.windowId });
  return (
    tabs.length > 0 &&
    tabs.every((t) => t.id !== undefined && fake.restoredFromSession(t.id))
  );
}

type Scenario = {
  seed: ChromeSeed;
  close: () => Promise<ClosedItem | null>;
  // What the user does between the close and the Reopen.
  between?: (fake: ChromeFakeHandle) => Promise<void>;
};

// Runs one scenario, reopening one way, in a fake of its own.
async function run(
  scenario: Scenario,
  reopen: (item: ClosedItem) => Promise<Reopened | null>
) {
  const fake = setupChromeFake(scenario.seed);
  handle = fake;
  try {
    const item = await scenario.close();
    if (!item) throw new Error('close failed');
    await scenario.between?.(fake);
    const focusedBefore = (await chrome.windows.getLastFocused()).id;
    const reopened = await reopen(item);
    if (!reopened) throw new Error('nothing came back');
    return {
      item,
      focusedBefore,
      focusedAfter: (await chrome.windows.getLastFocused()).id,
      world: await describeWorld(),
      withHistory: await cameBackWithHistory(fake, reopened),
    };
  } finally {
    fake.restore();
    handle = undefined;
  }
}

const GRANTED: ChromeSeed['grantedPermissions'] = ['sessions', 'tabGroups'];

// Window 1 is where Reopen was pressed: focused, Tab Keeper's tab view in
// front.
const tabViewWindow = {
  id: 1,
  focused: true,
  tabs: [{ url: TAB_VIEW_URL, active: true }, { url: url('home') }],
};

const scenarios: Record<string, Scenario> = {
  "a tab back into the tab view's own window": {
    seed: {
      grantedPermissions: GRANTED,
      windows: [
        {
          id: 1,
          focused: true,
          tabs: [
            { url: TAB_VIEW_URL, active: true },
            { url: url('a') },
            { url: url('b') },
            { url: url('c') },
          ],
        },
        { id: 2, tabs: [{ url: url('x'), active: true }] },
      ],
    },
    close: () => closeTab(1, 'b'),
  },

  'a tab back into another window': {
    seed: {
      grantedPermissions: GRANTED,
      windows: [
        tabViewWindow,
        {
          id: 2,
          tabs: [
            { url: url('a'), active: true },
            { url: url('b') },
            { url: url('c') },
          ],
        },
      ],
    },
    close: () => closeTab(2, 'b'),
  },

  // The group was collapsed after the close: recreate rejoins it and leaves
  // it as it is NOW, not as the snapshot had it.
  'a background tab back into a group collapsed since the close': {
    seed: {
      grantedPermissions: GRANTED,
      windows: [
        tabViewWindow,
        {
          id: 2,
          tabs: [
            { url: url('z'), active: true },
            { url: url('a'), groupId: 50 },
            { url: url('b'), groupId: 50 },
            { url: url('c'), groupId: 50 },
          ],
        },
      ],
      tabGroups: [{ id: 50, windowId: 2, title: 'Kyoto', color: 'blue' }],
    },
    close: () => closeTab(2, 'b'),
    between: async (fake) => fake.browser.setGroup(50, { collapsed: true }),
  },

  'a background tab back into a group that was collapsed all along': {
    seed: {
      grantedPermissions: GRANTED,
      windows: [
        tabViewWindow,
        {
          id: 2,
          tabs: [
            { url: url('z'), active: true },
            { url: url('a'), groupId: 50 },
            { url: url('b'), groupId: 50 },
            { url: url('c'), groupId: 50 },
          ],
        },
      ],
      tabGroups: [
        {
          id: 50,
          windowId: 2,
          title: 'Kyoto',
          color: 'blue',
          collapsed: true,
        },
      ],
    },
    close: () => closeTab(2, 'b'),
  },

  // Its group went with it; recreate makes a new one, collapsed as the
  // snapshot had it.
  'a background tab whose collapsed group went with it': {
    seed: {
      grantedPermissions: GRANTED,
      windows: [
        tabViewWindow,
        {
          id: 2,
          tabs: [
            { url: url('z'), active: true },
            { url: url('b'), groupId: 60 },
            { url: url('c') },
          ],
        },
      ],
      tabGroups: [
        { id: 60, windowId: 2, title: 'Solo', color: 'red', collapsed: true },
      ],
    },
    close: () => closeTab(2, 'b'),
  },

  // Recreate brings a front tab to the front, which expands its group.
  'a tab that was in front, back into a group collapsed since': {
    seed: {
      grantedPermissions: GRANTED,
      windows: [
        tabViewWindow,
        {
          id: 2,
          tabs: [
            { url: url('a'), groupId: 50 },
            { url: url('x'), groupId: 50, active: true },
            { url: url('b'), groupId: 50 },
            { url: url('z') },
          ],
        },
      ],
      tabGroups: [{ id: 50, windowId: 2, title: 'Kyoto', color: 'green' }],
    },
    close: () => closeTab(2, 'x'),
    between: async (fake) => {
      fake.browser.activateTab(await tabIdNamed('z'));
      fake.browser.setGroup(50, { collapsed: true });
    },
  },

  'a tab that was in front, in a window with a pinned tab': {
    seed: {
      grantedPermissions: GRANTED,
      windows: [
        tabViewWindow,
        {
          id: 2,
          tabs: [
            { url: url('p'), pinned: true },
            { url: url('a'), active: true },
            { url: url('b') },
            { url: url('c') },
          ],
        },
      ],
    },
    close: () => closeTab(2, 'a'),
    between: async (fake) => fake.browser.activateTab(await tabIdNamed('c')),
  },

  // A group formed over its spot since the close. Chrome puts a tab strictly
  // inside a group's run into that group; recreate takes it back out
  // (KAN-309), and so must the undo after its move.
  'an ungrouped tab whose spot is now inside a group': {
    seed: {
      grantedPermissions: GRANTED,
      windows: [
        tabViewWindow,
        {
          id: 2,
          tabs: [
            { url: url('a'), active: true },
            { url: url('x') },
            { url: url('b') },
            { url: url('z') },
          ],
        },
      ],
    },
    close: () => closeTab(2, 'x'),
    between: async () => {
      const group = await chrome.tabs.group({
        createProperties: { windowId: 2 },
        tabIds: [await tabIdNamed('a'), await tabIdNamed('b')],
      });
      await chrome.tabGroups.update(group, { title: 'Over', color: 'pink' });
    },
  },

  // Its group now starts after its spot: moved back there, the tab is cut
  // off from the group and leaves it, so it has to rejoin.
  'a grouped tab whose spot is now outside its group': {
    seed: {
      grantedPermissions: GRANTED,
      windows: [
        tabViewWindow,
        {
          id: 2,
          tabs: [
            { url: url('a'), groupId: 50 },
            { url: url('b'), groupId: 50 },
            { url: url('c'), active: true },
            { url: url('d') },
          ],
        },
      ],
      tabGroups: [{ id: 50, windowId: 2, title: 'Kyoto', color: 'blue' }],
    },
    close: () => closeTab(2, 'a'),
    between: async () => {
      await chrome.tabs.move(await tabIdNamed('c'), { index: 0 });
    },
  },

  // Task 1, Q1b: the entry is a TAB entry, and it restores into a new window.
  "a window's only tab, whose window went with it": {
    seed: {
      grantedPermissions: GRANTED,
      windows: [
        tabViewWindow,
        {
          id: 2,
          left: 40,
          top: 30,
          width: 900,
          height: 700,
          tabs: [{ url: url('solo'), active: true, groupId: 70 }],
        },
      ],
      tabGroups: [{ id: 70, windowId: 2, title: 'Alone', color: 'cyan' }],
    },
    close: () => closeTab(2, 'solo'),
  },

  "a maximized window's only tab": {
    seed: {
      grantedPermissions: GRANTED,
      windows: [
        tabViewWindow,
        {
          id: 2,
          left: 0,
          top: 0,
          width: 1920,
          height: 1080,
          state: 'maximized',
          tabs: [{ url: url('solo'), active: true }],
        },
      ],
    },
    close: () => closeTab(2, 'solo'),
  },

  'a window whose active tab was in a group': {
    seed: {
      grantedPermissions: GRANTED,
      windows: [
        tabViewWindow,
        {
          id: 2,
          left: 100,
          top: 80,
          width: 700,
          height: 500,
          tabs: [
            { url: url('p'), pinned: true },
            { url: url('a'), groupId: 50, active: true },
            { url: url('b'), groupId: 50 },
            { url: url('c'), groupId: 51 },
            { url: url('d') },
          ],
        },
      ],
      tabGroups: [
        { id: 50, windowId: 2, title: 'Kyoto', color: 'blue' },
        { id: 51, windowId: 2, title: 'Later', color: 'red', collapsed: true },
      ],
    },
    close: () => closeWindow(2),
  },

  // The restore brings tab 0 to the front, which expands its collapsed
  // group; recreate collapses each group last, as the snapshot had it.
  'a window whose first tab sits in a collapsed group': {
    seed: {
      grantedPermissions: GRANTED,
      windows: [
        tabViewWindow,
        {
          id: 2,
          left: 100,
          top: 80,
          width: 700,
          height: 500,
          tabs: [
            { url: url('x'), groupId: 51 },
            { url: url('y'), groupId: 51 },
            { url: url('a'), groupId: 50, active: true },
            { url: url('b') },
          ],
        },
      ],
      tabGroups: [
        { id: 50, windowId: 2, title: 'Now', color: 'blue' },
        { id: 51, windowId: 2, title: 'Later', color: 'red', collapsed: true },
      ],
    },
    close: () => closeWindow(2),
  },

  'a maximized window': {
    seed: {
      grantedPermissions: GRANTED,
      windows: [
        tabViewWindow,
        {
          id: 2,
          left: 0,
          top: 0,
          width: 1920,
          height: 1080,
          state: 'maximized',
          tabs: [{ url: url('a') }, { url: url('b'), active: true }],
        },
      ],
    },
    close: () => closeWindow(2),
  },
};

describe('reopenWithHistory ends exactly where recreate does (KAN-280 Part D)', () => {
  test.each(Object.entries(scenarios))('%s', async (_name, scenario) => {
    const history = await run(scenario, reopenWithHistory);
    const recreated = await run(scenario, recreateClosed);

    // PREMISE: the close recorded Chrome's entry, so the history path had
    // something to restore.
    expect(history.item.restorableSessionId).toEqual(expect.any(String));
    expect(history.world).toEqual(recreated.world);
    expect(history.withHistory).toBe(true);
    expect(recreated.withHistory).toBe(false);
  });

  test.each(Object.entries(scenarios))(
    '%s: the window focused before is focused after',
    async (_name, scenario) => {
      const history = await run(scenario, reopenWithHistory);

      expect(history.focusedAfter).toBe(history.focusedBefore);
      const focused = history.world.windows.filter((w) => w.focused);
      expect(focused).toHaveLength(1);
    }
  );
});

describe('the undo refocuses first (KAN-280 Part D)', () => {
  // Measured (headed probe, 2026-09-27): refocusing FIRST gave today's end
  // state 12/12 with a ~35 ms flash; refocusing last lengthens the flash.
  test('the window focused before is refocused right after the restore, before any other step', async () => {
    handle = setupChromeFake(
      scenarios['a background tab back into a group collapsed since the close']
        .seed
    );
    const item = await closeTab(2, 'b');
    if (!item) throw new Error('close failed');
    handle.browser.setGroup(50, { collapsed: true });
    const restore = vi.spyOn(chrome.sessions, 'restore');
    const windowUpdate = vi.spyOn(chrome.windows, 'update');
    const steps = [
      vi.spyOn(chrome.tabs, 'update'),
      vi.spyOn(chrome.tabs, 'move'),
      vi.spyOn(chrome.tabGroups, 'update'),
    ];

    expect(await reopenWithHistory(item)).toMatchObject({ kind: 'tab' });

    expect(windowUpdate).toHaveBeenCalledWith(1, { focused: true });
    const [refocus] = windowUpdate.mock.invocationCallOrder;
    expect(refocus).toBeGreaterThan(restore.mock.invocationCallOrder[0]);
    // PREMISE: every other step ran, so "before them" means something.
    for (const step of steps) expect(step).toHaveBeenCalled();
    for (const step of steps) {
      expect(Math.min(...step.mock.invocationCallOrder)).toBeGreaterThan(
        refocus
      );
    }
  });
});

describe('the undo refocuses first for a window too (KAN-280 Part D)', () => {
  test('the first window update is the refocus, before the front tab, groups, bounds and state', async () => {
    handle = setupChromeFake(
      scenarios['a window whose first tab sits in a collapsed group'].seed
    );
    const item = await closeWindow(2);
    if (!item) throw new Error('close failed');
    const windowUpdate = vi.spyOn(chrome.windows, 'update');
    const steps = [
      vi.spyOn(chrome.tabs, 'update'),
      vi.spyOn(chrome.tabGroups, 'update'),
    ];

    expect(await reopenWithHistory(item)).toMatchObject({ kind: 'window' });

    // PREMISE: the bounds went back too, through a second window update.
    expect(windowUpdate.mock.calls).toEqual([
      [1, { focused: true }],
      [expect.any(Number), { left: 100, top: 80, width: 700, height: 500 }],
    ]);
    const [refocus] = windowUpdate.mock.invocationCallOrder;
    for (const step of steps) expect(step).toHaveBeenCalled();
    for (const step of steps) {
      expect(Math.min(...step.mock.invocationCallOrder)).toBeGreaterThan(
        refocus
      );
    }
  });
});

describe('reopenWithHistory falls back to recreate (KAN-280 Part D)', () => {
  const seed: ChromeSeed = {
    grantedPermissions: GRANTED,
    windows: [
      tabViewWindow,
      {
        id: 2,
        tabs: [
          { url: url('a'), active: true },
          { url: url('b') },
          { url: url('c') },
        ],
      },
    ],
  };

  const tabsAt = async (address: string) =>
    (await chrome.tabs.query({})).filter((t) => t.url === address);

  test('a spent id (restored already, as Ctrl+Shift+T does) recreates', async () => {
    handle = setupChromeFake(seed);
    const item = await closeTab(2, 'b');
    if (!item?.restorableSessionId) throw new Error('no id recorded');
    await chrome.sessions.restore(item.restorableSessionId);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const reopened = await reopenWithHistory(item);

    if (reopened?.kind !== 'tab') throw new Error('no tab came back');
    expect(handle.restoredFromSession(reopened.tabId)).toBe(false);
    expect(handle.createdTabs).toEqual([
      expect.objectContaining({ url: url('b'), active: false }),
    ]);
    expect(await tabsAt(url('b'))).toHaveLength(2);
    expect(warn).toHaveBeenCalled();
  });

  test('a restore that throws at once (revoked mid-way) recreates', async () => {
    handle = setupChromeFake(seed);
    const item = await closeTab(2, 'b');
    if (!item) throw new Error('close failed');
    vi.spyOn(chrome.sessions, 'restore').mockImplementation(() => {
      throw new Error("'sessions.restore' is not available in this context.");
    });
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const reopened = await reopenWithHistory(item);

    if (reopened?.kind !== 'tab') throw new Error('no tab came back');
    expect(handle.restoredFromSession(reopened.tabId)).toBe(false);
    expect(await tabsAt(url('b'))).toHaveLength(1);
  });

  test('an id with the grant gone recreates without calling restore', async () => {
    handle = setupChromeFake(seed);
    const item = await closeTab(2, 'b');
    if (!item?.restorableSessionId) throw new Error('no id recorded');
    await chrome.permissions.remove({ permissions: ['sessions'] });
    // PREMISE: chrome.sessions is still there after a revoke (Task 1, Q4).
    expect(chrome.sessions).toBeDefined();
    const restore = vi.spyOn(chrome.sessions, 'restore');

    const reopened = await reopenWithHistory(item);

    if (reopened?.kind !== 'tab') throw new Error('no tab came back');
    expect(restore).not.toHaveBeenCalled();
    expect(handle.restoredFromSession(reopened.tabId)).toBe(false);
    expect(await tabsAt(url('b'))).toHaveLength(1);
  });

  test('a null id recreates without calling restore', async () => {
    handle = setupChromeFake(seed);
    const item = await closeTab(2, 'b');
    if (!item) throw new Error('close failed');
    const restore = vi.spyOn(chrome.sessions, 'restore');

    const reopened = await reopenWithHistory({
      ...item,
      restorableSessionId: null,
    });

    expect(reopened).toMatchObject({ kind: 'tab' });
    expect(restore).not.toHaveBeenCalled();
  });

  test('CONTROL: with the grant and a live id, it restores and recreates nothing', async () => {
    handle = setupChromeFake(seed);
    const item = await closeTab(2, 'b');
    if (!item) throw new Error('close failed');

    const reopened = await reopenWithHistory(item);

    if (reopened?.kind !== 'tab') throw new Error('no tab came back');
    expect(handle.restoredFromSession(reopened.tabId)).toBe(true);
    expect(handle.createdTabs).toEqual([]);
    expect(await tabsAt(url('b'))).toHaveLength(1);
  });

  test('a cosmetic step that fails still reopens, with a warning', async () => {
    handle = setupChromeFake(seed);
    const item = await closeTab(2, 'b');
    if (!item) throw new Error('close failed');
    vi.spyOn(chrome.tabs, 'move').mockRejectedValue(
      new Error('Tabs cannot be edited right now.')
    );
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const reopened = await reopenWithHistory(item);

    if (reopened?.kind !== 'tab') throw new Error('no tab came back');
    expect(handle.restoredFromSession(reopened.tabId)).toBe(true);
    expect(handle.createdTabs).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe('the request the page sends the worker (KAN-280 Part D)', () => {
  const seed: ChromeSeed = {
    grantedPermissions: GRANTED,
    windows: [
      tabViewWindow,
      {
        id: 2,
        left: 10,
        top: 20,
        width: 800,
        height: 600,
        tabs: [{ url: url('a'), active: true, groupId: 50 }, { url: url('b') }],
      },
    ],
    tabGroups: [{ id: 50, windowId: 2, title: 'Kyoto', color: 'blue' }],
  };

  // What arrives in the worker is a structured clone of what was sent.
  const asReceived = (value: unknown): unknown => structuredClone(value);

  test('accepts a real tab item and a real window item as they arrive', async () => {
    handle = setupChromeFake(seed);
    const tab = await closeTab(2, 'b');
    const win = await closeWindow(2);

    for (const item of [tab, win]) {
      expect(
        isReopenWithHistoryRequest(
          asReceived({ type: REOPEN_WITH_HISTORY_MESSAGE, item })
        )
      ).toBe(true);
    }
  });

  test('rejects anything malformed', async () => {
    handle = setupChromeFake(seed);
    const item = await closeTab(2, 'b');
    if (item?.kind !== 'tab') throw new Error('close failed');
    const type = REOPEN_WITH_HISTORY_MESSAGE;

    for (const message of [
      null,
      undefined,
      'reopenWithHistory',
      { type },
      { type: 'restoreSession', item },
      { type, item: null },
      { type, item: { ...item, kind: 'group' } },
      { type, item: { ...item, restorableSessionId: 7 } },
      { type, item: { ...item, tab: undefined } },
      { type, item: { ...item, tab: { ...item.tab, index: '2' } } },
      { type, item: { ...item, tab: { ...item.tab, url: 1 } } },
      { type, item: { ...item, group: 'none' } },
      { type, item: { ...item, window: { ...item.window, tabs: 'x' } } },
      { type, item: { ...item, window: { ...item.window, groups: {} } } },
      { type, item: { ...item, window: { ...item.window, id: '2' } } },
      {
        type,
        item: { ...item, window: { ...item.window, tabs: [{ url: 'x' }] } },
      },
    ]) {
      expect(isReopenWithHistoryRequest(asReceived(message))).toBe(false);
    }
  });
});

// The worker's side: background.ts answers the request with what came back.
// Loaded fresh against each test's fake, as Chrome starts the worker.
async function startWorker(): Promise<void> {
  vi.resetModules();
  await import('../../../background');
}

describe('the service worker answers the request (KAN-280 Part D)', () => {
  const seed: ChromeSeed = {
    grantedPermissions: GRANTED,
    windows: [
      tabViewWindow,
      { id: 2, tabs: [{ url: url('a'), active: true }, { url: url('b') }] },
    ],
  };

  test('with the ids of what it restored', async () => {
    handle = setupChromeFake(seed);
    await startWorker();
    const item = await closeTab(2, 'b');

    const answer = await chrome.runtime.sendMessage({
      type: REOPEN_WITH_HISTORY_MESSAGE,
      item,
    });

    const b = await tabIdNamed('b');
    expect(answer).toEqual({ kind: 'tab', tabId: b });
    expect(handle.restoredFromSession(b)).toBe(true);
  });

  test('a malformed request gets no answer and reopens nothing', async () => {
    handle = setupChromeFake(seed);
    await startWorker();
    const item = await closeTab(2, 'b');

    const answer = await chrome.runtime.sendMessage({
      type: REOPEN_WITH_HISTORY_MESSAGE,
      item: { ...item, kind: 'group' },
    });

    expect(answer).toBeUndefined();
    expect(
      (await chrome.tabs.query({})).filter((t) => t.url === url('b'))
    ).toEqual([]);
  });
});

describe('reopenClosed, the page side (KAN-280 Part D)', () => {
  const seed = (granted: ChromeSeed['grantedPermissions']): ChromeSeed => ({
    grantedPermissions: granted,
    windows: [
      tabViewWindow,
      { id: 2, tabs: [{ url: url('a'), active: true }, { url: url('b') }] },
    ],
  });

  const tabsAt = async (address: string) =>
    (await chrome.tabs.query({})).filter((t) => t.url === address);

  test('with an id, the worker restores it and the page takes its answer', async () => {
    handle = setupChromeFake(seed(GRANTED));
    await startWorker();
    const item = await closeTab(2, 'b');
    if (!item) throw new Error('close failed');

    const reopened = await reopenClosed(item);

    const b = await tabIdNamed('b');
    expect(reopened).toEqual({ kind: 'tab', tabId: b });
    expect(handle.sentMessages).toEqual([
      { type: REOPEN_WITH_HISTORY_MESSAGE, item },
    ]);
    expect(handle.restoredFromSession(b)).toBe(true);
    // Never a second, local recreate after a restore that ran.
    expect(handle.createdTabs).toEqual([]);
    expect(await tabsAt(url('b'))).toHaveLength(1);
  });

  test('with no id, no message is sent and it recreates as today', async () => {
    handle = setupChromeFake(seed(['tabGroups']));
    await startWorker();
    const item = await closeTab(2, 'b');
    if (!item) throw new Error('close failed');
    // PREMISE: without `sessions` the close recorded no id.
    expect(item.restorableSessionId).toBeNull();

    const reopened = await reopenClosed(item);

    const b = await tabIdNamed('b');
    expect(reopened).toEqual({ kind: 'tab', tabId: b });
    expect(handle.sentMessages).toEqual([]);
    expect(handle.createdTabs).toEqual([
      expect.objectContaining({ url: url('b'), active: false }),
    ]);
  });

  test('when the message cannot be delivered, the page recreates it, once', async () => {
    handle = setupChromeFake(seed(GRANTED));
    const item = await closeTab(2, 'b');
    if (!item) throw new Error('close failed');
    vi.spyOn(chrome.runtime, 'sendMessage').mockRejectedValue(
      new Error('Could not establish connection. Receiving end does not exist.')
    );
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const reopened = await reopenClosed(item);

    if (reopened?.kind !== 'tab') throw new Error('no tab came back');
    expect(handle.restoredFromSession(reopened.tabId)).toBe(false);
    expect(handle.createdTabs).toEqual([
      expect.objectContaining({ url: url('b') }),
    ]);
    expect(await tabsAt(url('b'))).toHaveLength(1);
  });

  // A stand-in worker that answers every message with `answer`.
  const workerAnswering = (answer: unknown) =>
    chrome.runtime.onMessage.addListener((_message, _sender, sendResponse) => {
      sendResponse(answer);
    });

  test('the worker answering null reopens nothing more in the page', async () => {
    handle = setupChromeFake(seed(GRANTED));
    const item = await closeTab(2, 'b');
    if (!item) throw new Error('close failed');
    workerAnswering(null);

    expect(await reopenClosed(item)).toBeNull();
    expect(handle.createdTabs).toEqual([]);
  });

  test('an answer that is not a Reopened is read as nothing, with no local recreate', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const answer of [undefined, 'tab', { kind: 'tab', tabId: '5' }]) {
      handle = setupChromeFake(seed(GRANTED));
      const item = await closeTab(2, 'b');
      if (!item) throw new Error('close failed');
      workerAnswering(answer);

      expect(await reopenClosed(item)).toBeNull();
      expect(handle.createdTabs).toEqual([]);
      handle.restore();
    }
    handle = undefined;
    expect(warn).toHaveBeenCalledTimes(3);
  });
});
