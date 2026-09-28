import { describe, expect, test } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { Provider } from 'react-redux';
import type { ReactNode } from 'react';

import { makeTestStore } from '../setup/makeStore';
import { useTabDrop } from '../../components/home/rightpane/useTabDrop';
import { useGroupDrop } from '../../components/home/rightpane/useGroupDrop';
import { groupDrop, tabDrop } from '../../redux/dropSpecs';
import { saveToTabContainerInternal } from '../../redux/slices/tabContainerDataStateSlice';
import { groupItemIdOf } from '../../utils/functions/tabGroups';

// KAN-280 Part E. The saved hooks were split into the drop GEOMETRY, which a
// live Chrome list can share, and what a saved drop MEANS. The meaning must not
// move: a cross-window release still dispatches exactly the reducer action the
// drop specs build from the same five facts. The expected action comes from
// tabDrop / groupDrop themselves, so the test pins the hook's inputs to them,
// not a copy of their output.

const tab = (id: string, g?: string) => ({
  tabId: id,
  favicon: '',
  title: `Tab ${id}`,
  url: `https://${id}.test`,
  ...(g ? { chromeGroupId: g } : {}),
});

const win = (
  windowId: string,
  tabs: ReturnType<typeof tab>[],
  chromeTabGroups: { groupId: string; title: string; color: string }[]
) => ({
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

// wA: a0 a1 [ga: a2 a3]. wB: [gb: b0 b1] b2.
const WINDOWS = [
  win(
    'wA',
    [tab('a0'), tab('a1'), tab('a2', 'ga'), tab('a3', 'ga')],
    [{ groupId: 'ga', title: 'GA', color: 'blue' }]
  ),
  win(
    'wB',
    [tab('b0', 'gb'), tab('b1', 'gb'), tab('b2')],
    [{ groupId: 'gb', title: 'GB', color: 'red' }]
  ),
];

function setup() {
  const { store, actions } = makeTestStore();
  store.dispatch(
    saveToTabContainerInternal({
      tabGroupId: 'tg',
      title: 'Session',
      createdTime: '2026-09-28 09:00:00',
      windowCount: 2,
      tabCount: 7,
      isAutoSave: false,
      isSelected: true,
      windows: WINDOWS,
    })
  );
  const wrapper = ({ children }: { children: ReactNode }) => (
    <Provider store={store}>{children}</Provider>
  );
  const paneWindows = { tabGroupId: 'tg', windows: WINDOWS };
  return { store, actions, wrapper, paneWindows };
}

describe('a saved drop dispatches the same action after the geometry split', () => {
  test('a tab dropped into a group in another window', () => {
    const { actions, wrapper, paneWindows } = setup();
    const { result } = renderHook(() => useTabDrop(paneWindows, true), {
      wrapper,
    });
    const expected = tabDrop({
      tabGroupId: 'tg',
      tabId: 'a1',
      fromWindowId: 'wA',
      toWindowId: 'wB',
      toIndex: 1,
      toChromeGroupId: 'gb',
    }).move(1);
    actions.length = 0;

    act(() => result.current.onMove('a1', 1, 'gb', 'wB'));

    expect(expected.type).toBe(
      'tabContainerDataState/moveTabAcrossWindowsInternal'
    );
    expect(actions.filter((a) => a.type === expected.type)).toEqual([expected]);
  });

  test('a tab released over no window dispatches no move', () => {
    const { actions, wrapper, paneWindows } = setup();
    const { result } = renderHook(() => useTabDrop(paneWindows, true), {
      wrapper,
    });
    actions.length = 0;

    act(() => result.current.onMove('a1', 1, undefined, undefined));

    expect(actions).toEqual([]);
  });

  test('a whole group dropped into another window', () => {
    const { actions, wrapper, paneWindows } = setup();
    const { result } = renderHook(() => useGroupDrop(paneWindows, true), {
      wrapper,
    });
    const expected = groupDrop({
      tabGroupId: 'tg',
      groupId: 'ga',
      fromWindowId: 'wA',
      toWindowId: 'wB',
      toIndex: 2,
    }).move(2);
    actions.length = 0;

    act(() => result.current.onMove(groupItemIdOf('ga'), 2, undefined, 'wB'));

    expect(expected.type).toBe(
      'tabContainerDataState/moveChromeGroupAcrossWindowsInternal'
    );
    expect(actions.filter((a) => a.type === expected.type)).toEqual([expected]);
  });
});
