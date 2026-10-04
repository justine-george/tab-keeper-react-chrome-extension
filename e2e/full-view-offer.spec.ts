import type { BrowserContext, Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { buildContainer, seedSessions, seedSettings } from './fixtures/seed';
import {
  THEMES,
  openPopup,
  pageGround,
  storedSettings,
  waitForFullView,
} from './fixtures/onboarding';
import { expectReadable } from './fixtures/textContrast';

// KAN-7 §3 on the real build. Every flow here spans pages, so the profile is
// fresh and unseeded: a seed would re-run on the next page and erase it.

const DAY = 24 * 60 * 60 * 1000;
const offer = (page: Page) =>
  page.getByRole('dialog', { name: 'Try the full view', exact: true });
const welcome = (page: Page) =>
  page.getByRole('dialog', { name: 'Welcome to Tab Keeper', exact: true });

async function welcomeThenOffer(
  context: BrowserContext,
  extensionId: string,
  answer = 'Keep on this device'
): Promise<Page> {
  const page = await openPopup(context, extensionId);
  await welcome(page)
    .getByRole('button', { name: answer, exact: true })
    .click();
  await expect(offer(page)).toBeVisible();
  return page;
}

test.describe('on a new install', () => {
  test.use({ freshProfile: true });

  test('Keep on this device is followed by the offer, which opens unlit', async ({
    context,
    extensionId,
  }) => {
    const page = await welcomeThenOffer(context, extensionId);
    expect(
      await page.evaluate(
        () => document.activeElement === document.querySelector('dialog[open]')
      )
    ).toBe(true);
    expect((await storedSettings(page)).setupState).toBe('pending');
  });

  test('Sync across devices is followed by the offer too', async ({
    context,
    extensionId,
  }) => {
    await welcomeThenOffer(context, extensionId, 'Sync across devices');
  });

  test('Open full view opens it, and the offer never comes back', async ({
    context,
    extensionId,
  }) => {
    const page = await welcomeThenOffer(context, extensionId);
    await offer(page)
      .getByRole('button', { name: 'Open full view', exact: true })
      .click();
    await waitForFullView(context);
    expect((await storedSettings(page)).isFullViewOfferAnswered).toBe(true);

    const again = await openPopup(context, extensionId);
    await expect(again.locator('dialog[open]')).toHaveCount(0);
  });

  for (const how of ['Not now', 'Close', 'Escape'] as const) {
    test(`${how} ends it for good`, async ({ context, extensionId }) => {
      const page = await welcomeThenOffer(context, extensionId);
      if (how === 'Escape') await page.keyboard.press('Escape');
      else
        await offer(page)
          .getByRole('button', { name: how, exact: true })
          .click();
      await expect(offer(page)).toHaveCount(0);
      expect(await storedSettings(page)).toMatchObject({
        isFullViewOfferAnswered: true,
        setupState: 'pending',
      });

      const again = await openPopup(context, extensionId);
      await expect(again.locator('dialog[open]')).toHaveCount(0);
    });
  }

  test('a popup closed before the answer asks again, without the welcome', async ({
    context,
    extensionId,
  }) => {
    await welcomeThenOffer(context, extensionId);
    const again = await openPopup(context, extensionId);
    await expect(offer(again)).toBeVisible();
    await expect(welcome(again)).toHaveCount(0);
  });
});

test('an existing user’s cloud question is not followed by the offer', async ({
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
  const existing = page.getByRole('dialog', {
    name: 'Your sessions are currently synced',
    exact: true,
  });
  await existing
    .getByRole('button', { name: 'Keep sync on', exact: true })
    .click();
  await expect(existing).toHaveCount(0);
  await expect(offer(page)).toHaveCount(0);
});

for (const [theme, palette] of THEMES) {
  test(`${theme}: the offer reads at 4.5:1`, async ({
    context,
    extensionId,
  }) => {
    await seedSettings(context, { cloudConsent: '', theme });
    const page = await openPopup(context, extensionId);
    expect(await pageGround(page)).toBe(palette.PRIMARY_COLOR);
    await welcome(page)
      .getByRole('button', { name: 'Keep on this device', exact: true })
      .click();
    await expectReadable(offer(page), `${theme} Try the full view`);
  });
}
