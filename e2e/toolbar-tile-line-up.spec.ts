// KAN-939 on the real build. The monochrome tile's icon and puzzle piece stand level, as they do in Chrome's toolbar:
// each is 15px tall there, measured from a 2x screenshot. Read from painted pixels, which an element's box cannot show.

import type { BrowserContext, Page } from '@playwright/test';
import { test, expect } from './fixtures/extension';
import { buildContainer, seedSessions, seedSettings } from './fixtures/seed';

test.use({ deviceScaleFactor: 2 });

interface Ink {
  top: number;
  bottom: number;
}

// The picture of a toolbar: the parent of its icon. Monochrome is the second.
const monochromeTile = (page: Page) =>
  page
    .getByRole('group', { name: 'Toolbar icon', exact: true })
    .locator('[data-toolbar-part="icon"]')
    .nth(1)
    .locator('..');

// Where a part's paint starts and ends, in CSS px, from a screenshot of the tile.
async function inkOf(
  page: Page,
  context: BrowserContext,
  extensionId: string,
  part: string
): Promise<Ink> {
  const tile = monochromeTile(page);
  const shot = (await tile.screenshot()).toString('base64');
  const box = await tile
    .locator(`[data-toolbar-part="${part}"]`)
    .evaluate((el) => {
      const r = el.getBoundingClientRect();
      const t = el.parentElement?.getBoundingClientRect();
      if (t === undefined) throw new Error('no tile');
      return { x: r.x - t.x, width: r.width };
    });
  const reader = await context.newPage();
  await reader.goto(`chrome-extension://${extensionId}/index.html?view=tab`);
  const ink = await reader.evaluate(
    async ({ shot, box }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${shot}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const draw = canvas.getContext('2d');
      if (draw === null) throw new Error('no canvas');
      draw.drawImage(image, 0, 0);
      const x = Math.round(box.x * 2);
      const width = Math.round(box.width * 2);
      const { data } = draw.getImageData(x, 0, width, image.height);
      // The tile's own ground, at the middle of its top third.
      const at = (Math.round(image.height / 3) * width + 1) * 4;
      const ground = [data[at], data[at + 1], data[at + 2]];
      const rows: number[] = [];
      for (let y = 8; y < image.height - 8; y += 1) {
        for (let i = 0; i < width; i += 1) {
          const p = (y * width + i) * 4;
          const away =
            Math.abs(data[p] - ground[0]) +
            Math.abs(data[p + 1] - ground[1]) +
            Math.abs(data[p + 2] - ground[2]);
          if (away > 90) {
            rows.push(y);
            break;
          }
        }
      }
      return { top: rows[0] / 2, bottom: (rows[rows.length - 1] + 1) / 2 };
    },
    { shot, box }
  );
  await reader.close();
  return ink;
}

for (const colorScheme of ['dark', 'light'] as const) {
  test(`${colorScheme}: the monochrome icon and the puzzle piece stand level`, async ({
    context,
    extensionId,
  }) => {
    await seedSessions(context, buildContainer());
    await seedSettings(context, {});
    const page = await context.newPage();
    await page.emulateMedia({ colorScheme });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`chrome-extension://${extensionId}/index.html?view=tab`);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    const tile = monochromeTile(page);
    await tile.scrollIntoViewIfNeeded();
    await expect(tile.locator('img')).toHaveJSProperty('complete', true);

    const icon = await inkOf(page, context, extensionId, 'icon');
    const puzzle = await inkOf(page, context, extensionId, 'puzzle');

    // PREMISE: the icon is the 15px KAN-938 draws.
    expect(icon.bottom - icon.top).toBe(15);
    expect(Math.abs(puzzle.top - icon.top)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(puzzle.bottom - icon.bottom)).toBeLessThanOrEqual(0.5);
  });
}
