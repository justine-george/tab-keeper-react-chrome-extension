import { afterEach, describe, expect, test, vi } from 'vitest';

import { openBesideActiveTab } from '../../../utils/functions/openBesideActiveTab';
import { setupChromeFake } from '../../setup/chrome.fake';

// KAN-527. Closing the opened tab returns to the tab it was opened from only
// when it is created as that tab's child; measured in Chromium, which the fake
// does not model, so these pin the create call and e2e pins the landing.

const URL = 'chrome-extension://faketestid/export.html?source=open-windows';

let handle: ReturnType<typeof setupChromeFake> | undefined;

afterEach(() => {
  handle?.restore();
  handle = undefined;
  vi.restoreAllMocks();
});

// A B C D in window 1, B active; window 2 has its own active tab.
const seed = (overB: Partial<chrome.tabs.Tab> = {}) => ({
  windows: [
    {
      id: 1,
      tabs: [
        { id: 10, url: 'https://a.example/' },
        { id: 11, url: 'https://b.example/', active: true, ...overB },
        { id: 12, url: 'https://c.example/' },
        { id: 13, url: 'https://d.example/' },
      ],
    },
    { id: 2, tabs: [{ id: 20, url: 'https://x.example/', active: true }] },
  ],
});

describe('openBesideActiveTab', () => {
  test("opens right after the current window's active tab, as its child", async () => {
    handle = setupChromeFake(seed());

    await openBesideActiveTab(URL);

    expect(handle.createdTabs).toEqual([
      { url: URL, index: 2, openerTabId: 11, windowId: 1 },
    ]);
  });

  // CONTROL: window 2's active tab is a second candidate the query must skip.
  test("never another window's active tab", async () => {
    handle = setupChromeFake(seed());

    await openBesideActiveTab(URL);

    expect(handle.createdTabs[0].openerTabId).not.toBe(20);
    expect(handle.createdTabs[0].windowId).toBe(1);
  });

  // KAN-460 Part 3: Chrome puts a Tab Keeper page from an incognito window
  // into a normal one, where an incognito opener cannot follow it.
  test('from an incognito tab, opens it as before, with no position or opener', async () => {
    handle = setupChromeFake(seed({ incognito: true }));

    await openBesideActiveTab(URL);

    expect(handle.createdTabs).toEqual([{ url: URL }]);
  });

  test('with no active tab to read, opens it as before', async () => {
    handle = setupChromeFake({ windows: [{ id: 1, tabs: [] }] });

    await openBesideActiveTab(URL);

    expect(handle.createdTabs).toEqual([{ url: URL }]);
  });

  test('when reading the active tab fails, still opens it', async () => {
    handle = setupChromeFake(seed());
    vi.spyOn(chrome.tabs, 'query').mockRejectedValue(new Error('gone'));

    await openBesideActiveTab(URL);

    expect(handle.createdTabs).toEqual([{ url: URL }]);
  });
});
