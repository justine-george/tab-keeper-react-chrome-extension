import { describe, expect, test } from 'vitest';

import { windowShiftsAcross } from '../../../utils/functions/dragPreview';

// KAN-184. Which saved WINDOW BLOCKS move while a row is held over another window. ONLY THE DESTINATION GROWS, and
// everything after it moves down a row. The source keeps its box until release. Deriving this from the post-drop layout
// was measured wrong: the source's block slid 34px into the window below.
const ORDER = ['w1', 'w2', 'w3', 'w4'];
const FP = 34;

describe('windowShiftsAcross', () => {
  test('every window after the destination moves down a row', () => {
    expect(windowShiftsAcross(ORDER, 'w2', FP)).toEqual({ w3: FP, w4: FP });
  });

  // The LAST window needs no room: the pane's empty space below takes the row.
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
});
