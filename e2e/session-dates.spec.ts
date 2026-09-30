import type { BrowserContext, Locator, Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { buildContainer, buildSession, seedSessions } from './fixtures/seed';

// KAN-347. A session's date says "today" or "yesterday", and a list left open
// across midnight must not keep saying "today": the day is re-checked about
// once a minute, and at once when the page comes back into view.
//
// jsdom covers the formats; this proves the redraw in a real browser, with
// Playwright's clock in charge of the page's Date and timers. The clock is
// set in 2027, far from the real date, so the premise check below can tell a
// fake clock from a real one. Test process and browser share this machine's
// time zone, so local dates agree on both sides.

const EDITED = new Date(2027, 0, 15, 23, 0).getTime();
const BEFORE_MIDNIGHT = new Date(2027, 0, 15, 23, 59, 0);

const TODAY = /^Edited today,\s11:00\sPM$/;
const YESTERDAY = /^Edited yesterday,\s11:00\sPM$/;

async function openList(
  context: BrowserContext,
  extensionId: string
): Promise<{ page: Page; row: Locator }> {
  await seedSessions(
    context,
    buildContainer([
      buildSession({
        tabGroupId: 'movie-night',
        title: 'Movie night',
        contentModified: EDITED,
      }),
    ])
  );
  const page = await context.newPage();
  await page.clock.install({ time: BEFORE_MIDNIGHT });
  await page.setViewportSize({ width: 790, height: 550 });
  await page.goto(`chrome-extension://${extensionId}/index.html`);
  // Barrier: goto resolves before React mounts.
  const row = page.locator('[data-drag-row-id="movie-night"]');
  await row.waitFor();

  // PREMISE: the fake clock reached the extension page. Without it, every
  // assertion below would be about the real date.
  expect(await page.evaluate(() => new Date().getFullYear())).toBe(2027);
  return { page, row };
}

test.describe('session dates across midnight (KAN-347)', () => {
  test('a list drawn before midnight says yesterday after it, untouched', async ({
    context,
    extensionId,
  }) => {
    const { page, row } = await openList(context, extensionId);
    const date = row.getByText(/^Edited /);
    await expect(date).toHaveText(TODAY);
    // The hover holds the full timestamp, seconds and year included.
    await expect(date).toHaveAttribute('title', /2027.*11:00:00/);

    // Two minutes of page time: past midnight and past one day check.
    await page.clock.runFor(2 * 60_000);

    await expect(date).toHaveText(YESTERDAY);
  });

  // A hidden tab's timers are slowed and a laptop can sleep across midnight;
  // coming back into view re-checks at once. Playwright never fires
  // visibilitychange on a tab switch, so the event is dispatched.
  test('coming back into view says yesterday at once', async ({
    context,
    extensionId,
  }) => {
    const { page, row } = await openList(context, extensionId);
    const date = row.getByText(/^Edited /);
    await expect(date).toHaveText(TODAY);

    // Stop the page's timers, then move its date past midnight without
    // running them: only the event can redraw now.
    await page.clock.pauseAt(new Date(2027, 0, 15, 23, 59, 50));
    await page.clock.setSystemTime(new Date(2027, 0, 16, 0, 0, 10));
    // CONTROL: the new date alone redraws nothing.
    await expect(date).toHaveText(TODAY);

    await page.evaluate(() =>
      document.dispatchEvent(new Event('visibilitychange'))
    );

    await expect(date).toHaveText(YESTERDAY, { timeout: 2000 });
  });

  test('the session header says the same', async ({ context, extensionId }) => {
    const { page, row } = await openList(context, extensionId);
    await row.getByText('Movie night').click();
    const both = page.getByText(/^Edited (today|yesterday),/);
    await expect(both).toHaveCount(2);
    await expect(both.nth(1)).toHaveText(TODAY);

    await page.clock.runFor(2 * 60_000);

    await expect(both).toHaveText([YESTERDAY, YESTERDAY]);
  });
});
