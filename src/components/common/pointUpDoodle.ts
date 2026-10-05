// KAN-411. The pin guide's hand-drawn up arrow, in its own viewBox units.
export const POINT_UP_DOODLE = {
  viewWidth: 60,
  viewHeight: 100,
  tip: { x: 31, y: 11 },
} as const;

// The tip's distance from the drawn box's left edge, for the default "meet" fit.
export function doodleTipFromLeft(width: number, height: number): number {
  const { viewWidth, viewHeight, tip } = POINT_UP_DOODLE;
  const scale = Math.min(width / viewWidth, height / viewHeight);
  return (width - viewWidth * scale) / 2 + tip.x * scale;
}
