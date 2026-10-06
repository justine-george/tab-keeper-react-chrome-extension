import type { BrowserContext, Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { buildContainer, buildSession } from './fixtures/seed';
import { stubToolbarPin } from './fixtures/toolbarPin';
import {
  FULL,
  FULL_VIEW_PATH,
  openFullView,
  openPage,
  openPopup,
  POPUP,
  storedSettings,
} from './fixtures/onboarding';
import {
  card,
  cardAt,
  cardButton,
  hello,
  nextTo,
  runCheck,
  runDrawn,
  seedRawSettingsIfAbsent,
  seedSessionsIfAbsent,
  startRunFromHelp,
  storedRun,
  storedTitles,
  watchRunDrawn,
} from './fixtures/run';

// §11 on the real build: every open resumes, reshows, or starts, and nothing is deleted on open.

test.use({ freshProfile: true });

const KEPT = buildContainer([
  buildSession({ tabGroupId: 'kept', title: 'Kept' }),
]);
const ANSWERED = {
  cloudConsent: 'granted',
  isAutoSync: false,
  isPinGuideDismissed: true,
  isFullViewCalloutSeen: true,
};
const running = (
  view: 'popup' | 'full',
  step: number,
  sessionId: string | null
) => ({
  view,
  step,
  sessionId,
  hello: 'welcome',
  welcomeShows: null,
  ended: null,
});

// The queue has decided every entry for this open.
const queueDone = (page: Page) =>
  expect(page.locator('html')).toHaveAttribute('data-first-open', /.+/);

async function popupRunAtStep(context: BrowserContext, step: number) {
  await seedRawSettingsIfAbsent(context, {
    ...ANSWERED,
    isWhatsNew2Seen: true,
    setupState: 'pending',
    firstRun: running('popup', step, 'kept'),
  });
  await seedSessionsIfAbsent(context, KEPT);
}

async function fullRunAtStep4(context: BrowserContext) {
  await seedRawSettingsIfAbsent(context, {
    ...ANSWERED,
    isWhatsNew2Seen: true,
    setupState: 'pending',
    firstRun: running('full', 4, 'kept'),
  });
  await seedSessionsIfAbsent(context, KEPT);
}

test('a popup run closed mid-step resumes at the same step on the next popup open', async ({
  context,
  extensionId,
}) => {
  await popupRunAtStep(context, 3);
  const first = await openPopup(context, extensionId);
  await runCheck(first, 'resumed');
  await expect(cardAt(first, 3)).toBeVisible();
  await nextTo(first, 4);
  await first.close();
  const again = await openPopup(context, extensionId);
  await runCheck(again, 'resumed');
  await expect(cardAt(again, 4)).toBeVisible();
});

test('a popup opened over a full view that runs the run shows nothing of it, and the full view runs on', async ({
  context,
  extensionId,
}) => {
  await fullRunAtStep4(context);
  await watchRunDrawn(context);
  const full = await openFullView(context, extensionId);
  await runCheck(full, 'resumed');
  await expect(cardAt(full, 4)).toBeVisible();
  const popup = await openPopup(context, extensionId);
  await runCheck(popup, 'otherView');
  await queueDone(popup);
  expect(await runDrawn(popup)).toEqual([]);
  // CONTROL: the same observer saw the full view's card.
  expect(await runDrawn(full)).toEqual(['card']);
  await nextTo(full, 5);
});

test('Help pressed in the popup while the full view runs: the popup takes the run, the full view stops quietly, nothing is deleted (Review Focus 3)', async ({
  context,
  extensionId,
}) => {
  await fullRunAtStep4(context);
  const full = await openFullView(context, extensionId);
  await expect(cardAt(full, 4)).toBeVisible();
  const popup = await openPopup(context, extensionId);
  await startRunFromHelp(popup);
  await expect(cardAt(popup, 1)).toBeVisible();
  await expect(card(full)).toHaveCount(0);
  await expect(full.locator('[data-coach-dim]')).toHaveCount(0);
  expect(await storedRun(popup)).toMatchObject({
    view: 'popup',
    step: 1,
    ended: null,
  });
  expect(await storedTitles(popup)).toEqual(['Kept']);
});

test('a second full view leaves the run to the first (R1)', async ({
  context,
  extensionId,
}) => {
  await fullRunAtStep4(context);
  await watchRunDrawn(context);
  const first = await openFullView(context, extensionId);
  await expect(cardAt(first, 4)).toBeVisible();
  const second = await openPage(context, extensionId, FULL_VIEW_PATH, FULL);
  await runCheck(second, 'elsewhere');
  await queueDone(second);
  expect(await runDrawn(second)).not.toContain('card');
  // CONTROL: closing the first frees the lock; a reload of the second resumes, and the same observer sees it.
  await first.close();
  await second.reload();
  await runCheck(second, 'resumed');
  await expect(cardAt(second, 4)).toBeVisible();
  expect(await runDrawn(second)).toContain('card');
});

// §12, controller ruling: setup and the guide come after the run, which only the lock holder shows.
for (const elsewhere of [true, false]) {
  test(
    elsewhere
      ? 'a second full view while the first runs the run draws no setup and no pin guide'
      : 'CONTROL: with no run running elsewhere, the same second full view draws setup',
    async ({ context, extensionId }) => {
      await stubToolbarPin(context, { pinned: false });
      await seedRawSettingsIfAbsent(context, {
        ...ANSWERED,
        isPinGuideDismissed: false,
        isWhatsNew2Seen: true,
        setupState: 'pending',
        firstRun: elsewhere
          ? running('full', 4, 'kept')
          : { ...running('full', 8, 'kept'), ended: 'finished' },
      });
      await seedSessionsIfAbsent(context, KEPT);
      await watchRunDrawn(context);
      const first = await openFullView(context, extensionId);
      await queueDone(first);
      const second = await openPage(context, extensionId, FULL_VIEW_PATH, FULL);
      await runCheck(second, elsewhere ? 'elsewhere' : 'ended');
      await queueDone(second);
      expect(await runDrawn(second)).toEqual(elsewhere ? [] : ['setup']);
    }
  );
}

test('a full view reloaded at Hello shows Hello again', async ({
  context,
  extensionId,
}) => {
  await seedRawSettingsIfAbsent(context, {
    ...ANSWERED,
    setupState: 'pending',
    firstRun: running('full', 0, null),
  });
  const full = await openFullView(context, extensionId);
  await expect(hello(full)).toBeVisible();
  await full.reload();
  await runCheck(full, 'resumed');
  await expect(hello(full)).toBeVisible();
});

test('R13: a Stay here user’s first full-view visit starts the run at step 1, never Hello; a later visit does not', async ({
  context,
  extensionId,
}) => {
  await seedRawSettingsIfAbsent(context, {
    ...ANSWERED,
    setupState: 'pending',
    firstRun: { ...running('popup', 7, null), ended: 'finished' },
  });
  await watchRunDrawn(context);
  const full = await openFullView(context, extensionId);
  await runCheck(full, 'started');
  await expect(cardAt(full, 1)).toBeVisible();
  await queueDone(full);
  // No Hello (CONTROL: the fresh full-view open below, same observer, sees it); the card is the CONTROL for the later visit.
  expect(await runDrawn(full)).toEqual(['card']);
  expect(await storedRun(full)).toMatchObject({
    view: 'full',
    step: 1,
    ended: null,
  });
  await cardButton(full, 'Skip tutorial').click();
  await expect.poll(() => storedRun(full)).toMatchObject({ ended: 'skipped' });
  await full.reload();
  await runCheck(full, 'ended');
  await queueDone(full);
  expect(await runDrawn(full)).not.toContain('card');
});

test('an upgrader: the popup starts nothing; the full view says What’s new, once', async ({
  context,
  extensionId,
}) => {
  await seedRawSettingsIfAbsent(context, { ...ANSWERED });
  await seedSessionsIfAbsent(context, KEPT);
  await watchRunDrawn(context);
  const popup = await openPopup(context, extensionId);
  await runCheck(popup, 'none');
  await queueDone(popup);
  expect(await runDrawn(popup)).toEqual([]);
  const full = await openFullView(context, extensionId);
  await runCheck(full, 'started');
  await expect(hello(full)).toHaveAccessibleName(
    "What's new in Tab Keeper 2.0"
  );
  // CONTROL: the same observer saw the full view's Hello.
  expect(await runDrawn(full)).toContain('hello');
  await hello(full)
    .getByRole('button', { name: 'Skip tutorial', exact: true })
    .click();
  await full.reload();
  await runCheck(full, 'ended');
});

test('Q8: a never-saved 1.9 user gets the 2.0 welcome in the popup, and their consent answer stays granted', async ({
  context,
  extensionId,
}) => {
  await seedRawSettingsIfAbsent(context, {
    cloudConsent: 'granted',
    isAutoSync: true,
  });
  const popup = await openPopup(context, extensionId);
  await expect(
    popup.getByRole('dialog', { name: 'Welcome to Tab Keeper', exact: true })
  ).toBeVisible();
  await runCheck(popup, 'started');
  const stored: unknown = await popup.evaluate(() =>
    JSON.parse(localStorage.getItem('settingsData') ?? '{}')
  );
  expect(stored).toMatchObject({
    cloudConsent: 'granted',
    setupState: 'pending',
    firstRun: { view: 'popup', step: 0, welcomeShows: 1 },
  });
});

test('unpinned and undismissed, a full view with a running run shows the run, never the pin guide', async ({
  context,
  extensionId,
}) => {
  await stubToolbarPin(context, { pinned: false });
  await seedRawSettingsIfAbsent(context, {
    ...ANSWERED,
    isPinGuideDismissed: false,
    isWhatsNew2Seen: true,
    firstRun: running('full', 1, null),
  });
  await watchRunDrawn(context);
  const full = await openFullView(context, extensionId);
  await runCheck(full, 'resumed');
  await expect(cardAt(full, 1)).toBeVisible();
  await queueDone(full);
  expect(await runDrawn(full)).toEqual(['card']);
  // CONTROL: once the run has ended, the same machine's next open draws the guide, and the same observer sees it.
  await cardButton(full, 'Skip tutorial').click();
  await expect.poll(() => storedRun(full)).toMatchObject({ ended: 'skipped' });
  await full.reload();
  await runCheck(full, 'ended');
  await expect(
    full.getByRole('dialog', {
      name: 'Pin Tab Keeper to your toolbar',
      exact: true,
    })
  ).toBeVisible();
  expect(await runDrawn(full)).toEqual(['pinGuide']);
});

test.describe('with no Web Locks', () => {
  test.beforeEach(async ({ context }) => {
    await context.addInitScript(() => {
      Reflect.deleteProperty(Navigator.prototype, 'locks');
    });
  });

  test('a recorded run is never resumed (R1)', async ({
    context,
    extensionId,
  }) => {
    await seedRawSettingsIfAbsent(context, {
      ...ANSWERED,
      isWhatsNew2Seen: true,
      firstRun: running('popup', 3, 'kept'),
    });
    await seedSessionsIfAbsent(context, KEPT);
    await watchRunDrawn(context);
    const popup = await openPopup(context, extensionId);
    await runCheck(popup, 'unknown');
    await queueDone(popup);
    expect(await runDrawn(popup)).toEqual([]);
    // CONTROL: the run still shows where it starts, and the same observer sees it.
    await startRunFromHelp(popup);
    await expect(cardAt(popup, 1)).toBeVisible();
    expect(await runDrawn(popup)).toEqual(['card']);
  });
});

test('no open deletes a session: a popup run on a sample, interrupted and reopened, keeps it (hard rule 4)', async ({
  context,
  extensionId,
}) => {
  await seedRawSettingsIfAbsent(context, {
    ...ANSWERED,
    isWhatsNew2Seen: true,
  });
  const popup = await openPopup(context, extensionId);
  await startRunFromHelp(popup);
  await cardButton(popup, 'Use an example').click();
  await expect(cardAt(popup, 2)).toBeVisible();
  const titles = await storedTitles(popup);
  expect(titles).toHaveLength(1);
  await popup.close();
  const again = await openPage(context, extensionId, 'index.html', POPUP);
  await runCheck(again, 'resumed');
  await expect(cardAt(again, 2)).toBeVisible();
  expect(await storedRun(again)).toMatchObject({ step: 2 });
  expect(await storedTitles(again)).toEqual(titles);
});

// The full view greets a new install with the run's Hello: the welcome and setup are never drawn.
test('a fresh profile whose first open is the full view gets Hello, never the welcome or setup', async ({
  context,
  extensionId,
}) => {
  await watchRunDrawn(context);
  const full = await openFullView(context, extensionId);
  await runCheck(full, 'started');
  await queueDone(full);
  await expect(hello(full)).toHaveAccessibleName('Welcome to Tab Keeper');
  expect(await runDrawn(full)).toEqual(['hello']);
  expect(await storedSettings(full)).toMatchObject({
    cloudConsent: 'declined',
    setupState: 'pending',
    firstRun: running('full', 0, null),
  });
  // Skip tutorial ends it as the welcome's Not now would have: skipped.
  await hello(full)
    .getByRole('button', { name: 'Skip tutorial', exact: true })
    .click();
  await expect.poll(() => storedRun(full)).toMatchObject({ ended: 'skipped' });
});

test('CONTROL: the same observer sees a fresh profile’s first popup open draw the welcome', async ({
  context,
  extensionId,
}) => {
  await watchRunDrawn(context);
  const popup = await openPopup(context, extensionId);
  await queueDone(popup);
  await expect(
    popup.getByRole('dialog', { name: 'Welcome to Tab Keeper', exact: true })
  ).toBeVisible();
  expect(await runDrawn(popup)).toEqual(['cloudConsent']);
});
