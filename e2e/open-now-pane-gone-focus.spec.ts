import type { Page } from '@playwright/test';

import { grantedTest as test, expect } from './fixtures/grantedExtension';
import { seedSessions, seedSettings } from './fixtures/seed';

// KAN-928. The pane going without a button press took focus to the page. It
// goes to the rail's button, as a press does.
const OPEN_NOW = '[data-pane="open-now"]';
const FULL = 'index.html?view=tab';

async function openWide(page: Page, extensionId: string) {
  await page.setViewportSize({ width: 1400, height: 700 });
  await page.goto(`chrome-extension://${extensionId}/${FULL}`);
  await page.locator('[data-tour-anchor="save"]').waitFor();
}

const rail = (page: Page) =>
  page.getByRole('button', { name: /^Currently open/ });

test('narrowing the window hands focus to the rail', async ({
  context,
  extensionId,
}) => {
  await seedSettings(context, { foldSavedSessionInTabView: false });
  await seedSessions(context);
  const page = await context.newPage();
  await openWide(page, extensionId);
  await page.locator(`${OPEN_NOW} button`).first().focus();

  await page.setViewportSize({ width: 1000, height: 700 });

  await expect(rail(page)).toBeFocused();
});

test('a fold from another page hands focus to the rail', async ({
  context,
  extensionId,
}) => {
  await seedSettings(context, { foldSavedSessionInTabView: false });
  await seedSessions(context);
  const page = await context.newPage();
  await openWide(page, extensionId);
  await page.locator(`${OPEN_NOW} button`).first().focus();

  const other = await context.newPage();
  await openWide(other, extensionId);
  await other
    .getByRole('button', { name: 'Fold the Currently open panel away' })
    .first()
    .click();

  await expect(page.locator(OPEN_NOW)).toHaveCount(1);
  await expect(rail(page)).toBeFocused();
});

test('CONTROL: focus elsewhere stays put when the pane goes', async ({
  context,
  extensionId,
}) => {
  await seedSettings(context, { foldSavedSessionInTabView: false });
  await seedSessions(context);
  const page = await context.newPage();
  await openWide(page, extensionId);
  const outside = page.locator('[data-pane="sessions"] button').first();
  await outside.focus();

  await page.setViewportSize({ width: 1000, height: 700 });

  await expect(rail(page)).toHaveCount(1);
  await expect(outside).toBeFocused();
});
