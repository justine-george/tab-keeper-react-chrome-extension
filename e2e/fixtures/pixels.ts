import type { Page } from '@playwright/test';

// Painted-colour helpers for specs that must assert on what the popup DRAWS,
// not on a token or a computed style (KAN-188). A token can arrive and still
// never reach the paint; only pixels can tell.

/** Relative luminance of a `#RRGGBB` colour, per WCAG 2.x. */
export function luminance(hex: string): number {
  const channels = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) =>
      v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
    );
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

/** WCAG contrast ratio between two `#RRGGBB` colours, always >= 1. */
export function contrast(a: string, b: string): number {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (lighter + 0.05) / (darker + 0.05);
}

/** A computed `rgb(...)` / `rgba(...)` string as `#RRGGBB`, alpha dropped. */
export function rgbToHex(rgb: string): string {
  return (
    '#' +
    (rgb.match(/\d+/g) ?? [])
      .slice(0, 3)
      .map((v) => Number(v).toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase()
  );
}

/**
 * Reads the painted colour at each viewport point from ONE fresh screenshot,
 * as `#RRGGBB`.
 *
 * Decoded in the page through a canvas, so no image library is needed. Any
 * spec using this should also sample a point whose colour it already knows
 * (a row's computed fill) and assert they match: that is the control that the
 * decode is faithful before a ratio built on it is trusted.
 */
export async function pixelsAt(
  page: Page,
  points: Array<[number, number]>
): Promise<string[]> {
  const png = (await page.screenshot()).toString('base64');
  return page.evaluate(
    async ({ png, points }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${png}`;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error('no 2d context');
      ctx.drawImage(img, 0, 0);
      return points.map(([x, y]) => {
        const [r, g, b] = ctx.getImageData(
          Math.round(x),
          Math.round(y),
          1,
          1
        ).data;
        return (
          '#' +
          [r, g, b]
            .map((v) => v.toString(16).padStart(2, '0'))
            .join('')
            .toUpperCase()
        );
      });
    },
    { png, points }
  );
}
