import type { Locator, Page, Worker } from '@playwright/test';

import { test, expect } from './fixtures/extension';

// KAN-475 on the real artifact: in This window, whose active tab is the tab
// view itself (not listed), the tab you came from wears the active tab's bar
// and reads "Last used tab". What jsdom cannot show: the worker's real record
// of tabs.onActivated, chrome.storage.session.onChanged reaching the page,
// and the bar's ::before as Chrome computes it.

const VIEWPORT = { width: 1280, height: 800 };
const VIEW_TAB = 'index.html?view=tab';

const dataUrl = (title: string) =>
  `data:text/html,${encodeURIComponent(`<title>${title}</title>`)}`;

const switchRow = (page: Page, title: string): Locator =>
  page.getByRole('button', { name: `Switch to tab: ${title}`, exact: true });

// The bar is the row's ::before: its width and fill, or null when none.
const barOf = (page: Page, tabId: number) =>
  page.evaluate((id) => {
    const row = document.querySelector(`[data-open-tab-id="${id}"]`);
    if (row === null) return null;
    const before = getComputedStyle(row, '::before');
    return before.content === 'none'
      ? null
      : { width: before.width, fill: before.backgroundColor };
  }, tabId);

const activate = (worker: Worker, tabId: number) =>
  worker.evaluate(async (id) => {
    await chrome.tabs.update(id, { active: true });
  }, tabId);

test.describe('Open now marks the tab This window came from (KAN-475)', () => {
  test('the tab you switched away from wears the active bar, reads Last used tab, and follows the next switch', async ({
    context,
    serviceWorker,
    extensionId,
  }) => {
    const page = await context.newPage();
    await page.setViewportSize(VIEWPORT);
    await page.goto(`chrome-extension://${extensionId}/${VIEW_TAB}`);
    await page.getByRole('button', { name: 'Sort sessions' }).waitFor();

    const view = await page.evaluate(async () => {
      const tab = await chrome.tabs.getCurrent();
      return tab?.id === undefined
        ? null
        : { id: tab.id, windowId: tab.windowId };
    });
    if (view === null) throw new Error('the tab view is not a tab');
    const ids = await serviceWorker.evaluate(
      async ({ view, mine, other }) => {
        const made: number[] = [];
        for (const url of mine.urls) {
          const tab = await chrome.tabs.create({
            windowId: view.windowId,
            url,
            active: false,
          });
          made.push(tab.id ?? -1);
        }
        const win = await chrome.windows.create({ focused: false, url: other });
        return {
          view: view.id,
          report: made[0] ?? -1,
          budget: made[1] ?? -1,
          alpha: win?.tabs?.[0]?.id ?? -1,
        };
      },
      {
        view,
        mine: {
          urls: [dataUrl('Quarterly report'), dataUrl('Budget sheet')],
        },
        other: dataUrl('Alpha'),
      }
    );
    if (Object.values(ids).includes(-1)) {
      throw new Error('Chrome gave no tab ids');
    }

    // Away to Budget sheet, then back to the tab view, as a user would.
    await activate(serviceWorker, ids.budget);
    await activate(serviceWorker, ids.view);

    await expect(switchRow(page, 'Budget sheet')).toHaveAccessibleDescription(
      'Last used tab'
    );
    // CONTROL: Alpha is its window's real active tab, so it has the bar.
    const activeBar = await barOf(page, ids.alpha);
    expect(activeBar).toEqual({ width: '3px', fill: expect.any(String) });
    await expect.poll(() => barOf(page, ids.budget)).toEqual(activeBar);
    expect(await barOf(page, ids.report)).toBeNull();
    await expect(switchRow(page, 'Budget sheet')).not.toHaveAttribute(
      'aria-current'
    );
    await expect(switchRow(page, 'Alpha')).toHaveAttribute(
      'aria-current',
      'true'
    );

    // Away to Quarterly report and back: the mark moves, with no reload.
    await activate(serviceWorker, ids.report);
    await activate(serviceWorker, ids.view);
    await expect(
      switchRow(page, 'Quarterly report')
    ).toHaveAccessibleDescription('Last used tab');
    await expect.poll(() => barOf(page, ids.report)).toEqual(activeBar);
    expect(await barOf(page, ids.budget)).toBeNull();
    await expect(page.getByText('Last used tab', { exact: true })).toHaveCount(
      1
    );
  });
});
