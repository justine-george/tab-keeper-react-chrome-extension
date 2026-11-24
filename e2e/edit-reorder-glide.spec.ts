import type { Page } from '@playwright/test';

import { grantedTest as test, expect } from './fixtures/grantedExtension';
import { openSaved, savedWindow, session } from './fixtures/savedWindows';
import { documentLanded } from './fixtures/landed';
import {
  between,
  samples,
  startSampling,
  topOf,
} from './fixtures/glideSamples';

// KAN-994 (his picks, round 2: 1-B, 2-B). An edit moves its session to the
// top of the list (KAN-141): the rows glide there, and a list scrolled down
// scrolls to its top with the row, which stays in view. An undo glides it
// back (his round-1b rule). From the keyboard and under Reduce motion it is
// instant.

// Created a day apart, newest first: stored in the order the list sorts them.
const DAY = 86_400_000;
const SESSIONS = Array.from({ length: 12 }, (_, i) => ({
  ...session(`S${i + 1}`, `Session ${i + 1}`, [
    savedWindow(`S${i + 1}-w`, 'Window', 2),
  ]),
  createdAt: Date.UTC(2026, 10, 1) - i * DAY,
}));
const row = (id: string) => `[data-pane="sessions"] [data-drag-row-id="${id}"]`;
// The added tab in the shown session's first window: its only "tab:" row not seeded.
const NEW_TAB =
  '[data-pane="detail"] [data-drag-row-id^="tab:"]:not([data-drag-row-id^="tab:S"])';
const NEW_TAB_INSIDE = `${NEW_TAB} > [data-drag-row-id]`;
const travelled = (tops: number[], from: number, to: number) =>
  between(tops, from, to).length >= 3;

async function popup(
  context: Parameters<typeof openSaved>[0],
  extensionId: string,
  selected: string
): Promise<Page> {
  const page = await openSaved(context, extensionId, 'popup', {
    sessions: SESSIONS,
    selected,
    overOrdinaryTab: true,
  });
  await documentLanded(page);
  return page;
}

// The sessions list's scroll area.
const listScroll = (page: Page, top?: number) =>
  page.evaluate((to) => {
    let sc = document.querySelector('[data-pane="sessions"] [data-drag-row-id]')
      ?.parentElement as HTMLElement | null;
    while (sc && !/(auto|scroll)/.test(getComputedStyle(sc).overflowY))
      sc = sc.parentElement;
    if (!sc) throw new Error('no sessions list');
    if (to !== undefined) sc.scrollTop = to;
    const b = sc.getBoundingClientRect();
    return {
      scrollTop: sc.scrollTop,
      top: b.top + sc.clientTop,
      height: sc.clientHeight,
    };
  }, top);

const addTab = (page: Page) =>
  page
    .locator('[data-pane="detail"] [data-window-drag-handle]')
    .first()
    .getByRole('button', { name: 'Add current tab', exact: true });
const undo = (page: Page) => page.locator('[role="button"][aria-label="Undo"]');
const redo = (page: Page) => page.locator('[role="button"][aria-label="Redo"]');

// The edited row's glide time, read the frame after the press.
const glideMs = (page: Page, id: string) =>
  page.evaluate(
    (sel) =>
      new Promise<number>((done) =>
        requestAnimationFrame(() => {
          const a = document.querySelector(sel)?.getAnimations()[0];
          done(Number(a?.effect?.getTiming().duration ?? 0));
        })
      ),
    row(id)
  );

test.describe('an edit moves its session up', () => {
  test('with the list at its top, the row glides up and the rows it passes glide down', async ({
    context,
    extensionId,
  }) => {
    const page = await popup(context, extensionId, 'S3');
    const s3 = await topOf(page.locator(row('S3')));
    const s1 = await topOf(page.locator(row('S1')));

    await startSampling(page, {
      edited: row('S3'),
      first: row('S1'),
      newTab: NEW_TAB_INSIDE,
    });
    await addTab(page).click();
    const ms = await glideMs(page, 'S3');
    const s = await samples(page);

    expect(ms).toBe(200);

    expect(await topOf(page.locator(row('S3')))).toBeCloseTo(s1, 0);
    const s1After = await topOf(page.locator(row('S1')));
    expect(s1After - s1).toBeGreaterThan(40);
    expect(travelled(s.edited, s3, s1)).toBe(true);
    expect(travelled(s.first, s1, s1After)).toBe(true);
    // The add's own glide in the right-hand pane still runs beside it (KAN-993).
    const place = await topOf(page.locator(NEW_TAB));
    expect(between(s.newTab, place - 32, place).length).toBeGreaterThanOrEqual(
      3
    );
  });

  test('with the list scrolled down, it scrolls to its top with the row, which stays in view', async ({
    context,
    extensionId,
  }) => {
    const page = await popup(context, extensionId, 'S9');
    const view = await listScroll(page, 420);
    expect(view.scrollTop).toBeGreaterThan(300);
    await page.locator(row('S9')).scrollIntoViewIfNeeded();
    const start = await listScroll(page);
    const from = await topOf(page.locator(row('S9')));
    expect(from).toBeGreaterThanOrEqual(start.top);

    await startSampling(page, { edited: row('S9'), first: row('S1') });
    await addTab(page).click();
    const ms = await glideMs(page, 'S9');
    const s = await samples(page);

    // A long move takes FOLD's time.
    expect(ms).toBe(280);
    const end = await listScroll(page);

    expect(end.scrollTop).toBe(0);
    const to = await topOf(page.locator(row('S9')));
    expect(to).toBeCloseTo(end.top, 0);
    expect(travelled(s.edited, from, to)).toBe(true);
    // In view on every frame: never above the list's top or below its bottom.
    const tops = s.edited.filter((v) => !Number.isNaN(v));
    expect(Math.min(...tops)).toBeGreaterThanOrEqual(end.top - 1);
    expect(Math.max(...tops)).toBeLessThan(end.top + end.height);
    // The rows above came down into view with it.
    expect(
      between(s.first, end.top - 300, await topOf(page.locator(row('S1'))))
        .length
    ).toBeGreaterThanOrEqual(3);
  });

  test('Undo glides it back to its place; Redo glides it up again', async ({
    context,
    extensionId,
  }) => {
    const page = await popup(context, extensionId, 'S3');
    const home = await topOf(page.locator(row('S3')));
    await addTab(page).click();
    await page.waitForTimeout(500);
    const up = await topOf(page.locator(row('S3')));
    expect(home - up).toBeGreaterThan(40);
    await page.mouse.move(0, 0);

    await startSampling(page, { edited: row('S3') });
    await undo(page).click();
    const u = await samples(page);
    // The added tab went back up in the right-hand pane at the same time (KAN-993).
    expect(Math.max(...u.copies)).toBeGreaterThan(0);
    expect(await topOf(page.locator(row('S3')))).toBeCloseTo(home, 0);
    expect(travelled(u.edited, up, home)).toBe(true);

    await startSampling(page, { edited: row('S3') });
    await redo(page).click();
    const r = await samples(page);
    expect(await topOf(page.locator(row('S3')))).toBeCloseTo(up, 0);
    expect(travelled(r.edited, home, up)).toBe(true);
  });

  test('from the keyboard it is instant', async ({ context, extensionId }) => {
    const page = await popup(context, extensionId, 'S3');
    const s3 = await topOf(page.locator(row('S3')));
    await addTab(page).focus();

    await startSampling(page, { edited: row('S3') });
    await page.keyboard.press('Enter');
    const s = await samples(page);
    const to = await topOf(page.locator(row('S3')));

    expect(s3 - to).toBeGreaterThan(40);
    expect(between(s.edited, s3, to)).toEqual([]);
  });

  test('with Reduce motion it is instant', async ({ context, extensionId }) => {
    const page = await popup(context, extensionId, 'S3');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const s3 = await topOf(page.locator(row('S3')));

    await startSampling(page, { edited: row('S3') });
    await addTab(page).click();
    const s = await samples(page);
    const to = await topOf(page.locator(row('S3')));

    expect(s3 - to).toBeGreaterThan(40);
    expect(between(s.edited, s3, to)).toEqual([]);
  });

  test('a rename moves it the same way', async ({ context, extensionId }) => {
    const page = await popup(context, extensionId, 'S3');
    const s3 = await topOf(page.locator(row('S3')));
    await page
      .getByRole('button', { name: 'Rename session: Session 3', exact: true })
      .click();
    await page.keyboard.type(' renamed');

    await startSampling(page, { edited: row('S3') });
    // Committed by a click elsewhere, not by Enter.
    await page.locator('[data-pane="detail"] [data-panel="windows"]').click({
      position: { x: 300, y: 300 },
    });
    const s = await samples(page);
    const to = await topOf(page.locator(row('S3')));

    expect(s3 - to).toBeGreaterThan(40);
    expect(travelled(s.edited, s3, to)).toBe(true);
  });
});
