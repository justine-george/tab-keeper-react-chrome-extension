import type { BrowserContext, Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { buildContainer, seedSessions, seedSettings } from './fixtures/seed';
import { FULL, FULL_VIEW_PATH, POPUP } from './fixtures/onboarding';
import { saveRowSaveAll } from './fixtures/sessionActions';
import {
  FULL_RUN,
  POPUP_RUN,
  cardAt,
  nextTo,
  openRunFromHelp,
} from './fixtures/run';
import { openLiveWindow } from './fixtures/liveWindows';

// KAN-875 on the real build: after the tour, the first save pops floppy disks, then the first-save card.

const POP = '[data-first-save-pop]';
const PIECE = '[data-pop-piece]';
const FIRST_CARD = 'Your first session is saved';
// The seeded profile is past the tour (ONBOARDING_ANSWERED) and the card may ask.
const ASKABLE = { isNeverAskAgainToRate: false, isAutoSync: false };
const COMPOSITED = ['offset', 'computedOffset', 'easing', 'composite'];

const VIEWS = [
  { name: 'popup', path: 'index.html', viewport: POPUP },
  { name: 'full view', path: FULL_VIEW_PATH, viewport: FULL },
] as const;

// From document start, when the pop came and went and when the card came, on the page's own clock.
async function watchSequence(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    if (window !== window.top) return;
    const times: { popIn?: number; popOut?: number; card?: number } = {};
    Object.defineProperty(globalThis, '__sequence', { value: times });
    new MutationObserver(() => {
      const now = performance.now();
      const isPop = document.querySelector('[data-first-save-pop]') !== null;
      if (isPop && times.popIn === undefined) times.popIn = now;
      if (!isPop && times.popIn !== undefined && times.popOut === undefined)
        times.popOut = now;
      if (
        times.card === undefined &&
        document.querySelector('[data-testid="review-card"]') !== null
      )
        times.card = now;
    }).observe(document, { subtree: true, childList: true });
  });
}

const sequence = (page: Page) =>
  page.evaluate(() => {
    const t: unknown = Reflect.get(globalThis, '__sequence');
    if (typeof t !== 'object' || t === null) return null;
    const read = (k: string) => {
      const v: unknown = Reflect.get(t, k);
      return typeof v === 'number' ? v : null;
    };
    return { popIn: read('popIn'), popOut: read('popOut'), card: read('card') };
  });

async function openEmpty(
  context: BrowserContext,
  extensionId: string,
  view: (typeof VIEWS)[number],
  settings: Record<string, unknown> = {},
  reducedMotion: 'reduce' | 'no-preference' = 'no-preference'
): Promise<Page> {
  await seedSessions(context, buildContainer([]));
  await seedSettings(context, { ...ASKABLE, ...settings });
  const page = await context.newPage();
  await page.emulateMedia({ reducedMotion });
  await page.setViewportSize(view.viewport);
  await page.goto(`chrome-extension://${extensionId}/${view.path}`);
  await page.locator('[data-empty-list="saved"]').waitFor();
  return page;
}

const card = (page: Page) =>
  page.getByRole('complementary', { name: FIRST_CARD, exact: true });

// Never shows within the time a pop would take, with room to spare.
async function expectNoPop(page: Page): Promise<void> {
  const seen = await page.evaluate(
    (selector) =>
      new Promise<boolean>((resolve) => {
        const observer = new MutationObserver(() => {
          if (document.querySelector(selector)) {
            observer.disconnect();
            resolve(true);
          }
        });
        observer.observe(document, { subtree: true, childList: true });
        setTimeout(() => {
          observer.disconnect();
          resolve(document.querySelector(selector) !== null);
        }, 1500);
      }),
    POP
  );
  expect(seen).toBe(false);
}

for (const view of VIEWS) {
  test.describe(view.name, () => {
    test('the first save pops, then the first-save card', async ({
      context,
      extensionId,
    }) => {
      await watchSequence(context);
      const page = await openEmpty(context, extensionId, view);
      await saveRowSaveAll(page).click();

      await expect(page.locator(PIECE)).toHaveCount(24);
      await expect(page.locator(PIECE).first()).toBeVisible();
      await expect(page.locator(POP)).toHaveCount(0, { timeout: 1500 });
      await expect(card(page)).toBeVisible();

      const t = await sequence(page);
      expect(t?.popIn).not.toBeNull();
      expect(t?.popOut).not.toBeNull();
      expect(t?.card).not.toBeNull();
      if (!t?.popIn || !t.popOut || !t.card) return;
      // The 0.9 s pop, then the card's 300 ms settle.
      expect(t.popOut - t.popIn).toBeGreaterThan(800);
      expect(t.card).toBeGreaterThan(t.popOut);
    });

    test('the pop moves only transform and opacity', async ({
      context,
      extensionId,
    }) => {
      const page = await openEmpty(context, extensionId, view);
      await saveRowSaveAll(page).click();
      await expect(page.locator(PIECE)).toHaveCount(24);
      const properties = await page.evaluate((selector) => {
        const pop = document.querySelector(selector);
        return [
          ...new Set(
            document
              .getAnimations()
              .map((a) => a.effect)
              .filter(
                (e): e is KeyframeEffect =>
                  e instanceof KeyframeEffect &&
                  e.target !== null &&
                  pop !== null &&
                  pop.contains(e.target)
              )
              .flatMap((e) => e.getKeyframes().flatMap((k) => Object.keys(k)))
          ),
        ];
      }, POP);
      expect(properties.filter((p) => !COMPOSITED.includes(p)).sort()).toEqual([
        'opacity',
        'transform',
      ]);
    });

    test('a second save does not pop', async ({ context, extensionId }) => {
      const page = await openEmpty(context, extensionId, view);
      await saveRowSaveAll(page).click();
      await expect(page.locator(PIECE)).toHaveCount(24);
      await expect(page.locator(POP)).toHaveCount(0, { timeout: 1500 });
      const second = expectNoPop(page);
      await saveRowSaveAll(page).click();
      await second;
    });

    test('after a reload, a save does not pop', async ({
      context,
      extensionId,
    }) => {
      const page = await openEmpty(context, extensionId, view);
      await saveRowSaveAll(page).click();
      await expect(page.locator(PIECE)).toHaveCount(24);
      await expect(page.locator(POP)).toHaveCount(0, { timeout: 1500 });
      await page.reload();
      await saveRowSaveAll(page).waitFor();
      const again = expectNoPop(page);
      await saveRowSaveAll(page).click();
      await again;
    });

    test('everything deleted since, a save does not pop', async ({
      context,
      extensionId,
    }) => {
      const page = await openEmpty(context, extensionId, view, {
        hasHadSavedSession: true,
      });
      const after = expectNoPop(page);
      await saveRowSaveAll(page).click();
      await after;
    });

    test('the card declined for good: the pop only', async ({
      context,
      extensionId,
    }) => {
      const page = await openEmpty(context, extensionId, view, {
        isNeverAskAgainToRate: true,
      });
      await saveRowSaveAll(page).click();
      await expect(page.locator(PIECE)).toHaveCount(24);
      await expect(page.locator(POP)).toHaveCount(0, { timeout: 1500 });
      await page.waitForTimeout(2000);
      await expect(page.getByTestId('review-card')).toHaveCount(0);
    });

    test('reduced motion: no pop, the card at once', async ({
      context,
      extensionId,
    }) => {
      const page = await openEmpty(context, extensionId, view, {}, 'reduce');
      const none = expectNoPop(page);
      await saveRowSaveAll(page).click();
      await expect(card(page)).toBeVisible({ timeout: 1000 });
      await none;
    });
  });
}

// KAN-875, his pick (option 4): the tour's save step is a real save. Its pop plays over the tour's
// dim, and the tour waits for it before the next card.
const RUN_SAVE = [
  { run: POPUP_RUN, saveStep: 1, before: [] as number[] },
  { run: FULL_RUN, saveStep: 3, before: [2, 3] },
] as const;

// From now on, when the pop went and when the card after the save step came, on the page's clock.
async function watchTourSave(page: Page, nextStep: number): Promise<void> {
  await page.evaluate((step) => {
    const times: { popIn?: number; popOut?: number; next?: number } = {};
    Object.defineProperty(globalThis, '__tourSave', { value: times });
    new MutationObserver(() => {
      const now = performance.now();
      const isPop = document.querySelector('[data-first-save-pop]') !== null;
      if (isPop && times.popIn === undefined) times.popIn = now;
      if (!isPop && times.popIn !== undefined && times.popOut === undefined)
        times.popOut = now;
      if (
        times.next === undefined &&
        document.querySelector(
          `[data-coach-mark][data-coach-step="${step}"]:not([aria-hidden])`
        ) !== null
      )
        times.next = now;
    }).observe(document, { subtree: true, childList: true, attributes: true });
  }, nextStep);
}

const tourSave = (page: Page) =>
  page.evaluate(() => {
    const t: unknown = Reflect.get(globalThis, '__tourSave');
    if (typeof t !== 'object' || t === null) return null;
    const read = (k: string) => {
      const v: unknown = Reflect.get(t, k);
      return typeof v === 'number' ? v : null;
    };
    return { popIn: read('popIn'), popOut: read('popOut'), next: read('next') };
  });

// How many pieces something else is drawn over, at each piece's centre.
const coveredPieces = (page: Page) =>
  page.evaluate((selector) => {
    const pieces = [...document.querySelectorAll<HTMLElement>(selector)];
    // Hit-testing skips pointer-events: none, so let the pieces be hit while this reads.
    for (const p of pieces) p.style.pointerEvents = 'auto';
    const covered = pieces.filter((p) => {
      const box = p.getBoundingClientRect();
      const at = document.elementFromPoint(
        box.left + box.width / 2,
        box.top + box.height / 2
      );
      return at !== null && !p.contains(at);
    }).length;
    for (const p of pieces) p.style.pointerEvents = '';
    return covered;
  }, PIECE);

for (const { run, saveStep, before } of RUN_SAVE) {
  test.describe(`${run.name}, the tour's save step`, () => {
    test('the pop plays over the dim and the next card waits for it', async ({
      context,
      extensionId,
      serviceWorker,
    }) => {
      await openLiveWindow(serviceWorker, ['Trip notes', 'Flights', 'Hotel']);
      await seedSessions(context, buildContainer([]));
      await seedSettings(context, ASKABLE);
      const page = await openRunFromHelp(context, extensionId, run);
      for (const step of before) await nextTo(page, step);
      await expect(cardAt(page, saveStep)).toBeVisible();
      await watchTourSave(page, saveStep + 1);

      await saveRowSaveAll(page).click();
      await expect(page.locator(PIECE)).toHaveCount(24);
      await page.waitForTimeout(250);
      expect(await coveredPieces(page)).toBe(0);
      await expect(cardAt(page, saveStep)).toBeVisible();

      await expect(cardAt(page, saveStep + 1)).toBeVisible();
      const t = await tourSave(page);
      expect(t?.popOut).not.toBeNull();
      expect(t?.next).not.toBeNull();
      if (!t?.popOut || !t.next) return;
      expect(t.next).toBeGreaterThanOrEqual(t.popOut);
    });

    test('reduced motion: no pop, and the next card comes at once', async ({
      context,
      extensionId,
      serviceWorker,
    }) => {
      await openLiveWindow(serviceWorker, ['Trip notes', 'Flights', 'Hotel']);
      await seedSessions(context, buildContainer([]));
      await seedSettings(context, ASKABLE);
      const page = await openRunFromHelp(context, extensionId, run);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      for (const step of before) await nextTo(page, step);
      await expect(cardAt(page, saveStep)).toBeVisible();
      const none = expectNoPop(page);
      await saveRowSaveAll(page).click();
      await expect(cardAt(page, saveStep + 1)).toBeVisible({ timeout: 500 });
      await none;
    });
  });
}
