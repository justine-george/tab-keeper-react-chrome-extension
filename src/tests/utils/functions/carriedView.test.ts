import { describe, expect, test } from 'vitest';

import {
  carriedView,
  type ShownSession,
} from '../../../utils/functions/carriedView';
import type { CarriedRef } from '../../../redux/slices/tabContainerDataStateSlice';
import { s1, s2 } from '../../fixtures/sessionMoveFixture';

// KAN-350. What the saved detail draws while something is carried: the
// carried item is hidden from its source, so the list closes up behind it.
//
// S1: w1 [t1, g1a*g1, g1b*g1, t2, t4*g2], w2 [t3]. S2: d1, d2.

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

const shape = (view: ShownSession | null) =>
  view?.windows.map((w) => ({
    windowId: w.windowId,
    tabs: w.tabs.map((t) => t.tabId),
    groups: (w.chromeTabGroups ?? []).map((g) => g.groupId),
  }));

describe('carriedView leaves the carried item out of its source', () => {
  test('a tab: gone from its window, the rest in order', () => {
    const view = carriedView([s1(), s2()], 'S1', tabRef('t2'));
    expect(shape(view)).toEqual([
      {
        windowId: 'w1',
        tabs: ['t1', 'g1a', 'g1b', 't4'],
        groups: ['g1', 'g2'],
      },
      { windowId: 'w2', tabs: ['t3'], groups: [] },
    ]);
  });

  test('the only tab of a group: the group entry goes with it', () => {
    const view = carriedView([s1()], 'S1', tabRef('t4'));
    expect(shape(view)?.[0]).toEqual({
      windowId: 'w1',
      tabs: ['t1', 'g1a', 'g1b', 't2'],
      groups: ['g1'],
    });
  });

  test('a group: its tabs and its entry are gone', () => {
    const view = carriedView([s1()], 'S1', groupRef('g1'));
    expect(shape(view)?.[0]).toEqual({
      windowId: 'w1',
      tabs: ['t1', 't2', 't4'],
      groups: ['g2'],
    });
  });

  test('a window: gone from the session', () => {
    const view = carriedView([s1()], 'S1', windowRef('w1'));
    expect(shape(view)).toEqual([{ windowId: 'w2', tabs: ['t3'], groups: [] }]);
  });

  // Plan Decision: a window left with no rows shows its header until the drop.
  test('a window emptied by hiding its only tab is still drawn', () => {
    const view = carriedView([s1()], 'S1', tabRef('t3', 'w2'));
    expect(shape(view)?.[1]).toEqual({ windowId: 'w2', tabs: [], groups: [] });
  });

  test('the stored session is not changed', () => {
    const source = s1();
    const before = JSON.stringify(source);
    carriedView([source], 'S1', groupRef('g1'));
    expect(JSON.stringify(source)).toBe(before);
  });
});

// The drag areas re-bind whenever the session they are handed changes
// identity, so "nothing to leave out" must hand back the stored object itself.
describe('carriedView hands back the stored session when nothing is left out', () => {
  test('no carry', () => {
    const source = s1();
    expect(carriedView([source], 'S1', null)).toBe(source);
  });

  test('the carried item is another session’s', () => {
    const target = s2();
    expect(carriedView([s1(), target], 'S2', tabRef('t1'))).toBe(target);
  });

  test('the carried item is no longer there', () => {
    const source = s1();
    expect(carriedView([source], 'S1', tabRef('gone'))).toBe(source);
  });

  test('no session has the shown id', () => {
    expect(carriedView([s1()], 'nope', tabRef('t1'))).toBeNull();
  });
});
