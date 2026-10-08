import { afterEach, describe, expect, test } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { Provider } from 'react-redux';
import type { ReactNode } from 'react';

import { makeTestStore } from '../setup/makeStore';
import { useTabDrop } from '../../components/home/rightpane/useTabDrop';
import { useGroupDrop } from '../../components/home/rightpane/useGroupDrop';
import { toggleWindowCollapse } from '../../redux/slices/globalStateSlice';
import {
  foldBackSpringOpened,
  springOpenWindow,
} from '../../redux/springOpenWindows';
import { endCarry, startCarry } from '../../redux/carry';
import { carriedRowId } from '../../utils/functions/carriedView';
import {
  saveToTabContainerInternal,
  type chromeTabGroupData,
  type tabData,
  type windowGroupData,
} from '../../redux/slices/tabContainerDataStateSlice';
import { groupItemIdOf } from '../../utils/functions/tabGroups';

// KAN-458 edge ruling (22:05). A collapsed window shows no rows, so a drop there keeps the pin, at the start of its own run.
const tab = (tabId: string, extra: Partial<tabData> = {}): tabData => ({
  tabId,
  favicon: '',
  title: tabId,
  url: `https://${tabId}.test`,
  ...extra,
});
const win = (
  windowId: string,
  tabs: tabData[],
  chromeTabGroups: chromeTabGroupData[] = []
): windowGroupData => ({
  windowId,
  windowHeight: 1080,
  windowWidth: 1920,
  windowOffsetTop: 0,
  windowOffsetLeft: 0,
  tabCount: tabs.length,
  title: windowId,
  tabs,
  chromeTabGroups,
});

// wA: pA (pinned), a1, [ga: a2 a3]. wB: pB (pinned), b1, b2.
const WINDOWS = [
  win(
    'wA',
    [
      tab('pA', { pinned: true }),
      tab('a1'),
      tab('a2', { chromeGroupId: 'ga' }),
      tab('a3', { chromeGroupId: 'ga' }),
    ],
    [{ groupId: 'ga', title: 'GA', color: 'blue' }]
  ),
  win('wB', [tab('pB', { pinned: true }), tab('b1'), tab('b2')]),
];

function setup(collapseWB: boolean) {
  const { store } = makeTestStore();
  store.dispatch(
    saveToTabContainerInternal({
      tabGroupId: 'tg',
      title: 'Session',
      createdTime: '2026-10-07 09:00:00',
      windowCount: 2,
      tabCount: 7,
      isAutoSave: false,
      isSelected: true,
      windows: WINDOWS,
    })
  );
  if (collapseWB) {
    store.dispatch(toggleWindowCollapse({ tabGroupId: 'tg', windowId: 'wB' }));
  }
  const wrapper = ({ children }: { children: ReactNode }) => (
    <Provider store={store}>{children}</Provider>
  );
  const wB = () =>
    store
      .getState()
      .tabContainerDataState.tabGroups[0].windows.find(
        (w) => w.windowId === 'wB'
      )
      ?.tabs.map((t) => [t.tabId, t.pinned === true]);
  const groupOf = (windowId: string, tabId: string) =>
    store
      .getState()
      .tabContainerDataState.tabGroups[0].windows.find(
        (w) => w.windowId === windowId
      )
      ?.tabs.find((t) => t.tabId === tabId)?.chromeGroupId;
  return {
    store,
    wrapper,
    wB,
    groupOf,
    paneWindows: { tabGroupId: 'tg', windows: WINDOWS },
  };
}

afterEach(() => {
  act(() => foldBackSpringOpened());
  endCarry('cancelled');
});

describe('a drop on a collapsed window keeps the pin (KAN-458)', () => {
  // The engine offers a collapsed window one slot, index 0.
  test('a pinned tab lands first, still pinned', () => {
    const { wrapper, wB, paneWindows } = setup(true);
    const { result } = renderHook(() => useTabDrop(paneWindows, true), {
      wrapper,
    });
    act(() => result.current.onMove('pA', 0, undefined, 'wB'));
    expect(wB()).toEqual([
      ['pA', true],
      ['pB', true],
      ['b1', false],
      ['b2', false],
    ]);
  });

  test('an unpinned tab lands right after the pinned run, still unpinned', () => {
    const { wrapper, wB, paneWindows } = setup(true);
    const { result } = renderHook(() => useTabDrop(paneWindows, true), {
      wrapper,
    });
    act(() => result.current.onMove('a1', 0, undefined, 'wB'));
    expect(wB()).toEqual([
      ['pB', true],
      ['a1', false],
      ['b1', false],
      ['b2', false],
    ]);
  });

  test('a grouped tab leaves its band: a collapsed window draws none to join', () => {
    const { wrapper, wB, groupOf, paneWindows } = setup(true);
    const { result } = renderHook(() => useTabDrop(paneWindows, true), {
      wrapper,
    });
    act(() => result.current.onMove('a2', 0, 'ga', 'wB'));
    expect(wB()).toEqual([
      ['pB', true],
      ['a2', false],
      ['b1', false],
      ['b2', false],
    ]);
    expect(groupOf('wB', 'a2')).toBeUndefined();
  });

  test('CONTROL: the same drop on the open window pins it, where it was dropped', () => {
    const { wrapper, wB, paneWindows } = setup(false);
    const { result } = renderHook(() => useTabDrop(paneWindows, true), {
      wrapper,
    });
    act(() => result.current.onMove('a1', 0, undefined, 'wB'));
    expect(wB()).toEqual([
      ['a1', true],
      ['pB', true],
      ['b1', false],
      ['b2', false],
    ]);
  });

  // R1. Collapsed means drawn with no rows: a window the drag opened draws its rows.
  test('a stored-collapsed window this drag opened is positional, as an open one', () => {
    const { wrapper, wB, paneWindows } = setup(true);
    const { result } = renderHook(() => useTabDrop(paneWindows, true), {
      wrapper,
    });
    act(() => springOpenWindow('wB'));
    act(() => result.current.onMove('a1', 0, undefined, 'wB'));
    expect(wB()).toEqual([
      ['a1', true],
      ['pB', true],
      ['b1', false],
      ['b2', false],
    ]);
  });

  // A carried tab keeps its id until it lands, so it can share one with a tab of the target.
  test('a carried tab sharing an id with a pinned tab there lands after the pinned run', () => {
    const { store, wrapper, wB } = setup(true);
    store.dispatch(
      saveToTabContainerInternal({
        tabGroupId: 'src',
        title: 'Source',
        createdTime: '2026-10-07 08:00:00',
        windowCount: 1,
        tabCount: 1,
        isAutoSave: false,
        isSelected: false,
        windows: [win('ws', [tab('pB'), tab('s2')])],
      })
    );
    const carried = {
      kind: 'tab' as const,
      tabGroupId: 'src',
      windowId: 'ws',
      tabId: 'pB',
    };
    // The phantom row the pane draws for the carried tab, in wA.
    const phantom = carriedRowId(carried);
    const paneWindows = {
      tabGroupId: 'tg',
      windows: [
        { ...WINDOWS[0], tabs: [...WINDOWS[0].tabs, tab(phantom)] },
        WINDOWS[1],
      ],
    };
    const { result } = renderHook(() => useTabDrop(paneWindows, true), {
      wrapper,
    });
    act(() =>
      startCarry(carried, { kind: 'tab', title: 'pB', faviconUrl: '' }, 0, 0)
    );
    act(() => result.current.onMove(phantom, 0, undefined, 'wB'));
    const landed = wB();
    expect(landed?.map(([, pinned]) => pinned)).toEqual([
      true,
      false,
      false,
      false,
    ]);
    expect(landed?.[0][0]).toBe('pB');
    // PREMISE: the carried tab landed, re-minted.
    expect(landed?.[1][0]).not.toBe('b1');
  });

  test('a group lands right after the pinned run, not refused', () => {
    const { wrapper, wB, paneWindows } = setup(true);
    const { result } = renderHook(() => useGroupDrop(paneWindows, true), {
      wrapper,
    });
    act(() => result.current.onMove(groupItemIdOf('ga'), 0, undefined, 'wB'));
    expect(wB()?.map(([id]) => id)).toEqual(['pB', 'a2', 'a3', 'b1', 'b2']);
  });
});
