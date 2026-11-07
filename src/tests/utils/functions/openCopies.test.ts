import { afterEach, describe, expect, test, vi } from 'vitest';

import type { tabData } from '../../../redux/slices/tabContainerDataStateSlice';
import { generatePlaceholderURL } from '../../../utils/functions/local';
import {
  openGroupCopy,
  openPairCopy,
  openTabCopy,
} from '../../../utils/functions/openCopies';
import { copyLooks } from '../../../utils/functions/copyLooks';
import { setupChromeFake } from '../../setup/chrome.fake';
import type { ChromeFakeHandle } from '../../setup/chrome.fake';

let handle: ChromeFakeHandle | undefined;

afterEach(() => {
  handle?.restore();
  handle = undefined;
  vi.restoreAllMocks();
});

const GO_TO = 'Go to page';
const ICON = 'data:image/png;base64,AAAA';

const saved = (n: number, more: Partial<tabData> = {}): tabData => ({
  tabId: `s${n}`,
  favicon: ICON,
  title: `Page ${n}`,
  url: `https://page${n}.example/`,
  ...more,
});

const placeholderOf = (tab: tabData) =>
  generatePlaceholderURL(tab.title, tab.favicon, tab.url, GO_TO);

// A window's strip as Chrome has it: `P` pinned, `*` active, `gN` in group N.
const strip = async (windowId: number) =>
  (await chrome.tabs.query({ windowId }))
    .sort((a, b) => a.index - b.index)
    .map(
      (t) =>
        `${t.id}${t.pinned ? 'P' : ''}${t.active ? '*' : ''}${
          t.groupId === -1 ? '' : `g${t.groupId}`
        }`
    );

const tabsNow = async () => (await chrome.tabs.query({})).length;

describe('openTabCopy', () => {
  const oneWindow = () =>
    setupChromeFake({
      windows: [
        {
          id: 1,
          tabs: [
            { id: 11, pinned: true },
            { id: 12, active: true },
            { id: 13 },
          ],
        },
      ],
    });

  test('opens one tab at the slot, in the background, at its real page', async () => {
    handle = oneWindow();

    const id = await openTabCopy(saved(1), {
      windowId: 1,
      index: 2,
      pinned: false,
    });

    expect(handle.createdTabs).toEqual([
      { windowId: 1, url: 'https://page1.example/', active: false, index: 2 },
    ]);
    expect(await strip(1)).toEqual(['11P', '12*', `${id}`, '13']);
  });

  test('pins only when the slot says so, whatever the saved pin', async () => {
    handle = oneWindow();

    const pinnedId = await openTabCopy(saved(1), {
      windowId: 1,
      index: 1,
      pinned: true,
    });
    const unpinnedId = await openTabCopy(saved(2, { pinned: true }), {
      windowId: 1,
      index: 4,
      pinned: false,
    });

    expect(await strip(1)).toEqual([
      '11P',
      `${pinnedId}P`,
      '12*',
      '13',
      `${unpinnedId}`,
    ]);
  });

  test('joins the group the band named', async () => {
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
      tabGroups: [{ id: 5, windowId: 1, title: 'Work', color: 'blue' }],
    });

    const id = await openTabCopy(saved(1), {
      windowId: 1,
      index: 1,
      pinned: false,
      groupId: 5,
    });

    expect(await strip(1)).toEqual(['11*', `${id}g5`, '12g5', '13g5']);
  });

  // Review Focus 1: no band named means loose, even where Chrome's index
  // falls inside a run and Chrome groups the new tab itself.
  test('comes out ungrouped when Chrome put it in a group no band named', async () => {
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
      tabGroups: [{ id: 5, windowId: 1, title: 'Work', color: 'blue' }],
    });

    const id = await openTabCopy(saved(1), {
      windowId: 1,
      index: 2,
      pinned: false,
    });

    expect((await chrome.tabs.get(id as number)).groupId).toBe(-1);
  });

  test("without the grant Chrome's own join stands, as an Open now move's does", async () => {
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
      tabGroupsApiAbsent: true,
    });

    const id = await openTabCopy(saved(1), {
      windowId: 1,
      index: 2,
      pinned: false,
    });

    expect(await strip(1)).toEqual(['11*', '12g5', `${id}g5`, '13g5']);
  });

  test('into a window closed meanwhile: opens nothing, resolves undefined, never throws', async () => {
    handle = setupChromeFake({
      windows: [
        { id: 1, tabs: [{ id: 11, active: true }] },
        { id: 2, tabs: [{ id: 21, active: true }] },
      ],
    });
    handle.browser.closeWindow(2);
    const before = await tabsNow();

    await expect(
      openTabCopy(saved(1), { windowId: 2, index: 0, pinned: false })
    ).resolves.toBeUndefined();
    expect(await tabsNow()).toBe(before);
  });
});

// KAN-851. Each copy's saved look, by the id Chrome gave it, for Open now to
// draw until Chrome has the page's own title.
describe('the saved look of each copy', () => {
  test('a tab: its saved title and icon, under its new id', async () => {
    handle = setupChromeFake({ windows: [{ id: 1, tabs: [{ id: 11 }] }] });

    const id = await openTabCopy(saved(1), {
      windowId: 1,
      index: 1,
      pinned: false,
    });

    if (id === undefined) throw new Error('Chrome opened no copy');
    expect(copyLooks().get(id)).toEqual({ title: 'Page 1', favIconUrl: ICON });
  });

  test("a group: each tab's, under its own id", async () => {
    handle = setupChromeFake({ windows: [{ id: 1, tabs: [{ id: 11 }] }] });

    const ids = await openGroupCopy(
      [saved(1), saved(2)],
      { groupId: 'g1', title: 'Work', color: 'blue' },
      { windowId: 1, index: 1 },
      GO_TO
    );

    expect(ids.map((id) => id !== undefined && copyLooks().get(id))).toEqual([
      { title: 'Page 1', favIconUrl: ICON },
      { title: 'Page 2', favIconUrl: ICON },
    ]);
  });

  test('a tab Chrome refuses: none', async () => {
    handle = setupChromeFake({ windows: [{ id: 1, tabs: [{ id: 11 }] }] });

    const before = copyLooks().size;

    await openTabCopy(saved(1), { windowId: 99, index: 0, pinned: false });

    expect(copyLooks().size).toBe(before);
  });
});

describe('openGroupCopy', () => {
  const work = { groupId: 'g1', title: 'Work', color: 'blue' };

  const twoTabs = (more: Parameters<typeof setupChromeFake>[0] = {}) =>
    setupChromeFake({
      windows: [{ id: 1, tabs: [{ id: 11, active: true }, { id: 12 }] }],
      ...more,
    });

  test('first tab real, the rest placeholders, none active, contiguous at the slot', async () => {
    handle = twoTabs();
    const tabs = [saved(1), saved(2), saved(3)];

    const ids = await openGroupCopy(
      tabs,
      work,
      { windowId: 1, index: 1 },
      GO_TO
    );

    expect(handle.createdTabs.map((props) => props.url)).toEqual([
      'https://page1.example/',
      placeholderOf(tabs[1]),
      placeholderOf(tabs[2]),
    ]);
    expect(handle.createdTabs.every((props) => props.active === false)).toBe(
      true
    );
    const strips = await strip(1);
    expect(strips.slice(1, 4).map((s) => s.replace(/g\d+$/, ''))).toEqual(
      ids.map(String)
    );
    expect(strips[0]).toBe('11*');
    expect(strips[4]).toBe('12');
  });

  test('a page no swap loads opens real, as Open does (restoreRoute open)', async () => {
    handle = twoTabs();
    const dataPage = saved(2, { url: 'data:text/html,hi' });

    await openGroupCopy(
      [saved(1), dataPage],
      work,
      { windowId: 1, index: 1 },
      GO_TO
    );

    expect(handle.createdTabs[1].url).toBe('data:text/html,hi');
  });

  test('forms one group with the saved title and colour, not collapsed', async () => {
    handle = twoTabs();

    const ids = await openGroupCopy(
      [saved(1), saved(2)],
      work,
      { windowId: 1, index: 1 },
      GO_TO
    );

    const first = await chrome.tabs.get(ids[0] as number);
    const second = await chrome.tabs.get(ids[1] as number);
    expect(first.groupId).not.toBe(-1);
    expect(second.groupId).toBe(first.groupId);
    const group = await chrome.tabGroups.get(first.groupId);
    expect(group).toMatchObject({
      title: 'Work',
      color: 'blue',
      collapsed: false,
    });
  });

  test('never pins, even a tab saved pinned', async () => {
    handle = twoTabs();

    const ids = await openGroupCopy(
      [saved(1, { pinned: true }), saved(2, { pinned: true })],
      work,
      { windowId: 1, index: 1 },
      GO_TO
    );

    for (const id of ids) {
      expect((await chrome.tabs.get(id as number)).pinned).toBe(false);
    }
  });

  // With the grant, tabs.group would unpin them anyway; without it nothing would.
  test('without the grant a tab saved pinned still opens unpinned', async () => {
    handle = twoTabs({ tabGroupsApiAbsent: true });

    const ids = await openGroupCopy(
      [saved(1, { pinned: true }), saved(2, { pinned: true })],
      work,
      { windowId: 1, index: 1 },
      GO_TO
    );

    expect(await strip(1)).toEqual(['11*', `${ids[0]}`, `${ids[1]}`, '12']);
  });

  test('without the grant the tabs open plain, in order, and nothing throws', async () => {
    handle = twoTabs({ tabGroupsApiAbsent: true });

    const ids = await openGroupCopy(
      [saved(1), saved(2)],
      work,
      { windowId: 1, index: 1 },
      GO_TO
    );

    expect(await strip(1)).toEqual(['11*', `${ids[0]}`, `${ids[1]}`, '12']);
  });

  test('a refused tab is skipped; the rest stay together and still group', async () => {
    const tabs = [saved(1), saved(2), saved(3)];
    handle = twoTabs({ refusedUrls: [placeholderOf(tabs[1])] });

    const ids = await openGroupCopy(
      tabs,
      work,
      { windowId: 1, index: 1 },
      GO_TO
    );

    expect(ids[1]).toBeUndefined();
    const groupId = (await chrome.tabs.get(ids[0] as number)).groupId;
    expect(await strip(1)).toEqual([
      '11*',
      `${ids[0]}g${groupId}`,
      `${ids[2]}g${groupId}`,
      '12',
    ]);
  });

  test("a slot inside the pinned run (a folded window's index 0) lands below it, in order", async () => {
    handle = setupChromeFake({
      windows: [
        {
          id: 1,
          tabs: [
            { id: 11, pinned: true },
            { id: 12, active: true },
          ],
        },
      ],
      tabGroupsApiAbsent: true,
    });

    const ids = await openGroupCopy(
      [saved(1), saved(2)],
      work,
      { windowId: 1, index: 0 },
      GO_TO
    );

    expect(await strip(1)).toEqual(['11P', `${ids[0]}`, `${ids[1]}`, '12*']);
  });

  test('into a window closed meanwhile: opens nothing and never throws', async () => {
    handle = setupChromeFake({
      windows: [
        { id: 1, tabs: [{ id: 11, active: true }] },
        { id: 2, tabs: [{ id: 21, active: true }] },
      ],
    });
    handle.browser.closeWindow(2);
    const before = await tabsNow();

    const ids = await openGroupCopy(
      [saved(1), saved(2)],
      work,
      { windowId: 2, index: 0 },
      GO_TO
    );

    expect(ids).toEqual([undefined, undefined]);
    expect(await tabsNow()).toBe(before);
  });
});

// KAN-942. A saved pair at a slot: two tabs side by side, then one split, nothing focused.
describe('openPairCopy', () => {
  const live = (more: Parameters<typeof setupChromeFake>[0] = {}) =>
    setupChromeFake({
      splitView: true,
      windows: [{ id: 1, tabs: [{ id: 11, active: true }, { id: 12 }] }],
      ...more,
    });
  const split = async () =>
    (await chrome.tabs.query({ windowId: 1 }))
      .sort((a, b) => a.index - b.index)
      .map((t) => t.splitViewId ?? -1)
      .map((id) => id !== -1);
  const a = saved(1, { splitId: 'sp' });
  const b = saved(2, { splitId: 'sp' });
  const slot = { windowId: 1, index: 1, pinned: false };

  test('both tabs side by side at the slot, then one split, the front tab kept', async () => {
    handle = live();
    const [first, second] = await openPairCopy(a, b, slot);
    expect(await strip(1)).toEqual([
      '11*',
      String(first),
      String(second),
      '12',
    ]);
    expect(await split()).toEqual([false, true, true, false]);
  });

  test('both halves open their real pages', async () => {
    handle = live();
    const [first, second] = await openPairCopy(a, b, slot);
    expect((await chrome.tabs.get(first ?? -1)).url).toBe(a.url);
    expect((await chrome.tabs.get(second ?? -1)).url).toBe(b.url);
  });

  test('the second opens beside where the first really landed', async () => {
    handle = live();
    const [first, second] = await openPairCopy(a, b, { ...slot, index: 99 });
    expect(await strip(1)).toEqual([
      '11*',
      '12',
      String(first),
      String(second),
    ]);
  });

  test('both take the slot’s pin', async () => {
    handle = live({
      windows: [
        { id: 1, tabs: [{ id: 11, pinned: true, active: true }, { id: 12 }] },
      ],
    });
    const [first, second] = await openPairCopy(a, b, { ...slot, pinned: true });
    expect(await strip(1)).toEqual(['11P*', `${first}P`, `${second}P`, '12']);
    expect(await split()).toEqual([false, true, true, false]);
  });

  test('both take the slot’s group', async () => {
    handle = live({
      windows: [
        {
          id: 1,
          tabs: [
            { id: 11, active: true },
            { id: 12, groupId: 7 },
            { id: 13, groupId: 7 },
          ],
        },
      ],
      tabGroups: [{ id: 7, windowId: 1 }],
    });
    const [first, second] = await openPairCopy(a, b, {
      ...slot,
      index: 2,
      groupId: 7,
    });
    expect(await strip(1)).toEqual([
      '11*',
      '12g7',
      `${first}g7`,
      `${second}g7`,
      '13g7',
    ]);
  });

  test('with no createSplit: two tabs, side by side, no split', async () => {
    handle = live({ splitView: false });
    const ids = await openPairCopy(a, b, slot);
    expect(ids.every((id) => id !== undefined)).toBe(true);
    expect(await tabsNow()).toBe(4);
  });

  test('a refused split leaves two tabs, and never throws', async () => {
    handle = live();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    Reflect.set(chrome.tabs, 'createSplit', () =>
      Promise.reject(new Error('refused'))
    );
    const ids = await openPairCopy(a, b, slot);
    expect(ids.every((id) => id !== undefined)).toBe(true);
    expect(await tabsNow()).toBe(4);
  });

  test('a refused half asks no split', async () => {
    handle = live();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const createSplit = vi.fn(() => Promise.resolve(1));
    Reflect.set(chrome.tabs, 'createSplit', createSplit);
    const ids = await openPairCopy(a, b, { ...slot, windowId: 999 });
    expect(ids).toEqual([undefined, undefined]);
    expect(createSplit).not.toHaveBeenCalled();
  });
});

// KAN-942. A group's pair opens as a split, its halves at their real pages.
describe('openGroupCopy with a pair inside', () => {
  const work = { groupId: 'g1', title: 'Work', color: 'blue' };
  const live = (splitView = true) =>
    setupChromeFake({
      splitView,
      tabGroups: [],
      windows: [{ id: 1, tabs: [{ id: 11, active: true }] }],
    });
  const tabs = [
    saved(1, { chromeGroupId: 'g1' }),
    saved(2, { chromeGroupId: 'g1', splitId: 'sp' }),
    saved(3, { chromeGroupId: 'g1', splitId: 'sp' }),
    saved(4, { chromeGroupId: 'g1' }),
  ];
  const slot = { windowId: 1, index: 1 };

  test('both halves open real pages, a plain tab stays a placeholder', async () => {
    handle = live();
    const ids = await openGroupCopy(tabs, work, slot, GO_TO);
    const urls = await Promise.all(
      ids.map(async (id) => (await chrome.tabs.get(id ?? -1)).url)
    );
    expect(urls).toEqual([
      tabs[0].url,
      tabs[1].url,
      tabs[2].url,
      placeholderOf(tabs[3]),
    ]);
  });

  test('the pair ends up split, inside the group', async () => {
    handle = live();
    const ids = await openGroupCopy(tabs, work, slot, GO_TO);
    const [second, third] = await Promise.all(
      [ids[1], ids[2]].map((id) => chrome.tabs.get(id ?? -1))
    );
    expect(second.splitViewId).toBeGreaterThan(0);
    expect(second.splitViewId).toBe(third.splitViewId);
    expect(second.groupId).toBe(third.groupId);
    expect(second.groupId).not.toBe(-1);
  });

  test('before Chrome 155 a pair is plain tabs in the group, a placeholder as ever', async () => {
    handle = live(false);
    const ids = await openGroupCopy(tabs, work, slot, GO_TO);
    expect((await chrome.tabs.get(ids[2] ?? -1)).url).toBe(
      placeholderOf(tabs[2])
    );
  });
});
