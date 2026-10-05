import type { Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { buildContainer, buildSession, seedSettings } from './fixtures/seed';
import { escapesPrevented, watchEscapes } from './fixtures/escapeProbe';
import {
  FULL,
  FULL_VIEW_PATH,
  openPage,
  twoFrames,
} from './fixtures/onboarding';
import {
  FULL_RUN,
  card,
  cardAt,
  cardButton,
  cardSide,
  centreOf,
  hello,
  hitAt,
  nextTo,
  openRunFromHelp,
  seedSessionsIfAbsent,
  startRunFromHelp,
  storedRun,
  storedTitles,
} from './fixtures/run';

// §3 on the real build, from Help: Hello, then 8 cards, each in its mocked place.

// How many tabs the browser has gained since now, read from the browser itself, not from the harness's announcement.
async function watchNewTabs(page: Page): Promise<() => Promise<number>> {
  const count = () =>
    page.evaluate(() => chrome.tabs.query({}).then((t) => t.length));
  const before = await count();
  return async () => (await count()) - before;
}

const ring = (page: Page) =>
  page.locator('[data-coach-ring]').evaluate((el) => {
    const { left, top, width, height, bottom } = el.getBoundingClientRect();
    return { left, top, width, height, bottom };
  });

test('Hello, the eight cards in their places, Back and Next, and Not now', async ({
  context,
  extensionId,
}) => {
  const page = await openRunFromHelp(context, extensionId, FULL_RUN);
  await expect.poll(() => cardSide(page)).toBe('left');
  await expect(card(page).getByRole('progressbar')).toHaveAttribute(
    'aria-valuetext',
    'Step 1 of 8'
  );
  await expect(cardButton(page, 'Back')).toHaveCount(0);
  // Step 1 is look-only: Open now takes no press.
  expect(
    await hitAt(
      page,
      ...(await centreOf(page.locator('[data-pane="open-now"]')))
    )
  ).toBe('still');
  await nextTo(page, 2);
  await cardButton(page, 'Back').click();
  await expect(cardAt(page, 1)).toBeVisible();
  await nextTo(page, 2);
  // Step 2 is live: the Open now search takes typing and the card stays.
  const search = page.locator(
    '[data-pane="open-now"] [data-open-now-search] input'
  );
  await search.fill('zz');
  await expect(cardAt(page, 2)).toBeVisible();
  await search.fill('');
  await nextTo(page, 3);
  await expect.poll(() => cardSide(page)).toBe('right');
  await expect(
    card(page).getByRole('img', {
      name: 'Save all open windows as a session',
      exact: true,
    })
  ).toBeVisible();
  await cardButton(page, 'Use an example').click();
  await expect(cardAt(page, 4)).toBeVisible();
  await expect.poll(() => cardSide(page)).toBe('below');
  const engaged = page.locator('[data-pane="sessions"] [data-run-engaged]');
  await expect(engaged).toHaveCount(1);
  // R7: the lit row is look-only.
  expect(await hitAt(page, ...(await centreOf(engaged)))).toBe('still');
  await nextTo(page, 5);
  const open = page.locator(
    '[data-pane="sessions"] [data-tour-anchor="row-open"]'
  );
  await expect(open).toBeVisible();
  // CONTROL: the 'with saved sessions' Open test, where this counter sees the page.
  const opened = await watchNewTabs(page);
  await page.mouse.click(...(await centreOf(open)));
  await nextTo(page, 6);
  await twoFrames(page);
  expect(await opened()).toBe(0);
  const del = page.locator(
    '[data-pane="sessions"] [data-tour-anchor="row-delete"]'
  );
  expect(await hitAt(page, ...(await centreOf(del)))).toBe('still');
  await del.focus();
  await del.press('Enter');
  // CONTROL: the 'with saved sessions' Delete test, where the same press deletes.
  await twoFrames(page);
  expect(await storedTitles(page)).toEqual(['Sample: Weekend trip']);
  await nextTo(page, 7);
  await expect.poll(() => cardSide(page)).toBe('left');
  await nextTo(page, 8);
  await expect.poll(() => cardSide(page)).toBe('free');
  await expect(page.locator('[data-coach-ring]')).toHaveCount(0);
  await expect(cardButton(page, 'Skip tutorial')).toHaveCount(0);
  expect(await opened()).toBe(0);
  await cardButton(page, 'Not now').click();
  await expect(card(page)).toHaveCount(0);
  await expect
    .poll(() => storedRun(page))
    .toMatchObject({ view: 'full', ended: 'finished' });
  await expect.poll(() => storedTitles(page)).toEqual([]);
});

test('Next onto the save step glides the card there and never lifts the dim (KAN-436)', async ({
  context,
  extensionId,
}) => {
  // Every card and ring animation, from before the page loads.
  await context.addInitScript(() => {
    if (window.top !== window) return;
    const log: string[] = [];
    Object.defineProperty(globalThis, '__cardMotion', { value: log });
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (this: Element, frames, options) {
      if (this.hasAttribute('data-coach-mark')) {
        const first = Array.isArray(frames) ? frames[0] : undefined;
        log.push(
          first !== undefined && 'opacity' in first ? 'appear' : 'glide'
        );
      }
      return animate.call(this, frames, options);
    };
  });
  const page = await openRunFromHelp(context, extensionId, FULL_RUN);
  await nextTo(page, 2);
  // The step-2 glide is measured on the next frame; let it land before the log is cleared.
  await twoFrames(page);
  const motion = () =>
    page.evaluate(() => {
      const log: unknown = Reflect.get(globalThis, '__cardMotion');
      return Array.isArray(log) ? log.splice(0).map(String) : [];
    });
  await motion();
  await page.evaluate(() => {
    const seen = { lifted: false };
    Object.defineProperty(globalThis, '__dimLifted', { value: seen });
    new MutationObserver(() => {
      if (document.querySelector('[data-coach-dim]') === null) {
        seen.lifted = true;
      }
    }).observe(document.body, { childList: true, subtree: true });
  });
  const lifted = () =>
    page.evaluate(() =>
      Boolean(Reflect.get(Reflect.get(globalThis, '__dimLifted'), 'lifted'))
    );
  await cardButton(page, 'Next').click();
  await expect(cardButton(page, 'Use an example')).toBeVisible();
  await twoFrames(page);
  expect(await lifted()).toBe(false);
  expect(await motion()).toEqual(['glide']);
  // CONTROL: the same observer sees the dim lifted when the run ends.
  await cardButton(page, 'Skip tutorial').click();
  await expect(card(page)).toHaveCount(0);
  expect(await lifted()).toBe(true);
});

test('Pin this tab pins this tab and ends the run', async ({
  context,
  extensionId,
}) => {
  const page = await openRunFromHelp(context, extensionId, FULL_RUN);
  const pinned = () =>
    page.evaluate(async () => (await chrome.tabs.getCurrent())?.pinned);
  // CONTROL: the run does not start pinned.
  expect(await pinned()).toBe(false);
  for (let step = 2; step <= 3; step++) await nextTo(page, step);
  await cardButton(page, 'Use an example').click();
  for (let step = 5; step <= 8; step++) await nextTo(page, step);
  await cardButton(page, 'Pin this tab').click();
  await expect.poll(pinned).toBe(true);
  await expect.poll(() => storedRun(page)).toMatchObject({ ended: 'finished' });
});

test('Esc on a middle card is Skip tutorial; on the last it is Not now (R5); both prevented', async ({
  context,
  extensionId,
}) => {
  await watchEscapes(context);
  const page = await openRunFromHelp(context, extensionId, FULL_RUN);
  await page.keyboard.press('Escape');
  await expect.poll(() => storedRun(page)).toMatchObject({ ended: 'skipped' });
  await startRunFromHelp(page);
  await hello(page).getByRole('button', { name: 'Start', exact: true }).click();
  await expect(cardAt(page, 1)).toBeVisible();
  for (let step = 2; step <= 3; step++) await nextTo(page, step);
  await cardButton(page, 'Use an example').click();
  for (let step = 5; step <= 8; step++) await nextTo(page, step);
  await page.keyboard.press('Escape');
  await expect.poll(() => storedRun(page)).toMatchObject({ ended: 'finished' });
  expect(await escapesPrevented(page)).toEqual([true, true]);
});

test('Esc on Hello is Skip tutorial, and is prevented (KAN-426)', async ({
  context,
  extensionId,
}) => {
  await watchEscapes(context);
  const page = await openPage(context, extensionId, FULL_VIEW_PATH, FULL);
  await startRunFromHelp(page);
  await expect(hello(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(hello(page)).toHaveCount(0);
  await expect.poll(() => storedRun(page)).toMatchObject({ ended: 'skipped' });
  expect(await escapesPrevented(page)).toEqual([true]);
});

test.describe('side by side', () => {
  test.beforeEach(async ({ context }) => {
    await seedSettings(context, { foldSavedSessionInTabView: false });
  });

  test('under 1100px, steps 1 and 2 light the 44px rail', async ({
    context,
    extensionId,
  }) => {
    const page = await openRunFromHelp(context, extensionId, {
      ...FULL_RUN,
      viewport: { width: 1000, height: 800 },
    });
    const rail = await page.locator('[data-pane="open-now"]').boundingBox();
    if (rail === null) throw new Error('no rail');
    expect(rail.width).toBeLessThan(60);
    await expect.poll(async () => (await ring(page)).width).toBeLessThan(60);
    await nextTo(page, 2);
    await expect.poll(async () => (await ring(page)).width).toBeLessThan(60);
  });

  test('with no room to resize, step 2’s box is the search row and « alone', async ({
    context,
    extensionId,
  }) => {
    const page = await openRunFromHelp(context, extensionId, {
      ...FULL_RUN,
      viewport: { width: 1200, height: 800 },
    });
    await nextTo(page, 2);
    await expect(page.locator('[data-resize-grip]')).toHaveCount(0);
    const [search, fold] = await Promise.all([
      page
        .locator('[data-pane="open-now"] [data-open-now-search]')
        .boundingBox(),
      page
        .locator('[data-pane="open-now"] [data-tour-anchor="fold"]')
        .boundingBox(),
    ]);
    if (search === null || fold === null) throw new Error('not drawn');
    const top = Math.min(search.y, fold.y);
    const bottom = Math.max(search.y + search.height, fold.y + fold.height);
    await expect
      .poll(async () => (await ring(page)).height)
      .toBeCloseTo(bottom - top + 2 * 4, 0);
  });

  test('CONTROL: with room to resize, step 2’s box takes in the resize edge', async ({
    context,
    extensionId,
  }) => {
    const page = await openRunFromHelp(context, extensionId, {
      ...FULL_RUN,
      viewport: { width: 1400, height: 800 },
    });
    await nextTo(page, 2);
    const grip = await page.locator('[data-resize-grip]').boundingBox();
    if (grip === null) throw new Error('no grip');
    await expect
      .poll(async () => {
        const box = await ring(page);
        return (
          box.left <= grip.x &&
          box.top <= grip.y &&
          box.bottom >= grip.y + grip.height
        );
      })
      .toBe(true);
  });
});

test.describe('with saved sessions', () => {
  test.beforeEach(async ({ context }) => {
    await seedSessionsIfAbsent(
      context,
      buildContainer([
        buildSession({ tabGroupId: 'old', title: 'Older', createdAt: 1000 }),
        buildSession({ tabGroupId: 'new', title: 'Latest', createdAt: 2000 }),
      ])
    );
  });

  test('step 3 shows your sessions, and the run goes on with the latest (R10)', async ({
    context,
    extensionId,
  }) => {
    const page = await openRunFromHelp(context, extensionId, FULL_RUN);
    for (let step = 2; step <= 3; step++) await nextTo(page, step);
    await expect(card(page)).toContainText(
      'Your saved sessions are all here, just as you left them.'
    );
    await expect.poll(() => cardSide(page)).toBe('right');
    await nextTo(page, 4);
    await expect
      .poll(() => storedRun(page))
      .toMatchObject({ sessionId: 'new' });
    await expect(
      page.locator(
        '[data-pane="sessions"] [data-drag-row-id="new"] [data-run-engaged]'
      )
    ).toHaveCount(1);
  });

  test('steps 5 and 6 light the run’s row’s own buttons, not another row’s', async ({
    context,
    extensionId,
  }) => {
    const page = await openRunFromHelp(context, extensionId, FULL_RUN);
    for (let step = 2; step <= 5; step++) await nextTo(page, step);
    for (const [step, anchor] of [
      [5, 'row-open'],
      [6, 'row-delete'],
    ] as const) {
      if (step === 6) await nextTo(page, 6);
      const own = await page
        .locator(
          `[data-pane="sessions"] [data-drag-row-id="new"] [data-tour-anchor="${anchor}"]`
        )
        .boundingBox();
      if (own === null) throw new Error(`no ${anchor}`);
      await expect
        .poll(async () => {
          const box = await ring(page);
          return [box.left + 4, box.top + 4].map(Math.round);
        })
        .toEqual([own.x, own.y].map(Math.round));
    }
  });

  test('CONTROL: outside the run, a row’s Open opens a page and its Delete deletes', async ({
    context,
    extensionId,
  }) => {
    const page = await openPage(context, extensionId, FULL_VIEW_PATH, FULL);
    const row = page.locator('[data-pane="sessions"] [data-drag-row-id="old"]');
    const opened = await watchNewTabs(page);
    await row.hover();
    await page.mouse.click(
      ...(await centreOf(row.locator('[data-tour-anchor="row-open"]')))
    );
    await twoFrames(page);
    expect(await opened()).toBeGreaterThan(0);
    await page.bringToFront();
    const del = row.locator('[data-tour-anchor="row-delete"]');
    await del.focus();
    await del.press('Enter');
    await twoFrames(page);
    expect(await storedTitles(page)).toEqual(['Latest']);
  });

  test('R3: a saved search hides the card, ring and dim; clearing it brings them back', async ({
    context,
    extensionId,
  }) => {
    const page = await openRunFromHelp(context, extensionId, FULL_RUN);
    for (let step = 2; step <= 4; step++) await nextTo(page, step);
    const search = page.locator(
      '[data-pane="sessions"] [data-saved-search] input'
    );
    await search.focus();
    await search.fill('Latest');
    await expect(card(page)).toHaveCount(0);
    await expect(page.locator('[data-coach-dim]')).toHaveCount(0);
    await search.fill('');
    await expect(cardAt(page, 4)).toBeVisible();
  });

  test('the run never ends by deleting your own session, and leaves its Open undimmed', async ({
    context,
    extensionId,
  }) => {
    const page = await openRunFromHelp(context, extensionId, FULL_RUN);
    for (let step = 2; step <= 4; step++) await nextTo(page, step);
    const open = page.locator(
      '[data-pane="sessions"] [data-drag-row-id="new"] [data-tour-anchor="row-open"]'
    );
    const look = () =>
      open.evaluate((el) => [
        getComputedStyle(el).filter,
        el.getAttribute('aria-disabled'),
      ]);
    // CONTROL: while the run points at it, its Open is dimmed and blocked.
    expect(await look()).toEqual(['opacity(0.3)', 'true']);
    for (let step = 5; step <= 8; step++) await nextTo(page, step);
    await cardButton(page, 'Not now').click();
    await expect
      .poll(() => storedRun(page))
      .toMatchObject({ ended: 'finished' });
    expect(await storedTitles(page)).toEqual(['Older', 'Latest']);
    await expect.poll(look).toEqual(['none', null]);
  });
});
