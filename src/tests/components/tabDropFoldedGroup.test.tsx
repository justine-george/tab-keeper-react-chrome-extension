import { describe, expect, test } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { Provider } from 'react-redux';
import type { ReactNode } from 'react';

import {
  gapOpenedByLandingIn,
  groupEdgesOf,
  landsBesideFixedRowIn,
  useTabDrop,
} from '../../components/home/rightpane/useTabDrop';
import {
  saveToTabContainerInternal,
  type tabData,
  type windowGroupData,
} from '../../redux/slices/tabContainerDataStateSlice';
import type { chromeTabGroupData } from '../../utils/functions/tabGroups';
import { BAND_MARGIN_PX } from '../../components/home/rightpane/bandSpacing';
import { makeTestStore } from '../setup/makeStore';

// KAN-822. A folded group draws only its title row, so the drag counts no
// rows for its members: the band is one item, and a drop on it lands at the
// group's end (D8).

const tab = (tabId: string, extra: Partial<tabData> = {}): tabData => ({
  tabId,
  favicon: '',
  title: tabId,
  url: `https://${tabId}.test/`,
  ...extra,
});
const member = (tabId: string, groupId = 'g') =>
  tab(tabId, { chromeGroupId: groupId });
const group = (groupId: string, collapsed: boolean): chromeTabGroupData => ({
  groupId,
  title: groupId,
  color: 'blue',
  ...(collapsed ? { collapsed: true as const } : {}),
});

// L [g: G1 G2] M
const MID = [tab('L'), member('G1'), member('G2'), tab('M')];
const FOLDED_G: ReadonlySet<string> = new Set(['g']);

describe('groupEdgesOf with a folded group', () => {
  test('rows count only drawn tabs: M is row 1, the members none', () => {
    const edges = groupEdgesOf(MID, [group('g', true)], FOLDED_G);
    expect(edges.indexOfTab.get('L')).toBe(0);
    expect(edges.indexOfTab.get('M')).toBe(1);
    expect(edges.indexOfTab.has('G1')).toBe(false);
    expect(edges.indexOfTab.has('G2')).toBe(false);
  });

  test('the folded group starts at the row after it and ends one before', () => {
    const edges = groupEdgesOf(MID, [group('g', true)], FOLDED_G);
    expect(edges.groupFirstIndex.get('g')).toBe(1);
    expect(edges.groupLastIndex.get('g')).toBe(0);
  });

  test("the band's neighbours are unchanged by the fold", () => {
    const open = groupEdgesOf(MID, [group('g', false)]);
    const folded = groupEdgesOf(MID, [group('g', true)], FOLDED_G);
    expect(folded.bandNeighbours.get('g')).toEqual(
      open.bandNeighbours.get('g')
    );
  });

  test('a folded group at the window end starts past every row', () => {
    const edges = groupEdgesOf(MID.slice(0, 3), [group('g', true)], FOLDED_G);
    expect(edges.groupFirstIndex.get('g')).toBe(1);
    expect(edges.groupLastIndex.get('g')).toBe(0);
  });

  test('a group the set does not name stays open', () => {
    const edges = groupEdgesOf(MID, [group('g', false)], new Set(['other']));
    expect(edges.indexOfTab.get('M')).toBe(3);
    expect(edges.groupFirstIndex.get('g')).toBe(1);
    expect(edges.groupLastIndex.get('g')).toBe(2);
  });
});

describe('landsBesideFixedRowIn beside a folded band', () => {
  const edges = groupEdgesOf(MID, [group('g', true)], FOLDED_G);

  test('a loose landing above it from above lands after its title row (Review Focus 1)', () => {
    // L down past nothing: row 0 with L lifted is the band's row.
    expect(landsBesideFixedRowIn(edges, 'L', 0, undefined)).toEqual({
      fixedRowId: 'g',
      side: 'after',
      offset: BAND_MARGIN_PX,
    });
  });

  test('a loose landing above it from below lands after its title row too', () => {
    expect(landsBesideFixedRowIn(edges, 'M', 1, undefined)).toEqual({
      fixedRowId: 'g',
      side: 'after',
    });
  });

  test('a landing on the folded band opens no room under its title row', () => {
    expect(landsBesideFixedRowIn(edges, 'L', 0, 'g')).toBeUndefined();
    expect(landsBesideFixedRowIn(edges, 'M', 1, 'g')).toBeUndefined();
  });

  test('at the window end, from above', () => {
    const end = groupEdgesOf(MID.slice(0, 3), [group('g', true)], FOLDED_G);
    expect(landsBesideFixedRowIn(end, 'L', 0, undefined)).toEqual({
      fixedRowId: 'g',
      side: 'after',
      offset: BAND_MARGIN_PX,
    });
  });

  test("a group's tail just above a folded band does not take the landing", () => {
    // [o: O1] [g: G1] M: row 1 ends o and starts the folded g.
    const two = groupEdgesOf(
      [member('O1', 'o'), member('G1'), tab('M'), tab('N')],
      [group('o', false), group('g', true)],
      FOLDED_G
    );
    expect(landsBesideFixedRowIn(two, 'N', 1, undefined)).toEqual({
      fixedRowId: 'g',
      side: 'after',
    });
  });

  test('two folded bands in a row: the landing is after the second', () => {
    const both = groupEdgesOf(
      [tab('L'), member('G1'), member('H1', 'h'), tab('M')],
      [group('g', true), group('h', true)],
      new Set(['g', 'h'])
    );
    expect(landsBesideFixedRowIn(both, 'M', 1, undefined)).toEqual({
      fixedRowId: 'h',
      side: 'after',
    });
  });

  test('an open band right after a folded one keeps its own head answer', () => {
    // L [g folded] [h: H1] -- the slot after g is before h's title row.
    const tabs = [tab('L'), member('G1'), member('H1', 'h')];
    const groups = [group('g', true), group('h', false)];
    const folded = groupEdgesOf(tabs, groups, FOLDED_G);
    const landing = landsBesideFixedRowIn(folded, 'L', 0, undefined);
    expect(landing?.fixedRowId).toBe('h');
    expect(landing?.side).toBe('before');
  });

  test('a loose landing below a folded band opens no gap above it', () => {
    // [o: O1] [g folded] N: the tab never lands between o and g.
    const two = groupEdgesOf(
      [member('O1', 'o'), member('G1'), tab('N')],
      [group('o', false), group('g', true)],
      FOLDED_G
    );
    expect(gapOpenedByLandingIn(two, 'N', 1, undefined)).toBeUndefined();
  });
});

// The pane hands the hook what the store holds; a folded group is its stored flag.
const win = (
  windowId: string,
  tabs: tabData[],
  groups: chromeTabGroupData[] = [group('g', true)]
): windowGroupData => ({
  windowId,
  windowHeight: 1080,
  windowWidth: 1920,
  windowOffsetTop: 0,
  windowOffsetLeft: 0,
  tabCount: tabs.length,
  title: windowId,
  tabs,
  chromeTabGroups: groups,
});

function setup(windows: windowGroupData[]) {
  const { store } = makeTestStore();
  store.dispatch(
    saveToTabContainerInternal({
      tabGroupId: 'tg',
      title: 'Session',
      createdTime: '2026-11-15 09:00:00',
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
  const pane = { tabGroupId: 'tg', windows };
  const stored = (windowId: string) =>
    store
      .getState()
      .tabContainerDataState.tabGroups[0].windows.find(
        (w) => w.windowId === windowId
      );
  return {
    tabs: renderHook(() => useTabDrop(pane, true), { wrapper }).result,
    order: (windowId: string) =>
      stored(windowId)?.tabs.map((t) =>
        t.chromeGroupId === undefined
          ? t.tabId
          : `${t.tabId}:${t.chromeGroupId}`
      ),
    groupOf: (windowId: string) => stored(windowId)?.chromeTabGroups?.[0],
  };
}

// c lead [g: a b], g folded: the group at the window end.
const TRIP = () => win('w', [tab('c'), tab('lead'), member('a'), member('b')]);

describe('useTabDrop with a folded saved group', () => {
  test('rowIds leave out the folded members', () => {
    const { tabs } = setup([TRIP()]);
    expect(tabs.current.rowIds).toEqual(['c', 'lead']);
  });

  test('without the grant nothing is folded', () => {
    const { store } = makeTestStore();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <Provider store={store}>{children}</Provider>
    );
    const pane = { tabGroupId: 'tg', windows: [TRIP()] };
    const { result } = renderHook(() => useTabDrop(pane, false), { wrapper });
    expect(result.current.rowIds).toEqual(['c', 'lead', 'a', 'b']);
  });

  test('a release on the folded band joins at its end and keeps the fold', () => {
    const { tabs, order, groupOf } = setup([TRIP()]);
    // Rows with c lifted: lead. The band's row is 1.
    act(() => tabs.current.onMove('c', 1, 'g', 'w'));
    expect(order('w')).toEqual(['lead', 'a:g', 'b:g', 'c:g']);
    expect(groupOf('w')?.collapsed).toBe(true);
  });

  test('a loose release at the band lands after the group, ungrouped', () => {
    const { tabs, order, groupOf } = setup([TRIP()]);
    act(() => tabs.current.onMove('c', 1, undefined, 'w'));
    expect(order('w')).toEqual(['lead', 'a:g', 'b:g', 'c']);
    expect(groupOf('w')?.collapsed).toBe(true);
  });

  test('a loose release in the row below a mid-window band lands after it', () => {
    const { tabs, order } = setup([
      win('w', [tab('c'), member('a'), member('b'), tab('m'), tab('n')]),
    ]);
    // Rows with n lifted: c, m. Row 1 is the band's row, just above m.
    act(() => tabs.current.onMove('n', 1, undefined, 'w'));
    expect(order('w')).toEqual(['c', 'a:g', 'b:g', 'n', 'm']);
  });

  test('from another window onto a folded band, at its end', () => {
    const { tabs, order } = setup([
      win('x', [tab('x1'), tab('x2')], []),
      win('w', [tab('lead'), member('a'), member('b'), tab('m')]),
    ]);
    act(() => tabs.current.onMove('x1', 1, 'g', 'w'));
    expect(order('w')).toEqual(['lead', 'a:g', 'b:g', 'x1:g', 'm']);
  });

  // Review critical 1. The edge rule is for loose drops: a join stays inside its own group.
  test('a tail join of an open group just above a folded one stays in the open group', () => {
    const { tabs, order } = setup([
      win(
        'w',
        [member('H1', 'h'), member('H2', 'h'), member('G1'), tab('M')],
        [group('h', false), group('g', true)]
      ),
    ]);
    // Rows with M lifted: H1, H2. Row 2 is h's tail.
    act(() => tabs.current.onMove('M', 2, 'h', 'w'));
    expect(order('w')).toEqual(['H1:h', 'H2:h', 'M:h', 'G1:g']);
  });

  test('a tail join from another window, above a folded group, stays in the open group', () => {
    const { tabs, order } = setup([
      win('x', [tab('X')], []),
      win(
        'w',
        [member('H1', 'h'), member('G1'), tab('M')],
        [group('h', false), group('g', true)]
      ),
    ]);
    act(() => tabs.current.onMove('X', 1, 'h', 'w'));
    expect(order('w')).toEqual(['H1:h', 'X:h', 'G1:g', 'M']);
  });

  test('a head join of an open group just below a folded one lands at its head', () => {
    const { tabs, order } = setup([
      win(
        'w',
        [tab('L'), member('G1'), member('H1', 'h'), member('H2', 'h')],
        [group('g', true), group('h', false)]
      ),
    ]);
    // Rows with L lifted: H1, H2. Row 0 is h's head.
    act(() => tabs.current.onMove('L', 0, 'h', 'w'));
    expect(order('w')).toEqual(['G1:g', 'L:h', 'H1:h', 'H2:h']);
  });

  test('a held split pair dropped on a folded band joins at its end, both halves', () => {
    const half = (tabId: string) => tab(tabId, { splitId: 'p' });
    const { tabs, order } = setup([
      win('w', [half('p1'), half('p2'), tab('lead'), member('a'), member('b')]),
    ]);
    // Rows with the pair lifted: lead. The band's row is 1.
    act(() => tabs.current.onMove('p1', 1, 'g', 'w'));
    expect(order('w')).toEqual(['lead', 'a:g', 'b:g', 'p1:g', 'p2:g']);
  });

  test('a folded split pair counts as the tabs it holds', () => {
    const pair = (tabId: string) =>
      tab(tabId, { chromeGroupId: 'g', splitId: 's' });
    const { tabs, order } = setup([
      win('w', [tab('lead'), pair('h1'), pair('h2'), tab('m')]),
    ]);
    act(() => tabs.current.onMove('lead', 0, 'g', 'w'));
    expect(order('w')).toEqual(['h1:g', 'h2:g', 'lead:g', 'm']);
  });
});
