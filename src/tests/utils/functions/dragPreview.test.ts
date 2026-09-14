import { describe, expect, test } from 'vitest';

import {
  landingDeltaOf,
  previewShifts,
  slotLandingBeside,
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
  { key: 'a0', top: 0, height: 32 },
  { key: 'a1', top: 32, height: 32 },
  { key: 'a2', top: 64, height: 32 },
  { key: 'alpha', top: 98, height: 32 },
  { key: 'alpha0', top: 130, height: 32 },
  { key: 'alpha1', top: 162, height: 32 },
  { key: 'alpha2', top: 194, height: 32 },
  { key: 'a3', top: 228, height: 32 },
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
      slotLandingBeside(2, ALPHA, 'after'),
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
      slotLandingBeside(7, ALPHA, 'after'),
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

describe('slotLandingBeside', () => {
  // A row landing beside a title row indexes the list with itself lifted out,
  // so coming from above it takes the title row's own slot -- they swap -- and
  // coming from below it takes the slot past it.
  test('joining from above, the row takes the title rows slot', () => {
    expect(slotLandingBeside(2, ALPHA, 'after')).toBe(3);
  });

  test('joining from below, the row takes the slot after the title row', () => {
    expect(slotLandingBeside(7, ALPHA, 'after')).toBe(4);
  });

  // KAN-168. Leaving a group is the same crossing in the other direction: the
  // tab ends up immediately BEFORE the title row rather than after it.
  test('leaving upward, the row takes the title rows own slot', () => {
    // alpha0 is at slot 4 -- immediately below the title row at 3.
    expect(slotLandingBeside(4, ALPHA, 'before')).toBe(3);
  });

  test('leaving upward from deeper in the group lands in the same slot', () => {
    // Which member it was does not change where it ends up: above the title.
    expect(slotLandingBeside(6, ALPHA, 'before')).toBe(3);
  });

  test('a row already above the title row lands one slot earlier', () => {
    expect(slotLandingBeside(1, ALPHA, 'before')).toBe(2);
  });
});

describe('previewShifts for a tab leaving its group', () => {
  // Measured (e2e/tab-group-join-preview.spec.ts): alpha0 leaves Alpha upward,
  // the title row drops to 130 from 98, and alpha1/alpha2 do NOT move.
  test('the title row drops and the members left behind hold still', () => {
    const shifts = previewShifts(
      LAYOUT,
      4,
      slotLandingBeside(4, ALPHA, 'before'),
      32
    );

    expect(shifts.alpha).toBe(32);
    expect(shifts.alpha1 ?? 0).toBe(0);
    expect(shifts.alpha2 ?? 0).toBe(0);
    expect(shifts.a3 ?? 0).toBe(0);
    expect(shifts.a2 ?? 0).toBe(0);
  });

  test('the landing slot is the title rows own top', () => {
    expect(
      landingDeltaOf(LAYOUT, 4, slotLandingBeside(4, ALPHA, 'before'))
    ).toBe(-32);
  });
});

// KAN-178. Two groups sitting next to each other, and a loose tab dropped
// BETWEEN them. Measured in the real popup at 790x550 on 2026-09-13, a window
// laid out: loose, loose, [group A: 2 members], [group B: 3 members], loose.
//
//   slot  key       top    height
//      0  top      156.5      32
//      1  newtab   188.5      32   <- the held row
//      2  A        222.5      32   A's title row
//      3  a1       254.5      32
//      4  a2       286.5      32
//      5  A:tail   318.5       0   <- a group declares its tail with no height
//      6  B        320.5      32   B's title row
//      7  b1       352.5      32
//      8  b2       384.5      32
//      9  b3       416.5      32
//     10  B:tail   448.5       0
//     11  last     450.5      32
//
// Released between the two groups, the tab really does land ungrouped between
// them -- measured, the store went
//   top newtab a1*A a2*A b1*B ...  ->  top a1*A a2*A newtab b1*B ...
// and the tab came to rest at 288.5, i.e. on a2's old top plus the 2px the band
// margin accounts for (KAN-167, the preview's known quantisation).
const BOUNDARY: PreviewSlot[] = [
  { key: 'top', top: 156.5, height: 32 },
  { key: 'newtab', top: 188.5, height: 32 },
  { key: 'A', top: 222.5, height: 32 },
  { key: 'a1', top: 254.5, height: 32 },
  { key: 'a2', top: 286.5, height: 32 },
  { key: 'A:tail', top: 318.5, height: 0 },
  { key: 'B', top: 320.5, height: 32 },
  { key: 'b1', top: 352.5, height: 32 },
  { key: 'b2', top: 384.5, height: 32 },
  { key: 'b3', top: 416.5, height: 32 },
  { key: 'B:tail', top: 448.5, height: 0 },
  { key: 'last', top: 450.5, height: 32 },
];

const HELD_FROM_ABOVE = 1;
const HELD_FROM_BELOW = 11;
const B_TITLE = 6;
const A_TAIL = 5;

describe('a tab landing between two adjacent groups', () => {
  // THE DEFECT. "Before B's title row" resolves to the slot in front of it,
  // which is A's tail marker -- and a marker with no height is not a place a
  // row can sit. Its top is a2's BOTTOM, so the slot was drawn a whole row low,
  // on B's title, while the tab landed on a2's top.
  test('lands on the last member of the group above, not on its tail marker', () => {
    expect(
      landingDeltaOf(
        BOUNDARY,
        HELD_FROM_ABOVE,
        slotLandingBeside(HELD_FROM_ABOVE, B_TITLE, 'before')
      )
    ).toBe(286.5 - 188.5);
  });

  // CONTROL, and the reason the fix is safe: joining A at its tail already
  // resolves to that same slot. The two land in the same place and are told
  // apart by the band tint and the frame, exactly as KAN-174 settled at the
  // other end of a group.
  test('CONTROL: joining the group above at its tail lands in the same place', () => {
    expect(
      landingDeltaOf(
        BOUNDARY,
        HELD_FROM_ABOVE,
        slotLandingBeside(HELD_FROM_ABOVE, A_TAIL, 'before')
      )
    ).toBe(286.5 - 188.5);
  });

  // CONTROL: from below nothing was ever wrong. "Before B's title" resolves to
  // the title row itself, which has height, and the title moves down instead.
  test('CONTROL: coming from below, the slot is the title rows own top', () => {
    expect(
      landingDeltaOf(
        BOUNDARY,
        HELD_FROM_BELOW,
        slotLandingBeside(HELD_FROM_BELOW, B_TITLE, 'before')
      )
    ).toBe(320.5 - 450.5);
  });
});

describe('landingDeltaOf', () => {
  // The distances the two measured drops actually travel. Both come out of the
  // same subtraction of measured tops, and both are EXACT -- which is what the
  // index clamp this replaces could never be, because it pointed the slot at
  // the first member whichever side the tab arrived from.
  test('joining from above lands on the title rows top', () => {
    expect(
      landingDeltaOf(LAYOUT, 2, slotLandingBeside(2, ALPHA, 'after'))
    ).toBe(34);
  });

  test('joining from below lands on the first members top', () => {
    expect(
      landingDeltaOf(LAYOUT, 7, slotLandingBeside(7, ALPHA, 'after'))
    ).toBe(-98);
  });

  test('an index off the end of the list travels nowhere', () => {
    expect(landingDeltaOf(LAYOUT, 2, 99)).toBe(0);
  });
});
