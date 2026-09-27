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
    // tabs.create rejects for a windowId no window carries, as Chrome does,
    // and an unseeded fake has no window at all -- a bare `tabs: [...]`
    // seed relied on DEFAULT_WINDOW_ID being taken on faith, which real
    // Chrome never does.
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

  // KAN-311. The Reopen button's key hint follows the platform.
  test('getPlatformInfo reports linux unless a platform is seeded', async () => {
    handle = setupChromeFake();
    expect((await chrome.runtime.getPlatformInfo()).os).toBe('linux');
    handle.restore();

    handle = setupChromeFake({ platformOs: 'mac' });
    expect((await chrome.runtime.getPlatformInfo()).os).toBe('mac');
  });

  test('getPlatformInfo also takes a callback', () => {
    handle = setupChromeFake({ platformOs: 'win' });
    const cb = vi.fn();

    void chrome.runtime.getPlatformInfo(cb);

    expect(cb).toHaveBeenCalledWith(expect.objectContaining({ os: 'win' }));
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

// KAN-280 O10. The speaker button needs mutedInfo shaped exactly as real
// Chrome reports it, so the fake has to model chrome.tabs.update({muted})
// rather than the stray `muted` field the gap version wrote.
describe('mute (KAN-280 O10)', () => {
  test('a seeded tab reports the fields every real tab has', async () => {
    handle = setupChromeFake({
      windows: [{ tabs: [{ url: 'https://a.test/' }] }],
    });
    const [tab] = await chrome.tabs.query({});
    expect(tab.pinned).toBe(false);
    expect(tab.audible).toBe(false);
    expect(tab.mutedInfo).toEqual({ muted: false });
  });

  test("a seed's own mute and sound win over the defaults", async () => {
    handle = setupChromeFake({
      windows: [
        {
          tabs: [
            {
              url: 'https://a.test/',
              audible: true,
              mutedInfo: { muted: true },
            },
          ],
        },
      ],
    });
    const [tab] = await chrome.tabs.query({});
    expect(tab.audible).toBe(true);
    expect(tab.mutedInfo).toEqual({ muted: true });
  });

  test("update({muted}) sets mutedInfo as Chrome reports it, fires onUpdated once, and adds no 'muted' field", async () => {
    handle = setupChromeFake({
      windows: [{ tabs: [{ url: 'https://a.test/' }] }],
    });
    const [{ id }] = await chrome.tabs.query({});
    if (id === undefined) throw new Error('seeded tab has no id');
    const changes: chrome.tabs.OnUpdatedInfo[] = [];
    chrome.tabs.onUpdated.addListener((_id, change) => changes.push(change));

    const updated = await chrome.tabs.update(id, { muted: true });
    await chrome.tabs.update(id, { muted: true }); // a repeat: Chrome fires nothing

    const want = {
      muted: true,
      reason: 'extension',
      extensionId: 'faketestid',
    };
    expect(updated?.mutedInfo).toEqual(want);
    expect(changes).toEqual([{ mutedInfo: want }]);
    const [tab] = await chrome.tabs.query({});
    expect(Object.keys(tab)).not.toContain('muted');
  });

  test('update on an unknown id rejects and changes nothing', async () => {
    handle = setupChromeFake({
      windows: [{ tabs: [{ url: 'https://a.test/' }] }],
    });
    await expect(chrome.tabs.update(999999, { muted: true })).rejects.toThrow(
      'No tab with id: 999999.'
    );
  });

  // Chrome's own UI can mute a tab too, not just an extension -- Open now
  // (KAN-280) has to show through that the same way it shows extension mutes.
  test('browser.updateTab accepts mutedInfo and fires onUpdated with it', async () => {
    handle = setupChromeFake({
      windows: [{ tabs: [{ url: 'https://a.test/' }] }],
    });
    const [{ id }] = await chrome.tabs.query({});
    if (id === undefined) throw new Error('seeded tab has no id');
    const changes: chrome.tabs.OnUpdatedInfo[] = [];
    chrome.tabs.onUpdated.addListener((_id, change) => changes.push(change));

    handle.browser.updateTab(id, {
      mutedInfo: { muted: true, reason: 'user' },
    });

    expect(changes).toEqual([{ mutedInfo: { muted: true, reason: 'user' } }]);
    const [tab] = await chrome.tabs.query({});
    expect(tab.mutedInfo).toEqual({ muted: true, reason: 'user' });
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

  // The "This window follows the tab view" pane re-reads tabs.getCurrent()
  // on every refresh so the "This window" tag stays on whichever window the
  // tab view itself is now in. getCurrent must see the move, not the window
  // the tab view opened in.
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
describe('extension calls fire what Chrome fires (KAN-280 O8)', () => {
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

// KAN-280 Part D: Reopen restores through chrome.sessions when the optional
// `sessions` permission is held, so the fake models what Task 1 measured in
// Chromium 151 (docs/superpowers/plans/2026-09-27-open-now-part-d.md, "Task 1
// results"). Each test names the question it follows.
describe('chrome.sessions (KAN-280 Part D)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const normalWindows = () =>
    chrome.windows.getAll({ populate: true, windowTypes: ['normal'] });

  describe('presence follows the grant (Task 1, Q4)', () => {
    test('absent while sessions has never been granted', () => {
      handle = setupChromeFake();

      expect('sessions' in chrome).toBe(false);
      expect(chrome.sessions).toBeUndefined();
    });

    test('a seeded grant makes it present and usable from the start', async () => {
      handle = setupChromeFake({ grantedPermissions: ['sessions'] });

      expect(await chrome.sessions.getRecentlyClosed()).toEqual([]);
    });

    test('a grant makes it present on the SAME chrome object, with no reinstall', async () => {
      handle = setupChromeFake();
      const before = chrome;

      await chrome.permissions.request({ permissions: ['sessions'] });

      expect(chrome).toBe(before);
      expect(before.sessions).toBeDefined();
      expect(await before.sessions.getRecentlyClosed()).toEqual([]);
    });

    test('onAdded listeners already see chrome.sessions when the grant fires them', async () => {
      handle = setupChromeFake();
      const seen: boolean[] = [];
      chrome.permissions.onAdded.addListener(() =>
        seen.push(chrome.sessions !== undefined)
      );

      await chrome.permissions.request({ permissions: ['sessions'] });

      expect(seen).toEqual([true]);
    });

    test('after a revoke it stays defined, but every call throws SYNCHRONOUSLY', async () => {
      handle = setupChromeFake({ grantedPermissions: ['sessions'] });
      const held = chrome.sessions;

      await chrome.permissions.remove({ permissions: ['sessions'] });

      expect(chrome.sessions).toBeDefined();
      // A rejected promise would not satisfy toThrow: the throw has to happen
      // inside the call itself, before any promise exists.
      expect(() => chrome.sessions.getRecentlyClosed()).toThrow(
        "'sessions.getRecentlyClosed' is not available in this context."
      );
      expect(() => chrome.sessions.restore('1')).toThrow(
        "'sessions.restore' is not available in this context."
      );
      expect(() => held.getRecentlyClosed()).toThrow(
        "'sessions.getRecentlyClosed' is not available in this context."
      );
    });

    test('a re-grant makes it work again', async () => {
      handle = setupChromeFake({ grantedPermissions: ['sessions'] });
      await chrome.permissions.remove({ permissions: ['sessions'] });

      await chrome.permissions.request({ permissions: ['sessions'] });

      expect(await chrome.sessions.getRecentlyClosed()).toEqual([]);
    });

    test('requestNeverSettles grants nothing, so it stays absent', async () => {
      handle = setupChromeFake({ requestNeverSettles: true });

      void chrome.permissions.request({ permissions: ['sessions'] });
      await Promise.resolve();

      expect(chrome.sessions).toBeUndefined();
      expect(
        await chrome.permissions.contains({ permissions: ['sessions'] })
      ).toBe(false);
    });
  });

  test('permissions request/contains/remove and onAdded/onRemoved work for sessions', async () => {
    handle = setupChromeFake();
    const added: chrome.permissions.Permissions[] = [];
    const removed: chrome.permissions.Permissions[] = [];
    chrome.permissions.onAdded.addListener((p) => added.push(p));
    chrome.permissions.onRemoved.addListener((p) => removed.push(p));

    expect(
      await chrome.permissions.contains({ permissions: ['sessions'] })
    ).toBe(false);
    expect(
      await chrome.permissions.request({ permissions: ['sessions'] })
    ).toBe(true);
    expect(
      await chrome.permissions.contains({ permissions: ['sessions'] })
    ).toBe(true);
    await chrome.permissions.remove({ permissions: ['sessions'] });
    expect(
      await chrome.permissions.contains({ permissions: ['sessions'] })
    ).toBe(false);
    expect(added).toEqual([{ permissions: ['sessions'] }]);
    expect(removed).toEqual([{ permissions: ['sessions'] }]);
  });

  describe('getRecentlyClosed is fed by tabs.remove and windows.remove (Task 1, Q1, Q1b)', () => {
    test('a tabs.remove leaves a tab entry the moment it resolves, in Chrome shape', async () => {
      vi.spyOn(Date, 'now').mockReturnValue(1790519483993);
      handle = setupChromeFake({
        grantedPermissions: ['sessions'],
        windows: [
          {
            id: 1,
            tabs: [
              { id: 11, url: 'https://a.test/' },
              {
                id: 12,
                url: 'https://b.test/',
                title: 'B',
                pinned: false,
                groupId: 5,
              },
              { id: 13, url: 'https://c.test/', groupId: 5 },
            ],
          },
        ],
        tabGroups: [{ id: 5, title: 'G', windowId: 1 }],
      });

      await chrome.tabs.remove(12);
      const [entry, ...rest] = await chrome.sessions.getRecentlyClosed();

      expect(rest).toEqual([]);
      expect(entry.lastModified).toBe(1790519483);
      expect(entry.window).toBeUndefined();
      expect(entry.tab).toMatchObject({
        url: 'https://b.test/',
        title: 'B',
        index: 1,
        pinned: false,
        windowId: 0,
        groupId: 0,
      });
      expect(typeof entry.tab?.sessionId).toBe('string');
      expect(entry.tab).not.toHaveProperty('id');
    });

    test('newest first', async () => {
      handle = setupChromeFake({
        grantedPermissions: ['sessions'],
        windows: [
          {
            id: 1,
            tabs: [
              { id: 11, url: 'https://a.test/' },
              { id: 12, url: 'https://b.test/' },
              { id: 13, url: 'https://c.test/' },
            ],
          },
        ],
      });

      await chrome.tabs.remove(11);
      await chrome.tabs.remove(12);
      const entries = await chrome.sessions.getRecentlyClosed();

      expect(entries.map((e) => e.tab?.url)).toEqual([
        'https://b.test/',
        'https://a.test/',
      ]);
      expect(entries[0].tab?.sessionId).not.toBe(entries[1].tab?.sessionId);
    });

    test('holds at most 25 entries; older ones drop off', async () => {
      handle = setupChromeFake({
        grantedPermissions: ['sessions'],
        windows: [
          {
            id: 1,
            tabs: Array.from({ length: 31 }, (_, i) => ({
              id: 100 + i,
              url: `https://t${i}.test/`,
            })),
          },
        ],
      });

      for (let i = 0; i < 30; i += 1) await chrome.tabs.remove(100 + i);
      const entries = await chrome.sessions.getRecentlyClosed();

      expect(entries).toHaveLength(25);
      expect(entries[0].tab?.url).toBe('https://t29.test/');
      expect(entries[24].tab?.url).toBe('https://t5.test/');
    });

    test('maxResults narrows the list', async () => {
      handle = setupChromeFake({
        grantedPermissions: ['sessions'],
        windows: [
          {
            id: 1,
            tabs: [
              { id: 11, url: 'https://a.test/' },
              { id: 12, url: 'https://b.test/' },
              { id: 13, url: 'https://c.test/' },
            ],
          },
        ],
      });
      await chrome.tabs.remove([11, 12]);

      const entries = await chrome.sessions.getRecentlyClosed({
        maxResults: 1,
      });

      expect(entries.map((e) => e.tab?.url)).toEqual(['https://b.test/']);
    });

    test("the kind follows the CALL: a window's only tab closed with tabs.remove is a TAB entry (Q1b)", async () => {
      handle = setupChromeFake({
        grantedPermissions: ['sessions'],
        windows: [
          { id: 1, tabs: [{ id: 11, url: 'https://a.test/' }] },
          { id: 2, tabs: [{ id: 21, url: 'https://only.test/' }] },
        ],
      });

      await chrome.tabs.remove(21);
      const [entry] = await chrome.sessions.getRecentlyClosed();

      expect(entry.tab?.url).toBe('https://only.test/');
      expect(entry.window).toBeUndefined();
      await expect(chrome.windows.get(2)).rejects.toThrow(
        'No window with id: 2.'
      );
    });

    test('a windows.remove leaves a WINDOW entry whose tabs each carry their own sessionId, even for one tab (Q1b)', async () => {
      handle = setupChromeFake({
        grantedPermissions: ['sessions'],
        windows: [
          { id: 1, tabs: [{ id: 11, url: 'https://a.test/' }] },
          {
            id: 2,
            left: 100,
            top: 80,
            width: 700,
            height: 500,
            tabs: [
              { id: 21, url: 'https://x.test/', pinned: true },
              { id: 22, url: 'https://y.test/' },
            ],
          },
          { id: 3, tabs: [{ id: 31, url: 'https://solo.test/' }] },
        ],
      });

      await chrome.windows.remove(2);
      await chrome.windows.remove(3);
      const [solo, two] = await chrome.sessions.getRecentlyClosed();

      expect(solo.tab).toBeUndefined();
      expect(solo.window?.tabs?.map((t) => t.url)).toEqual([
        'https://solo.test/',
      ]);
      expect(two.tab).toBeUndefined();
      expect(two.window).not.toHaveProperty('id');
      expect(two.window).toMatchObject({ focused: false, left: 100 });
      expect(two.window?.tabs?.map((t) => [t.url, t.index, t.pinned])).toEqual([
        ['https://x.test/', 0, true],
        ['https://y.test/', 1, false],
      ]);
      const ids = [
        two.window?.sessionId,
        ...(two.window?.tabs ?? []).map((t) => t.sessionId),
      ];
      expect(ids.every((id) => typeof id === 'string')).toBe(true);
      expect(new Set(ids).size).toBe(3);
      expect(two.window?.tabs?.map((t) => [t.windowId, t.groupId])).toEqual([
        [0, 0],
        [0, 0],
      ]);
    });

    test('Chrome keeps its list whatever the grant: a close while ungranted is there after a grant', async () => {
      handle = setupChromeFake({
        windows: [
          {
            id: 1,
            tabs: [
              { id: 11, url: 'https://a.test/' },
              { id: 12, url: 'https://b.test/' },
            ],
          },
        ],
      });

      await chrome.tabs.remove(12);
      await chrome.permissions.request({ permissions: ['sessions'] });

      expect(
        (await chrome.sessions.getRecentlyClosed()).map((e) => e.tab?.url)
      ).toEqual(['https://b.test/']);
    });
  });

  describe('restore rejects a gone entry and changes nothing (Task 1, Q3)', () => {
    const seed = () =>
      setupChromeFake({
        grantedPermissions: ['sessions'],
        windows: [
          {
            id: 1,
            tabs: [
              { id: 11, url: 'https://a.test/' },
              { id: 12, url: 'https://b.test/' },
            ],
          },
        ],
      });

    test.each(['999999999', 'abc', ''])(
      'an id that never existed (%j)',
      async (id) => {
        handle = seed();
        await chrome.tabs.remove(12);

        await expect(chrome.sessions.restore(id)).rejects.toThrow(
          `Invalid session id: "${id}".`
        );

        expect((await chrome.tabs.query({})).map((t) => t.id)).toEqual([11]);
        expect(await chrome.sessions.getRecentlyClosed()).toHaveLength(1);
      }
    );

    test('the same id twice: the first restores, the second rejects', async () => {
      handle = seed();
      await chrome.tabs.remove(12);
      const [entry] = await chrome.sessions.getRecentlyClosed();
      const id = entry.tab?.sessionId ?? 'missing';

      await chrome.sessions.restore(id);
      const countAfterFirst = (await chrome.tabs.query({})).length;
      await expect(chrome.sessions.restore(id)).rejects.toThrow(
        `Invalid session id: "${id}".`
      );

      expect(countAfterFirst).toBe(2);
      expect((await chrome.tabs.query({})).length).toBe(2);
      expect(await chrome.sessions.getRecentlyClosed()).toEqual([]);
    });

    test('an id pushed out of the 25 rejects; the oldest still listed restores', async () => {
      handle = setupChromeFake({
        grantedPermissions: ['sessions'],
        windows: [
          {
            id: 1,
            tabs: Array.from({ length: 27 }, (_, i) => ({
              id: 100 + i,
              url: `https://t${i}.test/`,
            })),
          },
        ],
      });
      await chrome.tabs.remove(100);
      const [pushed] = await chrome.sessions.getRecentlyClosed();
      for (let i = 1; i <= 25; i += 1) await chrome.tabs.remove(100 + i);
      const entries = await chrome.sessions.getRecentlyClosed();
      const oldest = entries[entries.length - 1];
      const pushedId = pushed.tab?.sessionId ?? 'missing';

      await expect(chrome.sessions.restore(pushedId)).rejects.toThrow(
        `Invalid session id: "${pushedId}".`
      );
      const restored = await chrome.sessions.restore(
        oldest.tab?.sessionId ?? 'missing'
      );
      expect(restored.tab?.url).toBe('https://t1.test/');
    });

    test('with a callback, a gone id sets runtime.lastError instead of rejecting', async () => {
      handle = seed();
      const seen: (string | undefined)[] = [];

      await new Promise<void>((resolve) =>
        chrome.sessions.restore('nope', () => {
          seen.push(chrome.runtime.lastError?.message);
          resolve();
        })
      );

      expect(seen).toEqual(['Invalid session id: "nope".']);
    });
  });

  describe('restoring a tab entry (Task 1, Q2, Q2b)', () => {
    test('comes back in its still-open window at its old index, pinned as it was, active, focused, with a new id', async () => {
      handle = setupChromeFake({
        grantedPermissions: ['sessions'],
        windows: [
          {
            id: 1,
            focused: true,
            tabs: [{ id: 11, url: 'https://view.test/', active: true }],
          },
          {
            id: 2,
            tabs: [
              { id: 21, url: 'https://p.test/', pinned: true },
              { id: 22, url: 'https://q.test/', pinned: true },
              { id: 23, url: 'https://a.test/', active: true },
              { id: 24, url: 'https://b.test/' },
            ],
          },
        ],
      });
      await chrome.tabs.remove(22);
      const [entry] = await chrome.sessions.getRecentlyClosed();
      const created: number[] = [];
      chrome.tabs.onCreated.addListener((t) => created.push(t.id ?? -1));

      const result = await chrome.sessions.restore(
        entry.tab?.sessionId ?? 'missing'
      );

      const [view, target] = await normalWindows();
      const back = target.tabs?.find((t) => t.url === 'https://q.test/');
      expect(back).toMatchObject({ index: 1, pinned: true, active: true });
      expect(back?.id).not.toBe(22);
      expect(result.tab).toMatchObject({
        id: back?.id,
        windowId: 2,
        index: 1,
      });
      expect(result.lastModified).toBe(entry.lastModified);
      expect(created).toEqual([back?.id]);
      expect(target.tabs?.filter((t) => t.active).map((t) => t.url)).toEqual([
        'https://q.test/',
      ]);
      // Focus moves to the restore's window; the tab view's own window keeps
      // its active tab (Q2b, 25/25).
      expect([view.focused, target.focused]).toEqual([false, true]);
      expect(view.tabs?.map((t) => t.active)).toEqual([true]);
      expect(await chrome.sessions.getRecentlyClosed()).toEqual([]);
    });

    test('into a group that still has other tabs it lands at the END of that group, same group id', async () => {
      handle = setupChromeFake({
        grantedPermissions: ['sessions'],
        windows: [
          {
            id: 1,
            tabs: [
              { id: 11, url: 'https://a0.test/' },
              { id: 12, url: 'https://t.test/', groupId: 5 },
              { id: 13, url: 'https://a1.test/', groupId: 5 },
              { id: 14, url: 'https://z.test/' },
            ],
          },
        ],
        tabGroups: [{ id: 5, title: 'GT', color: 'red', windowId: 1 }],
      });
      await chrome.tabs.remove(12);
      const [entry] = await chrome.sessions.getRecentlyClosed();

      await chrome.sessions.restore(entry.tab?.sessionId ?? 'missing');

      const [win] = await normalWindows();
      expect(win.tabs?.map((t) => [t.url, t.index, t.groupId])).toEqual([
        ['https://a0.test/', 0, -1],
        ['https://a1.test/', 1, 5],
        ['https://t.test/', 2, 5],
        ['https://z.test/', 3, -1],
      ]);
    });

    test('a group that vanished with the tab comes back under the SAME id, title and colour', async () => {
      handle = setupChromeFake({
        grantedPermissions: ['sessions'],
        windows: [
          {
            id: 1,
            tabs: [
              { id: 11, url: 'https://a0.test/' },
              { id: 12, url: 'https://t.test/', groupId: 5 },
              { id: 13, url: 'https://a1.test/' },
            ],
          },
        ],
        tabGroups: [{ id: 5, title: 'GT', color: 'red', windowId: 1 }],
      });
      await chrome.tabs.remove(12);
      const groupsBefore = await chrome.tabGroups.query({});
      const [entry] = await chrome.sessions.getRecentlyClosed();
      const createdGroups: number[] = [];
      chrome.tabGroups.onCreated.addListener((g) => createdGroups.push(g.id));

      await chrome.sessions.restore(entry.tab?.sessionId ?? 'missing');

      const [win] = await normalWindows();
      expect(win.tabs?.map((t) => [t.url, t.index, t.groupId])).toEqual([
        ['https://a0.test/', 0, -1],
        ['https://t.test/', 1, 5],
        ['https://a1.test/', 2, -1],
      ]);
      expect(groupsBefore.map((g) => g.id)).toEqual([]);
      expect(await chrome.tabGroups.get(5)).toMatchObject({
        title: 'GT',
        color: 'red',
        windowId: 1,
      });
      expect(createdGroups).toEqual([5]);
    });

    test('a collapsed group it lands in is EXPANDED, and onUpdated fires', async () => {
      handle = setupChromeFake({
        grantedPermissions: ['sessions'],
        windows: [
          {
            id: 1,
            tabs: [
              { id: 11, url: 'https://a0.test/', active: true },
              { id: 12, url: 'https://t.test/', groupId: 5 },
              { id: 13, url: 'https://a1.test/', groupId: 5 },
            ],
          },
        ],
        tabGroups: [{ id: 5, title: 'GT', collapsed: true, windowId: 1 }],
      });
      await chrome.tabs.remove(12);
      const [entry] = await chrome.sessions.getRecentlyClosed();
      const updated: boolean[] = [];
      chrome.tabGroups.onUpdated.addListener((g) => updated.push(g.collapsed));

      await chrome.sessions.restore(entry.tab?.sessionId ?? 'missing');

      expect((await chrome.tabGroups.get(5)).collapsed).toBe(false);
      expect(updated).toEqual([false]);
    });

    test('if its window closed in the meantime, it comes back in a NEW focused window (Q1b)', async () => {
      handle = setupChromeFake({
        grantedPermissions: ['sessions'],
        windows: [
          { id: 1, focused: true, tabs: [{ id: 11, url: 'https://v.test/' }] },
          { id: 2, tabs: [{ id: 21, url: 'https://only.test/' }] },
        ],
      });
      await chrome.tabs.remove(21);
      const [entry] = await chrome.sessions.getRecentlyClosed();
      const windowsCreated: number[] = [];
      chrome.windows.onCreated.addListener((w) =>
        windowsCreated.push(w.id ?? -1)
      );

      const result = await chrome.sessions.restore(
        entry.tab?.sessionId ?? 'missing'
      );

      const all = await normalWindows();
      const fresh = all.find((w) => w.id === result.tab?.windowId);
      expect(all).toHaveLength(2);
      expect(result.tab?.windowId).not.toBe(2);
      expect(windowsCreated).toEqual([result.tab?.windowId]);
      expect(fresh?.focused).toBe(true);
      expect(fresh?.tabs?.map((t) => [t.url, t.index, t.active])).toEqual([
        ['https://only.test/', 0, true],
      ]);
      expect(all.find((w) => w.id === 1)?.focused).toBe(false);
    });
  });

  describe('restoring a window entry (Task 1, Q2, Q2b)', () => {
    const seed = (activeInGroup: boolean, collapsed = false) =>
      setupChromeFake({
        grantedPermissions: ['sessions'],
        windows: [
          {
            id: 1,
            focused: true,
            tabs: [{ id: 11, url: 'https://view.test/', active: true }],
          },
          {
            id: 2,
            left: 100,
            top: 80,
            width: 700,
            height: 500,
            state: 'normal',
            tabs: [
              { id: 21, url: 'https://pin.test/', pinned: true },
              {
                id: 22,
                url: 'https://hist.test/',
                title: 'Hist',
                active: !activeInGroup,
              },
              { id: 23, url: 'https://gx.test/', groupId: 7 },
              {
                id: 24,
                url: 'https://gy.test/',
                groupId: 7,
                active: activeInGroup,
              },
              { id: 25, url: 'https://z.test/' },
            ],
          },
        ],
        tabGroups: [
          { id: 7, title: 'GW', color: 'green', collapsed, windowId: 2 },
        ],
      });

    test('comes back as a NEW focused window with its bounds, tabs, pinned tab and active tab; its group under a NEW id', async () => {
      handle = seed(false);
      await chrome.windows.remove(2);
      const [entry] = await chrome.sessions.getRecentlyClosed();
      const order: string[] = [];
      chrome.windows.onCreated.addListener(() => order.push('window'));
      chrome.tabs.onCreated.addListener((t) => order.push(`tab ${t.url}`));

      const result = await chrome.sessions.restore(
        entry.window?.sessionId ?? 'missing'
      );

      const all = await normalWindows();
      const fresh = all.find((w) => w.id === result.window?.id);
      expect(fresh).toMatchObject({
        left: 100,
        top: 80,
        width: 700,
        height: 500,
        focused: true,
      });
      expect(fresh?.id).not.toBe(2);
      expect(all.find((w) => w.id === 1)?.focused).toBe(false);
      expect(result.window?.tabs?.map((t) => t.id)).toEqual(
        fresh?.tabs?.map((t) => t.id)
      );
      expect(result.lastModified).toBe(entry.lastModified);
      const groups = await chrome.tabGroups.query({ windowId: fresh?.id });
      expect(groups).toHaveLength(1);
      const [group] = groups;
      expect(group.id).not.toBe(7);
      expect(group).toMatchObject({
        title: 'GW',
        color: 'green',
        collapsed: false,
      });
      expect(
        fresh?.tabs?.map((t) => [t.url, t.index, t.pinned, t.active, t.groupId])
      ).toEqual([
        ['https://pin.test/', 0, true, false, -1],
        ['https://hist.test/', 1, false, true, -1],
        ['https://gx.test/', 2, false, false, group.id],
        ['https://gy.test/', 3, false, false, group.id],
        ['https://z.test/', 4, false, false, -1],
      ]);
      expect(order).toEqual([
        'window',
        'tab https://pin.test/',
        'tab https://hist.test/',
        'tab https://gx.test/',
        'tab https://gy.test/',
        'tab https://z.test/',
      ]);
      expect(await chrome.sessions.getRecentlyClosed()).toEqual([]);
    });

    test('a collapsed group stays collapsed under its new id', async () => {
      handle = seed(false, true);
      await chrome.windows.remove(2);
      const [entry] = await chrome.sessions.getRecentlyClosed();

      const result = await chrome.sessions.restore(
        entry.window?.sessionId ?? 'missing'
      );

      const [group] = await chrome.tabGroups.query({
        windowId: result.window?.id,
      });
      expect(group.collapsed).toBe(true);
    });

    test('whose active tab was in a group comes back with tab 0 active instead', async () => {
      handle = seed(true);
      await chrome.windows.remove(2);
      const [entry] = await chrome.sessions.getRecentlyClosed();

      const result = await chrome.sessions.restore(
        entry.window?.sessionId ?? 'missing'
      );

      expect(
        result.window?.tabs?.filter((t) => t.active).map((t) => t.url)
      ).toEqual(['https://pin.test/']);
    });
  });

  // Chrome's evidence of a real restore is the page's history.length (Q2),
  // which the fake has no page for. restoredFromSession is that evidence.
  describe('restoredFromSession', () => {
    test('true for a tab sessions.restore brought back, false for one tabs.create made', async () => {
      handle = setupChromeFake({
        grantedPermissions: ['sessions'],
        windows: [
          {
            id: 1,
            tabs: [
              { id: 11, url: 'https://a.test/' },
              { id: 12, url: 'https://b.test/' },
            ],
          },
          {
            id: 2,
            tabs: [
              { id: 21, url: 'https://w1.test/' },
              { id: 22, url: 'https://w2.test/' },
            ],
          },
        ],
      });
      await chrome.tabs.remove(12);
      await chrome.windows.remove(2);
      const [win, tab] = await chrome.sessions.getRecentlyClosed();

      const recreated = await chrome.tabs.create({
        windowId: 1,
        url: 'https://b.test/',
      });
      const restoredTab = await chrome.sessions.restore(
        tab.tab?.sessionId ?? 'missing'
      );
      const restoredWindow = await chrome.sessions.restore(
        win.window?.sessionId ?? 'missing'
      );

      expect(handle.restoredFromSession(recreated.id ?? -1)).toBe(false);
      expect(handle.restoredFromSession(11)).toBe(false);
      expect(handle.restoredFromSession(restoredTab.tab?.id ?? -1)).toBe(true);
      expect(
        (restoredWindow.window?.tabs ?? []).map(
          (t) => handle?.restoredFromSession(t.id ?? -1)
        )
      ).toEqual([true, true]);
    });

    test('throws on an id no tab carries, so a typo fails loudly', () => {
      handle = setupChromeFake();

      expect(() => handle?.restoredFromSession(424242)).toThrow(
        'restoredFromSession: no tab with id 424242'
      );
    });
  });

  describe('not modelled: no product code calls these', () => {
    test('restore() with no id throws', () => {
      handle = setupChromeFake({ grantedPermissions: ['sessions'] });

      expect(() => chrome.sessions.restore()).toThrow(/not modelled/);
    });

    test('restoring one inner tab of a window entry throws', async () => {
      handle = setupChromeFake({
        grantedPermissions: ['sessions'],
        windows: [
          { id: 1, tabs: [{ id: 11, url: 'https://a.test/' }] },
          {
            id: 2,
            tabs: [
              { id: 21, url: 'https://x.test/' },
              { id: 22, url: 'https://y.test/' },
            ],
          },
        ],
      });
      await chrome.windows.remove(2);
      const [entry] = await chrome.sessions.getRecentlyClosed();
      const inner = entry.window?.tabs?.[0]?.sessionId ?? 'missing';

      expect(() => chrome.sessions.restore(inner)).toThrow(/not modelled/);
    });
  });
});

// Chrome removes a group with its last tab. sessions.restore brings such a
// group back under its old id (Task 1, Q2), which the fake can only show if
// the group really went.
describe('a group goes with its last tab (KAN-280 Part D)', () => {
  test('tabs.remove of the last tab in a group drops the group and fires tabGroups.onRemoved', async () => {
    handle = setupChromeFake({
      windows: [
        {
          id: 1,
          tabs: [
            { id: 11, url: 'https://a.test/' },
            { id: 12, url: 'https://b.test/', groupId: 5 },
          ],
        },
      ],
      tabGroups: [{ id: 5, title: 'G', windowId: 1 }],
    });
    const removed: number[] = [];
    chrome.tabGroups.onRemoved.addListener((g) => removed.push(g.id));

    await chrome.tabs.remove(12);

    await expect(chrome.tabGroups.get(5)).rejects.toThrow(
      'No group with id: 5.'
    );
    expect(removed).toEqual([5]);
  });

  test('CONTROL: a group that still has a tab stays, and nothing fires', async () => {
    handle = setupChromeFake({
      windows: [
        {
          id: 1,
          tabs: [
            { id: 11, url: 'https://a.test/', groupId: 5 },
            { id: 12, url: 'https://b.test/', groupId: 5 },
          ],
        },
      ],
      tabGroups: [{ id: 5, title: 'G', windowId: 1 }],
    });
    const removed: number[] = [];
    chrome.tabGroups.onRemoved.addListener((g) => removed.push(g.id));

    await chrome.tabs.remove(12);

    expect((await chrome.tabGroups.get(5)).title).toBe('G');
    expect(removed).toEqual([]);
  });

  test('windows.remove drops the groups that lived in it', async () => {
    handle = setupChromeFake({
      windows: [
        { id: 1, tabs: [{ id: 11, url: 'https://a.test/', groupId: 4 }] },
        { id: 2, tabs: [{ id: 21, url: 'https://b.test/', groupId: 5 }] },
      ],
      tabGroups: [
        { id: 4, windowId: 1 },
        { id: 5, windowId: 2 },
      ],
    });
    const removed: number[] = [];
    chrome.tabGroups.onRemoved.addListener((g) => removed.push(g.id));

    await chrome.windows.remove(2);

    expect((await chrome.tabGroups.query({})).map((g) => g.id)).toEqual([4]);
    expect(removed).toEqual([5]);
  });
});

// KAN-280 Part D, Task 6. Reopen through chrome.sessions has to UNDO what a
// restore does to focus, the front tab, a group's collapsed state and the
// tab's index. Each of these is only testable if the fake keeps Chrome's
// invariants: one active tab per window, one focused window.
describe('one front tab per window, one focused window (KAN-280 Part D)', () => {
  const twoWindows = () =>
    setupChromeFake({
      windows: [
        {
          id: 1,
          focused: true,
          tabs: [
            { id: 11, url: 'https://a.test/', active: true },
            { id: 12, url: 'https://b.test/' },
          ],
        },
        {
          id: 2,
          tabs: [
            { id: 21, url: 'https://c.test/', active: true },
            { id: 22, url: 'https://d.test/', groupId: 5 },
            { id: 23, url: 'https://e.test/', groupId: 5 },
          ],
        },
      ],
      tabGroups: [{ id: 5, windowId: 2, collapsed: true }],
    });

  const activeIds = async () =>
    (await chrome.tabs.query({ active: true })).map((t) => t.id);

  test('tabs.update({active: true}) takes the front from the other tabs of its window only', async () => {
    handle = twoWindows();

    await chrome.tabs.update(12, { active: true });

    expect(await activeIds()).toEqual([12, 21]);
  });

  test('tabs.update({active: true}) on a tab in a collapsed group expands the group', async () => {
    handle = twoWindows();
    const updated: boolean[] = [];
    chrome.tabGroups.onUpdated.addListener((g) => updated.push(g.collapsed));

    await chrome.tabs.update(23, { active: true });

    expect((await chrome.tabGroups.get(5)).collapsed).toBe(false);
    expect(updated).toEqual([false]);
    expect(await activeIds()).toEqual([11, 23]);
  });

  test('CONTROL: activating a tab outside a collapsed group leaves it collapsed', async () => {
    handle = twoWindows();

    await chrome.tabs.update(21, { active: true });

    expect((await chrome.tabGroups.get(5)).collapsed).toBe(true);
  });

  test('windows.update({focused: true}) takes the focus from every other window', async () => {
    handle = twoWindows();

    await chrome.windows.update(2, { focused: true });

    const all = await chrome.windows.getAll({});
    expect(all.map((w) => [w.id, w.focused])).toEqual([
      [1, false],
      [2, true],
    ]);
  });

  test('getLastFocused is the seeded focused window, then the one focused since', async () => {
    handle = twoWindows();

    expect((await chrome.windows.getLastFocused()).id).toBe(1);
    await chrome.windows.update(2, { focused: true });
    expect((await chrome.windows.getLastFocused()).id).toBe(2);
  });

  test('getLastFocused follows a restore, which takes the focus (Task 1, Q2b)', async () => {
    handle = setupChromeFake({
      grantedPermissions: ['sessions'],
      windows: [
        { id: 1, focused: true, tabs: [{ id: 11, url: 'https://a.test/' }] },
        {
          id: 2,
          tabs: [
            { id: 21, url: 'https://c.test/', active: true },
            { id: 22, url: 'https://d.test/' },
          ],
        },
      ],
    });
    await chrome.tabs.remove(22);
    const [entry] = await chrome.sessions.getRecentlyClosed();

    await chrome.sessions.restore(entry.tab?.sessionId ?? 'missing');

    expect((await chrome.windows.getLastFocused()).id).toBe(2);
  });
});

// Chrome's tabs.move. Reopen puts a restored tab back at the index it closed
// at, because a restore lands it at the END of a group that still has other
// tabs (Task 1, Q2).
describe('chrome.tabs.move (KAN-280 Part D)', () => {
  const strip = async (windowId: number) =>
    (await chrome.tabs.query({ windowId }))
      .sort((a, b) => a.index - b.index)
      .map((t) => `${t.id}${t.groupId === -1 ? '' : `g${t.groupId}`}`);

  const seed = () =>
    setupChromeFake({
      windows: [
        {
          id: 1,
          tabs: [
            { id: 10, url: 'https://p.test/', pinned: true },
            { id: 11, url: 'https://a.test/', active: true },
            { id: 12, url: 'https://b.test/', groupId: 5 },
            { id: 13, url: 'https://c.test/', groupId: 5 },
            { id: 14, url: 'https://d.test/', groupId: 5 },
            { id: 15, url: 'https://e.test/' },
          ],
        },
      ],
      tabGroups: [{ id: 5, windowId: 1 }],
    });

  test('moves a tab to an index and fires tabs.onMoved', async () => {
    handle = seed();
    const moved: chrome.tabs.OnMovedInfo[] = [];
    chrome.tabs.onMoved.addListener((_id, info) => moved.push(info));

    const tab = await chrome.tabs.move(15, { index: 1 });

    expect(tab).toMatchObject({ id: 15, index: 1 });
    expect(await strip(1)).toEqual(['10', '15', '11', '12g5', '13g5', '14g5']);
    expect(moved).toEqual([{ windowId: 1, fromIndex: 5, toIndex: 1 }]);
  });

  test('an index past the end, or -1, lands last', async () => {
    handle = seed();

    await chrome.tabs.move(11, { index: 99 });
    expect(await strip(1)).toEqual(['10', '12g5', '13g5', '14g5', '15', '11']);
    await chrome.tabs.move(12, { index: -1 });
    expect(await strip(1)).toEqual(['10', '13g5', '14g5', '15', '11', '12']);
  });

  test('an unpinned tab cannot go before a pinned one', async () => {
    handle = seed();

    await chrome.tabs.move(15, { index: 0 });

    expect(await strip(1)).toEqual(['10', '15', '11', '12g5', '13g5', '14g5']);
  });

  test('a grouped tab moved within its group stays in it', async () => {
    handle = seed();

    await chrome.tabs.move(14, { index: 2 });

    expect(await strip(1)).toEqual(['10', '11', '14g5', '12g5', '13g5', '15']);
  });

  test('a grouped tab moved out of its group leaves it', async () => {
    handle = seed();

    await chrome.tabs.move(13, { index: 1 });

    expect(await strip(1)).toEqual(['10', '13', '11', '12g5', '14g5', '15']);
  });

  test('an ungrouped tab moved strictly inside a group joins it', async () => {
    handle = seed();

    await chrome.tabs.move(15, { index: 3 });

    expect(await strip(1)).toEqual([
      '10',
      '11',
      '12g5',
      '15g5',
      '13g5',
      '14g5',
    ]);
  });

  test('CONTROL: an ungrouped tab moved to a group edge stays ungrouped', async () => {
    handle = seed();

    await chrome.tabs.move(11, { index: 4 });

    expect(await strip(1)).toEqual(['10', '12g5', '13g5', '14g5', '11', '15']);
  });

  test('an unknown tab rejects and moves nothing', async () => {
    handle = seed();

    await expect(chrome.tabs.move(99, { index: 0 })).rejects.toThrow(
      'No tab with id: 99.'
    );
    expect(await strip(1)).toEqual(['10', '11', '12g5', '13g5', '14g5', '15']);
  });
});

describe('a restored window never has its front tab in a collapsed group', () => {
  // Task 1, Q2b: when the active tab was grouped, tab 0 comes back active.
  // Chrome never shows a front tab inside a collapsed group, so tab 0's own
  // group, if collapsed, comes back expanded -- the rule tabs.update follows
  // in this fake. Not measured for a restore: Task 1's tab 0 was pinned.
  test("tab 0's collapsed group is expanded when tab 0 comes back in front", async () => {
    handle = setupChromeFake({
      grantedPermissions: ['sessions', 'tabGroups'],
      windows: [
        { id: 1, focused: true, tabs: [{ id: 11, url: 'https://a.test/' }] },
        {
          id: 2,
          tabs: [
            { id: 21, url: 'https://x.test/', groupId: 51 },
            { id: 22, url: 'https://y.test/', groupId: 50, active: true },
          ],
        },
      ],
      tabGroups: [
        { id: 50, windowId: 2, title: 'Now' },
        { id: 51, windowId: 2, title: 'Later', collapsed: true },
      ],
    });
    await chrome.windows.remove(2);
    const [entry] = await chrome.sessions.getRecentlyClosed();

    const result = await chrome.sessions.restore(
      entry.window?.sessionId ?? 'missing'
    );

    const groups = await chrome.tabGroups.query({
      windowId: result.window?.id,
    });
    expect(groups.map((g) => [g.title, g.collapsed])).toEqual([
      ['Later', false],
      ['Now', false],
    ]);
    expect(result.window?.tabs?.[0]).toMatchObject({ active: true });
  });
});

describe('a restored window comes back normal (Task 1, Q2)', () => {
  test("the new window a window's only tab is restored into is normal", async () => {
    handle = setupChromeFake({
      grantedPermissions: ['sessions'],
      windows: [
        { id: 1, focused: true, tabs: [{ id: 11, url: 'https://a.test/' }] },
        { id: 2, tabs: [{ id: 21, url: 'https://c.test/' }] },
      ],
    });
    await chrome.tabs.remove(21);
    const [entry] = await chrome.sessions.getRecentlyClosed();

    const result = await chrome.sessions.restore(
      entry.tab?.sessionId ?? 'missing'
    );

    expect((await chrome.windows.get(result.tab?.windowId ?? -1)).state).toBe(
      'normal'
    );
  });

  test('a maximized window is restored in the normal state', async () => {
    handle = setupChromeFake({
      grantedPermissions: ['sessions'],
      windows: [
        { id: 1, focused: true, tabs: [{ id: 11, url: 'https://a.test/' }] },
        {
          id: 2,
          state: 'maximized',
          tabs: [{ id: 21, url: 'https://c.test/' }],
        },
      ],
    });
    await chrome.windows.remove(2);
    const [entry] = await chrome.sessions.getRecentlyClosed();

    const result = await chrome.sessions.restore(
      entry.window?.sessionId ?? 'missing'
    );

    expect(result.window?.state).toBe('normal');
    expect((await chrome.windows.get(result.window?.id ?? -1)).state).toBe(
      'normal'
    );
  });
});

// The worker answers the page through runtime.onMessage (KAN-280 Part D):
// the page sends, a listener registered with addListener gets the message,
// and returning true keeps the channel open for an asynchronous sendResponse.
describe('runtime messaging reaches onMessage listeners', () => {
  test('a listener gets the message and answers synchronously', async () => {
    handle = setupChromeFake();
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      sendResponse({ echoed: message });
    });

    expect(await chrome.runtime.sendMessage({ type: 'ping' })).toEqual({
      echoed: { type: 'ping' },
    });
  });

  test('a listener returning true answers later through sendResponse', async () => {
    handle = setupChromeFake();
    chrome.runtime.onMessage.addListener((_message, _sender, sendResponse) => {
      void Promise.resolve().then(() => sendResponse('later'));
      return true;
    });

    expect(await chrome.runtime.sendMessage({ type: 'ping' })).toBe('later');
  });

  test('the callback form gets the answer too', async () => {
    handle = setupChromeFake();
    chrome.runtime.onMessage.addListener((_message, _sender, sendResponse) => {
      void Promise.resolve().then(() => sendResponse('later'));
      return true;
    });
    const answer = await new Promise((resolve) =>
      chrome.runtime.sendMessage({ type: 'ping' }, resolve)
    );

    expect(answer).toBe('later');
  });

  test('a listener that neither answers nor returns true settles it undefined', async () => {
    handle = setupChromeFake();
    const heard: unknown[] = [];
    chrome.runtime.onMessage.addListener((message) => {
      heard.push(message);
    });

    expect(await chrome.runtime.sendMessage({ type: 'ping' })).toBeUndefined();
    expect(heard).toEqual([{ type: 'ping' }]);
  });

  test('with no listener it still resolves undefined, as before', async () => {
    handle = setupChromeFake();

    expect(await chrome.runtime.sendMessage({ type: 'ping' })).toBeUndefined();
    expect(handle.sentMessages).toEqual([{ type: 'ping' }]);
  });

  test('a removed listener hears nothing', async () => {
    handle = setupChromeFake();
    const heard: unknown[] = [];
    const listener = (message: unknown) => {
      heard.push(message);
    };
    chrome.runtime.onMessage.addListener(listener);
    chrome.runtime.onMessage.removeListener(listener);

    await chrome.runtime.sendMessage({ type: 'ping' });

    expect(heard).toEqual([]);
  });
});

describe('windows.create reports a state', () => {
  // Chrome reports every window's state; a window created without one is
  // normal. Reopen's equivalence tests compare a recreated window's state
  // with a restored one's (KAN-280 Part D).
  test('a window created without a state is normal', async () => {
    handle = setupChromeFake();

    const created = await chrome.windows.create({ focused: false });

    expect(created?.state).toBe('normal');
    expect((await chrome.windows.get(created?.id ?? -1)).state).toBe('normal');
  });
});
