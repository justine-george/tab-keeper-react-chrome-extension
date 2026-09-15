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
  // Also measured, and load-bearing for one reason: a group declares its tail
  // as a ZERO-HEIGHT marker (KAN-176), and a zero-height slot is not a place a
  // row can come to rest. Its top is the bottom of the row above it, so a
  // landing resolved onto one is a row too low -- see landingDeltaOf (KAN-178).
  height: number;
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
  if (start === undefined) return 0;

  // A slot with no height is not a place a row can come to rest (KAN-178). A
  // group declares its tail with a zero-height marker, so between two adjacent
  // groups the slot in front of the lower group's title row IS that marker, and
  // its top is the BOTTOM of the last member above it. Landing there drew the
  // ghost a whole row low, on the next group's title, while the tab itself came
  // to rest on that last member's top.
  //
  // Coming from above, "after the row above the marker" is that row's own top,
  // because the held row leaving shuffles it up into the gap -- which is also
  // the slot a join at that group's tail already resolves to, and the two land
  // in the same place by design (KAN-174: the band tint tells them apart).
  //
  // ONLY from above. From below nothing above the landing moves, so the gap
  // really does open at the marker's top, and stepping back would aim a row
  // too high.
  let index = to;
  while (from < index && slots[index]?.height === 0) index -= 1;

  const target = slots[index];
  if (target === undefined) return 0;
  return target.top - start.top;
}

// A slot tagged with the saved window it is drawn in (KAN-132), or undefined
// for one drawn in no window -- a row of a collapsed window, which is not
// rendered at all.
export interface WindowedSlot extends PreviewSlot {
  windowId: string | undefined;
}

/**
 * How far each slot moves while the held row is over a DIFFERENT window from
 * the one it came from (KAN-132).
 *
 * NOT previewShifts over a longer range. That was the design's first claim --
 * "a flat ordered list produces exactly that" -- and measured, it is wrong
 * twice over. A flat range moves every slot between the held row and its
 * landing slot, including the destination's rows and group title rows ABOVE
 * the landing point; the window headers in between are not slots and never
 * move. And the destination's row index names the first row NOT passed, where
 * within one window it names the last row that was, so the range also ran one
 * row too far. Measured in the popup, a tab held after b0 in the second window
 * previewed:
 *
 *   Beta's title row  331..363   over its own window's header at 329..361
 *   b1                461..493   raised past the tab
 *   landing slot      493..525   AFTER b1
 *
 * while the drop put the tab BEFORE b1 -- at 493 in that window's own frame,
 * with b1 pushed down to 525 and nothing above it moved.
 *
 * So each window is previewed in its OWN frame, as if it alone changed: the
 * source closes up below the row that left, the destination opens up from the
 * insertion point down, and nothing else moves -- the rows above either point,
 * every window in between, every header. The destination's box does not grow
 * until the drop, so its last rows can overlap the next header; the design
 * accepted that (spec 10).
 *
 * `at` is the slot the held row is inserted in front of, or any index past the
 * destination's last slot when it lands after all of them.
 */
export function previewShiftsAcross(
  slots: readonly WindowedSlot[],
  from: number,
  toWindowId: string,
  at: number,
  footprint: number
): Record<string, number> {
  const fromWindowId = slots[from]?.windowId;
  const shifts: Record<string, number> = {};
  slots.forEach((slot, i) => {
    if (
      fromWindowId !== undefined &&
      i > from &&
      slot.windowId === fromWindowId
    )
      shifts[slot.key] = -footprint;
    else if (i >= at && slot.windowId === toWindowId)
      shifts[slot.key] = footprint;
  });
  return shifts;
}

/**
 * How far the held row's own slot travels when it lands in another window
 * (KAN-132), in that window's own frame -- see previewShiftsAcross.
 *
 * To the top of the slot it is inserted in front of, which steps aside and
 * leaves exactly that space. Past the destination's last slot there is no such
 * slot, and it goes to `end`: the bottom of that window's block, which is where
 * a row appended there is drawn. Measured, both exact against the drop: the tab
 * inserted before b1 settled at b1's old top, and one appended after b1 at the
 * block's old bottom. A collapsed window is the same case with no slots at all,
 * so its slot sits directly under its header.
 */
export function landingDeltaAcross(
  slots: readonly WindowedSlot[],
  from: number,
  toWindowId: string,
  at: number,
  end: number | undefined
): number {
  const start = slots[from];
  if (start === undefined) return 0;
  const top = landsPastWindowEnd(slots, toWindowId, at) ? end : slots[at]?.top;
  // No box for the destination: preview no travel rather than a guessed one.
  return top === undefined ? 0 : top - start.top;
}

/**
 * Is the landing past the last row of the window it lands in? (KAN-182.)
 *
 * The same question `landingDeltaAcross` answers to choose between a slot's
 * top and the window's end, asked by name because the ANSWER MATTERS TWICE.
 * Where a row steps aside, the gap it opens is a row tall and the landing
 * placeholder is drawn in it. At a window's end nothing steps aside -- the
 * rows that would are in the NEXT window, and a cross-window preview moves
 * rows only within a window -- so there is no gap to draw in, only the space
 * between two window blocks. Drawn as a full row there, the placeholder covers
 * whatever follows, which for a window in the middle of a pane is the next
 * window's header: measured 24px into it, and it reads as though the row were
 * landing on that window instead.
 *
 * A collapsed destination has no slots at all and is this case by definition.
 */
export function landsPastWindowEnd(
  slots: readonly WindowedSlot[],
  toWindowId: string,
  at: number
): boolean {
  const target = slots[at];
  return target === undefined || target.windowId !== toWindowId;
}

/**
 * How much room a span of the drawn list gives back when the drop REMOVES it
 * (KAN-169).
 *
 * Every other rule here moves an element. This one is about an element that
 * ceases to exist: a group whose only member is the held row is pruned by the
 * drop, and its title row, tail marker and margins all go with it. The drawn
 * list is measured once at drag start and every slot in it survives to the
 * release, so previewShifts has no way to say so -- it shifted the title row
 * aside as if the group were still there, and every row below the band was
 * drawn 36px lower than the drop put it (measured; the band's whole chrome).
 *
 * Measured BETWEEN THE NEIGHBOURS, not from the span's own edges. What the
 * band occupies is not its own margins: a band below it may carry the wider
 * adjacent-group margin (KAN-179), which collapses over this band's and shrinks
 * to the ordinary one once this band is gone. Measured, the same 32px title row
 * freed 36 between two loose tabs and 40 beside another group. The two slots
 * either side of the span are still there after the drop, so the distance
 * between them is the one number that does not depend on how margins collapse
 * -- and what remains of it is `gapKept`, which only the list can know.
 *
 * `first..last` are slot indices, inclusive, and the span holds exactly one
 * row: the held one, whose own footprint previewShifts already carries to its
 * landing. Its height is what the span keeps; everything else in it is chrome.
 *
 * `listTop` stands in for the slot above when the span leads its window, in the
 * same content space as the slots. Unknown, nothing is freed: the rows below
 * then stay where the preview always drew them, rather than moving by a guess.
 *
 * Nothing below the span in its own window means nothing to close up, and 0.
 */
export function freedByRemoving(
  slots: readonly WindowedSlot[],
  first: number,
  last: number,
  heldHeight: number,
  gapKept: number,
  listTop: number | undefined
): number {
  const windowId = slots[first]?.windowId;
  const below = slots.find((s, i) => i > last && s.windowId === windowId);
  if (below === undefined) return 0;

  let above: number | undefined = listTop;
  for (let i = first - 1; i >= 0; i--) {
    const slot = slots[i];
    if (slot !== undefined && slot.windowId === windowId) {
      above = slot.top + slot.height;
      break;
    }
  }
  if (above === undefined) return 0;

  return Math.max(0, below.top - above - heldHeight - gapKept);
}

/**
 * How far each slot BELOW a removed span moves to close it up (KAN-169): every
 * slot after `last` in the span's own window, by `freed`. Added to whatever
 * previewShifts or previewShiftsAcross already moved them by -- the two are
 * different events (the held row leaving, the band leaving) and the drop
 * performs both.
 *
 * Its own window only. A same-window drag never moves another window's rows,
 * and a cross-window one keeps the source's box (KAN-184); the space the band
 * frees shows up as a gap inside that box, like the row's own.
 *
 * Slots that do not move are absent, like previewShifts.
 */
export function removalShifts(
  slots: readonly WindowedSlot[],
  last: number,
  freed: number
): Record<string, number> {
  const shifts: Record<string, number> = {};
  if (freed === 0) return shifts;
  const windowId = slots[last]?.windowId;
  slots.forEach((slot, i) => {
    if (i > last && slot.windowId === windowId) shifts[slot.key] = -freed;
  });
  return shifts;
}

/**
 * How far each saved WINDOW BLOCK moves while the held row is over another
 * window (KAN-184).
 *
 * The preview holds the layout still and expresses everything as transforms,
 * so a window cannot change height -- and until this existed, the destination
 * could not make room at all. Its rows below the landing shifted down and
 * spilled out of their own block, over the next window's header (measured:
 * 26px), and at its END no gap opened whatsoever, which is why the placeholder
 * there had to be drawn as a line (KAN-182, superseded).
 *
 * ONLY THE DESTINATION GROWS. A drop moves two heights -- the destination
 * gains a row and the source loses one -- but the preview never performs the
 * second: the held row still occupies its place in the source's flow until the
 * release, so that block keeps its box and the space it frees shows up as a
 * gap INSIDE it, exactly as a same-window drag has always drawn. Deriving this
 * from the post-drop layout instead gives every window between the two a
 * shift, which is measurably wrong -- the source's block then slides down into
 * the window below it (measured: 26px of overlap, the same defect one window
 * further down).
 *
 * Windows that do not move are absent, like previewShifts; read `?? 0`.
 */
export function windowShiftsAcross(
  order: readonly string[],
  toWindowId: string,
  footprint: number
): Record<string, number> {
  const to = order.indexOf(toWindowId);
  // A destination this pane does not hold cannot be made room for.
  if (to < 0) return {};

  const shifts: Record<string, number> = {};
  order.forEach((windowId, index) => {
    if (index > to) shifts[windowId] = footprint;
  });
  return shifts;
}
