import type { BrowserContext, Locator, Page, Worker } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { saveRowSaveAll } from './fixtures/sessionActions';

// KAN-564 on the real artifact (picks A and P). A Chrome split shows a split
// mark on both halves, in Open now and in the saved session, and Open now's
// active bar runs down both halves as one bar. What jsdom cannot show: a split
// Chrome made (tabs.createSplit, Chrome 155+), the bar's drawn ::before, and
// the glyph from the bundled icon subset.

const VIEW_TAB = 'index.html?view=tab';
const OPEN_NOW = '[data-pane="open-now"]';
const DETAIL = '[data-pane="detail"]';

async function openPage(
  context: BrowserContext,
  extensionId: string
): Promise<Page> {
  const page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`chrome-extension://${extensionId}/${VIEW_TAB}`);
  // Barrier: goto resolves before React mounts.
  await page.getByRole('button', { name: 'Sort sessions' }).waitFor();
  return page;
}

const dataUrl = (title: string) =>
  `data:text/html,${encodeURIComponent(`<title>${title}</title>`)}`;

// A window of A, B, C, D, unfocused so the tab view stays in front, with B
// and C made one split and C the half Chrome calls active.
async function splitWindow(worker: Worker): Promise<number> {
  const made = await worker.evaluate(async (urls: string[]) => {
    const createSplit: unknown = Reflect.get(chrome.tabs, 'createSplit');
    if (typeof createSplit !== 'function') return 'no tabs.createSplit';
    const win = await chrome.windows.create({ focused: false, url: urls });
    const ids = (win?.tabs ?? []).flatMap((t) =>
      t.id === undefined ? [] : [t.id]
    );
    await Reflect.apply(createSplit, chrome.tabs, [[ids[1], ids[2]]]);
    await chrome.tabs.update(ids[2], { active: true });
    return win?.id ?? 'no window';
  }, ['SplitA', 'SplitB', 'SplitC', 'SplitD'].map(dataUrl));
  if (typeof made !== 'number') throw new Error(made);
  return made;
}

const liveRow = (page: Page, windowId: number, title: string): Locator =>
  page
    .locator(`${OPEN_NOW} [data-open-window-id="${windowId}"]`)
    .getByRole('button', { name: `Switch to tab: ${title}`, exact: true });

// The bar's drawn span, in viewport pixels, or null when the row has none.
const barOf = (row: Locator) =>
  row.evaluate((button) => {
    const el = button.closest('[data-open-tab-id]');
    if (el === null) throw new Error('no row');
    const before = getComputedStyle(el, '::before');
    if (before.content === 'none' || before.content === 'normal') return null;
    const box = el.getBoundingClientRect();
    return {
      top: box.top + parseFloat(before.top),
      bottom: box.bottom - parseFloat(before.bottom),
      rowTop: box.top,
      rowBottom: box.bottom,
    };
  });

test.describe('a split view in the rows (KAN-564)', () => {
  test('1. Open now: both halves wear the split mark, named for the other half, and one bar runs down both', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const page = await openPage(context, extensionId);
    const windowId = await splitWindow(serviceWorker);
    const row = (title: string) => liveRow(page, windowId, title);
    await expect(row('SplitB').locator('[data-split]')).toBeVisible();

    await expect(row('SplitB')).toHaveAccessibleDescription(
      'In a split view with “SplitC”'
    );
    await expect(row('SplitC')).toHaveAccessibleDescription(
      'In a split view with “SplitB”'
    );
    for (const title of ['SplitA', 'SplitD'])
      await expect(row(title).locator('[data-split]')).toHaveCount(0);
    // The glyph is the subset's, not its name drawn as text (KAN-215).
    const glyph = row('SplitB').locator('[data-split]');
    expect((await glyph.boundingBox())?.width ?? 0).toBeLessThan(40);

    // P: Chrome calls C active, yet the bar runs from B's top inset to C's
    // bottom inset with no break.
    await expect(row('SplitC')).toHaveAttribute('aria-current', 'true');
    const b = await barOf(row('SplitB'));
    const c = await barOf(row('SplitC'));
    if (b === null || c === null) throw new Error('a half has no bar');
    expect(b.top - b.rowTop).toBeCloseTo(8, 1);
    expect(c.rowBottom - c.bottom).toBeCloseTo(8, 1);
    expect(c.top).toBeCloseTo(b.bottom, 1);
    // CONTROL: the tabs outside the split wear no bar.
    expect(await barOf(row('SplitA'))).toBeNull();
    expect(await barOf(row('SplitD'))).toBeNull();
  });

  test('2. the saved session: both halves of the saved pair wear the split mark', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const page = await openPage(context, extensionId);
    await splitWindow(serviceWorker);
    await expect(
      page.locator(`${OPEN_NOW} [data-split]`).first()
    ).toBeVisible();
    await saveRowSaveAll(page).click();
    // The full view keeps Open now beside the list; the session's own rows
    // show once it is picked.
    await page.locator('[data-pane="sessions"] [data-drag-row-id]').click();

    const saved = (title: string) =>
      page.locator(DETAIL).getByRole('button', {
        name: `Open in new tab: ${title}`,
        exact: true,
      });
    await expect(saved('SplitB').locator('[data-split]')).toBeVisible();
    await expect(saved('SplitB')).toHaveAccessibleDescription(
      'In a split view with “SplitC”'
    );
    await expect(saved('SplitC')).toHaveAccessibleDescription(
      'In a split view with “SplitB”'
    );
    for (const title of ['SplitA', 'SplitD'])
      await expect(saved(title).locator('[data-split]')).toHaveCount(0);
  });
});
