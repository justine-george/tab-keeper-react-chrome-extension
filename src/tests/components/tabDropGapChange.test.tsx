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

// a0 [beta: b0 b1] [gamma: g0 g1] a3 -- the bands are adjacent.
const ADJACENT = groupEdgesOf(
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

describe('gapOpenedByLandingIn: a loose row arriving between two bands', () => {
  // gamma's head sits at stored index 3; a0 comes from ABOVE, so in landing
  // space it is 2 (KAN-170's lift-out).
  test('from above', () => {
    expect(gapOpenedByLandingIn(ADJACENT, 'a0', 2, undefined)).toEqual({
      bandId: 'gamma',
      delta: -RELIEF,
    });
  });

  test('from below', () => {
    expect(gapOpenedByLandingIn(ADJACENT, 'a3', 3, undefined)).toEqual({
      bandId: 'gamma',
      delta: -RELIEF,
    });
  });

  test('a member leaving its band into the gap above it counts too', () => {
    // g0 leaves gamma and lands loose between the two bands.
    expect(gapOpenedByLandingIn(ADJACENT, 'g0', 3, undefined)).toEqual({
      bandId: 'gamma',
      delta: -RELIEF,
    });
  });

  test('CONTROL: landing loose above a band whose neighbour is a loose tab', () => {
    const oneBand = groupEdgesOf(
      [tab('a0'), tab('a1'), tab('g0', 'gamma'), tab('g1', 'gamma')],
      groups('gamma')
    );
    expect(gapOpenedByLandingIn(oneBand, 'a0', 1, undefined)).toBeUndefined();
  });

  test('CONTROL: a drop that JOINS a band opens no gap', () => {
    expect(gapOpenedByLandingIn(ADJACENT, 'a3', 3, 'gamma')).toBeUndefined();
  });

  test('CONTROL: landing anywhere else', () => {
    expect(gapOpenedByLandingIn(ADJACENT, 'a3', 0, undefined)).toBeUndefined();
  });
});

describe('gapClosedByLeavingIn: the only loose row between two bands leaves', () => {
  test('the pair reclaims the wide gap, anchored on the lower band', () => {
    expect(gapClosedByLeavingIn(SEPARATED, 'a1')).toEqual({
      bandId: 'gamma',
      delta: RELIEF,
    });
  });

  test('CONTROL: a loose row that is not between two bands', () => {
    expect(gapClosedByLeavingIn(SEPARATED, 'a0')).toBeUndefined();
    expect(gapClosedByLeavingIn(SEPARATED, 'a3')).toBeUndefined();
  });

  test('CONTROL: a GROUPED row leaving is KAN-169’s business, not this', () => {
    // Its band may be pruned, and that path already states the gap kept.
    expect(gapClosedByLeavingIn(SEPARATED, 'g0')).toBeUndefined();
  });

  test('CONTROL: a window with no bands at all', () => {
    const flat = groupEdgesOf([tab('a0'), tab('a1')], undefined);
    expect(gapClosedByLeavingIn(flat, 'a0')).toBeUndefined();
  });
});

describe('the two sides compose', () => {
  test('dropped back into the same gap, they cancel', () => {
    const left = gapClosedByLeavingIn(SEPARATED, 'a1');
    const arrived = gapOpenedByLandingIn(SEPARATED, 'a1', 3, undefined);
    expect(left).toEqual({ bandId: 'gamma', delta: RELIEF });
    expect(arrived).toEqual({ bandId: 'gamma', delta: -RELIEF });
    expect(left!.delta + arrived!.delta).toBe(0);
  });
});

// KAN-169 and KAN-187 describe the SAME quantity where a band is pruned
// between two others: what gap the survivors keep around the landing row.
// KAN-169 owns it there, and counting it twice put the lower band 4px high.
describe('a band being pruned between two others', () => {
  // a0 [beta: b0 b1] [solo: s0] [gamma: g0 g1] a3 -- s0 is solo's only member
  // and lands loose exactly where its band was.
  const SANDWICHED_BAND = groupEdgesOf(
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

  test('the band below it opens no gap of its own: KAN-169 already said so', () => {
    expect(
      gapOpenedByLandingIn(SANDWICHED_BAND, 's0', 3, undefined, 'solo')
    ).toBeUndefined();
  });

  test('CONTROL: told nothing was pruned, it claims a gap it should not', () => {
    // The defect the guard removes, stated as the difference it makes. Note
    // WHICH band it claims: solo, the one the drop is about to delete -- a
    // landing where a band stood satisfies that band's own head.
    expect(gapOpenedByLandingIn(SANDWICHED_BAND, 's0', 3, undefined)).toEqual({
      bandId: 'solo',
      delta: -RELIEF,
    });
  });
});
