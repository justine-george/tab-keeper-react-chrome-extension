import { afterEach, describe, expect, test, vi } from 'vitest';

import type { tabData } from '../../../redux/slices/tabContainerDataStateSlice';
import { generatePlaceholderURL } from '../../../utils/functions/local';
import {
  openGroupCopy,
  openTabCopy,
} from '../../../utils/functions/openCopies';
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
