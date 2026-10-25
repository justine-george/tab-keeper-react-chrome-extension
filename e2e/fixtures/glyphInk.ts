import type { Locator, Page } from '@playwright/test';

import { expect } from './extension';

// KAN-780. A save glyph is an <svg>; these name it and count its ink, since a broken path draws a blank square.

export const iconIn = (control: Locator) =>
  control.locator('[data-icon]').first();

/** Pixels of a glyph that differ from its own corner pixel (the ground) by more than 64 in some channel. */
export async function inkOf(page: Page, glyph: Locator): Promise<number> {
  const png = (await glyph.screenshot()).toString('base64');
  return page.evaluate(async (png) => {
    const img = new Image();
    img.src = `data:image/png;base64,${png}`;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(img, 0, 0);
    const { data } = ctx.getImageData(0, 0, img.width, img.height);
    let ink = 0;
    for (let i = 0; i < data.length; i += 4)
      if ([0, 1, 2].some((c) => Math.abs(data[i + c] - data[c]) > 64)) ink++;
    return ink;
  }, png);
}

export async function expectGlyph(page: Page, control: Locator, name: string) {
  const glyph = iconIn(control);
  await expect(glyph).toHaveAttribute('data-icon', name);
  // An svg, so a missing ligature cannot print the name as text.
  expect(await glyph.evaluate((el) => el.tagName.toLowerCase())).toBe('svg');
  const box = (await glyph.boundingBox())!;
  const ink = await inkOf(page, glyph);
  // A drawn outline covers roughly a fifth of its box; a blank square covers none.
  expect(ink, `${name} in "${await control.textContent()}"`).toBeGreaterThan(
    box.width * box.height * 0.1
  );
}
