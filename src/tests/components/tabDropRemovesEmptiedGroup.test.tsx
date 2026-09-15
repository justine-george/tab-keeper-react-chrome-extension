import { describe, expect, test } from 'vitest';

import {
  fixedRowsRemovedByIn,
  groupEdgesOf,
} from '../../components/home/rightpane/useTabDrop';
import {
  ADJACENT_GROUP_GAP_PX,
  BAND_MARGIN_PX,
} from '../../components/home/rightpane/bandSpacing';
import type { tabData } from '../../redux/slices/tabContainerDataStateSlice';

// KAN-169. Which drops EMPTY the held tab's group. The answer has to agree with
// moveTabInternal's prune -- a group nothing answers to is removed -- and say
// what gap the band's neighbours keep once it is gone, which is the one number
// the drag engine cannot measure.

const tab = (id: string, g?: string): tabData => ({
  tabId: id,
  favicon: '',
  title: id,
  url: `https://${id}.test/`,
  ...(g ? { chromeGroupId: g } : {}),
});
const groups = (...ids: string[]) =>
  ids.map((groupId) => ({ groupId, title: groupId, color: 'blue' }));

// a0 a1 a2 [solo: s0] a3 -- the ticket's arrangement. s0 is index 3.
const LOOSE = groupEdgesOf(
  [tab('a0'), tab('a1'), tab('a2'), tab('s0', 'solo'), tab('a3')],
  groups('solo')
);

describe('fixedRowsRemovedByIn: when the drop empties the group', () => {
  test('the last member leaving upward removes the head and the tail', () => {
    expect(fixedRowsRemovedByIn(LOOSE, 's0', 3, undefined, false)).toEqual({
      first: 'solo',
      last: 'solo:tail',
      gapKept: 0,
    });
  });

  test('the last member leaving downward removes them too', () => {
    expect(fixedRowsRemovedByIn(LOOSE, 's0', 4, undefined, false)).toEqual({
      first: 'solo',
      last: 'solo:tail',
      gapKept: 0,
    });
  });

  test('the last member joining ANOTHER group removes its own', () => {
    // a0 [solo: s0] [beta: b0 b1] a3
    const edges = groupEdgesOf(
      [
        tab('a0'),
        tab('s0', 'solo'),
        tab('b0', 'beta'),
        tab('b1', 'beta'),
        tab('a3'),
      ],
      groups('solo', 'beta')
    );
    expect(fixedRowsRemovedByIn(edges, 's0', 1, 'beta', false)).toEqual({
      first: 'solo',
      last: 'solo:tail',
      gapKept: BAND_MARGIN_PX,
    });
  });

  test('the last member leaving for another window removes them whatever the target', () => {
    expect(fixedRowsRemovedByIn(LOOSE, 's0', 0, undefined, true)).toEqual({
      first: 'solo',
      last: 'solo:tail',
      gapKept: 0,
    });
  });
});

describe('fixedRowsRemovedByIn: when it does not', () => {
  test('a drop back into its own band keeps the group', () => {
    expect(fixedRowsRemovedByIn(LOOSE, 's0', 3, 'solo', false)).toBeUndefined();
  });

  test('a member of a larger group leaving keeps the group', () => {
    const edges = groupEdgesOf(
      [tab('a0'), tab('g0', 'g'), tab('g1', 'g'), tab('a3')],
      groups('g')
    );
    expect(
      fixedRowsRemovedByIn(edges, 'g0', 1, undefined, false)
    ).toBeUndefined();
  });

  test('a loose tab has no group to empty', () => {
    expect(
      fixedRowsRemovedByIn(LOOSE, 'a0', 4, undefined, false)
    ).toBeUndefined();
  });

  test('a group that is not rendered as a band is not a band to remove', () => {
    // No groups passed: the permission gate rendered the tabs flat.
    const flat = groupEdgesOf(
      [tab('a0'), tab('s0', 'solo'), tab('a3')],
      undefined
    );
    expect(
      fixedRowsRemovedByIn(flat, 's0', 0, undefined, false)
    ).toBeUndefined();
  });

  test('a group split across two runs still has a member left, like the reducer', () => {
    // moveTabInternal prunes on `some`, over the whole window.
    const split = groupEdgesOf(
      [tab('s0', 'solo'), tab('a1'), tab('s1', 'solo')],
      groups('solo')
    );
    expect(
      fixedRowsRemovedByIn(split, 's0', 1, undefined, false)
    ).toBeUndefined();
  });
});

describe('fixedRowsRemovedByIn: the gap the neighbours keep', () => {
  // [beta: b0 b1] [solo: s0] a3 a4 -- a group above, a loose tab below.
  const GROUP_ABOVE = groupEdgesOf(
    [
      tab('b0', 'beta'),
      tab('b1', 'beta'),
      tab('s0', 'solo'),
      tab('a3'),
      tab('a4'),
    ],
    groups('beta', 'solo')
  );
  // a0 [beta: b0 b1] [solo: s0] [gamma: g0 g1] a3 -- groups on both sides.
  const SANDWICH = groupEdgesOf(
    [
      tab('a0'),
      tab('b0', 'beta'),
      tab('b1', 'beta'),
      tab('s0', 'solo'),
      tab('g0', 'gamma'),
      tab('g1', 'gamma'),
      tab('a3'),
    ],
    groups('beta', 'solo', 'gamma')
  );

  test('a group on one side keeps its band margin', () => {
    expect(
      fixedRowsRemovedByIn(GROUP_ABOVE, 's0', 3, undefined, false)?.gapKept
    ).toBe(BAND_MARGIN_PX);
  });

  test('groups on both sides keep the adjacent-group gap when the tab goes elsewhere', () => {
    // To the top of the window (KAN-179: the lower band widens its top margin).
    expect(
      fixedRowsRemovedByIn(SANDWICH, 's0', 0, undefined, false)?.gapKept
    ).toBe(ADJACENT_GROUP_GAP_PX);
  });

  test('groups on both sides keep a band margin EACH when the tab lands loose between them', () => {
    // Measured: 44 moved rather than 40. The loose tab is now each band's
    // neighbour, so neither is after a group any more.
    expect(
      fixedRowsRemovedByIn(SANDWICH, 's0', 3, undefined, false)?.gapKept
    ).toBe(2 * BAND_MARGIN_PX);
  });

  test('a band leading its window has only the side below to count', () => {
    const leading = groupEdgesOf(
      [tab('s0', 'solo'), tab('g0', 'gamma'), tab('a2')],
      groups('solo', 'gamma')
    );
    expect(
      fixedRowsRemovedByIn(leading, 's0', 2, undefined, false)?.gapKept
    ).toBe(BAND_MARGIN_PX);
  });
});
