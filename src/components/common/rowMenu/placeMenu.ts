// Places a right-click menu at a point, flipping it back across the point at the window edges (KAN-708).
export function placeMenu(
  at: { x: number; y: number },
  size: { width: number; height: number },
  viewport: { width: number; height: number },
  gutter = 4,
): { left: number; top: number } {
  return {
    left: placeAxis(at.x, size.width, viewport.width, gutter),
    top: placeAxis(at.y, size.height, viewport.height, gutter),
  };
}

// Start edge at the point if it fits; else flip to end before the point; else pin to the gutter at the far edge.
function placeAxis(point: number, extent: number, room: number, gutter: number): number {
  if (point + extent <= room - gutter) return point;
  if (point - extent >= gutter) return point - extent;
  return Math.max(gutter, room - gutter - extent);
}
