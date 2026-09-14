import { describe, expect, test } from 'vitest';

import { groupEndingAbove } from '../../components/home/rightpane/rowDrag/dropRules';

// KAN-181. Which group, if any, a landing sits immediately PAST the end of.
//
// The mirror of the head rule KAN-174 settled: a tab landing ungrouped right
// after a group has to name that group's tail, or the drop reads as a JOIN --
// the two land in the same slot, and the group's frame is the only thing that
// can tell them apart. Unnamed, the tail marker (KAN-176) sits outside the
// shift range, the group's members rise without it, and the colour strip hangs
// a row below the last member, over the slot the tab is about to take.
//
// Indices are in LANDING SPACE: the list with the held row already lifted out.
// So a held row above the group shuffles its last member up one, and this has
// to account for that -- the same adjustment the head rule makes.
//
// The window these describe:
//
//   0 top      1 newtab    2 a1*A   3 a2*A
//   4 b1*B     5 b2*B      6 b3*B   7 last
const LAST_MEMBER = new Map([
  ['A', 3],
  ['B', 6],
]);

describe('groupEndingAbove', () => {
  test('a tab held from above lands past the tail one slot earlier', () => {
    // newtab (1) lifted out: b3 moves 6 -> 5, so "after B" is slot 6.
    expect(groupEndingAbove(LAST_MEMBER, 1, 6)).toBe('B');
  });

  test('a tab held from below lands past the tail at the tail itself plus one', () => {
    // last (7) lifted out: nothing above b3 moved, so "after B" is slot 7.
    expect(groupEndingAbove(LAST_MEMBER, 7, 7)).toBe('B');
  });

  test('the group above answers for its own tail', () => {
    // A ends at 3; held from above (1) that is 2, so "after A" is slot 3.
    expect(groupEndingAbove(LAST_MEMBER, 1, 3)).toBe('A');
  });

  test('a landing one slot further down belongs to nobody', () => {
    expect(groupEndingAbove(LAST_MEMBER, 1, 7)).toBeUndefined();
  });

  test('a landing among a group members is not past its tail', () => {
    expect(groupEndingAbove(LAST_MEMBER, 1, 5)).toBeUndefined();
  });

  test('a window with no groups has no answer', () => {
    expect(groupEndingAbove(new Map(), 1, 6)).toBeUndefined();
  });

  // The held row's own index can be missing -- a row the window does not own.
  // Then there is nothing to lift out and the indices are the stored ones.
  test('with no held row, the tail is where the stored list puts it', () => {
    expect(groupEndingAbove(LAST_MEMBER, undefined, 7)).toBe('B');
    expect(groupEndingAbove(LAST_MEMBER, undefined, 6)).toBeUndefined();
  });

  // A held row BELOW the group does not move it, and one ABOVE moves it by
  // exactly one. Nothing else about the held row matters.
  test('only a held row above the group shifts the answer', () => {
    expect(groupEndingAbove(LAST_MEMBER, 0, 6)).toBe('B');
    expect(groupEndingAbove(LAST_MEMBER, 5, 6)).toBe('B');
    expect(groupEndingAbove(LAST_MEMBER, 6, 6)).toBe('B');
    expect(groupEndingAbove(LAST_MEMBER, 7, 6)).toBeUndefined();
  });
});
