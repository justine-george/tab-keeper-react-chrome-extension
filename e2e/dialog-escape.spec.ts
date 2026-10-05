import type { BrowserContext, Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import {
  buildContainer,
  buildSession,
  seedSessions,
  seedSettings,
} from './fixtures/seed';
import { openPopup, storedSettings } from './fixtures/onboarding';
import { escapesPrevented, watchEscapes } from './fixtures/escapeProbe';
import { hasCloudConfig } from './fixtures/cloud';
import { cardAt, cardButton } from './fixtures/run';

// KAN-426. Chrome closes the popup on an Esc keydown the page leaves unprevented, so each dialog's Esc must be
// prevented and still do what it did. Headless cannot show the popup closing; the prevented keydown is the proof.

const DAY = 24 * 60 * 60 * 1000;
const dialog = (page: Page, name: string) =>
  page.getByRole('dialog', { name, exact: true });

async function openSyncAndBackup(
  context: BrowserContext,
  extensionId: string
): Promise<Page> {
  const page = await openPopup(context, extensionId);
  await page.locator('[aria-label="Settings"]').click();
  await page.locator('button[aria-label="Sync & Backup"]').click();
  return page;
}

const autoSync = (page: Page, state: 'On' | 'Off') =>
  page
    .getByRole('group', { name: 'Auto Sync' })
    .getByRole('button', { name: state, exact: true });

test.describe('a new install', () => {
  test.use({ freshProfile: true });

  test('welcome: Esc is consumed, and is Not now', async ({
    context,
    extensionId,
  }) => {
    await watchEscapes(context);
    const page = await openPopup(context, extensionId);
    await expect(dialog(page, 'Welcome to Tab Keeper')).toBeVisible();

    await page.keyboard.press('Escape');

    await expect(dialog(page, 'Welcome to Tab Keeper')).toHaveCount(0);
    await expect(cardAt(page, 1)).toBeVisible();
    expect(await escapesPrevented(page)).toEqual([true]);
  });

  test('sync question: Esc is consumed, and grants nothing', async ({
    context,
    extensionId,
  }) => {
    await watchEscapes(context);
    const page = await openPopup(context, extensionId);
    await dialog(page, 'Welcome to Tab Keeper')
      .getByRole('button', { name: 'Not now', exact: true })
      .click();
    await expect(cardAt(page, 1)).toBeVisible();
    await cardButton(page, 'Skip tutorial').click();
    await page.locator('[aria-label="Settings"]').click();
    await page.locator('button[aria-label="Sync & Backup"]').click();
    await autoSync(page, 'On').click();
    const ask = dialog(page, 'Sync your sessions across devices?');
    await expect(ask).toBeVisible();

    await page.keyboard.press('Escape');

    await expect(ask).toHaveCount(0);
    await expect(autoSync(page, 'Off')).toHaveAttribute('aria-pressed', 'true');
    expect((await storedSettings(page)).cloudConsent).toBe('declined');
    expect(await escapesPrevented(page)).toEqual([true]);
  });
});

test('existing user: Esc on the synced question is consumed, and is Turn off sync', async ({
  context,
  extensionId,
}) => {
  test.skip(!hasCloudConfig(), 'this build has no cloud config (CI)');
  await watchEscapes(context);
  await seedSessions(context, buildContainer());
  await seedSettings(context, {
    cloudConsent: '',
    extensionInstalledTime: Date.now() - 30 * DAY,
  });
  const page = await openPopup(context, extensionId);
  const ask = dialog(page, 'Your sessions are currently synced');
  await expect(ask).toBeVisible();

  await page.keyboard.press('Escape');

  await expect(ask).toHaveCount(0);
  expect((await storedSettings(page)).cloudConsent).toBe('declined');
  expect(await escapesPrevented(page)).toEqual([true]);
});

test('rate prompt: Esc is consumed, and is Remind me later', async ({
  context,
  extensionId,
}) => {
  await watchEscapes(context);
  await seedSessions(context, buildContainer());
  await seedSettings(context, {
    extensionInstalledTime: Date.now() - 2 * DAY,
    lastValueMomentTime: Date.now() - 60 * 60 * 1000,
  });
  const page = await openPopup(context, extensionId);
  const rate = dialog(page, 'Enjoying Tab Keeper?');
  await expect(rate).toBeVisible();

  await page.keyboard.press('Escape');

  await expect(rate).toHaveCount(0);
  expect((await storedSettings(page)).isSkippedUserReviewOnce).toBe(true);
  expect(await escapesPrevented(page)).toEqual([true]);
});

test('switch confirm: Esc is consumed, and switches nothing', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  await watchEscapes(context);
  await seedSessions(
    context,
    buildContainer([buildSession({ tabGroupId: 's1', title: 'Research' })])
  );
  const page = await openPopup(context, extensionId);
  const windowsBefore = await serviceWorker.evaluate(() =>
    chrome.windows.getAll().then((all) => all.length)
  );
  const rowSwitch = page
    .locator('[data-pane="sessions"]')
    .getByRole('button', { name: 'Switch', exact: true });
  await rowSwitch.focus();
  await rowSwitch.press('Enter');
  const confirm = page.locator(
    'dialog[open][aria-labelledby="focus-confirm-title"]'
  );
  await expect(confirm).toBeVisible();

  await page.keyboard.press('Escape');

  await expect(confirm).toHaveCount(0);
  expect(
    await serviceWorker.evaluate(() =>
      chrome.windows.getAll().then((all) => all.length)
    )
  ).toBe(windowsBefore);
  expect(await escapesPrevented(page)).toEqual([true]);
});

test('delete cloud data: Esc is consumed, and is Cancel', async ({
  context,
  extensionId,
}) => {
  await watchEscapes(context);
  await seedSessions(context, buildContainer());
  const page = await openSyncAndBackup(context, extensionId);
  await page.getByRole('button', { name: 'Delete cloud data' }).click();
  const ask = dialog(page, 'Delete your cloud data?');
  await expect(ask).toBeVisible();

  await page.keyboard.press('Escape');

  await expect(ask).toHaveCount(0);
  await expect(autoSync(page, 'On')).toHaveAttribute('aria-pressed', 'true');
  expect(await escapesPrevented(page)).toEqual([true]);
});

test('load backup: Esc is consumed, and is Cancel', async ({
  context,
  extensionId,
}) => {
  await watchEscapes(context);
  const here = buildContainer([
    buildSession({ tabGroupId: 'h1', title: 'Here one' }),
  ]);
  await seedSessions(context, here);
  const page = await openSyncAndBackup(context, extensionId);
  const chooser = page.waitForEvent('filechooser');
  await page
    .getByRole('button', { name: 'Load sessions from a backup' })
    .click();
  await (
    await chooser
  ).setFiles({
    name: 'monday.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify(
        buildContainer([buildSession({ tabGroupId: 'f1', title: 'From file' })])
      )
    ),
  });
  const ask = page.getByRole('dialog', {
    name: /^Load .* from this backup\?$/,
  });
  await expect(ask).toBeVisible();

  await page.keyboard.press('Escape');

  await expect(ask).toHaveCount(0);
  expect(
    await page.evaluate(() => {
      const data: unknown = JSON.parse(
        localStorage.getItem('tabContainerData') ?? '{}'
      );
      return JSON.stringify(data).includes('From file');
    })
  ).toBe(false);
  expect(await escapesPrevented(page)).toEqual([true]);
});

// CONTROL: with no dialog open the same watch sees an Esc left to the browser.
test('no dialog open: the Esc is not prevented', async ({
  context,
  extensionId,
}) => {
  await watchEscapes(context);
  await seedSessions(context, buildContainer());
  const page = await openPopup(context, extensionId);
  await expect(page.locator('dialog[open]')).toHaveCount(0);

  await page.keyboard.press('Escape');

  await expect.poll(() => escapesPrevented(page)).toEqual([false]);
});
