import type { BrowserContext, Page, Worker } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { FULL, FULL_VIEW_PATH } from './fixtures/onboarding';
import { standIn } from './fixtures/standInPages';
import {
  buildContainer,
  buildSession,
  seedSessions,
  seedSettings,
} from './fixtures/seed';

// KAN-886. In a window holding only Tab Keeper, Add current window dims, says
// why, and follows the window's tabs; the row menu leaves Add out. Back to your
// tab, dimmed with nowhere to go, says why too.
const ADD = 'Add current window';
const NOTHING = 'Nothing to add: only Tab Keeper is open in this window';

async function seed(context: BrowserContext) {
  await seedSettings(context, {
    isNeverAskAgainForTabGroups: true,
    isNeverAskAgainToRate: true,
  });
  await seedSessions(context, {
    ...buildContainer([
      buildSession({
        tabGroupId: 's0',
        title: 'Porto weekend',
        isSelected: true,
      }),
    ]),
    selectedTabGroupId: 's0',
  });
}

// A new window whose only tab is this extension page.
async function openAlone(
  context: BrowserContext,
  worker: Worker,
  extensionId: string,
  path: string
): Promise<{ page: Page; windowId: number }> {
  const url = `chrome-extension://${extensionId}/${path}`;
  const [page, windowId] = await Promise.all([
    context.waitForEvent('page', (p) => p.url() === url),
    worker.evaluate(async (address) => {
      const w = await chrome.windows.create({ url: address, focused: true });
      if (w?.id === undefined) throw new Error('no window id');
      return w.id;
    }, url),
  ]);
  await page.setViewportSize(FULL);
  await page.locator('[aria-label="Sort sessions"]').first().waitFor();
  // The full view opens on Currently open; the chip is on the session card.
  if (path === FULL_VIEW_PATH)
    await page.getByRole('button', { name: 'Show the saved session' }).click();
  return { page, windowId };
}

const tabsIn = (worker: Worker, windowId: number) =>
  worker.evaluate(
    async (id) => (await chrome.tabs.query({ windowId: id })).length,
    windowId
  );

test('full view alone in its window: the chip is dimmed and says why', async ({
  context,
  serviceWorker,
  extensionId,
}) => {
  await seed(context);
  const { page, windowId } = await openAlone(
    context,
    serviceWorker,
    extensionId,
    FULL_VIEW_PATH
  );
  // CONTROL: the window really holds only Tab Keeper.
  expect(await tabsIn(serviceWorker, windowId)).toBe(1);

  const add = page.getByRole('button', { name: ADD });
  await expect(add).toHaveAttribute('aria-disabled', 'true');
  await expect(add).toHaveAttribute('aria-description', NOTHING);
  await add.hover();
  await expect(page.locator('[data-tooltip-chip]')).toHaveText(NOTHING);

  // Forced: Playwright waits for an aria-disabled control to enable, and this checks a press does nothing.
  await add.click({ force: true });
  await add.press('Enter');
  await page.waitForTimeout(300);
  // Still the one window it was seeded with.
  await expect(
    page
      .locator('[data-session-column]')
      .getByRole('button', { name: /^Porto weekend/ })
  ).toContainText('1 Window');
});

test('a tab opened in that window in the background turns it on; closing it dims it again', async ({
  context,
  serviceWorker,
  extensionId,
}) => {
  await seed(context);
  const { page, windowId } = await openAlone(
    context,
    serviceWorker,
    extensionId,
    FULL_VIEW_PATH
  );
  const add = page.getByRole('button', { name: ADD });
  await expect(add).toHaveAttribute('aria-disabled', 'true');

  const tabId = await serviceWorker.evaluate(
    async ({ id, address }) =>
      (await chrome.tabs.create({ windowId: id, url: address, active: false }))
        .id,
    { id: windowId, address: standIn('Background page') }
  );
  await expect(add).not.toHaveAttribute('aria-disabled');
  await add.hover();
  await expect(page.locator('[data-tooltip-chip]')).toHaveText(
    'Add current window to this session'
  );

  await serviceWorker.evaluate((id) => chrome.tabs.remove(id!), tabId);
  await expect(add).toHaveAttribute('aria-disabled', 'true');
});

test('the row right-click menu leaves Add current window out while dimmed', async ({
  context,
  serviceWorker,
  extensionId,
}) => {
  await seed(context);
  const { page } = await openAlone(
    context,
    serviceWorker,
    extensionId,
    FULL_VIEW_PATH
  );
  await expect(page.getByRole('button', { name: ADD })).toHaveAttribute(
    'aria-disabled',
    'true'
  );
  await page
    .locator('[data-session-column]')
    .getByRole('button', { name: /^Porto weekend/ })
    .click({ button: 'right' });
  const menu = page.locator('[data-row-menu]');
  await expect(menu.getByRole('menuitem').first()).toBeVisible();
  await expect(
    menu.getByRole('menuitem', { name: 'Add current window to this session' })
  ).toHaveCount(0);
});

test('a second Tab Keeper page in the same window: still dimmed', async ({
  context,
  serviceWorker,
  extensionId,
}) => {
  await seed(context);
  const { windowId } = await openAlone(
    context,
    serviceWorker,
    extensionId,
    FULL_VIEW_PATH
  );
  const popupUrl = `chrome-extension://${extensionId}/index.html`;
  const [popup] = await Promise.all([
    context.waitForEvent('page', (p) => p.url() === popupUrl),
    serviceWorker.evaluate(
      async ({ id, address }) =>
        chrome.tabs.create({ windowId: id, url: address, active: true }),
      { id: windowId, address: popupUrl }
    ),
  ]);
  await popup.locator('[aria-label="Sort sessions"]').first().waitFor();
  // CONTROL: two Tab Keeper pages and nothing else.
  expect(await tabsIn(serviceWorker, windowId)).toBe(2);
  await expect(popup.getByRole('button', { name: ADD })).toHaveAttribute(
    'aria-disabled',
    'true'
  );
});

test('Back to your tab, dimmed with nowhere to go, shows why on hover', async ({
  context,
  serviceWorker,
  extensionId,
}) => {
  await seed(context);
  const url = `chrome-extension://${extensionId}/${FULL_VIEW_PATH}`;
  const [page] = await Promise.all([
    context.waitForEvent('page', (p) => p.url() === url),
    serviceWorker.evaluate(
      (address) => chrome.windows.create({ url: address, focused: true }),
      url
    ),
  ]);
  await page.setViewportSize(FULL);
  // Currently open's chip: its own label hid the plain tooltip, so the reason is the only one it shows.
  const back = page.getByRole('button', { name: 'Back to your tab' }).last();
  await expect(back).toHaveAttribute('aria-disabled', 'true');
  await back.hover();
  await expect(page.locator('[data-tooltip-chip]')).toHaveText(
    'Nowhere to go back to: only Tab Keeper is open in this window'
  );
});
