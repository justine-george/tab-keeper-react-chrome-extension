import { describe, expect, test } from 'vitest';

import { windowShiftsAcross } from '../../../utils/functions/dragPreview';

// KAN-184. Which saved WINDOW BLOCKS move while a row is held over another
// window, so the destination can actually make room for it.
//
// ONLY THE DESTINATION GROWS, and everything after it moves down by a row.
// The source is not in this answer at all: the held row still occupies its
// place in that window's flow until the release, so its block keeps its box
// and the space it frees shows as a gap inside it -- the same thing a
// same-window drag has always drawn.
//
// Deriving this from the post-drop layout instead -- where the source loses a
// row too, so only the windows BETWEEN the two move -- was measurably wrong:
// the source's block slid 34px down into the window below it, which is the
// very defect this exists to fix, one window further down.
const ORDER = ['w1', 'w2', 'w3', 'w4'];
const FP = 34;

describe('windowShiftsAcross', () => {
  test('every window after the destination moves down a row', () => {
    expect(windowShiftsAcross(ORDER, 'w2', FP)).toEqual({ w3: FP, w4: FP });
  });

  test('the destination itself does not move: the room opens INSIDE it', () => {
    expect(windowShiftsAcross(ORDER, 'w2', FP).w2 ?? 0).toBe(0);
  });

  test('windows above the destination never move', () => {
    expect(windowShiftsAcross(ORDER, 'w3', FP)).toEqual({ w4: FP });
  });

  // Landing in the LAST window needs no room made: nothing is drawn below it,
  // so the row a drop adds has the pane's own empty space to grow into.
  test('the last window as destination moves nothing', () => {
    expect(windowShiftsAcross(ORDER, 'w4', FP)).toEqual({});
  });

  test('the first window as destination moves every other one', () => {
    expect(windowShiftsAcross(ORDER, 'w1', FP)).toEqual({
      w2: FP,
      w3: FP,
      w4: FP,
    });
  });

  test('a destination this pane does not hold moves nothing', () => {
    expect(windowShiftsAcross(ORDER, 'nope', FP)).toEqual({});
  });

  test('a pane with one window has nothing to move', () => {
    expect(windowShiftsAcross(['w1'], 'w1', FP)).toEqual({});
  });
});
