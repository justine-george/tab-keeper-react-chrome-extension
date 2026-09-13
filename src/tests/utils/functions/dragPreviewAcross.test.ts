import { describe, expect, test } from 'vitest';

import {
  landingDeltaAcross,
  previewShiftsAcross,
  type WindowedSlot,
} from '../../../utils/functions/dragPreview';

// KAN-132. A tab dragged into ANOTHER window is previewed in each window's own
// frame: the source closes up below the row that left, the destination opens
// up from the insertion point down, and nothing else moves. The rows above the
// insertion point in the destination are the ones a single range across both
// windows got wrong -- measured, it lifted them into their own window's header.
//
//   wA: a0 0, a1 32, [G title 66, g0 98, G:tail 130]
//   wB: [H title 200, h0 232, H:tail 264], b0 266, b1 298
//   c0: a row of a collapsed window -- no box, no window
const FP = 32;
const SLOTS: WindowedSlot[] = [
  { key: 'c0', top: 0, windowId: undefined },
  { key: 'a0', top: 0, windowId: 'wA' },
  { key: 'a1', top: 32, windowId: 'wA' },
  { key: 'G', top: 66, windowId: 'wA' },
  { key: 'g0', top: 98, windowId: 'wA' },
  { key: 'G:tail', top: 130, windowId: 'wA' },
  { key: 'H', top: 200, windowId: 'wB' },
  { key: 'h0', top: 232, windowId: 'wB' },
  { key: 'H:tail', top: 264, windowId: 'wB' },
  { key: 'b0', top: 266, windowId: 'wB' },
  { key: 'b1', top: 298, windowId: 'wB' },
];
const at = (key: string) => SLOTS.findIndex((s) => s.key === key);
const PAST_END = SLOTS.length;
const WB_BOTTOM = 330;

describe('previewShiftsAcross', () => {
  test('down into the middle of the next window', () => {
    // a0 in front of b1.
    expect(previewShiftsAcross(SLOTS, at('a0'), 'wB', at('b1'), FP)).toEqual({
      a1: -FP,
      G: -FP,
      g0: -FP,
      'G:tail': -FP,
      b1: FP,
    });
  });

  test('up into the middle of the window above', () => {
    // b0 in front of g0, joining G at its head.
    expect(previewShiftsAcross(SLOTS, at('b0'), 'wA', at('g0'), FP)).toEqual({
      g0: FP,
      'G:tail': FP,
      b1: -FP,
    });
  });

  test('past the last row of another window opens nothing there', () => {
    expect(previewShiftsAcross(SLOTS, at('a0'), 'wB', PAST_END, FP)).toEqual({
      a1: -FP,
      G: -FP,
      g0: -FP,
      'G:tail': -FP,
    });
  });

  // THE CONTROL for the claim above: the same destination, inserted at its
  // first slot, does open it -- all of it.
  test('CONTROL: in front of its first slot, every slot of it steps down', () => {
    expect(previewShiftsAcross(SLOTS, at('a1'), 'wB', at('H'), FP)).toEqual({
      G: -FP,
      g0: -FP,
      'G:tail': -FP,
      H: FP,
      h0: FP,
      'H:tail': FP,
      b0: FP,
      b1: FP,
    });
  });

  // A collapsed window's rows sort to the front of the list at top 0, so an
  // insertion at the very front puts them inside the destination's range.
  test('a slot in no window never moves, even inside the range', () => {
    const shifts = previewShiftsAcross(SLOTS, at('b0'), 'wA', 0, FP);
    expect(shifts).not.toHaveProperty('c0');
    // CONTROL: the destination did open, from its first slot down.
    expect(shifts.a0).toBe(FP);
  });
});

describe('landingDeltaAcross', () => {
  test('lands on the top of the slot it is inserted in front of', () => {
    expect(landingDeltaAcross(SLOTS, at('a0'), 'wB', at('b1'), WB_BOTTOM)).toBe(
      298 - 0
    );
    expect(landingDeltaAcross(SLOTS, at('b0'), 'wA', at('g0'), 330)).toBe(
      98 - 266
    );
  });

  test('past the last slot, lands at the bottom of the window', () => {
    expect(landingDeltaAcross(SLOTS, at('a0'), 'wB', PAST_END, WB_BOTTOM)).toBe(
      WB_BOTTOM - 0
    );
  });

  // An index past the destination can still name a slot of a LATER window;
  // that slot is not where a row appended to this one goes.
  test("a slot of some other window is not the destination's end", () => {
    expect(landingDeltaAcross(SLOTS, at('a0'), 'wA', at('b0'), 150)).toBe(150);
  });

  test('with no box for the destination, the slot does not travel', () => {
    expect(landingDeltaAcross(SLOTS, at('a0'), 'wB', PAST_END, undefined)).toBe(
      0
    );
  });
});
