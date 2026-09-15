import { describe, expect, test } from 'vitest';

import {
  freedByRemoving,
  removalShifts,
  type WindowedSlot,
} from '../../../utils/functions/dragPreview';

// KAN-169. A drop that EMPTIES a group removes its band -- title row, tail
// marker, margins -- and every row below closes up by what the band occupied
// beyond the member that left. Every layout here was measured in the real
// popup on 2026-09-14 (tops relative to the tab-list container), and the
// expected number is the distance the rows below actually moved when the drop
// was seeded directly.

const ROW = 32;
const w = (
  key: string,
  top: number,
  height = ROW,
  windowId = 'w1'
): WindowedSlot => ({ key, top, height, windowId });
const at = (slots: readonly WindowedSlot[], key: string) =>
  slots.findIndex((s) => s.key === key);

// a0 a1 a2 [Solo: s0] a3 a4 -- the ticket's own case. Rows below moved 36.
const LOOSE_BOTH_SIDES = [
  w('a0', 0),
  w('a1', 32),
  w('a2', 64),
  w('Solo', 98),
  w('s0', 130),
  w('Solo:tail', 162, 0),
  w('a3', 164),
  w('a4', 196),
];

// a0 [Solo: s0] [Beta: b0 b1] a3. Beta's after-group margin is 8 while Solo
// stands and 2 once it is gone; measured, Beta and everything under it moved 40.
const GROUP_BELOW = [
  w('a0', 0),
  w('Solo', 34),
  w('s0', 66),
  w('Solo:tail', 98, 0),
  w('Beta', 106),
  w('b0', 138),
  w('b1', 170),
  w('Beta:tail', 202, 0),
  w('a3', 204),
];

// [Solo: s0] a1 a2 -- the band leads its window, so nothing sits above it in
// the drawn list. The list's content starts at 0, and a1 landed exactly there.
const LEADING = [
  w('Solo', 2),
  w('s0', 34),
  w('Solo:tail', 66, 0),
  w('a1', 68),
  w('a2', 100),
];

// [Beta: b0 b1] [Solo: s0] a3 a4. The slot above the span is Beta's zero-height
// tail marker, whose top is b1's bottom. Measured: a3 and a4 moved 40.
const GROUP_ABOVE = [
  w('Beta', 2),
  w('b0', 34),
  w('b1', 66),
  w('Beta:tail', 98, 0),
  w('Solo', 106),
  w('s0', 138),
  w('Solo:tail', 170, 0),
  w('a3', 172),
  w('a4', 204),
];

const span = (slots: readonly WindowedSlot[]) =>
  [at(slots, 'Solo'), at(slots, 'Solo:tail')] as const;

describe('freedByRemoving', () => {
  test('a band between two loose tabs frees its chrome and margins', () => {
    const [first, last] = span(LOOSE_BOTH_SIDES);
    expect(freedByRemoving(LOOSE_BOTH_SIDES, first, last, ROW, 0, 0)).toBe(36);
  });

  test('measured against the neighbours, so a collapsed margin below counts', () => {
    // Beta's 8px margin collapsed over Solo's 2; the list says 2 remains.
    const [first, last] = span(GROUP_BELOW);
    expect(freedByRemoving(GROUP_BELOW, first, last, ROW, 2, 0)).toBe(40);
  });

  test('a band leading its window measures from the list top', () => {
    const [first, last] = span(LEADING);
    expect(freedByRemoving(LEADING, first, last, ROW, 0, 0)).toBe(36);
  });

  test('a band leading a window whose list top is unknown frees nothing', () => {
    // No number is better than a guessed one: the rows below stay put, which
    // is what the preview drew before this existed.
    const [first, last] = span(LEADING);
    expect(freedByRemoving(LEADING, first, last, ROW, 0, undefined)).toBe(0);
  });

  test('a zero-height marker above the span is the neighbour, at its own top', () => {
    const [first, last] = span(GROUP_ABOVE);
    expect(freedByRemoving(GROUP_ABOVE, first, last, ROW, 2, 0)).toBe(40);
  });

  test('the gap the list names is subtracted whole', () => {
    // Between two groups: 8 when the tab lands elsewhere, 2 + 2 when it lands
    // loose in between (measured 40 and 44 on the same layout).
    const slots = [
      w('a0', 0),
      w('Beta', 34),
      w('b0', 66),
      w('b1', 98),
      w('Beta:tail', 130, 0),
      w('Solo', 138),
      w('s0', 170),
      w('Solo:tail', 202, 0),
      w('Gamma', 210),
      w('g0', 242),
      w('g1', 274),
      w('Gamma:tail', 306, 0),
      w('a3', 308),
    ];
    const [first, last] = span(slots);
    expect(freedByRemoving(slots, first, last, ROW, 8, 0)).toBe(40);
    expect(freedByRemoving(slots, first, last, ROW, 4, 0)).toBe(44);
  });

  test('a band with nothing below it in its window frees nothing to move', () => {
    const slots = [
      w('a0', 0),
      w('Solo', 34),
      w('s0', 66),
      w('Solo:tail', 98, 0),
    ];
    const [first, last] = span(slots);
    expect(freedByRemoving(slots, first, last, ROW, 0, 0)).toBe(0);
  });

  test('neighbours are found within the band’s own window only', () => {
    // The next window's rows follow in the drawn list; they are not what the
    // band closes up against, and they do not move (KAN-184: the source keeps
    // its box).
    const slots = [
      w('p0', 0, ROW, 'w0'),
      w('Solo', 40),
      w('s0', 72),
      w('Solo:tail', 104, 0),
      w('n0', 140, ROW, 'w2'),
    ];
    const [first, last] = span(slots);
    expect(freedByRemoving(slots, first, last, ROW, 0, 38)).toBe(0);
  });

  test('never negative', () => {
    const [first, last] = span(LOOSE_BOTH_SIDES);
    expect(freedByRemoving(LOOSE_BOTH_SIDES, first, last, ROW, 999, 0)).toBe(0);
  });
});

describe('removalShifts', () => {
  test('every slot below the span in its window closes up by what was freed', () => {
    const [, last] = span(LOOSE_BOTH_SIDES);
    expect(removalShifts(LOOSE_BOTH_SIDES, last, 36)).toEqual({
      a3: -36,
      a4: -36,
    });
  });

  test('slots above the span and the span itself are untouched', () => {
    const [, last] = span(GROUP_BELOW);
    const shifts = removalShifts(GROUP_BELOW, last, 40);
    expect(shifts).toEqual({
      Beta: -40,
      b0: -40,
      b1: -40,
      'Beta:tail': -40,
      a3: -40,
    });
  });

  test('rows of other windows below the span do not move', () => {
    const slots = [
      w('Solo', 2),
      w('s0', 34),
      w('Solo:tail', 66, 0),
      w('a1', 68),
      w('n0', 140, ROW, 'w2'),
    ];
    expect(removalShifts(slots, at(slots, 'Solo:tail'), 36)).toEqual({
      a1: -36,
    });
  });

  test('nothing freed moves nothing, and says so by absence', () => {
    const [, last] = span(LOOSE_BOTH_SIDES);
    expect(removalShifts(LOOSE_BOTH_SIDES, last, 0)).toEqual({});
  });
});
