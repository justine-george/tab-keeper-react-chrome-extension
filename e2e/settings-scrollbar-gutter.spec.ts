import type { Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { buildContainer, seedSessions } from './fixtures/seed';
import { openPage } from './fixtures/onboarding';

// KAN-802. The app draws its own 10px scrollbars, so Chrome lays them out as
// real bars: a box that starts to scroll used to narrow every row in it by
// 10px. Settings keeps that room free in both of its boxes, so a long page or
// a short window moves nothing.
test.use({ showScrollbars: true });

// Each Settings box: its scroller's content width, and whether it scrolls.
const boxes = (page: Page) =>
  page.evaluate(() =>
    ['sessions', 'detail'].map((pane) => {
      const root = document.querySelector(`[data-pane="${pane}"]`)!;
      const scroller = [root, ...root.querySelectorAll('*')].find(
        (el) => getComputedStyle(el).overflowY === 'auto'
      )!;
      return {
        width: scroller.clientWidth,
        scrolls: scroller.scrollHeight > scroller.clientHeight,
      };
    })
  );

async function settings(page: Page, category: string) {
  await page.locator('[aria-label="Settings"]').click();
  await page.locator(`button[aria-label="${category}"]`).click();
  await page.waitForTimeout(100);
}

test('a Settings box keeps its width whether or not it scrolls', async ({
  context,
  extensionId,
}) => {
  await seedSessions(context, buildContainer());
  const page = await openPage(context, extensionId, 'index.html?view=tab', {
    width: 1280,
    height: 800,
  });
  await settings(page, 'Sessions');
  const fits = await boxes(page);
  // PREMISE: neither box scrolls here.
  expect(fits.map((b) => b.scrolls)).toEqual([false, false]);

  // A short window and the longest page: both boxes scroll.
  await page.setViewportSize({ width: 1280, height: 460 });
  await page.locator('button[aria-label="Help"]').click();
  await expect
    .poll(async () => (await boxes(page)).map((b) => b.scrolls))
    .toEqual([true, true]);

  expect((await boxes(page)).map((b) => b.width)).toEqual(
    fits.map((b) => b.width)
  );
});
