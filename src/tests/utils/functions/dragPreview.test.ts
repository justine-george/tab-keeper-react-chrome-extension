import { describe, expect, test } from 'vitest';

import {
  landingDeltaOf,
  previewShifts,
  slotLandingBeside,
  type PreviewSlot,
} from '../../../utils/functions/dragPreview';

// KAN-166. The preview list includes group TITLE ROWS, so a drop that changes a tab's group is an ordinary move.
// Measured in the popup at 790x550, 2026-09-12 (e2e/tab-group-join-preview.spec.ts); tops relative to a0:
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
// The two post-drop layouts it must predict, measured the same way:
//
//   a2 joins Alpha from ABOVE -- a2 +34, the title row -32, EVERYTHING ELSE 0
//   a3 joins Alpha from BELOW -- a3 -98, alpha0/1/2 +32, the title row 0 (members move, the frame does not)
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

// Measured: beside the band, whose 2px margin the tabs lack, so 34 rather than 32.
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
    // a0 dragged down to a2's slot: the title row is out of range and stays put.
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
  // Beside a title row the index counts with the row lifted out: from above it takes the title row's slot (they swap), from below the slot past it.
  test('joining from above, the row takes the title rows slot', () => {
    expect(slotLandingBeside(2, ALPHA, 'after')).toBe(3);
  });

  test('joining from below, the row takes the slot after the title row', () => {
    expect(slotLandingBeside(7, ALPHA, 'after')).toBe(4);
  });

  // KAN-168. Leaving a group crosses the other way: the tab lands immediately BEFORE the title row.
  test('leaving upward, the row takes the title rows own slot', () => {
    // alpha0 is at slot 4 -- immediately below the title row at 3.
    expect(slotLandingBeside(4, ALPHA, 'before')).toBe(3);
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

// KAN-178. A loose tab dropped BETWEEN two adjacent groups. Measured in the popup at 790x550, 2026-09-13:
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
// It lands ungrouped between them -- top newtab a1*A a2*A b1*B ... -> top a1*A a2*A newtab b1*B ...
// -- and rests at 288.5: a2's old top plus the band margin's 2px (KAN-167).
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
  // THE DEFECT: "before B's title row" resolved to A's zero-height tail marker, whose top is a2's bottom, so the slot drew a row low.
  test('lands on the last member of the group above, not on its tail marker', () => {
    expect(
      landingDeltaOf(
        BOUNDARY,
        HELD_FROM_ABOVE,
        slotLandingBeside(HELD_FROM_ABOVE, B_TITLE, 'before')
      )
    ).toBe(286.5 - 188.5);
  });

  // CONTROL: joining A at its tail resolves to the same slot; band tint and frame tell them apart (KAN-174).
  test('CONTROL: joining the group above at its tail lands in the same place', () => {
    expect(
      landingDeltaOf(
        BOUNDARY,
        HELD_FROM_ABOVE,
        slotLandingBeside(HELD_FROM_ABOVE, A_TAIL, 'before')
      )
    ).toBe(286.5 - 188.5);
  });

  // CONTROL: from below, "before B's title" is the title row itself, which has height.
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
  // The distances the two measured drops travel, exact from the measured tops.
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

// KAN-360. A GROUP dragged down past another group; the held group is measured FOLDED to its title row, the others whole.
// Measured in the popup at 790x550, 2026-10-01 (e2e/group-landing-slot.spec.ts): Extensions, then Watchlist (2 tabs), Ratings (2), Soundtrack (1), Snacks (1).
// Watchlist held, folded:
//
//   slot  key        top   height
//      0  ext        156      32
//      1  watch      190      32   <- the held group, its title row alone
//      2  ratings    230      96
//      3  sound      334      64
//      4  snacks     406      64
//
// Where the release put Watchlist's title row, against the slot drawn (on a0a91b1):
//
//   past Ratings              294    slot 230 -- on Ratings' own rows
//   past Soundtrack           366    slot 334 -- on Spotify
//   past Snacks, the end      438    slot 406 -- on Popcorn
//
// The slot was drawn on the passed group's TOP, right only when the two are the same height.
const HELD_FOLDED: PreviewSlot[] = [
  { key: 'ext', top: 156, height: 32 },
  { key: 'watch', top: 190, height: 32 },
  { key: 'ratings', top: 230, height: 96 },
  { key: 'sound', top: 334, height: 64 },
  { key: 'snacks', top: 406, height: 64 },
];

// Snacks held instead: its title row landed exactly on the top of the group it was dropped before. Dragging up was never wrong.
const HELD_LAST_FOLDED: PreviewSlot[] = [
  { key: 'ext', top: 156, height: 32 },
  { key: 'watch', top: 190, height: 96 },
  { key: 'ratings', top: 294, height: 96 },
  { key: 'sound', top: 398, height: 64 },
  { key: 'snacks', top: 470, height: 32 },
];

describe('landingDeltaOf, a held row shorter than the rows it passes (KAN-360)', () => {
  test('down past one group lands where that group ends, not on its top', () => {
    expect(landingDeltaOf(HELD_FOLDED, 1, 2)).toBe(294 - 190);
  });

  test('down past two groups', () => {
    expect(landingDeltaOf(HELD_FOLDED, 1, 3)).toBe(366 - 190);
  });

  test('down to the end of the window', () => {
    expect(landingDeltaOf(HELD_FOLDED, 1, 4)).toBe(438 - 190);
  });

  test('CONTROL: up past one group lands on its top', () => {
    expect(landingDeltaOf(HELD_LAST_FOLDED, 4, 3)).toBe(398 - 470);
  });

  test('CONTROL: up past every group lands on the first groups top', () => {
    expect(landingDeltaOf(HELD_LAST_FOLDED, 4, 1)).toBe(190 - 470);
  });
});

// KAN-360 in the TAB list at a 20px root (Chrome's "Large"): a tab row is 38px, a title row stays 32.
// Measured in the popup at 790x550, 2026-10-01 (e2e/tab-landing-slot-large-font.spec.ts), at rest:
//
//   slot  key     top   height
//      0  x0      174      38
//      1  x1      212      38   <- the held row
//      2  g       252      32   Gee's title row
//      3  g0      284      38
//      4  g1      322      38
//      5  g:tail  360       0
//      6  y0      362      38
//
// x1 joining Gee at its head rested at 246, its bottom on the title row's bottom; the slot drew at 252, 6px low.
const LARGE_ROOT: PreviewSlot[] = [
  { key: 'x0', top: 174, height: 38 },
  { key: 'x1', top: 212, height: 38 },
  { key: 'g', top: 252, height: 32 },
  { key: 'g0', top: 284, height: 38 },
  { key: 'g1', top: 322, height: 38 },
  { key: 'g:tail', top: 360, height: 0 },
  { key: 'y0', top: 362, height: 38 },
];

describe('landingDeltaOf, a tab row taller than a title row (KAN-360)', () => {
  test('joining a group at its head from above lands bottom to bottom', () => {
    expect(
      landingDeltaOf(LARGE_ROOT, 1, slotLandingBeside(1, 2, 'after'))
    ).toBe(246 - 212);
  });

  // CONTROL: from below, "after the title row" is g0's own top.
  test('CONTROL: joining it at its head from below lands on g0s top', () => {
    expect(
      landingDeltaOf(LARGE_ROOT, 6, slotLandingBeside(6, 2, 'after'))
    ).toBe(284 - 362);
  });
});
