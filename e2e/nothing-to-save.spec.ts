import type { Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { openFullView } from './fixtures/onboarding';

// KAN-522. The real build, with Tab Keeper's tab view the only tab: each save-row action says why it did nothing.

const toast = (page: Page) => page.locator('[role="status"] [data-toast]');

// Every tab but Tab Keeper's own pages, closed from the page itself.
async function closeOtherTabs(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const own = chrome.runtime.getURL('');
    const tabs = await chrome.tabs.query({});
    const others = tabs.filter((t) => !(t.url ?? '').startsWith(own));
    await chrome.tabs.remove(others.flatMap((t) => (t.id ? [t.id] : [])));
  });
}

const openMenuItem = async (page: Page, name: string) => {
  await page.getByRole('button', { name: 'More actions', exact: true }).click();
  await page.getByRole('menuitem', { name, exact: true }).click();
};

test.describe('with only Tab Keeper open', () => {
  test('Save all open windows says there is nothing to save', async ({
    context,
    extensionId,
  }) => {
    const page = await openFullView(context, extensionId);
    await closeOtherTabs(page);
    await page
      .getByRole('button', {
        name: 'Save all open windows as a session',
        exact: true,
      })
      .first()
      .click();
    await expect(toast(page)).toHaveText(
      'No tabs to save. Only Tab Keeper is open.'
    );
  });

  test('Save current window says this window has nothing to save', async ({
    context,
    extensionId,
  }) => {
    const page = await openFullView(context, extensionId);
    await closeOtherTabs(page);
    await openMenuItem(page, 'Save current window as a session');
    await expect(toast(page)).toHaveText(
      'No tabs to save in this window. Only Tab Keeper is open here.'
    );
  });

  test('Save open windows as PDF says so and opens no tab', async ({
    context,
    extensionId,
  }) => {
    const page = await openFullView(context, extensionId);
    await closeOtherTabs(page);
    const before = context.pages().length;
    await openMenuItem(page, 'Save open windows as PDF…');
    await expect(toast(page)).toHaveText(
      'No tabs to save. Only Tab Keeper is open.'
    );
    expect(context.pages()).toHaveLength(before);
  });
});

// CONTROL: the same press with a real tab open still opens the export page.
test('with another tab open, Save open windows as PDF opens the export page', async ({
  context,
  extensionId,
}) => {
  const page = await openFullView(context, extensionId);
  const opened = context.waitForEvent('page');
  await openMenuItem(page, 'Save open windows as PDF…');
  expect((await opened).url()).toContain('export.html?source=open-windows');
  await expect(toast(page)).toHaveCount(0);
});
