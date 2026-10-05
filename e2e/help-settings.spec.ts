import type { Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import {
  buildContainer,
  buildSession,
  seedSessions,
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
import { stubToolbarPin } from './fixtures/toolbarPin';
import { expectReadable } from './fixtures/textContrast';
import { coachAt, storedTitles } from './fixtures/tour';

// KAN-7 Help on the real build: the rows, and where each leads from each view.

const help = (page: Page) => page.locator('[data-help]');
const setup = (page: Page) =>
  page.getByRole('dialog', { name: 'Make Tab Keeper yours', exact: true });
const guide = (page: Page) =>
  page.getByRole('dialog', {
    name: 'Pin Tab Keeper to your toolbar',
    exact: true,
  });
const row = (page: Page, name: string) =>
  help(page).getByRole('button', { name, exact: true });

async function openHelp(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Help', exact: true }).click();
  await expect(help(page)).toHaveAttribute('data-pin-state', /.+/);
}

test('popup: Run setup again opens the full view on setup’s first step', async ({
  context,
  extensionId,
}) => {
  const popup = await openPopup(context, extensionId);
  await openHelp(popup);
  await row(popup, 'Run setup again').click();
  const full = await waitForFullView(context);
  await expect(setup(full)).toBeVisible();
  await expect(setup(full).getByRole('heading', { level: 3 })).toHaveText(
    'Pick a theme'
  );
});

test('full view: Run setup again shows setup right here', async ({
  context,
  extensionId,
}) => {
  const full = await openFullView(context, extensionId);
  await openHelp(full);
  await row(full, 'Run setup again').click();
  await expect(setup(full)).toBeVisible();
  expect((await storedSettings(full)).setupState).toBe('pending');
});

test('popup, unpinned: Show me how opens the full view on the guide, though it was dismissed', async ({
  context,
  extensionId,
}) => {
  await stubToolbarPin(context, { pinned: false });
  const popup = await openPopup(context, extensionId);
  await openHelp(popup);
  await expect(help(popup)).toHaveAttribute('data-pin-state', 'unpinned');
  await row(popup, 'Show me how').click();
  const full = await waitForFullView(context);
  await expect(guide(full)).toBeVisible();
  expect((await storedSettings(full)).isPinGuideDismissed).toBe(true);
});

test('full view, unpinned: Show me how shows the guide right here', async ({
  context,
  extensionId,
}) => {
  await stubToolbarPin(context, { pinned: false });
  const full = await openFullView(context, extensionId);
  await openHelp(full);
  await row(full, 'Show me how').click();
  await expect(guide(full)).toBeVisible();
});

test('pinned: there is no pin row', async ({ context, extensionId }) => {
  await stubToolbarPin(context, { pinned: true });
  const popup = await openPopup(context, extensionId);
  await openHelp(popup);
  await expect(help(popup)).toHaveAttribute('data-pin-state', 'pinned');
  await expect(row(popup, 'Show me how')).toHaveCount(0);
  await expect(row(popup, 'Run setup again')).toBeVisible();
});

test('popup: Show me around returns home and starts the tour beside the sessions there', async ({
  context,
  extensionId,
}) => {
  await seedSessions(
    context,
    buildContainer([buildSession({ title: 'Kept' })])
  );
  const popup = await openPopup(context, extensionId);
  await openHelp(popup);
  await row(popup, 'Show me around').click();
  await expect(coachAt(popup, 1)).toBeVisible();
  await expect
    .poll(() => storedTitles(popup))
    .toEqual(['Sample: Weekend trip', 'Kept']);
});

test.describe('contrast', () => {
  test.use({ freshProfile: true });

  for (const [theme, palette] of THEMES) {
    test(`${theme}: Help reads at 4.5:1`, async ({ context, extensionId }) => {
      await stubToolbarPin(context, { pinned: false });
      await seedSettingsIfAbsent(context, { theme });
      const popup = await openPopup(context, extensionId);
      expect(await pageGround(popup)).toBe(palette.PRIMARY_COLOR);
      await openHelp(popup);
      await expect(help(popup)).toHaveAttribute('data-pin-state', 'unpinned');
      await expectReadable(help(popup), `${theme} Help`);
    });
  }
});
