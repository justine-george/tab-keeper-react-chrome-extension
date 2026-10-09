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
      incognitoAllowed: true,
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
        (restoredWindow.window?.tabs ?? []).map((t) =>
          handle?.restoredFromSession(t.id ?? -1)
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

// Measured 2026-10-07 in headless Chromium (KAN-458 Task 4 probe).
describe('tabs.update({pinned}) moves the tab to the pinned boundary (KAN-458)', () => {
  const strip = async (windowId: number) =>
    (await chrome.tabs.query({ windowId }))
      .sort((a, b) => a.index - b.index)
      .map((t) => `${t.id}${t.pinned ? '*' : ''}`);
  const seed = (pins: number) =>
    setupChromeFake({
      windows: [
        {
          id: 1,
          tabs: [10, 11, 12, 13].map((id, i) => ({
            id,
            url: `https://${id}.test/`,
            pinned: i < pins,
          })),
        },
      ],
    });
  const record = () => {
    const events: string[] = [];
    chrome.tabs.onUpdated.addListener((id, change) => {
      if ('pinned' in change) events.push(`updated ${id} ${change.pinned}`);
    });
    chrome.tabs.onMoved.addListener((id, info) =>
      events.push(`moved ${id} ${info.fromIndex}->${info.toIndex}`)
    );
    return events;
  };

  test('pinning lands the tab at the end of the pinned run, then fires onMoved', async () => {
    handle = seed(1);
    const events = record();

    const tab = await chrome.tabs.update(12, { pinned: true });

    expect(tab).toMatchObject({ index: 1, pinned: true });
    expect(await strip(1)).toEqual(['10*', '12*', '11', '13']);
    expect(events).toEqual(['updated 12 true', 'moved 12 2->1']);
  });

  test('unpinning lands the tab at the start of the unpinned run', async () => {
    handle = seed(3);
    const events = record();

    await chrome.tabs.update(10, { pinned: false });

    expect(await strip(1)).toEqual(['11*', '12*', '10', '13']);
    expect(events).toEqual(['updated 10 false', 'moved 10 0->2']);
  });

  test('CONTROL: pinning the first unpinned tab moves nothing', async () => {
    handle = seed(1);
    const events = record();

    await chrome.tabs.update(11, { pinned: true });

    expect(await strip(1)).toEqual(['10*', '11*', '12', '13']);
    expect(events).toEqual(['updated 11 true']);
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

describe('focusing a window keeps its state (KAN-280 Part D)', () => {
  // A minimized window: see "the fake follows what real Chrome measured"
  // below (Task 8, M1).
  test('CONTROL: focusing a maximized window leaves it maximized', async () => {
    handle = setupChromeFake({
      windows: [
        { id: 1, focused: true, tabs: [{ id: 11, url: 'https://a.test/' }] },
        {
          id: 2,
          state: 'maximized',
          tabs: [{ id: 21, url: 'https://c.test/' }],
        },
      ],
    });

    await chrome.windows.update(2, { focused: true });

    expect((await chrome.windows.get(2)).state).toBe('maximized');
  });
});

describe('handle.groupState reads a group without the tabGroups API', () => {
  // Without the tabGroups grant the extension cannot see groups, but the
  // browser still has them; tests of that case read them here.
  test('reads a group whose API is absent, and undefined for an unknown id', () => {
    handle = setupChromeFake({
      tabGroupsApiAbsent: true,
      windows: [
        { id: 1, tabs: [{ id: 11, url: 'https://a.test/', groupId: 5 }] },
      ],
      tabGroups: [{ id: 5, windowId: 1, title: 'G', collapsed: true }],
    });

    expect(chrome.tabGroups).toBeUndefined();
    expect(handle.groupState(5)).toMatchObject({ title: 'G', collapsed: true });
    expect(handle.groupState(6)).toBeUndefined();
  });
});

// Four rules Task 8 measured in real Chromium 151 (e2e/open-now-history.spec.ts,
// report sections "Measurements carried from the reviews" and "Other
// real-Chrome findings"), where the fake had modelled something else.
describe('the fake follows what real Chrome measured (Task 8, KAN-316)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const strip = async (windowId: number) =>
    (await chrome.tabs.query({ windowId }))
      .sort((a, b) => a.index - b.index)
      .map(
        (t) =>
          `${t.id}${t.active ? '*' : ''}${
            t.groupId === -1 ? '' : `g${t.groupId}`
          }`
      );

  // [A, X, B, Z] with Z in front; X closes, then A and B are grouped as a
  // collapsed H, so X's old index 1 is inside H's run.
  const collapsedAroundTheGap = async () => {
    const fake = setupChromeFake({
      grantedPermissions: ['sessions', 'tabGroups'],
      windows: [
        {
          id: 1,
          focused: true,
          tabs: [
            { id: 11, url: 'https://a.test/' },
            { id: 12, url: 'https://x.test/' },
            { id: 13, url: 'https://b.test/' },
            { id: 14, url: 'https://z.test/', active: true },
          ],
        },
      ],
    });
    await chrome.tabs.remove(12);
    const group = await chrome.tabs.group({
      createProperties: { windowId: 1 },
      tabIds: [11, 13],
    });
    await chrome.tabGroups.update(group, { title: 'H', collapsed: true });
    return { fake, group };
  };

  // Task 8, M2 raw: ["A[H,collapsed]","B[H,collapsed]","X*","Z"].
  test('M2 raw: an ungrouped tab whose old index is inside a group run is restored AFTER the run, and the group stays collapsed', async () => {
    const { fake, group } = await collapsedAroundTheGap();
    handle = fake;
    const [entry] = await chrome.sessions.getRecentlyClosed();

    const result = await chrome.sessions.restore(
      entry.tab?.sessionId ?? 'missing'
    );

    const x = result.tab?.id ?? -1;
    expect(await strip(1)).toEqual([
      `11g${group}`,
      `13g${group}`,
      `${x}*`,
      '14',
    ]);
    expect((await chrome.tabGroups.get(group)).collapsed).toBe(true);
  });

  // Task 8, M2 cause: the undo's move of the still-active restored tab into
  // H's run joined H and expanded it.
  test('M2 cause: an ACTIVE tab moved into a collapsed group run joins the group and expands it', async () => {
    const { fake, group } = await collapsedAroundTheGap();
    handle = fake;
    const [entry] = await chrome.sessions.getRecentlyClosed();
    const restored = await chrome.sessions.restore(
      entry.tab?.sessionId ?? 'missing'
    );
    const x = restored.tab?.id ?? -1;
    const updated: boolean[] = [];
    chrome.tabGroups.onUpdated.addListener((g) => updated.push(g.collapsed));

    await chrome.tabs.move(x, { index: 1 });

    expect(await strip(1)).toEqual([
      `11g${group}`,
      `${x}*g${group}`,
      `13g${group}`,
      '14',
    ]);
    expect((await chrome.tabGroups.get(group)).collapsed).toBe(false);
    expect(updated).toEqual([false]);
  });

  test('M2 cause, CONTROL: an INACTIVE tab moved into a collapsed group run joins it and leaves it collapsed', async () => {
    const { fake, group } = await collapsedAroundTheGap();
    handle = fake;
    const [entry] = await chrome.sessions.getRecentlyClosed();
    const restored = await chrome.sessions.restore(
      entry.tab?.sessionId ?? 'missing'
    );
    const x = restored.tab?.id ?? -1;
    await chrome.tabs.update(14, { active: true });

    await chrome.tabs.move(x, { index: 1 });

    expect(await strip(1)).toEqual([
      `11g${group}`,
      `${x}g${group}`,
      `13g${group}`,
      '14*',
    ]);
    expect((await chrome.tabGroups.get(group)).collapsed).toBe(true);
  });

  const withMinimized = () =>
    setupChromeFake({
      grantedPermissions: ['sessions'],
      windows: [
        { id: 1, focused: true, tabs: [{ id: 11, url: 'https://a.test/' }] },
        {
          id: 2,
          state: 'minimized',
          tabs: [
            { id: 21, url: 'https://c.test/', active: true },
            { id: 22, url: 'https://d.test/' },
          ],
        },
      ],
    });

  // Task 8, M1: `{"afterFocus":"minimized","afterRestore":"normal"}`.
  test('M1: windows.update({focused: true}) leaves a minimized window minimized', async () => {
    handle = withMinimized();

    await chrome.windows.update(2, { focused: true });

    expect((await chrome.windows.get(2)).state).toBe('minimized');
    expect((await chrome.windows.getLastFocused()).id).toBe(2);
  });

  test('M1: a restore into a minimized window makes it normal', async () => {
    handle = withMinimized();
    await chrome.tabs.remove(22);
    const [entry] = await chrome.sessions.getRecentlyClosed();

    await chrome.sessions.restore(entry.tab?.sessionId ?? 'missing');

    expect((await chrome.windows.get(2)).state).toBe('normal');
  });

  // Task 8, finding A (KAN-317): 7b measured history [3] for an ungrouped
  // tab and [1] for a grouped one after a window restore.
  test('finding A: a WINDOW restore brings its grouped tabs back without history, its ungrouped ones with it', async () => {
    handle = setupChromeFake({
      grantedPermissions: ['sessions', 'tabGroups'],
      windows: [
        { id: 1, focused: true, tabs: [{ id: 11, url: 'https://v.test/' }] },
        {
          id: 2,
          tabs: [
            { id: 21, url: 'https://loose.test/', active: true },
            { id: 22, url: 'https://g1.test/', groupId: 5 },
            { id: 23, url: 'https://g2.test/', groupId: 5 },
            { id: 24, url: 'https://end.test/' },
          ],
        },
      ],
      tabGroups: [{ id: 5, windowId: 2, title: 'G' }],
    });
    await chrome.windows.remove(2);
    const [entry] = await chrome.sessions.getRecentlyClosed();

    const result = await chrome.sessions.restore(
      entry.window?.sessionId ?? 'missing'
    );

    expect(
      (result.window?.tabs ?? []).map((t) => [
        t.url,
        t.groupId !== -1,
        handle?.restoredFromSession(t.id ?? -1),
      ])
    ).toEqual([
      ['https://loose.test/', false, true],
      ['https://g1.test/', true, false],
      ['https://g2.test/', true, false],
      ['https://end.test/', false, true],
    ]);
  });

  // Task 8, finding A: 4, 4b and 13 all gave history 3 for a grouped tab.
  test('finding A, CONTROL: a single-tab restore of a grouped tab keeps its history', async () => {
    handle = setupChromeFake({
      grantedPermissions: ['sessions', 'tabGroups'],
      windows: [
        {
          id: 1,
          tabs: [
            { id: 11, url: 'https://a.test/', active: true },
            { id: 12, url: 'https://g1.test/', groupId: 5 },
            { id: 13, url: 'https://g2.test/', groupId: 5 },
          ],
        },
      ],
      tabGroups: [{ id: 5, windowId: 1, title: 'G' }],
    });
    await chrome.tabs.remove(12);
    const [entry] = await chrome.sessions.getRecentlyClosed();

    const result = await chrome.sessions.restore(
      entry.tab?.sessionId ?? 'missing'
    );

    expect(result.tab?.groupId).toBe(5);
    expect(handle.restoredFromSession(result.tab?.id ?? -1)).toBe(true);
  });
});

// What real Chrome does when Open now's drag drops a tab or a group (KAN-280
// Part E). Every expectation is one Part E Task 1 measured in Chromium 151
// (docs/superpowers/plans/2026-09-28-open-now-part-e.md, "Task 1 results"),
// cited as "Part E Task 1, Qn".
describe('moves Chrome measured for Open now drag (KAN-280 Part E)', () => {
  // `P` pinned, `*` active, `gN` in group N.
  const strip = async (windowId: number) =>
    (await chrome.tabs.query({ windowId }))
      .sort((a, b) => a.index - b.index)
      .map(
        (t) =>
          `${t.id}${t.pinned ? 'P' : ''}${t.active ? '*' : ''}${
            t.groupId === -1 ? '' : `g${t.groupId}`
          }`
      );

  // Every event a move can fire, in the order they fired.
  const recordEvents = (): string[] => {
    const log: string[] = [];
    chrome.tabs.onMoved.addListener((id, info) =>
      log.push(`moved ${id} ${info.fromIndex}->${info.toIndex}`)
    );
    chrome.tabs.onUpdated.addListener((id, change) =>
      log.push(`updated ${id} ${JSON.stringify(change)}`)
    );
    chrome.tabs.onDetached.addListener((id, info) =>
      log.push(`detached ${id} w${info.oldWindowId}@${info.oldPosition}`)
    );
    chrome.tabs.onAttached.addListener((id, info) =>
      log.push(`attached ${id} w${info.newWindowId}@${info.newPosition}`)
    );
    chrome.tabs.onActivated.addListener((info) =>
      log.push(`activated ${info.tabId} w${info.windowId}`)
    );
    chrome.tabGroups.onCreated.addListener((g) =>
      log.push(`group created ${g.id} w${g.windowId}`)
    );
    chrome.tabGroups.onUpdated.addListener((g) =>
      log.push(`group updated ${g.id} collapsed=${g.collapsed}`)
    );
    chrome.tabGroups.onRemoved.addListener((g) =>
      log.push(`group removed ${g.id}`)
    );
    chrome.tabGroups.onMoved.addListener((g) =>
      log.push(`group moved ${g.id} w${g.windowId}`)
    );
    chrome.windows.onRemoved.addListener((id) =>
      log.push(`window removed ${id}`)
    );
    return log;
  };

  describe('tabs.move in one window joins or leaves a group (Part E Task 1, Q3, Q6)', () => {
    // [a*, g1@5, g2@5, b]
    const joinSeed = (active: 'a' | 'b', collapsed: boolean) =>
      setupChromeFake({
        windows: [
          {
            id: 1,
            tabs: [
              { id: 11, active: active === 'a' },
              { id: 12, groupId: 5 },
              { id: 13, groupId: 5 },
              { id: 14, active: active === 'b' },
            ],
          },
        ],
        tabGroups: [{ id: 5, windowId: 1, collapsed }],
      });

    test('a tab moved strictly inside a run fires onUpdated {groupId} BEFORE onMoved', async () => {
      handle = joinSeed('a', false);
      const log = recordEvents();

      await chrome.tabs.move(14, { index: 2 });

      expect(await strip(1)).toEqual(['11*', '12g5', '14g5', '13g5']);
      expect(log).toEqual(['updated 14 {"groupId":5}', 'moved 14 3->2']);
    });

    test('an active tab joining a collapsed group: onUpdated, onMoved, then the group expands', async () => {
      handle = joinSeed('b', true);
      const log = recordEvents();

      await chrome.tabs.move(14, { index: 2 });

      expect(await strip(1)).toEqual(['11', '12g5', '14*g5', '13g5']);
      expect(log).toEqual([
        'updated 14 {"groupId":5}',
        'moved 14 3->2',
        'group updated 5 collapsed=false',
      ]);
    });

    test('a grouped tab moved out of its run fires onUpdated {groupId:-1} BEFORE onMoved', async () => {
      handle = joinSeed('a', false);
      const log = recordEvents();

      await chrome.tabs.move(12, { index: 0 });

      expect(await strip(1)).toEqual(['12', '11*', '13g5', '14']);
      expect(log).toEqual(['updated 12 {"groupId":-1}', 'moved 12 1->0']);
    });

    test('CONTROL: a grouped tab moved within its run fires onMoved only', async () => {
      handle = joinSeed('a', false);
      const log = recordEvents();

      await chrome.tabs.move(12, { index: 2 });

      expect(await strip(1)).toEqual(['11*', '13g5', '12g5', '14']);
      expect(log).toEqual(['moved 12 1->2']);
    });
  });

  describe('tabs.move to another window (Part E Task 1, Q1, Q2, Q3, Q4, Q5)', () => {
    // W1 [a*, b, c], W2 [x*, y, z]
    const twoWindows = () =>
      setupChromeFake({
        windows: [
          {
            id: 1,
            tabs: [{ id: 11, active: true }, { id: 12 }, { id: 13 }],
          },
          {
            id: 2,
            tabs: [{ id: 21, active: true }, { id: 22 }, { id: 23 }],
          },
        ],
      });

    // Part E Task 1, Q1: the index is a slot in the destination AS IT
    // STANDS -- insert before the tab now at that index.
    test.each([
      [0, ['12', '21*', '22', '23'], 0],
      [1, ['21*', '12', '22', '23'], 1],
      [3, ['21*', '22', '23', '12'], 3],
      [-1, ['21*', '22', '23', '12'], 3],
      [99, ['21*', '22', '23', '12'], 3],
    ])(
      'index %i lands at the slot in the destination as it stands',
      async (index, destination, landed) => {
        handle = twoWindows();

        const tab = await chrome.tabs.move(12, { windowId: 2, index });

        expect(tab).toMatchObject({ id: 12, windowId: 2, index: landed });
        expect(await strip(1)).toEqual(['11*', '13']);
        expect(await strip(2)).toEqual(destination);
      }
    );

    test('fires onDetached then onAttached, and no onMoved', async () => {
      handle = twoWindows();
      const log = recordEvents();

      await chrome.tabs.move(12, { windowId: 2, index: 1 });

      expect(log).toEqual(['detached 12 w1@1', 'attached 12 w2@1']);
    });

    // Part E Task 1, Q5: Q1_cross#5 (a at 0 -> b) and Q5#3 (x in the
    // middle -> the tab to its right).
    test('the ACTIVE tab arrives inactive, and its old window activates the tab to its right', async () => {
      handle = twoWindows();
      const log = recordEvents();

      await chrome.tabs.move(11, { windowId: 2, index: 1 });

      expect(await strip(1)).toEqual(['12*', '13']);
      expect(await strip(2)).toEqual(['21*', '11', '22', '23']);
      expect(log).toEqual([
        'detached 11 w1@0',
        'activated 12 w1',
        'attached 11 w2@1',
      ]);
    });

    // Part E Task 6a fix round 1, F1 CONTROL (also E3 CONTROL, B#1): the
    // active tab was its window's last, and no tab has an opener.
    test('an ACTIVE last tab leaving activates the tab to its left', async () => {
      handle = setupChromeFake({
        windows: [
          { id: 1, tabs: [{ id: 11 }, { id: 12 }, { id: 13, active: true }] },
          { id: 2, tabs: [{ id: 21, active: true }] },
        ],
      });

      await chrome.tabs.move(13, { windowId: 2, index: 0 });

      expect(await strip(1)).toEqual(['11', '12*']);
      expect(await strip(2)).toEqual(['13', '21*']);
    });

    test('CONTROL: an inactive tab leaving changes no active tab and fires no onActivated', async () => {
      handle = twoWindows();
      const log = recordEvents();

      await chrome.tabs.move(13, { windowId: 2, index: 0 });

      expect(await strip(1)).toEqual(['11*', '12']);
      expect(await strip(2)).toEqual(['13', '21*', '22', '23']);
      expect(log.filter((line) => line.startsWith('activated'))).toEqual([]);
    });

    // W1 [p1P*, a, b], W2 [q1P*, q2P, x, y]
    const pinnedWindows = () =>
      setupChromeFake({
        windows: [
          {
            id: 1,
            tabs: [
              { id: 11, pinned: true, active: true },
              { id: 12 },
              { id: 13 },
            ],
          },
          {
            id: 2,
            tabs: [
              { id: 21, pinned: true, active: true },
              { id: 22, pinned: true },
              { id: 23 },
              { id: 24 },
            ],
          },
        ],
      });

    // Part E Task 1, Q2: Q2#8 (index 3) and Q2#9 (index 0, lands at 2).
    test.each([
      [3, ['21P*', '22P', '23', '11', '24'], 3],
      [0, ['21P*', '22P', '11', '23', '24'], 2],
    ])(
      'a PINNED tab is unpinned first (onUpdated {pinned:false}), then lands below the pinned run -- index %i',
      async (index, destination, landed) => {
        handle = pinnedWindows();
        const log = recordEvents();

        const tab = await chrome.tabs.move(11, { windowId: 2, index });

        expect(tab).toMatchObject({ pinned: false, index: landed });
        expect(await strip(1)).toEqual(['12*', '13']);
        expect(await strip(2)).toEqual(destination);
        expect(log).toEqual([
          'updated 11 {"pinned":false}',
          'detached 11 w1@0',
          'activated 12 w1',
          `attached 11 w2@${landed}`,
        ]);
      }
    );

    // Part E Task 1, Q2: Q2#10.
    test('an unpinned tab aimed into the pinned run is clamped past it', async () => {
      handle = pinnedWindows();

      await chrome.tabs.move(12, { windowId: 2, index: 0 });

      expect(await strip(2)).toEqual(['21P*', '22P', '12', '23', '24']);
    });

    // Part E Task 1, Q3: Q3_leave#7.
    test('a grouped tab leaves its group: onUpdated {groupId:-1}, then detach and attach', async () => {
      handle = setupChromeFake({
        windows: [
          {
            id: 1,
            tabs: [
              { id: 11, active: true },
              { id: 12, groupId: 5 },
              { id: 13, groupId: 5 },
            ],
          },
          { id: 2, tabs: [{ id: 21, active: true }, { id: 22 }] },
        ],
        tabGroups: [{ id: 5, windowId: 1 }],
      });
      const log = recordEvents();

      await chrome.tabs.move(13, { windowId: 2, index: 1 });

      expect(await strip(1)).toEqual(['11*', '12g5']);
      expect(await strip(2)).toEqual(['21*', '13', '22']);
      expect(log).toEqual([
        'updated 13 {"groupId":-1}',
        'detached 13 w1@2',
        'attached 13 w2@1',
      ]);
    });

    // Part E Task 1, Q3: Q3_leave#8.
    test("a group's last tab leaving removes the group, before the detach", async () => {
      handle = setupChromeFake({
        windows: [
          {
            id: 1,
            tabs: [
              { id: 11, active: true },
              { id: 12, groupId: 5 },
            ],
          },
          { id: 2, tabs: [{ id: 21, active: true }, { id: 22 }] },
        ],
        tabGroups: [{ id: 5, windowId: 1 }],
      });
      const log = recordEvents();

      await chrome.tabs.move(12, { windowId: 2, index: -1 });

      expect(await strip(2)).toEqual(['21*', '22', '12']);
      expect(handle.groupState(5)).toBeUndefined();
      expect(log).toEqual([
        'updated 12 {"groupId":-1}',
        'group removed 5',
        'detached 12 w1@1',
        'attached 12 w2@2',
      ]);
    });

    // W1 [a*, g1@5, g2@5, b], W2 [x*, y]
    const groupAcross = (collapsed: boolean) =>
      setupChromeFake({
        windows: [
          {
            id: 1,
            tabs: [
              { id: 11, active: true },
              { id: 12, groupId: 5 },
              { id: 13, groupId: 5 },
              { id: 14 },
            ],
          },
          { id: 2, tabs: [{ id: 21, active: true }, { id: 22 }] },
        ],
        tabGroups: [{ id: 5, windowId: 1, collapsed }],
      });

    // Part E Task 1, Q3: Q3_join#8-#11, 3/3 each.
    test.each([
      [22, false],
      [22, true],
      [21, false],
      [21, true],
    ])(
      "tab %i into the middle of another window's group run (collapsed: %s) REJECTS, and nothing moves or fires",
      async (tabId, collapsed) => {
        handle = groupAcross(collapsed);
        const log = recordEvents();

        await expect(
          chrome.tabs.move(tabId, { windowId: 1, index: 2 })
        ).rejects.toThrow(
          'Tab operation is invalid as the specified input would disrupt group continuity in the tab strip.'
        );

        expect(await strip(1)).toEqual(['11*', '12g5', '13g5', '14']);
        expect(await strip(2)).toEqual(['21*', '22']);
        expect(log).toEqual([]);
      }
    );

    test("CONTROL: to a run's edge in another window it moves, ungrouped", async () => {
      handle = groupAcross(false);

      await chrome.tabs.move(22, { windowId: 1, index: 3 });

      expect(await strip(1)).toEqual(['11*', '12g5', '13g5', '22', '14']);
    });

    // W1 normal [a*, b], W3 incognito [i*, j], W4 incognito [k*]
    const profiles = () =>
      setupChromeFake({
        windows: [
          { id: 1, tabs: [{ id: 11, active: true }, { id: 12 }] },
          {
            id: 3,
            incognito: true,
            tabs: [{ id: 31, active: true }, { id: 32 }],
          },
          { id: 4, incognito: true, tabs: [{ id: 41, active: true }] },
        ],
      });

    // Part E Task 1, Q4, 3/3 each direction.
    test.each([
      [12, 3],
      [32, 1],
    ])(
      'tab %i to window %i, across profiles, REJECTS and nothing moves or fires',
      async (tabId, windowId) => {
        handle = profiles();
        const log = recordEvents();

        await expect(
          chrome.tabs.move(tabId, { windowId, index: 0 })
        ).rejects.toThrow(
          'Tabs can only be moved between windows in the same profile.'
        );

        expect(await strip(1)).toEqual(['11*', '12']);
        expect(await strip(3)).toEqual(['31*', '32']);
        expect(log).toEqual([]);
      }
    );

    test('CONTROL: incognito to incognito moves', async () => {
      handle = profiles();

      await chrome.tabs.move(32, { windowId: 4, index: -1 });

      expect(await strip(3)).toEqual(['31*']);
      expect(await strip(4)).toEqual(['41*', '32']);
    });

    test('a refusal with a callback reports lastError and moves nothing', async () => {
      handle = profiles();
      let seen: string | undefined;

      await chrome.tabs.move(12, { windowId: 3, index: 0 }, () => {
        seen = chrome.runtime.lastError?.message;
      });

      expect(seen).toBe(
        'Tabs can only be moved between windows in the same profile.'
      );
      expect(await strip(1)).toEqual(['11*', '12']);
    });

    test('an unknown window rejects and moves nothing', async () => {
      handle = twoWindows();

      await expect(
        chrome.tabs.move(12, { windowId: 99, index: 0 })
      ).rejects.toThrow('No window with id: 99.');
      expect(await strip(1)).toEqual(['11*', '12', '13']);
    });
  });

  describe('tabGroups.move (Part E Task 1, Q3, Q4, Q5, Q6)', () => {
    // [a*, G(g1, g2), b, c]
    const oneWindow = () =>
      setupChromeFake({
        windows: [
          {
            id: 1,
            tabs: [
              { id: 11, active: true },
              { id: 12, groupId: 5 },
              { id: 13, groupId: 5 },
              { id: 14 },
              { id: 15 },
            ],
          },
        ],
        tabGroups: [{ id: 5, windowId: 1 }],
      });

    // Part E Task 1, Q3: Q3_group#4-#7. The index is the group's first
    // tab's final index, counted with the group removed.
    test.each([
      [0, ['12g5', '13g5', '11*', '14', '15']],
      [2, ['11*', '14', '12g5', '13g5', '15']],
      [3, ['11*', '14', '15', '12g5', '13g5']],
      [-1, ['11*', '14', '15', '12g5', '13g5']],
    ])('in one window, index %i', async (index, after) => {
      handle = oneWindow();

      const group = await chrome.tabGroups.move(5, { index });

      expect(group).toMatchObject({ id: 5, windowId: 1 });
      expect(await strip(1)).toEqual(after);
    });

    // Part E Task 1, Q6: Q3_group#4 (left: first tab first) and #5
    // (right: last tab first), then tabGroups.onMoved.
    test('in one window: one onMoved per tab, in the order they move, then tabGroups.onMoved', async () => {
      handle = oneWindow();
      const log = recordEvents();

      await chrome.tabGroups.move(5, { index: 0 });
      await chrome.tabGroups.move(5, { index: 3 });

      expect(log).toEqual([
        'moved 12 1->0',
        'moved 13 2->1',
        'group moved 5 w1',
        'moved 13 1->4',
        'moved 12 0->3',
        'group moved 5 w1',
      ]);
    });

    // Not measured for a group: the no-op rule Part E Task 1, Q1 measured
    // for tabs.move (nothing fires) is assumed to hold.
    test('in one window, a move that changes nothing fires nothing', async () => {
      handle = oneWindow();
      const log = recordEvents();

      await chrome.tabGroups.move(5, { index: 1 });

      expect(await strip(1)).toEqual(['11*', '12g5', '13g5', '14', '15']);
      expect(log).toEqual([]);
    });

    // [p1P*, p2P, a, G(g1, g2), b]
    const pinnedRun = () =>
      setupChromeFake({
        windows: [
          {
            id: 1,
            tabs: [
              { id: 11, pinned: true, active: true },
              { id: 12, pinned: true },
              { id: 13 },
              { id: 14, groupId: 5 },
              { id: 15, groupId: 5 },
              { id: 16 },
            ],
          },
        ],
        tabGroups: [{ id: 5, windowId: 1 }],
      });

    // Part E Task 1, Q3: Q3_group#12, #13.
    test.each([0, 1])(
      'into the pinned run (index %i) REJECTS, and nothing moves or fires',
      async (index) => {
        handle = pinnedRun();
        const log = recordEvents();

        await expect(chrome.tabGroups.move(5, { index })).rejects.toThrow(
          'Cannot move the group to an index that is in the middle of pinned tabs.'
        );

        expect(await strip(1)).toEqual([
          '11P*',
          '12P',
          '13',
          '14g5',
          '15g5',
          '16',
        ]);
        expect(log).toEqual([]);
      }
    );

    test('CONTROL: to the first unpinned slot it moves', async () => {
      handle = pinnedRun();

      await chrome.tabGroups.move(5, { index: 2 });

      expect(await strip(1)).toEqual([
        '11P*',
        '12P',
        '14g5',
        '15g5',
        '13',
        '16',
      ]);
    });

    // [a*, H(h1, h2), b, G(g1, g2)]
    const twoGroups = () =>
      setupChromeFake({
        windows: [
          {
            id: 1,
            tabs: [
              { id: 11, active: true },
              { id: 12, groupId: 6 },
              { id: 13, groupId: 6 },
              { id: 14 },
              { id: 15, groupId: 5 },
              { id: 16, groupId: 5 },
            ],
          },
        ],
        tabGroups: [
          { id: 5, windowId: 1 },
          { id: 6, windowId: 1 },
        ],
      });

    // Part E Task 1, Q3: Q3_group#16.
    test('into the middle of another group REJECTS, and nothing moves or fires', async () => {
      handle = twoGroups();
      const log = recordEvents();

      await expect(chrome.tabGroups.move(5, { index: 2 })).rejects.toThrow(
        'Cannot move the group to an index that is in the middle of another group.'
      );

      expect(await strip(1)).toEqual([
        '11*',
        '12g6',
        '13g6',
        '14',
        '15g5',
        '16g5',
      ]);
      expect(log).toEqual([]);
    });

    // Part E Task 1, Q3: Q3_group#17.
    test("CONTROL: to the other group's head it moves", async () => {
      handle = twoGroups();

      await chrome.tabGroups.move(5, { index: 1 });

      expect(await strip(1)).toEqual([
        '11*',
        '15g5',
        '16g5',
        '12g6',
        '13g6',
        '14',
      ]);
    });

    // W1 [a*, G(g1, g2)], W2 [x*, y, z]
    const groupAcross = (collapsed: boolean) =>
      setupChromeFake({
        windows: [
          {
            id: 1,
            tabs: [
              { id: 11, active: true },
              { id: 12, groupId: 5 },
              { id: 13, groupId: 5 },
            ],
          },
          {
            id: 2,
            tabs: [{ id: 21, active: true }, { id: 22 }, { id: 23 }],
          },
        ],
        tabGroups: [{ id: 5, windowId: 1, collapsed, title: 'G' }],
      });

    // Part E Task 1, Q3: Q3_group#8-#11.
    test.each([
      [1, ['21*', '12g5', '13g5', '22', '23']],
      [-1, ['21*', '22', '23', '12g5', '13g5']],
      [0, ['12g5', '13g5', '21*', '22', '23']],
    ])(
      'to another window, index %i is a slot in the destination as it stands; same id, collapsed kept',
      async (index, after) => {
        handle = groupAcross(true);

        const group = await chrome.tabGroups.move(5, { windowId: 2, index });

        expect(group).toMatchObject({ id: 5, windowId: 2, collapsed: true });
        expect(await strip(1)).toEqual(['11*']);
        expect(await strip(2)).toEqual(after);
        expect(handle.groupState(5)).toMatchObject({
          windowId: 2,
          collapsed: true,
          title: 'G',
        });
      }
    );

    test('CONTROL: an expanded group stays expanded across windows', async () => {
      handle = groupAcross(false);

      await chrome.tabGroups.move(5, { windowId: 2, index: 1 });

      expect(handle.groupState(5)?.collapsed).toBe(false);
    });

    // Part E Task 1, Q3, Q6: Q3_group#8, verbatim order.
    test('to another window Chrome reports a remove and re-create, and no tabGroups.onMoved', async () => {
      handle = groupAcross(true);
      const log = recordEvents();

      await chrome.tabGroups.move(5, { windowId: 2, index: 1 });

      expect(log).toEqual([
        'group removed 5',
        'updated 13 {"groupId":-1}',
        'detached 13 w1@2',
        'updated 12 {"groupId":-1}',
        'detached 12 w1@1',
        'attached 12 w2@1',
        'updated 12 {"groupId":5}',
        'attached 13 w2@2',
        'updated 13 {"groupId":5}',
        'group created 5 w2',
        'group updated 5 collapsed=true',
      ]);
    });

    // Part E Task 1, Q5: Q5#4 -- W2 [a, z, b, y@G*] -> W1 [c*, x] index 0.
    // Chrome brought z forward, not the left neighbour b: z was opened by y
    // (z's openerTabId is y, recorded in Part E Task 6a fix round 1, D#4,
    // which repeats Task 1's Q5 sequence, 3/3), and a tabGroups.move takes
    // a tab the carried tab opened first (fix round 1, F2, F3).
    test("a group holding its window's ACTIVE tab carries it: active in the destination, the tab it opened active in the source", async () => {
      handle = setupChromeFake({
        windows: [
          { id: 1, tabs: [{ id: 11, active: true }, { id: 12 }] },
          {
            id: 2,
            tabs: [
              { id: 21 },
              { id: 22, openerTabId: 24 },
              { id: 23 },
              { id: 24, groupId: 5, active: true },
            ],
          },
        ],
        tabGroups: [{ id: 5, windowId: 2 }],
      });
      const log = recordEvents();

      await chrome.tabGroups.move(5, { windowId: 1, index: 0 });

      expect(await strip(1)).toEqual(['24*g5', '11', '12']);
      expect(await strip(2)).toEqual(['21', '22*', '23']);
      expect(log).toEqual([
        'group removed 5',
        'updated 24 {"groupId":-1}',
        'detached 24 w2@3',
        'activated 22 w2',
        'attached 24 w1@0',
        'updated 24 {"groupId":5}',
        'activated 24 w1',
        'group created 5 w1',
        'group updated 5 collapsed=false',
      ]);
    });

    test("CONTROL: a group without its window's active tab leaves the destination's active tab alone", async () => {
      handle = groupAcross(false);

      await chrome.tabGroups.move(5, { windowId: 2, index: 1 });

      expect(await strip(1)).toEqual(['11*']);
      expect(await strip(2)).toEqual(['21*', '12g5', '13g5', '22', '23']);
    });

    // Part E Task 1, Q3: Q3_group#15.
    test("into another window's pinned run REJECTS, and nothing moves or fires", async () => {
      handle = setupChromeFake({
        windows: [
          {
            id: 1,
            tabs: [
              { id: 11, active: true },
              { id: 12, groupId: 5 },
              { id: 13, groupId: 5 },
            ],
          },
          {
            id: 2,
            tabs: [
              { id: 21, pinned: true, active: true },
              { id: 22, pinned: true },
              { id: 23 },
            ],
          },
        ],
        tabGroups: [{ id: 5, windowId: 1 }],
      });
      const log = recordEvents();

      await expect(
        chrome.tabGroups.move(5, { windowId: 2, index: 0 })
      ).rejects.toThrow(
        'Cannot move the group to an index that is in the middle of pinned tabs.'
      );

      expect(await strip(1)).toEqual(['11*', '12g5', '13g5']);
      expect(await strip(2)).toEqual(['21P*', '22P', '23']);
      expect(log).toEqual([]);
    });

    // Part E Task 1, Q4.
    test('to a window in the other profile REJECTS, and nothing moves or fires', async () => {
      handle = setupChromeFake({
        windows: [
          {
            id: 1,
            tabs: [
              { id: 11, active: true },
              { id: 12, groupId: 5 },
            ],
          },
          { id: 3, incognito: true, tabs: [{ id: 31, active: true }] },
        ],
        tabGroups: [{ id: 5, windowId: 1 }],
      });
      const log = recordEvents();

      await expect(
        chrome.tabGroups.move(5, { windowId: 3, index: 0 })
      ).rejects.toThrow(
        'Tabs can only be moved between windows in the same profile.'
      );

      expect(await strip(1)).toEqual(['11*', '12g5']);
      expect(await strip(3)).toEqual(['31*']);
      expect(log).toEqual([]);
    });

    test('an unknown group rejects', async () => {
      handle = oneWindow();

      await expect(chrome.tabGroups.move(99, { index: 0 })).rejects.toThrow(
        'No group with id: 99.'
      );
    });
  });

  describe('tabs.group({groupId}) with a tab from another window (Part E Task 1, Q3, Q4)', () => {
    // W1 [a*, g1@5, g2@5, b], W2 [x*, y]
    const groupAcross = (collapsed: boolean) =>
      setupChromeFake({
        windows: [
          {
            id: 1,
            tabs: [
              { id: 11, active: true },
              { id: 12, groupId: 5 },
              { id: 13, groupId: 5 },
              { id: 14 },
            ],
          },
          { id: 2, tabs: [{ id: 21, active: true }, { id: 22 }] },
        ],
        tabGroups: [{ id: 5, windowId: 1, collapsed }],
      });

    // Part E Task 1, Q3: Q3_group#0, #1.
    test.each([false, true])(
      "moves it to the END of the group's run in the group's window (collapsed: %s kept)",
      async (collapsed) => {
        handle = groupAcross(collapsed);

        const groupId = await chrome.tabs.group({ groupId: 5, tabIds: [22] });

        expect(groupId).toBe(5);
        expect(await strip(1)).toEqual(['11*', '12g5', '13g5', '22g5', '14']);
        expect(await strip(2)).toEqual(['21*']);
        expect(handle.groupState(5)?.collapsed).toBe(collapsed);
      }
    );

    // Part E Task 1, Q3, Q6: attached at the window's end, then moved in.
    test('fires onDetached, onAttached at the end, onUpdated {groupId}, then onMoved into the run', async () => {
      handle = groupAcross(false);
      const log = recordEvents();

      await chrome.tabs.group({ groupId: 5, tabIds: [22] });

      expect(log).toEqual([
        'detached 22 w2@1',
        'attached 22 w1@4',
        'updated 22 {"groupId":5}',
        'moved 22 4->3',
      ]);
    });

    // Part E Task 1, Q3: Q3_group#2.
    test('CONTROL: a tab from the same window joins in place, with onUpdated {groupId} only', async () => {
      handle = groupAcross(false);
      const log = recordEvents();

      await chrome.tabs.group({ groupId: 5, tabIds: [11] });

      expect(await strip(1)).toEqual(['11*g5', '12g5', '13g5', '14']);
      expect(log).toEqual(['updated 11 {"groupId":5}']);
    });

    // Part E Task 1, Q4.
    test('a tab from the other profile REJECTS, and nothing moves or fires', async () => {
      handle = setupChromeFake({
        windows: [
          {
            id: 1,
            tabs: [
              { id: 11, active: true },
              { id: 12, groupId: 5 },
            ],
          },
          {
            id: 3,
            incognito: true,
            tabs: [{ id: 31, active: true }, { id: 32 }],
          },
        ],
        tabGroups: [{ id: 5, windowId: 1 }],
      });
      const log = recordEvents();

      await expect(
        chrome.tabs.group({ groupId: 5, tabIds: [32] })
      ).rejects.toThrow(
        'Tabs can only be moved between windows in the same profile.'
      );

      expect(await strip(1)).toEqual(['11*', '12g5']);
      expect(await strip(3)).toEqual(['31*', '32']);
      expect(handle.groupedTabs).toEqual([]);
      expect(log).toEqual([]);
    });
  });

  describe('Part E Task 6a: G1, grouping without the grant, a window emptied', () => {
    // windows.onRemoved for a window emptied by a move arrives AFTER the
    // call resolves (Part E Task 6a, Q4), so a test waits one task for it.
    const nextTask = () => new Promise<void>((done) => setTimeout(done, 0));

    // Without the grant chrome.tabGroups is absent, so only tabs.* events.
    const recordTabEvents = (): string[] => {
      const log: string[] = [];
      chrome.tabs.onMoved.addListener((id, info) =>
        log.push(`moved ${id} ${info.fromIndex}->${info.toIndex}`)
      );
      chrome.tabs.onUpdated.addListener((id, change) =>
        log.push(`updated ${id} ${JSON.stringify(change)}`)
      );
      chrome.tabs.onDetached.addListener((id, info) =>
        log.push(`detached ${id} w${info.oldWindowId}@${info.oldPosition}`)
      );
      chrome.tabs.onAttached.addListener((id, info) =>
        log.push(`attached ${id} w${info.newWindowId}@${info.newPosition}`)
      );
      return log;
    };

    describe("a window's last tab leaving closes it (Part E Task 6a, Q4)", () => {
      // Part E Task 6a, Q4#0 (both fixtures) and Q6.
      test('tabs.move resolves, the window is gone at once, and windows.onRemoved follows the call', async () => {
        handle = setupChromeFake({
          windows: [
            { id: 1, tabs: [{ id: 11, active: true }] },
            { id: 2, tabs: [{ id: 21, active: true }, { id: 22 }] },
          ],
        });
        const log = recordEvents();

        const moved = await chrome.tabs.move(11, { windowId: 2, index: 0 });

        expect(moved).toMatchObject({ id: 11, windowId: 2, index: 0 });
        expect(moved.active).toBe(false);
        expect(await strip(2)).toEqual(['11', '21*', '22']);
        expect((await chrome.windows.getAll({})).map((win) => win.id)).toEqual([
          2,
        ]);
        await expect(chrome.windows.get(1)).rejects.toThrow(
          'No window with id: 1.'
        );
        expect(log).toEqual(['detached 11 w1@0', 'attached 11 w2@0']);
        await nextTask();
        expect(log).toEqual([
          'detached 11 w1@0',
          'attached 11 w2@0',
          'window removed 1',
        ]);
      });

      // Part E Task 6a, Q4#1.
      test('CONTROL: a window that keeps a tab stays open', async () => {
        handle = setupChromeFake({
          windows: [
            { id: 1, tabs: [{ id: 11, active: true }, { id: 12 }] },
            { id: 2, tabs: [{ id: 21, active: true }] },
          ],
        });
        const log = recordEvents();

        await chrome.tabs.move(12, { windowId: 2, index: 0 });
        await nextTask();

        expect(await strip(1)).toEqual(['11*']);
        expect(log).toEqual(['detached 12 w1@1', 'attached 12 w2@0']);
      });

      // Part E Task 6a, Q4#2: the carried front tab activates after BOTH
      // tabs attached, and the window goes after the call resolves.
      test("tabGroups.move of a window's only group", async () => {
        handle = setupChromeFake({
          windows: [
            {
              id: 1,
              tabs: [
                { id: 12, groupId: 5, active: true },
                { id: 13, groupId: 5 },
              ],
            },
            {
              id: 2,
              tabs: [{ id: 21 }, { id: 22, active: true }, { id: 23 }],
            },
          ],
          tabGroups: [{ id: 5, windowId: 1 }],
        });
        const log = recordEvents();

        await chrome.tabGroups.move(5, { windowId: 2, index: 1 });

        expect(await strip(2)).toEqual(['21', '12*g5', '13g5', '22', '23']);
        expect((await chrome.windows.getAll({})).map((win) => win.id)).toEqual([
          2,
        ]);
        await nextTask();
        expect(log).toEqual([
          'group removed 5',
          'updated 13 {"groupId":-1}',
          'detached 13 w1@1',
          'updated 12 {"groupId":-1}',
          'detached 12 w1@0',
          'attached 12 w2@1',
          'updated 12 {"groupId":5}',
          'attached 13 w2@2',
          'updated 13 {"groupId":5}',
          'activated 12 w2',
          'group created 5 w2',
          'group updated 5 collapsed=false',
          'window removed 1',
        ]);
      });

      // Part E Task 6a, Q5#2.
      test("tabs.group taking a window's only tab into another window's group", async () => {
        handle = setupChromeFake({
          windows: [
            {
              id: 1,
              tabs: [
                { id: 11, active: true },
                { id: 12, groupId: 5 },
                { id: 13, groupId: 5 },
                { id: 14 },
              ],
            },
            { id: 2, tabs: [{ id: 21, active: true }] },
          ],
          tabGroups: [{ id: 5, windowId: 1 }],
        });
        const log = recordEvents();

        await chrome.tabs.group({ groupId: 5, tabIds: [21] });

        expect(await strip(1)).toEqual(['11*', '12g5', '13g5', '21g5', '14']);
        await nextTask();
        expect(log).toEqual([
          'detached 21 w2@0',
          'attached 21 w1@4',
          'updated 21 {"groupId":5}',
          'moved 21 4->3',
          'window removed 2',
        ]);
      });

      // Part E Task 6a, Q4#5: G1 (b) when the group is its window's only
      // content.
      test('an array tabs.move that empties its window', async () => {
        handle = setupChromeFake({
          windows: [
            {
              id: 1,
              tabs: [
                { id: 12, groupId: 5, active: true },
                { id: 13, groupId: 5 },
              ],
            },
            {
              id: 2,
              tabs: [{ id: 21 }, { id: 22, active: true }, { id: 23 }],
            },
          ],
          tabGroups: [{ id: 5, windowId: 1 }],
        });
        const log = recordEvents();

        await chrome.tabs.move([12, 13], { windowId: 2, index: 1 });

        expect(await strip(2)).toEqual(['21', '12', '13', '22*', '23']);
        await nextTask();
        expect(log).toEqual([
          'updated 12 {"groupId":-1}',
          'detached 12 w1@0',
          'activated 13 w1',
          'attached 12 w2@1',
          'updated 13 {"groupId":-1}',
          'group removed 5',
          'detached 13 w1@0',
          'attached 13 w2@2',
          'window removed 1',
        ]);
      });
    });

    describe('the G1 sequence (Part E Task 6a, Q1)', () => {
      // W1 [a, G(g1*, g2) "Gt" blue, b], W2 [x, y*, z]
      const g1Seed = (collapsed: boolean) =>
        setupChromeFake({
          windows: [
            {
              id: 1,
              tabs: [
                { id: 11 },
                { id: 12, groupId: 5, active: true },
                { id: 13, groupId: 5 },
                { id: 14 },
              ],
            },
            {
              id: 2,
              tabs: [{ id: 21 }, { id: 22, active: true }, { id: 23 }],
            },
          ],
          tabGroups: [
            { id: 5, windowId: 1, title: 'Gt', color: 'blue', collapsed },
          ],
        });

      // Part E Task 6a, Q1#2, Q1#3: 3/3 each, the same order as variant (a).
      test.each([false, true])(
        'array tabs.move, tabs.group in the destination, tabGroups.update (collapsed: %s)',
        async (collapsed) => {
          handle = g1Seed(collapsed);
          const log = recordEvents();

          const moved = await chrome.tabs.move([12, 13], {
            windowId: 2,
            index: 1,
          });
          const newId = await chrome.tabs.group({
            tabIds: [12, 13],
            createProperties: { windowId: 2 },
          });
          await chrome.tabGroups.update(newId, {
            title: 'Gt',
            color: 'blue',
            collapsed,
          });

          expect(moved.map((tab) => [tab.id, tab.windowId, tab.index])).toEqual(
            [
              [12, 2, 1],
              [13, 2, 2],
            ]
          );
          expect(newId).not.toBe(5);
          expect(handle.groupState(5)).toBeUndefined();
          expect(handle.groupState(newId)).toMatchObject({
            windowId: 2,
            title: 'Gt',
            color: 'blue',
            collapsed,
          });
          expect(await strip(1)).toEqual(['11', '14*']);
          expect(await strip(2)).toEqual([
            '21',
            `12g${newId}`,
            `13g${newId}`,
            '22*',
            '23',
          ]);
          expect(log).toEqual([
            'updated 12 {"groupId":-1}',
            ...(collapsed ? ['group updated 5 collapsed=false'] : []),
            'detached 12 w1@1',
            'activated 13 w1',
            'attached 12 w2@1',
            'updated 13 {"groupId":-1}',
            'group removed 5',
            'detached 13 w1@1',
            'activated 14 w1',
            'attached 13 w2@2',
            `updated 12 {"groupId":${newId}}`,
            `updated 13 {"groupId":${newId}}`,
            `group created ${newId} w2`,
            `group updated ${newId} collapsed=false`,
            `group updated ${newId} collapsed=${collapsed}`,
          ]);
        }
      );

      // Part E Task 6a, Q5#0, Q5#1: an array move is not atomic.
      test('an array tabs.move with an unknown id second moves the first tab, then rejects', async () => {
        handle = g1Seed(false);

        await expect(
          chrome.tabs.move([12, 999999], { windowId: 2, index: 1 })
        ).rejects.toThrow('No tab with id: 999999.');

        expect(await strip(1)).toEqual(['11', '13*g5', '14']);
        expect(await strip(2)).toEqual(['21', '12', '22*', '23']);
      });

      test('an array tabs.move with an unknown id first rejects and moves nothing', async () => {
        handle = g1Seed(false);
        const log = recordEvents();

        await expect(
          chrome.tabs.move([999999, 12], { windowId: 2, index: 1 })
        ).rejects.toThrow('No tab with id: 999999.');

        expect(await strip(1)).toEqual(['11', '12*g5', '13g5', '14']);
        expect(log).toEqual([]);
      });

      // Not measured: an array move within one window, with or without
      // naming it.
      test.each([undefined, 1])(
        'an array tabs.move within one window (windowId %s) throws: not modelled',
        async (windowId) => {
          handle = g1Seed(false);

          expect(() =>
            chrome.tabs.move([11, 14], { windowId, index: 0 })
          ).toThrow(/not modelled/);
          expect(await strip(1)).toEqual(['11', '12*g5', '13g5', '14']);
        }
      );
    });

    describe('tabs.group and tabs.ungroup (Part E Task 6a, Q3)', () => {
      // Part E Task 6a, Q1 and Q3b#2.
      test('a new group fires onUpdated {groupId} per tab, then tabGroups.onCreated and onUpdated', async () => {
        handle = setupChromeFake({
          windows: [
            { id: 1, tabs: [{ id: 11, active: true }, { id: 12 }, { id: 13 }] },
          ],
        });
        const log = recordEvents();

        const groupId = await chrome.tabs.group({
          tabIds: [12, 13],
          createProperties: { windowId: 1 },
        });

        expect(handle.groupState(groupId)).toMatchObject({
          windowId: 1,
          title: '',
          color: 'grey',
          collapsed: false,
        });
        expect(log).toEqual([
          `updated 12 {"groupId":${groupId}}`,
          `updated 13 {"groupId":${groupId}}`,
          `group created ${groupId} w1`,
          `group updated ${groupId} collapsed=false`,
        ]);
      });

      // Part E Task 6a, Q5#3.
      test('a new group in ANOTHER window moves the tabs to its end first', async () => {
        handle = setupChromeFake({
          windows: [
            { id: 1, tabs: [{ id: 11, active: true }, { id: 12 }, { id: 13 }] },
            { id: 2, tabs: [{ id: 21, active: true }, { id: 22 }] },
          ],
        });
        const log = recordEvents();

        const groupId = await chrome.tabs.group({
          tabIds: [12, 13],
          createProperties: { windowId: 2 },
        });

        expect(await strip(1)).toEqual(['11*']);
        expect(await strip(2)).toEqual([
          '21*',
          '22',
          `12g${groupId}`,
          `13g${groupId}`,
        ]);
        expect(log).toEqual([
          'detached 12 w1@1',
          'attached 12 w2@2',
          'detached 13 w1@1',
          'attached 13 w2@3',
          `updated 12 {"groupId":${groupId}}`,
          `updated 13 {"groupId":${groupId}}`,
          `group created ${groupId} w2`,
          `group updated ${groupId} collapsed=false`,
        ]);
      });

      // Part E Task 6a, Q3b#7: 3/3 with and without the grant.
      test('a group id Chrome no longer has REJECTS, and nothing changes or fires', async () => {
        handle = setupChromeFake({
          windows: [{ id: 1, tabs: [{ id: 11, active: true }, { id: 12 }] }],
        });
        const log = recordEvents();

        await expect(
          chrome.tabs.group({ groupId: 77, tabIds: [12] })
        ).rejects.toThrow('No group with id: 77.');

        expect(await strip(1)).toEqual(['11*', '12']);
        expect(handle.groupedTabs).toEqual([]);
        expect(log).toEqual([]);
      });

      // W1 [a*, g1@5, b, c]
      const runSeed = () =>
        setupChromeFake({
          windows: [
            {
              id: 1,
              tabs: [
                { id: 11, active: true },
                { id: 12, groupId: 5 },
                { id: 13 },
                { id: 14 },
              ],
            },
          ],
          tabGroups: [{ id: 5, windowId: 1 }],
        });

      // Part E Task 6a, Q3b#3 (both fixtures).
      test('into a group in its own window, from the right and not adjacent: to the run tail', async () => {
        handle = runSeed();
        const log = recordEvents();

        await chrome.tabs.group({ groupId: 5, tabIds: [14] });

        expect(await strip(1)).toEqual(['11*', '12g5', '14g5', '13']);
        expect(log).toEqual(['updated 14 {"groupId":5}', 'moved 14 3->2']);
      });

      // Part E Task 6a, Q5#4.
      test('into a group in its own window, from the left and not adjacent: to the run head', async () => {
        handle = setupChromeFake({
          windows: [
            {
              id: 1,
              tabs: [
                { id: 11 },
                { id: 12, active: true },
                { id: 13, groupId: 5 },
                { id: 14, groupId: 5 },
                { id: 15 },
              ],
            },
          ],
          tabGroups: [{ id: 5, windowId: 1 }],
        });
        const log = recordEvents();

        await chrome.tabs.group({ groupId: 5, tabIds: [11] });

        expect(await strip(1)).toEqual(['12*', '11g5', '13g5', '14g5', '15']);
        expect(log).toEqual(['updated 11 {"groupId":5}', 'moved 11 0->1']);
      });

      // Part E Task 6a, Q5#5.
      test('CONTROL: adjacent to the run it joins in place', async () => {
        handle = runSeed();
        const log = recordEvents();

        await chrome.tabs.group({ groupId: 5, tabIds: [13] });

        expect(await strip(1)).toEqual(['11*', '12g5', '13g5', '14']);
        expect(log).toEqual(['updated 13 {"groupId":5}']);
      });

      // W1 [a*, g1@5, g2@5, g3@5, b]
      const ungroupSeed = () =>
        setupChromeFake({
          windows: [
            {
              id: 1,
              tabs: [
                { id: 11, active: true },
                { id: 12, groupId: 5 },
                { id: 13, groupId: 5 },
                { id: 14, groupId: 5 },
                { id: 15 },
              ],
            },
          ],
          tabGroups: [{ id: 5, windowId: 1 }],
        });

      // Part E Task 6a, Q5#6 (and Q3#3, both fixtures).
      test('tabs.ungroup of a tab mid-run moves it to just after the run', async () => {
        handle = ungroupSeed();
        const log = recordEvents();

        await chrome.tabs.ungroup([13]);

        expect(await strip(1)).toEqual(['11*', '12g5', '14g5', '13', '15']);
        expect(log).toEqual(['updated 13 {"groupId":-1}', 'moved 13 2->3']);
      });

      // Part E Task 6a, Q5#7, Q5#8, Q3b#5.
      test.each([
        [14, [], ['11*', '12g5', '13g5', '14', '15']],
        [12, [13], ['11*', '12', '13', '14g5', '15']],
      ])(
        'tabs.ungroup of %i (and %j) at the run edge leaves them in place, onUpdated each',
        async (first, rest, after) => {
          handle = ungroupSeed();
          const log = recordEvents();

          await chrome.tabs.ungroup([first, ...rest]);

          expect(await strip(1)).toEqual(after);
          expect(log).toEqual(
            [first, ...rest].map((id) => `updated ${id} {"groupId":-1}`)
          );
        }
      );

      // Part E Task 6a, Q3b#6.
      test("tabs.ungroup of a group's last tabs removes the group", async () => {
        handle = setupChromeFake({
          windows: [
            {
              id: 1,
              tabs: [
                { id: 11, active: true },
                { id: 12, groupId: 5 },
                { id: 13, groupId: 5 },
              ],
            },
          ],
          tabGroups: [{ id: 5, windowId: 1 }],
        });
        const log = recordEvents();

        await chrome.tabs.ungroup([12, 13]);

        expect(handle.groupState(5)).toBeUndefined();
        expect(log).toEqual([
          'updated 12 {"groupId":-1}',
          'updated 13 {"groupId":-1}',
          'group removed 5',
        ]);
      });

      // W1 [a*, b, c, d], W2 [x*, y]; the tabGroups permission ungranted.
      const ungrantedSeed = () =>
        setupChromeFake({
          tabGroupsApiAbsent: true,
          windows: [
            {
              id: 1,
              tabs: [
                { id: 11, active: true },
                { id: 12 },
                { id: 13 },
                { id: 14 },
              ],
            },
            { id: 2, tabs: [{ id: 21, active: true }, { id: 22 }] },
          ],
        });

      // Part E Task 6a, Q3b#2 ungranted.
      test('WITHOUT the grant, tabs.group makes a group and tabs.get reports its id', async () => {
        handle = ungrantedSeed();
        const log = recordTabEvents();

        const groupId = await chrome.tabs.group({
          tabIds: [12],
          createProperties: { windowId: 1 },
        });

        expect(chrome.tabGroups).toBeUndefined();
        expect((await chrome.tabs.get(12)).groupId).toBe(groupId);
        expect(log).toEqual([`updated 12 {"groupId":${groupId}}`]);
      });

      // Part E Task 6a, Q3b#3, Q3b#4 ungranted.
      test('WITHOUT the grant, tabs.group joins an existing group from its own window and another', async () => {
        handle = ungrantedSeed();
        const groupId = await chrome.tabs.group({
          tabIds: [12],
          createProperties: { windowId: 1 },
        });
        const log = recordTabEvents();

        await chrome.tabs.group({ groupId, tabIds: [14] });
        await chrome.tabs.group({ groupId, tabIds: [22] });

        expect(await strip(1)).toEqual([
          '11*',
          `12g${groupId}`,
          `14g${groupId}`,
          `22g${groupId}`,
          '13',
        ]);
        expect((await chrome.tabs.get(22)).groupId).toBe(groupId);
        expect(log).toEqual([
          `updated 14 {"groupId":${groupId}}`,
          'moved 14 3->2',
          'detached 22 w2@1',
          'attached 22 w1@4',
          `updated 22 {"groupId":${groupId}}`,
          'moved 22 4->3',
        ]);
      });

      // Part E Task 6a, Q3#3 ungranted.
      test('WITHOUT the grant, tabs.ungroup works and moves a mid-run tab out', async () => {
        handle = ungrantedSeed();
        const groupId = await chrome.tabs.group({
          tabIds: [12, 13, 14],
          createProperties: { windowId: 1 },
        });
        const log = recordTabEvents();

        await chrome.tabs.ungroup([13]);

        expect((await chrome.tabs.get(13)).groupId).toBe(-1);
        expect(await strip(1)).toEqual([
          '11*',
          `12g${groupId}`,
          `14g${groupId}`,
          '13',
        ]);
        expect(log).toEqual(['updated 13 {"groupId":-1}', 'moved 13 2->3']);
      });
    });

    describe("the source window's next front tab (Part E Task 6a, Q5)", () => {
      // W1 [a, g1@5, g2@5, b] (active and collapsed per case), W2 [x*]
      const frontSeed = (active: number) =>
        setupChromeFake({
          windows: [
            {
              id: 1,
              tabs: [
                { id: 11, active: active === 11 },
                { id: 12, groupId: 5, active: active === 12 },
                { id: 13, groupId: 5, active: active === 13 },
                { id: 14 },
              ],
            },
            { id: 2, tabs: [{ id: 21, active: true }] },
          ],
          tabGroups: [{ id: 5, windowId: 1, collapsed: true }],
        });

      // Part E Task 6a, Q5#9.
      test('an ungrouped front tab leaving skips tabs in a collapsed group', async () => {
        handle = frontSeed(11);
        const log = recordEvents();

        await chrome.tabs.move(11, { windowId: 2, index: 0 });

        expect(await strip(1)).toEqual(['12g5', '13g5', '14*']);
        expect(handle.groupState(5)?.collapsed).toBe(true);
        expect(log).toEqual([
          'detached 11 w1@0',
          'activated 14 w1',
          'attached 11 w2@0',
        ]);
      });

      // Part E Task 6a, Q5#10 (right) and Q5#11 (left, over the ungrouped
      // right neighbour).
      test.each([
        [12, 13, 1, ['11', '13*g5', '14']],
        [13, 12, 2, ['11', '12*g5', '14']],
      ])(
        'front tab %i leaving its collapsed group: %i, of the same group, comes to the front and the group expands first',
        async (leaving, next, position, after) => {
          handle = frontSeed(leaving);
          const log = recordEvents();

          await chrome.tabs.move(leaving, { windowId: 2, index: 0 });

          expect(await strip(1)).toEqual(after);
          expect(log).toEqual([
            `updated ${leaving} {"groupId":-1}`,
            'group updated 5 collapsed=false',
            `detached ${leaving} w1@${position}`,
            `activated ${next} w1`,
            `attached ${leaving} w2@0`,
          ]);
        }
      );

      // Part E Task 6a, Q5#12, Q5#13: the source picks its new front tab
      // after ALL the group's tabs left, the destination after all arrived.
      test.each([12, 13])(
        'tabGroups.move carrying front tab %i: the source activates once all left, the destination once all arrived',
        async (front) => {
          handle = setupChromeFake({
            windows: [
              {
                id: 1,
                tabs: [
                  { id: 11 },
                  { id: 12, groupId: 5, active: front === 12 },
                  { id: 13, groupId: 5, active: front === 13 },
                  { id: 14 },
                ],
              },
              {
                id: 2,
                tabs: [{ id: 21 }, { id: 22, active: true }, { id: 23 }],
              },
            ],
            tabGroups: [{ id: 5, windowId: 1 }],
          });
          const log = recordEvents();

          await chrome.tabGroups.move(5, { windowId: 2, index: 1 });

          expect(await strip(1)).toEqual(['11', '14*']);
          expect(await strip(2)).toEqual([
            '21',
            front === 12 ? '12*g5' : '12g5',
            front === 13 ? '13*g5' : '13g5',
            '22',
            '23',
          ]);
          expect(log).toEqual([
            'group removed 5',
            'updated 13 {"groupId":-1}',
            'detached 13 w1@2',
            'updated 12 {"groupId":-1}',
            'detached 12 w1@1',
            'activated 14 w1',
            'attached 12 w2@1',
            'updated 12 {"groupId":5}',
            'attached 13 w2@2',
            'updated 13 {"groupId":5}',
            `activated ${front} w2`,
            'group created 5 w2',
            'group updated 5 collapsed=false',
          ]);
        }
      );
    });

    // Part E Task 6a, Q2 (ruling R13): 3/3 at each index; control: a
    // tabs.update({active}) in the same run moved the front tab.
    test.each([
      [3, ['11', '14', '15', '12*g5', '13g5']],
      [0, ['12*g5', '13g5', '11', '14', '15']],
    ])(
      "tabGroups.move in its own window to %i keeps the group's front tab in front",
      async (index, after) => {
        handle = setupChromeFake({
          windows: [
            {
              id: 1,
              tabs: [
                { id: 11 },
                { id: 12, groupId: 5, active: true },
                { id: 13, groupId: 5 },
                { id: 14 },
                { id: 15 },
              ],
            },
          ],
          tabGroups: [{ id: 5, windowId: 1 }],
        });
        const log = recordEvents();

        await chrome.tabGroups.move(5, { index });

        expect(await strip(1)).toEqual(after);
        expect(log.filter((line) => line.startsWith('activated'))).toEqual([]);
      }
    );
  });

  describe('Part E Task 6a fix round 1: openers and seeded groups', () => {
    // W1 built as `tabs`, W2 [p*]; `leaver` is W1's front tab.
    const openerSeed = (tabs: Partial<chrome.tabs.Tab>[]) =>
      setupChromeFake({
        windows: [
          { id: 1, tabs },
          { id: 2, tabs: [{ id: 21, active: true }] },
        ],
        tabGroups: [{ id: 5, windowId: 1 }],
      });

    // Fix round 1, E2 (3/3), with E2 CONTROL (no openers: y).
    test('tabs.move: a tab opened by the same opener beats the right neighbour', async () => {
      // [o, s1^o, x, s2^o*, y]
      handle = openerSeed([
        { id: 11 },
        { id: 12, openerTabId: 11 },
        { id: 13 },
        { id: 14, openerTabId: 11, active: true },
        { id: 15 },
      ]);

      await chrome.tabs.move(14, { windowId: 2, index: 0 });

      expect(await strip(1)).toEqual(['11', '12*', '13', '15']);
    });

    // Fix round 1, E3b (3/3), with E3 CONTROL (no opener: the left neighbour).
    test("tabs.move: with no sibling, the tab's opener beats the right neighbour", async () => {
      // [o, x, s^o*, y]
      handle = openerSeed([
        { id: 11 },
        { id: 12 },
        { id: 13, openerTabId: 11, active: true },
        { id: 14 },
      ]);

      await chrome.tabs.move(13, { windowId: 2, index: 0 });

      expect(await strip(1)).toEqual(['11*', '12', '14']);
    });

    // Fix round 1, E1b and E1 (3/3 each): a tab the leaver opened does not
    // count for tabs.move, to its left or its right.
    test('CONTROL: tabs.move ignores a tab the leaving tab opened', async () => {
      // [k^c, x, c*, y]
      handle = openerSeed([
        { id: 11, openerTabId: 13 },
        { id: 12 },
        { id: 13, active: true },
        { id: 14 },
      ]);

      await chrome.tabs.move(13, { windowId: 2, index: 0 });

      expect(await strip(1)).toEqual(['11', '12', '14*']);
    });

    // Fix round 1, F3 (3/3), with F3 CONTROL (no opener: d, the right
    // neighbour).
    test('tabGroups.move: a tab the carried front tab opened beats the right neighbour', async () => {
      // [a, k^c, b, G(c*), d]
      handle = openerSeed([
        { id: 11 },
        { id: 12, openerTabId: 14 },
        { id: 13 },
        { id: 14, groupId: 5, active: true },
        { id: 15 },
      ]);

      await chrome.tabGroups.move(5, { windowId: 2, index: 0 });

      expect(await strip(1)).toEqual(['11', '12*', '13', '15']);
    });

    // Fix round 1, F3 CONTROL (3/3).
    test('CONTROL: tabGroups.move with no opener takes the right neighbour', async () => {
      handle = openerSeed([
        { id: 11 },
        { id: 12 },
        { id: 13 },
        { id: 14, groupId: 5, active: true },
        { id: 15 },
      ]);

      await chrome.tabGroups.move(5, { windowId: 2, index: 0 });

      expect(await strip(1)).toEqual(['11', '12', '13', '15*']);
    });

    // Fix round 1, C#0 and C#1 (3/3 each): group-mates on both sides, the
    // right one comes forward (a collapsed group expands first).
    test.each([false, true])(
      "the leaving tab's group-mate on its RIGHT comes forward when it has one on each side (collapsed: %s)",
      async (collapsed) => {
        handle = setupChromeFake({
          windows: [
            {
              id: 1,
              tabs: [
                { id: 11 },
                { id: 12, groupId: 5 },
                { id: 13, groupId: 5, active: true },
                { id: 14, groupId: 5 },
                { id: 15 },
              ],
            },
            { id: 2, tabs: [{ id: 21, active: true }] },
          ],
          tabGroups: [{ id: 5, windowId: 1, collapsed }],
        });

        await chrome.tabs.move(13, { windowId: 2, index: 0 });

        expect(await strip(1)).toEqual(['11', '12g5', '14*g5', '15']);
        expect(handle.groupState(5)?.collapsed).toBe(false);
      }
    );

    // Review Minor 2: Chrome has the group whether or not the extension may
    // see it, so a seeded tab's groupId is a group the fake has too.
    test('a group named only by a seeded tab exists: tabs.group can join it, without the grant', async () => {
      handle = setupChromeFake({
        tabGroupsApiAbsent: true,
        windows: [
          {
            id: 1,
            tabs: [
              { id: 11, active: true },
              { id: 12, groupId: 5 },
              { id: 13 },
            ],
          },
        ],
      });

      const groupId = await chrome.tabs.group({ groupId: 5, tabIds: [13] });

      expect(groupId).toBe(5);
      expect(await strip(1)).toEqual(['11*', '12g5', '13g5']);
      expect(handle.groupState(5)).toMatchObject({ windowId: 1 });
    });
  });
});

// KAN-475. Open now follows the worker's record of activated tabs live, as
// Chrome reports a session-area change: after the write, only keys whose
// value changed.
describe('chrome.storage.session.onChanged (KAN-475)', () => {
  test('a set reports each changed key, old and new; an unchanged one is left out', async () => {
    handle = setupChromeFake({ sessionArea: { kept: 1, moved: [1] } });
    const seen: Record<string, chrome.storage.StorageChange>[] = [];
    chrome.storage.session.onChanged.addListener((changes) =>
      seen.push(changes)
    );
    await chrome.storage.session.set({ kept: 1, moved: [2, 1], added: 'x' });
    await vi.waitFor(() => expect(seen).toHaveLength(1));
    expect(seen[0]).toEqual({
      moved: { oldValue: [1], newValue: [2, 1] },
      added: { newValue: 'x' },
    });
  });

  test('a remove reports the old value; a set that changes nothing reports nothing', async () => {
    handle = setupChromeFake({ sessionArea: { gone: [3] } });
    const seen: Record<string, chrome.storage.StorageChange>[] = [];
    const listener = (changes: Record<string, chrome.storage.StorageChange>) =>
      seen.push(changes);
    chrome.storage.session.onChanged.addListener(listener);
    await chrome.storage.session.set({ gone: [3] });
    await chrome.storage.session.remove('gone');
    await vi.waitFor(() => expect(seen).toHaveLength(1));
    expect(seen[0]).toEqual({ gone: { oldValue: [3] } });
    chrome.storage.session.onChanged.removeListener(listener);
    await chrome.storage.session.set({ gone: [4] });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(seen).toHaveLength(1);
  });
});

// KAN-460, measured on Chromium 151 (plan 2026-10-08): windows.create refuses a maximized or full-screen state with bounds or unfocused.
describe('windows.create refuses a state Chrome refuses', () => {
  test.each([
    ['bounds', { left: 1, top: 1, width: 400, height: 300 }],
    ['focused: false', { focused: false }],
  ])(
    'maximized or fullscreen with %s rejects with Invalid value for state',
    async (_name, extra) => {
      handle = setupChromeFake();
      for (const state of ['maximized', 'fullscreen'] as const) {
        await expect(
          chrome.windows.create({ url: 'https://a.test/', state, ...extra })
        ).rejects.toThrow('Invalid value for state');
      }
    }
  );

  test('CONTROL: maximized and focused with no bounds is created maximized', async () => {
    handle = setupChromeFake();
    const created = await chrome.windows.create({
      url: 'https://a.test/',
      state: 'maximized',
      focused: true,
    });
    expect(created?.state).toBe('maximized');
  });
});

// KAN-437, measured headed in Chrome 154 (KAN-437 comment 10696).
describe('chrome.action.openPopup', () => {
  const seed = {
    action: {},
    windows: [{ id: 3, tabs: [{ id: 31, url: 'https://a.test/' }] }],
  };

  test('records the window it named and the popup set at the time', async () => {
    handle = setupChromeFake(seed);
    await chrome.action.setPopup({ popup: '' });
    await chrome.action.openPopup({ windowId: 3 }).catch(() => undefined);
    await chrome.action.setPopup({ popup: 'index.html' });
    await chrome.action.openPopup();

    expect(handle.openPopupCalls).toEqual([
      { windowId: 3, popup: '' },
      { windowId: undefined, popup: 'index.html' },
    ]);
  });

  test('a window that is gone rejects with No window with id', async () => {
    handle = setupChromeFake(seed);
    await expect(chrome.action.openPopup({ windowId: 9 })).rejects.toThrow(
      'No window with id: 9.'
    );
  });

  test('with the popup set to an empty string it rejects', async () => {
    handle = setupChromeFake(seed);
    await chrome.action.setPopup({ popup: '' });
    await expect(chrome.action.openPopup({ windowId: 3 })).rejects.toThrow(
      'Extension does not have a popup on the active tab.'
    );
  });

  test('a live window with a popup resolves', async () => {
    handle = setupChromeFake(seed);
    await expect(
      chrome.action.openPopup({ windowId: 3 })
    ).resolves.toBeUndefined();
  });

  test('seeded to refuse, it rejects with Failed to open popup.', async () => {
    handle = setupChromeFake({ ...seed, action: { openPopupRejects: true } });
    await expect(chrome.action.openPopup()).rejects.toThrow(
      'Failed to open popup.'
    );
    expect(handle.openPopupCalls).toHaveLength(1);
  });

  test('CONTROL: an unseeded fake has no chrome.action', () => {
    handle = setupChromeFake();
    expect(Reflect.get(chrome, 'action')).toBeUndefined();
  });
});

// KAN-460 Part 3, measured on Chromium 151 (ledger 2026-10-09-kan-460-part-3-incognito-measurement.md).
describe('incognito access', () => {
  test('isAllowedIncognitoAccess is false unless seeded, as Chrome installs it', async () => {
    handle = setupChromeFake();
    expect(await chrome.extension.isAllowedIncognitoAccess()).toBe(false);
    handle.restore();
    handle = setupChromeFake({ incognitoAllowed: true });
    expect(await chrome.extension.isAllowedIncognitoAccess()).toBe(true);
  });

  test('not allowed: an incognito create opens a window the extension never sees, and hands back null', async () => {
    handle = setupChromeFake({
      windows: [{ id: 1, tabs: [{ url: 'https://a.test/' }] }],
    });
    let called: unknown = 'never';
    const promised = await chrome.windows.create(
      { url: 'https://b.test/', incognito: true },
      (win) => {
        called = win;
      }
    );
    expect(promised).toBeNull();
    expect(called).toBeNull();
    expect(chrome.runtime.lastError).toBeUndefined();
    expect(handle.unseenIncognitoWindows).toBe(1);
    expect((await chrome.windows.getAll()).map((w) => w.id)).toEqual([1]);
  });

  test('allowed: an incognito create is an ordinary, visible incognito window', async () => {
    handle = setupChromeFake({ incognitoAllowed: true });
    const win = await chrome.windows.create({
      url: 'https://b.test/',
      incognito: true,
    });
    expect(win?.incognito).toBe(true);
    expect(handle.unseenIncognitoWindows).toBe(0);
  });

  test('a Tab Keeper page asked into an incognito window opens in the first normal window instead', async () => {
    handle = setupChromeFake({
      incognitoAllowed: true,
      windows: [
        { id: 1, incognito: true, tabs: [{ id: 10, url: 'https://i.test/' }] },
        { id: 2, tabs: [{ id: 20, url: 'https://n.test/' }] },
      ],
    });
    const tab = await chrome.tabs.create({
      windowId: 1,
      url: chrome.runtime.getURL('pinned.html'),
      pinned: true,
      index: 0,
    });
    expect(tab?.windowId).toBe(2);
    expect(tab?.index).toBe(0);
  });

  test('CONTROL: a web page asked into an incognito window opens there', async () => {
    handle = setupChromeFake({
      incognitoAllowed: true,
      windows: [
        { id: 1, incognito: true, tabs: [{ id: 10, url: 'https://i.test/' }] },
        { id: 2, tabs: [{ id: 20, url: 'https://n.test/' }] },
      ],
    });
    const tab = await chrome.tabs.create({
      windowId: 1,
      url: 'https://x.test/',
    });
    expect(tab?.windowId).toBe(1);
  });
});
