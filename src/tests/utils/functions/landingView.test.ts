import { describe, expect, test } from 'vitest';

import {
  carriedRowId,
  landingView,
  type ShownSession,
} from '../../../utils/functions/carriedView';
import type { CarriedRef } from '../../../redux/slices/tabContainerDataStateSlice';
import { s1, s2, session, tab, win } from '../../fixtures/sessionMoveFixture';
import { NEW_LAST_WINDOW } from '../../../components/home/rightpane/newWindowTarget';

// KAN-350 Task 5. What the detail draws while something is carried, with a
// place for it to land: the session on screen as the carry leaves it, and
// the carried item as a PHANTOM row -- a tab or group in a synthetic LAST
// window (NEW_LAST_WINDOW, the list's trailing block, KAN-361/366), so no
// row of the session moves to make room for it; a window as the first
// window. The engine adopts that row as an ordinary drag. Its rows go by
// PHANTOM ids ("carried:" + the item's own), so it is never the same row as
// the item itself.
//
// S1: w1 [t1, g1a*g1, g1b*g1, t2, t4*g2], w2 [t3]. S2: d1 [u1, u2*h1,
// u3*h1], d2 [u4].

const tabRef = (tabId: string, windowId = 'w1'): CarriedRef => ({
  kind: 'tab',
  tabGroupId: 'S1',
  windowId,
  tabId,
});
const groupRef = (groupId: string): CarriedRef => ({
  kind: 'group',
  tabGroupId: 'S1',
  windowId: 'w1',
  groupId,
});
const windowRef = (windowId: string): CarriedRef => ({
  kind: 'window',
  tabGroupId: 'S1',
  windowId,
});

// The last window a view draws: where a tab's or group's phantom rests.
const lastOf = <T>(items: readonly T[] | undefined): T | undefined =>
  items === undefined ? undefined : items[items.length - 1];

const shape = (view: ShownSession | null) =>
  view?.windows.map((w) => ({
    windowId: w.windowId,
    tabs: w.tabs.map((t) => t.tabId + (t.chromeGroupId ? '*' : '')),
    groups: (w.chromeTabGroups ?? []).map((g) => g.groupId),
  }));

describe('landingView: a tab', () => {
  test('in another session: a synthetic last window holding it, loose', () => {
    const view = landingView([s1(), s2()], 'S2', tabRef('t4'));
    expect(view?.tabGroupId).toBe('S2');
    expect(shape(view)).toEqual([
      { windowId: 'd1', tabs: ['u1', 'u2*', 'u3*'], groups: ['h1'] },
      { windowId: 'd2', tabs: ['u4'], groups: [] },
      { windowId: NEW_LAST_WINDOW, tabs: ['carried:t4'], groups: [] },
    ]);
  });

  test('in its own session: gone from its place, and in the synthetic window', () => {
    const view = landingView([s1(), s2()], 'S1', tabRef('t2'));
    expect(shape(view)).toEqual([
      {
        windowId: 'w1',
        tabs: ['t1', 'g1a*', 'g1b*', 't4*'],
        groups: ['g1', 'g2'],
      },
      { windowId: 'w2', tabs: ['t3'], groups: [] },
      { windowId: NEW_LAST_WINDOW, tabs: ['carried:t2'], groups: [] },
    ]);
  });

  test('the synthetic window takes its source window’s bounds and no title', () => {
    const phantom = lastOf(
      landingView([s1(), s2()], 'S2', tabRef('t1'))?.windows
    );
    expect(phantom).toMatchObject({
      windowId: NEW_LAST_WINDOW,
      title: '',
      tabCount: 1,
      windowHeight: 700,
      windowWidth: 1100,
    });
  });

  test('the stored sessions are not changed', () => {
    const source = s1();
    const target = s2();
    const before = JSON.stringify([source, target]);
    landingView([source, target], 'S2', tabRef('t4'));
    expect(JSON.stringify([source, target])).toBe(before);
  });
});

describe('landingView: a group', () => {
  test('in another session: its tabs and its entry in the synthetic window', () => {
    const view = landingView([s1(), s2()], 'S2', groupRef('g1'));
    expect(lastOf(shape(view))).toEqual({
      windowId: NEW_LAST_WINDOW,
      tabs: ['carried:g1a*', 'carried:g1b*'],
      groups: ['carried:g1'],
    });
    // Each phantom tab is in the phantom group.
    expect(lastOf(view?.windows)?.tabs.map((t) => t.chromeGroupId)).toEqual([
      'carried:g1',
      'carried:g1',
    ]);
    expect(
      shape(view)
        ?.slice(0, -1)
        .map((w) => w.windowId)
    ).toEqual(['d1', 'd2']);
  });

  test('in its own session: gone from its window, and in the synthetic one', () => {
    const view = landingView([s1()], 'S1', groupRef('g1'));
    expect(shape(view)).toEqual([
      { windowId: 'w1', tabs: ['t1', 't2', 't4*'], groups: ['g2'] },
      { windowId: 'w2', tabs: ['t3'], groups: [] },
      {
        windowId: NEW_LAST_WINDOW,
        tabs: ['carried:g1a*', 'carried:g1b*'],
        groups: ['carried:g1'],
      },
    ]);
  });
});

describe('landingView: a window', () => {
  test('in another session: the first window, its content as it is, and no synthetic one', () => {
    const source = s1();
    const view = landingView([source, s2()], 'S2', windowRef('w2'));
    expect(shape(view)).toEqual([
      { windowId: 'carried:w2', tabs: ['carried:t3'], groups: [] },
      { windowId: 'd1', tabs: ['u1', 'u2*', 'u3*'], groups: ['h1'] },
      { windowId: 'd2', tabs: ['u4'], groups: [] },
    ]);
    expect(view?.windows[0]).toMatchObject({
      title: source.windows[1].title,
      tabCount: 1,
      windowHeight: source.windows[1].windowHeight,
    });
  });

  test('in its own session: moved from its place to the first', () => {
    const view = landingView([s1()], 'S1', windowRef('w2'));
    expect(shape(view)?.map((w) => w.windowId)).toEqual(['carried:w2', 'w1']);
  });
});

// Review Focus 4. Duplicate ids from legacy data or an import: a session that
// already holds one of the carried item's ids offers no exact spot; a row
// drop still works (the reducer re-mints).
describe('landingView refuses (null)', () => {
  const clash = (windows: ReturnType<typeof win>[]) =>
    session('S2', 'Target', 0, windows);

  test.each<[string, CarriedRef, ReturnType<typeof clash>]>([
    ['a tab id already shown', tabRef('t2'), clash([win('d1', [tab('t2')])])],
    [
      'a group id already shown',
      groupRef('g1'),
      clash([
        win(
          'd1',
          [tab('u9', 'g1')],
          [{ groupId: 'g1', title: 'G', color: 'red' }]
        ),
      ]),
    ],
    [
      'a tab of a carried group already shown',
      groupRef('g1'),
      clash([win('d1', [tab('g1b')])]),
    ],
    [
      'a window id already shown',
      windowRef('w2'),
      clash([win('w2', [tab('z')])]),
    ],
    [
      'a tab of a carried window already shown',
      windowRef('w2'),
      clash([win('d1', [tab('t3')])]),
    ],
  ])('%s', (_what, carried, target) => {
    expect(landingView([s1(), target], 'S2', carried)).toBeNull();
  });

  test('CONTROL: the same session with no clash takes it', () => {
    expect(
      landingView([s1(), clash([win('d1', [tab('u9')])])], 'S2', tabRef('t2'))
    ).not.toBeNull();
  });

  test('no session has the shown id', () => {
    expect(landingView([s1()], 'nope', tabRef('t1'))).toBeNull();
  });

  test('the carried item is no longer there', () => {
    expect(landingView([s1(), s2()], 'S2', tabRef('gone'))).toBeNull();
    expect(landingView([s1(), s2()], 'S2', groupRef('nope'))).toBeNull();
    expect(landingView([s1(), s2()], 'S2', windowRef('w9'))).toBeNull();
  });
});

describe('carriedRowId: the id the phantom row goes by in its list', () => {
  test.each<[CarriedRef, string]>([
    [tabRef('t2'), 'carried:t2'],
    [groupRef('g1'), 'group:carried:g1'],
    [windowRef('w2'), 'carried:w2'],
  ])('%j', (carried, rowId) => {
    expect(carriedRowId(carried)).toBe(rowId);
  });
});
