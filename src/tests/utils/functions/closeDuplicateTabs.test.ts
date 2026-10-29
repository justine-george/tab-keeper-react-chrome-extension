import { afterEach, describe, expect, test, vi } from 'vitest';

import { toOpenWindows } from '../../../utils/functions/openNow';
import {
  closeDuplicateTabs,
  reopenClosed,
} from '../../../utils/functions/reopen';
import { setupChromeFake } from '../../setup/chrome.fake';
import type { ChromeFakeHandle, ChromeSeed } from '../../setup/chrome.fake';

// KAN-867. Remove duplicate tabs closes the extra copies in each window, and
// one Reopen puts every one of them back: same window, place, pin and group.

let handle: ChromeFakeHandle | undefined;
afterEach(() => {
  handle?.restore();
  handle = undefined;
  vi.restoreAllMocks();
});

const url = (name: string) => `https://${name}.test/`;

async function snapshot() {
  const all = await chrome.windows.getAll({
    populate: true,
    windowTypes: ['normal'],
  });
  const groups = chrome.tabGroups ? await chrome.tabGroups.query({}) : null;
  return toOpenWindows(all, groups, null);
}

// A window's tabs in Chrome's order: `*` active, `(pin)` pinned, `[title]` its group.
async function shape(windowId: number) {
  const tabs = (await chrome.tabs.query({ windowId })).sort(
    (a, b) => a.index - b.index
  );
  const titles = new Map<number, string>();
  if (chrome.tabGroups)
    for (const g of await chrome.tabGroups.query({ windowId }))
      titles.set(g.id, `${g.title}/${g.color}`);
  return tabs.map(
    (t) =>
      `${(t.url ?? '').replace('https://', '').replace('.test/', '')}${
        t.active ? '*' : ''
      }${t.pinned ? '(pin)' : ''}${
        t.groupId !== undefined && t.groupId !== -1
          ? `[${titles.get(t.groupId) ?? t.groupId}]`
          : ''
      }`
  );
}
const groupCount = async (windowId: number) =>
  (await chrome.tabGroups.query({ windowId })).length;

// Window 2: a, b, the Docs group (a, c, a), then b (active). Window 3: a, d, d.
const SEED: ChromeSeed = {
  grantedPermissions: ['tabGroups'],
  windows: [
    { id: 1, focused: true, tabs: [{ url: url('home'), active: true }] },
    {
      id: 2,
      tabs: [
        { url: url('a') },
        { url: url('b') },
        { url: url('a'), groupId: 50 },
        { url: url('c'), groupId: 50 },
        { url: url('a'), groupId: 50 },
        { url: url('b'), active: true },
      ],
    },
    {
      id: 3,
      tabs: [
        { url: url('a'), active: true },
        { url: url('d') },
        { url: url('d') },
      ],
    },
  ],
  tabGroups: [{ id: 50, windowId: 2, title: 'Docs', color: 'blue' }],
};

describe('closeDuplicateTabs', () => {
  test('closes only the extra copies in each window', async () => {
    handle = setupChromeFake(SEED);
    const item = await closeDuplicateTabs(await snapshot());
    expect(item?.kind).toBe('duplicateTabs');
    // Kept: the grouped a (first grouped copy), the active b; window 3 keeps its first d.
    expect(await shape(2)).toEqual(['a[Docs/blue]', 'c[Docs/blue]', 'b*']);
    expect(await shape(3)).toEqual(['a*', 'd']);
    expect(await shape(1)).toEqual(['home*']);
  });

  test('no copies anywhere: nothing closes, no item', async () => {
    handle = setupChromeFake({
      windows: [{ id: 2, tabs: [{ url: url('a') }, { url: url('b') }] }],
    });
    expect(await closeDuplicateTabs(await snapshot())).toBeNull();
    expect(await shape(2)).toEqual(['a', 'b']);
  });

  test('a window Chrome refuses is skipped; the others still close', async () => {
    handle = setupChromeFake(SEED);
    const windows = await snapshot();
    const w3 = windows.find((w) => w.id === 3);
    if (!w3) throw new Error('no window 3');
    const remove = chrome.tabs.remove.bind(chrome.tabs);
    vi.spyOn(chrome.tabs, 'remove').mockImplementation(
      async (ids: number | number[]) => {
        const list = Array.isArray(ids) ? ids : [ids];
        if (list.some((id) => w3.tabs.some((t) => t.id === id)))
          throw new Error('No tab with id');
        await remove(list);
      }
    );
    const item = await closeDuplicateTabs(windows);
    expect(item?.kind).toBe('duplicateTabs');
    expect(await shape(3)).toEqual(['a*', 'd', 'd']);
    expect(await shape(2)).toEqual(['a[Docs/blue]', 'c[Docs/blue]', 'b*']);
  });

  test('every remove refused: no item', async () => {
    handle = setupChromeFake(SEED);
    vi.spyOn(chrome.tabs, 'remove').mockRejectedValue(new Error('gone'));
    expect(await closeDuplicateTabs(await snapshot())).toBeNull();
  });
});

describe('reopenClosed: duplicate tabs', () => {
  test('every copy comes back in its window, place, pin and group', async () => {
    handle = setupChromeFake(SEED);
    const before2 = await shape(2);
    const before3 = await shape(3);
    const item = await closeDuplicateTabs(await snapshot());
    if (!item) throw new Error('close failed');
    expect(await reopenClosed(item, false)).toMatchObject({ kind: 'tab' });
    expect(await shape(2)).toEqual(before2);
    expect(await shape(3)).toEqual(before3);
    expect(await groupCount(2)).toBe(1);
  });

  test('two copies from a group the close emptied come back in ONE group like the old one', async () => {
    handle = setupChromeFake({
      grantedPermissions: ['tabGroups'],
      windows: [
        {
          id: 2,
          // The pinned b and the active a stay, so both grouped copies go.
          tabs: [
            { url: url('b'), pinned: true },
            { url: url('a'), active: true },
            { url: url('a'), groupId: 60 },
            { url: url('b'), groupId: 60 },
          ],
        },
      ],
      tabGroups: [
        { id: 60, windowId: 2, title: 'Gone', color: 'red', collapsed: true },
      ],
    });
    const item = await closeDuplicateTabs(await snapshot());
    if (!item) throw new Error('close failed');
    // PREMISE: the group went with its last tab.
    await expect(chrome.tabGroups.get(60)).rejects.toThrow();
    await reopenClosed(item, false);
    expect(await shape(2)).toEqual([
      'b(pin)',
      'a*',
      'a[Gone/red]',
      'b[Gone/red]',
    ]);
    expect(await groupCount(2)).toBe(1);
    const [g] = await chrome.tabGroups.query({ windowId: 2 });
    expect(g.collapsed).toBe(true);
  });

  test('a loose copy just after a group comes back loose, not in the group', async () => {
    handle = setupChromeFake({
      grantedPermissions: ['tabGroups'],
      windows: [
        {
          id: 2,
          tabs: [
            { url: url('a'), groupId: 70 },
            { url: url('c'), groupId: 70 },
            { url: url('a') },
            { url: url('x'), active: true },
          ],
        },
      ],
      tabGroups: [{ id: 70, windowId: 2, title: 'Mid', color: 'green' }],
    });
    const before = await shape(2);
    const item = await closeDuplicateTabs(await snapshot());
    if (!item) throw new Error('close failed');
    // PREMISE: the grouped a stayed, the loose a went.
    expect(await shape(2)).toEqual(['a[Mid/green]', 'c[Mid/green]', 'x*']);
    await reopenClosed(item, false);
    expect(await shape(2)).toEqual(before);
  });

  test('two copies from a group that is still there both rejoin it', async () => {
    handle = setupChromeFake({
      grantedPermissions: ['tabGroups'],
      windows: [
        {
          id: 2,
          tabs: [
            { url: url('x'), active: true },
            { url: url('a'), groupId: 80 },
            { url: url('a'), groupId: 80 },
            { url: url('a'), groupId: 80 },
            { url: url('c'), groupId: 80 },
          ],
        },
      ],
      tabGroups: [{ id: 80, windowId: 2, title: 'Kept', color: 'pink' }],
    });
    const before = await shape(2);
    const item = await closeDuplicateTabs(await snapshot());
    if (!item) throw new Error('close failed');
    expect(await shape(2)).toEqual(['x*', 'a[Kept/pink]', 'c[Kept/pink]']);
    await reopenClosed(item, false);
    expect(await shape(2)).toEqual(before);
    expect(await groupCount(2)).toBe(1);
  });

  // As KAN-309 for one tab: a loose copy whose old spot is now inside a group's run comes back loose, after the run.
  test("a group formed over a loose copy's old spot: it comes back loose", async () => {
    handle = setupChromeFake({
      grantedPermissions: ['tabGroups'],
      windows: [
        {
          id: 2,
          tabs: [
            { url: url('a') },
            { url: url('x') },
            { url: url('b') },
            { url: url('x'), active: true },
          ],
        },
      ],
    });
    const item = await closeDuplicateTabs(await snapshot());
    if (!item) throw new Error('close failed');
    const tabs = await chrome.tabs.query({ windowId: 2 });
    const id = (name: string) =>
      tabs.find((t) => t.url === url(name))?.id ?? -1;
    await chrome.tabs.group({
      createProperties: { windowId: 2 },
      tabIds: [id('a'), id('b')],
    });
    await reopenClosed(item, false);
    const x = (await chrome.tabs.query({ windowId: 2 })).filter(
      (t) => t.url === url('x') && !t.active
    );
    expect(x).toHaveLength(1);
    expect(x[0].groupId).toBe(-1);
  });

  test('a pinned copy comes back pinned', async () => {
    handle = setupChromeFake({
      windows: [
        {
          id: 2,
          tabs: [
            { url: url('a'), pinned: true },
            { url: url('b'), pinned: true },
            { url: url('b'), active: true },
          ],
        },
      ],
    });
    const before = await shape(2);
    const item = await closeDuplicateTabs(await snapshot());
    if (!item) throw new Error('close failed');
    expect(await shape(2)).toEqual(['a(pin)', 'b*']);
    await reopenClosed(item, false);
    expect(await shape(2)).toEqual(before);
  });

  test('a window closed before Reopen is rebuilt around its copies', async () => {
    handle = setupChromeFake(SEED);
    const item = await closeDuplicateTabs(await snapshot());
    if (!item) throw new Error('close failed');
    await chrome.windows.remove(3);
    const ids = async () =>
      (await chrome.windows.getAll({})).map((w) => w.id ?? -1);
    const before = await ids();
    await reopenClosed(item, false);
    const fresh = (await ids()).filter((id) => !before.includes(id));
    expect(fresh).toHaveLength(1);
    expect(await shape(fresh[0])).toEqual([expect.stringMatching(/^d/)]);
  });

  test('only a closed window had copies: Reopen still reports what came back', async () => {
    handle = setupChromeFake({
      windows: [
        { id: 1, focused: true, tabs: [{ url: url('home'), active: true }] },
        { id: 3, tabs: [{ url: url('d'), active: true }, { url: url('d') }] },
      ],
    });
    const item = await closeDuplicateTabs(await snapshot());
    if (!item) throw new Error('close failed');
    await chrome.windows.remove(3);
    expect(await reopenClosed(item, false)).toMatchObject({ kind: 'tab' });
  });

  test('never asks for the sessions permission', async () => {
    handle = setupChromeFake(SEED);
    const request = vi.spyOn(chrome.permissions, 'request');
    const item = await closeDuplicateTabs(await snapshot());
    if (!item) throw new Error('close failed');
    await reopenClosed(item, false);
    expect(request).not.toHaveBeenCalled();
  });
});
