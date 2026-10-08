import type { BrowserContext, Locator, Page, Worker } from '@playwright/test';

import { test, expect } from './fixtures/extension';

// KAN-472 on the real artifact: Open now draws This window first and keeps
// its Chrome-order number, under a search too, and a drag measures the
// windows in the order they are drawn. What jsdom cannot show: the drag
// engine's hit test against a real layout, where a mismatch between the
// drawn order and the order the drop geometry reads sends a drop to the
// wrong window.
//
// Staged as Justine's screenshot: the tab view opens in Chrome's 4th window.
// The launch window (Window 1) holds Inbox; the worker opens Window 2 and
// Window 3 unfocused, then This window with the tab view and two tabs.

const VIEWPORT = { width: 1280, height: 800 };
const VIEW_TAB = 'index.html?view=tab';
const BLOCK = '[data-open-window-id]';

const dataUrl = (title: string) =>
  `data:text/html,${encodeURIComponent(`<title>${title}</title>`)}`;

interface Staged {
  page: Page;
  launch: number;
  second: number;
  third: number;
  self: number;
  tab: (title: string) => number;
}

async function stage(
  context: BrowserContext,
  worker: Worker,
  extensionId: string
): Promise<Staged> {
  const first = context.pages()[0] ?? (await context.newPage());
  await first.goto(dataUrl('Inbox'));
  const made = await worker.evaluate(
    async ({ others, view, mine }) => {
      const out: { windowId: number; titles: string[]; ids: number[] }[] = [];
      for (const titles of others) {
        const win = await chrome.windows.create({
          focused: false,
          url: titles.map((t) => t.url),
        });
        out.push({
          windowId: win?.id ?? -1,
          titles: titles.map((t) => t.title),
          ids: (win?.tabs ?? []).map((tab) => tab.id ?? -1),
        });
      }
      const win = await chrome.windows.create({
        focused: true,
        url: [view, ...mine.map((t) => t.url)],
      });
      out.push({
        windowId: win?.id ?? -1,
        titles: mine.map((t) => t.title),
        // The tab view's own tab is first; Open now never lists it.
        ids: (win?.tabs ?? []).slice(1).map((tab) => tab.id ?? -1),
      });
      const [launch] = await chrome.tabs.query({ title: 'Inbox' });
      return { out, launch: launch?.windowId ?? -1 };
    },
    {
      others: [
        ['Flight options', 'Hotel booking'],
        ['Pull request', 'CI run'],
      ].map((titles) =>
        titles.map((title) => ({ title, url: dataUrl(title) }))
      ),
      view: `chrome-extension://${extensionId}/${VIEW_TAB}`,
      mine: ['Quarterly report', 'Budget sheet'].map((title) => ({
        title,
        url: dataUrl(title),
      })),
    }
  );
  const ids = new Map<string, number>();
  for (const w of made.out) {
    w.titles.forEach((title, i) => ids.set(title, w.ids[i] ?? -1));
  }
  const [second, third, self] = made.out.map((w) => w.windowId);
  if (second === undefined || third === undefined || self === undefined) {
    throw new Error('Chrome gave no window ids');
  }
  if ([...ids.values(), made.launch].includes(-1)) {
    throw new Error('Chrome gave no tab ids');
  }

  const page =
    context.pages().find((p) => p.url().includes(VIEW_TAB)) ??
    (await context.waitForEvent('page', (p) => p.url().includes(VIEW_TAB)));
  await page.setViewportSize(VIEWPORT);
  // Barrier: the page has mounted and Open now has listed all four windows.
  await page.getByRole('button', { name: 'Sort sessions' }).waitFor();
  await expect(page.locator(BLOCK)).toHaveCount(4);
  // PREMISE: Chrome orders the windows as staged, This window last.
  const chromeIds = await worker.evaluate(async () =>
    (await chrome.windows.getAll({ windowTypes: ['normal'] })).map((w) => w.id)
  );
  expect(chromeIds).toEqual([made.launch, second, third, self]);

  return {
    page,
    launch: made.launch,
    second,
    third,
    self,
    tab: (title) => {
      const id = ids.get(title);
      if (id === undefined) throw new Error(`no tab titled ${title}`);
      return id;
    },
  };
}

const drawnWindowIds = (page: Page): Promise<number[]> =>
  page
    .locator(BLOCK)
    .evaluateAll((blocks) =>
      blocks.map((b) => Number(b.getAttribute('data-open-window-id')))
    );

// A window's tab rows in the order the list shows them.
const shownOrder = (page: Page, windowId: number): Promise<number[]> =>
  page
    .locator(`[data-open-window-id="${windowId}"] [data-open-tab-id]`)
    .evaluateAll((rows) =>
      rows.map((row) => Number(row.getAttribute('data-open-tab-id')))
    );

const windowOf = (worker: Worker, tabId: number): Promise<number> =>
  worker.evaluate(async (id) => (await chrome.tabs.get(id)).windowId, tabId);

const tabRow = (page: Page, tabId: number): Locator =>
  page.locator(`[data-open-tab-id="${tabId}"]`);

async function boxOf(target: Locator) {
  const box = await target.boundingBox();
  if (box === null) throw new Error('the target has no box');
  return box;
}

// Presses a tab row, requires it is held, moves to the y `aim` gives once the
// drag is live (rows are measured at pick-up), rests past DURATION.MOVE and
// releases.
async function dragTab(
  page: Page,
  tabId: number,
  aim: () => Promise<number>
): Promise<void> {
  const box = await boxOf(tabRow(page, tabId));
  const x = box.x + 60;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + 10, { steps: 3 });
  await expect
    .poll(
      () =>
        page.evaluate(
          () => document.querySelector('[data-drag-held]') !== null
        ),
      { message: 'the row was never picked up', timeout: 3000 }
    )
    .toBe(true);
  await page.mouse.move(x, await aim(), { steps: 10 });
  await page.waitForTimeout(350);
  await page.mouse.up();
}

// Just inside a row's top edge: above its midpoint, so the slot opens before it.
const justInside = async (page: Page, tabId: number) =>
  (await boxOf(tabRow(page, tabId))).y + 6;

test.describe('Open now draws This window first (KAN-472)', () => {
  test('1. This window draws first as Window 4; the rest follow in Chrome order', async ({
    context,
    serviceWorker,
    extensionId,
  }) => {
    const s = await stage(context, serviceWorker, extensionId);
    expect(await drawnWindowIds(s.page)).toEqual([
      s.self,
      s.launch,
      s.second,
      s.third,
    ]);
    const blocks = s.page.locator(BLOCK);
    await expect(blocks.nth(0).locator('[data-window-row]')).toHaveText(
      /^Window 4\s*This window$/
    );
    await expect(blocks.nth(1).locator('[data-window-row]')).toHaveText(
      /^Window 1$/
    );
    await expect(blocks.nth(3).locator('[data-window-row]')).toHaveText(
      /^Window 3$/
    );
  });

  test('2. under a search This window stays first among the matches', async ({
    context,
    serviceWorker,
    extensionId,
  }) => {
    const s = await stage(context, serviceWorker, extensionId);
    // "re" matches Quarterly report (This window) and Pull request (Window 3).
    await s.page.getByPlaceholder('Search open tabs').fill('re');
    await expect(s.page.locator(BLOCK)).toHaveCount(2);
    expect(await drawnWindowIds(s.page)).toEqual([s.self, s.third]);
    await expect(
      s.page.locator(BLOCK).nth(0).locator('[data-window-row]')
    ).toHaveText(/^Window 4\s*This window$/);
  });

  test('3. a tab dropped on the top row lands first in This window', async ({
    context,
    serviceWorker,
    extensionId,
  }) => {
    const s = await stage(context, serviceWorker, extensionId);
    const hotel = s.tab('Hotel booking');
    const report = s.tab('Quarterly report');
    // PREMISE: This window's first drawn row is Quarterly report.
    expect(await shownOrder(s.page, s.self)).toEqual([
      report,
      s.tab('Budget sheet'),
    ]);
    await dragTab(s.page, hotel, () => justInside(s.page, report));
    await expect.poll(() => windowOf(serviceWorker, hotel)).toBe(s.self);
    await expect
      .poll(() => shownOrder(s.page, s.self))
      .toEqual([hotel, report, s.tab('Budget sheet')]);
  });

  test('4. a tab dragged out of This window lands where it was aimed in Window 3', async ({
    context,
    serviceWorker,
    extensionId,
  }) => {
    const s = await stage(context, serviceWorker, extensionId);
    const budget = s.tab('Budget sheet');
    const ci = s.tab('CI run');
    await dragTab(s.page, budget, () => justInside(s.page, ci));
    await expect.poll(() => windowOf(serviceWorker, budget)).toBe(s.third);
    await expect
      .poll(() => shownOrder(s.page, s.third))
      .toEqual([s.tab('Pull request'), budget, ci]);
  });

  test('5. released above This window, nothing moves', async ({
    context,
    serviceWorker,
    extensionId,
  }) => {
    const s = await stage(context, serviceWorker, extensionId);
    const hotel = s.tab('Hotel booking');
    const search = s.page.getByPlaceholder('Search open tabs');
    await dragTab(s.page, hotel, async () => {
      const box = await boxOf(search);
      return box.y + box.height / 2;
    });
    // Let any move the release started settle, then require none did.
    await s.page.waitForTimeout(500);
    expect(await windowOf(serviceWorker, hotel)).toBe(s.second);
    expect(await shownOrder(s.page, s.second)).toEqual([
      s.tab('Flight options'),
      hotel,
    ]);
    expect(await shownOrder(s.page, s.self)).toEqual([
      s.tab('Quarterly report'),
      s.tab('Budget sheet'),
    ]);
    // CONTROL: the same drag aimed at This window's top row does move it.
    await dragTab(s.page, hotel, () =>
      justInside(s.page, s.tab('Quarterly report'))
    );
    await expect.poll(() => windowOf(serviceWorker, hotel)).toBe(s.self);
  });
});
