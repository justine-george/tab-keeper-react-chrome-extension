import { afterEach, describe, expect, test, vi } from 'vitest';

import { moveIntoNewWindow } from '../../../utils/functions/moveToNewWindow';
import type { GroupLook } from '../../../utils/functions/openNowMoves';
import { setupChromeFake } from '../../setup/chrome.fake';
import type { ChromeFakeHandle, ChromeSeed } from '../../setup/chrome.fake';

// KAN-949. The fake's windows.create({tabId}) follows the ledger's probes 1-2 (Chromium 156): the tab arrives
// unpinned, ungrouped and out of its split, so each of those is put back here.

let handle: ChromeFakeHandle | undefined;

afterEach(() => {
  handle?.restore();
  handle = undefined;
});

// A window's strip: `P` pinned, `*` active, `gN` in group N, `sN` in split N.
const strip = async (windowId: number) =>
  (await chrome.tabs.query({ windowId }))
    .sort((a, b) => a.index - b.index)
    .map(
      (t) =>
        `${t.id}${t.pinned ? 'P' : ''}${t.active ? '*' : ''}${
          t.groupId === -1 ? '' : `g${t.groupId}`
        }`
    );

const windowIds = async () =>
  (await chrome.windows.getAll({})).map((w) => w.id).sort();

const anyNewTab = async () =>
  (await chrome.tabs.query({})).some((t) =>
    (t.pendingUrl || t.url || '').startsWith('chrome://newtab')
  );

const BLUE: GroupLook = { title: 'Work', color: 'blue', collapsed: true };

const seed = (more: Partial<ChromeSeed> = {}) =>
  setupChromeFake({
    splitView: true,
    windows: [
      {
        id: 1,
        focused: true,
        tabs: [{ id: 11, active: true }, { id: 12 }, { id: 13 }, { id: 14 }],
      },
      { id: 2, tabs: [{ id: 21, active: true }] },
    ],
    ...more,
  });

describe('moveIntoNewWindow: a tab', () => {
  test('moves into a new focused window that holds only it', async () => {
    handle = seed();

    const result = await moveIntoNewWindow(
      { kind: 'tab', tabId: 12 },
      true,
      false
    );

    expect(result).not.toBeNull();
    const windowId = result?.windowId ?? -1;
    expect(await windowIds()).toEqual([1, 2, windowId].sort());
    expect(await strip(windowId)).toEqual(['12*']);
    expect(await strip(1)).toEqual(['11*', '13', '14']);
    expect((await chrome.windows.getLastFocused()).id).toBe(windowId);
  });

  test('the active tab leaves no blank tab: the old window keeps the rest in order', async () => {
    handle = seed();

    const result = await moveIntoNewWindow(
      { kind: 'tab', tabId: 11 },
      true,
      false
    );

    expect(await strip(result?.windowId ?? -1)).toEqual(['11*']);
    expect((await strip(1)).map((t) => t.replace('*', ''))).toEqual([
      '12',
      '13',
      '14',
    ]);
    expect(await anyNewTab()).toBe(false);
  });

  test('a pinned tab arrives pinned', async () => {
    handle = seed({
      windows: [
        {
          id: 1,
          tabs: [
            { id: 11, pinned: true },
            { id: 12, active: true },
          ],
        },
      ],
    });

    const result = await moveIntoNewWindow(
      { kind: 'tab', tabId: 11 },
      true,
      false
    );

    expect(await strip(result?.windowId ?? -1)).toEqual(['11P*']);
    expect(result?.moved).toEqual([
      {
        tabId: 11,
        before: {
          windowId: 1,
          index: 0,
          groupId: -1,
          group: null,
          pinned: true,
        },
        after: {
          windowId: result?.windowId,
          index: 0,
          groupId: -1,
          group: null,
          pinned: true,
        },
      },
    ]);
  });

  test('a tab in a group leaves the group behind', async () => {
    handle = seed({
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
      tabGroups: [{ id: 5, windowId: 1, title: 'Work', color: 'blue' }],
    });

    const result = await moveIntoNewWindow(
      { kind: 'tab', tabId: 12 },
      true,
      false
    );

    expect(await strip(result?.windowId ?? -1)).toEqual(['12*']);
    expect(await strip(1)).toEqual(['11*', '13g5']);
  });

  test('an incognito tab moves into a new incognito window', async () => {
    handle = seed({
      incognitoAllowed: true,
      windows: [
        {
          id: 1,
          incognito: true,
          tabs: [{ id: 11, active: true }, { id: 12 }],
        },
        { id: 2, tabs: [{ id: 21, active: true }] },
      ],
    });

    const result = await moveIntoNewWindow(
      { kind: 'tab', tabId: 12 },
      true,
      false
    );

    expect(result).not.toBeNull();
    const made = await chrome.windows.get(result?.windowId ?? -1);
    expect(made.incognito).toBe(true);
    expect(await strip(made.id ?? -1)).toEqual(['12*']);
  });

  test('records each tab before and after', async () => {
    handle = seed();

    const result = await moveIntoNewWindow(
      { kind: 'tab', tabId: 13 },
      false,
      false
    );

    expect(result?.moved).toEqual([
      {
        tabId: 13,
        before: {
          windowId: 1,
          index: 2,
          groupId: -1,
          group: null,
          pinned: false,
        },
        after: {
          windowId: result?.windowId,
          index: 0,
          groupId: -1,
          group: null,
          pinned: false,
        },
      },
    ]);
  });

  test('a closed tab refuses: null, and no window is made', async () => {
    handle = seed();

    expect(
      await moveIntoNewWindow({ kind: 'tab', tabId: 99 }, true, false)
    ).toBe(null);
    expect(await windowIds()).toEqual([1, 2]);
  });
});

// KAN-949 Goal 3a: "Pin Tab Keeper in new windows" covers this window too.
describe('moveIntoNewWindow: the pinned Tab Keeper tab', () => {
  const STUB = 'chrome-extension://faketestid/pinned.html';

  test('asked for, it is added first and pinned, beside the moved tab', async () => {
    handle = seed();

    const result = await moveIntoNewWindow(
      { kind: 'tab', tabId: 12 },
      true,
      true
    );

    const windowId = result?.windowId ?? -1;
    const tabs = (await chrome.tabs.query({ windowId })).sort(
      (a, b) => a.index - b.index
    );
    expect(tabs.map((t) => [t.url, t.pinned])).toEqual([
      [STUB, true],
      [expect.not.stringContaining('pinned.html'), false],
    ]);
    expect(result?.stubTabId).toBe(tabs[0]?.id);
    expect(result?.moved[0]?.after.index).toBe(1);
    expect((await chrome.tabs.get(12)).active).toBe(true);
  });

  test('not asked for, the window holds only the moved tab', async () => {
    handle = seed();

    const result = await moveIntoNewWindow(
      { kind: 'tab', tabId: 12 },
      true,
      false
    );

    expect(result?.stubTabId).toBeNull();
    expect(await strip(result?.windowId ?? -1)).toEqual(['12*']);
  });

  test('an incognito window gets none', async () => {
    handle = seed({
      incognitoAllowed: true,
      windows: [
        {
          id: 1,
          incognito: true,
          tabs: [{ id: 11, active: true }, { id: 12 }],
        },
      ],
    });

    const result = await moveIntoNewWindow(
      { kind: 'tab', tabId: 12 },
      true,
      true
    );

    expect(result?.stubTabId).toBeNull();
    expect(await strip(result?.windowId ?? -1)).toEqual(['12*']);
  });
});

describe('moveIntoNewWindow: a pair', () => {
  test('arrives still split, in order', async () => {
    handle = seed();
    const split = Reflect.get(chrome.tabs, 'createSplit') as (
      ids: number[]
    ) => Promise<number>;
    await split([12, 13]);

    const result = await moveIntoNewWindow(
      { kind: 'pair', pair: { first: 12, second: 13 } },
      true,
      false
    );

    const windowId = result?.windowId ?? -1;
    expect((await strip(windowId)).map((t) => t.replace('*', ''))).toEqual([
      '12',
      '13',
    ]);
    const [a, b] = await Promise.all([
      chrome.tabs.get(12),
      chrome.tabs.get(13),
    ]);
    expect(a.splitViewId).toBeGreaterThan(0);
    expect(b.splitViewId).toBe(a.splitViewId);
    expect(await strip(1)).toEqual(['11*', '14']);
    expect(result?.moved.map((t) => [t.tabId, t.after.index])).toEqual([
      [12, 0],
      [13, 1],
    ]);
  });

  test('a pinned pair arrives pinned and split', async () => {
    handle = seed({
      windows: [
        {
          id: 1,
          tabs: [
            { id: 11, pinned: true },
            { id: 12, pinned: true },
            { id: 13, active: true },
          ],
        },
      ],
    });
    const split = Reflect.get(chrome.tabs, 'createSplit') as (
      ids: number[]
    ) => Promise<number>;
    await split([11, 12]);

    const result = await moveIntoNewWindow(
      { kind: 'pair', pair: { first: 11, second: 12 } },
      true,
      false
    );

    const windowId = result?.windowId ?? -1;
    expect((await strip(windowId)).map((t) => t.replace('*', ''))).toEqual([
      '11P',
      '12P',
    ]);
    expect((await chrome.tabs.get(11)).splitViewId).toBeGreaterThan(0);
  });

  test('two tabs that are no longer one split refuse, nothing made', async () => {
    handle = seed();

    expect(
      await moveIntoNewWindow(
        { kind: 'pair', pair: { first: 12, second: 13 } },
        true,
        false
      )
    ).toBe(null);
    expect(await windowIds()).toEqual([1, 2]);
  });
});

describe('moveIntoNewWindow: a group', () => {
  const grouped = (more: Partial<ChromeSeed> = {}) =>
    seed({
      windows: [
        {
          id: 1,
          tabs: [
            { id: 11 },
            { id: 12, groupId: 5, active: true },
            { id: 13, groupId: 5 },
            { id: 14, groupId: 5 },
          ],
        },
        { id: 2, tabs: [{ id: 21, active: true }] },
      ],
      tabGroups: [
        { id: 5, windowId: 1, title: 'Work', color: 'blue', collapsed: true },
      ],
      ...more,
    });

  test('arrives as one group with its title, color and collapsed state', async () => {
    handle = grouped();

    const result = await moveIntoNewWindow(
      { kind: 'group', tabIds: [12, 13, 14], look: BLUE },
      true,
      false
    );

    const windowId = result?.windowId ?? -1;
    const groupId = (await chrome.tabs.get(12)).groupId;
    expect(groupId).not.toBe(-1);
    expect(await strip(windowId)).toEqual([
      `12*g${groupId}`,
      `13g${groupId}`,
      `14g${groupId}`,
    ]);
    const look = await chrome.tabGroups.get(groupId);
    expect([look.title, look.color, look.collapsed]).toEqual([
      'Work',
      'blue',
      true,
    ]);
    expect(await strip(1)).toEqual(['11*']);
    expect(await anyNewTab()).toBe(false);
    expect(result?.moved.map((t) => t.after.group)).toEqual([BLUE, BLUE, BLUE]);
    expect(result?.moved.map((t) => t.before.windowId)).toEqual([1, 1, 1]);
  });

  test('a one-tab group arrives grouped, with its look', async () => {
    handle = seed({
      windows: [
        {
          id: 1,
          tabs: [
            { id: 11, active: true },
            { id: 12, groupId: 5 },
          ],
        },
      ],
      tabGroups: [
        { id: 5, windowId: 1, title: 'Work', color: 'blue', collapsed: true },
      ],
    });

    const result = await moveIntoNewWindow(
      { kind: 'group', tabIds: [12], look: BLUE },
      true,
      false
    );

    const groupId = (await chrome.tabs.get(12)).groupId;
    expect(groupId).not.toBe(-1);
    const look = await chrome.tabGroups.get(groupId);
    expect([look.title, look.color, look.collapsed]).toEqual([
      'Work',
      'blue',
      true,
    ]);
    expect((await strip(result?.windowId ?? -1)).length).toBe(1);
  });

  test('a split inside the group stays split', async () => {
    handle = grouped();
    const split = Reflect.get(chrome.tabs, 'createSplit') as (
      ids: number[]
    ) => Promise<number>;
    await split([12, 13]);

    await moveIntoNewWindow(
      { kind: 'group', tabIds: [12, 13, 14], look: BLUE },
      true,
      false
    );

    const [a, b] = await Promise.all([
      chrome.tabs.get(12),
      chrome.tabs.get(13),
    ]);
    expect(a.splitViewId).toBeGreaterThan(0);
    expect(b.splitViewId).toBe(a.splitViewId);
  });

  // KAN-950. Past windows.create a refusal no longer loses the move: it is reported, with where each tab is.
  test('refused after the window is made: reported as stopped part way, with each tab where it is', async () => {
    handle = grouped();
    vi.spyOn(chrome.tabGroups, 'move').mockRejectedValueOnce(
      new Error('refused')
    );

    const result = await moveIntoNewWindow(
      { kind: 'group', tabIds: [12, 13, 14], look: BLUE },
      true,
      false
    );

    expect(result?.finished).toBe(false);
    expect(result?.moved.map((t) => [t.tabId, t.after.windowId])).toEqual([
      [12, result?.windowId],
      [13, 1],
      [14, 1],
    ]);
  });

  test('a move that went through says so', async () => {
    handle = grouped();

    const result = await moveIntoNewWindow(
      { kind: 'group', tabIds: [12, 13, 14], look: BLUE },
      true,
      false
    );

    expect(result?.finished).toBe(true);
  });

  test('without the tabGroups grant a group refuses: null, nothing moved', async () => {
    handle = grouped();

    expect(
      await moveIntoNewWindow(
        { kind: 'group', tabIds: [12, 13, 14], look: BLUE },
        false,
        false
      )
    ).toBe(null);
    expect(await windowIds()).toEqual([1, 2]);
  });

  test('ids that are not the whole group refuse: null, nothing moved', async () => {
    handle = grouped();

    expect(
      await moveIntoNewWindow(
        { kind: 'group', tabIds: [12, 13], look: BLUE },
        true,
        false
      )
    ).toBe(null);
    expect(await windowIds()).toEqual([1, 2]);
  });
});
