import { describe, expect, test } from 'vitest';

import { groupFrameOffset } from '../../../utils/functions/groupFrame';
import type { DragState } from '../../../components/home/rightpane/rowDrag/dragContext';

// KAN-165. A group's frame -- title row and colour strip -- is not a row in the
// tab list, so the engine never translates it, and members slid out through
// their own group: measured in the popup, the first member of Alpha ended at
// 189 while its title stayed at 191, sitting on top of it.
//
// The rule under test: a shift shared by EVERY member belongs to the group.
const drag = (over: Partial<DragState> = {}): DragState => ({
  rowId: 'held',
  fromIndex: 0,
  toIndex: 0,
  offset: 0,
  footprint: 34,
  ...over,
});

describe('groupFrameOffset', () => {
  test('no drag leaves the frame alone', () => {
    expect(groupFrameOffset(null, [1, 2, 3])).toBe(0);
  });

  test('a group the held row has passed entirely travels with it', () => {
    // Held row at 0 moving to 4; the group owns 1..3, all inside the range.
    expect(
      groupFrameOffset(drag({ fromIndex: 0, toIndex: 4 }), [1, 2, 3])
    ).toBe(-34);
  });

  test('dragging upward carries the frame the other way', () => {
    // Held row at 5 moving to 1; the group owns 1..3, all inside the range.
    expect(
      groupFrameOffset(drag({ fromIndex: 5, toIndex: 1 }), [1, 2, 3])
    ).toBe(34);
  });

  test('a group the held row has not reached does not move', () => {
    expect(groupFrameOffset(drag({ fromIndex: 0, toIndex: 2 }), [5, 6])).toBe(
      0
    );
  });

  // The case that makes this a rule rather than a constant: the pointer is
  // INSIDE this group, so it is opening a slot, not travelling.
  test('a group only half passed keeps its frame still', () => {
    expect(
      groupFrameOffset(drag({ fromIndex: 0, toIndex: 2 }), [1, 2, 3])
    ).toBe(0);
  });

  // Not via a special case: the held row's own index falls outside both
  // shifted ranges, so it reads 0 while its siblings read -34, and the
  // disagreement is what holds the frame still.
  test('a group holding the held row does not move: it is losing a member', () => {
    // Members 2 and 3, and the held row IS member 2. Every other member sits
    // inside the shifted range, so the held row's own 0 is the only thing
    // holding the frame still. A group of [1, 2, 3] disagrees at index 1 as
    // well and would pass this however the held row were treated -- a mutation
    // proved exactly that.
    expect(groupFrameOffset(drag({ fromIndex: 2, toIndex: 5 }), [2, 3])).toBe(
      0
    );
  });

  test('a group with no members has nothing to follow', () => {
    expect(groupFrameOffset(drag({ fromIndex: 0, toIndex: 4 }), [])).toBe(0);
  });
});
