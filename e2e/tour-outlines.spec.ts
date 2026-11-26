import type { Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { twoFrames } from './fixtures/onboarding';
import {
  FULL_RUN,
  card,
  cardAt,
  cardButton,
  centreOf,
  hitAt,
  landedAt,
  nextTo,
  openRunFromHelp,
} from './fixtures/run';

// Round 2 of KAN-1020..1023 (O1): every lit area is ringed, 4px out, at its
// own corners; and every press the tour turns away says why.

interface Drawn {
  left: number;
  top: number;
  right: number;
  bottom: number;
  radius: string;
}

// Every ring on screen, the anchor's first.
const rings = (page: Page): Promise<Drawn[]> =>
  page.evaluate(() =>
    [
      ...document.querySelectorAll(
        '[data-coach-ring], [data-coach-opening-ring]'
      ),
    ].map((el) => {
      const b = el.getBoundingClientRect();
      return {
        left: b.left,
        top: b.top,
        right: b.right,
        bottom: b.bottom,
        radius: getComputedStyle(el).borderRadius,
      };
    })
  );

// The union of a pane's panels: its column's children, drawn.
const panelsOf = (page: Page, pane: string) =>
  page.evaluate((pane) => {
    const kids = [
      ...document.querySelector(`[data-pane="${pane}"]`)!.firstElementChild!
        .children,
    ]
      .map((c) => c.getBoundingClientRect())
      .filter((b) => b.width > 0 && b.height > 0);
    return {
      left: Math.min(...kids.map((b) => b.left)),
      top: Math.min(...kids.map((b) => b.top)),
      right: Math.max(...kids.map((b) => b.right)),
      bottom: Math.max(...kids.map((b) => b.bottom)),
    };
  }, pane);

const nudge = (page: Page) => card(page).locator('[data-coach-nudge]');
const LINE = 'Everything else works after the tour.';

test('every lit area is ringed 4px out at its own corners; step 1 rings the panels on every side, on screen', async ({
  context,
  extensionId,
}) => {
  const page = await openRunFromHelp(context, extensionId, FULL_RUN);
  await landedAt(page, 1);
  const viewport = page.viewportSize()!;
  const [one, ...rest] = await rings(page);
  expect(rest).toEqual([]);
  const panels = await panelsOf(page, 'open-now');
  expect(one).toEqual({
    left: panels.left - 4,
    top: panels.top - 4,
    right: panels.right + 4,
    bottom: panels.bottom + 4,
    radius: '16px',
  });
  expect(one.left).toBeGreaterThanOrEqual(0);
  expect(one.top).toBeGreaterThanOrEqual(0);
  expect(one.right).toBeLessThanOrEqual(viewport.width);
  expect(one.bottom).toBeLessThanOrEqual(viewport.height);

  // Step 2: the search row ringed; the 8px edge beside it lit, not ringed.
  await nextTo(page, 2);
  await landedAt(page, 2);
  const two = await rings(page);
  expect(two).toHaveLength(1);
  expect(two[0].radius).toBe('12px');

  await nextTo(page, 3);
  await cardButton(page, 'Use an example').click();
  await landedAt(page, 4);
  // Step 4: the row ringed at its fill's corners, and the right pane too.
  const four = await rings(page);
  expect(four).toHaveLength(2);
  const detail = await panelsOf(page, 'detail');
  expect(four[1]).toEqual({
    left: detail.left - 4,
    top: detail.top - 4,
    right: detail.right + 4,
    bottom: detail.bottom + 4,
    radius: '16px',
  });
});

test('every press the tour turns away says why: a lit look-only area, a right-click on the dim, a right-click on a lit row', async ({
  context,
  extensionId,
}) => {
  const page = await openRunFromHelp(context, extensionId, FULL_RUN);
  await landedAt(page, 1);
  // Step 1 is look-only: a press on Currently open.
  const openNow = page.locator('[data-pane="open-now"] [data-open-now-search]');
  const [x, y] = await centreOf(openNow);
  expect(await hitAt(page, x, y)).toBe('still');
  await page.mouse.click(x, y);
  await expect(nudge(page)).toHaveText(LINE);
  // A new step, a new card: the line goes.
  await nextTo(page, 2);
  await expect(nudge(page)).toHaveCount(0);
  // A right-click on the dim.
  const sessions = (await page
    .locator('[data-pane="sessions"]')
    .boundingBox())!;
  expect(await hitAt(page, sessions.x + 20, sessions.y + 200)).toBe('dim');
  await page.mouse.click(sessions.x + 20, sessions.y + 200, {
    button: 'right',
  });
  await expect(nudge(page)).toHaveText(LINE);

  // Step 8 is live: a right-click on a lit window opens no menu, and says why.
  await nextTo(page, 3);
  await cardButton(page, 'Use an example').click();
  for (const step of [5, 6, 7, 8]) await nextTo(page, step);
  await landedAt(page, 8);
  await expect(nudge(page)).toHaveCount(0);
  await expect(card(page)).toContainText(
    "Each window can be opened on its own. Click a window's title to rename it. After the tour, right-click it for more."
  );
  const window = page
    .locator('[data-pane="detail"] [data-window-drag-handle]')
    .first();
  const at = (await window.boundingBox())!;
  const [wx, wy] = [at.x + 8, at.y + 4];
  expect(await hitAt(page, wx, wy)).not.toMatch(/^(dim|still)$/);
  await page.mouse.click(wx, wy, { button: 'right' });
  await twoFrames(page);
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(nudge(page)).toHaveText(LINE);
  await expect(cardAt(page, 8)).toBeVisible();
});
