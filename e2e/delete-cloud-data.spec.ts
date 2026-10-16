import type { Page } from '@playwright/test';

import { hasCloudConfig } from './fixtures/cloud';
import { test, expect } from './fixtures/extension';
import { buildContainer, seedSessions } from './fixtures/seed';

// KAN-254. "Delete cloud data" on Sync & Backup opens a confirm dialog; Cancel
// and Escape close it with nothing changed. The confirm path runs against the
// dev cloud below, and skips in CI, which builds without one (KAN-147).

test.describe('Delete cloud data asks before it acts (KAN-254)', () => {
  test('the button opens a real dialog; Cancel and Escape close it, auto sync untouched', async ({
    context,
    extensionId,
  }) => {
    await seedSessions(context, buildContainer());
    const page = await context.newPage();
    await page.setViewportSize({ width: 790, height: 550 });
    await page.goto(`chrome-extension://${extensionId}/index.html`);
    await page.locator('[aria-label="Settings"]').click();
    await page.locator('button[aria-label="Sync & Backup"]').click();

    const button = page.getByRole('button', { name: 'Delete cloud data' });
    await expect(button).toBeVisible();
    await button.click();

    const dialog = page.getByRole('dialog', {
      name: 'Delete your cloud data?',
    });
    await expect(dialog).toBeVisible();
    // Modal: showModal() put it in the top layer.
    expect(await dialog.evaluate((el) => (el as HTMLDialogElement).open)).toBe(
      true
    );
    // Focus landed on Cancel, the action that changes nothing.
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();

    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toHaveCount(0);

    await button.click();
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);

    const on = page
      .getByRole('group', { name: 'Auto Sync' })
      .getByRole('button', { name: 'On' });
    await expect(on).toHaveAttribute('aria-pressed', 'true');
  });
});

const COMMIT = /firestore\.googleapis\.com\/.*documents:commit/;

async function openSyncPane(page: Page, extensionId: string): Promise<void> {
  await page.goto(`chrome-extension://${extensionId}/index.html`);
  await page.locator('[aria-label="Settings"]').click();
  await page.locator('button[aria-label="Sync & Backup"]').click();
}

// KAN-632. The delete took Auto Sync off but kept the cloud yes, so the pane
// read "Manual sync" with the sync bar, and one cloud-button press wrote
// everything back unasked. Now it reads like a device that never said yes.
test.describe('after Delete cloud data, sync is off (KAN-632)', () => {
  test.use({ cloud: true });

  test('no sync bar, the state survives a reopen, and the cloud button asks before writing', async ({
    context,
    extensionId,
  }) => {
    test.skip(!hasCloudConfig(), 'this build has no cloud config (CI)');
    const commits: string[] = [];
    await context.route(COMMIT, async (route) => {
      commits.push(route.request().url());
      await route.continue();
    });
    await seedSessions(context, buildContainer());
    const page = await context.newPage();
    await page.setViewportSize({ width: 790, height: 550 });
    await openSyncPane(page, extensionId);

    const status = page.getByTestId('sync-status');
    // PREMISE: a real sync reached the cloud, and the pane shows the bar.
    await expect
      .poll(() => commits.length, { timeout: 20_000 })
      .toBeGreaterThan(0);
    await expect(status).toHaveAttribute('data-sync-state', 'on', {
      timeout: 20_000,
    });
    await expect(page.getByTestId('sync-space')).toBeVisible();

    await page.getByRole('button', { name: 'Delete cloud data' }).click();
    await page
      .getByRole('dialog', { name: 'Delete your cloud data?' })
      .getByRole('button', { name: 'Delete', exact: true })
      .click();

    await expect(
      page.getByText('Cloud data deleted. Sync is off on this device.')
    ).toBeVisible({ timeout: 20_000 });
    await expect(status).toHaveAttribute('data-sync-state', 'off');
    await expect(status).toContainText('Sync is off');
    await expect(page.getByTestId('sync-space')).toHaveCount(0);

    // Reopened: the answer was stored, not just shown.
    await openSyncPane(page, extensionId);
    await expect(status).toHaveAttribute('data-sync-state', 'off');
    await expect(page.getByTestId('sync-space')).toHaveCount(0);

    // The home cloud button asks; it does not write.
    await page.goto(`chrome-extension://${extensionId}/index.html`);
    const before = commits.length;
    await page.getByRole('button', { name: 'Sync now', exact: true }).click();
    const ask = page.getByRole('dialog', {
      name: 'Sync your sessions across devices?',
    });
    await expect(ask).toBeVisible();
    await page.waitForTimeout(1500);
    expect(commits.length).toBe(before);
    await ask.getByRole('button', { name: 'Not now', exact: true }).click();
    await expect(ask).toHaveCount(0);
  });
});
