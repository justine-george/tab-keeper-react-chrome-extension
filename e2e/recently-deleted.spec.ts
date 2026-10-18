import type { BrowserContext, Locator, Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { buildSession, seedSettings } from './fixtures/seed';
import { seedOnce } from './fixtures/cloud';
import { POPUP, stored } from './fixtures/savedWindows';

// KAN-595 on the real artifact: a deleted session waits in Settings →
// Recently deleted, Restore puts it back on top, selected, and Empty asks
// first. No cloud: the two-device half is recently-deleted-two-devices.spec.

const DAY = 86_400_000;
const SESSIONS = ['Alpha', 'Bravo', 'Charlie'].map((t, i) =>
  buildSession({
    tabGroupId: `s-${t.toLowerCase()}`,
    title: t,
    createdAt: Date.UTC(2026, 8, 1, 9 - i, 0, 0),
  })
);

async function openPage(
  context: BrowserContext,
  extensionId: string,
  query = ''
): Promise<Page> {
  const page = await context.newPage();
  await page.setViewportSize(POPUP);
  await page.goto(`chrome-extension://${extensionId}/index.html${query}`);
  // Barrier: goto resolves before React mounts. Locale-free.
  await page.locator('[data-tour-anchor="save"]').waitFor();
  return page;
}

const row = (page: Page, title: string): Locator =>
  page
    .locator('[data-pane="sessions"]')
    .getByRole('button', { name: title, exact: true });

const deletedRows = (page: Page): Locator =>
  page.getByTestId('recently-deleted-row');

async function openRecentlyDeleted(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Settings' }).click();
  await page
    .getByRole('button', { name: 'Recently deleted', exact: true })
    .click();
  await expect(
    page.getByText(
      'Sessions deleted on this device are kept for 30 days, then permanently deleted.'
    )
  ).toBeVisible();
}

// Focused, not clicked: Delete acts on the focused row (KAN-592), and a click would
// select it, which the selected row's drawn actions keep Playwright from finishing.
async function deleteByKey(page: Page, title: string): Promise<void> {
  await row(page, title).focus();
  await page.keyboard.press('Delete');
  await expect(row(page, title)).toHaveCount(0);
}

test.beforeEach(async ({ context }) => {
  await seedOnce(context, SESSIONS);
});

test('a deleted session is listed, and Restore puts it back on top, selected', async ({
  context,
  extensionId,
}) => {
  const page = await openPage(context, extensionId);
  await deleteByKey(page, 'Charlie');

  await openRecentlyDeleted(page);
  await expect(deletedRows(page)).toHaveCount(1);
  await expect(deletedRows(page)).toContainText('Charlie');
  await expect(deletedRows(page)).toContainText('1 tab · Deleted today');

  await page.getByRole('button', { name: 'Restore Charlie' }).click();
  await expect(page.getByRole('status')).toContainText('Session restored.');
  await expect(
    page.getByText('No sessions deleted in the last 30 days.')
  ).toBeVisible();

  const after = await stored(page);
  expect(after.tabGroups.map((g) => g.tabGroupId)).toEqual([
    's-charlie',
    's-alpha',
    's-bravo',
  ]);
  expect(after.selectedTabGroupId).toBe('s-charlie');
  expect(
    (after.deletedTabGroups ?? []).some((g) => g.tabGroupId === 's-charlie')
  ).toBe(false);
});

test('an undone delete is not listed', async ({ context, extensionId }) => {
  const page = await openPage(context, extensionId);
  await deleteByKey(page, 'Bravo');
  await page.keyboard.press('ControlOrMeta+z');
  await expect(row(page, 'Bravo')).toHaveCount(1);

  await openRecentlyDeleted(page);
  await expect(
    page.getByText('No sessions deleted in the last 30 days.')
  ).toBeVisible();
});

test('a delete in the popup appears on the full view already open on the page', async ({
  context,
  extensionId,
}) => {
  const full = await openPage(context, extensionId, '?view=tab');
  await openRecentlyDeleted(full);
  await expect(
    full.getByText('No sessions deleted in the last 30 days.')
  ).toBeVisible();

  const popup = await openPage(context, extensionId);
  await deleteByKey(popup, 'Charlie');

  await expect(deletedRows(full)).toHaveCount(1);
  await expect(deletedRows(full)).toContainText('Charlie');
});

test('Empty asks first, then deletes them all for good', async ({
  context,
  extensionId,
}) => {
  const page = await openPage(context, extensionId);
  await deleteByKey(page, 'Bravo');
  await deleteByKey(page, 'Charlie');
  await openRecentlyDeleted(page);
  await expect(deletedRows(page)).toHaveCount(2);

  await page.getByRole('button', { name: 'Empty', exact: true }).click();
  const dialog = page.getByRole('dialog', {
    name: 'Permanently delete 2 sessions?',
  });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(deletedRows(page)).toHaveCount(2);

  await page.getByRole('button', { name: 'Empty', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Delete', exact: true })
    .click();
  await expect(
    page.getByText('No sessions deleted in the last 30 days.')
  ).toBeVisible();
  expect(
    await page.evaluate(
      async () =>
        (await chrome.storage.local.get('recentlyDeleted')).recentlyDeleted
    )
  ).toBeUndefined();
});

test('the last week counts down, and past 30 days a session is gone', async ({
  context,
  extensionId,
}) => {
  const page = await openPage(context, extensionId);
  await openRecentlyDeleted(page);
  await page.evaluate(
    async ({ old, older, day }) => {
      const now = Date.now();
      await chrome.storage.local.set({
        recentlyDeleted: [
          { session: old, deletedAt: now - 27 * day },
          { session: older, deletedAt: now - 31 * day },
        ],
      });
    },
    {
      old: buildSession({ tabGroupId: 'old', title: 'Lisbon trip' }),
      older: buildSession({ tabGroupId: 'older', title: 'Tax documents' }),
      day: DAY,
    }
  );
  await expect(deletedRows(page)).toHaveCount(1);
  await expect(deletedRows(page)).toContainText('Lisbon trip');
  await expect(deletedRows(page)).toContainText('· 3 days left');
});

// KAN-683. Empty shared its row with the description, and flex shrank it below
// the 8rem the Restore buttons under it keep: its left edge sat right of theirs.
// Italian's description is the longest; it must still sit beside Empty, whole.
for (const [language, settings, recent, empty, restore, about] of [
  [
    'en',
    'Settings',
    'Recently deleted',
    'Empty',
    'Restore Charlie',
    'Sessions deleted on this device are kept for 30 days, then permanently deleted.',
  ],
  [
    'de',
    'Einstellungen',
    'Zuletzt gelöscht',
    'Leeren',
    'Charlie wiederherstellen',
    'Auf diesem Gerät gelöschte Sitzungen werden 30 Tage aufbewahrt und dann endgültig gelöscht.',
  ],
  [
    'it',
    'Impostazioni',
    'Eliminati di recente',
    'Svuota',
    'Ripristina Charlie',
    'Le sessioni eliminate su questo dispositivo vengono conservate per 30 giorni, poi eliminate definitivamente.',
  ],
] as const) {
  test(`${language}: Empty is as wide as Restore and lines up with it`, async ({
    context,
    extensionId,
  }) => {
    await seedSettings(context, { language });
    const page = await openPage(context, extensionId);
    await deleteByKey(page, 'Charlie');
    await page.getByRole('button', { name: settings }).click();
    await page.getByRole('button', { name: recent, exact: true }).click();
    const emptyBox = await page
      .getByRole('button', { name: empty, exact: true })
      .boundingBox();
    const restoreBox = await page
      .getByRole('button', { name: restore, exact: true })
      .boundingBox();
    const text = page.getByText(about, { exact: true });
    const textBox = await text.boundingBox();
    if (emptyBox === null || restoreBox === null || textBox === null)
      throw new Error('a box is missing');

    expect(Math.abs(emptyBox.width - restoreBox.width)).toBeLessThan(0.5);
    expect(Math.abs(emptyBox.x - restoreBox.x)).toBeLessThan(0.5);
    // The description wraps beside Empty instead: left of it, and not cut off.
    expect(textBox.x + textBox.width).toBeLessThanOrEqual(emptyBox.x);
    expect(await text.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
      true
    );
  });
}
