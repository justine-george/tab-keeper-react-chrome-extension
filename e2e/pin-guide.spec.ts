import type { Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import {
  buildContainer,
  seedSessions,
  seedSettings,
  seedSettingsIfAbsent,
} from './fixtures/seed';
import {
  THEMES,
  openFullView,
  openPopup,
  pageGround,
  storedSettings,
  waitForFullView,
} from './fixtures/onboarding';
import { setPin, stubToolbarPin } from './fixtures/toolbarPin';
import { expectReadable } from './fixtures/textContrast';

// KAN-7 §4 on the real build. The rate prompt, due in most of these seeds, is
// the barrier for a negative: it is decided after the guide, so its dialog
// opening proves the guide already said no.

const DAY = 24 * 60 * 60 * 1000;
const RATE_DUE = {
  extensionInstalledTime: Date.now() - 2 * DAY,
  lastValueMomentTime: Date.now() - 60 * 60 * 1000,
};
const guide = (page: Page) =>
  page.getByRole('dialog', {
    name: 'Pin Tab Keeper to your toolbar',
    exact: true,
  });
const rate = (page: Page) =>
  page.getByRole('dialog', { name: 'Enjoying Tab Keeper?', exact: true });
const captions = (page: Page) => guide(page).locator('[data-pin-step-caption]');

test('unpinned and not dismissed: the full view shows it, unlit, waiting, ahead of the rate prompt', async ({
  context,
  extensionId,
}) => {
  await stubToolbarPin(context, { pinned: false });
  await seedSettings(context, { isPinGuideDismissed: false, ...RATE_DUE });
  const page = await openFullView(context, extensionId);
  await expect(guide(page)).toBeVisible();
  await expect(rate(page)).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.activeElement === document.querySelector('dialog[open]')
    )
  ).toBe(true);
  await expect(captions(page)).toHaveText([
    'Click the puzzle piece',
    'Click the pin next to Tab Keeper',
    'Tab Keeper stays on your toolbar',
  ]);
  await expect(
    guide(page).getByRole('status').locator('[data-pin-status-words]')
  ).toHaveText('Waiting for you to pin…');
});

for (const [name, pinned] of [
  ['pinned', true],
  ['no getUserSettings', 'absent'],
] as const) {
  test(`${name}: no guide, and the rate prompt gets the open`, async ({
    context,
    extensionId,
  }) => {
    await stubToolbarPin(context, { pinned });
    await seedSettings(context, { isPinGuideDismissed: false, ...RATE_DUE });
    const page = await openFullView(context, extensionId);
    await expect(rate(page)).toBeVisible();
    await expect(guide(page)).toHaveCount(0);
  });
}

test('a pin ticks step 3, says so, and closes itself without dismissing', async ({
  context,
  extensionId,
}) => {
  await stubToolbarPin(context, { pinned: false });
  await seedSettings(context, { isPinGuideDismissed: false });
  const page = await openFullView(context, extensionId);
  await expect(guide(page)).toBeVisible();

  await setPin(page, true);
  await expect(
    guide(page).getByRole('status').locator('[data-pin-status-words]')
  ).toHaveText('Pinned. Closing…');
  await expect(
    captions(page).nth(2).locator('.material-symbols-outlined')
  ).toHaveText('check');
  await expect(guide(page)).toBeVisible();
  await expect(guide(page)).toHaveCount(0, { timeout: 5000 });
  expect((await storedSettings(page)).isPinGuideDismissed).toBe(false);
});

test('without the event, coming back to the window re-reads the pin', async ({
  context,
  extensionId,
}) => {
  await stubToolbarPin(context, { pinned: false, event: false });
  await seedSettings(context, { isPinGuideDismissed: false });
  const page = await openFullView(context, extensionId);
  await expect(guide(page)).toBeVisible();

  await setPin(page, true);
  await expect(
    guide(page).getByRole('status').locator('[data-pin-status-words]')
  ).toHaveText('Waiting for you to pin…');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(
    guide(page).getByRole('status').locator('[data-pin-status-words]')
  ).toHaveText('Pinned. Closing…');
});

test('never in the popup', async ({ context, extensionId }) => {
  await stubToolbarPin(context, { pinned: false });
  await seedSettings(context, { isPinGuideDismissed: false, ...RATE_DUE });
  const page = await openPopup(context, extensionId);
  await expect(rate(page)).toBeVisible();
  await expect(guide(page)).toHaveCount(0);
});

test('an existing user who never pinned sees it; with setup not started, nothing follows it', async ({
  context,
  extensionId,
}) => {
  await stubToolbarPin(context, { pinned: false });
  await seedSessions(context, buildContainer());
  await seedSettings(context, { isPinGuideDismissed: false });
  const page = await openFullView(context, extensionId);
  await guide(page).getByRole('button', { name: 'Skip', exact: true }).click();
  // The dismissal is stored in the same dispatch that would open setup.
  await expect
    .poll(async () => (await storedSettings(page)).isPinGuideDismissed)
    .toBe(true);
  await expect(guide(page)).toHaveCount(0);
  await expect(page.locator('dialog[open]')).toHaveCount(0);
});

test('with setup pending, Skip opens it: the control for the test above', async ({
  context,
  extensionId,
}) => {
  await stubToolbarPin(context, { pinned: false });
  await seedSettings(context, {
    isPinGuideDismissed: false,
    setupState: 'pending',
  });
  const page = await openFullView(context, extensionId);
  await guide(page).getByRole('button', { name: 'Skip', exact: true }).click();
  await expect(
    page.getByRole('dialog', { name: 'Make Tab Keeper yours', exact: true })
  ).toBeVisible();
  await expect(guide(page)).toHaveCount(0);
});

test.describe('dismissals stick on this machine', () => {
  test.use({ freshProfile: true });

  for (const how of ['Skip', 'Close', 'Escape'] as const) {
    test(`${how} dismisses it for good`, async ({ context, extensionId }) => {
      await stubToolbarPin(context, { pinned: false });
      await seedSettingsIfAbsent(context, {
        isPinGuideDismissed: false,
        ...RATE_DUE,
      });
      const page = await openFullView(context, extensionId);
      await expect(guide(page)).toBeVisible();
      if (how === 'Escape') await page.keyboard.press('Escape');
      else
        await guide(page)
          .getByRole('button', { name: how, exact: true })
          .click();
      await expect(guide(page)).toHaveCount(0);
      expect((await storedSettings(page)).isPinGuideDismissed).toBe(true);

      await page.reload();
      await expect(rate(page)).toBeVisible();
      await expect(guide(page)).toHaveCount(0);
    });
  }

  test('a new install reaches it from Try the full view', async ({
    context,
    extensionId,
  }) => {
    await stubToolbarPin(context, { pinned: false });
    const popup = await openPopup(context, extensionId);
    await popup
      .getByRole('dialog', { name: 'Welcome to Tab Keeper', exact: true })
      .getByRole('button', { name: 'Keep on this device', exact: true })
      .click();
    await popup
      .getByRole('dialog', { name: 'Try the full view', exact: true })
      .getByRole('button', { name: 'Open full view', exact: true })
      .click();
    const full = await waitForFullView(context);
    await expect(guide(full)).toBeVisible();
  });
});

for (const [theme, palette] of THEMES) {
  test(`${theme}: the guide reads at 4.5:1, waiting and pinned`, async ({
    context,
    extensionId,
  }) => {
    await stubToolbarPin(context, { pinned: false });
    await seedSettings(context, { theme, isPinGuideDismissed: false });
    const page = await openFullView(context, extensionId);
    expect(await pageGround(page)).toBe(palette.PRIMARY_COLOR);
    await expectReadable(guide(page), `${theme} pin guide, waiting`);
    await setPin(page, true);
    await expect(
      guide(page).getByRole('status').locator('[data-pin-status-words]')
    ).toHaveText('Pinned. Closing…');
    await expectReadable(guide(page), `${theme} pin guide, pinned`);
  });
}
