import type { BrowserContext, Page, Worker } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { FULL, FULL_VIEW_PATH, openPage } from './fixtures/onboarding';
import { buildContainer, seedSessions, seedSettings } from './fixtures/seed';
import {
  card,
  cardAt,
  cardButton,
  closeReplayNote,
  nextTo,
  replayNote,
  runCheck,
  seedRawSettingsIfAbsent,
  startRunFromHelp,
  storedRun,
} from './fixtures/run';

// KAN-878 on the real build: a tab already pinned, that already pins in new windows, gets no pin card.

const PIN_CARD = '[data-coach-mark][data-coach-kind="twoViews"]';
const SETUP = 'Make Tab Keeper yours';

// Pins this page's own tab, as an earlier tour's Pin this tab left it.
async function pinOwnTab(serviceWorker: Worker, extensionId: string) {
  await serviceWorker.evaluate(async (id) => {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (
        tab.id !== undefined &&
        tab.url?.startsWith(`chrome-extension://${id}/`)
      ) {
        await chrome.tabs.update(tab.id, { pinned: true });
      }
    }
  }, extensionId);
}

// The card's count, as read aloud and as the line's fill.
async function expectCount(page: Page, n: number, total: number) {
  const line = card(page).getByRole('progressbar');
  await expect(line).toHaveAttribute('aria-valuetext', `Step ${n} of ${total}`);
  await expect
    .poll(() =>
      line
        .locator('[data-progress-fill]')
        .evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).a)
    )
    .toBeCloseTo(n / total, 3);
}

async function fullViewPage(
  context: BrowserContext,
  extensionId: string,
  pinsInNewWindows: boolean
): Promise<Page> {
  await seedSessions(context, buildContainer([]));
  await seedSettings(context, { pinTabKeeperInNewWindows: pinsInNewWindows });
  return openPage(context, extensionId, FULL_VIEW_PATH, FULL);
}

// From the first card to Windows, with an example as the run's session.
async function walkToWindows(page: Page) {
  await expect(cardAt(page, 1)).toBeVisible();
  await nextTo(page, 2);
  await nextTo(page, 3);
  await cardButton(page, 'Use an example').click();
  for (let step = 5; step <= 8; step++) await nextTo(page, step);
}

test('Help tour on a pinned tab that pins in new windows: 8 cards, Done on Windows, no pin card', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  const page = await fullViewPage(context, extensionId, true);
  await pinOwnTab(serviceWorker, extensionId);
  await startRunFromHelp(page);
  await walkToWindows(page);
  await expectCount(page, 8, 8);
  await expect(cardButton(page, 'Next')).toHaveCount(0);
  await expect(card(page).getByText('Skip tutorial')).toHaveCount(0);
  await cardButton(page, 'Done').click();
  await expect(replayNote(page)).toBeVisible();
  await expect(page.locator(PIN_CARD)).toHaveCount(0);
  expect(await storedRun(page)).toMatchObject({ ended: 'finished' });
});

test('Esc on that last card finishes the tour, as Done does', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  const page = await fullViewPage(context, extensionId, true);
  await pinOwnTab(serviceWorker, extensionId);
  await startRunFromHelp(page);
  await walkToWindows(page);
  await expectCount(page, 8, 8);
  await page.keyboard.press('Escape');
  await expect(replayNote(page)).toBeVisible();
  expect(await storedRun(page)).toMatchObject({ ended: 'finished' });
});

test('pinned with the setting off: the pin card is card 9 of 9', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  const page = await fullViewPage(context, extensionId, false);
  await pinOwnTab(serviceWorker, extensionId);
  await startRunFromHelp(page);
  await walkToWindows(page);
  await expectCount(page, 8, 9);
  await nextTo(page, 9);
  await expect(page.locator(PIN_CARD)).toBeVisible();
  await expectCount(page, 9, 9);
  await expect(cardButton(page, 'Pin this tab')).toBeVisible();
});

test('same tab: Pin this tab, then a Help replay skips the card', async ({
  context,
  extensionId,
}) => {
  const page = await fullViewPage(context, extensionId, false);
  await startRunFromHelp(page);
  await walkToWindows(page);
  await nextTo(page, 9);
  await cardButton(page, 'Pin this tab').click();
  await closeReplayNote(page);
  const setup = page.getByRole('dialog', { name: SETUP, exact: true });
  await expect(setup).toBeVisible();
  await setup.getByText('Skip setup', { exact: true }).click();
  await expect(setup).toHaveCount(0);
  await startRunFromHelp(page);
  await walkToWindows(page);
  await expectCount(page, 8, 8);
  await expect(cardButton(page, 'Done')).toBeVisible();
});

test.describe('after the popup tour', () => {
  test.use({ freshProfile: true });

  test('short tour on a pinned tab that pins in new windows: Find & fit is 2 of 2, with Done', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    await seedRawSettingsIfAbsent(context, {
      cloudConsent: 'granted',
      isAutoSync: false,
      isPinGuideDismissed: true,
      isFullViewCalloutSeen: true,
      pinTabKeeperInNewWindows: true,
      setupState: 'pending',
      firstRun: {
        view: 'popup',
        step: 7,
        sessionId: null,
        hello: 'welcome',
        welcomeShows: null,
        ended: 'finished',
      },
    });
    const page = await openPage(context, extensionId, FULL_VIEW_PATH, FULL);
    await runCheck(page, 'started');
    await pinOwnTab(serviceWorker, extensionId);
    // The tab was pinned after this page decided: a reload decides again.
    await page.reload();
    await runCheck(page, 'resumed');
    await expect(cardAt(page, 1)).toBeVisible();
    await expectCount(page, 1, 2);
    await nextTo(page, 2);
    await expectCount(page, 2, 2);
    await cardButton(page, 'Done').click();
    await expect(replayNote(page)).toBeVisible();
    await expect(page.locator(PIN_CARD)).toHaveCount(0);
  });
});
