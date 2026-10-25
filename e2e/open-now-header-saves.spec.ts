import type { Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { seedSessions, seedSettings } from './fixtures/seed';
import { FULL, FULL_VIEW_PATH, openPage } from './fixtures/onboarding';
import { standIn } from './fixtures/standInPages';

// KAN-774 (his pick A). Open now's header offers all three saves, and the same
// three in words on a right-click or the menu keys anywhere on the header.
// KAN-780: Save current window is a button of its own; the header's ⋮ is gone.

const ITEMS = [
  'Save all open windows as a session',
  'Save current window as a session',
  'Save open windows as PDF…',
];

test.beforeEach(async ({ context, serviceWorker }) => {
  await seedSettings(context, {});
  await seedSessions(context);
  // This window gets two tabs of its own; a second window gets one.
  await serviceWorker.evaluate(
    async (urls) => {
      const [w] = await chrome.windows.getAll({ windowTypes: ['normal'] });
      for (const url of urls.slice(0, 2))
        await chrome.tabs.create({ windowId: w.id, url, active: false });
      await chrome.windows.create({ url: urls[2], focused: false });
    },
    [standIn('Q4 roadmap'), standIn('KAN board'), standIn('Ryokan near Gion')]
  );
});

async function openFullView(
  context: Parameters<typeof openPage>[0],
  extensionId: string
): Promise<Page> {
  const page = await openPage(context, extensionId, FULL_VIEW_PATH, FULL);
  await expect(
    header(page).getByText('2 Windows', { exact: false })
  ).toBeVisible();
  return page;
}

const header = (page: Page) => page.locator('[data-open-now-header]');
const menuItems = (page: Page) => page.getByRole('menu').getByRole('menuitem');
// Each item's text starts with its glyph's ligature name.
const ITEM_TEXTS = ITEMS.map(
  (label) => new RegExp(`${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`)
);

test('right-clicking the header opens the three saves; Esc closes it', async ({
  context,
  extensionId,
}) => {
  const page = await openFullView(context, extensionId);

  await header(page).getByRole('heading', { name: 'Currently open' }).click({
    button: 'right',
  });

  await expect(menuItems(page)).toHaveText(ITEM_TEXTS);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
});

test('Shift+F10 on a header control opens the same menu', async ({
  context,
  extensionId,
}) => {
  const page = await openFullView(context, extensionId);
  await header(page)
    .getByRole('button', { name: 'Save all open windows as a session' })
    .focus();

  await page.keyboard.press('Shift+F10');

  await expect(menuItems(page)).toHaveText(ITEM_TEXTS);
});

test('right-clicking the search field opens no Tab Keeper menu', async ({
  context,
  extensionId,
}) => {
  const page = await openFullView(context, extensionId);

  await page
    .getByRole('textbox', { name: /Search open tabs/i })
    .click({ button: 'right' });

  await expect(page.getByRole('menu')).toHaveCount(0);
});

test("the header has no ⋮, and its Save current window saves This window's tabs alone", async ({
  context,
  extensionId,
}) => {
  const page = await openFullView(context, extensionId);
  await expect(
    header(page).getByRole('button', { name: 'More actions' })
  ).toHaveCount(0);

  await header(page)
    .getByRole('button', { name: 'Save current window as a session' })
    .click();

  await expect(
    page.getByText('Current window saved as a session.')
  ).toBeVisible();
  // The new session: one window, This window's tabs, none of the other window's.
  const titles = await page.evaluate(() => {
    const data = JSON.parse(localStorage.getItem('tabContainerData') ?? '{}');
    const session = data.tabGroups.find(
      (s: { tabGroupId: string }) => s.tabGroupId === data.selectedTabGroupId
    );
    return session.windows.map((w: { tabs: { title: string }[] }) =>
      w.tabs.map((tab) => tab.title)
    );
  });
  expect(titles).toHaveLength(1);
  expect(titles[0]).toEqual(
    expect.arrayContaining(['Q4 roadmap', 'KAN board'])
  );
  expect(titles[0]).not.toContain('Ryokan near Gion');
});

test('the PDF icon opens the export of every open window', async ({
  context,
  extensionId,
}) => {
  const page = await openFullView(context, extensionId);

  const [exportPage] = await Promise.all([
    context.waitForEvent('page'),
    header(page)
      .getByRole('button', { name: 'Save open windows as PDF…' })
      .click(),
  ]);

  await expect(exportPage).toHaveURL(/export\.html\?source=open-windows/);
});
