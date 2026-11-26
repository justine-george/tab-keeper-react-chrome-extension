import type { BrowserContext, Locator, Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { showRowActions } from './fixtures/savedRow';
import { buildContainer, buildSession, seedSettings } from './fixtures/seed';
import { escapesPrevented, watchEscapes } from './fixtures/escapeProbe';
import { pixelsAt, rgbToHex } from './fixtures/pixels';
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
  closeReplayNote,
  hello,
  hitAt,
  landedAt,
  nextTo,
  openRunFromHelp,
  replayNote,
  runDrawn,
  seedSessionsIfAbsent,
  startRunFromHelp,
  storedRun,
  storedTitles,
  watchRunDrawn,
} from './fixtures/run';

// §3 on the real build, from Help: 10 cards, each in its mocked place.

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

test('Help starts at card 1 with no Hello; the ten cards in their places, Back and Next, and Not now', async ({
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
    'Step 1 of 10'
  );
  // KAN-562: led by the name, so it can't read as "this is open at the moment".
  await expect(card(page)).toContainText(
    'Currently open shows every Chrome window and tab on this device, and stays up to date as you browse.'
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
  // KAN-1021. The card says the session shows on the right: that pane's
  // header and windows are lit too, and look-only like the row.
  await landedAt(page, 4);
  const detail = page.locator('[data-pane="detail"]');
  const windows = detail.locator('[data-tour-anchor="windows"]');
  const header = detail.locator('[data-tour-anchor="session-menu"]');
  expect(await hitAt(page, ...(await centreOf(windows)))).toBe('still');
  expect(await hitAt(page, ...(await centreOf(header)))).toBe('still');
  // CONTROL: Currently open, which the card doesn't name, stays dimmed.
  expect(
    await hitAt(
      page,
      ...(await centreOf(page.locator('[data-pane="open-now"]')))
    )
  ).toBe('dim');
  // The card stays inside the saved list, clear of the pane it lights.
  const sessions = (await page
    .locator('[data-pane="sessions"]')
    .boundingBox())!;
  const step4 = (await card(page).boundingBox())!;
  expect(step4.x + step4.width).toBeLessThanOrEqual(
    sessions.x + sessions.width
  );
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
  // KAN-586. Replace, explained under the row's Replace, which is look-only.
  // KAN-1022. A habit, not a definition.
  await expect(card(page)).toContainText(
    'Before you shut down, press Replace to save what you have open over this session. Nothing closes.'
  );
  await expect.poll(() => cardSide(page)).toBe('below');
  const replace = page.locator(
    '[data-pane="sessions"] [data-tour-anchor="row-replace"]'
  );
  expect(await hitAt(page, ...(await centreOf(replace)))).toBe('still');
  await nextTo(page, 7);
  // KAN-613. For a frame the hold is still on step 6's Replace; same side, so no side poll catches it.
  await landedAt(page, 7);
  // KAN-582. Delete is in the session header's ⋮, held while this step shows.
  const del = page
    .locator('[data-pane="detail"] [data-tour-anchor="session-menu"]')
    .getByRole('button', { name: 'More actions' });
  expect(await hitAt(page, ...(await centreOf(del)))).toBe('still');
  await del.focus();
  await del.press('Enter');
  // CONTROL: the 'with saved sessions' Delete test, where the same menu deletes.
  await twoFrames(page);
  await expect(page.getByRole('menu')).toHaveCount(0);
  expect(await storedTitles(page)).toEqual(['Sample: Weekend trip']);
  await nextTo(page, 8);
  // KAN-654: the full view's larger card (360px, 24px padding) no longer fits left of the
  // windows; it sits under them (Justine, 2026-10-16). Read once landed: mid-move it can pass through below.
  await landedAt(page, 8);
  expect(await cardSide(page)).toBe('below');
  // KAN-1023. The window's own menu, named on its card.
  await expect(card(page)).toContainText(
    "Each window can be opened on its own. Click a window's title to rename it. After the tour, right-click it for more."
  );
  // KAN-1023. Dragging between the session and Currently open, a second way
  // in: the windows ringed, Currently open lit, both live to try (round 2;
  // tour-drag-try.spec.ts drags each way).
  await nextTo(page, 9);
  await landedAt(page, 9);
  await expect(card(page).getByRole('progressbar')).toHaveAttribute(
    'aria-valuetext',
    'Step 9 of 10'
  );
  await expect(card(page)).toContainText(
    'Try it: drag a tab between this session and Currently open.'
  );
  expect(await cardSide(page)).toBe('left');
  // The ring is on the session's windows.
  const dragRing = await ring(page);
  const windowsBox = (await windows.boundingBox())!;
  const ringMiddle = [
    dragRing.left + dragRing.width / 2,
    dragRing.top + dragRing.height / 2,
  ];
  expect(ringMiddle[0]).toBeGreaterThan(windowsBox.x);
  expect(ringMiddle[0]).toBeLessThan(windowsBox.x + windowsBox.width);
  expect(ringMiddle[1]).toBeGreaterThan(windowsBox.y);
  expect(ringMiddle[1]).toBeLessThan(windowsBox.y + windowsBox.height);
  expect(await hitAt(page, ...(await centreOf(windows)))).not.toMatch(
    /^(dim|still)$/
  );
  const openNowList = page.locator(
    '[data-pane="open-now"] [data-open-now-search]'
  );
  expect(await hitAt(page, ...(await centreOf(openNowList)))).not.toMatch(
    /^(dim|still)$/
  );
  // CONTROL: the saved list beside it stays dimmed.
  expect(
    await hitAt(
      page,
      (await page.locator('[data-pane="sessions"]').boundingBox())!.x + 20,
      790
    )
  ).toBe('dim');
  const step9 = (await card(page).boundingBox())!;
  expect(step9.x + step9.width).toBeLessThanOrEqual(
    sessions.x + sessions.width
  );
  await nextTo(page, 10);
  await expect.poll(() => cardSide(page)).toBe('free');
  await expect(page.locator('[data-coach-ring]')).toHaveCount(0);
  await expect(cardButton(page, 'Skip tutorial')).toHaveCount(0);
  expect(await opened()).toBe(0);
  await cardButton(page, 'Not now').click();
  await closeReplayNote(page);
  await expect(card(page)).toHaveCount(0);
  await expect
    .poll(() => storedRun(page))
    .toMatchObject({ view: 'full', ended: 'finished' });
  await expect.poll(() => storedTitles(page)).toEqual([]);
});

// KAN-500. Under 1100px Open now is the rail: one button, with search and « in its drawer.
test('step 2 on the narrow rail names the rail’s button, not a search field, edge or «', async ({
  context,
  extensionId,
}) => {
  await seedSettings(context, { foldSavedSessionInTabView: false });
  const page = await openRunFromHelp(context, extensionId, {
    ...FULL_RUN,
    viewport: { width: 1000, height: 800 },
  });
  await nextTo(page, 2);
  await expect(
    page.locator('[data-pane="open-now"] [data-open-now-search]')
  ).toHaveCount(0);
  await expect(card(page)).toContainText(
    'Currently open is tucked in here while the window is narrow. Press'
  );
  await expect(card(page)).toContainText('to see and search every open tab.');
  await expect(card(page)).not.toContainText('Search here');
  await expect(card(page)).not.toContainText('Drag the edge');
  await expect(
    card(page).getByRole('img', { name: 'Currently open', exact: true })
  ).toHaveText('tab');
});

// KAN-500. The card offers the edge exactly where the grip is drawn, and follows a resize across 1100px (KAN-868).
test('step 2 side by side: the edge only in a window wide enough for the grip', async ({
  context,
  extensionId,
}) => {
  await seedSettings(context, { foldSavedSessionInTabView: false });
  const page = await openRunFromHelp(context, extensionId, FULL_RUN);
  const grip = page.locator('[data-resize-grip]');
  await page.setViewportSize({ width: 1400, height: 800 });
  await nextTo(page, 2);
  await expect(grip).toHaveCount(1);
  await expect(card(page)).toContainText(
    'Type in the search box to find an open tab. Drag the edge to make this wider, or press'
  );
  // The narrowest side by side still has a grip, so the card keeps the edge.
  await page.setViewportSize({ width: 1100, height: 800 });
  await expect(grip).toHaveCount(1);
  await expect(card(page)).toContainText('Drag the edge');
  await page.setViewportSize({ width: 1099, height: 800 });
  await expect(grip).toHaveCount(0);
  await expect(card(page)).not.toContainText('Drag the edge');
  await expect(card(page)).toContainText(
    'Currently open is tucked in here while the window is narrow.'
  );
  await page.setViewportSize({ width: 1100, height: 800 });
  await expect(grip).toHaveCount(1);
  await expect(card(page)).toContainText('Drag the edge');
});

// KAN-999. A first run has nothing saved, so the folded view draws no Saved
// session card: step 2 names only the search box.
test('step 2 on a first run, folded with nothing saved: the search sentence alone, and no card', async ({
  context,
  extensionId,
}) => {
  const page = await openRunFromHelp(context, extensionId, FULL_RUN);
  await nextTo(page, 2);
  await landedAt(page, 2);
  // PREMISE: folded, the list empty.
  expect((await storedSettings(page)).foldSavedSessionInTabView).toBe(true);
  await expect(
    page.locator('[data-pane="sessions"] [data-drag-row-id]')
  ).toHaveCount(0);
  await expect(page.locator('[data-saved-session-card]')).toHaveCount(0);
  await expect(card(page).locator('p').first()).toHaveText(
    'Type in the search box to find an open tab.'
  );
  await expect(
    card(page).getByRole('img', { name: 'Show the saved session' })
  ).toHaveCount(0);
  expect(await storedRun(page)).toMatchObject({ step: 2, ended: null });
});

test('step 8: a window renamed from its title is stored, and a window folds and unfolds; the card stays at step 8', async ({
  context,
  extensionId,
}) => {
  const page = await openRunFromHelp(context, extensionId, FULL_RUN);
  await nextTo(page, 2);
  await nextTo(page, 3);
  await cardButton(page, 'Use an example').click();
  await expect(cardAt(page, 4)).toBeVisible();
  for (let step = 5; step <= 8; step++) await nextTo(page, step);
  await landedAt(page, 8);
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
  await expect(cardAt(page, 8)).toBeVisible();
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
  await expect(cardAt(page, 8)).toBeVisible();
  expect(await landsOn(page, cx, cy, 'Expand: Things to do')).toBe(true);
  await page.mouse.click(cx, cy);
  await expect(collapse).toHaveAttribute('aria-expanded', 'true');
  await expect(cardAt(page, 8)).toBeVisible();
  expect(await storedRun(page)).toMatchObject({ step: 8, ended: null });
});

test('while the card glides from step 7 to step 8 it takes no pointer, and takes it again when it lands (KAN-453)', async ({
  context,
  extensionId,
}) => {
  const page = await openRunFromHelp(context, extensionId, FULL_RUN);
  await nextTo(page, 2);
  await nextTo(page, 3);
  await cardButton(page, 'Use an example').click();
  await expect(cardAt(page, 4)).toBeVisible();
  for (let step = 5; step <= 7; step++) await nextTo(page, step);
  await landedAt(page, 7);
  // Slowed 100x from before Next, so the glide cannot end under the probes.
  // Not rate 0: on Chromium 156 that also stalls the card's change of step (KAN-559).
  const cdp = await context.newCDPSession(page);
  await cdp.send('Animation.enable');
  await cdp.send('Animation.setPlaybackRate', { playbackRate: 0.01 });
  await cardButton(page, 'Next').click();
  await expect(cardAt(page, 8)).toBeVisible();
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
  // Each lit control the card passes over, and when it first does.
  const covered = new Map<string, number>();
  for (const ms of [0, 40, 80, 120, 160]) {
    await expect.poll(() => hold(ms)).toBe(1);
    for (const label of await coveredNow()) {
      if (!covered.has(label)) covered.set(label, ms);
      const [x, y] = await centreOf(detail.getByLabel(label, { exact: true }));
      expect(await landsOn(page, x, y, label)).toBe(true);
    }
  }
  // CONTROL: the card does pass over a window title, so those hits are tests.
  // KAN-654: the 360px full-view card's path covers the titles, not the fold arrows beside them.
  const title = [...covered].find(([label]) => label.startsWith('Rename'));
  if (title === undefined) throw new Error('the card passed over no title');
  const [label, at] = title;
  // A press on that title while the card is over it reaches the title: its rename field opens.
  await hold(at);
  const [tx, ty] = await centreOf(detail.getByLabel(label, { exact: true }));
  await page.mouse.click(tx, ty);
  await expect(
    detail.getByPlaceholder('Name this window', { exact: true })
  ).toBeVisible();
  // Landed: the glide runs out at normal speed, and the card takes the pointer again.
  await cdp.send('Animation.setPlaybackRate', { playbackRate: 1 });
  await page.evaluate(() =>
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
  await closeReplayNote(page);
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
  for (let step = 5; step <= 10; step++) await nextTo(page, step);
  // KAN-562: about the tab, so it isn't read as the toolbar pin that follows.
  await expect(card(page)).toContainText(
    'Keep Tab Keeper open in a pinned tab.'
  );
  await cardButton(page, 'Pin this tab').click();
  await expect.poll(pinned).toBe(true);
  await expect.poll(() => storedRun(page)).toMatchObject({ ended: 'finished' });
});

test('Esc on a middle card is Skip tutorial; on the last it is Not now (R5); on the note it closes it; all prevented', async ({
  context,
  extensionId,
}) => {
  await watchEscapes(context);
  const page = await openRunFromHelp(context, extensionId, FULL_RUN);
  await page.keyboard.press('Escape');
  await expect.poll(() => storedRun(page)).toMatchObject({ ended: 'skipped' });
  await expect(replayNote(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(replayNote(page)).toHaveCount(0);
  await startRunFromHelp(page);
  await expect(cardAt(page, 1)).toBeVisible();
  for (let step = 2; step <= 3; step++) await nextTo(page, step);
  await cardButton(page, 'Use an example').click();
  for (let step = 5; step <= 10; step++) await nextTo(page, step);
  await page.keyboard.press('Escape');
  await expect.poll(() => storedRun(page)).toMatchObject({ ended: 'finished' });
  await expect(replayNote(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(replayNote(page)).toHaveCount(0);
  expect(await escapesPrevented(page)).toEqual([true, true, true, true]);
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

  // KAN-999. The rail's column is 53px: the 44px rail card and its margins.
  // O1. Steps 1 and 2 light the card, not the column, ringed 4px out at 16.
  test('under 1100px, steps 1 and 2 light the rail’s card, ringed on screen', async ({
    context,
    extensionId,
  }) => {
    const page = await openRunFromHelp(context, extensionId, {
      ...FULL_RUN,
      viewport: { width: 1000, height: 800 },
    });
    const rail = await page.locator('[data-pane="open-now"]').boundingBox();
    if (rail === null) throw new Error('no rail');
    expect(rail.width).toBeCloseTo(53, 0);
    const railCard = (await page
      .locator('[data-pane="open-now"] > * > *')
      .first()
      .boundingBox())!;
    // The ring sits 4px outside what it rings, at 16, inside the window.
    const ringsCard = async () => {
      const r = await ring(page);
      const radius = await page
        .locator('[data-coach-ring]')
        .evaluate((el) => getComputedStyle(el).borderRadius);
      return {
        left: Math.round(r.left - railCard.x),
        top: Math.round(r.top - railCard.y),
        width: Math.round(r.width - railCard.width),
        height: Math.round(r.height - railCard.height),
        radius,
      };
    };
    const want = { left: -4, top: -4, width: 8, height: 8, radius: '16px' };
    await expect.poll(ringsCard).toEqual(want);
    await nextTo(page, 2);
    await landedAt(page, 2);
    await expect.poll(ringsCard).toEqual(want);
  });

  // KAN-868. Side by side always has a grip now, down to 1100px.
  // KAN-900. The ring takes the search row and fold, not the full-height grip and the list under them;
  // the grip gets a hole of its own, so it shows its line and can be dragged.
  for (const width of [1100, 1400]) {
    test(`at ${width}px, step 2 rings the search row; the edge stays lit and draggable outside the ring`, async ({
      context,
      extensionId,
    }) => {
      const page = await openRunFromHelp(context, extensionId, {
        ...FULL_RUN,
        viewport: { width, height: 800 },
      });
      await nextTo(page, 2);
      const gripLocator = page.locator('[data-resize-grip]');
      const grip = await gripLocator.boundingBox();
      if (grip === null) throw new Error('no grip');
      const search = await page
        .locator('[data-pane="open-now"] [data-open-now-search]')
        .boundingBox();
      if (search === null) throw new Error('no search row');
      // The ring ends at the search row: the list under it stays dimmed.
      await expect
        .poll(async () => (await ring(page)).bottom)
        .toBeLessThan(search.y + search.height + 20);
      // The grip's dots, at mid-height, are outside the ring.
      expect((await ring(page)).bottom).toBeLessThan(grip.y + grip.height / 2);
      // Mid-height, the grip's dots: no dim over them, and its line is shown.
      const [x, y] = await centreOf(gripLocator);
      expect(['dim', 'still', 'nothing']).not.toContain(
        await hitAt(page, x, y)
      );
      await expect
        .poll(() =>
          gripLocator.evaluate((g) => getComputedStyle(g, '::before').opacity)
        )
        .toBe('1');
      // CONTROL: the list beside it is under the dim.
      const listY = search.y + search.height + 120;
      expect(await hitAt(page, search.x + 60, listY)).toBe('dim');

      // A drag on the edge widens Currently open, and the card stays.
      const pane = page.locator('[data-pane="open-now"]');
      const before = (await pane.boundingBox())?.width ?? 0;
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x - 80, y, { steps: 8 });
      await page.mouse.up();
      await expect
        .poll(async () => (await pane.boundingBox())?.width ?? 0)
        .toBeGreaterThan(before + 40);
      await expect(cardAt(page, 2)).toBeVisible();
    });
  }
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

  // Round 3 (A). Folded with sessions saved, step 2 teaches search alone: the
  // Saved session card and the rows stay dimmed, and step 4 shows the session.
  const savedCard = (page: Page) => page.locator('[data-saved-session-card]');
  const sessionRow = (page: Page, id: string) =>
    page.locator(`[data-pane="sessions"] [data-drag-row-id="${id}"]`);
  const overlaps = async (a: Locator, b: Locator) => {
    const [p, q] = [await a.boundingBox(), await b.boundingBox()];
    if (p === null || q === null) throw new Error('not drawn');
    return (
      p.x < q.x + q.width &&
      q.x < p.x + p.width &&
      p.y < q.y + q.height &&
      q.y < p.y + p.height
    );
  };
  const reachable = async (page: Page, l: Locator) => {
    const [x, y] = await centreOf(l);
    return !['dim', 'still', 'nothing'].includes(await hitAt(page, x, y));
  };
  const atFoldedStep2 = async (
    context: BrowserContext,
    extensionId: string
  ) => {
    const page = await openRunFromHelp(context, extensionId, FULL_RUN);
    await nextTo(page, 2);
    await landedAt(page, 2);
    // PREMISE: folded, the card drawn, a session selected.
    await expect(savedCard(page)).toBeVisible();
    const selected = await page.evaluate(
      (): unknown =>
        JSON.parse(localStorage.getItem('tabContainerData') ?? '{}')
          .selectedTabGroupId
    );
    expect(['old', 'new']).toContain(selected);
    const other = selected === 'old' ? 'new' : 'old';
    return { page, selected: String(selected), other };
  };

  test('step 2, folded: search alone; one ring; the card and the rows stay dimmed', async ({
    context,
    extensionId,
  }) => {
    const { page, selected, other } = await atFoldedStep2(context, extensionId);
    await expect(card(page).locator('p').first()).toHaveText(
      'Type in the search box to find an open tab.'
    );
    await expect(card(page).getByRole('img')).toHaveCount(0);
    await expect(
      page.locator('[data-coach-ring], [data-coach-opening-ring]')
    ).toHaveCount(1);
    expect(await cardSide(page)).toBe('below');
    expect(await reachable(page, savedCard(page))).toBe(false);
    expect(await reachable(page, sessionRow(page, selected))).toBe(false);
    expect(await reachable(page, sessionRow(page, other))).toBe(false);
    // CONTROL: the search row is live.
    expect(
      await reachable(
        page,
        page.locator('[data-pane="open-now"] [data-open-now-search] input')
      )
    ).toBe(true);
  });

  // KAN-1020. Typing at step 2 lists matches under the search row: the card
  // ends where the row ends, so the matches at its left stay in view.
  test('step 2, folded: typing leaves the matches uncovered; the card ends where the search row ends', async ({
    context,
    extensionId,
  }) => {
    const { page } = await atFoldedStep2(context, extensionId);
    const searchRow = page.locator(
      '[data-pane="open-now"] [data-open-now-search]'
    );
    await searchRow.locator('input').fill('blank');
    const match = page
      .locator('[data-pane="open-now"]')
      .getByText('about:blank', { exact: true })
      .first();
    // PREMISE: the profile's blank tab is a match to cover.
    await expect(match).toBeVisible();
    await landedAt(page, 2);
    expect(await cardSide(page)).toBe('below');
    expect(await overlaps(card(page), match)).toBe(false);
    const row = (await searchRow.boundingBox())!;
    const c = (await card(page).boundingBox())!;
    expect(c.y).toBeGreaterThan(row.y + row.height);
    // The card's right edge lines up with the row's, as mock B drew it.
    expect(Math.abs(c.x + c.width - (row.x + row.width))).toBeLessThanOrEqual(
      4
    );
  });

  test('step 2, folded: a press on the dimmed Saved session card says why and shows nothing; step 4 shows the session', async ({
    context,
    extensionId,
  }) => {
    const { page } = await atFoldedStep2(context, extensionId);
    const [x, y] = await centreOf(savedCard(page));
    await page.mouse.click(x, y);
    await expect(page.locator('[data-coach-nudge]')).toHaveText(
      'Everything else works after the tour.'
    );
    await twoFrames(page);
    expect((await storedSettings(page)).foldSavedSessionInTabView).toBe(true);
    await expect(page.locator('[data-pane="detail"]')).toHaveCount(0);
    expect(await storedRun(page)).toMatchObject({ step: 2, ended: null });
    // Nothing is lost: step 4 slides the session in by itself.
    await nextTo(page, 3);
    await nextTo(page, 4);
    await landedAt(page, 4);
    await expect(page.locator('[data-pane="detail"]')).toBeVisible();
    await expect(savedCard(page)).toHaveCount(0);
  });

  // KAN-736. The ⋮ step is look-only: a right-click on the dimmed title or the lit ⋮ opens no menu, Chrome's included.
  test('step 7: a right-click on the session title or the ⋮ opens no menu; after the tour the title opens its own', async ({
    context,
    extensionId,
  }) => {
    await context.addInitScript(() => {
      const prevented: boolean[] = [];
      Object.defineProperty(window, '__contextMenus', { value: prevented });
      // Seen in the capture phase, read once every listener has run.
      window.addEventListener(
        'contextmenu',
        (e) => setTimeout(() => prevented.push(e.defaultPrevented), 0),
        true
      );
    });
    const page = await openRunFromHelp(context, extensionId, FULL_RUN);
    for (let step = 2; step <= 7; step++) await nextTo(page, step);
    await landedAt(page, 7);
    const title = page
      .locator('[data-pane="detail"]')
      .getByText('Latest', { exact: true })
      .first();
    const dots = page.locator(
      '[data-pane="detail"] [data-tour-anchor="session-menu"]'
    );
    for (const target of [title, dots]) {
      const [x, y] = await centreOf(target);
      await page.mouse.click(x, y, { button: 'right' });
    }
    const contextMenus = () =>
      page.evaluate((): unknown => Reflect.get(window, '__contextMenus'));
    await expect.poll(contextMenus).toEqual([true, true]);
    await expect(page.getByRole('menu')).toHaveCount(0);
    await expect(cardAt(page, 7)).toBeVisible();
    // CONTROL: with the tour gone, the same right-click opens the title's own menu.
    await cardButton(page, 'Skip tutorial').click();
    await closeReplayNote(page);
    await expect(card(page)).toHaveCount(0);
    const [x, y] = await centreOf(title);
    await page.mouse.click(x, y, { button: 'right' });
    await expect(page.getByRole('menu')).toHaveCount(1);
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
    // KAN-735. Step 3 already named the list, so step 4 only says what the selection shows.
    await expect(card(page).locator('p').first()).toHaveText(
      'The selected session shows its windows and tabs on the right.'
    );
    await expect
      .poll(() => storedRun(page))
      .toMatchObject({ sessionId: 'new' });
    await expect(
      page.locator(
        '[data-pane="sessions"] [data-drag-row-id="new"] [data-run-engaged]'
      )
    ).toHaveCount(1);
    // KAN-735 CONTROL: an anchored card keeps the framed notch: just above the frame, its middle is the card's fill.
    await landedAt(page, 4);
    const notch = card(page).locator('[data-coach-notch]');
    await expect(notch).toHaveCount(1);
    const at = await card(page).evaluate((el) => {
      const n = el.querySelector('[data-coach-notch]')!.getBoundingClientRect();
      const c = el.getBoundingClientRect();
      return {
        x: n.left + n.width / 2,
        width: n.width,
        frame: c.top,
        fill: getComputedStyle(el).backgroundColor,
      };
    });
    expect(at.width).toBe(16);
    const [inside] = await pixelsAt(page, [[at.x, at.frame - 1]]);
    expect(inside).toBe(rgbToHex(at.fill));
    // A reload on step 4 forgets which card step 3 showed, so step 4 names the list again.
    await page.reload();
    await expect(cardAt(page, 4)).toBeVisible();
    await expect(card(page).locator('p').first()).toHaveText(
      'Here are your saved sessions. The selected one shows its windows and tabs on the right.'
    );
  });

  test('step 5 lights the run’s row’s own Open and step 6 its Replace, not another row’s, and step 7 its header’s ⋮', async ({
    context,
    extensionId,
  }) => {
    const page = await openRunFromHelp(context, extensionId, FULL_RUN);
    for (let step = 2; step <= 5; step++) await nextTo(page, step);
    for (const [step, anchor] of [
      [5, 'row-open'],
      [6, 'row-replace'],
      [7, 'session-menu'],
    ] as const) {
      if (step > 5) await nextTo(page, step);
      // KAN-582. Step 7, Delete, points at the session header's ⋮.
      const own = await page
        .locator(
          step === 7
            ? `[data-pane="detail"] [data-tour-anchor="${anchor}"]`
            : `[data-pane="sessions"] [data-drag-row-id="new"] [data-tour-anchor="${anchor}"]`
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
    await showRowActions(row);
    await page.mouse.click(
      ...(await centreOf(row.locator('[data-tour-anchor="row-open"]')))
    );
    await twoFrames(page);
    expect(await opened()).toBeGreaterThan(0);
    await page.bringToFront();
    await page
      .locator('[data-pane="detail"] [data-tour-anchor="session-menu"]')
      .getByRole('button', { name: 'More actions' })
      .click();
    await page.getByRole('menuitem', { name: 'Delete session' }).click();
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
    for (let step = 5; step <= 10; step++) await nextTo(page, step);
    await cardButton(page, 'Not now').click();
    await expect
      .poll(() => storedRun(page))
      .toMatchObject({ ended: 'finished' });
    expect(await storedTitles(page)).toEqual(['Older', 'Latest']);
    await expect.poll(look).toEqual(['none', null]);
  });
});
