import type { Page } from '@playwright/test';

import { grantedTest as test, expect } from './fixtures/grantedExtension';
import { buildContainer, buildSession, seedSessions } from './fixtures/seed';
import { POPUP, header, stored } from './fixtures/savedWindows';
import { standIn } from './fixtures/standInPages';
import type {
  tabData,
  windowGroupData,
} from '../src/redux/slices/tabContainerDataStateSlice';

// KAN-866 on the real artifact. A saved window's ⋮ Replace with current window
// swaps that window's tabs and groups for the live window's, keeps its name,
// id and place, leaves the other window alone, and one Undo puts it back.

const tab = (tabId: string, url: string, chromeGroupId?: string): tabData => ({
  tabId,
  favicon: '',
  title: `Tab ${tabId}`,
  url,
  ...(chromeGroupId ? { chromeGroupId } : {}),
});
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

const TRIP = buildSession({
  tabGroupId: 's-trip',
  title: 'Lisbon trip',
  windowCount: 2,
  tabCount: 5,
  windows: [
    win(
      'w1',
      'Planning',
      [
        tab('a', 'https://a.test/'),
        tab('guide', 'https://guide.test/', 'g1'),
        tab('tram', 'https://tram.test/', 'g1'),
      ],
      true
    ),
    win('w2', 'Reading', [
      tab('food', 'https://food.test/'),
      tab('sun', 'https://weather.test/'),
    ]),
  ],
});

// Three loaded pages in this page's own window, the last two in a Chrome group named Live.
async function openLiveTabs(page: Page): Promise<string[]> {
  const urls = ['Live one', 'Live two', 'Live three'].map(standIn);
  await page.evaluate(async (addresses: string[]) => {
    const self = await chrome.tabs.getCurrent();
    const ids: number[] = [];
    for (const url of addresses) {
      const made = await chrome.tabs.create({
        windowId: self?.windowId,
        url,
        active: false,
      });
      if (made.id === undefined) throw new Error('a tab without an id');
      ids.push(made.id);
    }
    for (let tries = 0; tries < 100; tries++) {
      const now = await Promise.all(ids.map((id) => chrome.tabs.get(id)));
      if (now.every((t) => t.status === 'complete')) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    const [, second, third] = ids;
    const groupId: number = await chrome.tabs.group({
      tabIds: [second, third],
    });
    await chrome.tabGroups.update(groupId, { title: 'Live', color: 'red' });
  }, urls);
  return urls;
}

// What a capture of this page's window takes: every tab but Tab Keeper's, in order.
const capturable = (page: Page) =>
  page.evaluate(async () => {
    const self = await chrome.tabs.getCurrent();
    const tabs = await chrome.tabs.query({ windowId: self?.windowId });
    return tabs
      .sort((a, b) => a.index - b.index)
      .map((t) => t.url ?? '')
      .filter((url) => !url.startsWith('chrome-extension://'));
  });

const session = async (page: Page) =>
  (await stored(page)).tabGroups.find((g) => g.tabGroupId === 's-trip')!;

test('Replace with current window swaps one saved window, and Undo puts it back', async ({
  context,
  extensionId,
}) => {
  await seedSessions(context, {
    ...buildContainer([TRIP]),
    selectedTabGroupId: 's-trip',
  });
  const page = await context.newPage();
  await page.setViewportSize(POPUP);
  await page.goto(`chrome-extension://${extensionId}/index.html`);
  await page.locator('[data-tour-anchor="save"]').waitFor();
  const live = await openLiveTabs(page);
  // The menu asks about the current window as the page opens: open it again.
  await page.reload();
  await header(page, 'w1').waitFor();
  const expected = await capturable(page);
  // PREMISE: the live tabs are what a capture takes, with nothing of ours in it.
  expect(expected.slice(-3)).toEqual(live);
  const before = await session(page);

  await header(page, 'w1').hover();
  await header(page, 'w1')
    .getByRole('button', { name: 'More actions', exact: true })
    .click();
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  const items = await menu.getByRole('menuitem').allTextContents();
  const at = items.findIndex((i) => i.endsWith('Replace with current window'));
  expect(items[at - 1]).toMatch(/Rename window$/);
  await menu
    .getByRole('menuitem', { name: 'Replace with current window' })
    .click();

  const toast = page.locator(
    '[role="status"] > [data-toast]:not([aria-hidden="true"])'
  );
  await expect(toast).toContainText('Window replaced.');
  await expect
    .poll(async () => (await session(page)).windows[0].tabs.map((t) => t.url))
    .toEqual(expected);
  const after = await session(page);
  const w1 = after.windows[0];
  expect([w1.windowId, w1.title]).toEqual(['w1', 'Planning']);
  expect(w1.tabCount).toBe(expected.length);
  expect(w1.chromeTabGroups?.map((g) => [g.title, g.color])).toEqual([
    ['Live', 'red'],
  ]);
  const liveGroupId = w1.chromeTabGroups?.[0].groupId;
  expect(
    w1.tabs.filter((t) => t.chromeGroupId === liveGroupId).map((t) => t.url)
  ).toEqual(live.slice(1));
  expect(after.windows[1]).toEqual(before.windows[1]);
  // The rows drawn follow the store.
  await expect(
    page.locator('[data-pane="detail"] [data-drag-row-id="w1"]')
  ).toContainText('Live one');

  await toast.getByRole('button', { name: 'Undo' }).click();
  await expect
    .poll(async () => (await session(page)).windows)
    .toEqual(before.windows);
});
