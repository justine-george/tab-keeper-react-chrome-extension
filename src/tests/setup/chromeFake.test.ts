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
