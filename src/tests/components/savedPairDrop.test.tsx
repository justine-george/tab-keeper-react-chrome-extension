import { afterEach, describe, expect, test } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { Provider } from 'react-redux';
import type { ReactNode } from 'react';

import { useGroupDrop } from '../../components/home/rightpane/useGroupDrop';
import { useTabDrop } from '../../components/home/rightpane/useTabDrop';
import {
  NEW_FIRST_WINDOW,
  NEW_LAST_WINDOW,
} from '../../components/home/rightpane/newWindowTarget';
import { savedItem } from '../../redux/carriedItem';
import { endCarry, startCarry } from '../../redux/carry';
import { toggleWindowCollapse } from '../../redux/slices/globalStateSlice';
import {
  saveToTabContainerInternal,
  type tabData,
  type windowGroupData,
} from '../../redux/slices/tabContainerDataStateSlice';
import { undo } from '../../redux/slices/undoRedoSlice';
import { carriedRowId } from '../../utils/functions/carriedView';
import { groupItemIdOf } from '../../utils/functions/tabGroups';
import { splitPairs } from '../../utils/functions/savedPairs';
import { makeTestStore } from '../setup/makeStore';

// KAN-942. The engine counts rows, a pair once; the reducers count tabs.

const tab = (tabId: string, extra: Partial<tabData> = {}): tabData => ({
  tabId,
  favicon: '',
  title: tabId,
  url: `https://${tabId}.test`,
  ...extra,
});
const half = (tabId: string, extra: Partial<tabData> = {}) =>
  tab(tabId, { splitId: 'split', ...extra });
const win = (windowId: string, tabs: tabData[]): windowGroupData => ({
  windowId,
  windowHeight: 1080,
  windowWidth: 1920,
  windowOffsetTop: 0,
  windowOffsetLeft: 0,
  tabCount: tabs.length,
  title: windowId,
  tabs,
  chromeTabGroups: [{ groupId: 'g', title: 'G', color: 'blue' }],
});

// `drawn`: what the pane hands the hooks, when a carry draws other than the store.
function setup(windows: windowGroupData[], drawn = windows) {
  const { store } = makeTestStore();
  store.dispatch(
    saveToTabContainerInternal({
      tabGroupId: 'tg',
      title: 'Session',
      createdTime: '2026-11-06 09:00:00',
      windowCount: windows.length,
      tabCount: windows.reduce((n, w) => n + w.tabs.length, 0),
      isAutoSave: false,
      isSelected: false,
      windows,
    })
  );
  const wrapper = ({ children }: { children: ReactNode }) => (
    <Provider store={store}>{children}</Provider>
  );
  const pane = { tabGroupId: 'tg', windows: drawn };
  return {
    store,
    tabs: renderHook(() => useTabDrop(pane, true), { wrapper }).result,
    groups: renderHook(() => useGroupDrop(pane, true), { wrapper }).result,
    order: (windowId: string) =>
      store
        .getState()
        .tabContainerDataState.tabGroups[0].windows.find(
          (w) => w.windowId === windowId
        )
        ?.tabs.map((t) => t.tabId),
  };
}

afterEach(() => {
  endCarry('cancelled');
});

const pairAtTop = () => win('w', [half('h1'), half('h2'), tab('b'), tab('c')]);

describe('useTabDrop reads rows (KAN-942)', () => {
  test('rowIds counts a pair once', () => {
    const { tabs } = setup([pairAtTop()]);
    expect(tabs.current.rowIds).toEqual(['h1', 'b', 'c']);
  });

  test('a plain tab dropped below a pair gets the tab index', () => {
    const { tabs, order } = setup([
      win('w', [tab('a'), half('h1'), half('h2'), tab('b'), tab('c')]),
    ]);
    // Rows with a lifted: pair, b, c. Row 2 is between b and c.
    act(() => tabs.current.onMove('a', 2, undefined, 'w'));
    expect(order('w')).toEqual(['h1', 'h2', 'b', 'a', 'c']);
  });

  test('a plain tab dropped into another window, below its pair', () => {
    const { tabs, order } = setup([
      win('w', [tab('a'), tab('z')]),
      win('v', [half('h1'), half('h2'), tab('b'), tab('c')]),
    ]);
    act(() => tabs.current.onMove('a', 2, undefined, 'v'));
    expect(order('v')).toEqual(['h1', 'h2', 'b', 'a', 'c']);
  });

  test('a pair row dropped in its window moves both, one undo step', () => {
    const { tabs, order, store } = setup([pairAtTop()]);
    act(() => tabs.current.onMove('h1', 1, undefined, 'w'));
    expect(order('w')).toEqual(['b', 'h1', 'h2', 'c']);
    act(() => {
      store.dispatch(undo());
    });
    expect(order('w')).toEqual(['h1', 'h2', 'b', 'c']);
  });

  test('a pair row dropped in another window moves both', () => {
    const { tabs, order } = setup([pairAtTop(), win('v', [tab('x')])]);
    act(() => tabs.current.onMove('h1', 1, undefined, 'v'));
    expect(order('v')).toEqual(['x', 'h1', 'h2']);
  });

  test('a pair on a New window target moves as a pair', () => {
    const { tabs, store } = setup([pairAtTop()]);
    act(() => tabs.current.onMove('h1', 0, undefined, NEW_FIRST_WINDOW));
    const [first] = store.getState().tabContainerDataState.tabGroups[0].windows;
    expect(first.tabs.map((t) => t.tabId)).toEqual(['h1', 'h2']);
    expect(splitPairs(first.tabs)).toEqual([[0, 1]]);
  });

  test('a folded window takes noRowsTabIndex as it is, unconverted', () => {
    const { tabs, order, store } = setup([
      win('w', [tab('a')]),
      win('v', [
        tab('p', { pinned: true }),
        half('q1', { pinned: true }),
        half('q2', { pinned: true }),
        tab('x'),
      ]),
    ]);
    act(() => {
      store.dispatch(toggleWindowCollapse({ tabGroupId: 'tg', windowId: 'v' }));
    });
    act(() => tabs.current.onMove('a', 0, undefined, 'v'));
    expect(order('v')).toEqual(['p', 'q1', 'q2', 'a', 'x']);
  });

  test('a carried tab landing below a pair gets the tab index', () => {
    const item = savedItem({
      kind: 'tab',
      tabGroupId: 'tg',
      windowId: 'v',
      tabId: 'a',
    });
    const phantom = carriedRowId(item);
    const { tabs, order } = setup(
      [pairAtTop(), win('v', [tab('a'), tab('z')])],
      [pairAtTop(), win('v', [tab('z')]), win(NEW_LAST_WINDOW, [tab(phantom)])]
    );
    startCarry(item, { kind: 'tab', title: 'a', faviconUrl: '' }, 0, 0);
    act(() => tabs.current.onMove(phantom, 2, undefined, 'w'));
    expect(order('w')).toEqual(['h1', 'h2', 'b', 'a', 'c']);
  });
});

describe('useGroupDrop reads rows (KAN-942)', () => {
  const grouped = () =>
    win('w', [
      half('h1'),
      half('h2'),
      tab('a'),
      tab('m', { chromeGroupId: 'g' }),
      tab('z'),
    ]);

  test('rowIds counts a pair once', () => {
    const { groups } = setup([grouped()]);
    expect(groups.current.rowIds).toEqual([
      'tab:h1',
      'tab:a',
      groupItemIdOf('g'),
      'tab:z',
    ]);
  });

  test('a group dropped below a pair gets the item index', () => {
    const { groups, order } = setup([grouped()]);
    // Rows with the group lifted: pair, a, z. Row 2 is between a and z.
    act(() => groups.current.onMove(groupItemIdOf('g'), 2, undefined, 'w'));
    expect(order('w')).toEqual(['h1', 'h2', 'a', 'm', 'z']);
  });

  test('a group dropped into another window, below its pair', () => {
    const { groups, order } = setup([
      grouped(),
      win('v', [half('p1'), half('p2'), tab('y'), tab('k')]),
    ]);
    act(() => groups.current.onMove(groupItemIdOf('g'), 2, undefined, 'v'));
    expect(order('v')).toEqual(['p1', 'p2', 'y', 'm', 'k']);
  });
});
