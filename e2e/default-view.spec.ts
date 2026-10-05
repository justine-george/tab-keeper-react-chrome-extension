import type { BrowserContext, Page, Worker } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { buildContainer, seedSessions, seedSettings } from './fixtures/seed';
import {
  FULL,
  FULL_VIEW_PATH,
  POPUP,
  THEMES,
  openPage,
  pageGround,
  storedSettings,
} from './fixtures/onboarding';
import { expectReadable } from './fixtures/textContrast';

// KAN-7 §7. Default view on the real build: the page applies setPopup and
// mirrors the choice; the worker's onClicked opens or focuses the full view.

async function openSessionsSettings(
  context: BrowserContext,
  extensionId: string,
  path = 'index.html',
  viewport = POPUP
): Promise<Page> {
  const page = await openPage(context, extensionId, path, viewport);
  await page.locator('[aria-label="Settings"]').click();
  await page.locator('button[aria-label="Sessions"]').click();
  await expect(
    page.getByRole('group', { name: 'Default view', exact: true })
  ).toBeVisible();
  return page;
}

const side = (page: Page, name: 'Compact view' | 'Full view') =>
  page
    .getByRole('group', { name: 'Default view', exact: true })
    .getByRole('button', { name, exact: true });

const popupOf = (worker: Worker) =>
  worker.evaluate(() => chrome.action.getPopup({}));
const mirrored = (worker: Worker) =>
  worker.evaluate(
    async () => (await chrome.storage.local.get('defaultView')).defaultView
  );
const fullViewTabs = (worker: Worker) =>
  worker.evaluate(
    async () =>
      (
        await chrome.tabs.query({
          url: `${chrome.runtime.getURL('index.html?view=tab')}*`,
        })
      ).length
  );
const activeUrl = (worker: Worker) =>
  worker.evaluate(
    async () =>
      (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0]
        ?.url ?? ''
  );
const clickToolbar = (worker: Worker, windowId: number) =>
  worker.evaluate(async (id) => {
    const handler: unknown = Reflect.get(globalThis, 'tabKeeperToolbarClick');
    if (typeof handler !== 'function')
      throw new Error('no tabKeeperToolbarClick');
    await handler({ windowId: id });
  }, windowId);

test('the worker listens for the toolbar click and for every start', async ({
  serviceWorker,
}) => {
  expect(
    await serviceWorker.evaluate(() => ({
      onClicked: chrome.action.onClicked.hasListeners(),
      onStartup: chrome.runtime.onStartup.hasListeners(),
      onInstalled: chrome.runtime.onInstalled.hasListeners(),
    }))
  ).toEqual({ onClicked: true, onStartup: true, onInstalled: true });
});

test('Full removes the popup and mirrors the choice; Compact puts it back', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  await seedSessions(context, buildContainer());
  const page = await openSessionsSettings(context, extensionId);
  await expect(side(page, 'Compact view')).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  // CONTROL: the manifest's popup until a choice is made.
  expect(await popupOf(serviceWorker)).toMatch(/\/index\.html$/);

  await side(page, 'Full view').click();
  await expect.poll(() => popupOf(serviceWorker)).toBe('');
  expect(await mirrored(serviceWorker)).toBe('full');
  expect((await storedSettings(page)).defaultView).toBe('full');

  await side(page, 'Compact view').click();
  await expect.poll(() => popupOf(serviceWorker)).toMatch(/\/index\.html$/);
  expect(await mirrored(serviceWorker)).toBe('compact');
});

test('choosing Compact from the full view leaves the full view open', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  const page = await openSessionsSettings(
    context,
    extensionId,
    FULL_VIEW_PATH,
    FULL
  );
  await side(page, 'Full view').click();
  await expect.poll(() => popupOf(serviceWorker)).toBe('');
  await side(page, 'Compact view').click();
  await expect.poll(() => popupOf(serviceWorker)).toMatch(/\/index\.html$/);
  expect(page.isClosed()).toBe(false);
  expect(await fullViewTabs(serviceWorker)).toBe(1);
});

test('the toolbar click opens one full view, and a second click focuses it', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  const page = await openSessionsSettings(context, extensionId);
  await side(page, 'Full view').click();
  await expect.poll(() => popupOf(serviceWorker)).toBe('');
  const windowId = await page.evaluate(
    async () => (await chrome.windows.getCurrent()).id
  );
  if (windowId === undefined) throw new Error('no window id');
  // CONTROL: none open yet.
  expect(await fullViewTabs(serviceWorker)).toBe(0);

  await clickToolbar(serviceWorker, windowId);
  await expect.poll(() => fullViewTabs(serviceWorker)).toBe(1);

  await page.bringToFront();
  await expect.poll(() => activeUrl(serviceWorker)).not.toContain('view=tab');
  await clickToolbar(serviceWorker, windowId);
  await expect.poll(() => activeUrl(serviceWorker)).toContain('view=tab');
  expect(await fullViewTabs(serviceWorker)).toBe(1);
});

test('two toolbar clicks at once open one full view', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  const page = await openSessionsSettings(context, extensionId);
  await side(page, 'Full view').click();
  await expect.poll(() => popupOf(serviceWorker)).toBe('');
  const windowId = await page.evaluate(
    async () => (await chrome.windows.getCurrent()).id
  );
  if (windowId === undefined) throw new Error('no window id');
  // CONTROL: none open yet.
  expect(await fullViewTabs(serviceWorker)).toBe(0);

  await Promise.all([
    clickToolbar(serviceWorker, windowId),
    clickToolbar(serviceWorker, windowId),
  ]);
  // Both handlers have returned, so no duplicate is still on its way.
  expect(await fullViewTabs(serviceWorker)).toBe(1);
});

for (const [theme, palette] of THEMES) {
  test(`${theme}: the Default view row reads at 4.5:1`, async ({
    context,
    extensionId,
  }) => {
    await seedSettings(context, { theme });
    const page = await openSessionsSettings(context, extensionId);
    expect(await pageGround(page)).toBe(palette.PRIMARY_COLOR);
    await expectReadable(
      page.locator('[data-settings-section]', {
        has: page.getByRole('group', { name: 'Default view', exact: true }),
      }),
      `${theme} Default view`
    );
  });
}
