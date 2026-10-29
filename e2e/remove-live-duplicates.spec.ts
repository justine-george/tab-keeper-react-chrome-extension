import type { BrowserContext, Locator, Page, Worker } from '@playwright/test';

import { grantedTest as test, expect } from './fixtures/grantedExtension';
import { openLiveWindow, strip } from './fixtures/liveWindows';

// KAN-867 on the real artifact. Currently open's Remove duplicate tabs closes
// the extra copies in each window (the copy in front stays), and one Reopen
// puts every one back: same window, place and group, its name and colour too.

const OPEN_NOW = '[data-pane="open-now"]';

async function openTabView(
  context: BrowserContext,
  extensionId: string
): Promise<Page> {
  const page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`chrome-extension://${extensionId}/index.html?view=tab`);
  await page
    .getByRole('button', { name: 'Sort sessions', exact: true })
    .waitFor();
  return page;
}

// Window A: Docs (in front), Mail, then Docs and Docs in a group "Research",
// which the close empties. Window B: News twice. The same Docs in B would be no copy.
async function liveWindows(worker: Worker) {
  const a = await openLiveWindow(worker, ['Docs', 'Mail', 'Docs', 'Docs']);
  const b = await openLiveWindow(worker, ['News', 'News', 'Docs']);
  const tabIds = (await strip(worker, a.windowId)).map((t) => t.id);
  await worker.evaluate(
    async ({ ids, windowId }) => {
      const g = await chrome.tabs.group({
        tabIds: [ids[2], ids[3]],
        createProperties: { windowId },
      });
      await chrome.tabGroups.update(g, { title: 'Research', color: 'red' });
    },
    { ids: tabIds, windowId: a.windowId }
  );
  return { a: a.windowId, b: b.windowId };
}

// A window as Chrome has it: each tab's page title, and its group's name/colour.
const shape = (worker: Worker, windowId: number) =>
  worker.evaluate(async (id: number) => {
    const tabs = (await chrome.tabs.query({ windowId: id })).sort(
      (x, y) => x.index - y.index
    );
    const groups = new Map(
      (await chrome.tabGroups.query({ windowId: id })).map((g) => [
        g.id,
        `${g.title}/${g.color}`,
      ])
    );
    return tabs.map(
      (t) =>
        `${/<title>(.*?)<\/title>/.exec(decodeURIComponent(t.pendingUrl || t.url || ''))?.[1] ?? ''}${
          groups.has(t.groupId) ? `[${groups.get(t.groupId)}]` : ''
        }`
    );
  }, windowId);

const block = (page: Page, windowId: number): Locator =>
  page.locator(`${OPEN_NOW} [data-open-window-id="${windowId}"]`);
const toast = (page: Page) =>
  page.locator('[role="status"] > [data-toast]:not([aria-hidden="true"])');

test("the header right-click closes every window's copies; Reopen puts them all back", async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  const { a, b } = await liveWindows(serviceWorker);
  const page = await openTabView(context, extensionId);
  await expect(block(page, a)).toBeVisible();
  const beforeA = await shape(serviceWorker, a);
  const beforeB = await shape(serviceWorker, b);
  // PREMISE: the Research group holds the two later Docs.
  expect(beforeA).toEqual([
    'Docs',
    'Mail',
    'Docs[Research/red]',
    'Docs[Research/red]',
  ]);

  await page
    .locator('[data-open-now-header]')
    .getByRole('heading', { name: 'Currently open' })
    .click({ button: 'right' });
  const items = page.getByRole('menuitem');
  await expect(items.last()).toHaveAccessibleName('Remove 3 duplicate tabs');
  await items.last().click();

  await expect.poll(() => shape(serviceWorker, a)).toEqual(['Docs', 'Mail']);
  await expect.poll(() => shape(serviceWorker, b)).toEqual(['News', 'Docs']);
  await expect(toast(page)).toContainText('Closed 3 duplicate tabs.');

  await toast(page).getByRole('button', { name: 'Reopen' }).click();
  await expect.poll(() => shape(serviceWorker, a)).toEqual(beforeA);
  await expect.poll(() => shape(serviceWorker, b)).toEqual(beforeB);
  // One Research group again, not one per copy.
  expect(
    await serviceWorker.evaluate(
      async (id: number) =>
        (await chrome.tabGroups.query({ windowId: id })).length,
      a
    )
  ).toBe(1);
});

test("a window ⋮ closes that window's copies only", async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  const { a, b } = await liveWindows(serviceWorker);
  const page = await openTabView(context, extensionId);
  const beforeA = await shape(serviceWorker, a);

  await block(page, b).locator('[data-window-row]').hover();
  await block(page, b)
    .locator('[data-window-row] [data-row-actions]')
    .getByRole('button', { name: /^More actions: Window \d+$/ })
    .click();
  const items = page.getByRole('menuitem');
  const names = await items.evaluateAll((all) =>
    all.map((i) => i.getAttribute('data-menu-item'))
  );
  expect(names.slice(-2)).toEqual(['duplicates', 'closeWindow']);
  await page
    .getByRole('menuitem', { name: 'Remove 1 duplicate tab', exact: true })
    .click();

  await expect.poll(() => shape(serviceWorker, b)).toEqual(['News', 'Docs']);
  expect(await shape(serviceWorker, a)).toEqual(beforeA);
  await expect(toast(page)).toContainText('Closed 1 duplicate tab.');
});
