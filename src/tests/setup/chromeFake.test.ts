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
    handle = setupChromeFake();

    chrome.tabs.create({ url: 'https://example.com/' });

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

  test('removeListener detaches, and listenerCount says so', () => {
    const handle = setupChromeFake();
    const base = handle.listenerCount();
    const fn = () => undefined;
    chrome.tabs.onUpdated.addListener(fn);
    chrome.windows.onRemoved.addListener(fn);
    expect(handle.listenerCount()).toBe(base + 2);
    chrome.tabs.onUpdated.removeListener(fn);
    chrome.windows.onRemoved.removeListener(fn);
    expect(handle.listenerCount()).toBe(base);
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
