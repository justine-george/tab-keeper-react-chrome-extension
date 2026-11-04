import type { BrowserContext, Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { openPage } from './fixtures/onboarding';
import { buildContainer, buildSession, seedSessions } from './fixtures/seed';

// KAN-837 (as KAN-339 B): each change to the saved search puts the detail list
// at the top, so the first match is in view; clearing the search puts the list
// back where it was before the search began.

const FIELD = '[data-saved-search] input';
const FIRST_MATCH = 'Lisbon guide 0-0';

test.use({ showScrollbars: true });

// Six of eight windows match "lisbon", so the results overflow too.
const savedWindow = (i: number, prefix = 'w') => ({
  windowId: `${prefix}${i}`,
  windowHeight: 800,
  windowWidth: 1200,
  windowOffsetTop: 0,
  windowOffsetLeft: 0,
  tabCount: 4,
  title: `${prefix}${i}`,
  tabs: Array.from({ length: 4 }, (_, n) => ({
    tabId: `${prefix}${i}-${n}`,
    favicon: '',
    title: i < 6 ? `Lisbon guide ${i}-${n}` : `Notes ${i}-${n}`,
    url: `https://${prefix}${i}-${n}.test/`,
  })),
});

const session = (
  id: string,
  title: string,
  windows: ReturnType<typeof savedWindow>[]
) =>
  buildSession({
    tabGroupId: id,
    title,
    isSelected: id === 's1',
    windowCount: windows.length,
    tabCount: windows.length * 4,
    windows,
  });

async function openLongSession(
  context: BrowserContext,
  extensionId: string
): Promise<Page> {
  const windows = Array.from({ length: 8 }, (_, i) => savedWindow(i));
  await seedSessions(context, {
    ...buildContainer([session('s1', 'Trip', windows)]),
    selectedTabGroupId: 's1',
  });
  const page = await openPage(context, extensionId, 'index.html', {
    width: 790,
    height: 550,
  });
  await expect(page.locator('[data-drag-row-id="w7"]')).toBeVisible();
  return page;
}

// The saved detail's scroller: the window rows' nearest scrolling ancestor.
const scroller = (page: Page, to?: 'end' | number) =>
  page.evaluate((where) => {
    let el = document.querySelector<HTMLElement>(
      '[data-drag-row-id^="w"], [data-drag-row-id^="x"]'
    )?.parentElement;
    while (el && !['auto', 'scroll'].includes(getComputedStyle(el).overflowY))
      el = el.parentElement;
    if (!el) throw new Error('no scroller above the windows');
    if (where !== undefined)
      el.scrollTop = where === 'end' ? el.scrollHeight : where;
    const r = el.getBoundingClientRect();
    return {
      top: Math.round(el.scrollTop),
      max: el.scrollHeight - el.clientHeight,
      boxTop: r.top,
      boxBottom: r.bottom,
    };
  }, to);

async function expectFirstMatchInView(page: Page): Promise<void> {
  const row = await page.getByText(FIRST_MATCH, { exact: true }).boundingBox();
  if (row === null) throw new Error('the first match has no box');
  const box = await scroller(page);
  expect(row.y).toBeGreaterThanOrEqual(box.boxTop);
  expect(row.y + row.height).toBeLessThanOrEqual(box.boxBottom);
}

const typed = async (page: Page, text: string) => {
  await page.locator(FIELD).click();
  await page.locator(FIELD).pressSequentially(text);
  await expect(page.getByText('Notes 7-0', { exact: true })).toHaveCount(0);
};

test('typing a search puts the list at the top, and Esc puts it back where it was', async ({
  context,
  extensionId,
}) => {
  const page = await openLongSession(context, extensionId);
  const before = (await scroller(page, 'end')).top;
  // PREMISE: scrolled well down, so a kept scroll would hide the first match.
  expect(before).toBeGreaterThan(300);

  await typed(page, 'lisbon');
  // PREMISE: the matches still overflow, so a kept scroll is not clamped to 0.
  expect((await scroller(page)).max).toBeGreaterThan(0);

  expect((await scroller(page)).top).toBe(0);
  await expectFirstMatchInView(page);

  await page.keyboard.press('Escape');
  await expect(page.locator(FIELD)).toHaveValue('');
  await expect.poll(async () => (await scroller(page)).top).toBe(before);
});

test('every change to the search goes back to the top, and × still returns to the place before the search', async ({
  context,
  extensionId,
}) => {
  const page = await openLongSession(context, extensionId);
  const before = (await scroller(page, 400)).top;

  await typed(page, 'lisbon');
  // Scrolled down inside the search, then the term changes.
  expect((await scroller(page, 'end')).top).toBeGreaterThan(0);
  await page.locator(FIELD).press('Backspace');
  await expect.poll(async () => (await scroller(page)).top).toBe(0);
  await expectFirstMatchInView(page);

  await scroller(page, 'end');
  await page.getByRole('button', { name: 'Clear search' }).click();
  await expect(page.locator(FIELD)).toHaveValue('');
  await expect.poll(async () => (await scroller(page)).top).toBe(before);
});

test('a term with no match, then clearing, still returns to the place before the search', async ({
  context,
  extensionId,
}) => {
  const page = await openLongSession(context, extensionId);
  const before = (await scroller(page, 'end')).top;

  await typed(page, 'lisbon');
  await page.locator(FIELD).pressSequentially('zz');
  // PREMISE: no match unmounts the detail list.
  await expect(page.locator('[data-drag-row-id="w0"]')).toHaveCount(0);

  await page.locator(FIELD).press('Escape');
  await expect(page.locator('[data-drag-row-id="w7"]')).toBeVisible();
  await expect.poll(async () => (await scroller(page)).top).toBe(before);
});

test('a search that moves the selection to another session leaves that session at the top when cleared', async ({
  context,
  extensionId,
}) => {
  const other = Array.from({ length: 8 }, (_, i) => savedWindow(i, 'x'));
  const plain = Array.from({ length: 8 }, (_, i) => ({
    ...savedWindow(i),
    tabs: savedWindow(i).tabs.map((t) => ({ ...t, title: `Plain ${t.tabId}` })),
  }));
  await seedSessions(context, {
    ...buildContainer([
      session('s1', 'Trip', plain),
      session('s2', 'Other', other),
    ]),
    selectedTabGroupId: 's1',
  });
  const page = await openPage(context, extensionId, 'index.html', {
    width: 790,
    height: 550,
  });
  await expect(page.locator('[data-drag-row-id="w7"]')).toBeVisible();
  expect((await scroller(page, 'end')).top).toBeGreaterThan(300);

  await page.locator(FIELD).click();
  await page.locator(FIELD).pressSequentially('lisbon');
  // PREMISE: s1 has no match, so the search selected s2.
  await expect(page.locator('[data-drag-row-id="x0"]')).toBeVisible();

  await page.locator(FIELD).press('Escape');
  await expect(page.locator(FIELD)).toHaveValue('');
  await expect(page.locator('[data-drag-row-id="x7"]')).toBeVisible();
  // s1's place means nothing in s2's list.
  expect((await scroller(page)).top).toBe(0);
});
