import type { Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { storedSettings, waitForFullView } from './fixtures/onboarding';
import { escapesPrevented, watchEscapes } from './fixtures/escapeProbe';
import {
  buildContainer,
  buildSession,
  seedSessions,
  seedSettings,
} from './fixtures/seed';
import {
  POPUP_RUN,
  card,
  cardAt,
  cardButton,
  cardSide,
  nextTo,
  openRunFromHelp,
  openRunFromHelpIn,
  storedRun,
  storedTitles,
} from './fixtures/run';
import { COACH } from '../src/components/tour/coachMarkPlacement';

// §4 on the real build, from Help: 7 cards in the popup, ending on ⤢.

async function toStepTwo(page: Page) {
  await expect.poll(() => cardSide(page)).toBe('right');
  await expect(cardButton(page, 'Back')).toHaveCount(0);
  await cardButton(page, 'Use an example').click();
  await expect(cardAt(page, 2)).toBeVisible();
}

// A row's Open as drawn: its filter, and whether it says it is unavailable.
const openLook = (page: Page, id: string) =>
  page
    .locator(
      `[data-pane="sessions"] [data-drag-row-id="${id}"] [data-tour-anchor="row-open"]`
    )
    .evaluate((el) => [
      getComputedStyle(el).filter,
      el.getAttribute('aria-disabled'),
    ]);

test('the seven cards in their places, then Done; the callout is marked seen; nothing opens after', async ({
  context,
  extensionId,
}) => {
  const page = await openRunFromHelp(context, extensionId, POPUP_RUN);
  await toStepTwo(page);
  for (const [step, side] of [
    [2, 'below'],
    [3, 'below'],
    [4, 'below'],
    [5, 'below'],
    [6, 'left'],
    [7, 'below'],
  ] as const) {
    if (step > 2) await nextTo(page, step);
    await expect.poll(() => cardSide(page)).toBe(side);
    // Step 6 sits in the left pane, 40px in, as the popup mock places it (A2).
    if (step === 6) {
      await expect
        .poll(async () => (await card(page).boundingBox())?.x)
        .toBe(COACH.POPUP_LEFT);
    }
  }
  await expect(cardButton(page, 'Skip tutorial')).toHaveCount(0);
  await cardButton(page, 'Done').click();
  await expect(card(page)).toHaveCount(0);
  await expect
    .poll(() => storedRun(page))
    .toMatchObject({ view: 'popup', ended: 'finished' });
  expect((await storedSettings(page)).isFullViewCalloutSeen).toBe(true);
  await expect(page.locator('dialog:modal')).toHaveCount(0);
  await expect.poll(() => storedTitles(page)).toEqual([]);
});

test('⤢ at step 7 ends the run, then opens the full view', async ({
  context,
  extensionId,
}) => {
  const page = await openRunFromHelp(context, extensionId, POPUP_RUN);
  await toStepTwo(page);
  for (let step = 3; step <= 7; step++) await nextTo(page, step);
  await page.locator('[data-tour-anchor="expand"] [role="button"]').click();
  const full = await waitForFullView(context);
  await expect
    .poll(() => storedRun(full))
    .toMatchObject({ view: 'popup', ended: 'finished' });
});

test('in German, Use an example adds the sample under its German name', async ({
  context,
  extensionId,
}) => {
  await seedSettings(context, { language: 'de' });
  const page = await openRunFromHelpIn(context, extensionId, POPUP_RUN, 'de');
  await cardButton(page, 'Beispiel verwenden').click();
  await expect(cardAt(page, 2)).toBeVisible();
  await expect
    .poll(() => storedTitles(page))
    .toEqual(['Beispiel: Wochenendreise']);
});

test('Esc on a card is Skip tutorial, and is prevented so the popup stays (KAN-403)', async ({
  context,
  extensionId,
}) => {
  await watchEscapes(context);
  const page = await openRunFromHelp(context, extensionId, POPUP_RUN);
  await toStepTwo(page);
  await page.keyboard.press('Escape');
  await expect.poll(() => storedRun(page)).toMatchObject({ ended: 'skipped' });
  expect(await escapesPrevented(page)).toEqual([true]);
  await expect.poll(() => storedTitles(page)).toEqual([]);
});

test('the user’s own session keeps an undimmed Open through and after the run', async ({
  context,
  extensionId,
}) => {
  await seedSessions(
    context,
    buildContainer([buildSession({ tabGroupId: 'kept', title: 'Kept' })])
  );
  const page = await openRunFromHelp(context, extensionId, POPUP_RUN);
  await toStepTwo(page);
  const run = await storedRun(page);
  const sample =
    typeof run === 'object' && run !== null
      ? Reflect.get(run, 'sessionId')
      : null;
  if (typeof sample !== 'string') throw new Error('the run has no session');
  // CONTROL: the run's own session's Open is dimmed and blocked at step 2.
  expect(await openLook(page, sample)).toEqual(['opacity(0.3)', 'true']);
  for (let step = 3; step <= 7; step++) await nextTo(page, step);
  await cardButton(page, 'Done').click();
  await expect(card(page)).toHaveCount(0);
  await expect.poll(() => storedTitles(page)).toEqual(['Kept']);
  expect(await openLook(page, 'kept')).toEqual(['none', null]);
});
