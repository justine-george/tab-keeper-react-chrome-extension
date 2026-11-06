import type { Page, Worker } from '@playwright/test';

import { grantedTest as test, expect } from './fixtures/grantedExtension';
import { standIn } from './fixtures/standInPages';

// KAN-745. A sort never moves a Tab Keeper page, but the moves around it shift it; Undo puts it back.
const OPEN_NOW = '[data-pane="open-now"]';
const onSite = (name: string, site: string) => {
  const url = new URL(standIn(name));
  url.hostname = `${site}.localhost`;
  return url.href;
};

async function openWindow(worker: Worker, extensionId: string) {
  const urls = [
    onSite('b1', 'bb'),
    onSite('a1', 'aa'),
    `chrome-extension://${extensionId}/index.html?view=tab`,
    onSite('b2', 'bb'),
    onSite('a2', 'aa'),
    onSite('c1', 'cc'),
  ];
  return worker.evaluate(
    async (urls) =>
      (await chrome.windows.create({ focused: false, url: urls }))?.id ?? -1,
    urls
  );
}

const strip = (worker: Worker, windowId: number) =>
  worker.evaluate(
    async (id) =>
      (await chrome.tabs.query({ windowId: id }))
        .sort((a, b) => a.index - b.index)
        .map((tab) =>
          (tab.url ?? tab.pendingUrl ?? '').startsWith('chrome-extension')
            ? 'TK'
            : (tab.url ?? tab.pendingUrl ?? '').slice(7, 9)
        ),
    windowId
  );

async function sortLastWindow(page: Page) {
  const row = page.locator(`${OPEN_NOW} [data-window-row]`).last();
  await row.hover();
  await row
    .locator('[data-row-actions]')
    .getByRole('button', { name: /^More actions: / })
    .click();
  await page
    .getByRole('menuitem', { name: 'Sort tabs by site', exact: true })
    .click();
}

const BEFORE = ['bb', 'aa', 'TK', 'bb', 'aa', 'cc'];

test('Undo puts a Tab Keeper page back in its slot', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  const windowId = await openWindow(serviceWorker, extensionId);
  await expect.poll(() => strip(serviceWorker, windowId)).toEqual(BEFORE);
  const page = await context.newPage();
  await page.setViewportSize({ width: 1400, height: 800 });
  await page.goto(`chrome-extension://${extensionId}/index.html?view=tab`);
  await page.locator(`${OPEN_NOW} [data-window-row]`).last().waitFor();

  await sortLastWindow(page);
  // PREMISE: the sort's moves crossed the page, so it did shift.
  await expect
    .poll(() => strip(serviceWorker, windowId))
    .toEqual(['bb', 'TK', 'bb', 'aa', 'aa', 'cc']);

  await page.keyboard.press('ControlOrMeta+z');

  await expect.poll(() => strip(serviceWorker, windowId)).toEqual(BEFORE);
});

// KAN-926. The same inside a group: `g` marks a group member.
test('Undo after a group sort puts a Tab Keeper page back in its slot', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  const urls = [
    onSite('b1', 'bb'),
    onSite('a1', 'aa'),
    `chrome-extension://${extensionId}/index.html?view=tab`,
    onSite('b2', 'bb'),
    onSite('a2', 'aa'),
    onSite('c1', 'cc'),
  ];
  const windowId = await serviceWorker.evaluate(async (urls) => {
    const w = await chrome.windows.create({ focused: false, url: urls });
    const tabs = (await chrome.tabs.query({ windowId: w!.id })).sort(
      (a, b) => a.index - b.index
    );
    const [first, ...rest] = tabs.slice(0, 5).map((tab) => tab.id!);
    const groupId = await chrome.tabs.group({
      tabIds: [first, ...rest],
      createProperties: { windowId: w!.id },
    });
    await chrome.tabGroups.update(groupId, { title: 'Trip' });
    return w!.id!;
  }, urls);
  const grouped = () =>
    serviceWorker.evaluate(
      async (id) =>
        (await chrome.tabs.query({ windowId: id }))
          .sort((a, b) => a.index - b.index)
          .map(
            (tab) =>
              ((tab.url ?? tab.pendingUrl ?? '').startsWith('chrome-extension')
                ? 'TK'
                : (tab.url ?? tab.pendingUrl ?? '').slice(7, 9)) +
              (tab.groupId === -1 ? '' : 'g')
          ),
      windowId
    );
  const before = ['bbg', 'aag', 'TKg', 'bbg', 'aag', 'cc'];
  await expect.poll(grouped).toEqual(before);
  const page = await context.newPage();
  await page.setViewportSize({ width: 1400, height: 800 });
  await page.goto(`chrome-extension://${extensionId}/index.html?view=tab`);
  const more = page
    .locator(OPEN_NOW)
    .getByRole('button', { name: 'More actions: Trip', exact: true });
  await more.waitFor({ state: 'attached' });
  await more.click({ force: true });
  await page
    .getByRole('menuitem', { name: 'Sort tabs by site', exact: true })
    .click();
  // PREMISE: the sort's moves crossed the page, so it did shift.
  await expect.poll(grouped).toEqual(['bbg', 'TKg', 'bbg', 'aag', 'aag', 'cc']);

  await page.keyboard.press('ControlOrMeta+z');

  await expect.poll(grouped).toEqual(before);
});
