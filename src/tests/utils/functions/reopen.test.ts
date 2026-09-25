import { afterEach, describe, expect, test, vi } from 'vitest';

import { placeholderTarget } from '../../../utils/functions/local';
import { toOpenWindows } from '../../../utils/functions/openNow';
import type { OpenTab, OpenWindow } from '../../../utils/functions/openNow';
import {
  closeOpenTab,
  closeOpenWindow,
  reopenClosed,
} from '../../../utils/functions/reopen';
import { setupChromeFake } from '../../setup/chrome.fake';
import type { ChromeFakeHandle } from '../../setup/chrome.fake';

let handle: ChromeFakeHandle | undefined;

afterEach(() => {
  handle?.restore();
  handle = undefined;
  vi.restoreAllMocks();
});

// Every tab here gets a real-looking address, so the straight-load check
// (KAN-280 rule 7) compares against a url a placeholder could have wrapped.
const url = (name: string) => `https://${name}.test/`;

// Tab Keeper's own window: focused, and it has to stay the only focused one
// after any reopen (rule 5).
const tabKeeperWindow = {
  id: 1,
  focused: true,
  tabs: [{ url: url('home'), active: true }],
};

// The snapshot is always read through toOpenWindows off the fake, never
// hand-built, so every shape here is one the real read produces.
async function snapshot(thisWindowId: number | null = null) {
  const all = await chrome.windows.getAll({
    populate: true,
    windowTypes: ['normal'],
  });
  const groups = chrome.tabGroups ? await chrome.tabGroups.query({}) : null;
  return toOpenWindows(all, groups, thisWindowId);
}

async function openWindow(id: number): Promise<OpenWindow> {
  const found = (await snapshot()).find((w) => w.id === id);
  if (!found) throw new Error(`no open window ${id}`);
  return found;
}

function tabIn(openWin: OpenWindow, name: string): OpenTab {
  const found = openWin.tabs.find((tab) => tab.url === url(name));
  if (!found) throw new Error(`no tab ${name} in window ${openWin.id}`);
  return found;
}

// A window's tabs in Chrome's order, by short name: `*` marks the active
// tab, `(pin)` a pinned one.
const shape = async (windowId: number) =>
  (await chrome.tabs.query({ windowId }))
    .sort((a, b) => a.index - b.index)
    .map(
      (t) =>
        `${(t.url ?? '').replace('https://', '').replace('.test/', '')}${
          t.active ? '*' : ''
        }${t.pinned ? '(pin)' : ''}`
    );

async function windowIds(): Promise<number[]> {
  return (await chrome.windows.getAll({})).flatMap((w) =>
    w.id === undefined ? [] : [w.id]
  );
}

async function focusedWindowIds(): Promise<number[]> {
  return (await chrome.windows.getAll({}))
    .filter((w) => w.focused)
    .flatMap((w) => (w.id === undefined ? [] : [w.id]));
}

// The one window a reopen created: every window that is not in `before`.
async function newWindow(before: number[]): Promise<chrome.windows.Window> {
  const fresh = (await chrome.windows.getAll({})).filter(
    (w) => w.id !== undefined && !before.includes(w.id)
  );
  expect(fresh).toHaveLength(1);
  return fresh[0];
}

function idOf(win: chrome.windows.Window): number {
  if (win.id === undefined) throw new Error('window has no id');
  return win.id;
}

async function tabNamed(windowId: number, name: string) {
  const found = (await chrome.tabs.query({ windowId })).find(
    (tab) => tab.url === url(name)
  );
  if (!found) throw new Error(`no tab ${name} in window ${windowId}`);
  return found;
}

describe('reopenClosed: a closed window (KAN-280 O8)', () => {
  test('comes back exactly: bounds, state, pins, groups, active tab, real addresses, unfocused', async () => {
    handle = setupChromeFake({
      grantedPermissions: ['tabGroups'],
      windows: [
        tabKeeperWindow,
        {
          id: 2,
          left: 140,
          top: 90,
          width: 900,
          height: 640,
          state: 'maximized',
          tabs: [
            { url: url('w1'), pinned: true },
            { url: url('w2'), groupId: 50 },
            { url: url('w3'), groupId: 50, active: true },
            { url: url('w4'), groupId: 51 },
          ],
        },
      ],
      tabGroups: [
        { id: 50, windowId: 2, title: 'Kyoto', color: 'blue' },
        { id: 51, windowId: 2, title: 'Later', color: 'red', collapsed: true },
      ],
    });
    const w2 = await openWindow(2);

    const item = await closeOpenWindow(w2);
    expect(item).toEqual({ kind: 'window', window: w2 });
    expect(await windowIds()).toEqual([1]);
    if (!item) throw new Error('close failed');

    expect(await reopenClosed(item)).toMatchObject({ kind: 'window' });

    const reopened = await newWindow([1]);
    const id = idOf(reopened);
    expect(reopened).toMatchObject({
      left: 140,
      top: 90,
      width: 900,
      height: 640,
      state: 'maximized',
      focused: false,
    });
    expect(await focusedWindowIds()).toEqual([1]);
    expect(await shape(id)).toEqual(['w1(pin)', 'w2', 'w3*', 'w4']);

    // No seed tab left behind.
    const urls = (await chrome.tabs.query({ windowId: id })).map((t) => t.url);
    expect(urls).not.toContain('chrome://newtab/');

    const w1 = await tabNamed(id, 'w1');
    const tw2 = await tabNamed(id, 'w2');
    const tw3 = await tabNamed(id, 'w3');
    const tw4 = await tabNamed(id, 'w4');
    expect(w1.groupId).toBe(-1);
    expect(tw2.groupId).toBe(tw3.groupId);
    expect(tw4.groupId).not.toBe(tw2.groupId);
    expect(await chrome.tabGroups.get(tw2.groupId)).toMatchObject({
      windowId: id,
      title: 'Kyoto',
      color: 'blue',
      collapsed: false,
    });
    expect(await chrome.tabGroups.get(tw4.groupId)).toMatchObject({
      windowId: id,
      title: 'Later',
      color: 'red',
      collapsed: true,
    });

    // Rule 7: every tab loads its real address, never the lazy-load
    // placeholder a session restore uses.
    const createdUrls = handle.createdTabs.map((props) => props.url ?? '');
    expect(createdUrls).toEqual(w2.tabs.map((tab) => tab.url));
    for (const created of createdUrls) {
      expect(placeholderTarget(created)).toBeNull();
      expect(created.startsWith('data:')).toBe(false);
    }
  });

  // KAN-308: a move, resize or maximize fires no event the pane re-reads
  // on, so the snapshot a close is handed can hold the window's old place.
  test('a window moved and maximized after the pane read comes back where it was when it closed', async () => {
    handle = setupChromeFake({
      windows: [
        tabKeeperWindow,
        {
          id: 2,
          left: 140,
          top: 90,
          width: 900,
          height: 640,
          state: 'normal',
          tabs: [{ url: url('a'), active: true }],
        },
      ],
    });
    const w2 = await openWindow(2);
    await chrome.windows.update(2, {
      left: 300,
      top: 200,
      width: 700,
      height: 500,
      state: 'maximized',
    });
    // PREMISE: the snapshot still holds the old place.
    expect(w2).toMatchObject({
      bounds: { left: 140, top: 90, width: 900, height: 640 },
      state: 'normal',
    });

    const item = await closeOpenWindow(w2);
    if (!item) throw new Error('close failed');
    expect(await reopenClosed(item)).toMatchObject({ kind: 'window' });

    expect(await newWindow([1])).toMatchObject({
      left: 300,
      top: 200,
      width: 700,
      height: 500,
      state: 'maximized',
      focused: false,
    });
  });

  test('when the fresh read fails, the window still closes and comes back in the snapshot place', async () => {
    handle = setupChromeFake({
      windows: [
        tabKeeperWindow,
        {
          id: 2,
          left: 140,
          top: 90,
          width: 900,
          height: 640,
          state: 'normal',
          tabs: [{ url: url('a'), active: true }],
        },
      ],
    });
    const w2 = await openWindow(2);
    vi.spyOn(chrome.windows, 'get').mockRejectedValueOnce(
      new Error('No window with id: 2.')
    );

    const item = await closeOpenWindow(w2);
    expect(item).toEqual({ kind: 'window', window: w2 });
    expect(await windowIds()).toEqual([1]);
    if (!item) throw new Error('close failed');
    expect(await reopenClosed(item)).toMatchObject({ kind: 'window' });

    expect(await newWindow([1])).toMatchObject({
      left: 140,
      top: 90,
      width: 900,
      height: 640,
    });
  });

  test('a tab Chrome refuses is skipped with a warning, and the rest come back in order', async () => {
    handle = setupChromeFake({
      refusedUrls: ['file:///x'],
      windows: [
        tabKeeperWindow,
        {
          id: 2,
          tabs: [
            { url: url('a'), active: true },
            { url: 'file:///x' },
            { url: url('c') },
          ],
        },
      ],
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const item = await closeOpenWindow(await openWindow(2));
    if (!item) throw new Error('close failed');

    expect(await reopenClosed(item)).toMatchObject({ kind: 'window' });

    const id = idOf(await newWindow([1]));
    expect(await shape(id)).toEqual(['a*', 'c']);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  test('when nothing can be recreated it resolves null and leaves no window behind', async () => {
    handle = setupChromeFake({
      refusedUrls: ['file:///x', 'file:///y'],
      windows: [
        tabKeeperWindow,
        {
          id: 2,
          tabs: [{ url: 'file:///x', active: true }, { url: 'file:///y' }],
        },
      ],
    });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const item = await closeOpenWindow(await openWindow(2));
    if (!item) throw new Error('close failed');
    const createdWindowIds: number[] = [];
    chrome.windows.onCreated.addListener((w) => {
      if (w.id !== undefined) createdWindowIds.push(w.id);
    });

    expect(await reopenClosed(item)).toBeNull();

    expect(createdWindowIds).toHaveLength(1);
    expect(handle.removedWindowIds).toContain(createdWindowIds[0]);
    expect(await windowIds()).toEqual([1]);
  });

  test('with tabGroups revoked before Reopen, the tabs come back ungrouped and nothing throws', async () => {
    handle = setupChromeFake({
      tabGroupsApiAbsent: true,
      windows: [
        tabKeeperWindow,
        {
          id: 2,
          tabs: [
            { url: url('a'), groupId: 50, active: true },
            { url: url('b'), groupId: 50 },
            { url: url('c') },
          ],
        },
      ],
    });
    // The groups the snapshot saw while the permission was still held.
    const groupsAtClose: chrome.tabGroups.TabGroup[] = [
      {
        id: 50,
        windowId: 2,
        title: 'Kyoto',
        color: 'blue',
        collapsed: false,
        shared: false,
      },
    ];
    const all = await chrome.windows.getAll({
      populate: true,
      windowTypes: ['normal'],
    });
    const w2 = toOpenWindows(all, groupsAtClose, null).find((w) => w.id === 2);
    if (!w2) throw new Error('no window 2');
    expect(w2.groups).toHaveLength(1);

    const item = await closeOpenWindow(w2);
    if (!item) throw new Error('close failed');
    expect(chrome.tabGroups).toBeUndefined();

    expect(await reopenClosed(item)).toMatchObject({ kind: 'window' });

    const id = idOf(await newWindow([1]));
    expect(await shape(id)).toEqual(['a*', 'b', 'c']);
    const groupIds = (await chrome.tabs.query({ windowId: id })).map(
      (t) => t.groupId
    );
    expect(groupIds).toEqual([-1, -1, -1]);
    expect(handle.groupedTabs).toEqual([]);
  });

  test('a window Chrome will not create resolves null, and no tab is created', async () => {
    handle = setupChromeFake({
      windows: [tabKeeperWindow, { id: 2, tabs: [{ url: url('a') }] }],
    });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const item = await closeOpenWindow(await openWindow(2));
    if (!item) throw new Error('close failed');
    vi.spyOn(chrome.windows, 'create').mockRejectedValueOnce(
      new Error('Incognito mode is disabled.')
    );

    expect(await reopenClosed(item)).toBeNull();
    expect(handle.createdTabs).toEqual([]);
  });

  test('never rejects, even with the chrome namespace gone', async () => {
    handle = setupChromeFake({
      windows: [tabKeeperWindow, { id: 2, tabs: [{ url: url('a') }] }],
    });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const item = await closeOpenWindow(await openWindow(2));
    if (!item) throw new Error('close failed');
    handle.restore();

    await expect(reopenClosed(item)).resolves.toBeNull();
  });
});

describe('reopenClosed: a closed tab (KAN-280 O8, rule 6)', () => {
  test('comes back where it was, in its surviving group, without taking focus', async () => {
    handle = setupChromeFake({
      grantedPermissions: ['tabGroups'],
      windows: [
        tabKeeperWindow,
        {
          id: 2,
          tabs: [
            { url: url('a'), groupId: 50, active: true },
            { url: url('b'), groupId: 50 },
            { url: url('c') },
          ],
        },
      ],
      tabGroups: [{ id: 50, windowId: 2, title: 'Kyoto', color: 'green' }],
    });
    const w2 = await openWindow(2);
    const item = await closeOpenTab(w2, tabIn(w2, 'b'));
    expect(await shape(2)).toEqual(['a*', 'c']);
    if (!item) throw new Error('close failed');

    expect(await reopenClosed(item)).toMatchObject({ kind: 'tab' });

    expect(await shape(2)).toEqual(['a*', 'b', 'c']);
    expect((await tabNamed(2, 'b')).groupId).toBe(50);
    expect(handle.groupedTabs.map((g) => g.groupId)).toEqual([50]);
    expect(await focusedWindowIds()).toEqual([1]);
  });

  test('a tab whose group is now in another window gets a new group like the old one', async () => {
    handle = setupChromeFake({
      grantedPermissions: ['tabGroups'],
      windows: [
        tabKeeperWindow,
        {
          id: 2,
          tabs: [
            { url: url('a'), active: true },
            { url: url('b'), groupId: 50 },
            { url: url('c') },
          ],
        },
        { id: 9, tabs: [{ url: url('elsewhere'), active: true }] },
      ],
      tabGroups: [
        {
          id: 50,
          windowId: 9,
          title: 'Solo',
          color: 'purple',
          collapsed: true,
        },
      ],
    });
    const w2 = await openWindow(2);
    const item = await closeOpenTab(w2, tabIn(w2, 'b'));
    if (!item) throw new Error('close failed');
    expect(item).toMatchObject({ kind: 'tab', group: { id: 50 } });

    expect(await reopenClosed(item)).toMatchObject({ kind: 'tab' });

    const b = await tabNamed(2, 'b');
    expect(await shape(2)).toEqual(['a*', 'b', 'c']);
    expect(handle.groupedTabs).toEqual([
      { groupId: b.groupId, windowId: 2, tabIds: [b.id] },
    ]);
    expect(b.groupId).not.toBe(50);
    expect(await chrome.tabGroups.get(b.groupId)).toMatchObject({
      windowId: 2,
      title: 'Solo',
      color: 'purple',
      collapsed: true,
    });
  });

  test('a tab whose group no longer exists at all gets a new group like the old one', async () => {
    // Chrome removes a group with its last tab, so tabGroups.get(50)
    // rejects by the time Reopen runs. The fake has no group 50; the
    // snapshot is built from the groups Chrome reported at close.
    handle = setupChromeFake({
      grantedPermissions: ['tabGroups'],
      windows: [
        tabKeeperWindow,
        {
          id: 2,
          tabs: [
            { url: url('a'), active: true },
            { url: url('b'), groupId: 50 },
          ],
        },
      ],
    });
    const groupsAtClose: chrome.tabGroups.TabGroup[] = [
      {
        id: 50,
        windowId: 2,
        title: 'Gone',
        color: 'orange',
        collapsed: false,
        shared: false,
      },
    ];
    const all = await chrome.windows.getAll({
      populate: true,
      windowTypes: ['normal'],
    });
    const w2 = toOpenWindows(all, groupsAtClose, null).find((w) => w.id === 2);
    if (!w2) throw new Error('no window 2');
    const item = await closeOpenTab(w2, tabIn(w2, 'b'));
    if (!item) throw new Error('close failed');

    expect(await reopenClosed(item)).toMatchObject({ kind: 'tab' });

    const b = await tabNamed(2, 'b');
    expect(b.groupId).not.toBe(-1);
    expect(b.groupId).not.toBe(50);
    expect(await chrome.tabGroups.get(b.groupId)).toMatchObject({
      windowId: 2,
      title: 'Gone',
      color: 'orange',
      collapsed: false,
    });
  });

  test("the window's last tab: the window comes back around it, unfocused", async () => {
    handle = setupChromeFake({
      windows: [
        tabKeeperWindow,
        {
          id: 2,
          left: 30,
          top: 40,
          width: 700,
          height: 500,
          state: 'normal',
          tabs: [{ url: url('solo'), active: true }],
        },
      ],
    });
    const w2 = await openWindow(2);
    const item = await closeOpenTab(w2, tabIn(w2, 'solo'));
    if (!item) throw new Error('close failed');
    // Closing the last tab took the window with it.
    expect(await windowIds()).toEqual([1]);

    expect(await reopenClosed(item)).toMatchObject({ kind: 'tab' });

    const reopened = await newWindow([1]);
    expect(reopened).toMatchObject({
      left: 30,
      top: 40,
      width: 700,
      height: 500,
      focused: false,
    });
    expect(await shape(idOf(reopened))).toEqual(['solo*']);
    expect(handle.createdTabs.some((props) => props.windowId === 2)).toBe(
      false
    );
    expect(await focusedWindowIds()).toEqual([1]);
  });

  // KAN-308, on the tab path: the close of a window's last tab takes the
  // window, so its place must be read before the remove, not at Reopen.
  test("the window's last tab, after the window moved and maximized: it comes back where the window was when it closed", async () => {
    handle = setupChromeFake({
      windows: [
        tabKeeperWindow,
        {
          id: 2,
          left: 30,
          top: 40,
          width: 700,
          height: 500,
          state: 'normal',
          tabs: [{ url: url('solo'), active: true }],
        },
      ],
    });
    const w2 = await openWindow(2);
    await chrome.windows.update(2, {
      left: 260,
      top: 120,
      width: 820,
      height: 610,
      state: 'maximized',
    });

    const item = await closeOpenTab(w2, tabIn(w2, 'solo'));
    if (!item) throw new Error('close failed');
    expect(await windowIds()).toEqual([1]);
    expect(await reopenClosed(item)).toMatchObject({ kind: 'tab' });

    const reopened = await newWindow([1]);
    expect(reopened).toMatchObject({
      left: 260,
      top: 120,
      width: 820,
      height: 610,
      state: 'maximized',
      focused: false,
    });
    expect(await shape(idOf(reopened))).toEqual(['solo*']);
  });

  // KAN-309: Chrome puts a tab created inside a group's run into that group.
  describe("a group formed over the tab's old spot since the close", () => {
    // a, x, b in window 2; x (at index 1) is the one closed, then a and b
    // are grouped together, so x's old index is inside that group's run.
    const seedAXB = (xGroupId?: number) =>
      setupChromeFake({
        grantedPermissions: ['tabGroups'],
        windows: [
          tabKeeperWindow,
          {
            id: 2,
            tabs: [
              { url: url('a'), active: true },
              xGroupId === undefined
                ? { url: url('x') }
                : { url: url('x'), groupId: xGroupId },
              { url: url('b') },
            ],
          },
        ],
        tabGroups:
          xGroupId === undefined
            ? []
            : [{ id: xGroupId, windowId: 2, title: 'Kept', color: 'cyan' }],
      });

    async function closeXThenGroupAB() {
      const w2 = await openWindow(2);
      const item = await closeOpenTab(w2, tabIn(w2, 'x'));
      if (!item) throw new Error('close failed');
      const a = await tabNamed(2, 'a');
      const b = await tabNamed(2, 'b');
      if (a.id === undefined || b.id === undefined) throw new Error('no ids');
      const overSpot = await chrome.tabs.group({
        createProperties: { windowId: 2 },
        tabIds: [a.id, b.id],
      });
      return { item, overSpot };
    }

    test('an ungrouped tab comes back ungrouped', async () => {
      handle = seedAXB();
      const { item, overSpot } = await closeXThenGroupAB();
      expect(item).toMatchObject({ kind: 'tab', group: null });

      expect(await reopenClosed(item)).toMatchObject({ kind: 'tab' });

      expect((await tabNamed(2, 'x')).groupId).toBe(-1);
      expect((await tabNamed(2, 'a')).groupId).toBe(overSpot);
      expect((await tabNamed(2, 'b')).groupId).toBe(overSpot);
    });

    test('when Chrome will not ungroup it, the tab is still reopened, with a warning', async () => {
      handle = seedAXB();
      const { item } = await closeXThenGroupAB();
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      vi.spyOn(chrome.tabs, 'ungroup').mockRejectedValueOnce(
        new Error('Tabs cannot be edited right now.')
      );

      expect(await reopenClosed(item)).toMatchObject({ kind: 'tab' });

      expect(await shape(2)).toEqual(['a*', 'x', 'b']);
      expect(warn).toHaveBeenCalledTimes(1);
    });

    test('CONTROL: a grouped tab still goes back into its own group', async () => {
      handle = seedAXB(50);
      const { item } = await closeXThenGroupAB();
      expect(item).toMatchObject({ kind: 'tab', group: { id: 50 } });

      expect(await reopenClosed(item)).toMatchObject({ kind: 'tab' });

      expect((await tabNamed(2, 'x')).groupId).toBe(50);
    });

    test('with tabGroups ungranted, the snapshot cannot know the group, so the tab is left where Chrome put it', async () => {
      // x really is in group 5, but without the permission the snapshot
      // reports it ungrouped. Ungrouping it on Reopen would be a guess.
      handle = setupChromeFake({
        tabGroupsApiAbsent: true,
        windows: [
          tabKeeperWindow,
          {
            id: 2,
            tabs: [
              { url: url('a'), groupId: 5, active: true },
              { url: url('x'), groupId: 5 },
              { url: url('b'), groupId: 5 },
            ],
          },
        ],
      });
      const w2 = await openWindow(2);
      const item = await closeOpenTab(w2, tabIn(w2, 'x'));
      if (!item) throw new Error('close failed');
      expect(item).toMatchObject({ kind: 'tab', group: null });

      expect(await reopenClosed(item)).toMatchObject({ kind: 'tab' });

      expect((await tabNamed(2, 'x')).groupId).toBe(5);
    });
  });

  // Chrome expands a collapsed group when a tab is created into it ACTIVE,
  // and taking the tab back out does not collapse the group again (measured
  // 2026-09-24). The fake does not model that expand, so these pin the order
  // that avoids it: create inactive, do the group step, then activate
  // (KAN-280 rule 6, KAN-310).
  describe('a front tab is activated only after its group step (KAN-310)', () => {
    // a, x, b, z in window 2 with x in front. x closes, z comes to the
    // front, then a and b are grouped over x's old spot and collapsed.
    async function closeFrontXUnderCollapsedGroup() {
      const fake = setupChromeFake({
        grantedPermissions: ['tabGroups'],
        windows: [
          tabKeeperWindow,
          {
            id: 2,
            tabs: [
              { url: url('a') },
              { url: url('x'), active: true },
              { url: url('b') },
              { url: url('z') },
            ],
          },
        ],
      });
      handle = fake;
      const w2 = await openWindow(2);
      const item = await closeOpenTab(w2, tabIn(w2, 'x'));
      if (!item) throw new Error('close failed');
      const a = await tabNamed(2, 'a');
      const b = await tabNamed(2, 'b');
      const z = await tabNamed(2, 'z');
      if (a.id === undefined || b.id === undefined || z.id === undefined) {
        throw new Error('no ids');
      }
      fake.browser.activateTab(z.id);
      const overSpot = await chrome.tabs.group({
        createProperties: { windowId: 2 },
        tabIds: [a.id, b.id],
      });
      await chrome.tabGroups.update(overSpot, { collapsed: true });
      return { item, fake };
    }

    // Called through: each spy records its calls and Chrome still runs.
    const spyOnTabSteps = () => ({
      group: vi.spyOn(chrome.tabs, 'group'),
      ungroup: vi.spyOn(chrome.tabs, 'ungroup'),
      update: vi.spyOn(chrome.tabs, 'update'),
    });

    test('an ungrouped front tab is created in the background, taken out of the group, then brought to the front', async () => {
      const { item, fake } = await closeFrontXUnderCollapsedGroup();
      expect(item).toMatchObject({
        kind: 'tab',
        group: null,
        tab: { active: true },
      });
      const steps = spyOnTabSteps();

      expect(await reopenClosed(item)).toMatchObject({ kind: 'tab' });

      const x = await tabNamed(2, 'x');
      expect(x).toMatchObject({ active: true, groupId: -1 });
      expect(fake.createdTabs).toEqual([
        expect.objectContaining({ url: url('x'), active: false }),
      ]);
      expect(steps.ungroup).toHaveBeenCalledTimes(1);
      expect(steps.update).toHaveBeenCalledTimes(1);
      expect(steps.update).toHaveBeenCalledWith(x.id, { active: true });
      expect(steps.update.mock.invocationCallOrder[0]).toBeGreaterThan(
        steps.ungroup.mock.invocationCallOrder[0]
      );
    });

    test('a front tab rejoining its surviving group is brought to the front after it joins', async () => {
      handle = setupChromeFake({
        grantedPermissions: ['tabGroups'],
        windows: [
          tabKeeperWindow,
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
      });
      const w2 = await openWindow(2);
      const item = await closeOpenTab(w2, tabIn(w2, 'x'));
      if (!item) throw new Error('close failed');
      const z = await tabNamed(2, 'z');
      if (z.id === undefined) throw new Error('no id');
      handle.browser.activateTab(z.id);
      const steps = spyOnTabSteps();

      expect(await reopenClosed(item)).toMatchObject({ kind: 'tab' });

      const x = await tabNamed(2, 'x');
      expect(x).toMatchObject({ active: true, groupId: 50 });
      expect(handle.createdTabs).toEqual([
        expect.objectContaining({ url: url('x'), active: false }),
      ]);
      expect(steps.group).toHaveBeenCalledTimes(1);
      expect(steps.update).toHaveBeenCalledTimes(1);
      expect(steps.update).toHaveBeenCalledWith(x.id, { active: true });
      expect(steps.update.mock.invocationCallOrder[0]).toBeGreaterThan(
        steps.group.mock.invocationCallOrder[0]
      );
    });

    test('CONTROL: a background tab is never brought to the front', async () => {
      handle = setupChromeFake({
        grantedPermissions: ['tabGroups'],
        windows: [
          tabKeeperWindow,
          {
            id: 2,
            tabs: [
              { url: url('a'), active: true },
              { url: url('x') },
              { url: url('b') },
            ],
          },
        ],
      });
      const w2 = await openWindow(2);
      const item = await closeOpenTab(w2, tabIn(w2, 'x'));
      if (!item) throw new Error('close failed');
      const steps = spyOnTabSteps();

      expect(await reopenClosed(item)).toMatchObject({ kind: 'tab' });

      expect(await tabNamed(2, 'x')).toMatchObject({ active: false });
      expect(steps.update).not.toHaveBeenCalled();
    });

    test('when Chrome will not bring it to the front, the tab is still reopened, ungrouped, with a warning', async () => {
      const { item } = await closeFrontXUnderCollapsedGroup();
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      vi.spyOn(chrome.tabs, 'update').mockRejectedValueOnce(
        new Error('Tabs cannot be edited right now.')
      );

      expect(await reopenClosed(item)).toMatchObject({ kind: 'tab' });

      expect(await shape(2)).toEqual(['a', 'x', 'b', 'z*']);
      expect((await tabNamed(2, 'x')).groupId).toBe(-1);
      expect(warn).toHaveBeenCalledTimes(1);
    });
  });

  test('an index past the end of a window that shrank lands at the end', async () => {
    handle = setupChromeFake({
      windows: [
        tabKeeperWindow,
        {
          id: 2,
          tabs: [
            { url: url('a'), active: true },
            { url: url('b') },
            { url: url('c') },
          ],
        },
      ],
    });
    const w2 = await openWindow(2);
    const item = await closeOpenTab(w2, tabIn(w2, 'c'));
    if (!item) throw new Error('close failed');
    await chrome.tabs.remove(tabIn(w2, 'b').id);

    expect(await reopenClosed(item)).toMatchObject({ kind: 'tab' });

    expect(handle.createdTabs.map((props) => props.index)).toEqual([2]);
    expect(await shape(2)).toEqual(['a*', 'c']);
    expect((await tabNamed(2, 'c')).index).toBe(1);
  });

  test('a pinned tab comes back pinned, in the pinned run', async () => {
    handle = setupChromeFake({
      windows: [
        tabKeeperWindow,
        {
          id: 2,
          tabs: [
            { url: url('p'), pinned: true },
            { url: url('a'), active: true },
            { url: url('b') },
          ],
        },
      ],
    });
    const w2 = await openWindow(2);
    const item = await closeOpenTab(w2, tabIn(w2, 'p'));
    if (!item) throw new Error('close failed');

    expect(await reopenClosed(item)).toMatchObject({ kind: 'tab' });

    expect(await shape(2)).toEqual(['p(pin)', 'a*', 'b']);
  });

  test('an active tab comes back active in its window, and the window stays unfocused', async () => {
    handle = setupChromeFake({
      windows: [
        tabKeeperWindow,
        { id: 2, tabs: [{ url: url('a'), active: true }, { url: url('b') }] },
      ],
    });
    const w2 = await openWindow(2);
    const item = await closeOpenTab(w2, tabIn(w2, 'a'));
    if (!item) throw new Error('close failed');

    expect(await reopenClosed(item)).toMatchObject({ kind: 'tab' });

    expect(await shape(2)).toEqual(['a*', 'b']);
    expect(await focusedWindowIds()).toEqual([1]);
  });

  test('a tab Chrome refuses to recreate in its surviving window resolves null', async () => {
    handle = setupChromeFake({
      refusedUrls: ['file:///x'],
      windows: [
        tabKeeperWindow,
        {
          id: 2,
          tabs: [{ url: url('a'), active: true }, { url: 'file:///x' }],
        },
      ],
    });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const w2 = await openWindow(2);
    const refused = w2.tabs.find((tab) => tab.url === 'file:///x');
    if (!refused) throw new Error('no refused tab');
    const item = await closeOpenTab(w2, refused);
    if (!item) throw new Error('close failed');

    expect(await reopenClosed(item)).toBeNull();
    expect(await shape(2)).toEqual(['a*']);
  });
});

// KAN-311 (O8c): after Reopen, focus goes to the reopened row, so
// reopenClosed says which new tab or window it made. Chrome gives each a new
// id; the old one names nothing any more.
describe('reopenClosed resolves to what it reopened (KAN-311)', () => {
  test('a tab: its new id', async () => {
    handle = setupChromeFake({
      windows: [
        tabKeeperWindow,
        { id: 2, tabs: [{ url: url('a'), active: true }, { url: url('b') }] },
      ],
    });
    const w2 = await openWindow(2);
    const b = tabIn(w2, 'b');
    const item = await closeOpenTab(w2, b);
    if (!item) throw new Error('close failed');

    const reopened = await reopenClosed(item);

    const back = await tabNamed(2, 'b');
    // PREMISE: Chrome gave it a new id, so the old one cannot pass for it.
    expect(back.id).not.toBe(b.id);
    expect(reopened).toEqual({ kind: 'tab', tabId: back.id });
  });

  test("a window's last tab: the tab in the window made around it", async () => {
    handle = setupChromeFake({
      windows: [tabKeeperWindow, { id: 2, tabs: [{ url: url('solo') }] }],
    });
    const w2 = await openWindow(2);
    const item = await closeOpenTab(w2, tabIn(w2, 'solo'));
    if (!item) throw new Error('close failed');

    const reopened = await reopenClosed(item);

    const id = idOf(await newWindow([1]));
    expect(reopened).toEqual({
      kind: 'tab',
      tabId: (await tabNamed(id, 'solo')).id,
    });
  });

  test('a window: its new id', async () => {
    handle = setupChromeFake({
      windows: [
        tabKeeperWindow,
        { id: 2, tabs: [{ url: url('a') }, { url: url('b') }] },
      ],
    });
    const item = await closeOpenWindow(await openWindow(2));
    if (!item) throw new Error('close failed');

    const reopened = await reopenClosed(item);

    const id = idOf(await newWindow([1]));
    expect(id).not.toBe(2);
    expect(reopened).toEqual({ kind: 'window', windowId: id });
  });
});

describe('closeOpenTab / closeOpenWindow', () => {
  test('a tab closed twice: the first resolves an item, the second null', async () => {
    handle = setupChromeFake({
      windows: [
        tabKeeperWindow,
        { id: 2, tabs: [{ url: url('a'), active: true }, { url: url('b') }] },
      ],
    });
    const w2 = await openWindow(2);
    const b = tabIn(w2, 'b');

    const [first, second] = await Promise.all([
      closeOpenTab(w2, b),
      closeOpenTab(w2, b),
    ]);

    expect(first).toEqual({ kind: 'tab', tab: b, group: null, window: w2 });
    expect(second).toBeNull();
    expect(handle.removedTabIds).toEqual([b.id]);
  });

  test('a window already gone resolves null', async () => {
    handle = setupChromeFake({
      windows: [tabKeeperWindow, { id: 2, tabs: [{ url: url('a') }] }],
    });
    const w2 = await openWindow(2);

    expect(await closeOpenWindow(w2)).not.toBeNull();
    expect(await closeOpenWindow(w2)).toBeNull();
  });
});
