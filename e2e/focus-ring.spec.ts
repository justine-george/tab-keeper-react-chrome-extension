import type { Locator, Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { saveRowMenu } from './fixtures/menus';
import { seedSettings } from './fixtures/seed';
import {
  BB_PINK_THEME,
  BLUE_THEME,
  DARKENHEIMER_THEME,
  LIGHT_THEME,
  WARM_LIGHT_THEME,
} from '../src/hooks/useThemeColors';

// KAN-405 on the real artifact: what jsdom cannot show -- Chrome's own
// :focus-visible heuristic, and the ring it paints.

const POPUP = { width: 790, height: 550 };

const THEMES = [
  ['Light', LIGHT_THEME],
  ['WarmLight', WARM_LIGHT_THEME],
  ['BBPink', BB_PINK_THEME],
  ['Darkenheimer', DARKENHEIMER_THEME],
  ['Blue', BLUE_THEME],
] as const;

const rgb = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `rgb(${r}, ${g}, ${b})`;
};

async function openPopup(
  context: Parameters<typeof seedSettings>[0],
  extensionId: string,
  theme = 'Light'
): Promise<Page> {
  await seedSettings(context, { theme });
  const page = await context.newPage();
  await page.setViewportSize(POPUP);
  await page.goto(`chrome-extension://${extensionId}/index.html`);
  await expect(saveRowMenu(page)).toBeVisible();
  return page;
}

const ringOf = (loc: Locator) =>
  loc.evaluate((el) => {
    const s = getComputedStyle(el);
    return {
      focused: el === document.activeElement,
      visible: el.matches(':focus-visible'),
      outline: `${s.outlineStyle} ${s.outlineWidth} ${s.outlineColor}`,
      offset: s.outlineOffset,
    };
  });

const saveButton = (page: Page) => page.locator('div:has(> input#name) button');

for (const [theme, colors] of THEMES) {
  test(`Tab paints the themed ring on the save button and ⋮ (${theme})`, async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId, theme);
    await page.locator('input#name').focus();

    await page.keyboard.press('Tab');
    expect(await ringOf(saveButton(page))).toEqual({
      focused: true,
      visible: true,
      outline: `solid 2px ${rgb(colors.TEXT_COLOR)}`,
      offset: '-4px',
    });

    await page.keyboard.press('Tab');
    expect(await ringOf(saveRowMenu(page))).toEqual({
      focused: true,
      visible: true,
      outline: `solid 2px ${rgb(colors.TEXT_COLOR)}`,
      offset: '-4px',
    });
  });
}

test.describe('Esc after the ⋮ menu', () => {
  test('opened with a click: focus on ⋮, no ring; the next keys bring it back', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId);
    await saveRowMenu(page).click();
    await expect(page.getByRole('menu')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
    const after = await ringOf(saveRowMenu(page));
    expect(after.focused).toBe(true);
    expect(after.visible).toBe(false);
    expect(after.outline.startsWith('none')).toBe(true);

    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    expect(await ringOf(saveRowMenu(page))).toMatchObject({
      focused: true,
      visible: true,
    });
  });

  test('opened with Enter: focus on ⋮, with the ring', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId);
    await page.locator('input#name').focus();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('menu')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
    expect(await ringOf(saveRowMenu(page))).toEqual({
      focused: true,
      visible: true,
      outline: `solid 2px ${rgb(LIGHT_THEME.TEXT_COLOR)}`,
      offset: '-4px',
    });
  });
});
