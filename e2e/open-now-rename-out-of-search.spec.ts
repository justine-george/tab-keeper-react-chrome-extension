import type { Page, Worker } from '@playwright/test';

import { grantedTest as test, expect } from './fixtures/grantedExtension';
import { seedSettings } from './fixtures/seed';
import { standIn } from './fixtures/standInPages';

// KAN-739. A rename can take a group out of the search. Its title goes on the
// next read, so focus would fall to the page; it moves to the search field.

const OPEN_NOW = '[data-pane="open-now"]';

const liveGroup = (worker: Worker, title: string, names: string[]) =>
  worker.evaluate(
    async ({ urls, title }) => {
      const w = await chrome.windows.create({ focused: false, url: urls });
      const tabs = await chrome.tabs.query({ windowId: w!.id });
      const [first, ...rest] = tabs.map((t) => t.id!);
      const groupId = await chrome.tabs.group({
        tabIds: [first, ...rest],
        createProperties: { windowId: w!.id },
      });
      await chrome.tabGroups.update(Number(groupId), { title });
    },
    { urls: names.map(standIn), title }
  );

async function searchThenRename(page: Page, text: string, from: string) {
  await page.locator(OPEN_NOW).getByRole('textbox').fill(text);
  await page
    .locator(OPEN_NOW)
    .getByRole('button', { name: `Rename group: ${from}`, exact: true })
    .click();
}

const openFullView = async (
  context: import('@playwright/test').BrowserContext,
  extensionId: string
) => {
  await seedSettings(context, { foldSavedSessionInTabView: false });
  const page = await context.newPage();
  await page.setViewportSize({ width: 1400, height: 800 });
  await page.goto(`chrome-extension://${extensionId}/index.html?view=tab`);
  return page;
};

const field = (page: Page) => page.locator(OPEN_NOW).getByRole('textbox');
const title = (page: Page, name: string) =>
  page
    .locator(OPEN_NOW)
    .getByRole('button', { name: `Rename group: ${name}`, exact: true });

test('Enter renames the group out of the search: focus moves to the field', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  await liveGroup(serviceWorker, 'Kyoto trip', ['Temple', 'Bus']);
  const page = await openFullView(context, extensionId);
  await searchThenRename(page, 'trip', 'Kyoto trip');
  await page.locator('input:focus').fill('Kyoto');
  await page.keyboard.press('Enter');
  await expect(page.locator(OPEN_NOW)).toContainText('trip');
  await expect(title(page, 'Kyoto')).toHaveCount(0);
  await expect(field(page)).toBeFocused();
});

test('the tick does the same', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  await liveGroup(serviceWorker, 'Kyoto trip', ['Temple', 'Bus']);
  const page = await openFullView(context, extensionId);
  await searchThenRename(page, 'trip', 'Kyoto trip');
  await page.locator('input:focus').fill('Kyoto');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(title(page, 'Kyoto')).toHaveCount(0);
  await expect(field(page)).toBeFocused();
});

test('another match in the same search stays drawn, and focus still moves', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  await liveGroup(serviceWorker, 'Kyoto trip', ['Temple', 'Bus']);
  await liveGroup(serviceWorker, 'Osaka trip', ['Castle', 'Market']);
  const page = await openFullView(context, extensionId);
  await searchThenRename(page, 'trip', 'Kyoto trip');
  await page.locator('input:focus').fill('Kyoto');
  await page.keyboard.press('Enter');
  await expect(title(page, 'Kyoto')).toHaveCount(0);
  await expect(title(page, 'Osaka trip')).toBeVisible();
  await expect(field(page)).toBeFocused();
});

test('CONTROL: a rename that still matches keeps focus on the title', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  await liveGroup(serviceWorker, 'Kyoto trip', ['Temple', 'Bus']);
  const page = await openFullView(context, extensionId);
  await searchThenRename(page, 'trip', 'Kyoto trip');
  await page.locator('input:focus').fill('Kansai trip');
  await page.keyboard.press('Enter');
  await expect(title(page, 'Kansai trip')).toBeFocused();
  await page.waitForTimeout(600);
  await expect(title(page, 'Kansai trip')).toBeFocused();
});

test('Escape leaves the group and keeps focus on the title', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  await liveGroup(serviceWorker, 'Kyoto trip', ['Temple', 'Bus']);
  const page = await openFullView(context, extensionId);
  await searchThenRename(page, 'trip', 'Kyoto trip');
  await page.locator('input:focus').fill('Kyoto');
  await page.keyboard.press('Escape');
  await expect(title(page, 'Kyoto trip')).toBeFocused();
});

test('a rename ended by clicking elsewhere does not pull focus to the field', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  await liveGroup(serviceWorker, 'Kyoto trip', ['Temple', 'Bus']);
  const page = await openFullView(context, extensionId);
  await searchThenRename(page, 'trip', 'Kyoto trip');
  await page.locator('input:focus').fill('Kyoto');
  await page.mouse.click(2, 400);
  await expect(title(page, 'Kyoto')).toHaveCount(0);
  await page.waitForTimeout(600);
  await expect(field(page)).not.toBeFocused();
});
