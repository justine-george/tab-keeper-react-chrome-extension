import type { Locator, Page, Worker } from '@playwright/test';

import { grantedTest as test, expect } from './fixtures/grantedExtension';
import { openPage } from './fixtures/onboarding';

// KAN-832. A search typed while a Currently open group is held (Shift+Tab
// back to the field mid-drag) cancels the drag (KAN-335) and must still put
// the list at the top (KAN-339 B), so the first match is in view. The cancel
// used to put back the scroll from the press, over the search's top.
// Needs the tabGroups grant, so a group is an item at all.

const VIEW_TAB = 'index.html?view=tab';
const OPEN_NOW = '[data-pane="open-now"]';
const SCROLLER = `${OPEN_NOW} [data-open-now-scroller]`;
// 30 tabs match "trip", 10 don't: the list overflows before and during the
// search. The last two are grouped, so the group is on screen at the bottom.
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

const field = (page: Page): Locator =>
  page
    .locator(OPEN_NOW)
    .getByRole('textbox', { name: 'Search open tabs', exact: true });

async function openWithGroupAtBottom(
  worker: Worker,
  page: () => Promise<Page>
): Promise<Page> {
  await worker.evaluate(
    async (urls: string[]) => {
      const win = await chrome.windows.create({ focused: false, url: urls });
      const ids = (win?.tabs ?? []).flatMap((tab) =>
        tab.id === undefined ? [] : [tab.id]
      );
      const id = await chrome.tabGroups.update(
        await chrome.tabs.group({
          tabIds: ids.slice(-2),
          createProperties: { windowId: win?.id },
        }),
        { title: 'Bills', color: 'blue' }
      );
      return id;
    },
    TITLES.map((t) => `data:text/html,<title>${t}</title>`)
  );
  const p = await page();
  await expect(p.locator(OPEN_NOW).getByText('Budget sheet 10')).toHaveCount(1);
  return p;
}

const scrollTop = (page: Page) =>
  page.locator(SCROLLER).evaluate((el) => Math.round(el.scrollTop));

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

const isHeld = (page: Page) =>
  page.evaluate(() => document.querySelector('[data-drag-held]') !== null);

const isDragging = (page: Page) =>
  page.evaluate(() => document.documentElement.hasAttribute('data-dragging'));

test('a search typed while a group is held puts the list at the top, and Esc puts it back where the search began', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  const page = await openWithGroupAtBottom(serviceWorker, () =>
    openPage(context, extensionId, VIEW_TAB, { width: 1317, height: 800 })
  );
  const before = await page.locator(SCROLLER).evaluate((el) => {
    el.scrollTop = el.scrollHeight;
    return Math.round(el.scrollTop);
  });
  // PREMISE: scrolled well down, so a kept scroll would hide the first match.
  expect(before).toBeGreaterThan(300);

  const handle = page
    .locator(OPEN_NOW)
    .locator('[data-group-drag-handle]')
    .filter({ hasText: 'Bills' });
  const box = await handle.boundingBox();
  if (box === null) throw new Error('the Bills group has no handle box');
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y - 10, { steps: 3 });
  // PREMISE: the group is held.
  await expect.poll(() => isHeld(page)).toBe(true);

  const fieldFocused = () =>
    field(page).evaluate((input) => input === document.activeElement);
  for (let i = 0; i < 300 && !(await fieldFocused()); i++) {
    await page.keyboard.press('Shift+Tab');
  }
  expect(await fieldFocused(), 'Shift+Tab never reached the field').toBe(true);
  // PREMISE: still held when the search starts, so this is KAN-335's cancel.
  expect(await isHeld(page)).toBe(true);

  // Focus walking up the rows scrolled the list on its way. Put it partway
  // down, neither the press's scroll nor the top, so Esc below can tell the
  // place the search began from both.
  const atSearch = await page.locator(SCROLLER).evaluate((el) => {
    el.scrollTop = 200;
    return Math.round(el.scrollTop);
  });
  expect(atSearch).toBe(200);

  // One letter: a second keystroke would go to the top again and hide a
  // restore after the first. Measured on main before the fix: 378, the
  // press's 806 clamped to the search list's end, first match off screen.
  await page.keyboard.type('p');
  await expect(field(page)).toHaveValue('p');
  await expect(page.locator(OPEN_NOW).getByText('Budget sheet 01')).toHaveCount(
    0
  );
  // The search cancelled the drag (KAN-335).
  await expect.poll(() => isDragging(page)).toBe(false);
  // PREMISE: the 30 matches still overflow.
  expect(
    await page
      .locator(SCROLLER)
      .evaluate((el) => el.scrollHeight > el.clientHeight)
  ).toBe(true);
  // Two frames on: the cancel's restore can land a frame late.
  await page.evaluate(
    () =>
      new Promise((r) =>
        requestAnimationFrame(() => requestAnimationFrame(() => r(null)))
      )
  );

  expect(await scrollTop(page)).toBe(0);
  expect(await firstMatchInView(page)).toBe(true);

  await page.mouse.up();
  expect(await scrollTop(page)).toBe(0);

  await page.keyboard.press('Escape');
  await expect(field(page)).toHaveValue('');
  // KAN-339 B: back to where the search began.
  expect(await scrollTop(page)).toBe(atSearch);
});
