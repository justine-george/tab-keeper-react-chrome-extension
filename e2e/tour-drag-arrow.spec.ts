import type { Locator, Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { boxOf, pickUp } from './fixtures/sessionDrag';
import {
  carryTo,
  liveRow,
  openLiveWindow,
  topOf,
} from './fixtures/liveWindows';
import {
  FULL_RUN,
  card,
  cardAt,
  cardButton,
  landedAt,
  nextTo,
  openRunFromHelp,
} from './fixtures/run';

// KAN-1030 (round 1 picks B, M2, H1). The drag step draws one curved arrow,
// for the way still to try: left to right from the session's first tab to the
// gap after a live window's first tab, then right to left from that window's
// last tab to the session's last tab. It draws on once (500 ms), hides while a
// drag is held, and draws on again after the drop. Reduced motion: still.

const arrows = (page: Page) => page.locator('[data-drag-arrow-way]');
const arrow = (page: Page, way: string) =>
  page.locator(`[data-drag-arrow-way="${way}"]`);
const ticked = (page: Page) =>
  card(page).locator('[data-coach-tick][data-done]');
const savedTabs = (page: Page) =>
  page.locator('[data-pane="detail"] [data-saved-tab-row]');

// The arrow's two ends, from its line's path data.
async function endsOf(
  line: Locator
): Promise<{ from: [number, number]; to: [number, number] }> {
  const d = (await line.getAttribute('d')) ?? '';
  const n = (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
  return { from: [n[0], n[1]], to: [n[n.length - 2], n[n.length - 1]] };
}

// The right edge of a row's title text, as drawn.
const titleRight = (row: Locator) =>
  row.evaluate((r) => {
    const span = r.querySelector('button > div:last-child span');
    return span === null ? NaN : span.getBoundingClientRect().right;
  });

const opacityOf = (g: Locator) =>
  g.evaluate((el) => Number(getComputedStyle(el).opacity));

async function toDragStep(page: Page): Promise<void> {
  await nextTo(page, 2);
  await nextTo(page, 3);
  await cardButton(page, 'Use an example').click();
  await expect(cardAt(page, 4)).toBeVisible();
  for (const step of [5, 6, 7, 8, 9]) await nextTo(page, step);
  await landedAt(page, 9);
}

test("step 9: one arrow, left to right, from the first saved tab to the gap after a live window's first tab; it draws on in 500 ms", async ({
  context,
  extensionId,
  serviceWorker: worker,
}) => {
  const live = await openLiveWindow(worker, ['Live A', 'Live B']);
  const page = await openRunFromHelp(context, extensionId, FULL_RUN);
  await toDragStep(page);
  await expect(arrows(page)).toHaveCount(1);
  const g = arrow(page, 'opened');
  await expect(g).toHaveAttribute('data-drag-arrow-state', 'drawn');
  const line = g.locator('[data-drag-arrow-line]');
  // M2: one draw-on of 500 ms, not a loop.
  const timing = await line.evaluate((el) =>
    el.getAnimations().map((a) => {
      const t = a.effect?.getComputedTiming();
      return { duration: t?.duration, iterations: t?.iterations };
    })
  );
  expect(timing).toEqual([{ duration: 500, iterations: 1 }]);

  const { from, to } = await endsOf(line);
  const first = await boxOf(savedTabs(page).first());
  expect(from[0]).toBeCloseTo(
    (await titleRight(savedTabs(page).first())) + 14,
    0
  );
  expect(from[1]).toBeCloseTo(first.y + first.height / 2, 0);
  // The live window opened for this test, not This window: its first tab's bottom.
  const a = await boxOf(liveRow(page, live.idOf('Live A')));
  expect(to[0]).toBeCloseTo(a.x - 13, 0);
  expect(to[1]).toBeCloseTo(a.y + a.height, 0);
  // Hidden from screen readers, and never in a press's way.
  const layer = page.locator('[data-drag-arrow]');
  await expect(layer).toHaveAttribute('aria-hidden', 'true');
  expect(await layer.evaluate((el) => getComputedStyle(el).pointerEvents)).toBe(
    'none'
  );
});

test("step 9: a held drag hides the arrow; the drop that ticks draws the other way on, from the window's last tab to the session's last tab; both ticked, none", async ({
  context,
  extensionId,
  serviceWorker: worker,
}) => {
  const live = await openLiveWindow(worker, ['Live A', 'Live B']);
  const page = await openRunFromHelp(context, extensionId, FULL_RUN);
  await toDragStep(page);
  await expect(arrow(page, 'opened')).toHaveAttribute(
    'data-drag-arrow-state',
    'drawn'
  );

  // H1: picked up, it fades out (120 ms) and stays out while held.
  await pickUp(page, savedTabs(page).first());
  await carryTo(page, await topOf(liveRow(page, live.idOf('Live B'))));
  await expect(arrow(page, 'opened')).toHaveAttribute(
    'data-drag-arrow-state',
    'hidden'
  );
  await expect.poll(() => opacityOf(arrow(page, 'opened'))).toBe(0);
  await page.mouse.up();
  await expect(ticked(page)).toHaveCount(1);

  // Back after the drop, as the way still to try.
  const back = arrow(page, 'saved');
  await expect(back).toHaveAttribute('data-drag-arrow-state', 'drawn');
  await expect(arrows(page)).toHaveCount(1);
  await expect.poll(() => opacityOf(back)).toBe(1);
  const { from, to } = await endsOf(back.locator('[data-drag-arrow-line]'));
  const rows = page.locator(
    `[data-open-window-id="${live.windowId}"] [data-open-tab-id]`
  );
  await expect(rows).toHaveCount(3);
  const last = await boxOf(rows.last());
  expect(from[0]).toBeCloseTo(last.x - 13, 0);
  expect(from[1]).toBeCloseTo(last.y + last.height / 2, 0);
  const end = await boxOf(savedTabs(page).last());
  expect(to[0]).toBeCloseTo((await titleRight(savedTabs(page).last())) + 14, 0);
  expect(to[1]).toBeCloseTo(end.y + end.height / 2, 0);

  // Right to left: Live A into the session. Both ticked: no arrow.
  const a = await boxOf(liveRow(page, live.idOf('Live A')));
  await page.mouse.move(a.x + Math.min(60, a.width / 2), a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    a.x + Math.min(60, a.width / 2),
    a.y + a.height / 2 + 10,
    { steps: 3 }
  );
  const pane = await boxOf(page.locator('[data-pane="open-now"]'));
  await page.mouse.move(pane.x - 40, a.y + a.height / 2 + 10, { steps: 6 });
  await expect(arrow(page, 'saved')).toHaveAttribute(
    'data-drag-arrow-state',
    'hidden'
  );
  const target = await boxOf(savedTabs(page).first());
  await page.mouse.move(target.x + 60, target.y + target.height * 0.25, {
    steps: 8,
  });
  await page.mouse.up();
  await expect(ticked(page)).toHaveCount(2);
  await expect(arrows(page)).toHaveCount(0);
});

test('step 9: a drop that ticks nothing draws the same way on again', async ({
  context,
  extensionId,
  serviceWorker: worker,
}) => {
  await openLiveWindow(worker, ['Live A']);
  const page = await openRunFromHelp(context, extensionId, FULL_RUN);
  await toDragStep(page);
  const tab = savedTabs(page).first();
  const at = await pickUp(page, tab);
  await expect(arrow(page, 'opened')).toHaveAttribute(
    'data-drag-arrow-state',
    'hidden'
  );
  // Let go where it was picked up: nothing moves, nothing ticks.
  await page.mouse.move(at.x, at.y - 8, { steps: 2 });
  await page.mouse.up();
  await expect(arrow(page, 'opened')).toHaveAttribute(
    'data-drag-arrow-state',
    'drawn'
  );
  await expect.poll(() => opacityOf(arrow(page, 'opened'))).toBe(1);
  await expect(ticked(page)).toHaveCount(0);
  const timing = await arrow(page, 'opened')
    .locator('[data-drag-arrow-line]')
    .evaluate((el) =>
      el.getAnimations().map((a) => a.effect?.getComputedTiming().duration)
    );
  expect(timing).toEqual([500]);
});

test('step 9 with reduced motion: the arrow is drawn still', async ({
  context,
  extensionId,
  serviceWorker: worker,
}) => {
  await openLiveWindow(worker, ['Live A']);
  const page = await openRunFromHelp(context, extensionId, FULL_RUN);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await toDragStep(page);
  const g = arrow(page, 'opened');
  await expect(g).toHaveAttribute('data-drag-arrow-state', 'drawn');
  expect(
    await g.evaluate(
      (el) =>
        [el, ...el.querySelectorAll('*')].flatMap((x) => x.getAnimations())
          .length
    )
  ).toBe(0);
  expect(await opacityOf(g)).toBe(1);
});

test('step 9 with no other window: the arrow ends in This window', async ({
  context,
  extensionId,
}) => {
  const page = await openRunFromHelp(context, extensionId, FULL_RUN);
  await toDragStep(page);
  const rows = page.locator('[data-this-window] [data-open-tab-id]');
  await expect(rows.first()).toBeVisible();
  const { to } = await endsOf(
    arrow(page, 'opened').locator('[data-drag-arrow-line]')
  );
  const first = await boxOf(rows.first());
  expect(to[0]).toBeCloseTo(first.x - 13, 0);
  expect(to[1]).toBeCloseTo(first.y + first.height, 0);
});

test('other steps draw no arrow', async ({ context, extensionId }) => {
  const page = await openRunFromHelp(context, extensionId, FULL_RUN);
  await toDragStep(page);
  await expect(arrows(page)).toHaveCount(1);
  await cardButton(page, 'Back').click();
  await expect(cardAt(page, 8)).toBeVisible();
  await expect(page.locator('[data-drag-arrow]')).toHaveCount(0);
});
