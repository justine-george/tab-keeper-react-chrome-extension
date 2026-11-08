import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import {
  newWindowMoveFor,
  offersLiveNewWindow,
} from '../../components/home/opennow/liveNewWindow';
import { liveStepOf } from '../../utils/functions/openNowMoves';
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
      offersLiveNewWindow('11', windowsOf([{ id: 11 }, { id: 12 }]), undefined)
    ).toBe(true);
  });

  test("a window's only tab: false", () => {
    expect(
      offersLiveNewWindow(
        '21',
        windowsOf([{ id: 11 }], [{ id: 21 }]),
        undefined
      )
    ).toBe(false);
  });

  test('a tab whose only company is a hidden Tab Keeper page: false', () => {
    expect(
      offersLiveNewWindow(
        '11',
        windowsOf([{ id: 11 }, { id: 12, url: TAB_KEEPER_PAGE }]),
        undefined
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
        undefined
      )
    ).toBe(false);
  });

  test('a pair beside a tab: true', () => {
    expect(
      offersLiveNewWindow(
        '11',
        windowsOf([{ id: 11, split: 9 }, { id: 12, split: 9 }, { id: 13 }]),
        undefined
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
        undefined
      )
    ).toBe(true);
  });

  test('a group with a loose tab beside it: true', () => {
    expect(
      offersLiveNewWindow(
        groupItemIdOf('5'),
        windowsOf([{ id: 11 }, { id: 12, groupId: 5 }]),
        undefined
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
        undefined
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
        undefined
      )
    ).toBe(true);
  });

  test('the group holding this page: false', () => {
    expect(
      offersLiveNewWindow(
        groupItemIdOf('5'),
        windowsOf([{ id: 11 }, { id: 12, groupId: 5 }]),
        '5'
      )
    ).toBe(false);
  });

  test('a pinned tab beside others: true', () => {
    expect(
      offersLiveNewWindow(
        '11',
        windowsOf([{ id: 11, pinned: true }, { id: 12 }]),
        undefined
      )
    ).toBe(true);
  });

  test('an unknown row id: false', () => {
    const windows = windowsOf([{ id: 11 }, { id: 12 }]);
    expect(offersLiveNewWindow('99', windows, undefined)).toBe(false);
    expect(offersLiveNewWindow(groupItemIdOf('5'), windows, undefined)).toBe(
      false
    );
    expect(offersLiveNewWindow('', windows, undefined)).toBe(false);
  });
});

describe('newWindowMoveFor', () => {
  // The fake's windows as Open now reads them.
  const snapshot = async () =>
    toOpenWindows(
      await chrome.windows.getAll({ populate: true, windowTypes: ['normal'] }),
      await chrome.tabGroups.query({}),
      null
    );

  const seeded = () => {
    handle?.restore();
    handle = setupChromeFake({
      splitView: true,
      windows: [
        {
          id: 1,
          tabs: [
            { id: 11, active: true },
            { id: 12, splitViewId: 9 },
            { id: 13, splitViewId: 9 },
            { id: 14, groupId: 5 },
            { id: 15, groupId: 5, url: TAB_KEEPER_PAGE },
            { id: 16, groupId: 5 },
          ],
        },
      ],
      tabGroups: [
        { id: 5, windowId: 1, title: 'Work', color: 'red', collapsed: true },
      ],
    });
  };

  test('a tab: itself', async () => {
    seeded();
    expect(await newWindowMoveFor('11', await snapshot())).toEqual({
      kind: 'tab',
      tabId: 11,
    });
  });

  test('a pair, named by its head: both halves in strip order', async () => {
    seeded();
    expect(await newWindowMoveFor('12', await snapshot())).toEqual({
      kind: 'pair',
      pair: { first: 12, second: 13 },
    });
  });

  test("a group: every tab Chrome has in it, its hidden Tab Keeper page too, with the list's look", async () => {
    seeded();
    expect(
      await newWindowMoveFor(groupItemIdOf('5'), await snapshot())
    ).toEqual({
      kind: 'group',
      tabIds: [14, 15, 16],
      look: { title: 'Work', color: 'red', collapsed: true },
    });
  });

  test('a row the snapshot does not hold: null', async () => {
    seeded();
    const windows = await snapshot();
    expect(await newWindowMoveFor('99', windows)).toBeNull();
    expect(await newWindowMoveFor(groupItemIdOf('7'), windows)).toBeNull();
  });
});

describe('liveStepOf (KAN-950)', () => {
  const at = (windowId: number, index: number) => ({
    windowId,
    index,
    groupId: -1,
    group: null,
    pinned: false,
  });
  const moved = [{ tabId: 12, before: at(1, 1), after: at(9, 0) }];
  const look = { title: 'W', color: 'blue' as const, collapsed: false };

  test('a move that went through: a step of its own kind, with the window it made', () => {
    expect(
      liveStepOf(
        { kind: 'group', tabIds: [12], look },
        { windowId: 9, stubTabId: 30, moved, finished: true }
      )
    ).toEqual({
      kind: 'group',
      moved,
      madeWindow: { windowId: 9, stubTabId: 30 },
    });
  });

  test('a move stopped part way: a step of single tabs, each put back on its own', () => {
    expect(
      liveStepOf(
        { kind: 'group', tabIds: [12], look },
        { windowId: 9, stubTabId: null, moved, finished: false }
      )
    ).toEqual({
      kind: 'tab',
      moved,
      madeWindow: { windowId: 9, stubTabId: null },
    });
  });
});
