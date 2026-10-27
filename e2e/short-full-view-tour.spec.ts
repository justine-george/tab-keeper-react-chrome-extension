import type { Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { openFullView, openPage, POPUP } from './fixtures/onboarding';
import {
  card,
  cardAt,
  cardButton,
  closeReplayNote,
  nextTo,
  runCheck,
  seedRawSettingsIfAbsent,
  startRunFromHelp,
  storedRun,
  storedTitles,
} from './fixtures/run';

// KAN-830 on the real build: after a started popup tour, the full view's first tour is its own three cards.

test.use({ freshProfile: true });

const ANSWERED = {
  cloudConsent: 'granted',
  isAutoSync: false,
  isPinGuideDismissed: true,
  isFullViewCalloutSeen: true,
};
// Stored as before KAN-830: no onlyFullViewSteps.
const popupRun = (step: number, ended: string | null) => ({
  view: 'popup',
  step,
  sessionId: null,
  hello: 'welcome',
  welcomeShows: step === 0 ? 5 : null,
  ended,
});
const setup = (page: Page) =>
  page.getByRole('dialog', { name: 'Make Tab Keeper yours', exact: true });

// The card's count, as read aloud and as the line's fill.
async function expectCount(page: Page, n: number, total: number) {
  const line = card(page).getByRole('progressbar');
  await expect(line).toHaveAttribute('aria-valuetext', `Step ${n} of ${total}`);
  await expect(line).toHaveAttribute('aria-valuemax', String(total));
  // The fill glides to its width: read it once it has.
  await expect
    .poll(() =>
      line
        .locator('[data-progress-fill]')
        .evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).a)
    )
    .toBeCloseTo(n / total, 3);
}

test('after a finished popup tour, the full view’s first tour is Currently open, Find & fit, Two views, counted 1–3 of 3', async ({
  context,
  extensionId,
}) => {
  await seedRawSettingsIfAbsent(context, {
    ...ANSWERED,
    setupState: 'pending',
    firstRun: popupRun(7, 'finished'),
  });
  const full = await openFullView(context, extensionId);
  await runCheck(full, 'started');
  await expect(cardAt(full, 1)).toHaveAttribute('data-coach-kind', 'openNow');
  await expectCount(full, 1, 3);
  await expect(cardButton(full, 'Back')).toHaveCount(0);
  await nextTo(full, 2);
  await expect(cardAt(full, 2)).toHaveAttribute(
    'data-coach-kind',
    'findAndFit'
  );
  await expectCount(full, 2, 3);
  await full.reload();
  await runCheck(full, 'resumed');
  await expect(cardAt(full, 2)).toBeVisible();
  await expectCount(full, 2, 3);
  await nextTo(full, 9);
  await expect(cardAt(full, 9)).toHaveAttribute('data-coach-kind', 'twoViews');
  await expectCount(full, 3, 3);
  await cardButton(full, 'Back').click();
  await expect(cardAt(full, 2)).toBeVisible();
  await nextTo(full, 9);
  await cardButton(full, 'Not now').click();
  await closeReplayNote(full);
  await expect(setup(full)).toBeVisible();
  expect(await storedRun(full)).toMatchObject({
    view: 'full',
    ended: 'finished',
    onlyFullViewSteps: true,
  });
});

test('a popup tour left partway with the example: the short tour ends by removing it', async ({
  context,
  extensionId,
}) => {
  await seedRawSettingsIfAbsent(context, {
    ...ANSWERED,
    setupState: 'pending',
  });
  const popup = await openPage(context, extensionId, 'index.html', POPUP);
  await startRunFromHelp(popup);
  await expect(cardAt(popup, 1)).toBeVisible();
  await cardButton(popup, 'Use an example').click();
  await expect(cardAt(popup, 2)).toBeVisible();
  await nextTo(popup, 3);
  await nextTo(popup, 4);
  const [example] = await storedTitles(popup);
  expect(await storedRun(popup)).toMatchObject({
    view: 'popup',
    step: 4,
    ended: null,
  });
  await popup.close();
  const full = await openFullView(context, extensionId);
  await runCheck(full, 'started');
  await expectCount(full, 1, 3);
  // CONTROL: the example is still in the list while the short tour runs.
  expect(await storedTitles(full)).toEqual([example]);
  await nextTo(full, 2);
  await nextTo(full, 9);
  await cardButton(full, 'Not now').click();
  await closeReplayNote(full);
  await expect.poll(() => storedTitles(full)).toEqual([]);
});

// CONTROL: the welcome alone is not a started tour.
test('an unanswered welcome still gets the whole tour', async ({
  context,
  extensionId,
}) => {
  await seedRawSettingsIfAbsent(context, {
    ...ANSWERED,
    setupState: 'pending',
    firstRun: popupRun(0, 'unanswered'),
  });
  const full = await openFullView(context, extensionId);
  await runCheck(full, 'started');
  await expect(cardAt(full, 1)).toBeVisible();
  await expectCount(full, 1, 9);
});

test('Help after the short tour runs all nine', async ({
  context,
  extensionId,
}) => {
  await seedRawSettingsIfAbsent(context, {
    ...ANSWERED,
    setupState: 'done',
    hasOpenedFullView: true,
    firstRun: {
      ...popupRun(9, 'finished'),
      view: 'full',
      onlyFullViewSteps: true,
    },
  });
  const full = await openFullView(context, extensionId);
  await runCheck(full, 'ended');
  await startRunFromHelp(full);
  await expect(cardAt(full, 1)).toBeVisible();
  await expectCount(full, 1, 9);
  await nextTo(full, 2);
  await nextTo(full, 3);
  await expectCount(full, 3, 9);
});
