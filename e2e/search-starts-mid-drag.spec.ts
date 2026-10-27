import type { Locator, Page, Worker } from '@playwright/test';

import { grantedTest as test, expect } from './fixtures/grantedExtension';
import { openPage } from './fixtures/onboarding';
import { buildContainer, buildSession, seedSessions } from './fixtures/seed';

// KAN-832. A search typed while a row is held (Shift+Tab back to the field
// mid-drag) cancels the drag (KAN-335), and the cancel no longer puts back
// the scroll from the press over the list the search has just drawn.
// Currently open's search puts its list at the top (KAN-339 B); the saved
// search moves nothing, so its list keeps the scroll the drag's fold left.
// Needs the tabGroups grant, so an Open now group is an item at all.

const VIEW_TAB = 'index.html?view=tab';
const OPEN_NOW = '[data-pane="open-now"]';
const SCROLLER = `${OPEN_NOW} [data-open-now-scroller]`;
// 30 tabs match "p", 10 don't: the list overflows before and during the
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
      const [a, b] = ids.slice(-2);
      if (a === undefined || b === undefined)
        throw new Error('Chrome gave the window fewer than two tabs');
      const id = await chrome.tabs.group({
        tabIds: [a, b],
        createProperties: { windowId: win?.id },
      });
      await chrome.tabGroups.update(id, { title: 'Bills', color: 'blue' });
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

// The saved side, measured on main before the fix: scrolled to the end (928)
// with the last window held (the fold took the scroll to 0), one letter put
// the search's list at its end (592 of 592) and its first match at y=-429.
const savedWindow = (i: number) => ({
  windowId: `w${i}`,
  windowHeight: 800,
  windowWidth: 1200,
  windowOffsetTop: 0,
  windowOffsetLeft: 0,
  tabCount: 4,
  title: `w${i}`,
  tabs: Array.from({ length: 4 }, (_, n) => ({
    tabId: `w${i}-${n}`,
    favicon: '',
    // Six windows match "l", so the search's list overflows; w6 and w7 don't.
    title: i < 6 ? `Lisbon guide ${i}-${n}` : `Notes ${i}-${n}`,
    url: `https://w${i}-${n}.test/`,
  })),
});

test("a saved search typed while a session's window is held keeps the scroll the fold left", async ({
  context,
  extensionId,
}) => {
  const windows = Array.from({ length: 8 }, (_, i) => savedWindow(i));
  await seedSessions(context, {
    ...buildContainer([
      buildSession({
        tabGroupId: 's1',
        title: 'Trip',
        isSelected: true,
        windowCount: windows.length,
        tabCount: windows.length * 4,
        windows,
      }),
    ]),
    selectedTabGroupId: 's1',
  });
  const page = await openPage(context, extensionId, 'index.html', {
    width: 790,
    height: 550,
  });
  await expect(page.locator('[data-drag-row-id="w7"]')).toBeVisible();
  // PREMISE: scrolled to the end, so a kept scroll would hide the first match.
  expect((await savedScroller(page, true)).top).toBeGreaterThan(300);

  const handle = page
    .locator('[data-drag-row-id="w7"] [data-window-drag-handle]')
    .first();
  const box = await handle.boundingBox();
  if (box === null) throw new Error('w7 has no handle box');
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y - 10, { steps: 3 });
  await expect.poll(() => isHeld(page)).toBe(true);

  const input = page.locator('[data-saved-search] input');
  const inputFocused = () =>
    input.evaluate((el) => el === document.activeElement);
  for (let i = 0; i < 300 && !(await inputFocused()); i++) {
    await page.keyboard.press('Shift+Tab');
  }
  expect(await inputFocused(), 'Shift+Tab never reached the field').toBe(true);
  expect(await isHeld(page)).toBe(true);
  // PREMISE: the fold took the scroll well short of the press's, so a
  // restore and a kept scroll differ.
  const atSearch = (await savedScroller(page)).top;
  expect(atSearch).toBe(0);

  await page.keyboard.type('l');
  await expect(page.getByText('Notes 7-0', { exact: true })).toHaveCount(0);
  await expect.poll(() => isDragging(page)).toBe(false);
  // PREMISE: the six matching windows still overflow.
  const pane = await savedScroller(page);
  expect(pane.max).toBeGreaterThan(0);
  await page.evaluate(
    () =>
      new Promise((r) =>
        requestAnimationFrame(() => requestAnimationFrame(() => r(null)))
      )
  );

  expect((await savedScroller(page)).top).toBe(atSearch);
  // So, from the top here, the first match is in view.
  const first = await page
    .getByText('Lisbon guide 0-0', { exact: true })
    .boundingBox();
  if (first === null) throw new Error('the first match has no box');
  expect(first.y).toBeGreaterThanOrEqual(pane.boxTop);
  expect(first.y + first.height).toBeLessThanOrEqual(pane.boxBottom);
  await page.mouse.up();
});

// The saved detail's scroller (the window rows' nearest scrolling ancestor):
// its scroll, how far it can scroll, and its box. `toEnd` scrolls it to the
// end first.
const savedScroller = (page: Page, toEnd = false) =>
  page.evaluate((end) => {
    let el = document.querySelector<HTMLElement>(
      '[data-drag-row-id="w0"]'
    )?.parentElement;
    while (el && !['auto', 'scroll'].includes(getComputedStyle(el).overflowY))
      el = el.parentElement;
    if (!el) throw new Error('no scroller above the windows');
    if (end) el.scrollTop = el.scrollHeight;
    const r = el.getBoundingClientRect();
    return {
      top: Math.round(el.scrollTop),
      max: el.scrollHeight - el.clientHeight,
      boxTop: r.top,
      boxBottom: r.bottom,
    };
  }, toEnd);
