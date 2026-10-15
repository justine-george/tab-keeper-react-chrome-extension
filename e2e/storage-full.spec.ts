import type { Locator, Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { buildSession } from './fixtures/seed';
import { seedOnce } from './fixtures/cloud';
import { POPUP, stored } from './fixtures/savedWindows';

// KAN-593 on the real artifact, against Chromium's real localStorage quota: a
// save the quota refuses says so, and deleting a session makes room for it.

const STORAGE_FULL =
  'Not saved: storage is full. Delete some sessions to make room.';

const SESSIONS = ['Alpha', 'Bravo'].map((t, i) =>
  buildSession({
    tabGroupId: `s-${t.toLowerCase()}`,
    title: t,
    createdAt: Date.UTC(2026, 8, 1, 9 - i, 0, 0),
  })
);

const row = (page: Page, title: string): Locator =>
  page
    .locator('[data-pane="sessions"]')
    .getByRole('button', { name: title, exact: true });

// The origin's storage, filled to the last character a filler key can take:
// any save that grows from here is refused.
const fillStorage = (page: Page): Promise<number> =>
  page.evaluate(() => {
    const fits = (n: number) => {
      try {
        localStorage.setItem('kan593-filler', 'x'.repeat(n));
        return true;
      } catch {
        return false;
      }
    };
    let lo = 0;
    let hi = 6_000_000;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (fits(mid)) lo = mid;
      else hi = mid - 1;
    }
    fits(lo);
    return lo;
  });

test.beforeEach(async ({ context }) => {
  await seedOnce(context, SESSIONS);
});

test('a refused save shows the toast, and a delete makes room for it', async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage();
  await page.setViewportSize(POPUP);
  await page.goto(`chrome-extension://${extensionId}/index.html`);
  // Barrier: goto resolves before React mounts. Locale-free.
  await page.locator('[data-tour-anchor="save"]').waitFor();
  await row(page, 'Alpha').click();

  expect(await fillStorage(page)).toBeGreaterThan(1_000_000);
  await expect(page.getByText(STORAGE_FULL)).toHaveCount(0);

  await page
    .getByRole('button', { name: 'Rename session: Alpha', exact: true })
    .click();
  await page.locator('input:focus').fill('Alpha, renamed longer');
  await page.keyboard.press('Enter');

  // On screen, not on disk, and the user is told.
  await expect(page.getByRole('status')).toContainText(STORAGE_FULL);
  await expect(row(page, 'Alpha, renamed longer')).toHaveCount(1);
  expect((await stored(page)).tabGroups.map((g) => g.title)).toEqual([
    'Alpha',
    'Bravo',
  ]);

  // The toast's remedy: a delete shrinks the save enough to land, and that
  // save carries the rename the full storage refused.
  await row(page, 'Bravo').focus();
  await page.keyboard.press('Delete');
  await expect(row(page, 'Bravo')).toHaveCount(0);
  expect((await stored(page)).tabGroups.map((g) => g.title)).toEqual([
    'Alpha, renamed longer',
  ]);

  await page.reload();
  await page.locator('[data-tour-anchor="save"]').waitFor();
  await expect(row(page, 'Alpha, renamed longer')).toHaveCount(1);
  await expect(row(page, 'Bravo')).toHaveCount(0);
});
