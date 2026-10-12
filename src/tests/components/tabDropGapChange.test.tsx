import { describe, expect, test } from 'vitest';

import {
  gapClosedByLeavingIn,
  gapOpenedByLandingIn,
  groupEdgesOf,
} from '../../components/home/rightpane/useTabDrop';
import type { tabData } from '../../redux/slices/tabContainerDataStateSlice';

// KAN-187. Which band's top gap a drop changes, and by how much.
//
// Two adjacent bands share KAN-179's 8px gap; a loose row between them makes
// each keep its own 2px margin instead. So inserting one needs 4px less than
// its footprint, and removing one frees 4px less. Measured on main, +/-4 in
// every direction, anchored on the LOWER band.

const RELIEF = 4; // ADJACENT_GROUP_GAP_PX (8) - 2 * BAND_MARGIN_PX (2)

const tab = (id: string, g?: string): tabData => ({
  tabId: id,
  favicon: '',
  title: id,
  url: `https://${id}.test/`,
  ...(g ? { chromeGroupId: g } : {}),
});
const groups = (...ids: string[]) =>
  ids.map((groupId) => ({ groupId, title: groupId, color: 'blue' }));

// a0 [beta: b0 b1] a1 [gamma: g0 g1] a3 -- a1 sits in the gap.
const SEPARATED = groupEdgesOf(
  [
    tab('a0'),
    tab('b0', 'beta'),
    tab('b1', 'beta'),
    tab('a1'),
    tab('g0', 'gamma'),
    tab('g1', 'gamma'),
    tab('a3'),
  ],
  groups('beta', 'gamma')
);

describe('the two sides compose', () => {
  test('dropped back into the same gap, they cancel', () => {
    const left = gapClosedByLeavingIn(SEPARATED, 'a1');
    const arrived = gapOpenedByLandingIn(SEPARATED, 'a1', 3, undefined);
    expect(left).toEqual({ bandId: 'gamma', delta: RELIEF });
    expect(arrived).toEqual({ bandId: 'gamma', delta: -RELIEF });
    expect(left!.delta + arrived!.delta).toBe(0);
  });
});
