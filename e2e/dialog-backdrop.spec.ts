import type { Locator } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { buildContainer, seedSessions, seedSettings } from './fixtures/seed';
import { openFullView } from './fixtures/onboarding';
import { stubToolbarPin } from './fixtures/toolbarPin';
import { FULL_AT_HELLO, hello } from './fixtures/run';

// KAN-588. A dialog dims the page by its theme (D2): 40% black on the light
// grounds, 55% on the dark, where every dialog used to dim 80% on all of them.

const backdrop = (dialog: Locator) =>
  dialog.evaluate((el) => getComputedStyle(el, '::backdrop').backgroundColor);

const setup = (page: import('@playwright/test').Page) =>
  page.getByRole('dialog', { name: 'Make Tab Keeper yours', exact: true });

test('setup dims the page by the theme, and follows a theme picked in it', async ({
  context,
  extensionId,
}) => {
  await stubToolbarPin(context, { pinned: true });
  await seedSessions(context, buildContainer());
  await seedSettings(context, { setupState: 'pending', theme: 'Light' });
  const page = await openFullView(context, extensionId);
  await expect(setup(page)).toBeVisible();
  expect(await backdrop(setup(page))).toBe('rgba(0, 0, 0, 0.4)');

  // Graphite, picked in setup, applies at once, backdrop included.
  await setup(page).getByRole('button', { name: 'Graphite' }).click();
  await expect.poll(() => backdrop(setup(page))).toBe('rgba(0, 0, 0, 0.55)');
});

test('another dialog, the full view’s Hello, takes the same dim', async ({
  context,
  extensionId,
}) => {
  await seedSettings(context, {
    theme: 'Darkenheimer',
    firstRun: FULL_AT_HELLO,
  });
  const page = await openFullView(context, extensionId);
  await expect(hello(page)).toBeVisible();
  expect(await backdrop(hello(page))).toBe('rgba(0, 0, 0, 0.55)');
});
