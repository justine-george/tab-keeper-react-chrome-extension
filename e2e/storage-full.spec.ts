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

const win = (id: string) => ({
  windowId: id,
  windowHeight: 1080,
  windowWidth: 1920,
  windowOffsetTop: 0,
  windowOffsetLeft: 0,
  tabCount: 1,
  title: `Window ${id}`,
  tabs: [
    {
      tabId: `${id}-t`,
      favicon: '',
      title: `Tab ${id}`,
      url: `https://${id}.test/`,
    },
  ],
});

// Alpha holds two windows, so a drop has something to move.
const WITH_WINDOWS = [
  {
    ...SESSIONS[0],
    windowCount: 2,
    tabCount: 2,
    windows: [win('w0'), win('w1')],
  },
  SESSIONS[1],
];

async function openAlpha(page: Page, extensionId: string): Promise<void> {
  await page.setViewportSize(POPUP);
  await page.goto(`chrome-extension://${extensionId}/index.html`);
  // Barrier: goto resolves before React mounts. Locale-free.
  await page.locator('[data-tour-anchor="save"]').waitFor();
  // Focus + Enter, not a click: the selected row's drawn actions keep a click from finishing.
  await row(page, 'Alpha').focus();
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('button', { name: 'Rename session: Alpha', exact: true })
  ).toBeVisible();
}

async function renameAlphaRefused(page: Page): Promise<void> {
  expect(await fillStorage(page)).toBeGreaterThan(1_000_000);
  await expect(page.getByText(STORAGE_FULL)).toHaveCount(0);
  await page
    .getByRole('button', { name: 'Rename session: Alpha', exact: true })
    .click();
  await page.locator('input:focus').fill('Alpha, renamed longer');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('status')).toContainText(STORAGE_FULL);
}

const windowOrder = (page: Page) =>
  page
    .locator('[data-drag-row-id^="w"]')
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-drag-row-id')));

test.beforeEach(async ({ context }) => {
  await seedOnce(context, WITH_WINDOWS);
});

// A drop re-reads localStorage before it moves (dropOnTop). With the last save
// refused, that copy is older than the page, and taking it undid the rename.
test('a drop after a refused save keeps the change', async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage();
  await openAlpha(page, extensionId);
  await renameAlphaRefused(page);
  expect(await windowOrder(page)).toEqual(['w0', 'w1']);

  const from = await page.locator('[data-drag-row-id="w1"]').boundingBox();
  const to = await page.locator('[data-drag-row-id="w0"]').boundingBox();
  if (from === null || to === null) throw new Error('window rows not drawn');
  const x = from.x + 60;
  await page.mouse.move(x, from.y + from.height / 2);
  await page.mouse.down();
  // Past the activation distance, then above the first window.
  await page.mouse.move(x, from.y + from.height / 2 - 10, { steps: 3 });
  await page.mouse.move(x, to.y + 2, { steps: 12 });
  await page.mouse.up();

  // The premise: the drop moved the windows.
  await expect.poll(() => windowOrder(page)).toEqual(['w1', 'w0']);
  await expect(row(page, 'Alpha, renamed longer')).toHaveCount(1);
});

test('a refused save shows the toast, and a delete makes room for it', async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage();
  await openAlpha(page, extensionId);
  await renameAlphaRefused(page);

  // On screen, not on disk, and the user is told.
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
