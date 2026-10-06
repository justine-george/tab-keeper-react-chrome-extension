import type { Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { buildContainer, buildSession, seedSettings } from './fixtures/seed';
import { escapesPrevented, watchEscapes } from './fixtures/escapeProbe';
import {
  FULL,
  FULL_VIEW_PATH,
  openPage,
  storedSettings,
  twoFrames,
} from './fixtures/onboarding';
import {
  FULL_AT_HELLO,
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
  runDrawn,
  seedSessionsIfAbsent,
  startRunFromHelp,
  storedRun,
  storedTitles,
  watchRunDrawn,
} from './fixtures/run';

// §3 on the real build, from Help: 8 cards, each in its mocked place.

// How many tabs the browser has gained since now, read from the browser itself, not from the harness's announcement.
async function watchNewTabs(page: Page): Promise<() => Promise<number>> {
  const count = () =>
    page.evaluate(() => chrome.tabs.query({}).then((t) => t.length));
  const before = await count();
  return async () => (await count()) - before;
}

// Whether a pointer at (x, y) lands inside the control named `label`.
const landsOn = (page: Page, x: number, y: number, label: string) =>
  page.evaluate(
    ([x, y, label]) =>
      document
        .elementFromPoint(Number(x), Number(y))
        ?.closest(`[aria-label="${label}"]`) != null,
    [x, y, label] as const
  );

const ring = (page: Page) =>
  page.locator('[data-coach-ring]').evaluate((el) => {
    const { left, top, width, height, bottom } = el.getBoundingClientRect();
    return { left, top, width, height, bottom };
  });

test('Help starts at card 1 with no Hello; the eight cards in their places, Back and Next, and Not now', async ({
  context,
  extensionId,
}) => {
  await watchRunDrawn(context);
  const page = await openRunFromHelp(context, extensionId, FULL_RUN);
  // CONTROL: 'Esc on Hello' below, where the same observer sees Hello.
  expect(await runDrawn(page)).toEqual(['card']);
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

test('step 2 in the default folded view names the fold button it shows, and pressing it unfolds with the card still at step 2', async ({
  context,
  extensionId,
}) => {
  const page = await openRunFromHelp(context, extensionId, FULL_RUN);
  await nextTo(page, 2);
  const fold = page.locator('[data-pane="open-now"] [data-tour-anchor="fold"]');
  const glyph = (name: string) =>
    card(page).getByRole('img', { name, exact: true });
  await expect(fold).toHaveAccessibleName('Show the saved session');
  await expect(card(page)).toContainText(
    'Search here to find an open tab fast. Press'
  );
  await expect(card(page)).toContainText(
    'to show the saved session beside it.'
  );
  await expect(card(page)).not.toContainText('Drag the edge');
  await expect(glyph('Show the saved session')).toBeVisible();
  expect(await glyph('Show the saved session').textContent()).toBe(
    await fold.textContent()
  );
  const [x, y] = await centreOf(fold);
  expect(['dim', 'still', 'nothing']).not.toContain(await hitAt(page, x, y));
  await page.mouse.click(x, y);
  await expect
    .poll(async () => (await storedSettings(page)).foldSavedSessionInTabView)
    .toBe(false);
  await expect(page.locator('[data-pane="detail"]')).toBeVisible();
  await expect(cardAt(page, 2)).toBeVisible();
  await expect(card(page)).toContainText(
    'Drag the edge to make this wider, or press'
  );
  await expect(card(page)).toContainText('to give Open now the whole view.');
  await expect(glyph('Fold the saved session away')).toBeVisible();
  expect(await glyph('Fold the saved session away').textContent()).toBe(
    await fold.textContent()
  );
  expect(await storedRun(page)).toMatchObject({ step: 2, ended: null });
});

test('step 7: a window renamed from its title is stored, and a window folds and unfolds; the card stays at step 7', async ({
  context,
  extensionId,
}) => {
  const page = await openRunFromHelp(context, extensionId, FULL_RUN);
  await nextTo(page, 2);
  await nextTo(page, 3);
  await cardButton(page, 'Use an example').click();
  await expect(cardAt(page, 4)).toBeVisible();
  for (let step = 5; step <= 7; step++) await nextTo(page, step);
  const detail = page.locator('[data-pane="detail"]');
  const title = detail.getByRole('button', {
    name: 'Rename window: Getting there',
    exact: true,
  });
  const [tx, ty] = await centreOf(title);
  expect(await landsOn(page, tx, ty, 'Rename window: Getting there')).toBe(
    true
  );
  await page.mouse.click(tx, ty);
  const field = detail.getByPlaceholder('Name this window', { exact: true });
  await field.fill('Lisbon flights');
  await field.press('Enter');
  await expect(
    detail.getByRole('button', {
      name: 'Rename window: Lisbon flights',
      exact: true,
    })
  ).toBeVisible();
  await expect
    .poll(async () => {
      const run = await storedRun(page);
      const id =
        typeof run === 'object' && run !== null
          ? Reflect.get(run, 'sessionId')
          : null;
      return page.evaluate((id) => {
        const parsed: unknown = JSON.parse(
          localStorage.getItem('tabContainerData') ?? 'null'
        );
        const groups: unknown =
          typeof parsed === 'object' && parsed !== null
            ? Reflect.get(parsed, 'tabGroups')
            : null;
        if (!Array.isArray(groups)) return null;
        const session: unknown = groups.find(
          (g: unknown) =>
            typeof g === 'object' &&
            g !== null &&
            Reflect.get(g, 'tabGroupId') === id
        );
        const windows: unknown =
          typeof session === 'object' && session !== null
            ? Reflect.get(session, 'windows')
            : null;
        return Array.isArray(windows)
          ? windows.map((w: unknown) =>
              typeof w === 'object' && w !== null
                ? Reflect.get(w, 'title')
                : null
            )
          : null;
      }, id);
    })
    .toEqual(['Lisbon flights', 'Things to do']);
  await expect(cardAt(page, 7)).toBeVisible();
  const collapse = detail.getByRole('button', {
    name: 'Collapse: Things to do',
    exact: true,
  });
  const [cx, cy] = await centreOf(collapse);
  expect(await landsOn(page, cx, cy, 'Collapse: Things to do')).toBe(true);
  await page.mouse.click(cx, cy);
  const expand = detail.getByRole('button', {
    name: 'Expand: Things to do',
    exact: true,
  });
  await expect(expand).toHaveAttribute('aria-expanded', 'false');
  await expect(cardAt(page, 7)).toBeVisible();
  expect(await landsOn(page, cx, cy, 'Expand: Things to do')).toBe(true);
  await page.mouse.click(cx, cy);
  await expect(collapse).toHaveAttribute('aria-expanded', 'true');
  await expect(cardAt(page, 7)).toBeVisible();
  expect(await storedRun(page)).toMatchObject({ step: 7, ended: null });
});

test('while the card glides from step 6 to step 7 it takes no pointer, and takes it again when it lands (KAN-453)', async ({
  context,
  extensionId,
}) => {
  const page = await openRunFromHelp(context, extensionId, FULL_RUN);
  await nextTo(page, 2);
  await nextTo(page, 3);
  await cardButton(page, 'Use an example').click();
  await expect(cardAt(page, 4)).toBeVisible();
  for (let step = 5; step <= 6; step++) await nextTo(page, step);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.querySelector('[data-coach-mark]')?.getAnimations().length ??
          -1
      )
    )
    .toBe(0);
  // Rate 0 from before Next: the glide starts frozen and cannot end under the probes.
  const cdp = await context.newCDPSession(page);
  await cdp.send('Animation.enable');
  await cdp.send('Animation.setPlaybackRate', { playbackRate: 0 });
  await cardButton(page, 'Next').click();
  await expect(cardAt(page, 7)).toBeVisible();
  // Held in turn at points along the glide: paused, not finished or cancelled, so the card is still mid-glide.
  const hold = (ms: number) =>
    page.evaluate((ms) => {
      const glides =
        document.querySelector('[data-coach-mark]')?.getAnimations() ?? [];
      glides.forEach((glide) => {
        glide.pause();
        glide.currentTime = ms;
      });
      return glides.length;
    }, ms);
  const detail = page.locator('[data-pane="detail"]');
  const targets = [
    'Rename window: Getting there',
    'Rename window: Things to do',
    'Collapse: Things to do',
    'Collapse: Getting there',
  ];
  // The lit controls the card is over right now.
  const coveredNow = () =>
    page.evaluate((labels) => {
      const rect = document
        .querySelector('[data-coach-mark]')
        ?.getBoundingClientRect();
      return labels.filter((label) => {
        const box = document
          .querySelector(`[aria-label="${label}"]`)
          ?.getBoundingClientRect();
        if (rect === undefined || box === undefined) return false;
        const x = box.left + box.width / 2;
        const y = box.top + box.height / 2;
        return (
          x > rect.left && x < rect.right && y > rect.top && y < rect.bottom
        );
      });
    }, targets);
  const covered = new Set<string>();
  for (const ms of [0, 40, 80, 120, 160]) {
    await expect.poll(() => hold(ms)).toBe(1);
    for (const label of await coveredNow()) {
      covered.add(label);
      const [x, y] = await centreOf(detail.getByLabel(label, { exact: true }));
      expect(await landsOn(page, x, y, label)).toBe(true);
    }
  }
  // CONTROL: the card does pass over a title and a fold arrow, so those hits are tests.
  expect([...covered].some((label) => label.startsWith('Rename'))).toBe(true);
  expect([...covered].some((label) => label.startsWith('Collapse'))).toBe(true);
  await hold(100);
  const fold = detail.getByRole('button', {
    name: 'Collapse: Things to do',
    exact: true,
  });
  const [fx, fy] = await centreOf(fold);
  await page.mouse.click(fx, fy);
  await expect(
    detail.getByRole('button', { name: 'Expand: Things to do', exact: true })
  ).toHaveAttribute('aria-expanded', 'false');
  // Landed: the glide runs out at normal speed, and the card takes the pointer again.
  await cdp.send('Animation.setPlaybackRate', { playbackRate: 1 });
  await page.evaluate(
    () =>
      document
        .querySelector('[data-coach-mark]')
        ?.getAnimations()
        .forEach((glide) => glide.play())
  );
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.querySelector('[data-coach-mark]')?.getAnimations().length ??
          -1
      )
    )
    .toBe(0);
  const [nx, ny] = await centreOf(cardButton(page, 'Next'));
  // The finish event follows the frame the glide ends on.
  await expect
    .poll(() =>
      page.evaluate(
        ([x, y]) =>
          document
            .elementFromPoint(Number(x), Number(y))
            ?.closest('[data-coach-mark] button') != null,
        [nx, ny] as const
      )
    )
    .toBe(true);
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
  await watchRunDrawn(context);
  await seedSettings(context, { firstRun: FULL_AT_HELLO });
  const page = await openPage(context, extensionId, FULL_VIEW_PATH, FULL);
  await expect(hello(page)).toBeVisible();
  expect(await runDrawn(page)).toContain('hello');
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
