import type { BrowserContext, Page, Worker } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { buildContainer, buildSession } from './fixtures/seed';
import {
  openFullView,
  openPopup,
  twoFrames,
  waitForFullView,
} from './fixtures/onboarding';
import { stubToolbarPin } from './fixtures/toolbarPin';
import {
  FULL_VIEW,
  TestTabs,
  notTheOpen,
  notTheRunsOwn,
  tabIdOf,
  tabLog,
  watchTabs,
  type RunMay,
} from './fixtures/tabObserver';
import {
  card,
  cardAt,
  cardButton,
  centreOf,
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

// §14 on the real build: each persona's whole first run, with nothing touched but the run's own tab.

test.use({ freshProfile: true });

const welcome = (page: Page) =>
  page.getByRole('dialog', { name: 'Welcome to Tab Keeper', exact: true });
const setup = (page: Page) =>
  page.getByRole('dialog', { name: 'Make Tab Keeper yours', exact: true });
const guide = (page: Page) =>
  page.getByRole('dialog', {
    name: 'Pin Tab Keeper to your toolbar',
    exact: true,
  });
// Newest first, as the app stores them: any save re-sorts an older-first list.
const KEPT = buildContainer([
  buildSession({ tabGroupId: 'new', title: 'Latest', createdAt: 2000 }),
  buildSession({ tabGroupId: 'old', title: 'Older', createdAt: 1000 }),
]);
// A user past every first-open question, so only the run under test shows.
const SETTLED = {
  cloudConsent: 'declined',
  isWhatsNew2Seen: true,
  setupState: 'done',
  hasOpenedFullView: true,
  isPinGuideDismissed: true,
  isFullViewCalloutSeen: true,
};
const SAVE_ALL = 'Save all open windows as a session';

// The link, not the ✕: both are named Skip setup.
async function skipSetupThenGuide(page: Page) {
  await expect(setup(page)).toBeVisible();
  await setup(page).getByText('Skip setup', { exact: true }).click();
  await expect(guide(page)).toBeVisible();
  await guide(page).getByRole('button', { name: 'Skip', exact: true }).click();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
}

// Saved outside the run, for a CONTROL that needs a row.
async function saveNow(page: Page) {
  const rows = page.locator('[data-pane="sessions"] [data-drag-row-id]');
  const before = await rows.count();
  await page
    .locator('[data-pane="sessions"] [data-tour-anchor="save"]')
    .getByRole('button', { name: SAVE_ALL, exact: true })
    .click();
  await expect(rows).toHaveCount(before + 1);
}

// §14's negative, read after the caller's barrier and two frames; then its CONTROL: the same observer, in the same profile, records a row's Open, and only that.
async function expectOnlyTheRunsOwn(
  page: Page,
  worker: Worker,
  tests: TestTabs,
  may: RunMay
): Promise<string[]> {
  await twoFrames(page);
  const before = (await tabLog(worker)).length;
  const row = page.locator('[data-pane="sessions"] [data-drag-row-id]').first();
  await row.hover();
  await page.mouse.click(
    ...(await centreOf(row.locator('[data-tour-anchor="row-open"]')))
  );
  // Grown, then quiet across two reads, so nothing the Open set off is still on its way.
  let last = -1;
  await expect
    .poll(
      async () => {
        const now = (await tabLog(worker)).length;
        const quiet = now > before && now === last;
        last = now;
        return quiet;
      },
      { intervals: [250] }
    )
    .toBe(true);
  const log = await tabLog(worker);
  expect(notTheRunsOwn(log.slice(0, before), tests, may)).toEqual([]);
  const control = log.slice(before);
  expect(
    control.filter((e) => /^created \d+/.test(e)).length,
    'CONTROL: the observer records the Open'
  ).toBeGreaterThan(0);
  expect(notTheOpen(control)).toEqual([]);
  await page.bringToFront();
  return log.slice(0, before);
}

const NOTHING: RunMay = { fullView: false, pin: false };

// The same negative as soon as the run's full view shows; the closing CONTROL proves this observer live.
async function expectNothingElseYet(
  page: Page,
  worker: Worker,
  tests: TestTabs
) {
  await twoFrames(page);
  expect(
    notTheRunsOwn(await tabLog(worker), tests, { fullView: true, pin: false })
  ).toEqual([]);
}

test('new install, Get started, each step done by hand; then setup, then the pin guide; only the run’s own tab is touched', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  await stubToolbarPin(context, { pinned: false });
  await watchTabs(serviceWorker);
  const tests = new TestTabs();
  const popup = await openPopup(context, extensionId);
  await tests.add(popup);
  await welcome(popup)
    .getByRole('button', { name: 'Get started', exact: true })
    .click();
  const full = await waitForFullView(context);
  await expectNothingElseYet(full, serviceWorker, tests);
  await expect(cardAt(full, 1)).toBeVisible();
  await nextTo(full, 2);
  const search = full.locator(
    '[data-pane="open-now"] [data-open-now-search] input'
  );
  await search.fill('blank');
  await search.fill('');
  await nextTo(full, 3);
  await full
    .locator('[data-pane="sessions"] [data-tour-anchor="save"]')
    .getByRole('button', { name: SAVE_ALL, exact: true })
    .click();
  await expect(cardAt(full, 4)).toBeVisible();
  for (let step = 5; step <= 8; step++) await nextTo(full, step);
  await cardButton(full, 'Pin this tab').click();
  await skipSetupThenGuide(full);
  expect(await storedRun(full)).toMatchObject({ ended: 'finished' });
  expect(await storedTitles(full)).toHaveLength(1);
  const log = await expectOnlyTheRunsOwn(full, serviceWorker, tests, {
    fullView: true,
    pin: true,
  });
  // Exactly one pin, on the run's own full view.
  expect(log.filter((e) => e.startsWith('pinned '))).toEqual([
    `pinned true ${await tabIdOf(full)} ${FULL_VIEW}`,
  ]);
});

test('new install, Get started, Next only (Use an example): the sample is gone after the run', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  await stubToolbarPin(context, { pinned: false });
  await watchTabs(serviceWorker);
  const tests = new TestTabs();
  const popup = await openPopup(context, extensionId);
  await tests.add(popup);
  await welcome(popup)
    .getByRole('button', { name: 'Get started', exact: true })
    .click();
  const full = await waitForFullView(context);
  await expectNothingElseYet(full, serviceWorker, tests);
  await expect(cardAt(full, 1)).toBeVisible();
  for (let step = 2; step <= 3; step++) await nextTo(full, step);
  await cardButton(full, 'Use an example').click();
  await expect(cardAt(full, 4)).toBeVisible();
  expect(await storedTitles(full)).toEqual(['Sample: Weekend trip']);
  for (let step = 5; step <= 8; step++) await nextTo(full, step);
  await cardButton(full, 'Not now').click();
  await skipSetupThenGuide(full);
  await expect.poll(() => storedTitles(full)).toEqual([]);
  await saveNow(full);
  await expectOnlyTheRunsOwn(full, serviceWorker, tests, {
    fullView: true,
    pin: false,
  });
});

test('new install, Not now: the popup run to ⤢, then the first full-view visit runs the run from step 1, setup and the pin guide', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  await stubToolbarPin(context, { pinned: false });
  await watchTabs(serviceWorker);
  const tests = new TestTabs();
  const popup = await openPopup(context, extensionId);
  await tests.add(popup);
  await welcome(popup)
    .getByRole('button', { name: 'Not now', exact: true })
    .click();
  await expect(cardAt(popup, 1)).toBeVisible();
  await cardButton(popup, 'Use an example').click();
  await expect(cardAt(popup, 2)).toBeVisible();
  for (let step = 3; step <= 7; step++) await nextTo(popup, step);
  await popup.locator('[data-tour-anchor="expand"] [role="button"]').click();
  const full = await waitForFullView(context);
  await runCheck(full, 'started');
  await expectNothingElseYet(full, serviceWorker, tests);
  await expect(cardAt(full, 1)).toBeVisible();
  for (let step = 2; step <= 3; step++) await nextTo(full, step);
  // R10: the popup run's sample is gone, so step 3 is the save card again.
  await expect(cardButton(full, 'Use an example')).toBeVisible();
  await cardButton(full, 'Use an example').click();
  await expect(cardAt(full, 4)).toBeVisible();
  for (let step = 5; step <= 8; step++) await nextTo(full, step);
  await cardButton(full, 'Not now').click();
  await skipSetupThenGuide(full);
  await expect.poll(() => storedTitles(full)).toEqual([]);
  await saveNow(full);
  await expectOnlyTheRunsOwn(full, serviceWorker, tests, {
    fullView: true,
    pin: false,
  });
});

// What's new on the latest session: step 3 with no save, then Not now, setup and the guide.
async function upgraderRun(full: Page) {
  await expect(hello(full)).toHaveAccessibleName(
    "What's new in Tab Keeper 2.0"
  );
  await hello(full).getByRole('button', { name: 'Start', exact: true }).click();
  for (let step = 2; step <= 3; step++) await nextTo(full, step);
  await expect(card(full)).toContainText(
    'Your saved sessions are all here, just as you left them.'
  );
  for (let step = 4; step <= 8; step++) await nextTo(full, step);
  expect(await storedRun(full)).toMatchObject({ sessionId: 'new' });
  await cardButton(full, 'Not now').click();
  await skipSetupThenGuide(full);
  // Review Focus 5: the run's session is the upgrader's own, and stays.
  expect(await storedTitles(full)).toEqual(['Latest', 'Older']);
}

test('synced upgrader: the sync question first, then What’s new on the latest session, step 3 with no save, then setup', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  await stubToolbarPin(context, { pinned: false });
  await seedRawSettingsIfAbsent(context, {
    cloudConsent: '',
    isAutoSync: true,
  });
  await seedSessionsIfAbsent(context, KEPT);
  await watchRunDrawn(context);
  await watchTabs(serviceWorker);
  const tests = new TestTabs();
  const popup = await openPopup(context, extensionId);
  await tests.add(popup);
  const ask = popup.getByRole('dialog', {
    name: 'Your sessions are currently synced',
    exact: true,
  });
  await expect(ask).toBeVisible();
  // The CONTROL for the Auto-Sync-off upgrader's "no question".
  expect(await runDrawn(popup)).toEqual(['cloudConsent']);
  await ask.getByRole('button', { name: 'Turn off sync', exact: true }).click();
  const full = await openFullView(context, extensionId);
  await tests.add(full);
  await upgraderRun(full);
  await expectOnlyTheRunsOwn(full, serviceWorker, tests, NOTHING);
});

test('Auto-Sync-off upgrader: no question, then the same run', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  await stubToolbarPin(context, { pinned: false });
  await seedRawSettingsIfAbsent(context, {
    cloudConsent: '',
    isAutoSync: false,
  });
  await seedSessionsIfAbsent(context, KEPT);
  await watchRunDrawn(context);
  await watchTabs(serviceWorker);
  const tests = new TestTabs();
  const popup = await openPopup(context, extensionId);
  await tests.add(popup);
  await expect(popup.locator('html')).toHaveAttribute('data-first-open', /.+/);
  expect(await runDrawn(popup)).toEqual([]);
  const full = await openFullView(context, extensionId);
  await tests.add(full);
  await upgraderRun(full);
  // CONTROL: the same observer, in this profile, saw the full view's Hello.
  expect(await runDrawn(full)).toEqual(
    expect.arrayContaining(['card', 'hello'])
  );
  await expectOnlyTheRunsOwn(full, serviceWorker, tests, NOTHING);
});

const openView = (
  context: BrowserContext,
  extensionId: string,
  view: 'popup' | 'full'
) =>
  view === 'popup'
    ? openPopup(context, extensionId)
    : openFullView(context, extensionId);

// Skip on every card the run can skip from, in both views, with the user's own sessions kept.
for (const [view, last] of [
  ['popup', 7],
  ['full', 8],
] as const) {
  for (let at = view === 'full' ? 0 : 1; at < last; at++) {
    test(`${view}: Skip at step ${at} ends the run for good, keeps the user’s sessions and touches no tab; Help runs it again`, async ({
      context,
      extensionId,
      serviceWorker,
    }) => {
      await seedRawSettingsIfAbsent(context, SETTLED);
      await seedSessionsIfAbsent(context, KEPT);
      await watchRunDrawn(context);
      await watchTabs(serviceWorker);
      const tests = new TestTabs();
      const page = await openView(context, extensionId, view);
      await tests.add(page);
      await startRunFromHelp(page);
      if (at === 0) {
        await hello(page)
          .getByRole('button', { name: 'Skip tutorial', exact: true })
          .click();
      } else {
        if (view === 'full') {
          await hello(page)
            .getByRole('button', { name: 'Start', exact: true })
            .click();
        }
        await expect(cardAt(page, 1)).toBeVisible();
        for (let step = 1; step < at; step++) {
          const example = cardButton(page, 'Use an example');
          await ((await example.isVisible())
            ? example
            : cardButton(page, 'Next')
          ).click();
          await expect(cardAt(page, step + 1)).toBeVisible();
        }
        await cardButton(page, 'Skip tutorial').click();
      }
      await expect
        .poll(() => storedRun(page))
        .toMatchObject({ ended: 'skipped' });
      // Review Focus 5: Skip removes only the run's example.
      await expect.poll(() => storedTitles(page)).toEqual(['Latest', 'Older']);

      await tests.close(page);
      const again = await openView(context, extensionId, view);
      await tests.add(again);
      await runCheck(again, 'ended');
      expect(await runDrawn(again)).toEqual([]);
      await expectOnlyTheRunsOwn(again, serviceWorker, tests, NOTHING);

      // CONTROL, and §14's "Help after Skip": the same observer sees Help start it again.
      await startRunFromHelp(again);
      if (view === 'full') {
        await expect(hello(again)).toBeVisible();
        await hello(again)
          .getByRole('button', { name: 'Start', exact: true })
          .click();
      }
      await expect(cardAt(again, 1)).toBeVisible();
      expect(await runDrawn(again)).toContain('card');
    });
  }
}

const running = (view: 'popup' | 'full', step: number) => ({
  view,
  step,
  sessionId: step >= (view === 'popup' ? 2 : 4) ? 'new' : null,
  hello: 'welcome',
  welcomeShows: null,
  ended: null,
});

for (let at = 1; at <= 7; at++) {
  test(`popup closed at step ${at}: the next open shows step ${at}`, async ({
    context,
    extensionId,
  }) => {
    await seedRawSettingsIfAbsent(context, {
      ...SETTLED,
      firstRun: running('popup', at),
    });
    await seedSessionsIfAbsent(context, KEPT);
    const first = await openPopup(context, extensionId);
    await runCheck(first, 'resumed');
    await expect(cardAt(first, at)).toBeVisible();
    await first.close();
    const again = await openPopup(context, extensionId);
    await runCheck(again, 'resumed');
    await expect(cardAt(again, at)).toBeVisible();
  });
}

for (let at = 1; at <= 8; at++) {
  test(`full view reloaded, then closed and reopened, at step ${at}: the same step shows`, async ({
    context,
    extensionId,
  }) => {
    await seedRawSettingsIfAbsent(context, {
      ...SETTLED,
      firstRun: running('full', at),
    });
    await seedSessionsIfAbsent(context, KEPT);
    const full = await openFullView(context, extensionId);
    await runCheck(full, 'resumed');
    await expect(cardAt(full, at)).toBeVisible();
    await full.reload();
    await runCheck(full, 'resumed');
    await expect(cardAt(full, at)).toBeVisible();
    await full.close();
    const again = await openFullView(context, extensionId);
    await runCheck(again, 'resumed');
    await expect(cardAt(again, at)).toBeVisible();
  });
}
