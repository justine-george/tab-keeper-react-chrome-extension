import type { Locator, Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { seedSessions, seedSettings } from './fixtures/seed';
import { waitForFontsLoaded } from './fixtures/fonts';
import { pixelsAt } from './fixtures/pixels';
import {
  CHALK_THEME,
  CHARCOAL_THEME,
} from '../src/utils/constants/themePalettes';

// KAN-773. Settings' Back answered a hover with nothing. Justine's pick E: the
// icon buttons' hover fill, drawn 8px inside the click area so it lines up
// with the category tiles and stays off the page's top and left edges, and
// the arrow eases 3px left. The click area itself is KAN-240's, unchanged
// (back-target.spec).

const THEMES = [
  ['Chalk', CHALK_THEME],
  ['Charcoal', CHARCOAL_THEME],
] as const;

async function openSettings(
  context: Parameters<typeof seedSessions>[0],
  extensionId: string,
  theme: string
): Promise<Page> {
  await seedSessions(context);
  await seedSettings(context, { theme });
  const page = await context.newPage();
  await page.setViewportSize({ width: 790, height: 550 });
  await page.goto(`chrome-extension://${extensionId}/index.html`);
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByText('Themes')).toBeVisible();
  await waitForFontsLoaded(page);
  await page.mouse.move(400, 540);
  return page;
}

const back = (page: Page): Locator =>
  page.getByRole('button', { name: 'Go back' });

async function boxOf(locator: Locator) {
  const box = await locator.boundingBox();
  if (box === null) throw new Error(`no box for ${locator.toString()}`);
  return box;
}

/**
 * Four points in the click area, clear of the glyph's and label's ink: two
 * 2px inside the fill's corners, two 3px inside the click area's corners,
 * where the fill must not reach.
 */
function probes(box: { x: number; y: number; width: number; height: number }) {
  const inside: Array<[number, number]> = [
    [box.x + 10, box.y + 10],
    [box.x + box.width - 10, box.y + box.height - 10],
  ];
  const outside: Array<[number, number]> = [
    [box.x + 3, box.y + 3],
    [box.x + box.width - 3, box.y + box.height - 3],
  ];
  return { inside, outside };
}

/** The glyph's horizontal offset, from `translate` and `transform` together. */
const glyphX = (page: Page) =>
  back(page)
    .locator('.material-symbols-outlined')
    .evaluate((el) => {
      const cs = getComputedStyle(el);
      const t = cs.translate === 'none' ? 0 : parseFloat(cs.translate);
      const m = cs.transform === 'none' ? null : new DOMMatrix(cs.transform);
      return t + (m ? m.e : 0);
    });

for (const [theme, COLORS] of THEMES) {
  test(`${theme}: the hover fill sits 8px inside the click area, and deepens on press`, async ({
    context,
    extensionId,
  }) => {
    const page = await openSettings(context, extensionId, theme);
    const box = await boxOf(back(page));
    const { inside, outside } = probes(box);
    const rest = await pixelsAt(page, [...inside, ...outside]);
    // CONTROL: at rest the fill's spots aren't already the hover grey.
    expect(rest[0]).not.toBe(COLORS.ICON_HOVER_COLOR);

    // On the lower padding: in the click area, below the fill.
    await page.mouse.move(box.x + box.width / 2, box.y + box.height - 4);
    await expect
      .poll(() => pixelsAt(page, [...inside, ...outside]))
      .toEqual([
        COLORS.ICON_HOVER_COLOR,
        COLORS.ICON_HOVER_COLOR,
        rest[2],
        rest[3],
      ]);

    await page.mouse.down();
    await expect
      .poll(() => pixelsAt(page, inside))
      .toEqual([COLORS.ICON_ACTIVE_COLOR, COLORS.ICON_ACTIVE_COLOR]);

    // Released off the control, so nothing clicks.
    await page.mouse.move(400, 540);
    await page.mouse.up();
    await expect.poll(() => pixelsAt(page, inside)).toEqual(rest.slice(0, 2));
    await expect(page.getByText('Themes')).toBeVisible();
  });
}

test('the arrow eases 3px left on hover and back when the pointer leaves', async ({
  context,
  extensionId,
}) => {
  const page = await openSettings(context, extensionId, 'Chalk');
  expect(await glyphX(page)).toBe(0);

  await back(page).hover();
  await expect.poll(() => glyphX(page)).toBeCloseTo(-3, 2);

  await page.mouse.move(400, 540);
  await expect.poll(() => glyphX(page)).toBeCloseTo(0, 2);
});

test('with reduced motion the arrow stays still, and the fill still answers', async ({
  context,
  extensionId,
}) => {
  const page = await openSettings(context, extensionId, 'Chalk');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const { inside } = probes(await boxOf(back(page)));

  await back(page).hover();

  await expect
    .poll(() => pixelsAt(page, inside))
    .toEqual([CHALK_THEME.ICON_HOVER_COLOR, CHALK_THEME.ICON_HOVER_COLOR]);
  expect(await glyphX(page)).toBe(0);
});

test('reaching Back from the keyboard moves nothing', async ({
  context,
  extensionId,
}) => {
  const page = await openSettings(context, extensionId, 'Chalk');
  await back(page).focus();
  await expect(back(page)).toBeFocused();

  await page.waitForTimeout(400);
  expect(await glyphX(page)).toBe(0);
});
