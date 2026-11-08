import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { offersLiveNewWindow } from '../../components/home/opennow/liveNewWindow';
import { toOpenWindows } from '../../utils/functions/openNow';
import { groupItemIdOf } from '../../utils/functions/tabGroups';
import { setupChromeFake } from '../setup/chrome.fake';
import type { ChromeFakeHandle } from '../setup/chrome.fake';

// KAN-949, spec Goals 9 and 10a: a live drag is offered a new window only when the row has company in its window,
// and never for the group holding this Tab Keeper page.

type Seed = {
  id: number;
  groupId?: number;
  pinned?: boolean;
  split?: number;
  url?: string;
};

// Only for chrome.runtime.getURL, which names a Tab Keeper page.
let handle: ChromeFakeHandle | undefined;
beforeEach(() => {
  handle = setupChromeFake();
});
afterEach(() => {
  handle?.restore();
});

const TAB_KEEPER_PAGE = 'chrome-extension://faketestid/index.html';

const windowsOf = (...windows: Seed[][]) =>
  toOpenWindows(
    windows.map(
      (tabs, w) =>
        ({
          id: w + 1,
          focused: false,
          type: 'normal',
          state: 'normal',
          incognito: false,
          tabs: tabs.map((tab, index) => ({
            id: tab.id,
            windowId: w + 1,
            index,
            url: tab.url ?? `https://site${tab.id}.example/`,
            title: `T${tab.id}`,
            active: index === 0,
            pinned: tab.pinned ?? false,
            groupId: tab.groupId ?? -1,
            splitViewId: tab.split ?? -1,
          })),
        }) as unknown as chrome.windows.Window
    ),
    [5, 6].map(
      (id) =>
        ({
          id,
          title: `G${id}`,
          color: 'blue',
          collapsed: false,
          windowId: 1,
        }) as chrome.tabGroups.TabGroup
    ),
    null
  );

describe('offersLiveNewWindow', () => {
  test('a tab beside others: true', () => {
    expect(
      offersLiveNewWindow('11', windowsOf([{ id: 11 }, { id: 12 }]), null)
    ).toBe(true);
  });

  test("a window's only tab: false", () => {
    expect(
      offersLiveNewWindow('21', windowsOf([{ id: 11 }], [{ id: 21 }]), null)
    ).toBe(false);
  });

  test('a tab whose only company is a hidden Tab Keeper page: false', () => {
    expect(
      offersLiveNewWindow(
        '11',
        windowsOf([{ id: 11 }, { id: 12, url: TAB_KEEPER_PAGE }]),
        null
      )
    ).toBe(false);
  });

  test('a pair alone in its window: false', () => {
    expect(
      offersLiveNewWindow(
        '11',
        windowsOf([
          { id: 11, split: 9 },
          { id: 12, split: 9 },
        ]),
        null
      )
    ).toBe(false);
  });

  test('a pair beside a tab: true', () => {
    expect(
      offersLiveNewWindow(
        '11',
        windowsOf([{ id: 11, split: 9 }, { id: 12, split: 9 }, { id: 13 }]),
        null
      )
    ).toBe(true);
  });

  test('a tab inside a group with others: true', () => {
    expect(
      offersLiveNewWindow(
        '12',
        windowsOf([
          { id: 12, groupId: 5 },
          { id: 13, groupId: 5 },
        ]),
        null
      )
    ).toBe(true);
  });

  test('a group with a loose tab beside it: true', () => {
    expect(
      offersLiveNewWindow(
        groupItemIdOf('5'),
        windowsOf([{ id: 11 }, { id: 12, groupId: 5 }]),
        null
      )
    ).toBe(true);
  });

  test("a window's only group: false", () => {
    expect(
      offersLiveNewWindow(
        groupItemIdOf('5'),
        windowsOf([
          { id: 12, groupId: 5 },
          { id: 13, groupId: 5 },
        ]),
        null
      )
    ).toBe(false);
  });

  test('a group beside another group: true', () => {
    expect(
      offersLiveNewWindow(
        groupItemIdOf('5'),
        windowsOf([
          { id: 12, groupId: 5 },
          { id: 13, groupId: 6 },
        ]),
        null
      )
    ).toBe(true);
  });

  test('the group holding this page: false', () => {
    expect(
      offersLiveNewWindow(
        groupItemIdOf('5'),
        windowsOf([{ id: 11 }, { id: 12, groupId: 5 }]),
        5
      )
    ).toBe(false);
  });

  test('a pinned tab beside others: true', () => {
    expect(
      offersLiveNewWindow(
        '11',
        windowsOf([{ id: 11, pinned: true }, { id: 12 }]),
        null
      )
    ).toBe(true);
  });

  test('an unknown row id: false', () => {
    const windows = windowsOf([{ id: 11 }, { id: 12 }]);
    expect(offersLiveNewWindow('99', windows, null)).toBe(false);
    expect(offersLiveNewWindow(groupItemIdOf('5'), windows, null)).toBe(false);
    expect(offersLiveNewWindow('', windows, null)).toBe(false);
  });
});
