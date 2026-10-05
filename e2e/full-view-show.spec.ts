import type { Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import {
  openFullView,
  openPopup,
  storedSettings,
  waitForFullView,
} from './fixtures/onboarding';

// KAN-7, through the real worker: the popup asks, the full view shows.

const setup = (page: Page) =>
  page.getByRole('dialog', { name: 'Make Tab Keeper yours', exact: true });
const guide = (page: Page) =>
  page.getByRole('dialog', {
    name: 'Pin Tab Keeper to your toolbar',
    exact: true,
  });

const ask = (page: Page, show: 'setup' | 'pinGuide') =>
  page.evaluate(
    (show) =>
      chrome.runtime.sendMessage({
        type: 'openInTab',
        windowId: undefined,
        show,
      }),
    show
  );

test('no full view open: one opens on setup’s first step, and its address forgets the request', async ({
  context,
  extensionId,
}) => {
  const popup = await openPopup(context, extensionId);
  await ask(popup, 'setup');
  const full = await waitForFullView(context);
  await expect(setup(full)).toBeVisible();
  await expect(setup(full).getByRole('heading', { level: 3 })).toHaveText(
    'Pick a theme'
  );
  await expect(full.locator('html')).toHaveAttribute(
    'data-first-open',
    'setup'
  );
  expect(full.url().endsWith('index.html?view=tab')).toBe(true);
  expect((await storedSettings(full)).setupState).toBe('pending');
});

test('a full view already open is focused and shows the pin guide, dismissed or not', async ({
  context,
  extensionId,
}) => {
  const full = await openFullView(context, extensionId);
  await expect(full.locator('html')).toHaveAttribute('data-first-open', 'none');
  const popup = await openPopup(context, extensionId);
  await ask(popup, 'pinGuide');
  await expect(guide(full)).toBeVisible();
  expect((await storedSettings(full)).isPinGuideDismissed).toBe(true);
  expect(
    context.pages().filter((p) => p.url().includes('view=tab'))
  ).toHaveLength(1);
});
