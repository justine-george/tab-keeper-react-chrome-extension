/** Below this much ground right of the sheet, the pointer would crowd it. */
const MIN_ROOM_PX = 90;

export type ButtonBox = Pick<DOMRectReadOnly, 'left' | 'width' | 'bottom'>;
export type SheetBox = Pick<DOMRectReadOnly, 'right' | 'top'>;
type Point = [x: number, y: number];

const APPROACH_DROPS = [50, 45, 40, 35, 30];

/**
 * KAN-826. One marker sweep from the ground right of the sheet up to just
 * under Save as PDF…'s middle, with a hand-drawn head, never over the file.
 * Null when the ground beside the sheet is narrower than MIN_ROOM_PX, or no
 * approach reaches the tip without crossing the sheet. The geometry is r3
 * variation 2, as mocked.
 */
export function savePdfPointerPaths(
  button: ButtonBox,
  sheet: SheetBox,
  viewportWidth: number
): { line: string; head: string } | null {
  if (viewportWidth - sheet.right < MIN_ROOM_PX) return null;
  const x0 = sheet.right + 18,
    y0 = sheet.top + 120;
  const c1x = x0 + 70,
    c1y = y0 - 30;
  const x1 = button.left + button.width / 2,
    y1 = button.bottom + 8;
  // The approach starts 40px right of the tip, or of the sheet's edge when a
  // longer label puts the tip left of it (9 of 13 languages), so it comes in
  // over the ground.
  const c2x = Math.max(x1, sheet.right) + 40;
  const onSheet = ([x, y]: Point) => x <= sheet.right && y >= sheet.top;

  // 50px below the tip is the mocked drop. Where that clips the file's corner
  // (Russian), the approach rises the least that clears it; past 30 the head
  // would point sideways, not up at the button, so there is no pointer.
  for (const drop of APPROACH_DROPS) {
    const c2y = y1 + drop;
    const along = (t: number): Point => {
      const u = 1 - t;
      return [
        u * u * u * x0 +
          3 * u * u * t * c1x +
          3 * u * t * t * c2x +
          t * t * t * x1,
        u * u * u * y0 +
          3 * u * u * t * c1y +
          3 * u * t * t * c2y +
          t * t * t * y1,
      ];
    };
    // The head follows the curve's last tangent: two arms 0.55 rad off it, 13px back from the tip.
    const ang = Math.atan2(y1 - c2y, x1 - c2x);
    const arm = (turn: number): Point => [
      x1 - 13 * Math.cos(ang + turn),
      y1 - 13 * Math.sin(ang + turn),
    ];
    const armA = arm(0.55),
      armB = arm(-0.55);
    const samples = Array.from({ length: 65 }, (_, i) => along(i / 64));
    if ([...samples, armA, armB].some(onSheet)) continue;
    const [ax, ay] = armA,
      [bx, by] = armB;
    return {
      line: `M${x0} ${y0} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${x1} ${y1}`,
      head: `M${ax} ${ay} Q ${(ax + x1) / 2 + 2} ${(ay + y1) / 2 - 1}, ${x1} ${y1} Q ${(bx + x1) / 2 - 1} ${(by + y1) / 2 + 2}, ${bx} ${by}`,
    };
  }
  return null;
}
