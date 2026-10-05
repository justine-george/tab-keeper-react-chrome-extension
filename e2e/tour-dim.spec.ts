import type { BrowserContext, Locator, Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { buildContainer, buildSession, seedSessions } from './fixtures/seed';
import { openPage, pageGround } from './fixtures/onboarding';
import { pixelsAt, rgbToHex } from './fixtures/pixels';
import { boxOf } from './fixtures/savedWindows';
import {
  SAMPLE_TITLE,
  TOUR_VIEWS,
  coach,
  coachAt,
  nextTo,
  startTour,
  storedTour,
  toastsSeen,
  twoFrames,
  watchToasts,
  type TourViewCase,
} from './fixtures/tour';
import { COACH } from '../src/components/tour/coachMarkPlacement';
import { LIGHT_THEME } from '../src/hooks/useThemeColors';
import { isValidTabMasterContainer } from '../src/utils/functions/local';

// KAN-421. The tour dims the page outside the step's bright box, and a press there does nothing.

const dim = (page: Page) => page.locator('[data-coach-dim]');
const detail = (page: Page) => page.locator('[data-pane="detail"]');
const IN_ROWS =
  '[data-pane="detail"] [data-tour-anchor="windows"] [data-window-tabs] [data-drag-row-id]';
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

// The ring's box, and the step-1 box: the window rows' union, RING_INSET outside.
const measured = (page: Page) =>
  page.evaluate(
    ({ inset, rows }) => {
      const rect = (r: DOMRect) => ({
        left: r.left,
        top: r.top,
        right: r.right,
        bottom: r.bottom,
      });
      const ring = document.querySelector('[data-coach-ring]');
      const boxes = [
        ...document.querySelectorAll(
          '[data-pane="detail"] [data-tour-anchor="windows"] [data-drag-row-id]'
        ),
      ]
        .map((row) => row.getBoundingClientRect())
        .filter((b) => b.width > 0 && b.height > 0);
      const first = document.querySelector(rows)?.getBoundingClientRect();
      return {
        ring: ring ? rect(ring.getBoundingClientRect()) : null,
        firstTab: first ? rect(first) : null,
        rows: {
          left: Math.min(...boxes.map((b) => b.left)) - inset,
          top: Math.min(...boxes.map((b) => b.top)) - inset,
          right: Math.max(...boxes.map((b) => b.right)) + inset,
          bottom: Math.max(...boxes.map((b) => b.bottom)) + inset,
        },
      };
    },
    { inset: COACH.RING_INSET, rows: IN_ROWS }
  );
const sameRect = (a: Rect | null, b: Rect | null) =>
  a !== null &&
  b !== null &&
  near(a.left, b.left) &&
  near(a.top, b.top) &&
  near(a.right, b.right) &&
  near(a.bottom, b.bottom);

// What a pointer at (x, y) lands on first: the dim, or else the element's own text and attributes.
const hitAt = (page: Page, x: number, y: number) =>
  page.evaluate(
    ([x, y]) => {
      const top = document.elementFromPoint(x, y);
      if (top === null) return 'nothing';
      if (top.hasAttribute('data-coach-dim')) return 'dim';
      return top.outerHTML.slice(0, 120);
    },
    [x, y]
  );
const centre = async (loc: Locator): Promise<[number, number]> => {
  const b = await boxOf(loc);
  return [b.x + b.width / 2, b.y + b.height / 2];
};

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

// A card's own fill, painted as is: a point inside its padding reads its computed background.
async function cardIsUndimmed(page: Page, card: Locator): Promise<boolean> {
  const box = await boxOf(card);
  const fill = await card.evaluate(
    (el) => getComputedStyle(el).backgroundColor
  );
  const [painted] = await pixelsAt(page, [[box.x + 5, box.y + 5]]);
  return painted === rgbToHex(fill);
}

// A tour started from Help beside a session already saved, so another session is on the list.
async function tourBesideKept(
  context: BrowserContext,
  extensionId: string,
  view: TourViewCase
): Promise<Page> {
  await seedSessions(
    context,
    buildContainer([buildSession({ title: 'Kept' })])
  );
  const page = await openPage(context, extensionId, view.path, view.viewport);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Help', exact: true }).click();
  await page
    .locator('[data-help]')
    .getByRole('button', { name: 'Show me around', exact: true })
    .click();
  await expect(coachAt(page, 1)).toBeVisible();
  return page;
}

const sampleWindows = async (page: Page): Promise<string[][]> => {
  const parsed: unknown = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('tabContainerData') ?? 'null')
  );
  const sample = isValidTabMasterContainer(parsed)
    ? parsed.tabGroups.find((g) => g.title === SAMPLE_TITLE)
    : undefined;
  return (sample?.windows ?? []).map((w) => w.tabs.map((t) => t.title));
};

for (const view of TOUR_VIEWS) {
  test.describe(view.name, () => {
    test('step 1: outside the ring the page is under the theme’s scrim, inside it is not', async ({
      context,
      extensionId,
    }) => {
      const page = await startTour(context, extensionId, view);
      const ground = await pageGround(page);
      // CONTROL: the default theme, whose scrim this expects.
      expect(ground).toBe(LIGHT_THEME.PRIMARY_COLOR);
      await expect
        .poll(async () =>
          sameRect(await brightBox(page), (await measured(page)).ring)
        )
        .toBe(true);
      const ring = (await measured(page)).ring;
      if (ring === null) throw new Error('no ring');
      // Plain ground below the rows, outside the ring; and inside the ring, right of the first tab's title.
      const outside: [number, number] = [ring.left + 20, ring.bottom + 30];
      const inside: [number, number] = [ring.right - 12, ring.top + 50];
      const { shown, hidden } = await withAndWithoutDim(page, [
        outside,
        inside,
      ]);
      // CONTROL: the decode is faithful, and the outside point is the page's own ground.
      expect(hidden[0]).toBe(ground);
      const want = underScrim(hidden[0], SCRIM_ALPHA);
      const got = channels(shown[0]);
      expect(
        got.every((c, i) => Math.abs(c - want[i]) <= 2),
        `${shown[0]} is ${hidden[0]} under ${LIGHT_THEME.TOUR_SCRIM}`
      ).toBe(true);
      expect(shown[1]).toBe(hidden[1]);
    });

    test('step 1: a press on the dimmed page does nothing, while the fold arrow inside the bright box works', async ({
      context,
      extensionId,
    }) => {
      const page = await startTour(context, extensionId, view);
      const collapseAll = detail(page).getByRole('button', {
        name: 'Collapse all windows',
        exact: true,
      });
      const settings = page.getByRole('button', {
        name: 'Settings',
        exact: true,
      });
      for (const control of [collapseAll, settings]) {
        const [x, y] = await centre(control);
        expect(await hitAt(page, x, y)).toBe('dim');
        await page.mouse.click(x, y);
      }
      // CONTROL and barrier: the fold arrow, inside the ring, takes the press and moves the tour on.
      await page
        .getByRole('button', { name: 'Collapse: Getting there', exact: true })
        .click();
      await expect(coachAt(page, 2)).toBeVisible();
      // Collapse all would have folded this one too; Settings would have hidden the mark.
      await expect(
        page.getByRole('button', {
          name: 'Collapse: Things to do',
          exact: true,
        })
      ).toBeVisible();
      await expect(collapseAll).toBeVisible();
    });

    test('step 3: a press on the dim leaves the rename field focused and unsaved', async ({
      context,
      extensionId,
    }) => {
      const page = await startTour(context, extensionId, view);
      for (const step of [2, 3]) await nextTo(page, step);
      await page
        .getByRole('button', {
          name: `Rename session: ${SAMPLE_TITLE}`,
          exact: true,
        })
        .click();
      const field = page.locator(
        '[data-pane="detail"] input[data-tour-anchor="title"]'
      );
      await field.fill('Lisbon in May');
      const [x, y] = await centre(
        detail(page).getByRole('button', {
          name: 'Collapse all windows',
          exact: true,
        })
      );
      expect(await hitAt(page, x, y)).toBe('dim');
      await page.mouse.click(x, y);
      await expect(field).toBeFocused();
      await expect(coachAt(page, 3)).toBeVisible();
      // CONTROL: the field still saves on Enter, and the tour moves on.
      await field.press('Enter');
      await expect(coachAt(page, 4)).toBeVisible();
    });

    test('a press on another session in the dimmed list leaves the sample selected and the tour where it was', async ({
      context,
      extensionId,
    }) => {
      const page = await tourBesideKept(context, extensionId, view);
      const kept = page
        .locator('[data-pane="sessions"]')
        .getByRole('button', { name: 'Kept', exact: true });
      const box = await boxOf(kept);
      // Its left end: in the popup the mark covers the middle, and Delete sits at the right.
      const [x, y] = [box.x + 12, box.y + box.height / 2];
      expect(await hitAt(page, x, y)).toBe('dim');
      await page.mouse.click(x, y);
      // Barrier: Next is drawn only while the sample is the session on screen.
      await nextTo(page, 2);
      await expect(
        detail(page).getByText(SAMPLE_TITLE, { exact: true })
      ).toBeVisible();
      expect(await storedTour(page)).toMatchObject({ step: 2 });
    });

    test('the keyboard is not blocked: Tab reaches another session, and choosing it hides the mark and the dim', async ({
      context,
      extensionId,
    }) => {
      const page = await tourBesideKept(context, extensionId, view);
      await expect(dim(page)).toHaveCount(1);
      const kept = page
        .locator('[data-pane="sessions"]')
        .getByRole('button', { name: 'Kept', exact: true });
      let reached = false;
      for (let i = 0; i < 80 && !reached; i++) {
        await page.keyboard.press('Tab');
        reached = await kept.evaluate((el) => el === document.activeElement);
      }
      expect(reached).toBe(true);
      await page.keyboard.press('Enter');
      await expect(
        detail(page).getByText('Kept', { exact: true })
      ).toBeVisible();
      await expect(coach(page)).toHaveCount(0);
      await expect(dim(page)).toHaveCount(0);
      await expect(page.locator('[data-coach-ring]')).toHaveCount(0);
    });

    test('step 4: both windows are bright, the ring stays on the first tab, and a tab drops into the other window', async ({
      context,
      extensionId,
    }) => {
      const page = await startTour(context, extensionId, view);
      for (const step of [2, 3, 4]) await nextTo(page, step);
      await expect
        .poll(async () => {
          const m = await measured(page);
          const ringOnFirstTab =
            m.ring !== null &&
            m.firstTab !== null &&
            near(m.ring.top + COACH.RING_INSET, m.firstTab.top) &&
            near(m.ring.bottom - COACH.RING_INSET, m.firstTab.bottom);
          return ringOnFirstTab && sameRect(await brightBox(page), m.rows);
        })
        .toBe(true);
      expect(await sampleWindows(page)).toEqual([
        [
          'Flights to Lisbon - Google Flights',
          'Hotel in Alfama - Booking.com',
          'Lisbon 10-day weather',
        ],
        ['Things to do in Lisbon - Time Out', 'Belém Tower - opening hours'],
      ]);

      const rows = page.locator(IN_ROWS);
      const from = await boxOf(rows.first());
      const onto = await boxOf(
        page.getByRole('button', {
          name: 'Open in new tab: Things to do in Lisbon - Time Out',
          exact: true,
        })
      );
      const [hx, hy] = await centre(
        page.getByRole('button', { name: 'Settings', exact: true })
      );
      const x = from.x + 60;
      await page.mouse.move(x, from.y + from.height / 2);
      await page.mouse.down();
      await page.mouse.move(x, from.y + from.height / 2 + 10, { steps: 3 });
      const dropY = onto.y + onto.height * 0.75;
      await page.mouse.move(x, dropY, { steps: 20 });
      // Held over the other window: the pointer is on the page, not the dim.
      await expect.poll(() => hitAt(page, x, dropY)).not.toBe('dim');
      // CONTROL: the same probe outside the bright box finds the dim.
      expect(await hitAt(page, hx, hy)).toBe('dim');
      await page.mouse.up();
      await expect(coachAt(page, 5)).toBeVisible();
      await expect
        .poll(() => sampleWindows(page))
        .toEqual([
          ['Hotel in Alfama - Booking.com', 'Lisbon 10-day weather'],
          [
            'Things to do in Lisbon - Time Out',
            'Flights to Lisbon - Google Flights',
            'Belém Tower - opening hours',
          ],
        ]);
    });

    test('step 4: the drag card, and the carry card over the dimmed list, are drawn over the dim', async ({
      context,
      extensionId,
    }) => {
      const page = await startTour(context, extensionId, view);
      for (const step of [2, 3, 4]) await nextTo(page, step);
      const from = await boxOf(page.locator(IN_ROWS).first());
      const [x, y] = [from.x + 60, from.y + from.height / 2];
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x, y + 10, { steps: 3 });
      await page.mouse.move(x, y + 40, { steps: 8 });
      const card = page.locator('[data-drag-card]');
      await expect(card).toBeVisible();
      await expect.poll(() => cardIsUndimmed(page, card)).toBe(true);
      // Out over the session list, outside the bright box: a carry.
      await page.mouse.move(180, 400, { steps: 25 });
      const carried = page.locator('[data-carry-card]');
      await expect(carried).toBeVisible();
      const box = await boxOf(carried);
      // CONTROL: the page beside the card is under the dim.
      expect(await hitAt(page, box.x - 10, box.y + box.height / 2)).toBe('dim');
      await expect.poll(() => cardIsUndimmed(page, carried)).toBe(true);
      await page.keyboard.press('Escape');
      await page.mouse.up();
      await expect(coachAt(page, 4)).toBeVisible();
    });

    test('step 5: of the open menu only Delete is bright; the rest is dimmed and takes no press', async ({
      context,
      extensionId,
    }) => {
      const page = await startTour(context, extensionId, view);
      for (const step of [2, 3, 4, 5]) await nextTo(page, step);
      const item = (name: string) =>
        page.getByRole('menuitem', { name, exact: true });
      await expect(item('Delete session')).toBeVisible();
      const pages = context.pages().length;
      const [ex, ey] = await centre(item('Export…'));
      expect(await hitAt(page, ex, ey)).toBe('dim');
      await page.mouse.click(ex, ey);
      // Not a press outside the menu either: it stays open.
      await expect(item('Delete session')).toBeVisible();
      const [dx, dy] = await centre(item('Delete session'));
      expect(await hitAt(page, dx, dy)).not.toBe('dim');
      // Barrier: Delete, inside the bright box, ends the tour.
      await page.mouse.click(dx, dy);
      await expect(coach(page)).toHaveCount(0);
      await expect(dim(page)).toHaveCount(0);
      expect(context.pages()).toHaveLength(pages);
    });

    test('a toast during the tour is drawn over the dim and takes the pointer', async ({
      context,
      extensionId,
    }) => {
      await context.grantPermissions(['clipboard-read', 'clipboard-write']);
      const page = await startTour(context, extensionId, view);
      await watchToasts(page);
      for (const step of [2, 3, 4, 5]) await nextTo(page, step);
      const copy = page.getByRole('menuitem', {
        name: 'Copy all links',
        exact: true,
      });
      await copy.focus();
      await copy.press('Enter');
      const toast = page.locator('[data-toast]').first();
      await expect(toast).toBeVisible();
      await expect(coachAt(page, 5)).toBeVisible();
      await expect(dim(page)).toHaveCount(1);
      const [x, y] = await centre(toast);
      const hit = await page.evaluate(
        ([x, y]) =>
          document.elementFromPoint(x, y)?.closest('[data-toast]') !== null,
        [x, y]
      );
      expect(hit).toBe(true);
      expect((await toastsSeen(page)).some((t) => t.includes('copied'))).toBe(
        true
      );
    });
  });
}
