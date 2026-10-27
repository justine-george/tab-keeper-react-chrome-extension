import type { BrowserContext, Page, Worker } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { seedSettings } from './fixtures/seed';

// KAN-339 (picked B): each change to Currently open's search puts its list at
// the top, so the first match (Enter's tab) is in view; clearing the search
// puts the list back where it was before the search began.

const OPEN_NOW = '[data-pane="open-now"]';
const SCROLLER = `${OPEN_NOW} [data-open-now-scroller]`;
// 30 tabs match "trip", 10 don't: enough to overflow before and during the search.
const TITLES = [
  ...Array.from(
    { length: 30 },
    (_, i) => `Trip notes ${String(i + 1).padStart(2, '0')}`
  ),
  ...Array.from(
    { length: 10 },
    (_, i) => `Budget sheet ${String(i + 1).padStart(2, '0')}`
  ),
];

test.use({ showScrollbars: true });

async function openWithManyTabs(
  context: BrowserContext,
  extensionId: string,
  serviceWorker: Worker
): Promise<Page> {
  await seedSettings(context, { foldSavedSessionInTabView: false });
  await serviceWorker.evaluate(
    (urls: string[]) => chrome.windows.create({ focused: false, url: urls }),
    TITLES.map((t) => `data:text/html,<title>${t}</title>`)
  );
  const page = await context.newPage();
  await page.setViewportSize({ width: 1317, height: 800 });
  await page.goto(`chrome-extension://${extensionId}/index.html?view=tab`);
  await page.getByRole('button', { name: 'Sort sessions' }).waitFor();
  await expect(page.locator(OPEN_NOW).getByText('Budget sheet 10')).toHaveCount(
    1
  );
  return page;
}

const scrollTop = (page: Page) =>
  page.locator(SCROLLER).evaluate((el) => Math.round(el.scrollTop));

async function scrollTo(page: Page, where: 'bottom' | number): Promise<number> {
  return page.locator(SCROLLER).evaluate((el, w) => {
    el.scrollTop = w === 'bottom' ? el.scrollHeight : w;
    return Math.round(el.scrollTop);
  }, where);
}

// The first match's row is wholly inside the list's visible box.
async function firstMatchInView(page: Page): Promise<boolean> {
  const row = page
    .locator(OPEN_NOW)
    .getByText('Trip notes 01', { exact: true });
  const [r, s] = await Promise.all([
    row.boundingBox(),
    page.locator(SCROLLER).boundingBox(),
  ]);
  if (r === null || s === null) return false;
  return r.y >= s.y && r.y + r.height <= s.y + s.height;
}

const field = (page: Page) =>
  page.getByRole('textbox', { name: 'Search open tabs' });

test('typing a search puts the list at the top, and Esc puts it back where it was', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  const page = await openWithManyTabs(context, extensionId, serviceWorker);
  const before = await scrollTo(page, 'bottom');
  // PREMISE: scrolled well down, so a kept scroll would hide the first match.
  expect(before).toBeGreaterThan(300);

  await field(page).click();
  await field(page).pressSequentially('trip');
  await expect(page.locator(OPEN_NOW).getByText('Budget sheet 01')).toHaveCount(
    0
  );
  // PREMISE: the 30 matches still overflow.
  expect(
    await page
      .locator(SCROLLER)
      .evaluate((el) => el.scrollHeight > el.clientHeight)
  ).toBe(true);

  expect(await scrollTop(page)).toBe(0);
  expect(await firstMatchInView(page)).toBe(true);

  await page.keyboard.press('Escape');
  await expect(field(page)).toHaveValue('');
  expect(await scrollTop(page)).toBe(before);
});

test('every change to the search goes back to the top, and clearing with × still returns to the place before the search', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  const page = await openWithManyTabs(context, extensionId, serviceWorker);
  const before = await scrollTo(page, 400);

  await field(page).click();
  await field(page).pressSequentially('trip');
  // Scrolled down inside the search, then the term changes.
  expect(await scrollTo(page, 'bottom')).toBeGreaterThan(0);
  await field(page).press('Backspace');
  expect(await scrollTop(page)).toBe(0);
  expect(await firstMatchInView(page)).toBe(true);

  // Scrolled again inside the search: clearing still goes to the place before it began.
  await scrollTo(page, 'bottom');
  await page
    .locator(OPEN_NOW)
    .getByRole('button', { name: 'Clear search' })
    .click();
  await expect(field(page)).toHaveValue('');
  expect(await scrollTop(page)).toBe(before);
});
