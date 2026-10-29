import type { Locator, Page } from '@playwright/test';

import { grantedTest as test, expect } from './fixtures/grantedExtension';
import { buildContainer, buildSession, seedSessions } from './fixtures/seed';
import { POPUP, bandHandle, header, stored } from './fixtures/savedWindows';
import type {
  tabData,
  windowGroupData,
} from '../src/redux/slices/tabContainerDataStateSlice';

// KAN-616 on the real artifact (picks 1A, 2A). Every window row's ⋮ holds
// Remove N duplicate tabs while the window repeats an address, then Delete
// window; a group's ⋮ offers it between Ungroup and Delete tab group. Each
// counts only its own tabs. And the window's menu is DRAWN on top: its strip
// is a stacking context, and the menu first painted behind the rows below.

const tab = (tabId: string, url: string, chromeGroupId?: string): tabData => ({
  tabId,
  favicon: '',
  title: `Tab ${tabId}`,
  url,
  ...(chromeGroupId ? { chromeGroupId } : {}),
});
const A = 'https://a.test/';
const G = 'https://guide.test/';
const T = 'https://tram.test/';

const win = (
  windowId: string,
  title: string,
  tabs: tabData[],
  withGroup = false
): windowGroupData => ({
  windowId,
  windowHeight: 1080,
  windowWidth: 1920,
  windowOffsetTop: 0,
  windowOffsetLeft: 0,
  tabCount: tabs.length,
  title,
  tabs,
  ...(withGroup
    ? { chromeTabGroups: [{ groupId: 'g1', title: 'Research', color: 'blue' }] }
    : {}),
});

// Planning: a, the Research group (guide, tram, guide again), then a again.
// Reading: a third a and two more, none repeated within Reading.
const TRIP = buildSession({
  tabGroupId: 's-trip',
  title: 'Lisbon trip',
  windowCount: 2,
  tabCount: 8,
  windows: [
    win(
      'w1',
      'Planning',
      [
        tab('a', A),
        tab('guide', G, 'g1'),
        tab('tram', T, 'g1'),
        tab('guide2', G, 'g1'),
        tab('a2', A),
      ],
      true
    ),
    win('w2', 'Reading', [
      tab('a3', A),
      tab('food', 'https://food.test/'),
      tab('sun', 'https://weather.test/'),
    ]),
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
  await header(page, 'w1').waitFor();
  return page;
}

const windowMenu = (page: Page, windowId: string): Locator =>
  header(page, windowId).getByRole('button', {
    name: 'More actions',
    exact: true,
  });

const openWindowMenu = async (page: Page, windowId: string) => {
  await header(page, windowId).hover();
  await windowMenu(page, windowId).click();
  await expect(page.getByRole('menu')).toBeVisible();
};

const tabIdsByWindow = async (page: Page) =>
  (await stored(page)).tabGroups[0].windows.map((w) =>
    w.tabs.map((t) => t.tabId)
  );

const toasts = (page: Page): Locator =>
  page.locator('[role="status"] > [data-toast]:not([aria-hidden="true"])');

// What a click at three points across each item would land on: the item, or
// whatever is painted over it. Hit-testing follows paint order.
const itemsOnTop = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('[role="menuitem"]')].map((item) => {
      const r = item.getBoundingClientRect();
      const y = r.top + r.height / 2;
      return [r.left + 8, r.left + r.width / 2, r.right - 8].every((x) =>
        item.contains(document.elementFromPoint(x, y))
      );
    })
  );

// CONTROL for itemsOnTop: the same probe, aimed at a tab row clear of the
// menu, finds the row and not the menu.
const rowIsHit = (page: Page, tabTitle: string) =>
  page.evaluate((title) => {
    const row = [...document.querySelectorAll('[data-pane="detail"] *')].find(
      (el) => el.childElementCount === 0 && el.textContent === title
    )!;
    const r = row.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + 4, r.top + r.height / 2);
    return !!hit && !hit.closest('[role="menu"]');
  }, tabTitle);

test.describe('the window ⋮ is drawn over what is below it', () => {
  test('over its own tab rows', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId);
    await openWindowMenu(page, 'w1');
    expect(await itemsOnTop(page)).toEqual([
      true,
      true,
      true,
      true,
      true,
      true,
    ]);
    expect(await rowIsHit(page, 'Tab a3')).toBe(true);
  });

  test('over the next window, when its own is folded', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId);
    await header(page, 'w1')
      .getByRole('button', { name: /^Collapse/ })
      .click();
    await expect(page.getByText('Tab guide2')).toBeHidden();
    await openWindowMenu(page, 'w1');
    expect(await itemsOnTop(page)).toEqual([
      true,
      true,
      true,
      true,
      true,
      true,
    ]);
    expect(await rowIsHit(page, 'Tab sun')).toBe(true);
  });
});

test('a window removes its own repeats, and one ⌘Z brings them back', async ({
  context,
  extensionId,
}) => {
  const page = await openPopup(context, extensionId);
  const before = (await stored(page)).tabGroups[0].windows;

  await openWindowMenu(page, 'w1');
  await expect(page.getByRole('menuitem')).toHaveText([
    /Copy all links$/,
    /Rename window$/,
    // KAN-866. The page's window holds a tab to take.
    /Replace with current window$/,
    /Sort tabs by site$/,
    /Remove 2 duplicate tabs$/,
    /Delete window$/,
  ]);
  await page.getByRole('menuitem', { name: 'Remove 2 duplicate tabs' }).click();

  // Reading's a3 repeats Planning's a, but not anything in Reading: it stays.
  await expect
    .poll(() => tabIdsByWindow(page))
    .toEqual([
      ['a', 'guide', 'tram'],
      ['a3', 'food', 'sun'],
    ]);
  await expect(toasts(page)).toContainText('Removed 2 duplicate tabs.');

  await page.keyboard.press('ControlOrMeta+z');
  await expect
    .poll(async () => (await stored(page)).tabGroups[0].windows)
    .toEqual(before);
});

test('a window with no repeats of its own offers no Remove', async ({
  context,
  extensionId,
}) => {
  const page = await openPopup(context, extensionId);
  await openWindowMenu(page, 'w2');
  await expect(page.getByRole('menuitem')).toHaveText([
    /Copy all links$/,
    /Rename window$/,
    // KAN-866. The page's window holds a tab to take.
    /Replace with current window$/,
    /Delete window$/,
  ]);
});

test('a group removes its own repeat and leaves the copy outside it', async ({
  context,
  extensionId,
}) => {
  const page = await openPopup(context, extensionId);
  await bandHandle(page, 'g1').hover();
  await bandHandle(page, 'g1')
    .getByRole('button', { name: 'More actions', exact: true })
    .click();
  // KAN-746: guide, tram, guide is out of site order, so Sort follows Copy all links and Rename (KAN-805).
  await expect(page.getByRole('menuitem')).toHaveText([
    /Copy all links$/,
    /Rename group$/,
    /Sort tabs by site$/,
    /Ungroup$/,
    /Remove 1 duplicate tab$/,
    /Delete tab group$/,
  ]);
  await page.getByRole('menuitem', { name: 'Remove 1 duplicate tab' }).click();

  await expect
    .poll(() => tabIdsByWindow(page))
    .toEqual([
      ['a', 'guide', 'tram', 'a2'],
      ['a3', 'food', 'sun'],
    ]);
  await expect(toasts(page)).toContainText('Removed 1 duplicate tab.');
});
