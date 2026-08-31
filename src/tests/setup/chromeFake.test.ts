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
