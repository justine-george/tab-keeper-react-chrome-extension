import type { BrowserContext, Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { buildContainer, seedSessions, seedSettings } from './fixtures/seed';

// KAN-259. Nothing leaves the device until the user answers a one-screen
// welcome; an existing user gets the same screen once, phrased for someone
// whose sessions are already synced. What a real browser adds to the jsdom
// tests: the dialog is modal (top layer, open), the initial focus lands on
// the answer that changes nothing, the answer persists across a reopen, and
// the rest of the popup is usable behind it once answered.

const DAY = 24 * 60 * 60 * 1000;

async function openPopup(
  context: BrowserContext,
  extensionId: string
): Promise<Page> {
  const page = await context.newPage();
  await page.setViewportSize({ width: 790, height: 550 });
  await page.goto(`chrome-extension://${extensionId}/index.html`);
  return page;
}

test.describe('the cloud question (KAN-259)', () => {
  // The two fresh-install tests need a profile with NO settings at all.
  test.describe('on a fresh install', () => {
    test.use({ freshProfile: true });

    test('a fresh profile is welcomed, and Keep on this device turns Auto Sync off', async ({
      context,
      extensionId,
    }) => {
      const page = await openPopup(context, extensionId);
      const dialog = page.getByRole('dialog', {
        name: 'Welcome to Tab Keeper',
      });
      await expect(dialog).toBeVisible();
      expect(
        await dialog.evaluate((el) => (el as HTMLDialogElement).open)
      ).toBe(true);
      await expect(
        dialog.getByRole('button', { name: 'Keep on this device' })
      ).toBeFocused();

      await dialog.getByRole('button', { name: 'Keep on this device' }).click();
      await expect(dialog).toHaveCount(0);

      await page.locator('[aria-label="Settings"]').click();
      await page.locator('button[aria-label="Sync & Backup"]').click();
      await expect(
        page
          .getByRole('group', { name: 'Auto Sync' })
          .getByRole('button', { name: 'Off' })
      ).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByTestId('sync-status')).toHaveAttribute(
        'data-sync-state',
        'manual'
      );
    });

    test('the answer persists: a reopen is not asked again', async ({
      context,
      extensionId,
    }) => {
      const first = await openPopup(context, extensionId);
      await first
        .getByRole('dialog', { name: 'Welcome to Tab Keeper' })
        .getByRole('button', { name: 'Keep on this device' })
        .click();

      const again = await openPopup(context, extensionId);
      await expect(again.locator('[aria-label="Settings"]')).toBeVisible();
      await expect(again.getByRole('dialog')).toHaveCount(0);
    });
  });

  test('an existing user sees the synced wording, and Escape keeps sync on', async ({
    context,
    extensionId,
  }) => {
    await seedSessions(context, buildContainer());
    await seedSettings(context, {
      cloudConsent: '',
      extensionInstalledTime: Date.now() - 30 * DAY,
      isAutoSync: true,
    });
    const page = await openPopup(context, extensionId);
    const dialog = page.getByRole('dialog', {
      name: 'Your sessions are currently synced',
    });
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole('button', { name: 'Turn off sync' })
    ).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);

    await page.locator('[aria-label="Settings"]').click();
    await page.locator('button[aria-label="Sync & Backup"]').click();
    await expect(
      page
        .getByRole('group', { name: 'Auto Sync' })
        .getByRole('button', { name: 'On' })
    ).toHaveAttribute('aria-pressed', 'true');
  });

  test('an existing user who already turned Auto Sync off is not asked', async ({
    context,
    extensionId,
  }) => {
    await seedSessions(context, buildContainer());
    await seedSettings(context, {
      cloudConsent: '',
      extensionInstalledTime: Date.now() - 30 * DAY,
      isAutoSync: false,
    });
    const page = await openPopup(context, extensionId);
    await expect(page.locator('[aria-label="Settings"]')).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
});
