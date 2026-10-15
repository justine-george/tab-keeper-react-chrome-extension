import type { Locator, Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { buildContainer, buildSession, seedSessions } from './fixtures/seed';
import { sessionHeaderMenu } from './fixtures/menus';
import { POPUP, stored } from './fixtures/savedWindows';
import type {
  tabData,
  windowGroupData,
} from '../src/redux/slices/tabContainerDataStateSlice';

// KAN-609 on the real artifact (picks 1A–5A): the session ⋮ offers Remove N
// duplicate tabs while the session holds a repeated address. The first copy in
// reading order stays, an emptied window goes, the toast says how many with
// Undo, and one ⌘Z brings every copy back.

const tab = (tabId: string, url: string): tabData => ({
  tabId,
  favicon: '',
  title: tabId,
  url,
});
const win = (windowId: string, tabs: tabData[]): windowGroupData => ({
  windowId,
  windowHeight: 1080,
  windowWidth: 1920,
  windowOffsetTop: 0,
  windowOffsetLeft: 0,
  tabCount: tabs.length,
  title: windowId,
  tabs,
});
const A = 'https://a.test/';
const B = 'https://b.test/';
const C = 'https://c.test/';

// Planning: a, b, a again. Reading: b again, c. Spare: c again (emptied).
const TRIP = buildSession({
  tabGroupId: 's-trip',
  title: 'Trip',
  windowCount: 3,
  tabCount: 6,
  windows: [
    win('planning', [tab('a1', A), tab('b1', B), tab('a2', A)]),
    win('reading', [tab('b2', B), tab('c1', C)]),
    win('spare', [tab('c2', C)]),
  ],
});

async function openPopup(
  context: Parameters<typeof seedSessions>[0],
  extensionId: string
): Promise<Page> {
  await seedSessions(context, {
    ...buildContainer([TRIP]),
    selectedTabGroupId: 's-trip',
  });
  const page = await context.newPage();
  await page.setViewportSize(POPUP);
  await page.goto(`chrome-extension://${extensionId}/index.html`);
  // Barrier: goto resolves before React mounts. Locale-free.
  await page.locator('[data-tour-anchor="save"]').waitFor();
  return page;
}

const toasts = (page: Page): Locator =>
  page.locator('[role="status"] > [data-toast]:not([aria-hidden="true"])');
const tabIdsByWindow = async (page: Page) =>
  (await stored(page)).tabGroups[0].windows.map((w) =>
    w.tabs.map((t) => t.tabId)
  );

test('Remove 3 duplicate tabs keeps the first copies, and one ⌘Z brings them back', async ({
  context,
  extensionId,
}) => {
  const page = await openPopup(context, extensionId);
  const before = (await stored(page)).tabGroups[0].windows;

  await sessionHeaderMenu(page).click();
  await page.getByRole('menuitem', { name: 'Remove 3 duplicate tabs' }).click();

  await expect.poll(() => tabIdsByWindow(page)).toEqual([['a1', 'b1'], ['c1']]);
  await expect(toasts(page)).toContainText('Removed 3 duplicate tabs.');

  // Nothing left to remove: the item is gone from the menu.
  await sessionHeaderMenu(page).click();
  await expect(
    page.getByRole('menuitem', { name: /^Delete session/ })
  ).toBeVisible();
  await expect(page.getByRole('menuitem', { name: /duplicate/ })).toHaveCount(
    0
  );
  await page.keyboard.press('Escape');

  await page.keyboard.press('ControlOrMeta+z');
  await expect
    .poll(async () => (await stored(page)).tabGroups[0].windows)
    .toEqual(before);
});

test('the toast’s Undo brings them back too', async ({
  context,
  extensionId,
}) => {
  const page = await openPopup(context, extensionId);
  await sessionHeaderMenu(page).click();
  await page.getByRole('menuitem', { name: 'Remove 3 duplicate tabs' }).click();
  await expect.poll(() => tabIdsByWindow(page)).toEqual([['a1', 'b1'], ['c1']]);

  await page
    .getByRole('status')
    .getByRole('button', { name: 'Undo', exact: true })
    .click();

  await expect
    .poll(() => tabIdsByWindow(page))
    .toEqual([['a1', 'b1', 'a2'], ['b2', 'c1'], ['c2']]);
});
