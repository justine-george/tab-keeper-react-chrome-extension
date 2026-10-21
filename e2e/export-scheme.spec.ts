import type { Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import {
  buildContainer,
  buildSession,
  seedSessions,
  seedSettings,
} from './fixtures/seed';
import { rgbToHex } from './fixtures/pixels';

// KAN-731. The export page opens in Chalk's colours from a light theme and
// Charcoal's from a dark one, and its file's ground is white or #18191a.
// Paper and Graphite are seeded with the move applied (seed.ts), so they stay themselves.

const SESSION = buildSession({ tabGroupId: 's-export', title: 'Export me' });

const CASES = [
  ['Chalk', '#FFFFFF', '#ffffff'],
  ['Light', '#FFFFFF', '#ffffff'],
  ['WarmLight', '#FFFFFF', '#ffffff'],
  ['BBPink', '#FFFFFF', '#ffffff'],
  ['Charcoal', '#18191A', '#18191a'],
  ['Darkenheimer', '#18191A', '#18191a'],
  ['Blue', '#18191A', '#18191a'],
] as const;

// The page's own ground and the preview file's --bg, as read once the page has drawn.
async function grounds(page: Page) {
  return {
    page: rgbToHex(
      await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
    ),
    file: await page
      .frameLocator('iframe')
      .locator('body')
      .evaluate((el) => getComputedStyle(el).getPropertyValue('--bg').trim()),
  };
}

for (const [theme, page, file] of CASES) {
  test(`from ${theme}, the export page's ground is ${page} and its file's --bg ${file}`, async ({
    context,
    extensionId,
  }) => {
    await seedSettings(context, { theme });
    await seedSessions(context, {
      ...buildContainer([SESSION]),
      selectedTabGroupId: 's-export',
    });
    const exportPage = await context.newPage();
    await exportPage.goto(
      `chrome-extension://${extensionId}/export.html?session=s-export`
    );
    // goto resolves before React mounts; Edit is drawn by the page.
    await expect(
      exportPage.getByRole('button', { name: 'Edit', exact: true })
    ).toBeVisible();
    await expect(
      exportPage.frameLocator('iframe').getByText('Export me')
    ).toBeVisible();

    await expect.poll(() => grounds(exportPage)).toEqual({ page, file });
    // CONTROL: the seed took; the export page never writes the theme.
    expect(
      await exportPage.evaluate(
        () => JSON.parse(localStorage.getItem('settingsData') ?? '{}').theme
      )
    ).toBe(theme);
  });
}
