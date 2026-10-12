import type { Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { openPopup } from './fixtures/onboarding';

// KAN-431. The real build: a click on the header mark presses it and slides its shutter.

const mark = (page: Page) =>
  page.locator('svg:has([data-mark-part="shutter"])').first();

// Records, every frame, which parts of the header mark are animating and how.
async function watchMark(page: Page): Promise<void> {
  await page.evaluate(() => {
    const seen = new Set<string>();
    Object.defineProperty(globalThis, '__markAnimations', {
      value: seen,
      configurable: true,
    });
    const tick = () => {
      for (const animation of document.getAnimations()) {
        if (!(animation.effect instanceof KeyframeEffect)) continue;
        const target = animation.effect.target;
        if (target === null) continue;
        const part = target.hasAttribute('data-mark-part') ? 'shutter' : 'mark';
        const props = animation.effect
          .getKeyframes()
          .flatMap((frame) => Object.keys(frame))
          .filter((key) => key !== 'offset' && key !== 'computedOffset')
          .filter((key) => key !== 'easing' && key !== 'composite');
        seen.add(`${part}:${[...new Set(props)].join(',')}`);
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}
const animated = (page: Page) =>
  page.evaluate(() => {
    const seen: unknown = Reflect.get(globalThis, '__markAnimations');
    return seen instanceof Set ? [...seen].map(String).sort() : [];
  });
const twoFrames = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      )
  );
const BOTH = ['mark:transform', 'shutter:transform'];

test('a click on the header mark presses it and slides the shutter, transform only', async ({
  context,
  extensionId,
}) => {
  const page = await openPopup(context, extensionId);
  await watchMark(page);
  await mark(page).click();
  await expect.poll(() => animated(page)).toEqual(BOTH);
});

test('reduced motion: a click starts nothing, and the same observer sees it once motion is allowed', async ({
  context,
  extensionId,
}) => {
  const page = await openPopup(context, extensionId);
  await watchMark(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mark(page).click();
  await twoFrames(page);
  expect(await animated(page)).toEqual([]);

  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await mark(page).click();
  await expect.poll(() => animated(page)).toEqual(BOTH);
});

// KAN-521. The shutter click, once the shutter has shut; and at the press when nothing is drawn.
async function logBeat(context: import('@playwright/test').BrowserContext) {
  await context.addInitScript(() => {
    if (window.top !== window) return;
    const log: { what: string; at: number }[] = [];
    Object.defineProperty(window, '__beat', { value: log });
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (keyframes, options) {
      if (this.getAttribute('data-mark-part') === 'shutter')
        log.push({ what: 'shutter', at: performance.now() });
      return animate.call(this, keyframes, options);
    };
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (when, offset, duration) {
      log.push({ what: 'tick', at: performance.now() });
      start.call(this, when, offset, duration);
    };
  });
}
const beat = (page: Page) =>
  page.evaluate(
    () => Reflect.get(window, '__beat') as { what: string; at: number }[]
  );

test('a click on the header mark clicks once, as its shutter shuts', async ({
  context,
  extensionId,
}) => {
  await logBeat(context);
  const page = await openPopup(context, extensionId);
  await mark(page).click();
  await expect.poll(async () => (await beat(page)).length).toBe(3);
  const log = await beat(page);
  const shutter = log.find((e) => e.what === 'shutter')!;
  const ticks = log.filter((e) => e.what === 'tick');
  expect(shutter).toBeDefined();
  expect(ticks).toHaveLength(2);
  // The 60ms delay plus the 300ms slide.
  expect(ticks[0].at - shutter.at).toBeGreaterThanOrEqual(340);
});

test('reduced motion: no shutter, and the click sounds at the press', async ({
  context,
  extensionId,
}) => {
  await logBeat(context);
  const page = await openPopup(context, extensionId);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mark(page).click();
  await expect.poll(async () => (await beat(page)).length).toBe(2);
  expect((await beat(page)).map((e) => e.what)).toEqual(['tick', 'tick']);
});
