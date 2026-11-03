import type { BrowserContext, Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { buildContainer, buildSession, seedSessions } from './fixtures/seed';

// KAN-917. While a session is renamed in the header, its row in the list shows
// the name as it would be saved. The save itself still happens once, on
// commit: one undo step takes the whole rename back.

const tab = (title: string) => ({
  tabId: title,
  favicon: '',
  title,
  url: `https://${title.toLowerCase().replace(/\W+/g, '-')}.test/`,
});

async function open(context: BrowserContext, extensionId: string) {
  await seedSessions(
    context,
    buildContainer([
      buildSession({
        tabGroupId: 'live',
        title: 'Live notes',
        isSelected: true,
        tabCount: 2,
        windowCount: 1,
        windows: [
          {
            windowId: 'w1',
            windowHeight: 900,
            windowWidth: 1400,
            windowOffsetTop: 0,
            windowOffsetLeft: 0,
            tabCount: 2,
            title: 'Window 1',
            tabs: [tab('Kyoto map'), tab('Train times')],
          },
        ],
      }),
      buildSession({
        tabGroupId: 'groc',
        title: 'Groceries',
        tabCount: 1,
        windowCount: 1,
        windows: [
          {
            windowId: 'w2',
            windowHeight: 900,
            windowWidth: 1400,
            windowOffsetTop: 0,
            windowOffsetLeft: 0,
            tabCount: 1,
            title: 'Window 1',
            tabs: [tab('Market')],
          },
        ],
      }),
    ])
  );
  const page = await context.newPage();
  await page.setViewportSize({ width: 790, height: 550 });
  await page.goto(`chrome-extension://${extensionId}/index.html`);
  await page
    .getByRole('button', { name: 'Rename session: Live notes' })
    .click();
  return page;
}

const field = (page: Page) => page.locator('[data-panel="session-card"] input');
const row = (page: Page, name: string) =>
  page.getByRole('button', { name, exact: true });

test('the row follows the typing, and Enter saves it as one undo step', async ({
  context,
  extensionId,
}) => {
  const page = await open(context, extensionId);
  await field(page).press('End');
  await field(page).pressSequentially(' for Friday');
  await expect(row(page, 'Live notes for Friday')).toBeVisible();
  await expect(row(page, 'Groceries')).toBeVisible();

  await field(page).press('Enter');
  await expect(row(page, 'Live notes for Friday')).toBeVisible();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(row(page, 'Live notes')).toBeVisible();
  await expect(row(page, 'Live notes for Friday')).toHaveCount(0);
});

test('Esc puts the row back to the saved name', async ({
  context,
  extensionId,
}) => {
  const page = await open(context, extensionId);
  await field(page).press('End');
  await field(page).pressSequentially(' for Friday');
  await expect(row(page, 'Live notes for Friday')).toBeVisible();
  await field(page).press('Escape');
  await expect(row(page, 'Live notes')).toBeVisible();
  await expect(row(page, 'Live notes for Friday')).toHaveCount(0);
});

test('with the field cleared, the row keeps the saved name', async ({
  context,
  extensionId,
}) => {
  const page = await open(context, extensionId);
  await field(page).fill('');
  await expect(row(page, 'Live notes')).toBeVisible();
});
