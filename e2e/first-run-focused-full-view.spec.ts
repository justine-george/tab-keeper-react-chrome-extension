import type { BrowserContext, Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { buildContainer } from './fixtures/seed';
import { FULL_VIEW_PATH, openFullView, openPopup } from './fixtures/onboarding';
import {
  compactViewCard,
  hello,
  pastCompactViewCard,
  runCheck,
  seedRawSettingsIfAbsent,
  seedSessionsIfAbsent,
  storedRun,
} from './fixtures/run';
import { stubToolbarPin } from './fixtures/toolbarPin';

// KAN-624. Start in the popup with a full view already open: the worker focuses
// that tab, and the run shows there without a reload.

test.use({ freshProfile: true });

const fullViews = (context: BrowserContext) =>
  context.pages().filter((p) => p.url().endsWith(FULL_VIEW_PATH));

// An Auto-Sync-off upgrader whose full view opened while the popup's What's new was unanswered.
async function fullViewWaitingOnPopupRun(
  context: BrowserContext,
  extensionId: string
): Promise<Page> {
  // Pinned, so the full view's open shows no pin guide over the run.
  await stubToolbarPin(context, { pinned: true });
  await seedRawSettingsIfAbsent(context, {
    cloudConsent: '',
    isAutoSync: false,
  });
  await seedSessionsIfAbsent(context, buildContainer());
  const first = await openPopup(context, extensionId);
  await expect(hello(first)).toHaveAccessibleName(
    "What's new in Tab Keeper 2.0"
  );
  await first.close();
  const full = await openFullView(context, extensionId);
  // CONTROL: the full view left the popup's run alone, so nothing shows here yet.
  await runCheck(full, 'otherView');
  await expect(compactViewCard(full)).toHaveCount(0);
  return full;
}

async function startFromPopup(
  context: BrowserContext,
  extensionId: string
): Promise<void> {
  const popup = await openPopup(context, extensionId);
  await hello(popup)
    .getByRole('button', { name: 'Start', exact: true })
    .click();
}

test('What’s new › Start with the full view open shows the run there, in the same tab', async ({
  context,
  extensionId,
}) => {
  const full = await fullViewWaitingOnPopupRun(context, extensionId);
  await startFromPopup(context, extensionId);
  await expect(compactViewCard(full)).toBeVisible();
  expect(fullViews(context)).toHaveLength(1);
  expect(await storedRun(full)).toMatchObject({
    view: 'full',
    step: 0,
    helloIn: 'popup',
    ended: null,
  });
  await pastCompactViewCard(full);
});

test('…and with Settings open there, it leaves Settings for the run', async ({
  context,
  extensionId,
}) => {
  const full = await fullViewWaitingOnPopupRun(context, extensionId);
  await full.locator('[aria-label="Settings"]').click();
  // CONTROL: Settings is what is showing before Start.
  await expect(
    full.getByRole('button', { name: 'Help', exact: true })
  ).toBeVisible();
  await startFromPopup(context, extensionId);
  await expect(compactViewCard(full)).toBeVisible();
});
