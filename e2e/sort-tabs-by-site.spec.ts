import type { Locator, Page } from '@playwright/test';

import { grantedTest as test, expect } from './fixtures/grantedExtension';
import {
  VIEWS,
  header,
  openSaved,
  session,
  stored,
} from './fixtures/savedWindows';
import type { windowGroupData } from '../src/redux/slices/tabContainerDataStateSlice';

// KAN-694, saved half, on the real artifact. A saved window's ⋮ sorts its tabs
// by site (pinned, then groups, then loose), one Undo puts them back, and the
// item is gone once the window is sorted.

interface T {
  id: string;
  host: string;
  pinned?: true;
  group?: 'trip';
}
// The design's example window.
const BEFORE: T[] = [
  { id: 'gmail', host: 'mail.google.com', pinned: true },
  { id: 'calendar', host: 'calendar.google.com', pinned: true },
  { id: 'gh412', host: 'github.com' },
  { id: 'docsQ4', host: 'docs.google.com' },
  { id: 'mdnSorted', host: 'developer.mozilla.org' },
  { id: 'gh98', host: 'github.com' },
  { id: 'booking', host: 'www.booking.com', group: 'trip' },
  { id: 'maps', host: 'www.google.com', group: 'trip' },
  { id: 'wikiFushimi', host: 'en.wikipedia.org', group: 'trip' },
  { id: 'ytCalm', host: 'www.youtube.com' },
  { id: 'docsLaunch', host: 'docs.google.com' },
  { id: 'wikiTab', host: 'en.wikipedia.org' },
  { id: 'ghActions', host: 'github.com' },
  { id: 'mdnCorner', host: 'developer.mozilla.org' },
  { id: 'ytExt', host: 'www.youtube.com' },
  { id: 'docsNotes', host: 'docs.google.com' },
];
const AFTER = [
  'gmail',
  'calendar',
  'booking',
  'maps',
  'wikiFushimi',
  'gh412',
  'gh98',
  'ghActions',
  'docsQ4',
  'docsLaunch',
  'docsNotes',
  'mdnSorted',
  'mdnCorner',
  'ytCalm',
  'ytExt',
  'wikiTab',
];
const BEFORE_IDS = BEFORE.map((t) => t.id);

const WINDOW: windowGroupData = {
  windowId: 'w1',
  windowHeight: 1080,
  windowWidth: 1920,
  windowOffsetTop: 0,
  windowOffsetLeft: 0,
  tabCount: BEFORE.length,
  title: 'Launch week',
  tabs: BEFORE.map((t) => ({
    tabId: t.id,
    favicon: '',
    title: t.id,
    url: `https://${t.host}/${t.id}`,
    ...(t.pinned ? { pinned: true as const } : {}),
    ...(t.group ? { chromeGroupId: t.group } : {}),
  })),
  chromeTabGroups: [{ groupId: 'trip', title: 'Kyoto trip', color: 'blue' }],
};

const storedOrder = async (page: Page): Promise<string[]> =>
  (await stored(page)).tabGroups
    .find((g) => g.tabGroupId === 'S1')!
    .windows[0].tabs.map((t) => t.tabId);

// The tab rows top to bottom, as drawn.
const screenOrder = (page: Page): Promise<string[]> =>
  page.evaluate((ids) => {
    const y = (id: string) =>
      document
        .querySelector(`[data-pane="detail"] [data-drag-row-id="${id}"]`)!
        .getBoundingClientRect().top;
    return [...ids].sort((a, b) => y(a) - y(b));
  }, BEFORE_IDS);

const sortItem = (page: Page): Locator =>
  page.getByRole('menuitem', { name: 'Sort tabs by site', exact: true });
const toast = (page: Page): Locator =>
  page.locator('[role="status"] > [data-toast]:not([aria-hidden="true"])');

async function openMenu(page: Page): Promise<void> {
  await header(page, 'w1').hover();
  await header(page, 'w1')
    .getByRole('button', { name: 'More actions', exact: true })
    .click();
  await expect(page.getByRole('menu')).toBeVisible();
}

for (const view of VIEWS) {
  test.describe(view, () => {
    const open = (context: Parameters<typeof openSaved>[0], id: string) =>
      openSaved(context, id, view, {
        sessions: [session('S1', 'Launch week', [WINDOW])],
      });

    test('Sort tabs by site is the first item and sorts; one ⌘Z restores', async ({
      context,
      extensionId,
    }) => {
      const page = await open(context, extensionId);
      expect(await screenOrder(page)).toEqual(BEFORE_IDS);

      await openMenu(page);
      await expect(page.getByRole('menuitem').first()).toHaveAccessibleName(
        'Sort tabs by site'
      );
      await sortItem(page).click();

      await expect.poll(() => storedOrder(page)).toEqual(AFTER);
      expect(await screenOrder(page)).toEqual(AFTER);
      await expect(toast(page)).toContainText('Sorted the tabs by site.');

      await page.keyboard.press('ControlOrMeta+z');
      await expect.poll(() => storedOrder(page)).toEqual(BEFORE_IDS);
      expect(await screenOrder(page)).toEqual(BEFORE_IDS);
    });

    test("the toast's Undo restores the order", async ({
      context,
      extensionId,
    }) => {
      const page = await open(context, extensionId);
      await openMenu(page);
      await sortItem(page).click();
      await expect.poll(() => storedOrder(page)).toEqual(AFTER);

      await page
        .getByRole('status')
        .getByRole('button', { name: 'Undo', exact: true })
        .click();
      await expect.poll(() => storedOrder(page)).toEqual(BEFORE_IDS);
      expect(await screenOrder(page)).toEqual(BEFORE_IDS);
    });

    test('the item is absent once the window is sorted', async ({
      context,
      extensionId,
    }) => {
      const page = await open(context, extensionId);
      await openMenu(page);
      await sortItem(page).click();
      await expect.poll(() => storedOrder(page)).toEqual(AFTER);

      await openMenu(page);
      // PREMISE: the menu is open and still holds Delete window.
      await expect(
        page.getByRole('menuitem', { name: 'Delete window' })
      ).toBeVisible();
      await expect(sortItem(page)).toHaveCount(0);
    });
  });
}
