import { describe, expect, test } from 'vitest';

import {
  OPEN_NOW_NEW_WINDOW,
  carriedIntoOpenNow,
} from '../../components/home/opennow/carriedIntoOpenNow';
import { liveItem, savedItem } from '../../redux/carriedItem';
import type { windowGroupData } from '../../redux/slices/tabContainerDataStateSlice';
import { carriedRowId } from '../../utils/functions/carriedView';
import { groupItemIdOf } from '../../utils/functions/tabGroups';
import { buildSession } from '../fixtures/sessionFixture';

// KAN-815. A saved tab or group carried over Currently open, as Open now's
// lists adopt it: a phantom in a trailing "New window" block.

const savedWindow = (more: Partial<windowGroupData> = {}): windowGroupData => ({
  windowId: 'w1',
  windowHeight: 700,
  windowWidth: 900,
  windowOffsetTop: 0,
  windowOffsetLeft: 0,
  tabCount: 3,
  title: '',
  tabs: [
    {
      tabId: 't1',
      favicon: '',
      title: 'One',
      url: 'https://one.example/',
      pinned: true,
    },
    {
      tabId: 'ga',
      favicon: '',
      title: 'A',
      url: 'https://a.example/',
      chromeGroupId: 'g1',
    },
    {
      tabId: 'gb',
      favicon: '',
      title: 'B',
      url: 'https://b.example/',
      chromeGroupId: 'g1',
    },
  ],
  chromeTabGroups: [{ groupId: 'g1', title: 'Work', color: 'blue' }],
  ...more,
});
const sessions = (window = savedWindow()) => [
  buildSession({ tabGroupId: 'S1', windows: [window] }),
];
const TAB = savedItem({
  kind: 'tab',
  tabGroupId: 'S1',
  windowId: 'w1',
  tabId: 't1',
});
const GROUP = savedItem({
  kind: 'group',
  tabGroupId: 'S1',
  windowId: 'w1',
  groupId: 'g1',
});

describe('carriedIntoOpenNow', () => {
  test('a tab: its phantom alone in the trailing block, loose, with its saved pin', () => {
    const into = carriedIntoOpenNow(sessions(), TAB, true);
    expect(into).toEqual({
      kind: 'tab',
      rowId: into?.rowId,
      window: {
        windowId: OPEN_NOW_NEW_WINDOW,
        tabs: [{ tabId: into?.rowId, pinned: false }],
        chromeTabGroups: [],
      },
      incognito: false,
      pinned: true,
    });
  });

  // Both panes draw a phantom while the carry is on, and a row's id is how
  // the engine, and every test, finds it.
  test("its phantom ids are never the saved pane's phantom ids", () => {
    expect(carriedIntoOpenNow(sessions(), TAB, true)?.rowId).not.toBe(
      carriedRowId(TAB)
    );
    expect(carriedIntoOpenNow(sessions(), GROUP, true)?.rowId).not.toBe(
      carriedRowId(GROUP)
    );
  });

  test('a group: its tabs under phantom ids, in a phantom group of its look', () => {
    const into = carriedIntoOpenNow(sessions(), GROUP, true);
    expect(into?.kind).toBe('group');
    expect(into?.rowId).toBe(
      groupItemIdOf(into?.window.chromeTabGroups?.[0]?.groupId ?? '')
    );
    expect(into?.pinned).toBe(false);
    const window = into?.window;
    expect(window?.windowId).toBe(OPEN_NOW_NEW_WINDOW);
    expect(window?.tabs).toHaveLength(2);
    const groupId = window?.chromeTabGroups?.[0]?.groupId;
    expect(window?.chromeTabGroups).toEqual([
      { groupId, title: 'Work', color: 'blue' },
    ]);
    expect(window?.tabs.every((t) => t.chromeGroupId === groupId)).toBe(true);
    // Never the live or saved ids: the engine keys rows by id.
    expect(window?.tabs.map((t) => t.tabId)).not.toContain('ga');
    expect(groupId).not.toBe('g1');
  });

  test("the saved window's kind", () => {
    expect(
      carriedIntoOpenNow(sessions(savedWindow({ incognito: true })), TAB, true)
        ?.incognito
    ).toBe(true);
  });

  test('null for nothing carried, a live item, a window, an item gone, or a group without the grant', () => {
    expect(carriedIntoOpenNow(sessions(), null, true)).toBeNull();
    expect(
      carriedIntoOpenNow(
        sessions(),
        liveItem({
          pick: { kind: 'tab', windowId: 'w1', tabId: 't1' },
          window: savedWindow(),
          chromeWindowId: 1,
        }),
        true
      )
    ).toBeNull();
    expect(
      carriedIntoOpenNow(
        sessions(),
        savedItem({ kind: 'window', tabGroupId: 'S1', windowId: 'w1' }),
        true
      )
    ).toBeNull();
    expect(
      carriedIntoOpenNow(
        sessions(),
        savedItem({
          kind: 'tab',
          tabGroupId: 'S1',
          windowId: 'w1',
          tabId: 'gone',
        }),
        true
      )
    ).toBeNull();
    expect(carriedIntoOpenNow([], TAB, true)).toBeNull();
    expect(carriedIntoOpenNow(sessions(), GROUP, false)).toBeNull();
  });

  test('a tab still opens without the grant', () => {
    expect(carriedIntoOpenNow(sessions(), TAB, false)?.kind).toBe('tab');
  });
});
