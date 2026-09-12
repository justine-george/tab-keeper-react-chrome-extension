import { describe, expect, test } from 'vitest';

import {
  landingDeltaOf,
  previewShifts,
  slotLandingAfter,
  type PreviewSlot,
} from '../../../utils/functions/dragPreview';

// KAN-166. The preview runs in a list that includes the group TITLE ROWS, not
// only the draggable ones -- which is what lets a drop that changes a tab's
// GROUP be expressed as an ordinary move.
//
// Every number below is measured, not derived. Rendered in the real popup at
// 790x550 on 2026-09-12 (e2e/tab-group-join-preview.spec.ts): three loose tabs, a
// three-member group, one loose tab. Tops relative to a0.
//
//   ext  key      top
//     0  a0         0
//     1  a1        32
//     2  a2        64
//     3  alpha     98   <- Alpha's title row; not a draggable row
//     4  alpha0   130
//     5  alpha1   162
//     6  alpha2   194
//     7  a3       228
//
// And the two post-drop layouts it has to predict, measured the same way by
// seeding the arrangement moveTabInternal produces:
//
//   a2 joins Alpha from ABOVE -- a2 +34, the title row -32, EVERYTHING ELSE 0
//   a3 joins Alpha from BELOW -- a3 -98, alpha0/1/2 +32, the title row 0
//
// Note what the second one says: the members move and the frame does not. The
// rule this replaces could not express either case, because it read "every
// member shifted alike" as "the group travelled" -- true when the group is
// passed over, false when it GAINS a first member.
const LAYOUT: PreviewSlot[] = [
  { key: 'a0', top: 0 },
  { key: 'a1', top: 32 },
  { key: 'a2', top: 64 },
  { key: 'alpha', top: 98 },
  { key: 'alpha0', top: 130 },
  { key: 'alpha1', top: 162 },
  { key: 'alpha2', top: 194 },
  { key: 'a3', top: 228 },
];

// a2's and a3's measured footprint. Both sit beside the band, which carries a
// 2px margin the tabs themselves do not, so both are 34 rather than 32.
const FOOTPRINT = 34;

const ALPHA = 3;

describe('previewShifts', () => {
  test('a tab joining a group from above moves the title row, not the members', () => {
    const shifts = previewShifts(
      LAYOUT,
      2,
      slotLandingAfter(2, ALPHA),
      FOOTPRINT
    );

    expect(shifts.alpha).toBe(-FOOTPRINT);
    for (const key of ['a0', 'a1', 'alpha0', 'alpha1', 'alpha2', 'a3']) {
      expect(shifts[key] ?? 0).toBe(0);
    }
  });

  test('a tab joining a group from below moves the members, not the title row', () => {
    const shifts = previewShifts(
      LAYOUT,
      7,
      slotLandingAfter(7, ALPHA),
      FOOTPRINT
    );

    expect(shifts.alpha ?? 0).toBe(0);
    expect(shifts.alpha0).toBe(FOOTPRINT);
    expect(shifts.alpha1).toBe(FOOTPRINT);
    expect(shifts.alpha2).toBe(FOOTPRINT);
    for (const key of ['a0', 'a1', 'a2']) {
      expect(shifts[key] ?? 0).toBe(0);
    }
  });

  test('a plain reorder shifts everything the held row passed', () => {
    // a0 dragged down to a2's slot. The title row is not in the range and
    // stays put, which is the same answer the old rule gave.
    const shifts = previewShifts(LAYOUT, 0, 2, FOOTPRINT);

    expect(shifts.a1).toBe(-FOOTPRINT);
    expect(shifts.a2).toBe(-FOOTPRINT);
    expect(shifts.alpha ?? 0).toBe(0);
  });

  test('a group passed over entirely carries its title row along', () => {
    // a0 dragged past the whole of Alpha. Now the title row IS in the range.
    const shifts = previewShifts(LAYOUT, 0, 6, FOOTPRINT);

    expect(shifts.alpha).toBe(-FOOTPRINT);
    expect(shifts.alpha0).toBe(-FOOTPRINT);
    expect(shifts.alpha2).toBe(-FOOTPRINT);
    expect(shifts.a3 ?? 0).toBe(0);
  });

  test('the held row is never given a shift: it tracks the pointer', () => {
    expect(previewShifts(LAYOUT, 0, 6, FOOTPRINT).a0 ?? 0).toBe(0);
  });

  test('a drag that lands where it started moves nothing', () => {
    expect(previewShifts(LAYOUT, 2, 2, FOOTPRINT)).toEqual({});
  });
});

describe('slotLandingAfter', () => {
  // A row landing immediately after a title row indexes the list with itself
  // lifted out, so coming from above it takes the title row's own slot -- they
  // swap -- and coming from below it takes the slot after it.
  test('from above, the row takes the title rows slot', () => {
    expect(slotLandingAfter(2, ALPHA)).toBe(3);
  });

  test('from below, the row takes the slot after the title row', () => {
    expect(slotLandingAfter(7, ALPHA)).toBe(4);
  });
});

describe('landingDeltaOf', () => {
  // The distances the two measured drops actually travel. Both come out of the
  // same subtraction of measured tops, and both are EXACT -- which is what the
  // index clamp this replaces could never be, because it pointed the slot at
  // the first member whichever side the tab arrived from.
  test('joining from above lands on the title rows top', () => {
    expect(landingDeltaOf(LAYOUT, 2, slotLandingAfter(2, ALPHA))).toBe(34);
  });

  test('joining from below lands on the first members top', () => {
    expect(landingDeltaOf(LAYOUT, 7, slotLandingAfter(7, ALPHA))).toBe(-98);
  });

  test('an index off the end of the list travels nowhere', () => {
    expect(landingDeltaOf(LAYOUT, 2, 99)).toBe(0);
  });
});
