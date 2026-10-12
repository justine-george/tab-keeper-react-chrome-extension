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

describe('fixedRowsRemovedByIn: when it does not', () => {
  test('a drop back into its own band keeps the group', () => {
    expect(fixedRowsRemovedByIn(LOOSE, 's0', 3, 'solo', false)).toBeUndefined();
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

  test('groups on both sides keep the adjacent-group gap when the tab goes elsewhere', () => {
    // To the top of the window (KAN-179: the lower band widens its top margin).
    expect(
      fixedRowsRemovedByIn(SANDWICH, 's0', 0, undefined, false)?.gapKept
    ).toBe(ADJACENT_GROUP_GAP_PX);
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
