// What a drag PREVIEWS, in the list as it is drawn rather than as it is stored.
//
// The engine's rows are the draggable ones, and for tabs that is not the whole
// layout: a group's title row sits between two consecutive rows and belongs to
// neither. Leave it out and a drop that changes a tab's GROUP has nothing to
// say -- the tab keeps its index, so "remove from f, insert at t" reads as a
// no-op while the layout genuinely rearranges (KAN-166).
//
// Put the title rows IN the list and the same drop is an ordinary move. A loose
// tab dropped on a group's title lands immediately after that title, which is a
// different slot from the one it left even when its row index is unchanged.
// Measured in the popup, and the two directions are not mirror images:
//
//   joining from ABOVE -- the title row rises past the held tab; the members
//                         do not move at all
//   joining from BELOW -- the members move down; the title row does not move
//
// One range test produces both, which is the point. The rule it replaces asked
// whether every member had shifted alike, and that cannot tell "the group was
// passed over" from "the group gained a first member".

export interface PreviewSlot {
  // A row id, or a title row's key. Only identity matters here; what the key
  // MEANS belongs to the list that supplied it.
  key: string;
  // Measured before the drag began, in the list's content space.
  top: number;
}

/**
 * How far each slot moves while the held row is over `to`.
 *
 * Keyed rather than indexed so a caller can ask about one element without
 * knowing where it sits -- a title row is rendered nowhere near the list that
 * positions it, and threading an index to it was the old rule's problem.
 *
 * Slots that do not move are ABSENT rather than 0, so the object stays small on
 * a long list and a caller reads `?? 0`.
 *
 * Everything moves by the HELD row's footprint, which is what lifting it out of
 * the flow frees up (KAN-163). That is a quantised answer: a tab joining a
 * group also stops paying the 2px margin that separates it from the band, so
 * the true distance is 2px shorter. The preview has always been quantised this
 * way and the landing slot below is exact, so the row settles where the slot
 * promised; see KAN-167 for closing the 2px.
 */
export function previewShifts(
  slots: readonly PreviewSlot[],
  from: number,
  to: number,
  footprint: number
): Record<string, number> {
  const shifts: Record<string, number> = {};
  // The held row itself is in neither range, and that is deliberate: it tracks
  // the pointer rather than a slot, so giving it a shift would fight the offset
  // the engine already applies.
  const [lo, hi] =
    to > from ? [from + 1, to + 1] : to < from ? [to, from] : [0, 0];
  const step = to > from ? -footprint : footprint;
  for (let i = lo; i < hi; i++) {
    const slot = slots[i];
    if (slot !== undefined) shifts[slot.key] = step;
  }
  return shifts;
}

// Which side of a title row a drop leaves the dragged row on.
//
// A drop that changes a tab's group CROSSES that group's title row, and which
// way it crosses is the whole difference between the two cases (KAN-168):
// joining at the head puts the tab under the title, leaving puts it above.
export type LandingSide = 'before' | 'after';

/**
 * The slot a row takes when it lands immediately beside the fixed slot `fixed`.
 *
 * An index into the list with the held row already lifted out, matching how the
 * engine's own landing index is counted -- which is why the answer depends on
 * which side the row is coming FROM as well as which side it lands on. From
 * above, removing it shuffles the fixed slot up one, so landing after it means
 * taking its old place: the two SWAP. From below, nothing above the fixed slot
 * moved, so the row lands past it.
 *
 * `before` is always one slot earlier than `after`, in both directions, because
 * the two name the gaps either side of the same element.
 */
export function slotLandingBeside(
  from: number,
  fixed: number,
  side: LandingSide
): number {
  const after = from < fixed ? fixed : fixed + 1;
  return side === 'after' ? after : after - 1;
}

/**
 * How far the held row's own slot has travelled, from measured tops.
 *
 * Derived from tops rather than by summing footprints, because this list is not
 * contiguous in layout -- the gap between two slots can hold margin belonging
 * to neither -- so a sum of footprints is not a distance.
 *
 * The held row lands on slot `to`'s top in both directions. Dragging up that is
 * immediate: it takes that slot's place. Dragging down it is the same answer by
 * a longer route, the slots between closing up by one footprint so that slot
 * rises by that much and the held row lands one footprint below it.
 */
export function landingDeltaOf(
  slots: readonly PreviewSlot[],
  from: number,
  to: number
): number {
  const start = slots[from];
  const target = slots[to];
  if (start === undefined || target === undefined) return 0;
  return target.top - start.top;
}
