import { describe, expect, test } from 'vitest';

import {
  gapChangeShifts,
  type WindowedSlot,
} from '../../../utils/functions/dragPreview';

// KAN-187. A loose row between two adjacent bands leaves each its own 2px margin, so it needs 4px LESS than its footprint;
// removing it reclaims the 8px gap (KAN-179). The correction lands from the LOWER band's head down -- measured on main 2026-09-14.

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
