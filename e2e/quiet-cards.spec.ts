import type { BrowserContext, Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import {
  buildContainer,
  seedSessions,
  seedSettingsIfAbsent,
} from './fixtures/seed';
import { openFullView, openPopup, storedSettings } from './fixtures/onboarding';
import { stubToolbarPin } from './fixtures/toolbarPin';
import { twoFrames } from './fixtures/tour';
import { CARD_DELAY_MS } from '../src/utils/constants/cardDelay';
import { EASE } from '../src/styles/scale';

// The real build on the real clock: Playwright's clock would also fake requestAnimationFrame.

test.use({ freshProfile: true });

const DAY = 24 * 60 * 60 * 1000;
const RATE_DUE = {
  extensionInstalledTime: Date.now() - 2 * DAY,
  lastValueMomentTime: Date.now() - 60 * 60 * 1000,
};
const CARDS =
  '[data-full-view-callout], dialog[open][aria-labelledby="rate-review-title"]';
const cardState = (page: Page, state: string) =>
  expect(page.locator('html')).toHaveAttribute('data-first-open-card', state);

// From document start: when the card was scheduled and when it was drawn, by performance.now().
async function watchCards(context: BrowserContext): Promise<void> {
  await context.addInitScript((cards) => {
    if (window !== window.top) return;
    const times: { waiting?: number; drawn?: number } = {};
    Object.defineProperty(globalThis, '__cardTimes', {
      value: times,
      configurable: true,
    });
    new MutationObserver(() => {
      const root = document.documentElement;
      if (
        times.waiting === undefined &&
        root?.dataset.firstOpenCard === 'waiting'
      ) {
        times.waiting = performance.now();
      }
      if (times.drawn === undefined && document.querySelector(cards) !== null) {
        times.drawn = performance.now();
      }
    }).observe(document, {
      subtree: true,
      childList: true,
      attributes: true,
    });
  }, CARDS);
}
const cardTimes = (page: Page) =>
  page.evaluate(() => {
    const times: unknown = Reflect.get(globalThis, '__cardTimes');
    return typeof times === 'object' && times !== null
      ? {
          waiting: Number(Reflect.get(times, 'waiting')),
          drawn: Number(Reflect.get(times, 'drawn')),
        }
      : { waiting: NaN, drawn: NaN };
  });
const fade = (page: Page) =>
  page.evaluate((cards) => {
    const el = document.querySelector(cards);
    if (el === null) return null;
    const style = getComputedStyle(el);
    return [
      style.animationName === 'none' ? 'none' : 'fade',
      style.animationDuration,
      style.animationTimingFunction,
    ];
  }, CARDS);

// seedSessions re-seeds the same list on each load, which a reopen here does not mind.
async function sessionHolder(context: BrowserContext): Promise<void> {
  await seedSessions(context, buildContainer());
  await seedSettingsIfAbsent(context, { isFullViewCalloutSeen: false });
}

test('popup, quiet: the callout draws no sooner than CARD_DELAY_MS after it is decided, and fades in', async ({
  context,
  extensionId,
}) => {
  await watchCards(context);
  await sessionHolder(context);
  const page = await openPopup(context, extensionId);
  await cardState(page, 'shown');
  const { waiting, drawn } = await cardTimes(page);
  expect(drawn - waiting).toBeGreaterThanOrEqual(CARD_DELAY_MS - 1);
  expect(await fade(page)).toEqual(['fade', '0.12s', EASE.OUT]);
});

test('popup: a key first, and the callout never draws, stays unseen, and comes on the next quiet open', async ({
  context,
  extensionId,
}) => {
  await watchCards(context);
  await sessionHolder(context);
  const page = await openPopup(context, extensionId);
  await cardState(page, 'waiting');
  await page.keyboard.press('Shift');
  await cardState(page, 'skipped');
  await twoFrames(page);
  expect(Number.isNaN((await cardTimes(page)).drawn)).toBe(true);
  expect((await storedSettings(page)).isFullViewCalloutSeen).toBe(false);
  await page.close();
  // CONTROL: the same observer, the next open, left quiet.
  const next = await openPopup(context, extensionId);
  await cardState(next, 'shown');
  expect(Number.isNaN((await cardTimes(next)).drawn)).toBe(false);
});

test('full view: a wheel first, and the rate prompt never draws; a reload left quiet shows it', async ({
  context,
  extensionId,
}) => {
  await watchCards(context);
  await stubToolbarPin(context, { pinned: true });
  await seedSettingsIfAbsent(context, RATE_DUE);
  const page = await openFullView(context, extensionId);
  await cardState(page, 'waiting');
  await page.mouse.wheel(0, 40);
  await cardState(page, 'skipped');
  await twoFrames(page);
  expect(Number.isNaN((await cardTimes(page)).drawn)).toBe(true);
  expect((await storedSettings(page)).lastReviewRequestTime ?? '').toBe('');
  await page.reload();
  await cardState(page, 'shown');
  await expect(
    page.getByRole('dialog', { name: 'Enjoying Tab Keeper?', exact: true })
  ).toBeVisible();
});

test('reduced motion: the card appears with no fade', async ({
  context,
  extensionId,
}) => {
  await sessionHolder(context);
  const page = await openPopup(context, extensionId);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await cardState(page, 'shown');
  expect((await fade(page))?.[0]).toBe('none');
});
