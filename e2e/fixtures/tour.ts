import type { BrowserContext, Page, Worker } from '@playwright/test';

import { expect } from './extension';
import {
  FULL,
  FULL_VIEW_PATH,
  POPUP,
  openPage,
  storedSettings,
} from './onboarding';
import { boxOf } from './savedWindows';
import { COACH } from '../../src/components/tour/coachMarkPlacement';
import { isValidTabMasterContainer } from '../../src/utils/functions/local';

// No seeding: a reopen must keep what the last page wrote, and an empty list shows Start here.

export const SAMPLE_TITLE = 'Sample: Weekend trip';
// The tooltip and name of an open that waits for the tour.
export const OPEN_BLOCKED = 'Open works after the tour';

export const TOUR_VIEWS = [
  { name: 'popup', path: 'index.html', viewport: POPUP, view: 'popup' },
  { name: 'full view', path: FULL_VIEW_PATH, viewport: FULL, view: 'full' },
] as const;
export type TourViewCase = (typeof TOUR_VIEWS)[number];

// The full view's sides as mocked, written out rather than read from TOUR_SIDES, so a wrong order there fails.
const FULL_VIEW_SIDE = {
  1: 'right',
  2: 'below',
  3: 'below',
  4: 'below',
  5: 'right',
} as const;

export const coach = (page: Page) =>
  page.locator('[data-coach-mark]:not([aria-hidden])');
export const coachAt = (page: Page, step: number) =>
  page.locator(
    `[data-coach-mark][data-coach-step="${step}"]:not([aria-hidden])`
  );
export const coachButton = (page: Page, name: string) =>
  coach(page).getByRole('button', { name, exact: true });
export const tourCheck = (page: Page, outcome: string) =>
  expect(page.locator('html')).toHaveAttribute('data-tour-check', outcome);

export async function startTour(
  context: BrowserContext,
  extensionId: string,
  view: TourViewCase
): Promise<Page> {
  const page = await openPage(context, extensionId, view.path, view.viewport);
  await page
    .getByRole('button', { name: 'Try it with an example', exact: true })
    .click();
  await expect(coachAt(page, 1)).toBeVisible();
  return page;
}

export async function nextTo(page: Page, step: number): Promise<void> {
  await coachButton(page, 'Next').click();
  await expect(coachAt(page, step)).toBeVisible();
}

export async function storedTour(page: Page): Promise<unknown> {
  return (await storedSettings(page)).sampleTour ?? null;
}

export async function storedTitles(page: Page): Promise<string[]> {
  const parsed: unknown = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('tabContainerData') ?? 'null')
  );
  return isValidTabMasterContainer(parsed)
    ? parsed.tabGroups.map((g) => g.title)
    : [];
}

// Notch aimed into the ringed anchor, none of it covered, inside the window, on the mocked side.
export async function expectAimedAndClear(
  page: Page,
  view: TourViewCase,
  step: 1 | 2 | 3 | 4 | 5
): Promise<void> {
  const side = view.view === 'popup' ? 'left' : FULL_VIEW_SIDE[step];
  await expect
    .poll(() =>
      page.evaluate(
        ({ inset, side }) => {
          const mark = document.querySelector(
            '[data-coach-mark]:not([aria-hidden])'
          );
          const notch = document.querySelector('[data-coach-notch]');
          const ring = document.querySelector('[data-coach-ring]');
          const pane = document.querySelector('[data-pane="sessions"]');
          if (!mark || !notch || !ring || !pane) return 'missing';
          const m = mark.getBoundingClientRect();
          const n = notch.getBoundingClientRect();
          const r = ring.getBoundingClientRect();
          const a = {
            left: r.left + inset,
            top: r.top + inset,
            right: r.right - inset,
            bottom: r.bottom - inset,
          };
          const cx = n.left + n.width / 2;
          const cy = n.top + n.height / 2;
          const aimed =
            side === 'below'
              ? cx >= a.left && cx <= a.right && n.top >= a.bottom - 1
              : side === 'left'
                ? cy >= a.top && cy <= a.bottom && n.right <= a.left + 1
                : cy >= a.top && cy <= a.bottom && n.left >= a.right - 1;
          // On the mark's edge that faces the anchor, not its far one.
          const onFacingEdge =
            side === 'below'
              ? Math.abs(n.bottom - m.top) <= 1
              : side === 'left'
                ? Math.abs(n.left - m.right) <= 1
                : Math.abs(n.right - m.left) <= 1;
          const covers =
            m.left < a.right &&
            m.right > a.left &&
            m.top < a.bottom &&
            m.bottom > a.top;
          const inside =
            m.left >= 0 &&
            m.top >= 0 &&
            m.right <= innerWidth &&
            m.bottom <= innerHeight;
          const onSide = mark.getAttribute('data-coach-side') === side;
          const inLeftPane =
            side !== 'left' || m.right <= pane.getBoundingClientRect().right;
          return aimed &&
            onFacingEdge &&
            !covers &&
            inside &&
            onSide &&
            inLeftPane
            ? 'ok'
            : JSON.stringify({ side, mark: m, notch: n, anchor: a });
        },
        { inset: COACH.RING_INSET, side }
      )
    )
    .toBe('ok');
}

// Every coach mark drawn in a page, from document start; top frame only (the preview iframe re-runs init scripts).
export async function watchCoachMarks(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    if (window !== window.top) return;
    const seen: string[] = [];
    Object.defineProperty(globalThis, '__coachSeen', {
      value: seen,
      configurable: true,
    });
    new MutationObserver(() => {
      for (const mark of document.querySelectorAll(
        '[data-coach-mark]:not([aria-hidden])'
      )) {
        const step = mark.getAttribute('data-coach-step') ?? '';
        if (!seen.includes(step)) seen.push(step);
      }
    }).observe(document, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['aria-hidden', 'data-coach-step'],
    });
  });
}
export const coachSeen = (page: Page) =>
  page.evaluate(() => {
    const seen: unknown = Reflect.get(globalThis, '__coachSeen');
    return Array.isArray(seen) ? seen.map(String) : [];
  });

// Records every toast drawn from now on.
export async function watchToasts(page: Page): Promise<void> {
  await page.evaluate(() => {
    const seen: string[] = [];
    Object.defineProperty(globalThis, '__toastsSeen', {
      value: seen,
      configurable: true,
    });
    new MutationObserver(() => {
      for (const toast of document.querySelectorAll('[data-toast]')) {
        const text = toast.textContent ?? '';
        if (!seen.includes(text)) seen.push(text);
      }
    }).observe(document, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  });
}
export const toastsSeen = (page: Page) =>
  page.evaluate(() => {
    const seen: unknown = Reflect.get(globalThis, '__toastsSeen');
    return Array.isArray(seen) ? seen.map(String) : [];
  });
// A toast dispatched with a delete, or a mark after a barrier, is drawn within two frames.
export const twoFrames = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<void>((done) =>
        requestAnimationFrame(() => requestAnimationFrame(() => done()))
      )
  );

export async function dragFirstTabDown(page: Page): Promise<void> {
  const row = page
    .locator(
      '[data-pane="detail"] [data-tour-anchor="windows"] [data-window-tabs] [data-drag-row-id]'
    )
    .first();
  const box = await boxOf(row);
  const x = box.x + 60;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + 10, { steps: 3 });
  await page.mouse.move(x, y + box.height * 1.6, { steps: 12 });
  await page.mouse.up();
}

// Chrome's tab count, read in the worker.
export const tabCount = (worker: Worker) =>
  worker.evaluate(async () => (await chrome.tabs.query({})).length);

// The tab count every 100ms for `ms`: the observer for "no tab opened", as window-rows.spec samples it.
export const tabCountsOver = (worker: Worker, ms: number) =>
  worker.evaluate(async (ms) => {
    const seen: number[] = [];
    const end = Date.now() + ms;
    while (Date.now() < end) {
      seen.push((await chrome.tabs.query({})).length);
      await new Promise((done) => setTimeout(done, 100));
    }
    return seen;
  }, ms);
