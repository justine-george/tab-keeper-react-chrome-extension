import { describe, expect, test } from 'vitest';

import {
  groupEdgesOf,
  landsBesideFixedRowIn,
} from '../../components/home/rightpane/useTabDrop';
import type { tabData } from '../../redux/slices/tabContainerDataStateSlice';

// KAN-167. Where a tab lands LOOSE beside a band's edge, the slot the drawn
// list names for it is a band's measured edge, and that edge includes spacing
// a loose tab does not pay. The list knows the spacing; it says how far from
// the named slot the row actually settles. Every number here was measured in
// the real popup on 2026-09-14 as the difference between the slot the engine
// drew and where the tab came to rest.

const tab = (id: string, g?: string): tabData => ({
  tabId: id,
  favicon: '',
  title: id,
  url: `https://${id}.test/`,
  ...(g ? { chromeGroupId: g } : {}),
});
const groups = (...ids: string[]) =>
  ids.map((groupId) => ({ groupId, title: groupId, color: 'blue' }));

// a0 a1 a2 [alpha: x0 x1 x2] a3
const LOOSE_AROUND = groupEdgesOf(
  [
    tab('a0'),
    tab('a1'),
    tab('a2'),
    tab('x0', 'alpha'),
    tab('x1', 'alpha'),
    tab('x2', 'alpha'),
    tab('a3'),
  ],
  groups('alpha')
);
// a0 [beta: b0 b1] [gamma: g0 g1] a3
const SANDWICH = groupEdgesOf(
  [
    tab('a0'),
    tab('b0', 'beta'),
    tab('b1', 'beta'),
    tab('g0', 'gamma'),
    tab('g1', 'gamma'),
    tab('a3'),
  ],
  groups('beta', 'gamma')
);
// [alpha: x0 x1] a1 a2 -- the band leads its window.
const LEADING = groupEdgesOf(
  [tab('x0', 'alpha'), tab('x1', 'alpha'), tab('a1'), tab('a2')],
  groups('alpha')
);

describe('landing loose BEFORE a band, resolved to its title row', () => {
  test('a member leaving upward settles the band’s top margin higher', () => {
    // Measured: slot 98, tab 96.
    expect(landsBesideFixedRowIn(LOOSE_AROUND, 'x0', 3, undefined)).toEqual({
      fixedRowId: 'alpha',
      side: 'before',
      offset: -2,
    });
  });

  test('a loose tab from below settles the same margin higher', () => {
    // Measured: slot 98, tab 96.
    expect(landsBesideFixedRowIn(LOOSE_AROUND, 'a3', 3, undefined)).toEqual({
      fixedRowId: 'alpha',
      side: 'before',
      offset: -2,
    });
  });

  test('after another band, the wider gap less the margin the loose tab keeps', () => {
    // Measured: slot 138, tab 132 -- the 8px adjacent-group gap becomes 2.
    expect(landsBesideFixedRowIn(SANDWICH, 'g0', 3, undefined)).toEqual({
      fixedRowId: 'gamma',
      side: 'before',
      offset: -6,
    });
    expect(landsBesideFixedRowIn(SANDWICH, 'a3', 3, undefined)).toEqual({
      fixedRowId: 'gamma',
      side: 'before',
      offset: -6,
    });
  });

  test('a band leading its window: the margin alone', () => {
    // Measured: slot 2, tab 0.
    expect(landsBesideFixedRowIn(LEADING, 'a1', 0, undefined)).toEqual({
      fixedRowId: 'alpha',
      side: 'before',
      offset: -2,
    });
  });

  test('from ABOVE the slot is the row before the title, and over a loose row that is exact', () => {
    // a0 down to just above Alpha: lands on a2's slot, which a2 vacates.
    expect(landsBesideFixedRowIn(LOOSE_AROUND, 'a0', 2, undefined)).toEqual({
      fixedRowId: 'alpha',
      side: 'before',
    });
  });

  test('from ABOVE over another band, it settles that band’s bottom margin lower', () => {
    // Measured: slot 98 (b1's old top), tab 100.
    expect(landsBesideFixedRowIn(SANDWICH, 'a0', 2, undefined)).toEqual({
      fixedRowId: 'gamma',
      side: 'before',
      offset: 2,
    });
  });
});

describe('landing loose PAST a band, resolved to its tail', () => {
  test('from above, it settles the band’s bottom margin lower', () => {
    // Measured: slot 194, tab 196.
    expect(landsBesideFixedRowIn(LOOSE_AROUND, 'a0', 5, undefined)).toEqual({
      fixedRowId: 'alpha:tail',
      side: 'after',
      offset: 2,
    });
  });

  test('a member leaving downward likewise', () => {
    // Measured: slot 194, tab 196.
    expect(landsBesideFixedRowIn(LOOSE_AROUND, 'x2', 5, undefined)).toEqual({
      fixedRowId: 'alpha:tail',
      side: 'after',
      offset: 2,
    });
  });

  test('from below the slot is the row after the band, which already pays that margin', () => {
    // a3 a4 after the band; a4 dragged up to just under it lands on a3's slot.
    const edges = groupEdgesOf(
      [tab('a0'), tab('x0', 'alpha'), tab('x1', 'alpha'), tab('a3'), tab('a4')],
      groups('alpha')
    );
    expect(landsBesideFixedRowIn(edges, 'a4', 3, undefined)).toEqual({
      fixedRowId: 'alpha:tail',
      side: 'after',
    });
  });
});

describe('CONTROL: joins are exact and carry no offset', () => {
  test('joining at the head from above', () => {
    expect(landsBesideFixedRowIn(LOOSE_AROUND, 'a2', 2, 'alpha')).toEqual({
      fixedRowId: 'alpha',
      side: 'after',
    });
  });

  test('joining at the head from below', () => {
    expect(landsBesideFixedRowIn(LOOSE_AROUND, 'a3', 3, 'alpha')).toEqual({
      fixedRowId: 'alpha',
      side: 'after',
    });
  });

  test('joining at the tail from below', () => {
    expect(landsBesideFixedRowIn(LOOSE_AROUND, 'a3', 6, 'alpha')).toEqual({
      fixedRowId: 'alpha:tail',
      side: 'before',
    });
  });
});
