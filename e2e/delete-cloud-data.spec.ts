import type { Page, Worker } from '@playwright/test';

import {
  CLOUD,
  COMMIT,
  countCloudRequests,
  hasCloudConfig,
} from './fixtures/cloud';
import { test, expect } from './fixtures/extension';
import { buildContainer, seedSessions, seedSettings } from './fixtures/seed';

// KAN-254. "Delete cloud data" on Sync & Backup opens a confirm dialog; Cancel
// and Escape close it with nothing changed. The confirm path runs against the
// dev cloud below, and skips in CI, which builds without one (KAN-147).
// KAN-719. The press never confirms or claims a delete of nothing: no stored id
// says so before the dialog, and a granted device is checked before it asks.

const NOTHING_TO_DELETE = 'No cloud data to delete.';
const DELETE_FAILED =
  "Couldn't delete cloud data. Check your connection and try again.";

// The device id, read where the popup reads it: chrome.storage.sync.
async function storedId(worker: Worker): Promise<string | null> {
  return worker.evaluate(async () => {
    const { tokenValue } = await chrome.storage.sync.get(['tokenValue']);
    return typeof tokenValue === 'string' ? tokenValue : null;
  });
}

async function putId(worker: Worker): Promise<void> {
  await worker.evaluate(() =>
    chrome.storage.sync.set({ tokenValue: crypto.randomUUID() })
  );
}

// The saved cloud answer, read where the popup keeps it.
function storedConsent(page: Page): Promise<unknown> {
  return page.evaluate(
    () => JSON.parse(localStorage.getItem('settingsData') ?? '{}').cloudConsent
  );
}

function autoSyncButton(page: Page, name: 'On' | 'Off') {
  return page
    .getByRole('group', { name: 'Auto sync' })
    .getByRole('button', { name });
}

test.describe('Delete cloud data asks before it acts (KAN-254)', () => {
  test('the button opens a real dialog; Cancel and Escape close it, auto sync untouched', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    // Declined with an id: the press opens the dialog with no check first.
    await seedSettings(context, {
      cloudConsent: 'declined',
      isAutoSync: false,
    });
    await seedSessions(context, buildContainer());
    await putId(serviceWorker);
    expect(await storedId(serviceWorker)).not.toBeNull();
    const page = await context.newPage();
    await page.setViewportSize({ width: 790, height: 550 });
    await openSyncPane(page, extensionId);

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

    // Confirm: the cloud is unreachable (blocked here, no config in CI), so it fails.
    await button.click();
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(page.getByText(DELETE_FAILED)).toBeVisible({
      timeout: 20_000,
    });
    expect(await storedConsent(page)).toBe('declined');
    await expect(autoSyncButton(page, 'Off')).toHaveAttribute(
      'aria-pressed',
      'true'
    );
  });

  test('no stored id: says there is nothing to delete, with no dialog and no request', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    await seedSettings(context, {
      cloudConsent: 'declined',
      isAutoSync: false,
    });
    await seedSessions(context, buildContainer());
    const hits = await countCloudRequests(context);
    const page = await context.newPage();
    await page.setViewportSize({ width: 790, height: 550 });
    await openSyncPane(page, extensionId);
    const button = page.getByRole('button', { name: 'Delete cloud data' });
    await expect(button).toBeVisible();
    // PREMISE: declined with nothing stored has no id.
    expect(await storedId(serviceWorker)).toBeNull();

    await button.click();
    await expect(page.getByText(NOTHING_TO_DELETE)).toBeVisible();
    await expect(
      page.getByRole('dialog', { name: 'Delete your cloud data?' })
    ).toHaveCount(0);
    expect(hits).toHaveLength(0);
  });

  test('sync on, cloud unreachable: the failed toast and no dialog', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    await seedSessions(context, buildContainer());
    const page = await context.newPage();
    await page.setViewportSize({ width: 790, height: 550 });
    await openSyncPane(page, extensionId);
    // PREMISE: granted consent minted an id at boot.
    await expect.poll(() => storedId(serviceWorker)).not.toBeNull();

    await page.getByRole('button', { name: 'Delete cloud data' }).click();
    await expect(page.getByText(DELETE_FAILED)).toBeVisible({
      timeout: 20_000,
    });
    await expect(
      page.getByRole('dialog', { name: 'Delete your cloud data?' })
    ).toHaveCount(0);
    await expect(autoSyncButton(page, 'On')).toHaveAttribute(
      'aria-pressed',
      'true'
    );
  });

  test('sync off: nothing reaches the network until the confirm', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    test.skip(!hasCloudConfig(), 'this build has no cloud config (CI)');
    await seedSettings(context, {
      cloudConsent: 'declined',
      isAutoSync: false,
    });
    await seedSessions(context, buildContainer());
    await putId(serviceWorker);
    expect(await storedId(serviceWorker)).not.toBeNull();
    const hits = await countCloudRequests(context);
    const page = await context.newPage();
    await page.setViewportSize({ width: 790, height: 550 });
    await openSyncPane(page, extensionId);

    await page.getByRole('button', { name: 'Delete cloud data' }).click();
    const dialog = page.getByRole('dialog', {
      name: 'Delete your cloud data?',
    });
    await expect(dialog).toBeVisible();
    await page.waitForTimeout(1000);
    expect(hits).toHaveLength(0);

    await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
    // The positive control: the confirm does make requests.
    await expect.poll(() => hits.length).toBeGreaterThan(0);
    await expect(page.getByText(DELETE_FAILED)).toBeVisible({
      timeout: 20_000,
    });
    await expect(autoSyncButton(page, 'Off')).toHaveAttribute(
      'aria-pressed',
      'true'
    );
  });

  test('Checking… shows while the check is held', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    test.skip(!hasCloudConfig(), 'this build has no cloud config (CI)');
    await seedSessions(context, buildContainer());
    // After the fixture's block, so it runs first: hold each request, then abort.
    await context.route(CLOUD, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await route.abort().catch(() => undefined);
    });
    const page = await context.newPage();
    await page.setViewportSize({ width: 790, height: 550 });
    await openSyncPane(page, extensionId);
    await expect.poll(() => storedId(serviceWorker)).not.toBeNull();

    // The second face is always in the DOM (faded out), so the shown state is
    // the button's own attribute, not the text's presence.
    const button = page.getByRole('button', { name: 'Delete cloud data' });
    await expect(button).toHaveAttribute('data-second-face-shown', 'false');
    await button.click();
    await expect(button).toHaveAttribute('data-second-face-shown', 'true');
    await expect(page.getByText(DELETE_FAILED)).toBeVisible({
      timeout: 20_000,
    });
    await expect(button).toHaveAttribute('data-second-face-shown', 'false');
  });
});

async function openSyncPane(page: Page, extensionId: string): Promise<void> {
  await page.goto(`chrome-extension://${extensionId}/index.html`);
  await page.locator('[aria-label="Settings"]').click();
  await page.locator('button[aria-label="Sync & backup"]').click();
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

  test('sync on, nothing uploaded: says so and leaves sync as it was', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    test.skip(!hasCloudConfig(), 'this build has no cloud config (CI)');
    const commits: string[] = [];
    await context.route(COMMIT, async (route) => {
      commits.push(route.request().url());
      await route.continue();
    });
    // Granted, but Auto sync off: the device has an id and has uploaded nothing.
    await seedSettings(context, { cloudConsent: 'granted', isAutoSync: false });
    await seedSessions(context, buildContainer());
    const page = await context.newPage();
    await page.setViewportSize({ width: 790, height: 550 });
    await openSyncPane(page, extensionId);
    // PREMISE: an id exists and no write has reached the cloud.
    await expect.poll(() => storedId(serviceWorker)).not.toBeNull();
    await page.waitForTimeout(2000);
    expect(commits).toHaveLength(0);
    const status = page.getByTestId('sync-status');
    const before = await status.getAttribute('data-sync-state');
    expect(before).not.toBeNull();
    await expect(autoSyncButton(page, 'Off')).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(await storedConsent(page)).toBe('granted');

    await page.getByRole('button', { name: 'Delete cloud data' }).click();
    await expect(page.getByText(NOTHING_TO_DELETE)).toBeVisible({
      timeout: 20_000,
    });
    await expect(
      page.getByRole('dialog', { name: 'Delete your cloud data?' })
    ).toHaveCount(0);
    await expect(status).toHaveAttribute('data-sync-state', before ?? '');
    expect(await storedConsent(page)).toBe('granted');
    await expect(autoSyncButton(page, 'Off')).toHaveAttribute(
      'aria-pressed',
      'true'
    );
  });
});
