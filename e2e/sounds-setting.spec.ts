import type { BrowserContext, Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { seedSettings } from './fixtures/seed';
import {
  THEMES,
  openPopup,
  pageGround,
  storedSettings,
} from './fixtures/onboarding';
import { expectReadable } from './fixtures/textContrast';

// Settings → Display → Sounds on the real build: under Themes, saved, and readable in every theme.

async function openDisplaySettings(
  context: BrowserContext,
  extensionId: string
): Promise<Page> {
  const page = await openPopup(context, extensionId);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Display', exact: true }).click();
  await expect(sounds(page)).toBeVisible();
  return page;
}
const sounds = (page: Page) =>
  page.getByRole('group', { name: 'Sounds', exact: true });
const side = (page: Page, name: 'On' | 'Off') =>
  sounds(page).getByRole('button', { name, exact: true });
const row = (page: Page) =>
  page.locator('[data-settings-section]', { has: sounds(page) });

test('Sounds sits under Themes, On by default; Off is saved and still Off after a reopen', async ({
  context,
  extensionId,
}) => {
  const page = await openDisplaySettings(context, extensionId);
  const labels = await page
    .locator('[data-settings-section] > div:first-child')
    .allTextContents();
  expect(labels.slice(0, 2)).toEqual(['Themes', 'Sounds']);
  await expect(row(page)).toContainText('Play sounds as you use Tab Keeper.');
  await expect(side(page, 'On')).toHaveAttribute('aria-pressed', 'true');
  await side(page, 'Off').click();
  await expect(side(page, 'Off')).toHaveAttribute('aria-pressed', 'true');
  expect((await storedSettings(page)).isUiSoundOn).toBe(false);
  await page.close();
  const again = await openDisplaySettings(context, extensionId);
  await expect(side(again, 'Off')).toHaveAttribute('aria-pressed', 'true');
});

for (const [theme, palette] of THEMES) {
  test(`${theme}: the Sounds row reads at 4.5:1`, async ({
    context,
    extensionId,
  }) => {
    await seedSettings(context, { theme });
    const page = await openDisplaySettings(context, extensionId);
    expect(await pageGround(page)).toBe(palette.PRIMARY_COLOR);
    await expectReadable(row(page), `${theme} Sounds`);
  });
}
