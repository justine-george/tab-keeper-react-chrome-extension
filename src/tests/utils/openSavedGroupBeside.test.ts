import { afterEach, describe, expect, test } from 'vitest';

import { openGroupBesideActive } from '../../utils/functions/openSavedGroup';
import type { tabData } from '../../redux/slices/tabContainerDataStateSlice';
import { setupChromeFake } from '../setup/chrome.fake';
import type { ChromeFakeHandle } from '../setup/chrome.fake';

// KAN-910. A saved group's Open beside the active tab, leaving out pages the window has.

let handle: ChromeFakeHandle | undefined;
afterEach(() => {
  handle?.restore();
  handle = undefined;
});

const GROUP = { groupId: 'grp', title: 'Research', color: 'blue' };
const addr = (name: string) => `https://${name}.test/`;
const saved = (name: string): tabData => ({
  tabId: `s-${name}`,
  favicon: '',
  title: name,
  url: addr(name),
  chromeGroupId: 'grp',
});

// Window 1: here (active, id 10), a (id 11), b (id 12).
const setup = () => {
  handle = setupChromeFake({
    windows: [
      {
        id: 1,
        focused: true,
        tabs: [
          { id: 10, url: addr('here'), active: true },
          { id: 11, url: addr('a') },
          { id: 12, url: addr('b') },
        ],
      },
    ],
    tabGroups: [],
  });
  return handle;
};

const strip = async () =>
  (await chrome.tabs.query({ windowId: 1 }))
    .sort((a, b) => a.index - b.index)
    .map(
      (t) =>
        `${t.url?.replace(/^https:\/\/|\.test\/$/g, '')}${t.active ? '*' : ''}`
    );

describe('openGroupBesideActive', () => {
  test('off: opens every tab beside the active one, grouped, last one current (today)', async () => {
    const h = setup();
    await openGroupBesideActive(
      [saved('a'), saved('c'), saved('d')],
      GROUP,
      true,
      false
    );
    const queries = h.tabsQueryCalls.length;
    expect(await strip()).toEqual(['here', 'a', 'c', 'd*', 'a', 'b']);
    expect(h.groupedTabs).toHaveLength(1);
    expect(h.groupedTabs[0]?.tabIds).toHaveLength(3);
    expect(queries).toBe(1);
  });

  test('on: opens only the new pages, grouped, the last new one current', async () => {
    const h = setup();
    await openGroupBesideActive(
      [saved('a'), saved('c'), saved('d')],
      GROUP,
      true,
      true
    );
    const queries = h.tabsQueryCalls.length;
    expect(await strip()).toEqual(['here', 'c', 'd*', 'a', 'b']);
    expect(h.groupedTabs[0]?.tabIds).toHaveLength(2);
    expect(queries).toBe(2);
  });

  test('on, all open: creates nothing, the open copy of the group last tab becomes current', async () => {
    const h = setup();
    await openGroupBesideActive([saved('b'), saved('a')], GROUP, true, true);
    expect(h.createdTabs).toEqual([]);
    expect(h.groupedTabs).toEqual([]);
    expect(await strip()).toEqual(['here', 'a*', 'b']);
  });

  test('background copy ignores the setting', async () => {
    const h = setup();
    await openGroupBesideActive([saved('a'), saved('c')], GROUP, false, false);
    const queries = h.tabsQueryCalls.length;
    expect(await strip()).toEqual(['here*', 'a', 'c', 'a', 'b']);
    expect(queries).toBe(1);
  });
});
