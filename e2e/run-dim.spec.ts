import type { Locator, Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { buildContainer, buildSession, seedSessions } from './fixtures/seed';
import { pageGround, twoFrames } from './fixtures/onboarding';
import { pixelsAt, rgbToHex } from './fixtures/pixels';
import {
  RUN_VIEWS,
  card,
  cardAt,
  cardButton,
  centreOf,
  hitAt,
  nextTo,
  openRunFromHelp,
  runDrawn,
  storedRun,
  storedTitles,
  watchRunDrawn,
  FULL_RUN,
} from './fixtures/run';
import { LIGHT_THEME } from '../src/hooks/useThemeColors';

// KAN-421 on the run: the page is dimmed outside the step's bright box, and a press there does nothing.

const dim = (page: Page) => page.locator('[data-coach-dim]');
// 2/64px: a LayoutUnit each side of the inline px the dim and ring are placed at.
const near = (a: number, b: number) => Math.abs(a - b) <= 2 / 64;

interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

// The dim's hole, read back from its clip-path: the last five points, after the viewport's.
const brightBox = (page: Page) =>
  dim(page).evaluate((el): Rect | null => {
    const path = el instanceof HTMLElement ? el.style.clipPath : '';
    const points = [...path.matchAll(/(-?[\d.]+)px (-?[\d.]+)px/g)].map(
      (m) => [Number(m[1]), Number(m[2])] as const
    );
    const hole = points.slice(-5);
    if (!path.startsWith('polygon(evenodd') || hole.length !== 5) return null;
    const [[left, top], , [right, bottom]] = hole;
    return { left, top, right, bottom };
  });

const sameRect = (a: Rect | null, b: Rect | null) =>
  a !== null &&
  b !== null &&
  near(a.left, b.left) &&
  near(a.top, b.top) &&
  near(a.right, b.right) &&
  near(a.bottom, b.bottom);

// The page as painted with the dim shown, and again with it hidden for one screenshot.
async function withAndWithoutDim(
  page: Page,
  points: [number, number][]
): Promise<{ shown: string[]; hidden: string[] }> {
  const shown = await pixelsAt(page, points);
  await dim(page).evaluate((el) => {
    if (el instanceof HTMLElement) el.style.visibility = 'hidden';
  });
  await twoFrames(page);
  const hidden = await pixelsAt(page, points);
  await dim(page).evaluate((el) => {
    if (el instanceof HTMLElement) el.style.visibility = '';
  });
  return { shown, hidden };
}

const channels = (hex: string) =>
  [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
// `ground` under black at `alpha`, as the compositor blends it.
const underScrim = (ground: string, alpha: number) =>
  channels(ground).map((c) => c * (1 - alpha));
const SCRIM_ALPHA = Number(LIGHT_THEME.TOUR_SCRIM.match(/([\d.]+)\)$/)?.[1]);

for (const view of RUN_VIEWS) {
  test.describe(view.name, () => {
    test('the save card: outside the bright box the page is under the theme’s scrim, inside it is not', async ({
      context,
      extensionId,
    }) => {
      const page = await openRunFromHelp(context, extensionId, view);
      if (view.view === 'full') {
        for (let step = 2; step <= 3; step++) await nextTo(page, step);
      }
      const ground = await pageGround(page);
      expect(ground).toBe(LIGHT_THEME.PRIMARY_COLOR);
      const save = page.locator('[data-tour-anchor="save"]');
      const box = await save.boundingBox();
      if (box === null) throw new Error('no save row');
      await expect
        .poll(async () =>
          sameRect(await brightBox(page), {
            left: box.x,
            top: box.y,
            right: box.x + box.width,
            bottom: box.y + box.height,
          })
        )
        .toBe(true);
      const outside: [number, number] = [box.x + 20, box.y + box.height + 120];
      const inside: [number, number] = [box.x + 10, box.y + box.height / 2];
      const { shown, hidden } = await withAndWithoutDim(page, [
        outside,
        inside,
      ]);
      const want = underScrim(hidden[0], SCRIM_ALPHA);
      expect(
        channels(shown[0]).every((c, i) => Math.abs(c - want[i]) <= 2)
      ).toBe(true);
      expect(shown[1]).toBe(hidden[1]);
    });

    test('a press on the dim does nothing: Settings stays shut and the card stays', async ({
      context,
      extensionId,
    }) => {
      const page = await openRunFromHelp(context, extensionId, view);
      const settings = page.getByRole('button', {
        name: 'Settings',
        exact: true,
      });
      const sort = page.locator('[aria-label="Sort sessions"]');
      // Records whether the home list ever left, from before the press.
      await page.evaluate(() => {
        const seen = { left: false };
        Object.defineProperty(globalThis, '__homeLeft', { value: seen });
        new MutationObserver(() => {
          if (document.querySelector('[aria-label="Sort sessions"]') === null)
            seen.left = true;
        }).observe(document.body, { childList: true, subtree: true });
      });
      const homeLeft = () =>
        page.evaluate(() =>
          Reflect.get(Reflect.get(globalThis, '__homeLeft'), 'left')
        );
      const [x, y] = await centreOf(settings);
      expect(await hitAt(page, x, y)).toBe('dim');
      await page.mouse.click(x, y);
      await twoFrames(page);
      await expect(cardAt(page, 1)).toBeVisible();
      expect(await homeLeft()).toBe(false);
      // CONTROL: with the run gone, the same press opens Settings, and the observer sees it.
      await page.keyboard.press('Escape');
      await expect(card(page)).toHaveCount(0);
      await page.mouse.click(x, y);
      await expect(sort).toHaveCount(0);
      expect(await homeLeft()).toBe(true);
    });

    test('the keyboard is free: choosing another session hides a session step’s card, and choosing the run’s brings it back', async ({
      context,
      extensionId,
    }) => {
      await seedSessions(
        context,
        buildContainer([
          buildSession({ tabGroupId: 'kept', title: 'Kept', createdAt: 1000 }),
          buildSession({
            tabGroupId: 'newer',
            title: 'Newer',
            createdAt: 2000,
          }),
        ])
      );
      const page = await openRunFromHelp(context, extensionId, view);
      if (view.view === 'full') {
        // R10: the run goes on with Newer, the latest.
        for (let step = 2; step <= 4; step++) await nextTo(page, step);
      } else {
        await cardButton(page, 'Use an example').click();
        await expect(cardAt(page, 2)).toBeVisible();
      }
      const row = (id: string) =>
        page
          .locator(`[data-pane="sessions"] [data-drag-row-id="${id}"]`)
          .getByRole('button')
          .first();
      await row('kept').focus();
      await row('kept').press('Enter');
      await expect(card(page)).toHaveCount(0);
      await expect(dim(page)).toHaveCount(0);
      const run = await storedRun(page);
      const runId =
        typeof run === 'object' && run !== null
          ? Reflect.get(run, 'sessionId')
          : null;
      if (typeof runId !== 'string') throw new Error('the run has no session');
      await row(runId).focus();
      await row(runId).press('Enter');
      await expect(card(page)).toHaveCount(1);
    });
  });
}

// The run's own save raises the usual toast over the dim; ⌘Z of that save at the next step ends the run as R2 says.
test('full view: the run’s save toast is drawn over the dim and takes the pointer; ⌘Z at step 4 undoes the save and the run ends quietly', async ({
  context,
  extensionId,
}) => {
  const gmail = 'https://mail.google.com/mail/u/0/';
  await context.route(gmail, (route) =>
    route.fulfill({
      contentType: 'text/html; charset=utf-8',
      body: '<title>(3) Inbox – Gmail</title>',
    })
  );
  await watchRunDrawn(context);
  await (await context.newPage()).goto(gmail);
  const page = await openRunFromHelp(context, extensionId, FULL_RUN);
  await nextTo(page, 2);
  await nextTo(page, 3);
  await page
    .locator('[data-tour-anchor="save"]')
    .getByRole('button', {
      name: 'Save all open windows as a session',
      exact: true,
    })
    .click();
  const toast = page.locator('[data-toast]', {
    hasText: 'All open windows saved as a session.',
  });
  await expect(toast).toBeVisible();
  await expect(cardAt(page, 4)).toBeVisible();
  await expect(dim(page)).toHaveCount(1);
  const [x, y] = await centreOf(toast);
  expect(
    await page.evaluate(
      ([x, y]) =>
        document.elementFromPoint(x, y)?.closest('[data-toast]') != null,
      [x, y]
    )
  ).toBe(true);
  // CONTROL: beside the toast, the same probe lands on the dim.
  const box = await toast.boundingBox();
  if (box === null) throw new Error('no toast');
  expect(await hitAt(page, box.x - 10, box.y + box.height / 2)).toBe('dim');
  expect(await storedTitles(page)).toEqual(['Inbox – Gmail']);

  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(() => storedTitles(page)).toEqual([]);
  await expect
    .poll(() => storedRun(page))
    .toMatchObject({ view: 'full', ended: 'sessionGone' });
  await expect(card(page)).toHaveCount(0);
  await expect(dim(page)).toHaveCount(0);
  // R2: nothing opens after it. CONTROL: first-run-open's setup test, where this observer sees setup.
  expect(await runDrawn(page)).toEqual(['card', 'hello']);
});

// A card's own fill, painted as is: a point inside its padding reads its computed background.
async function isUndimmed(page: Page, card: Locator): Promise<boolean> {
  const box = await card.boundingBox();
  if (box === null) return false;
  const fill = await card.evaluate(
    (el) => getComputedStyle(el).backgroundColor
  );
  const [painted] = await pixelsAt(page, [[box.x + 5, box.y + 5]]);
  return painted === rgbToHex(fill);
}

test('full view step 7: a tab drags with its card, and carried out over the dimmed list its carry card is drawn over the dim', async ({
  context,
  extensionId,
}) => {
  const page = await openRunFromHelp(context, extensionId, FULL_RUN);
  await nextTo(page, 2);
  await nextTo(page, 3);
  await cardButton(page, 'Use an example').click();
  await expect(cardAt(page, 4)).toBeVisible();
  for (let step = 5; step <= 7; step++) await nextTo(page, step);
  const from = await page
    .locator(
      '[data-pane="detail"] [data-tour-anchor="windows"] [data-window-tabs] [data-drag-row-id]'
    )
    .first()
    .boundingBox();
  if (from === null) throw new Error('no tab row');
  const [x, y] = [from.x + 60, from.y + from.height / 2];
  // Polled: the card glides to its place at step 7, over these rows on the way.
  await expect
    .poll(async () => (await hitAt(page, x, y)).includes('Flights to Lisbon'))
    .toBe(true);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + 10, { steps: 3 });
  await page.mouse.move(x, y + 40, { steps: 8 });
  const dragCard = page.locator('[data-drag-card]');
  await expect(dragCard).toBeVisible();
  await expect.poll(() => isUndimmed(page, dragCard)).toBe(true);
  // Out over the session list, outside the bright box: a carry.
  const sessions = await page.locator('[data-pane="sessions"]').boundingBox();
  if (sessions === null) throw new Error('no session list');
  await page.mouse.move(
    sessions.x + sessions.width / 2,
    sessions.y + sessions.height * 0.8,
    { steps: 25 }
  );
  const carried = page.locator('[data-carry-card]');
  await expect(carried).toBeVisible();
  const box = await carried.boundingBox();
  if (box === null) throw new Error('no carry card');
  // CONTROL: the page beside the card is under the dim.
  expect(await hitAt(page, box.x - 10, box.y + box.height / 2)).toBe('dim');
  await expect.poll(() => isUndimmed(page, carried)).toBe(true);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(cardAt(page, 7)).toBeVisible();
});
