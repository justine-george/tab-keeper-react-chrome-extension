import type { BrowserContext, Locator, Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import {
  RUN_FINISHED,
  buildContainer,
  buildSession,
  seedSessions,
  seedSettings,
} from './fixtures/seed';
import { stubToolbarPin } from './fixtures/toolbarPin';
import { FULL, POPUP, openPage, storedSettings } from './fixtures/onboarding';
import {
  FULL_RUN,
  POPUP_RUN,
  cardAt,
  cardButton,
  closeReplayNote,
  endingCard,
  nextTo,
  openRunFromHelp,
  runCheck,
  startRunFromHelp,
  walkFullRunToLastStep,
} from './fixtures/run';
import { saveRowSaveAll } from './fixtures/sessionActions';

// KAN-879 on the real build: the onboarding's last card, once per view, never on a replay.

const setup = (page: Page) =>
  page.getByRole('dialog', { name: 'Make Tab Keeper yours', exact: true });
const guide = (page: Page) =>
  page.getByRole('dialog', {
    name: 'Pin Tab Keeper to your toolbar',
    exact: true,
  });
const SAVE = '[data-pane="sessions"] [data-tour-anchor="save"]';
const ENGAGED_OPEN =
  '[data-pane="sessions"] [data-run-engaged] [data-tour-anchor="row-open"]';
// The release waits 300ms after the page settles; a card that has not shown in this long never will.
// Every positive below shows within it, which is what makes the negatives' wait mean something.
const WINDOW = 3000;

const LINES = {
  typed: [
    "You're all set. Lisbon trip is saved.",
    'Open brings its tabs back, any time.',
    'Have a good day!',
  ],
  suggested: [
    "You're all set. Your tabs are saved here.",
    'Open brings them back, any time.',
    'Have a good day!',
  ],
  nothingSaved: [
    "You're all set.",
    'Save your tabs here whenever you like.',
    'Have a good day!',
  ],
} as const;
type Wording = keyof typeof LINES;

const doc = (title: string) =>
  `data:text/html;charset=utf-8,<title>${encodeURIComponent(title)}</title>`;

// Tabs to save, the first named so a suggested name reads as a real one.
async function openTabs(context: BrowserContext): Promise<void> {
  for (const title of ['Weekend in Lisbon', 'Tram 28 route']) {
    const tab = await context.newPage();
    await tab.goto(doc(title));
  }
}

// What covers the page, each change in order, from before the first page loads.
async function watchCovers(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    if (window.top !== window) return;
    const log: string[] = [];
    Object.defineProperty(window, '__covers', { value: log });
    const read = () => {
      const parts: string[] = [];
      if (document.querySelector('dialog[open]:has([data-pin-why])'))
        parts.push('guide');
      if (
        document.querySelector('[data-coach-kind="ending"]:not([aria-hidden])')
      )
        parts.push('ending');
      const now = parts.join('+') || 'clear';
      if (log[log.length - 1] !== now) log.push(now);
    };
    new MutationObserver(read).observe(document, {
      subtree: true,
      childList: true,
      attributes: true,
    });
  });
}

const covers = async (page: Page): Promise<string[]> =>
  page.evaluate(() => {
    const log: unknown = Reflect.get(window, '__covers');
    return Array.isArray(log)
      ? log.map(String).filter((c) => c !== 'clear')
      : [];
  });

// After the trigger, the full window passes and the card never drew. Each positive is the control.
async function expectNoEnding(page: Page): Promise<void> {
  await page.waitForTimeout(WINDOW);
  expect(await covers(page)).not.toContain('ending');
  await expect(endingCard(page)).toHaveCount(0);
}

const cardLines = async (page: Page) =>
  (await endingCard(page).locator('p').first().innerText()).split('\n');

// The card says these words and its ring sits on `anchor`; nothing is dimmed.
async function expectEnding(
  page: Page,
  wording: Wording,
  anchor: Locator
): Promise<void> {
  await expect(endingCard(page)).toBeVisible({ timeout: WINDOW });
  await expect.poll(() => cardLines(page)).toEqual(LINES[wording]);
  await expect(anchor).toHaveCount(1);
  await expect
    .poll(async () => {
      const a = await anchor.boundingBox();
      const r = await page.locator('[data-coach-ring]').boundingBox();
      if (a === null || r === null) return null;
      return Math.max(
        Math.abs(a.x + a.width / 2 - (r.x + r.width / 2)),
        Math.abs(a.y + a.height / 2 - (r.y + r.height / 2))
      );
    })
    .toBeLessThan(1);
  await expect(page.locator('[data-coach-dim]')).toHaveCount(0);
}

// The engaged row's Open, in the row titled `title`.
const openOn = (page: Page, title: string) =>
  page
    .locator('[data-pane="sessions"] [data-drag-row-id]', { hasText: title })
    .locator('[data-run-engaged] [data-tour-anchor="row-open"]');

async function finishSetupWithDone(page: Page): Promise<void> {
  await expect(setup(page)).toBeVisible();
  for (let n = 0; n < 4; n++)
    await setup(page)
      .getByRole('button', { name: 'Next', exact: true })
      .click();
  await setup(page).getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.locator('dialog:modal')).toHaveCount(0);
}

// A full-view run resumed at its first card, setup pending as a new install's is.
async function openRunningFullView(
  context: BrowserContext,
  extensionId: string,
  settings: Record<string, unknown> = {}
): Promise<Page> {
  await seedSessions(context, buildContainer([]));
  await seedSettings(context, {
    setupState: 'pending',
    firstRun: { ...RUN_FINISHED, step: 1, ended: null },
    ...settings,
  });
  await openTabs(context);
  const page = await openPage(context, extensionId, FULL_RUN.path, FULL);
  await runCheck(page, 'resumed');
  await expect(cardAt(page, 1)).toBeVisible();
  return page;
}

// The run's save step: a typed name, the suggested one, or the example.
async function saveOnTour(
  page: Page,
  wording: Wording,
  nextStep: number
): Promise<void> {
  if (wording === 'nothingSaved') {
    await cardButton(page, 'Use an example').click();
  } else {
    if (wording === 'typed')
      await page.getByPlaceholder('Name the new session').fill('Lisbon trip');
    await saveRowSaveAll(page).click();
  }
  await expect(cardAt(page, nextStep)).toBeVisible();
}

test.beforeEach(async ({ context }) => {
  await watchCovers(context);
});

// The full view, pinned so no guide comes between: tour, note, setup, Done, then the card.
for (const wording of ['typed', 'suggested', 'nothingSaved'] as const) {
  test(`full view, ${wording}: the card after setup's Done`, async ({
    context,
    extensionId,
  }) => {
    await stubToolbarPin(context, { pinned: true });
    const page = await openRunningFullView(context, extensionId);
    await nextTo(page, 2);
    await nextTo(page, 3);
    await saveOnTour(page, wording, 4);
    for (let step = 5; step <= 9; step++) await nextTo(page, step);
    await cardButton(page, 'Not now').click();
    await closeReplayNote(page);
    await expect(endingCard(page)).toHaveCount(0);
    await finishSetupWithDone(page);
    const anchor =
      wording === 'typed'
        ? openOn(page, 'Lisbon trip')
        : wording === 'suggested'
          ? page.locator(ENGAGED_OPEN)
          : page.locator(SAVE);
    await expectEnding(page, wording, anchor);
    expect((await storedSettings(page)).isFullViewEndingSeen).toBe(true);
    expect((await storedSettings(page)).isPopupEndingSeen).toBe(false);
    // Got it closes it.
    await cardButton(page, 'Got it').click();
    await expect(endingCard(page)).toHaveCount(0);
  });
}

// Unpinned, with Chrome slow to say so: the guide comes first and the card only after it.
test('full view, unpinned: Done, the pin guide, no card; Skip, then the card', async ({
  context,
  extensionId,
}) => {
  await stubToolbarPin(context, { pinned: false });
  // Longer than the release's settle, so a card asked for before the read answers would show first.
  await context.addInitScript(() => {
    const action = globalThis.chrome?.action;
    if (typeof action?.getUserSettings !== 'function') return;
    const read = action.getUserSettings.bind(action);
    Object.defineProperty(action, 'getUserSettings', {
      value: () =>
        new Promise((resolve) => setTimeout(resolve, 1000)).then(() => read()),
      configurable: true,
    });
  });
  const page = await openRunningFullView(context, extensionId, {
    isPinGuideDismissed: false,
  });
  await walkFullRunToLastStep(page);
  await cardButton(page, 'Not now').click();
  await closeReplayNote(page);
  await finishSetupWithDone(page);
  await expect(guide(page)).toBeVisible();
  await page.waitForTimeout(WINDOW);
  await expect(endingCard(page)).toHaveCount(0);
  await guide(page).getByRole('button', { name: 'Skip', exact: true }).click();
  await expectEnding(page, 'nothingSaved', page.locator(SAVE));
  expect(await covers(page)).toEqual(['guide', 'ending']);
});

// Every way out of setup, the setup a later open shows; the newest session, which the run never held, is the target.
for (const way of ['Skip setup', '✕', 'Esc'] as const) {
  test(`full view: ${way} out of setup, then the card; Esc closes it`, async ({
    context,
    extensionId,
  }) => {
    await stubToolbarPin(context, { pinned: true });
    await seedSessions(
      context,
      buildContainer([buildSession({ title: 'Reading list' })])
    );
    await seedSettings(context, { setupState: 'pending' });
    const page = await openPage(context, extensionId, FULL_RUN.path, FULL);
    await expect(setup(page)).toBeVisible();
    if (way === 'Skip setup')
      await setup(page).getByText('Skip setup', { exact: true }).click();
    else if (way === '✕')
      await setup(page).locator('[aria-label="Skip setup"]').click();
    else await page.keyboard.press('Escape');
    await expect(page.locator('dialog:modal')).toHaveCount(0);
    await expectEnding(page, 'suggested', openOn(page, 'Reading list'));
    await page.keyboard.press('Escape');
    await expect(endingCard(page)).toHaveCount(0);
  });
}

// A skip gets the note and nothing; setup on the next open gets the card.
test('full view: tour skipped, nothing; the next open, setup, Done, the card', async ({
  context,
  extensionId,
}) => {
  await stubToolbarPin(context, { pinned: true });
  const page = await openRunningFullView(context, extensionId);
  await cardButton(page, 'Skip tutorial').click();
  await closeReplayNote(page);
  await expect(setup(page)).toHaveCount(0);
  await expectNoEnding(page);
  await page.close();
  const again = await openPage(context, extensionId, FULL_RUN.path, FULL);
  await finishSetupWithDone(again);
  await expectEnding(again, 'nothingSaved', again.locator(SAVE));
});

// The popup's own tour, not a replay: Done, the note, Got it, then the card at Open.
test('popup: a finished tour with a typed save, the note, Got it, the card', async ({
  context,
  extensionId,
}) => {
  await seedSessions(context, buildContainer([]));
  await seedSettings(context, {
    firstRun: {
      ...RUN_FINISHED,
      view: 'popup',
      helloIn: 'popup',
      step: 1,
      ended: null,
    },
  });
  await openTabs(context);
  const page = await openPage(context, extensionId, POPUP_RUN.path, POPUP);
  await runCheck(page, 'resumed');
  await expect(cardAt(page, 1)).toBeVisible();
  await saveOnTour(page, 'typed', 2);
  for (let step = 3; step <= 8; step++) await nextTo(page, step);
  await cardButton(page, 'Done').click();
  await closeReplayNote(page);
  await expectEnding(page, 'typed', openOn(page, 'Lisbon trip'));
  expect((await storedSettings(page)).isPopupEndingSeen).toBe(true);
  expect((await storedSettings(page)).isFullViewEndingSeen).toBe(false);
});

test('popup: Skip tutorial, the note, Got it, no card', async ({
  context,
  extensionId,
}) => {
  await seedSettings(context, {
    firstRun: {
      ...RUN_FINISHED,
      view: 'popup',
      helloIn: 'popup',
      step: 1,
      ended: null,
    },
  });
  const page = await openPage(context, extensionId, POPUP_RUN.path, POPUP);
  await runCheck(page, 'resumed');
  await cardButton(page, 'Skip tutorial').click();
  await closeReplayNote(page);
  await expectNoEnding(page);
});

// Help's tour is a replay in either view; so is the setup after the full view's.
test('Help → Show me around in the full view, to the end and setup: no card', async ({
  context,
  extensionId,
}) => {
  await stubToolbarPin(context, { pinned: true });
  const page = await openPage(context, extensionId, FULL_RUN.path, FULL);
  await startRunFromHelp(page);
  await expect(cardAt(page, 1)).toBeVisible();
  await walkFullRunToLastStep(page);
  await cardButton(page, 'Not now').click();
  await closeReplayNote(page);
  await finishSetupWithDone(page);
  await expectNoEnding(page);
  expect((await storedSettings(page)).isFullViewEndingSeen).toBe(false);
});

test('Help → Show me around in the popup, to Done and the note: no card', async ({
  context,
  extensionId,
}) => {
  const page = await openRunFromHelp(context, extensionId, POPUP_RUN);
  await cardButton(page, 'Use an example').click();
  await expect(cardAt(page, 2)).toBeVisible();
  for (let step = 3; step <= 8; step++) await nextTo(page, step);
  await cardButton(page, 'Done').click();
  await closeReplayNote(page);
  await expectNoEnding(page);
  expect((await storedSettings(page)).isPopupEndingSeen).toBe(false);
});

test('Help → Run setup again, Done: no card', async ({
  context,
  extensionId,
}) => {
  await stubToolbarPin(context, { pinned: true });
  const page = await openPage(context, extensionId, FULL_RUN.path, FULL);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Help', exact: true }).click();
  await page
    .locator('[data-help]')
    .getByRole('button', { name: 'Run setup again', exact: true })
    .click();
  await finishSetupWithDone(page);
  await expectNoEnding(page);
});

// Seen as it opens: a page closed on the card does not bring it back on the next open's trigger.
test('full view: the card, the page closed on it; the next open’s setup gets none', async ({
  context,
  extensionId,
}) => {
  await stubToolbarPin(context, { pinned: true });
  await seedSettings(context, { setupState: 'pending' });
  const page = await openPage(context, extensionId, FULL_RUN.path, FULL);
  await finishSetupWithDone(page);
  await expectEnding(page, 'nothingSaved', page.locator(SAVE));
  // Setup pending again, as nothing but a reset could leave it; the stored seen flag is the page's own.
  await page.evaluate(() => {
    const stored: unknown = JSON.parse(
      localStorage.getItem('settingsData') ?? '{}'
    );
    localStorage.setItem(
      'settingsData',
      JSON.stringify({
        ...(typeof stored === 'object' ? stored : {}),
        setupState: 'pending',
      })
    );
  });
  await page.close();
  const again = await openPage(context, extensionId, FULL_RUN.path, FULL);
  await finishSetupWithDone(again);
  await expectNoEnding(again);
});

test('popup: the card, the popup closed on it; the next finished tour gets none', async ({
  context,
  extensionId,
}) => {
  const atLastStep = {
    ...RUN_FINISHED,
    view: 'popup',
    helloIn: 'popup',
    step: 8,
    ended: null,
  };
  await seedSettings(context, { firstRun: atLastStep });
  const page = await openPage(context, extensionId, POPUP_RUN.path, POPUP);
  await expect(cardAt(page, 8)).toBeVisible();
  await cardButton(page, 'Done').click();
  await closeReplayNote(page);
  await expectEnding(page, 'nothingSaved', page.locator(SAVE));
  // The popup's tour at its last card again, beside the page's own seen flag.
  await page.evaluate((run) => {
    const stored: unknown = JSON.parse(
      localStorage.getItem('settingsData') ?? '{}'
    );
    localStorage.setItem(
      'settingsData',
      JSON.stringify({
        ...(typeof stored === 'object' ? stored : {}),
        firstRun: run,
      })
    );
  }, atLastStep);
  await page.close();
  const again = await openPage(context, extensionId, POPUP_RUN.path, POPUP);
  await expect(cardAt(again, 8)).toBeVisible();
  await cardButton(again, 'Done').click();
  await closeReplayNote(again);
  await expectNoEnding(again);
});
