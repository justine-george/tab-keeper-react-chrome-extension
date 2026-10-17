import type { BrowserContext, Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import {
  buildContainer,
  seedSessions,
  seedSettingsIfAbsent,
} from './fixtures/seed';
import { openPopup } from './fixtures/onboarding';
import { EASE } from '../src/styles/scale';

// The full-view callout arrives as soon as the open's queue picks it
// (KAN-653). It used to wait 1.5s for a quiet moment and stand down on a key,
// a click or a wheel inside it; neither it nor the review card blocks the
// page, so nothing waits now. The real build on the real clock: Playwright's
// clock would also fake requestAnimationFrame.

test.use({ freshProfile: true });

const CALLOUT = '[data-full-view-callout]';
const callout = (page: Page) => page.locator(CALLOUT);

// From document start: when the queue said it was done, and when the callout
// was drawn, by performance.now().
async function watchArrival(context: BrowserContext): Promise<void> {
  await context.addInitScript((selector) => {
    if (window !== window.top) return;
    const times: { decided?: number; drawn?: number } = {};
    Object.defineProperty(globalThis, '__calloutTimes', { value: times });
    new MutationObserver(() => {
      // KAN-658. One read per batch: two reads can differ by a clock tick, so a draw in the decision's batch read as later.
      const now = performance.now();
      if (
        times.decided === undefined &&
        document.documentElement?.dataset.firstOpen !== undefined
      ) {
        times.decided = now;
      }
      if (times.drawn === undefined && document.querySelector(selector)) {
        times.drawn = now;
      }
    }).observe(document, { subtree: true, childList: true, attributes: true });
  }, CALLOUT);
}
const arrival = (page: Page) =>
  page.evaluate(() => {
    const times: unknown = Reflect.get(globalThis, '__calloutTimes');
    return typeof times === 'object' && times !== null
      ? {
          decided: Number(Reflect.get(times, 'decided')),
          drawn: Number(Reflect.get(times, 'drawn')),
        }
      : { decided: NaN, drawn: NaN };
  });
const fade = (page: Page) =>
  page.evaluate((selector) => {
    const el = document.querySelector(selector);
    if (el === null) return null;
    const style = getComputedStyle(el);
    return [
      style.animationName === 'none' ? 'none' : 'fade',
      style.animationDuration,
      style.animationTimingFunction,
    ];
  }, CALLOUT);

async function sessionHolder(context: BrowserContext): Promise<void> {
  await seedSessions(context, buildContainer());
  await seedSettingsIfAbsent(context, { isFullViewCalloutSeen: false });
}

test('popup: the callout is drawn as the queue decides it, and fades in', async ({
  context,
  extensionId,
}) => {
  await watchArrival(context);
  await sessionHolder(context);
  const page = await openPopup(context, extensionId);
  await expect(callout(page)).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute(
    'data-first-open',
    'fullViewCallout'
  );
  const { decided, drawn } = await arrival(page);
  // Opened inside the queue, before it reports: no wait between the two.
  expect(drawn).toBeLessThanOrEqual(decided);
  expect(await fade(page)).toEqual(['fade', '0.12s', EASE.OUT]);
});

test('popup: a key pressed as it opens does not stop the callout', async ({
  context,
  extensionId,
}) => {
  await sessionHolder(context);
  // Someone typing from the moment the popup opens: a key every 100ms for
  // the first two seconds, across the whole of the old 1.5s wait.
  await context.addInitScript(() => {
    if (window !== window.top) return;
    const typing = setInterval(
      () =>
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift' })),
      100
    );
    setTimeout(() => clearInterval(typing), 2000);
  });
  const page = await openPopup(context, extensionId);
  await expect(callout(page)).toBeVisible();
});

test('reduced motion: the callout appears with no fade', async ({
  context,
  extensionId,
}) => {
  await sessionHolder(context);
  const page = await openPopup(context, extensionId);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(callout(page)).toBeVisible();
  expect((await fade(page))?.[0]).toBe('none');
});
