// KAN-901, KAN-908. clip-path's path() has no squircle, and an arc of the same
// radius is rounder, so a squircle is traced as line-tos.

// Points per corner; at a 12px corner each is within 0.02px of the curve.
const CORNER_STEPS = 16;
const at = (n: number): number => Number(n.toFixed(3));

/**
 * One quarter of a CSS squircle (superellipse(2): |x|^4 + |y|^4 = k^4) round
 * (cx, cy), from angle `from` a quarter turn on, as line-tos.
 */
export function squircleCorner(
  cx: number,
  cy: number,
  k: number,
  from: number
): string {
  let out = '';
  for (let i = 1; i <= CORNER_STEPS; i++) {
    const angle = from + (i / CORNER_STEPS) * (Math.PI / 2);
    const [c, s] = [Math.cos(angle), Math.sin(angle)];
    out += `L${at(cx + k * Math.sign(c) * Math.sqrt(Math.abs(c)))} ${at(
      cy + k * Math.sign(s) * Math.sqrt(Math.abs(s))
    )}`;
  }
  return out;
}

/**
 * A box's outline with squircle corners of `radius` px (capped at half its
 * height and width), as path data. Every box gets the same commands, so two
 * of them interpolate as a transition.
 */
export function squircleRect(
  box: { left: number; top: number; right: number; bottom: number },
  radius: number
): string {
  const { left: l, top: t, right: r, bottom: b } = box;
  const k = Math.max(0, Math.min(radius, (b - t) / 2, (r - l) / 2));
  return (
    `M${at(l + k)} ${at(t)}H${at(r - k)}${squircleCorner(r - k, t + k, k, -Math.PI / 2)}` +
    `V${at(b - k)}${squircleCorner(r - k, b - k, k, 0)}` +
    `H${at(l + k)}${squircleCorner(l + k, b - k, k, Math.PI / 2)}` +
    `V${at(t + k)}${squircleCorner(l + k, t + k, k, Math.PI)}Z`
  );
}
