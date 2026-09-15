import { describe, expect, test } from 'vitest';

import {
  gapChangeShifts,
  type WindowedSlot,
} from '../../../utils/functions/dragPreview';

// KAN-187. Two adjacent bands share one wide gap (KAN-179's 8px). Put a loose
// row between them and each keeps only its own 2px margin instead, so the row
// needs 4px LESS than its footprint; take that row away and the pair reclaims
// the wide gap, so 4px less is freed. Either way the correction lands on every
// slot from the LOWER band's head downward -- measured on main 2026-09-14.

const ROW = 32;
const w = (
  key: string,
  top: number,
  height = ROW,
  windowId = 'w1'
): WindowedSlot => ({ key, top, height, windowId });

// a0 [Beta: b0 b1] [Gamma: g0 g1] a3
const SLOTS = [
  w('a0', 0),
  w('Beta', 34),
  w('b0', 66),
  w('b1', 98),
  w('Beta:tail', 130, 0),
  w('Gamma', 138),
  w('g0', 170),
  w('g1', 202),
  w('Gamma:tail', 234, 0),
  w('a3', 236),
];
const at = (key: string) => SLOTS.findIndex((s) => s.key === key);

describe('gapChangeShifts', () => {
  test('moves the anchor band and everything below it', () => {
    expect(gapChangeShifts(SLOTS, at('Gamma'), -4)).toEqual({
      Gamma: -4,
      g0: -4,
      g1: -4,
      'Gamma:tail': -4,
      a3: -4,
    });
  });

  test('the anchor itself moves -- the gap that changed is ABOVE it', () => {
    expect(gapChangeShifts(SLOTS, at('Gamma'), 4).Gamma).toBe(4);
  });

  test('nothing above the anchor moves', () => {
    const shifts = gapChangeShifts(SLOTS, at('Gamma'), -4);
    for (const key of ['a0', 'Beta', 'b0', 'b1', 'Beta:tail']) {
      expect(shifts[key]).toBeUndefined();
    }
  });

  test('a zero change moves nothing, and says so by absence', () => {
    expect(gapChangeShifts(SLOTS, at('Gamma'), 0)).toEqual({});
  });

  test('only the anchor band’s own window', () => {
    const slots = [
      w('Gamma', 34),
      w('g0', 66),
      w('n0', 140, ROW, 'w2'),
      w('n1', 172, ROW, 'w2'),
    ];
    expect(gapChangeShifts(slots, 0, -4)).toEqual({ Gamma: -4, g0: -4 });
  });

  test('an anchor this list cannot place moves nothing', () => {
    expect(gapChangeShifts(SLOTS, -1, -4)).toEqual({});
    expect(gapChangeShifts(SLOTS, SLOTS.length, -4)).toEqual({});
  });
});
