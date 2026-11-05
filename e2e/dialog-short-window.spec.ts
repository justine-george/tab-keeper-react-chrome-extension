import type { Locator, Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { hasCloudConfig } from './fixtures/cloud';
import { openFullView, openPopup } from './fixtures/onboarding';
import {
  boxOf,
  openSaved,
  savedWindow,
  session,
} from './fixtures/savedWindows';
import { buildContainer, seedSessions, seedSettings } from './fixtures/seed';
import { focusConfirm } from './fixtures/sessionActions';
import { stubToolbarPin } from './fixtures/toolbarPin';

// KAN-803. A dialog taller than the window scrolls inside a 16px margin instead of running off both edges.
const SHORT = { width: 790, height: 140 };
const DAY = 86_400_000;

async function expectFitsAndScrolls(
  page: Page,
  dialog: Locator,
  { size = SHORT, top = 16 } = {}
) {
  await page.setViewportSize(size);
  await expect
    .poll(async () => {
      const box = await boxOf(dialog);
      return [box.y, box.y + box.height];
    })
    .toEqual([top, size.height - 16]);
  // PREMISE: the content is taller than the window, so this is the short-window case.
  const { scrollHeight, clientHeight } = await dialog.evaluate((el) => ({
    scrollHeight: el.scrollHeight,
    clientHeight: el.clientHeight,
  }));
  expect(scrollHeight).toBeGreaterThan(clientHeight);
  // The last button is reachable.
  await dialog.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  const last = dialog.getByRole('button').last();
  const box = await boxOf(last);
  expect(box.y + box.height).toBeLessThanOrEqual(size.height - 16);
}

test('the Switch confirm scrolls inside a short window', async ({
  context,
  extensionId,
}) => {
  const page = await openSaved(context, extensionId, 'popup', {
    sessions: [
      session('S1', 'Trip', [savedWindow('w1', 'Reading', 2)]),
      session('S2', 'Bravo', [savedWindow('w2', 'Notes', 1)]),
    ],
  });
  await page.getByRole('button', { name: 'Switch', exact: true }).click();
  await expect(focusConfirm(page)).toBeVisible();

  await expectFitsAndScrolls(page, focusConfirm(page));
});

test('the cloud question scrolls inside a short window', async ({
  context,
  extensionId,
}) => {
  test.skip(!hasCloudConfig(), 'this build has no cloud config (CI)');
  await seedSessions(context, buildContainer());
  await seedSettings(context, {
    cloudConsent: '',
    extensionInstalledTime: Date.now() - 30 * DAY,
  });
  const page = await openPopup(context, extensionId);
  const ask = page.getByRole('dialog', {
    name: 'Your sessions are currently synced',
  });
  await expect(ask).toBeVisible();

  await expectFitsAndScrolls(page, ask);
});

test('the pin guide scrolls below its arrow in a short window', async ({
  context,
  extensionId,
}) => {
  await stubToolbarPin(context, { pinned: false });
  await seedSettings(context, { isPinGuideDismissed: false });
  const page = await openFullView(context, extensionId);
  const guide = page.getByRole('dialog', {
    name: 'Pin Tab Keeper to your toolbar',
    exact: true,
  });
  await expect(guide).toBeVisible();

  await expectFitsAndScrolls(page, guide, {
    size: { width: 790, height: 300 },
    top: 96,
  });
});
