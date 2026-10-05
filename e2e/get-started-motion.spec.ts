import type { Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { openPopup } from './fixtures/onboarding';

// The real build: a new install's welcome, in the popup.

test.use({ freshProfile: true });

const welcome = (page: Page) =>
  page.getByRole('dialog', { name: 'Welcome to Tab Keeper', exact: true });
const offer = (page: Page) =>
  page.getByRole('dialog', { name: 'Try the full view', exact: true });
const getStarted = (page: Page) =>
  welcome(page).getByRole('button', { name: 'Get started', exact: true });

// The shutter's transform each frame, and the offer's animation count at each opening.
async function watchMoment(page: Page): Promise<void> {
  await page.evaluate(() => {
    const shutter: string[] = [];
    const openings: number[] = [];
    Object.defineProperty(globalThis, '__shutter', {
      value: shutter,
      configurable: true,
    });
    Object.defineProperty(globalThis, '__openings', {
      value: openings,
      configurable: true,
    });
    const tick = () => {
      const rect = document.querySelector(
        'dialog[open] [data-mark-part="shutter"]'
      );
      if (rect !== null) shutter.push(getComputedStyle(rect).transform);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    new MutationObserver(() => {
      const dialog = document.querySelector(
        'dialog[open][aria-labelledby="full-view-offer-title"]'
      );
      if (dialog instanceof HTMLElement && dialog.dataset.seen === undefined) {
        dialog.dataset.seen = '';
        openings.push(dialog.getAnimations().length);
      }
    }).observe(document, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['open'],
    });
  });
}
const shutterSeen = (page: Page) =>
  page.evaluate(() => {
    const seen: unknown = Reflect.get(globalThis, '__shutter');
    return Array.isArray(seen) ? seen.map(String) : [];
  });
const openingsSeen = (page: Page) =>
  page.evaluate(() => {
    const seen: unknown = Reflect.get(globalThis, '__openings');
    return Array.isArray(seen) ? seen.map(Number) : [];
  });
const offerSettled = (page: Page) =>
  page.evaluate(() => {
    const dialog = document.querySelector(
      'dialog[open][aria-labelledby="full-view-offer-title"]'
    );
    return (
      dialog !== null &&
      getComputedStyle(dialog).opacity === '1' &&
      dialog.getAnimations().length === 0
    );
  });
const moved = (transforms: string[]) =>
  transforms.some((t) => t !== 'none' && t !== 'matrix(1, 0, 0, 1, 0, 0)');

test('Get started: the shutter slides, the welcome leaves, and Try the full view enters and ends fully shown', async ({
  context,
  extensionId,
}) => {
  const page = await openPopup(context, extensionId);
  await expect(welcome(page)).toBeVisible();
  await watchMoment(page);
  await getStarted(page).click();
  await expect(offer(page)).toBeVisible();
  await expect.poll(() => offerSettled(page)).toBe(true);
  expect(moved(await shutterSeen(page))).toBe(true);
  expect(await openingsSeen(page)).toEqual([1]);
});

test('a second press while it plays does nothing: one moment, one offer', async ({
  context,
  extensionId,
}) => {
  const page = await openPopup(context, extensionId);
  await expect(welcome(page)).toBeVisible();
  await watchMoment(page);
  await getStarted(page).dblclick();
  await expect(offer(page)).toBeVisible();
  await expect.poll(() => offerSettled(page)).toBe(true);
  expect(await openingsSeen(page)).toEqual([1]);
});

test('reduced motion: Get started goes straight to Try the full view, and nothing moves', async ({
  context,
  extensionId,
}) => {
  const page = await openPopup(context, extensionId);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(welcome(page)).toBeVisible();
  await watchMoment(page);
  await getStarted(page).click();
  await expect(offer(page)).toBeVisible();
  expect(await openingsSeen(page)).toEqual([0]);
  expect(moved(await shutterSeen(page))).toBe(false);
});

test('Esc while it plays closes the welcome at once, and the offer comes with no entrance', async ({
  context,
  extensionId,
}) => {
  const page = await openPopup(context, extensionId);
  await expect(welcome(page)).toBeVisible();
  await watchMoment(page);
  await getStarted(page).click();
  await page.keyboard.press('Escape');
  await expect(offer(page)).toBeVisible();
  expect(await openingsSeen(page)).toEqual([0]);
});
