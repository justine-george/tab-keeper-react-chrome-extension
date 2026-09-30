// KAN-152. A list travels while a dragged pointer is held near its edge, so a
// target that is off screen can be reached at all.
//
// How close to an edge the pointer must be for the list to start travelling,
// and how fast it goes at its deepest. 48px is roughly a row and a half here,
// which is wide enough to hit without aiming and narrow enough that ordinary
// dragging near the ends does not trigger it.
const EDGE_ZONE_PX = 48;
const MAX_SCROLL_PX_PER_FRAME = 14;

// How far a scroller should travel this frame with the pointer at viewport
// `y`: negative up, positive down, 0 outside both edge zones. Speed ramps with
// how deep into the zone the pointer is, so a small correction near the
// boundary is possible and a long haul is quick. Shared by the drag engine
// and the session list while it takes a carry (KAN-350), so the two scroll
// alike.
export function edgeScrollStep(
  box: Pick<DOMRect, 'top' | 'bottom' | 'height'>,
  y: number
): number {
  // Capped to a third of the viewport, because a fixed 48px zone at each
  // end OVERLAPS in a short list -- in a 90px pane the two zones cover 96px,
  // so every position counts as an edge and the list scrolls no matter where
  // the pointer is. Found by the control test, which is what a control is
  // for. A third each leaves a third in the middle that never scrolls.
  const zone = Math.min(EDGE_ZONE_PX, box.height / 3);

  const intoTop = zone - (y - box.top);
  const intoBottom = zone - (box.bottom - y);
  const depth = Math.max(intoTop, intoBottom);
  if (depth <= 0) return 0;

  const speed = Math.min(depth / zone, 1) * MAX_SCROLL_PX_PER_FRAME;
  return intoTop > intoBottom ? -speed : speed;
}
