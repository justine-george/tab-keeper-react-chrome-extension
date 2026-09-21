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
      // Unlit on open (KAN-243): the dialog holds the focus, nothing inside
      // wears a ring, and the container draws none of its own. The first
      // Tab lights the first control, and Enter on open changes nothing.
      const lit = () =>
        page.evaluate(() => {
          const d = document.querySelector('dialog[open]')!;
          return {
            focusedIsDialog: document.activeElement === d,
            litInside: [...d.querySelectorAll('*')].filter((n) =>
              n.matches(':focus-visible')
            ).length,
            dialogOutline: getComputedStyle(d).outlineStyle,
          };
        });
      expect(await lit()).toEqual({
        focusedIsDialog: true,
        litInside: 0,
        dialogOutline: 'none',
      });
      await page.keyboard.press('Enter');
      await expect(dialog).toBeVisible();
      await page.keyboard.press('Tab');
      await expect(page.locator(':focus')).toHaveAccessibleName(
        'Read the privacy policy'
      );
      expect((await lit()).litInside).toBe(1);

      await dialog.getByRole('button', { name: 'Keep on this device' }).click();
      await expect(dialog).toHaveCount(0);

      await page.locator('[aria-label="Settings"]').click();
      await page.locator('button[aria-label="Sync & Backup"]').click();
      await expect(
        page
          .getByRole('group', { name: 'Auto Sync' })
          .getByRole('button', { name: 'Off' })
      ).toHaveAttribute('aria-pressed', 'true');
      // Declined is "off", not "manual": the cloud button would ask first.
      await expect(page.getByTestId('sync-status')).toHaveAttribute(
        'data-sync-state',
        'off'
      );
      await expect(page.getByTestId('sync-status')).toContainText(
        'Sync is off'
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
    // Unlit on open; nothing pre-chosen.
    expect(
      await page.evaluate(
        () =>
          [
            ...document.querySelector('dialog[open]')!.querySelectorAll('*'),
          ].filter((n) => n.matches(':focus-visible')).length
      )
    ).toBe(0);

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

// KAN-259. The dialog's buttons answer a press: hover is one rung, a held
// pointer one rung past it. jsdom pins that the rules are emitted
// (dialogButtonPress.test.tsx); this pins that Chrome paints them.
test.describe('dialog buttons answer a press', () => {
  test.use({ freshProfile: true });

  test('hover and a held press are two different fills', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId);
    const button = page
      .getByRole('dialog', { name: 'Welcome to Tab Keeper' })
      .getByRole('button', { name: 'Keep on this device' });
    const fill = () =>
      button.evaluate((el) => getComputedStyle(el).backgroundColor);
    const rest = await fill();

    const box = (await button.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await expect.poll(fill, { timeout: 2000 }).not.toBe(rest);
    const hover = await fill();

    await page.mouse.down();
    await expect.poll(fill, { timeout: 2000 }).not.toBe(hover);
    const pressed = await fill();
    expect(pressed).not.toBe(rest);
    // Release off the button, so the press is not also a click.
    await page.mouse.move(0, 0);
    await page.mouse.up();
  });
});
