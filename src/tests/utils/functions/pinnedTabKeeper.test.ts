import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  addPinnedStub,
  carryPinnedTab,
  ensurePinnedStub,
  findCarriedTab,
  isStub,
  isTabKeeperTab,
} from '../../../utils/functions/pinnedTabKeeper';
import { setupChromeFake } from '../../setup/chrome.fake';
import type { ChromeFakeHandle } from '../../setup/chrome.fake';

const EXT = 'chrome-extension://faketestid/';
const FULL = `${EXT}index.html?view=tab`;
const STUB = `${EXT}pinned.html`;
const web = (name: string) => `https://${name}.test/`;

let handle: ChromeFakeHandle | undefined;
afterEach(() => {
  handle?.restore();
  handle = undefined;
  vi.restoreAllMocks();
});

const tabsOf = async (windowId: number) =>
  (await chrome.tabs.query({ windowId }))
    .sort((a, b) => a.index - b.index)
    .map((t) => ({ url: t.url, pinned: t.pinned, active: t.active }));

describe('isTabKeeperTab / isStub', () => {
  test.each([
    [FULL, true, false],
    [`${FULL}&show=setup`, true, false],
    [STUB, true, true],
    [`${EXT}index.html`, false, false],
    [`${EXT}export.html?id=1`, false, false],
    [web('a'), false, false],
    ['', false, false],
  ])('%s → Tab Keeper tab %s, stub %s', (url, tk, stub) => {
    handle = setupChromeFake();
    expect(isTabKeeperTab({ url })).toBe(tk);
    expect(isStub({ url })).toBe(stub);
  });

  test('reads pendingUrl while url has not committed', () => {
    handle = setupChromeFake();
    expect(isTabKeeperTab({ url: '', pendingUrl: STUB })).toBe(true);
  });
});

describe('findCarriedTab', () => {
  const win = (id: number, tabs: Partial<chrome.tabs.Tab>[]) =>
    ({
      id,
      tabs: tabs.map((t) => ({ windowId: id, ...t })),
    }) as chrome.windows.Window;

  test('none pinned → null', () => {
    handle = setupChromeFake();
    expect(
      findCarriedTab([win(1, [{ id: 1, url: FULL, pinned: false }])], 1)
    ).toBeNull();
  });

  test('a pinned web tab is not carried', () => {
    handle = setupChromeFake();
    expect(
      findCarriedTab([win(1, [{ id: 1, url: web('a'), pinned: true }])], 1)
    ).toBeNull();
  });

  test("the last-focused window's pinned Tab Keeper tab wins", () => {
    handle = setupChromeFake();
    const found = findCarriedTab(
      [
        win(1, [{ id: 11, url: STUB, pinned: true }]),
        win(2, [{ id: 21, url: FULL, pinned: true }]),
      ],
      2
    );
    expect(found?.id).toBe(21);
  });

  test('within the chosen window, a loaded full view is carried over a stub', () => {
    handle = setupChromeFake();
    const found = findCarriedTab(
      [
        win(1, [{ id: 11, url: FULL, pinned: true }]),
        win(2, [
          { id: 21, url: STUB, pinned: true },
          { id: 22, url: FULL, pinned: true },
        ]),
      ],
      2
    );
    expect(found?.id).toBe(22);
  });

  test('with no last-focused match, the first found', () => {
    handle = setupChromeFake();
    const found = findCarriedTab(
      [
        win(1, [{ id: 11, url: STUB, pinned: true }]),
        win(2, [{ id: 21, url: FULL, pinned: true }]),
      ],
      undefined
    );
    expect(found?.id).toBe(11);
  });
});

describe('addPinnedStub / ensurePinnedStub', () => {
  test('adds a pinned, inactive stub at index 0; the active tab stays active', async () => {
    handle = setupChromeFake({
      windows: [{ id: 5, tabs: [{ id: 1, url: web('a'), active: true }] }],
    });
    await addPinnedStub(5);
    expect(await tabsOf(5)).toEqual([
      { url: STUB, pinned: true, active: false },
      { url: web('a'), pinned: false, active: true },
    ]);
  });

  test('a refused create is logged, never thrown', async () => {
    handle = setupChromeFake({
      windows: [{ id: 5, tabs: [{ id: 1, url: web('a'), active: true }] }],
      refusedUrls: [STUB],
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await expect(addPinnedStub(5)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    expect(await tabsOf(5)).toEqual([
      { url: web('a'), pinned: false, active: true },
    ]);
  });

  test('ensurePinnedStub adds nothing when the window already has a pinned Tab Keeper tab', async () => {
    handle = setupChromeFake({
      windows: [
        {
          id: 5,
          tabs: [
            { id: 1, url: FULL, pinned: true },
            { id: 2, url: web('a'), active: true },
          ],
        },
      ],
    });
    await ensurePinnedStub(5);
    expect((await tabsOf(5)).map((t) => t.url)).toEqual([FULL, web('a')]);
  });

  test('ensurePinnedStub adds one beside an UNpinned Tab Keeper tab', async () => {
    handle = setupChromeFake({
      windows: [{ id: 5, tabs: [{ id: 1, url: FULL, active: true }] }],
    });
    await ensurePinnedStub(5);
    expect((await tabsOf(5)).map((t) => t.url)).toEqual([STUB, FULL]);
  });
});

describe('carryPinnedTab', () => {
  test('moves the tab to index 0 of the other window and pins it again', async () => {
    handle = setupChromeFake({
      windows: [
        {
          id: 1,
          tabs: [
            { id: 10, url: FULL, pinned: true },
            { id: 11, url: web('old') },
          ],
        },
        { id: 2, tabs: [{ id: 20, url: web('new'), active: true }] },
      ],
    });
    expect(await carryPinnedTab(10, 2)).toBe(true);
    expect(await tabsOf(2)).toEqual([
      { url: FULL, pinned: true, active: false },
      { url: web('new'), pinned: false, active: true },
    ]);
  });

  test("lands before the window's own pinned tabs (KAN-458)", async () => {
    handle = setupChromeFake({
      windows: [
        {
          id: 1,
          tabs: [
            { id: 10, url: FULL, pinned: true },
            { id: 11, url: web('old') },
          ],
        },
        {
          id: 2,
          tabs: [
            { id: 20, url: web('mail'), pinned: true },
            { id: 21, url: web('new'), active: true },
          ],
        },
      ],
    });
    expect(await carryPinnedTab(10, 2)).toBe(true);
    expect(await tabsOf(2)).toEqual([
      { url: FULL, pinned: true, active: false },
      { url: web('mail'), pinned: true, active: false },
      { url: web('new'), pinned: false, active: true },
    ]);
  });

  test('a refused re-pin still answers true: the tab is in the new window', async () => {
    handle = setupChromeFake({
      windows: [
        {
          id: 1,
          tabs: [
            { id: 10, url: FULL, pinned: true },
            { id: 11, url: web('old') },
          ],
        },
        { id: 2, tabs: [{ id: 20, url: web('new'), active: true }] },
      ],
    });
    vi.spyOn(chrome.tabs, 'update').mockRejectedValue(new Error('refused'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(await carryPinnedTab(10, 2)).toBe(true);
    expect(warn).toHaveBeenCalled();
    expect((await tabsOf(2)).map((t) => t.url)).toEqual([FULL, web('new')]);
  });

  test('a refused placement still answers true: the tab stays pinned, after the window pins', async () => {
    handle = setupChromeFake({
      windows: [
        {
          id: 1,
          tabs: [
            { id: 10, url: FULL, pinned: true },
            { id: 11, url: web('old') },
          ],
        },
        {
          id: 2,
          tabs: [
            { id: 20, url: web('mail'), pinned: true },
            { id: 21, url: web('new'), active: true },
          ],
        },
      ],
    });
    const move = chrome.tabs.move;
    vi.spyOn(chrome.tabs, 'move')
      .mockImplementationOnce(move)
      .mockRejectedValueOnce(new Error('refused'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(await carryPinnedTab(10, 2)).toBe(true);
    expect(warn).toHaveBeenCalled();
    expect(await tabsOf(2)).toEqual([
      { url: web('mail'), pinned: true, active: false },
      { url: FULL, pinned: true, active: false },
      { url: web('new'), pinned: false, active: true },
    ]);
  });

  test('a refused move answers false and leaves the tab where it was', async () => {
    handle = setupChromeFake({
      windows: [
        {
          id: 1,
          tabs: [
            { id: 10, url: FULL, pinned: true },
            { id: 11, url: web('old') },
          ],
        },
      ],
    });
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(await carryPinnedTab(10, 404)).toBe(false);
    expect((await tabsOf(1))[0]).toEqual({
      url: FULL,
      pinned: true,
      active: false,
    });
  });
});
