import type { Locator, Page } from '@playwright/test';
import { contrast } from '../../src/tests/setup/contrast';

// Painted-colour helpers for specs that must assert on what the popup DRAWS,
// not on a token or a computed style (KAN-188). A token can arrive and still
// never reach the paint; only pixels can tell.

export { contrast };
export { channels, rgb } from '../../src/tests/setup/hexColor';

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

/**
 * A field's `::placeholder` colour and opacity, and the first opaque background
 * from the field outwards (what is painted behind it), colours as `#RRGGBB`.
 */
export async function placeholderPaint(field: Locator): Promise<{
  placeholder: string;
  opacity: string;
  ground: string;
  ratio: number;
}> {
  const measured = await field.evaluate((el) => {
    let ground = '';
    for (let n: Element | null = el; n; n = n.parentElement) {
      const bg = getComputedStyle(n).backgroundColor;
      if (!/rgba\(.*, 0\)$|transparent/.test(bg)) {
        ground = bg;
        break;
      }
    }
    const style = getComputedStyle(el, '::placeholder');
    return { placeholder: style.color, opacity: style.opacity, ground };
  });
  const placeholder = rgbToHex(measured.placeholder);
  const ground = rgbToHex(measured.ground);
  return {
    placeholder,
    opacity: measured.opacity,
    ground,
    ratio: contrast(placeholder, ground),
  };
}

/**
 * The pixels where two same-size PNGs differ, as [x, y] from their top-left:
 * by more than `tolerance` in some channel (glyph anti-aliasing can move 1).
 */
export function differingPixels(
  page: Page,
  a: Buffer,
  b: Buffer,
  tolerance = 0
): Promise<Array<[number, number]>> {
  return page.evaluate(
    async ({ a, b, tolerance }) => {
      const read = async (png: string) => {
        const img = new Image();
        img.src = `data:image/png;base64,${png}`;
        await img.decode();
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) throw new Error('no 2d context');
        ctx.drawImage(img, 0, 0);
        return ctx.getImageData(0, 0, img.width, img.height);
      };
      const [first, second] = [await read(a), await read(b)];
      if (first.width !== second.width || first.height !== second.height)
        throw new Error('the two images differ in size');
      const found: Array<[number, number]> = [];
      for (let i = 0; i < first.data.length; i += 4) {
        const differs = [0, 1, 2].some(
          (c) => Math.abs(first.data[i + c] - second.data[i + c]) > tolerance
        );
        if (differs) {
          const px = i / 4;
          found.push([px % first.width, Math.floor(px / first.width)]);
        }
      }
      return found;
    },
    { a: a.toString('base64'), b: b.toString('base64'), tolerance }
  );
}
