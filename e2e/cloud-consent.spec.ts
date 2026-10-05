import type { BrowserContext, Page } from '@playwright/test';

import { countCloudRequests, hasCloudConfig } from './fixtures/cloud';
import { test, expect } from './fixtures/extension';
import { buildContainer, seedSessions, seedSettings } from './fixtures/seed';
import { storedSettings } from './fixtures/onboarding';
import { cardAt, cardButton } from './fixtures/run';
import { rgbToHex } from './fixtures/pixels';
import { mixHex } from '../src/styles/mixHex';
import { LIGHT_THEME } from '../src/hooks/useThemeColors';

// KAN-259. Nothing leaves the device until the user says yes. A new install
// is welcomed without a question and recorded local-only (KAN-410); sync is
// asked for later, by the plain question. An existing user is asked once,
// phrased for someone whose sessions are already synced. What a real browser
// adds to the jsdom tests: the dialog is modal (top layer, open), it opens
// unlit, the record persists across a reopen, and the rest of the popup is
// usable behind it once closed.

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

    test('a fresh profile is welcomed without a question, and Auto Sync is off', async ({
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
      await expect(page.locator(':focus')).toHaveAccessibleName('Not now');
      expect((await lit()).litInside).toBe(1);

      await dialog
        .getByRole('button', { name: 'Not now', exact: true })
        .click();
      await expect(dialog).toHaveCount(0);
      // §4. Not now starts the popup run; Skip tutorial leaves the popup plain.
      await expect(cardAt(page, 1)).toBeVisible();
      await cardButton(page, 'Skip tutorial').click();

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

    test('the welcome is once: a reopen is not welcomed or asked again', async ({
      context,
      extensionId,
    }) => {
      const first = await openPopup(context, extensionId);
      await first
        .getByRole('dialog', { name: 'Welcome to Tab Keeper' })
        .getByRole('button', { name: 'Not now', exact: true })
        .click();
      await expect(cardAt(first, 1)).toBeVisible();
      await cardButton(first, 'Skip tutorial').click();

      const again = await openPopup(context, extensionId);
      await expect(again.locator('[aria-label="Settings"]')).toBeVisible();
      await expect(again.getByRole('dialog')).toHaveCount(0);
    });

    // KAN-410. The welcome recorded "declined"; turning Auto Sync on must
    // still ask the full question before anything is uploaded.
    test('after the welcome, turning Auto Sync on asks the plain question first', async ({
      context,
      extensionId,
    }) => {
      const page = await openPopup(context, extensionId);
      await page
        .getByRole('dialog', { name: 'Welcome to Tab Keeper' })
        .getByRole('button', { name: 'Not now', exact: true })
        .click();
      await expect(cardAt(page, 1)).toBeVisible();
      await cardButton(page, 'Skip tutorial').click();
      await page.locator('[aria-label="Settings"]').click();
      await page.locator('button[aria-label="Sync & Backup"]').click();
      await page
        .getByRole('group', { name: 'Auto Sync' })
        .getByRole('button', { name: 'On', exact: true })
        .click();

      const ask = page.getByRole('dialog', {
        name: 'Sync your sessions across devices?',
        exact: true,
      });
      await expect(ask).toBeVisible();
      expect(await ask.textContent()).toContain('Read the privacy policy');
      await ask.getByRole('button', { name: 'Not now', exact: true }).click();
      await expect(ask).toHaveCount(0);
      await expect(
        page
          .getByRole('group', { name: 'Auto Sync' })
          .getByRole('button', { name: 'Off', exact: true })
      ).toHaveAttribute('aria-pressed', 'true');
      expect((await storedSettings(page)).cloudConsent).toBe('declined');
    });
  });

  test('an existing user sees the synced wording, and Escape declines, uploading nothing (KAN-410)', async ({
    context,
    extensionId,
  }) => {
    test.skip(!hasCloudConfig(), 'this build has no cloud config (CI)');
    const cloudHits = await countCloudRequests(context);
    await seedSessions(context, buildContainer());
    await seedSettings(context, {
      cloudConsent: '',
      extensionInstalledTime: Date.now() - 30 * DAY,
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
        .getByRole('button', { name: 'Off', exact: true })
    ).toHaveAttribute('aria-pressed', 'true');
    expect((await storedSettings(page)).cloudConsent).toBe('declined');
    expect(cloudHits).toEqual([]);
  });

  // KAN-410. A 1.9.x welcome closed unanswered: an install date, no answer, Auto Sync at its old default.
  test('an install date alone is welcomed and recorded local-only, and nothing reaches the cloud', async ({
    context,
    extensionId,
  }) => {
    test.skip(!hasCloudConfig(), 'this build has no cloud config (CI)');
    const cloudHits = await countCloudRequests(context);
    await seedSettings(context, {
      extensionInstalledTime: Date.now() - 30 * DAY,
      cloudConsent: '',
    });
    const page = await openPopup(context, extensionId);
    const welcome = page.getByRole('dialog', {
      name: 'Welcome to Tab Keeper',
      exact: true,
    });
    await expect(welcome).toBeVisible();
    await expect(
      page.getByRole('dialog', { name: 'Your sessions are currently synced' })
    ).toHaveCount(0);
    await expect
      .poll(async () => {
        const s = await storedSettings(page);
        return [s.cloudConsent, s.isAutoSync, s.setupState];
      })
      .toEqual(['declined', false, 'pending']);

    // The key that granted on the old "currently synced" screen: here it is Not now.
    await page.keyboard.press('Escape');
    await expect(cardAt(page, 1)).toBeVisible();
    expect((await storedSettings(page)).cloudConsent).toBe('declined');
    expect(cloudHits).toEqual([]);
  });

  // The CONTROL for the test above: the counter sees a consented boot reach for the cloud.
  test('a consented boot with Auto Sync on is seen reaching for the cloud', async ({
    context,
    extensionId,
  }) => {
    test.skip(!hasCloudConfig(), 'this build has no cloud config (CI)');
    const cloudHits = await countCloudRequests(context);
    await seedSessions(context, buildContainer());
    await seedSettings(context, { isAutoSync: true });
    await openPopup(context, extensionId);
    await expect.poll(() => cloudHits.length).toBeGreaterThan(0);
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

  // The filled button: its letters stay PRIMARY while its fill mixes TEXT over PRIMARY, 88% then 76%.
  test('hover and a held press are two different fills', async ({
    context,
    extensionId,
  }) => {
    const { TEXT_COLOR, PRIMARY_COLOR } = LIGHT_THEME;
    const page = await openPopup(context, extensionId);
    const button = page
      .getByRole('dialog', { name: 'Welcome to Tab Keeper' })
      .getByRole('button', { name: 'Get started', exact: true });
    const paint = () =>
      button.evaluate((el) => {
        const style = getComputedStyle(el);
        return [style.backgroundColor, style.color];
      });
    const fill = async () => {
      const [ground, letters] = await paint();
      return [rgbToHex(ground), rgbToHex(letters)];
    };
    await expect.poll(fill).toEqual([TEXT_COLOR, PRIMARY_COLOR]);

    const box = (await button.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await expect
      .poll(fill, { timeout: 2000 })
      .toEqual([mixHex(TEXT_COLOR, PRIMARY_COLOR, 0.88), PRIMARY_COLOR]);

    await page.mouse.down();
    await expect
      .poll(fill, { timeout: 2000 })
      .toEqual([mixHex(TEXT_COLOR, PRIMARY_COLOR, 0.76), PRIMARY_COLOR]);
    // Release off the button, so the press is not also a click.
    await page.mouse.move(0, 0);
    await page.mouse.up();
  });
});
