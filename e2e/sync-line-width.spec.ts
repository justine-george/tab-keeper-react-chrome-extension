import { test, expect } from './fixtures/extension';
import {
  buildContainer,
  buildSession,
  seedSessions,
  seedSettings,
} from './fixtures/seed';

// KAN-650. In a wide full view the Sync Status sentence ran the whole pane in one line, where every
// other Settings help line stops at a reading width. It now stops there too; the size bar's meter
// and its sentence stay one 280px block (his pick A).

// One session whose single tab's address carries `pad` extra characters.
function padded(pad: number) {
  const base = buildSession({ tabGroupId: 'big' });
  const tab = base.windows[0].tabs[0];
  return buildContainer([
    {
      ...base,
      windows: [
        {
          ...base.windows[0],
          tabs: [{ ...tab, url: `${tab.url}${'a'.repeat(pad)}` }],
        },
      ],
    },
  ]);
}

test('in a wide full view the sync sentence stops at the help lines’ reading width', async ({
  context,
  extensionId,
}) => {
  // Sync off near the limit: the long sentence and the bar, as in the report.
  await seedSessions(context, padded(900_000));
  await seedSettings(context, { isAutoSync: false, cloudConsent: 'declined' });
  const page = await context.newPage();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`chrome-extension://${extensionId}/index.html?view=tab`);
  await page.locator('[aria-label="Settings"]').click();

  await page.locator('button[aria-label="Sessions"]').click();
  // The Default save help line (the tab-history one left with KAN-663).
  const helpLine = page.getByText('Used by the save button and the Enter key', {
    exact: false,
  });
  const readingWidth = await helpLine.evaluate(
    (el) => getComputedStyle(el).maxWidth
  );
  // Premise: the help line has a cap in px, not 'none' or a percentage.
  expect(readingWidth).toMatch(/^\d+(\.\d+)?px$/);

  await page.locator('button[aria-label="Sync & backup"]').click();
  const status = page.getByTestId('sync-status');
  await expect(status).toHaveAttribute('data-sync-state', 'off');
  const line = status.locator('[data-sync-line]');
  await expect(line).toContainText('Your sessions stay on this device.');

  // Premise: the pane is wider than the reading width, so a missing cap would show.
  const pane = await status.boundingBox();
  expect(pane?.width ?? 0).toBeGreaterThan(parseFloat(readingWidth) + 100);

  expect(await line.evaluate((el) => getComputedStyle(el).maxWidth)).toBe(
    readingWidth
  );
  const box = await line.boundingBox();
  expect(box?.width ?? Infinity).toBeLessThanOrEqual(parseFloat(readingWidth));

  // The bar keeps its own width: meter and sentence both 280px.
  const bar = page.getByTestId('sync-space');
  await expect(bar).toHaveAttribute('data-level', 'near');
  expect((await bar.getByRole('meter').boundingBox())?.width).toBe(280);
  expect((await bar.locator('p').boundingBox())?.width).toBe(280);
});
