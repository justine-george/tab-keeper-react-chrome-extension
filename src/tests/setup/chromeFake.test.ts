import { afterEach, describe, expect, test, vi } from 'vitest';

import { setupChromeFake } from './chrome.fake';
import { buildChromeTab } from '../fixtures/chromeTab';

let handle: ReturnType<typeof setupChromeFake> | undefined;

afterEach(() => {
  handle?.restore();
  handle = undefined;
});

describe('chrome.storage.sync fake', () => {
  test('round-trips a value through set and get', async () => {
    handle = setupChromeFake();

    await chrome.storage.sync.set({ tokenValue: 'abc' });
    const read = await chrome.storage.sync.get(['tokenValue']);

    expect(read).toEqual({ tokenValue: 'abc' });
  });

  test('honours default values for a key that was never set', async () => {
    handle = setupChromeFake();

    const read = await chrome.storage.sync.get({ tokenValue: 'fallback' });

    expect(read).toEqual({ tokenValue: 'fallback' });
  });

  test('clear empties the store', async () => {
    handle = setupChromeFake({ storage: { tokenValue: 'abc' } });

    await chrome.storage.sync.clear();

    expect(await chrome.storage.sync.get(['tokenValue'])).toEqual({});
  });
});

describe('chrome.tabs fake', () => {
  test('query returns seeded tabs to a callback', async () => {
    handle = setupChromeFake({
      tabs: [{ id: 1, title: 'Seeded', active: true }],
    });

    const tabs = await new Promise<chrome.tabs.Tab[]>((resolve) =>
      chrome.tabs.query({ active: true, currentWindow: true }, resolve)
    );

    expect(tabs.map((tab) => tab.title)).toEqual(['Seeded']);
  });

  test('create records the call and makes the tab queryable', async () => {
    // KAN-280 Part B: tabs.create now rejects for a windowId no window
    // carries, and an unseeded fake has no window at all -- a bare `tabs:
    // [...]` seed relied on DEFAULT_WINDOW_ID being taken on faith, which
    // real Chrome never does.
    handle = setupChromeFake({ windows: [{ id: 1 }] });

    await chrome.tabs.create({ url: 'https://example.com/' });

    expect(handle.createdTabs).toEqual([{ url: 'https://example.com/' }]);
    const tabs = await new Promise<chrome.tabs.Tab[]>((resolve) =>
      chrome.tabs.query({}, resolve)
    );
    expect(tabs.map((tab) => tab.url)).toContain('https://example.com/');
  });
});

// KAN-208. The export page asks which tab it is, so it can leave itself out
// of a capture. Chrome answers undefined from anything that is not a tab --
// the popup, the worker -- and the fake keeps that shape rather than minting
// a tab: a seed naming an id no tab carries must not be papered over.
describe('chrome.tabs.getCurrent fake', () => {
  test('answers with the seeded current tab', async () => {
    handle = setupChromeFake({
      tabs: [
        { id: 1, title: 'Popup' },
        { id: 2, title: 'Export page' },
      ],
      currentTabId: 2,
    });

    const tab = await chrome.tabs.getCurrent();

    expect(tab?.id).toBe(2);
    expect(tab?.title).toBe('Export page');
  });

  test('answers undefined when no current tab is seeded, as Chrome does outside a tab', async () => {
    handle = setupChromeFake({ tabs: [{ id: 1, title: 'Popup' }] });

    expect(await chrome.tabs.getCurrent()).toBeUndefined();
  });

  test('answers undefined for an id no seeded tab carries', async () => {
    handle = setupChromeFake({ tabs: [{ id: 1 }], currentTabId: 99 });

    expect(await chrome.tabs.getCurrent()).toBeUndefined();
  });

  test('also takes a callback, like every other member here', async () => {
    handle = setupChromeFake({ tabs: [{ id: 3 }], currentTabId: 3 });

    const tab = await new Promise<chrome.tabs.Tab | undefined>((resolve) =>
      chrome.tabs.getCurrent(resolve)
    );

    expect(tab?.id).toBe(3);
  });
});

describe('chrome.windows fake', () => {
  test('getAll returns seeded windows with their tabs', async () => {
    handle = setupChromeFake({
      windows: [
        { id: 7, tabs: [{ id: 1, title: 'One' }] as chrome.tabs.Tab[] },
      ],
    });

    const windows = await new Promise<chrome.windows.Window[]>((resolve) =>
      chrome.windows.getAll({ populate: true }, resolve)
    );

    expect(windows).toHaveLength(1);
    expect(windows[0].id).toBe(7);
    // Asserting the tabs, not just the window: without this the test passed
    // against a fake that reported `tabs: []` for every window, which is the
    // exact defect that made captureOpenWindows return null.
    expect(windows[0].tabs?.map((tab) => tab.title)).toEqual(['One']);
  });

  test('omits tabs when populate was not asked for', async () => {
    handle = setupChromeFake({
      windows: [
        { id: 7, tabs: [{ id: 1, title: 'One' }] as chrome.tabs.Tab[] },
      ],
    });

    const windows = await new Promise<chrome.windows.Window[]>((resolve) =>
      chrome.windows.getAll({}, resolve)
    );

    expect(windows[0].tabs).toBeUndefined();
  });

  test('a tab created against a window shows up inside that window', async () => {
    handle = setupChromeFake({ windows: [{ id: 7 }, { id: 8 }] });

    await chrome.tabs.create({ windowId: 7, url: 'https://kagi.com/' });

    const windows = await new Promise<chrome.windows.Window[]>((resolve) =>
      chrome.windows.getAll({ populate: true }, resolve)
    );

    expect(windows[0].tabs?.map((tab) => tab.url)).toEqual([
      'https://kagi.com/',
    ]);
    expect(windows[1].tabs).toEqual([]);
  });

  test('create opens its url as the new window first tab', async () => {
    handle = setupChromeFake();

    const created = await new Promise<chrome.windows.Window | undefined>(
      (resolve) => chrome.windows.create({ url: 'https://kagi.com/' }, resolve)
    );

    expect(created!.tabs?.map((tab) => tab.url)).toEqual(['https://kagi.com/']);
  });

  test('remove deletes the window from a subsequent getAll', async () => {
    handle = setupChromeFake({ windows: [{ id: 7 }, { id: 8 }] });

    chrome.windows.remove(7);

    const windows = await new Promise<chrome.windows.Window[]>((resolve) =>
      chrome.windows.getAll({ populate: true }, resolve)
    );
    expect(windows.map((w) => w.id)).toEqual([8]);
    expect(handle.removedWindowIds).toEqual([7]);
  });

  // KAN-50. capture and background.ts both narrow getAll with windowTypes. A
  // fake that ignored the filter would hand them popups regardless and let a
  // popup-exclusion test pass without the production code doing anything.
  test('getAll honours windowTypes', async () => {
    handle = setupChromeFake({
      windows: [{ id: 7 }, { id: 8, type: 'popup' }],
    });

    const normals = await new Promise<chrome.windows.Window[]>((resolve) =>
      chrome.windows.getAll({ windowTypes: ['normal'] }, resolve)
    );
    const popups = await new Promise<chrome.windows.Window[]>((resolve) =>
      chrome.windows.getAll({ windowTypes: ['popup'] }, resolve)
    );

    expect(normals.map((w) => w.id)).toEqual([7]);
    expect(popups.map((w) => w.id)).toEqual([8]);
  });

  // Chrome's documented default when the caller omits windowTypes. This is the
  // behaviour the KAN-50 bug rode in on, so it is pinned rather than assumed.
  test('getAll defaults to normal and popup when windowTypes is omitted', async () => {
    handle = setupChromeFake({
      windows: [{ id: 7 }, { id: 8, type: 'popup' }],
    });

    const windows = await new Promise<chrome.windows.Window[]>((resolve) =>
      chrome.windows.getAll({}, resolve)
    );

    expect(windows.map((w) => w.id)).toEqual([7, 8]);
  });

  // A seeded window with no explicit type has to default to 'normal', or every
  // existing test's windows would be filtered out of every typed query.
  test('a seeded window defaults to type normal', async () => {
    handle = setupChromeFake({ windows: [{ id: 7 }] });

    const windows = await new Promise<chrome.windows.Window[]>((resolve) =>
      chrome.windows.getAll({ windowTypes: ['normal'] }, resolve)
    );

    expect(windows.map((w) => w.type)).toEqual(['normal']);
  });

  test('create defaults to type normal and honours an explicit popup', async () => {
    handle = setupChromeFake();

    const normal = await new Promise<chrome.windows.Window | undefined>(
      (resolve) => chrome.windows.create({ url: 'https://a.example/' }, resolve)
    );
    const popup = await new Promise<chrome.windows.Window | undefined>(
      (resolve) =>
        chrome.windows.create(
          { url: 'https://b.example/', type: 'popup' },
          resolve
        )
    );

    expect(normal!.type).toBe('normal');
    expect(popup!.type).toBe('popup');
  });
});

describe('chrome.runtime fake', () => {
  test('sendMessage records the message', () => {
    handle = setupChromeFake();

    chrome.runtime.sendMessage({ type: 'FOCUS_TAB_CONTAINER' });

    expect(handle.sentMessages).toEqual([{ type: 'FOCUS_TAB_CONTAINER' }]);
  });

  test('restore removes the global', () => {
    handle = setupChromeFake();
    handle.restore();
    handle = undefined;

    expect((globalThis as { chrome?: unknown }).chrome).toBeUndefined();
  });

  test('sendMessage invokes a callback when one is given', () => {
    handle = setupChromeFake();
    const cb = vi.fn();

    chrome.runtime.sendMessage({ type: 'FOCUS_TAB_CONTAINER' }, cb);

    expect(cb).toHaveBeenCalledTimes(1);
    expect(handle.sentMessages).toEqual([{ type: 'FOCUS_TAB_CONTAINER' }]);
  });
});

describe('tab groups', () => {
  test('a seeded tab reports its groupId, and an ungrouped one reports -1', async () => {
    handle = setupChromeFake({
      windows: [{ id: 1 }],
      tabs: [
        { id: 11, windowId: 1, groupId: 5 },
        { id: 12, windowId: 1 },
      ],
    });

    const tabs = await chrome.tabs.query({ windowId: 1 });
    expect(tabs[0].groupId).toBe(5);
    expect(tabs[1].groupId).toBe(chrome.tabGroups.TAB_GROUP_ID_NONE);
  });

  test('tabGroups.query returns the groups seeded for a window', async () => {
    handle = setupChromeFake({
      windows: [{ id: 1 }, { id: 2 }],
      tabGroups: [
        { id: 5, windowId: 1, title: 'Work', color: 'blue' },
        { id: 6, windowId: 2, title: 'Other', color: 'red' },
      ],
    });

    const groups = await chrome.tabGroups.query({ windowId: 1 });
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ id: 5, title: 'Work', color: 'blue' });
  });

  test('tabs.group records the call, mints an id and stamps the tabs', async () => {
    handle = setupChromeFake({
      windows: [{ id: 1 }],
      tabs: [{ id: 11, windowId: 1 }],
    });

    const groupId = await chrome.tabs.group({
      createProperties: { windowId: 1 },
      tabIds: [11],
    });

    expect(typeof groupId).toBe('number');
    expect(handle.groupedTabs).toEqual([
      { groupId, windowId: 1, tabIds: [11] },
    ]);

    const [tab] = await chrome.tabs.query({ windowId: 1 });
    expect(tab.groupId).toBe(groupId);
  });

  test('tabGroups.update applies title and colour to a created group', async () => {
    handle = setupChromeFake({
      windows: [{ id: 1 }],
      tabs: [{ id: 11, windowId: 1 }],
    });

    const groupId = await chrome.tabs.group({
      createProperties: { windowId: 1 },
      tabIds: [11],
    });
    await chrome.tabGroups.update(groupId, { title: 'Work', color: 'blue' });

    const [group] = await chrome.tabGroups.query({ windowId: 1 });
    expect(group).toMatchObject({ id: groupId, title: 'Work', color: 'blue' });
  });

  // KAN-309: Chrome's rule, measured in the real browser on 2026-09-24.
  test('tabs.create strictly between two tabs of one group joins it; at either edge of the run it does not', async () => {
    handle = setupChromeFake({
      windows: [
        {
          id: 1,
          tabs: [
            { url: 'https://a.test/', groupId: 5 },
            { url: 'https://b.test/', groupId: 5 },
            { url: 'https://c.test/' },
          ],
        },
      ],
      tabGroups: [{ id: 5, windowId: 1 }],
    });
    await chrome.tabs.create({
      windowId: 1,
      url: 'https://in.test/',
      index: 1,
    });
    await chrome.tabs.create({
      windowId: 1,
      url: 'https://before.test/',
      index: 0,
    });
    // After the run: between b (group 5) and c (ungrouped).
    await chrome.tabs.create({
      windowId: 1,
      url: 'https://after.test/',
      index: 4,
    });
    await chrome.tabs.create({ windowId: 1, url: 'https://end.test/' });

    const inOrder = (await chrome.tabs.query({ windowId: 1 }))
      .sort((x, y) => x.index - y.index)
      .map((t) => `${t.url?.slice(8, -6)}:${t.groupId}`);
    expect(inOrder).toEqual([
      'before:-1',
      'a:5',
      'in:5',
      'b:5',
      'after:-1',
      'c:-1',
      'end:-1',
    ]);
  });

  test('tabs.ungroup takes a tab out of its group, and rejects an unknown id without changing anything', async () => {
    handle = setupChromeFake({
      windows: [
        {
          id: 1,
          tabs: [
            { id: 11, groupId: 5 },
            { id: 12, groupId: 5 },
          ],
        },
      ],
      tabGroups: [{ id: 5, windowId: 1 }],
    });
    const groups = async () =>
      (await chrome.tabs.query({ windowId: 1 })).map((t) => t.groupId);

    await chrome.tabs.ungroup(11);
    expect(await groups()).toEqual([-1, 5]);

    await expect(chrome.tabs.ungroup([12, 424242])).rejects.toThrow(
      'No tab with id: 424242.'
    );
    expect(await groups()).toEqual([-1, 5]);

    // The callback form reports through lastError, never rejecting.
    const seen: (string | undefined)[] = [];
    await new Promise<void>((resolve) =>
      chrome.tabs.ungroup(424242, () => {
        seen.push(chrome.runtime.lastError?.message);
        resolve();
      })
    );
    expect(seen).toEqual(['No tab with id: 424242.']);
    expect(chrome.runtime.lastError).toBeUndefined();
  });
});

describe('permissions', () => {
  test('contains reports false for a permission that was not granted', async () => {
    handle = setupChromeFake();
    expect(
      await chrome.permissions.contains({ permissions: ['tabGroups'] })
    ).toBe(false);
  });

  test('a seeded grant is reported as held', async () => {
    handle = setupChromeFake({ grantedPermissions: ['tabGroups'] });
    expect(
      await chrome.permissions.contains({ permissions: ['tabGroups'] })
    ).toBe(true);
  });

  test('request grants, remove revokes, and both notify listeners', async () => {
    handle = setupChromeFake();
    const added: chrome.permissions.Permissions[] = [];
    const removed: chrome.permissions.Permissions[] = [];
    chrome.permissions.onAdded.addListener((p) => added.push(p));
    chrome.permissions.onRemoved.addListener((p) => removed.push(p));

    await chrome.permissions.request({ permissions: ['tabGroups'] });
    expect(
      await chrome.permissions.contains({ permissions: ['tabGroups'] })
    ).toBe(true);
    expect(added).toEqual([{ permissions: ['tabGroups'] }]);

    await chrome.permissions.remove({ permissions: ['tabGroups'] });
    expect(
      await chrome.permissions.contains({ permissions: ['tabGroups'] })
    ).toBe(false);
    expect(removed).toEqual([{ permissions: ['tabGroups'] }]);
  });

  // The fake must be able to model the measured production behaviour: the
  // popup can die before the promise settles. A test that needs that shape
  // seeds `requestNeverSettles` and asserts on contains(), never on the
  // promise.
  test('requestNeverSettles leaves the promise pending', async () => {
    handle = setupChromeFake({ requestNeverSettles: true });
    let settled = false;
    void chrome.permissions.request({ permissions: ['tabGroups'] }).then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
  });
});

// An inline tab is nested inside a specific `windows[]` entry, so its own
// `windowId` -- if it names one at all -- has to agree with that window's
// id. A seed literal naming a DIFFERENT one used to be silently overridden
// with no error, which let a builder's own default `windowId` move a tab
// into the wrong window without anything failing.
describe('makeTab enforces the seed window', () => {
  test('an inline tab naming a DIFFERENT windowId than the window it is seeded under throws', () => {
    expect(() =>
      setupChromeFake({
        windows: [
          {
            id: 7,
            tabs: [
              buildChromeTab({ id: 1, windowId: 99, title: 'Mismatched' }),
            ],
          },
        ],
      })
    ).toThrow(/makeTab/);
  });

  // CONTROL: the check is for DISAGREEMENT, not for the field's mere
  // presence -- naming the window's own id back is not an error.
  test('CONTROL: naming the SAME windowId as the enclosing window does not throw', () => {
    handle = setupChromeFake({
      windows: [
        {
          id: 7,
          tabs: [buildChromeTab({ id: 1, windowId: 7, title: 'Consistent' })],
        },
      ],
    });

    expect(handle).toBeDefined();
  });
});

// KAN-280 (Open now pane). The pane subscribes directly to the live chrome
// events a real window/tab/group change fires -- these tests prove the fake
// fires them the way Chrome does, through handle.browser.*, which models
// the BROWSER's own hand rather than an extension call.
describe('live browser events (KAN-280)', () => {
  test('openTab adds a tab to the window and tells onCreated listeners', async () => {
    const handle = setupChromeFake({
      windows: [{ id: 1, tabs: [{ url: 'https://a.test/' }] }],
    });
    const seen: number[] = [];
    chrome.tabs.onCreated.addListener((tab) => seen.push(tab.windowId));
    const tab = handle.browser.openTab(1, {
      url: 'https://b.test/',
      title: 'B',
    });
    const [win] = await chrome.windows.getAll({
      populate: true,
      windowTypes: ['normal'],
    });
    expect(win.tabs?.map((t) => t.url)).toEqual([
      'https://a.test/',
      'https://b.test/',
    ]);
    expect(seen).toEqual([1]);
    expect(tab.id).toEqual(expect.any(Number));
    handle.restore();
  });

  test('closeTab removes the tab and tells onRemoved; an unknown id throws', async () => {
    const handle = setupChromeFake({
      windows: [
        {
          id: 1,
          tabs: [{ url: 'https://a.test/' }, { url: 'https://b.test/' }],
        },
      ],
    });
    const [win] = await chrome.windows.getAll({
      populate: true,
      windowTypes: ['normal'],
    });
    const removed: number[] = [];
    chrome.tabs.onRemoved.addListener((id) => removed.push(id));
    const first = win.tabs?.[0]?.id ?? -1;
    handle.browser.closeTab(first);
    const [after] = await chrome.windows.getAll({
      populate: true,
      windowTypes: ['normal'],
    });
    expect(after.tabs?.map((t) => t.url)).toEqual(['https://b.test/']);
    expect(removed).toEqual([first]);
    expect(() => handle.browser.closeTab(987654)).toThrow();
    handle.restore();
  });

  // Switching tabs changes only which tab is active, and Chrome reports it
  // through onActivated alone -- no onUpdated follows.
  test('activateTab moves active within its window only and tells onActivated; an unknown id throws', async () => {
    const handle = setupChromeFake({
      windows: [
        {
          id: 1,
          tabs: [
            { id: 11, url: 'https://a.test/', active: true },
            { id: 12, url: 'https://b.test/' },
          ],
        },
        { id: 2, tabs: [{ id: 21, url: 'https://c.test/', active: true }] },
      ],
    });
    const seen: chrome.tabs.OnActivatedInfo[] = [];
    chrome.tabs.onActivated.addListener((info) => seen.push(info));

    handle.browser.activateTab(12);

    const windows = await chrome.windows.getAll({
      populate: true,
      windowTypes: ['normal'],
    });
    expect(
      windows.map((win) => win.tabs?.map((tab) => [tab.id, tab.active]))
    ).toEqual([
      [
        [11, false],
        [12, true],
      ],
      [[21, true]],
    ]);
    expect(seen).toEqual([{ tabId: 12, windowId: 1 }]);
    expect(() => handle.browser.activateTab(987654)).toThrow();
    handle.restore();
  });

  test('removeListener detaches, and liveEventListenerCount says so', () => {
    const handle = setupChromeFake();
    const base = handle.liveEventListenerCount();
    const fn = () => undefined;
    chrome.tabs.onUpdated.addListener(fn);
    chrome.windows.onRemoved.addListener(fn);
    expect(handle.liveEventListenerCount()).toBe(base + 2);
    chrome.tabs.onUpdated.removeListener(fn);
    chrome.windows.onRemoved.removeListener(fn);
    expect(handle.liveEventListenerCount()).toBe(base);
    handle.restore();
  });

  test('moveTabToWindow fires onDetached then onAttached, and the tab changes window', async () => {
    const handle = setupChromeFake({
      windows: [
        { id: 1, tabs: [{ url: 'https://a.test/' }] },
        { id: 2, tabs: [{ url: 'https://b.test/' }] },
      ],
    });
    const order: string[] = [];
    chrome.tabs.onDetached.addListener(() => order.push('detached'));
    chrome.tabs.onAttached.addListener(() => order.push('attached'));
    const [w1] = await chrome.windows.getAll({
      populate: true,
      windowTypes: ['normal'],
    });
    handle.browser.moveTabToWindow(w1.tabs?.[0]?.id ?? -1, 2);
    const all = await chrome.windows.getAll({
      populate: true,
      windowTypes: ['normal'],
    });
    expect(all.find((w) => w.id === 2)?.tabs?.map((t) => t.url)).toEqual([
      'https://b.test/',
      'https://a.test/',
    ]);
    expect(order).toEqual(['detached', 'attached']);
    handle.restore();
  });

  // Task 3's "This window follows the tab view" pane re-reads
  // tabs.getCurrent() on every refresh so the "This window" tag stays on
  // whichever window the tab view itself is now in. getCurrent must see the
  // move, not the window the tab view opened in.
  test('getCurrent follows the tab that moveTabToWindow moved', async () => {
    const handle = setupChromeFake({
      windows: [
        { id: 1, tabs: [{ id: 501, url: 'https://tab-keeper.test/' }] },
        { id: 2, tabs: [{ url: 'https://b.test/' }] },
      ],
      currentTabId: 501,
    });

    handle.browser.moveTabToWindow(501, 2);

    const current = await chrome.tabs.getCurrent();
    expect(current?.windowId).toBe(2);
    handle.restore();
  });

  // Chrome answers with a copy. A live object would let a caller that asked
  // once see every later move anyway, hiding a stale read (KAN-280).
  test('getCurrent answers a snapshot: a later move does not change a tab it already returned', async () => {
    const handle = setupChromeFake({
      windows: [
        { id: 1, tabs: [{ id: 501, url: 'https://tab-keeper.test/' }] },
        { id: 2, tabs: [{ url: 'https://b.test/' }] },
      ],
      currentTabId: 501,
    });
    const before = await chrome.tabs.getCurrent();

    handle.browser.moveTabToWindow(501, 2);

    expect(before?.windowId).toBe(1);
    handle.restore();
  });

  test('windowsGetAllCalls counts every getAll', async () => {
    const handle = setupChromeFake();
    await chrome.windows.getAll({});
    await chrome.windows.getAll({ populate: true });
    expect(handle.windowsGetAllCalls).toBe(2);
    handle.restore();
  });

  test('closeWindow removes the window and its tabs, and tells onRemoved', async () => {
    const handle = setupChromeFake({
      windows: [
        { id: 1, tabs: [{ url: 'https://a.test/' }] },
        { id: 2, tabs: [{ url: 'https://b.test/' }] },
      ],
    });
    const removed: number[] = [];
    chrome.windows.onRemoved.addListener((id) => removed.push(id));

    handle.browser.closeWindow(1);

    const all = await chrome.windows.getAll({
      populate: true,
      windowTypes: ['normal'],
    });
    expect(all.map((w) => w.id)).toEqual([2]);
    const remainingTabs = await chrome.tabs.query({});
    expect(remainingTabs.map((t) => t.url)).toEqual(['https://b.test/']);
    expect(removed).toEqual([1]);
    handle.restore();
  });

  test('setGroup applies title, color and collapsed, and tells onUpdated', async () => {
    const handle = setupChromeFake({
      windows: [{ id: 1 }],
      tabGroups: [
        { id: 5, windowId: 1, title: 'Old', color: 'grey', collapsed: false },
      ],
    });
    const seen: chrome.tabGroups.TabGroup[] = [];
    chrome.tabGroups.onUpdated.addListener((group) => seen.push(group));

    handle.browser.setGroup(5, {
      title: 'New',
      color: 'blue',
      collapsed: true,
    });

    const [group] = await chrome.tabGroups.query({ windowId: 1 });
    expect(group).toMatchObject({
      title: 'New',
      color: 'blue',
      collapsed: true,
    });
    expect(seen).toEqual([group]);
    handle.restore();
  });

  test('windows.update applies focused and returns the window', async () => {
    const handle = setupChromeFake({ windows: [{ id: 1, focused: false }] });

    const updated = await chrome.windows.update(1, { focused: true });

    expect(updated.focused).toBe(true);
    const [win] = await chrome.windows.getAll({});
    expect(win.focused).toBe(true);
    handle.restore();
  });

  test('hasListener reports whether a given function is registered', () => {
    const handle = setupChromeFake();
    const fn = () => undefined;

    expect(chrome.tabs.onCreated.hasListener(fn)).toBe(false);
    chrome.tabs.onCreated.addListener(fn);
    expect(chrome.tabs.onCreated.hasListener(fn)).toBe(true);
    chrome.tabs.onCreated.removeListener(fn);
    expect(chrome.tabs.onCreated.hasListener(fn)).toBe(false);
    handle.restore();
  });

  test('tabGroupsApiAbsent leaves chrome.tabGroups undefined, as Chrome does while the permission is ungranted', () => {
    const handle = setupChromeFake({ tabGroupsApiAbsent: true });

    expect(chrome.tabGroups).toBeUndefined();
    handle.restore();
  });

  // CONTROL: without the flag, chrome.tabGroups is defined -- proves the
  // assertion above exercises the flag, not an accident of the fake always
  // leaving the member undefined.
  test('CONTROL: without tabGroupsApiAbsent, chrome.tabGroups stays defined', () => {
    const handle = setupChromeFake();

    expect(chrome.tabGroups).toBeDefined();
    handle.restore();
  });
});

// KAN-280 O8: Reopen closes and recreates tabs and windows through these
// same extension calls, and Open now refreshes off the events Chrome fires
// for them -- so the fake has to fire tabs.onRemoved/onCreated,
// windows.onRemoved/onCreated and tabGroups.onUpdated for its OWN calls,
// not just for handle.browser.*'s simulated user actions.
describe('extension calls fire what Chrome fires (KAN-280 Part B)', () => {
  test('tabs.remove removes the tab, reindexes, and fires onRemoved', async () => {
    const handle = setupChromeFake({
      windows: [
        {
          id: 1,
          tabs: [
            { url: 'https://a.test/' },
            { url: 'https://b.test/' },
            { url: 'https://c.test/' },
          ],
        },
      ],
    });
    const [win] = await chrome.windows.getAll({
      populate: true,
      windowTypes: ['normal'],
    });
    const [a, b, c] = win.tabs ?? [];
    const seen: [number, chrome.tabs.OnRemovedInfo][] = [];
    chrome.tabs.onRemoved.addListener((id, info) => seen.push([id, info]));
    const bId: number = b.id ?? -1;
    await chrome.tabs.remove(bId);
    const [after] = await chrome.windows.getAll({
      populate: true,
      windowTypes: ['normal'],
    });
    expect(after.tabs?.map((t) => [t.url, t.index])).toEqual([
      ['https://a.test/', 0],
      ['https://c.test/', 1],
    ]);
    expect(seen).toEqual([[bId, { windowId: 1, isWindowClosing: false }]]);
    expect(handle.removedTabIds).toEqual([bId]);
    expect([a.id, c.id]).not.toContain(bId);
    handle.restore();
  });

  test("tabs.remove of a window's last tab closes the window, as Chrome does", async () => {
    const handle = setupChromeFake({
      windows: [
        { id: 1, tabs: [{ url: 'https://a.test/' }] },
        { id: 2, tabs: [{ url: 'https://b.test/' }] },
      ],
    });
    const [, second] = await chrome.windows.getAll({
      populate: true,
      windowTypes: ['normal'],
    });
    const order: string[] = [];
    chrome.tabs.onRemoved.addListener((_id, info) =>
      order.push(`tab closing=${info.isWindowClosing}`)
    );
    chrome.windows.onRemoved.addListener((id) => order.push(`window ${id}`));
    const secondTabId: number = second.tabs?.[0]?.id ?? -1;
    await chrome.tabs.remove(secondTabId);
    expect(order).toEqual(['tab closing=true', 'window 2']);
    expect(
      (await chrome.windows.getAll({ windowTypes: ['normal'] })).map(
        (w) => w.id
      )
    ).toEqual([1]);
    handle.restore();
  });

  // A bare `tabs: [...]` seed places a tab in DEFAULT_WINDOW_ID without
  // ever declaring that window -- a fake-only convenience, not a real
  // browser window. Losing its last tab must not report a window closing
  // that never existed.
  test('tabs.remove of a tab in a window the seed never declared does not fire windows.onRemoved', async () => {
    const handle = setupChromeFake({ tabs: [{ id: 11 }] });
    const removed: number[] = [];
    chrome.windows.onRemoved.addListener((id) => removed.push(id));

    await chrome.tabs.remove(11);

    expect(removed).toEqual([]);
    handle.restore();
  });

  test('tabs.remove rejects on an unknown id and removes nothing', async () => {
    const handle = setupChromeFake({
      windows: [{ id: 1, tabs: [{ url: 'https://a.test/' }] }],
    });
    await expect(chrome.tabs.remove(424242)).rejects.toThrow(
      'No tab with id: 424242.'
    );
    expect((await chrome.tabs.query({})).length).toBe(1);
    handle.restore();
  });

  // Chromium's TabsRemoveFunction::Run loops the ids and removes each in
  // order, stopping at the first it cannot find -- it does not check every
  // id before touching any of them.
  test('a batch stops at the first unknown id: ids before it are already closed, ids after are untouched', async () => {
    const handle = setupChromeFake({
      windows: [
        {
          id: 1,
          tabs: [{ url: 'https://a.test/' }, { url: 'https://b.test/' }],
        },
      ],
    });
    const [win] = await chrome.windows.getAll({
      populate: true,
      windowTypes: ['normal'],
    });
    const [a, b] = win.tabs ?? [];
    const aId: number = a.id ?? -1;
    const bId: number = b.id ?? -1;
    await expect(chrome.tabs.remove([aId, 424242, bId])).rejects.toThrow(
      'No tab with id: 424242.'
    );
    const remaining = await chrome.tabs.query({});
    expect(remaining.map((t) => t.url)).toEqual(['https://b.test/']);
    handle.restore();
  });

  test('tabs.create with no windowId lands in the current (first-seeded) window', async () => {
    const handle = setupChromeFake({
      windows: [
        { id: 7, tabs: [{ url: 'https://a.test/' }] },
        { id: 8, tabs: [{ url: 'https://b.test/' }] },
      ],
    });
    const created = await chrome.tabs.create({ url: 'https://new.test/' });
    expect(created.windowId).toBe(7);
    const [win7] = await chrome.windows.getAll({
      populate: true,
      windowTypes: ['normal'],
    });
    expect(win7.tabs?.map((t) => t.url)).toEqual([
      'https://a.test/',
      'https://new.test/',
    ]);
    handle.restore();
  });

  // background.ts:62 calls chrome.windows.remove(id, () => { void
  // chrome.runtime.lastError; }) for a window the user may have already
  // closed. Chrome (MV3) never rejects a callback-style call -- it reports
  // failure through lastError instead, only for the callback's duration.
  test('windows.remove with a callback reports through lastError instead of rejecting', async () => {
    const handle = setupChromeFake({
      windows: [{ id: 1, tabs: [{ url: 'https://a.test/' }] }],
    });
    let calls = 0;
    let seenDuringCallback: string | undefined;
    const result = await new Promise<undefined>((resolve) => {
      chrome.windows.remove(424242, () => {
        calls += 1;
        seenDuringCallback = chrome.runtime.lastError?.message;
        resolve(undefined);
      });
    });
    expect(result).toBeUndefined();
    expect(calls).toBe(1);
    expect(seenDuringCallback).toBe('No window with id: 424242.');
    expect(chrome.runtime.lastError).toBeUndefined();
    handle.restore();
  });

  // Every other failure path added by this file shares the same `fail`
  // helper as windows.remove above -- this proves each one is actually
  // wired to it, not just the one production call site.
  test('every other failure path also reports through lastError with a callback, never rejecting', async () => {
    const handle = setupChromeFake({
      windows: [{ id: 1, tabs: [{ url: 'https://a.test/' }] }],
      tabGroups: [{ id: 5, windowId: 1 }],
      refusedUrls: ['file:///nope'],
    });
    const seen: (string | undefined)[] = [];
    await new Promise<void>((resolve) =>
      chrome.tabs.remove(424242, () => {
        seen.push(chrome.runtime.lastError?.message);
        resolve();
      })
    );
    await new Promise<void>((resolve) =>
      chrome.windows.get(424242, undefined, () => {
        seen.push(chrome.runtime.lastError?.message);
        resolve();
      })
    );
    await new Promise<void>((resolve) =>
      chrome.windows.update(424242, {}, () => {
        seen.push(chrome.runtime.lastError?.message);
        resolve();
      })
    );
    await new Promise<void>((resolve) =>
      chrome.tabs.create({ windowId: 424242, url: 'https://x.test/' }, () => {
        seen.push(chrome.runtime.lastError?.message);
        resolve();
      })
    );
    await new Promise<void>((resolve) =>
      chrome.windows.create({ url: 'file:///nope' }, () => {
        seen.push(chrome.runtime.lastError?.message);
        resolve();
      })
    );
    await new Promise<void>((resolve) =>
      chrome.tabGroups.get(424242, () => {
        seen.push(chrome.runtime.lastError?.message);
        resolve();
      })
    );
    await new Promise<void>((resolve) =>
      chrome.tabGroups.update(424242, { collapsed: true }, () => {
        seen.push(chrome.runtime.lastError?.message);
        resolve();
      })
    );
    expect(seen).toEqual([
      'No tab with id: 424242.',
      'No window with id: 424242.',
      'No window with id: 424242.',
      'No window with id: 424242.',
      'Cannot create a tab with url: file:///nope',
      'No group with id: 424242.',
      'No group with id: 424242.',
    ]);
    expect(chrome.runtime.lastError).toBeUndefined();
    handle.restore();
  });

  test('windows.remove takes its tabs with it and fires both events', async () => {
    const handle = setupChromeFake({
      windows: [
        { id: 1, tabs: [{ url: 'https://a.test/' }] },
        {
          id: 2,
          tabs: [{ url: 'https://b.test/' }, { url: 'https://c.test/' }],
        },
      ],
    });
    const events: string[] = [];
    chrome.tabs.onRemoved.addListener((_id, info) =>
      events.push(`tab w${info.windowId} closing=${info.isWindowClosing}`)
    );
    chrome.windows.onRemoved.addListener((id) => events.push(`window ${id}`));
    await chrome.windows.remove(2);
    expect(events).toEqual([
      'tab w2 closing=true',
      'tab w2 closing=true',
      'window 2',
    ]);
    expect((await chrome.tabs.query({})).map((t) => t.url)).toEqual([
      'https://a.test/',
    ]);
    await expect(chrome.windows.remove(2)).rejects.toThrow(
      'No window with id: 2.'
    );
    handle.restore();
  });

  test('tabs.create honours index (clamped), pinned and active, and fires onCreated', async () => {
    const handle = setupChromeFake({
      windows: [
        {
          id: 1,
          tabs: [
            { url: 'https://p.test/', pinned: true },
            { url: 'https://a.test/', active: true },
            { url: 'https://b.test/' },
          ],
        },
      ],
    });
    const created: string[] = [];
    chrome.tabs.onCreated.addListener((tab) => created.push(tab.url ?? ''));
    await chrome.tabs.create({
      windowId: 1,
      url: 'https://mid.test/',
      index: 2,
      active: false,
    });
    await chrome.tabs.create({
      windowId: 1,
      url: 'https://far.test/',
      index: 99,
      active: true,
    });
    // Unpinned at index 0 is pushed past the pinned run.
    await chrome.tabs.create({
      windowId: 1,
      url: 'https://first.test/',
      index: 0,
      active: false,
    });
    await chrome.tabs.create({
      windowId: 1,
      url: 'https://pin2.test/',
      index: 5,
      pinned: true,
      active: false,
    });
    const tabs = await chrome.tabs.query({ windowId: 1 });
    const sorted = [...tabs].sort((x, y) => x.index - y.index);
    expect(sorted.map((t) => t.url)).toEqual([
      'https://p.test/',
      'https://pin2.test/',
      'https://first.test/',
      'https://a.test/',
      'https://mid.test/',
      'https://b.test/',
      'https://far.test/',
    ]);
    expect(sorted.filter((t) => t.active).map((t) => t.url)).toEqual([
      'https://far.test/',
    ]);
    expect(created).toEqual([
      'https://mid.test/',
      'https://far.test/',
      'https://first.test/',
      'https://pin2.test/',
    ]);
    await expect(
      chrome.tabs.create({ windowId: 77, url: 'https://x.test/' })
    ).rejects.toThrow('No window with id: 77.');
    handle.restore();
  });

  test('windows.create honours bounds, state and incognito; with no url it opens a new tab page', async () => {
    const handle = setupChromeFake({
      windows: [{ id: 1, tabs: [{ url: 'https://a.test/' }] }],
    });
    const events: string[] = [];
    chrome.windows.onCreated.addListener(() => events.push('window'));
    chrome.tabs.onCreated.addListener((tab) => events.push(`tab ${tab.url}`));
    const win = await chrome.windows.create({
      left: 10,
      top: 20,
      width: 800,
      height: 600,
      focused: false,
      incognito: true,
    });
    expect(win).toMatchObject({
      left: 10,
      top: 20,
      width: 800,
      height: 600,
      focused: false,
      incognito: true,
    });
    expect(win?.tabs?.map((t) => t.url)).toEqual(['chrome://newtab/']);
    expect(events).toEqual(['window', 'tab chrome://newtab/']);
    handle.restore();
  });

  test('a url in refusedUrls makes tabs.create and windows.create reject', async () => {
    const handle = setupChromeFake({
      windows: [{ id: 1, tabs: [{ url: 'https://a.test/' }] }],
      refusedUrls: ['file:///secret'],
    });
    await expect(
      chrome.tabs.create({ windowId: 1, url: 'file:///secret' })
    ).rejects.toThrow('Cannot create a tab with url: file:///secret');
    await expect(
      chrome.windows.create({ url: 'file:///secret' })
    ).rejects.toThrow('Cannot create a tab with url: file:///secret');
    expect((await chrome.tabs.query({})).length).toBe(1);
    handle.restore();
  });

  test('windows.get and tabGroups.get reject on an unknown id; tabGroups.update fires onUpdated', async () => {
    const handle = setupChromeFake({
      windows: [{ id: 1, tabs: [{ url: 'https://a.test/' }] }],
      tabGroups: [{ id: 5, title: 'Kyoto', windowId: 1 }],
    });
    await expect(chrome.windows.get(9)).rejects.toThrow(
      'No window with id: 9.'
    );
    await expect(chrome.tabGroups.get(9)).rejects.toThrow(
      'No group with id: 9.'
    );
    const seen: boolean[] = [];
    chrome.tabGroups.onUpdated.addListener((g) => seen.push(g.collapsed));
    await chrome.tabGroups.update(5, { collapsed: true });
    expect(seen).toEqual([true]);
    expect((await chrome.tabGroups.get(5)).collapsed).toBe(true);
    handle.restore();
  });

  test('browser.updateTab, moveTabToWindow and setGroup throw on an unknown id', () => {
    const handle = setupChromeFake({
      windows: [{ id: 1, tabs: [{ url: 'https://a.test/' }] }],
    });
    expect(() => handle.browser.updateTab(424242, { title: 'x' })).toThrow(
      'browser.updateTab: no seeded tab with id 424242'
    );
    expect(() => handle.browser.moveTabToWindow(424242, 1)).toThrow(
      'browser.moveTabToWindow: no seeded tab with id 424242'
    );
    expect(() => handle.browser.setGroup(424242, { title: 'x' })).toThrow(
      'browser.setGroup: no seeded group with id 424242'
    );
    handle.restore();
  });
});
