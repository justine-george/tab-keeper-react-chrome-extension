import type { BrowserContext, Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { buildContainer, seedSessions, seedSettings } from './fixtures/seed';
import { FULL, FULL_VIEW_PATH, POPUP } from './fixtures/onboarding';
import { saveRowSaveAll } from './fixtures/sessionActions';

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
