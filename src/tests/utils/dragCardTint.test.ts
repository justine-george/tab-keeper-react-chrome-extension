import { describe, expect, test } from 'vitest';

import { BB_PINK_THEME } from '../../hooks/useThemeColors';
import { luminance } from '../setup/contrast';

// OKLCH chroma of a `#RRGGBB` colour (Björn Ottosson's OKLab).
function chroma(hex: string): number {
  const [r, g, b] = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808631316 * s;
  return Math.hypot(a, bb);
}

// KAN-376. PRIMARY_LIGHT paints only the drag card. Picked by eye: a light
// rose, still lighter than the page. #FDF6F8 (chroma 0.008) read white.
describe("Petal's drag card", () => {
  test('is tinted rose', () => {
    expect(chroma(BB_PINK_THEME.PRIMARY_LIGHT)).toBeGreaterThanOrEqual(0.012);
  });

  test('is lighter than the page', () => {
    expect(luminance(BB_PINK_THEME.PRIMARY_LIGHT)).toBeGreaterThan(
      luminance(BB_PINK_THEME.PRIMARY_COLOR)
    );
  });
});
