import type { DragState } from '../../components/home/rightpane/rowDrag/dragContext';

/**
 * How far a row at `index` is shifted by the drag previewing `drag`.
 *
 * The same arithmetic DraggableRow applies to itself: everything the held row
 * has passed closes up behind it by one footprint.
 *
 * The held row itself falls out as 0, because neither range includes its own
 * index -- and that is exactly right here. It tracks the pointer rather than a
 * slot, so a group containing it holds one member that is not moving with the
 * others, which makes the group disagree and stay put. It is losing a member,
 * not travelling. An explicit guard for this was written first and removed: a
 * mutation proved it could never change an answer.
 */
function rowShift(drag: DragState, index: number): number {
  if (drag.toIndex > drag.fromIndex) {
    return index > drag.fromIndex && index <= drag.toIndex
      ? -drag.footprint
      : 0;
  }
  if (drag.toIndex < drag.fromIndex) {
    return index >= drag.toIndex && index < drag.fromIndex ? drag.footprint : 0;
  }
  return 0;
}

/**
 * How far a group's FRAME -- its title row and colour strip -- should move
 * during a drag over the tab list (KAN-165).
 *
 * The engine translates individual tab rows, and a group's frame is not one of
 * them, so without this it stays put while its members slide out through it:
 * measured, the first member of a three-tab group ended 2px ABOVE its own
 * title.
 *
 * The rule is that a shift shared by EVERY member belongs to the group. If they
 * all move alike, the group itself has moved and its frame goes with them. If
 * they disagree, the pointer is inside this group and it is opening a slot
 * rather than travelling -- the frame is already in the right place, and the
 * spare strip at the bottom is exactly where the incoming tab will sit.
 *
 * A group holding the held row also returns 0: that row tracks the pointer
 * rather than a slot, so the group is losing a member, not moving.
 */
export function groupFrameOffset(
  drag: DragState | null,
  memberIndices: readonly number[]
): number {
  if (!drag || memberIndices.length === 0) return 0;
  const shifts = memberIndices.map((index) => rowShift(drag, index));
  const [first] = shifts;
  return shifts.every((shift) => shift === first) ? first : 0;
}
