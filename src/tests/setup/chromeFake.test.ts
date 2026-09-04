import { afterEach, describe, expect, test, vi } from 'vitest';

import { setupChromeFake } from './chrome.fake';

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
