import type { BrowserContext, Locator, Page, Worker } from '@playwright/test';

import { grantedTest as test, expect } from './fixtures/grantedExtension';
import { standIn } from './fixtures/standInPages';
import {
  VIEWS,
  boxOf,
  header,
  openSaved,
  session,
  stored,
} from './fixtures/savedWindows';
import type { windowGroupData } from '../src/redux/slices/tabContainerDataStateSlice';

// KAN-746 Part 2, on the real artifact. A window's ⋮ and right-click offer Sort
// groups by name right under Sort tabs by site, saved and in Open now. Only the
// groups move, into the slots groups hold; names compare numerically and
// without case; one Undo puts them back; the item is gone once sorted.

const sortGroupsItem = (page: Page): Locator =>
  page.getByRole('menuitem', { name: 'Sort groups by name', exact: true });
const toast = (page: Page): Locator =>
  page.locator('[role="status"] > [data-toast]:not([aria-hidden="true"])');
const menuNames = (page: Page): Promise<string[]> =>
  page
    .getByRole('menu')
    .getByRole('menuitem')
    .evaluateAll((items) =>
      items.map((item) => {
        // The glyph's ligature text is aria-hidden; the label is what is left.
        const copy = item.cloneNode(true) as HTMLElement;
        copy.querySelectorAll('[aria-hidden]').forEach((n) => n.remove());
        return (copy.textContent ?? '').trim();
      })
    );
const closeMenu = async (page: Page) => {
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
};
const sortedToastShows = (page: Page) =>
  expect(toast(page)).toContainText('Sorted the groups by name.');

// Slots: one after x, three after y. Names in order: alpha, Trip 2, Trip 10, Zulu.
const SAVED_BEFORE = ['x', 'z1', 'z2', 'y', 't10', 't2', 'a1'];
const SAVED_AFTER = ['x', 'a1', 'y', 't2', 't10', 'z1', 'z2'];
const GROUP_OF: Record<string, string> = {
  z1: 'gZ',
  z2: 'gZ',
  t10: 'g10',
  t2: 'g2',
  a1: 'gA',
};
const WINDOW: windowGroupData = {
  windowId: 'w1',
  windowHeight: 1080,
  windowWidth: 1920,
  windowOffsetTop: 0,
  windowOffsetLeft: 0,
  tabCount: SAVED_BEFORE.length,
  title: 'Planning',
  tabs: SAVED_BEFORE.map((id) => ({
    tabId: id,
    favicon: '',
    title: id,
    url: `https://a.test/${id}`,
    ...(GROUP_OF[id] ? { chromeGroupId: GROUP_OF[id] } : {}),
  })),
  chromeTabGroups: [
    { groupId: 'gZ', title: 'Zulu', color: 'blue' },
    { groupId: 'g10', title: 'Trip 10', color: 'red' },
    { groupId: 'g2', title: 'Trip 2', color: 'green' },
    { groupId: 'gA', title: 'alpha', color: 'grey' },
  ],
};

const storedOrder = async (page: Page): Promise<string[]> =>
  (await stored(page)).tabGroups
    .find((g) => g.tabGroupId === 'S1')!
    .windows[0].tabs.map((t) => t.tabId);
const storedGroups = async (page: Page) =>
  Object.fromEntries(
    (await stored(page)).tabGroups
      .find((g) => g.tabGroupId === 'S1')!
      .windows[0].tabs.map((t) => [t.tabId, t.chromeGroupId ?? null])
  );

// The tab rows top to bottom, as drawn.
const screenOrder = (page: Page): Promise<string[]> =>
  page.evaluate((ids) => {
    const y = (id: string) =>
      document
        .querySelector(`[data-pane="detail"] [data-drag-row-id="${id}"]`)!
        .getBoundingClientRect().top;
    return [...ids].sort((a, b) => y(a) - y(b));
  }, SAVED_BEFORE);

async function openSavedMenu(page: Page): Promise<void> {
  await header(page, 'w1').hover();
  await header(page, 'w1')
    .getByRole('button', { name: 'More actions', exact: true })
    .click();
  await expect(page.getByRole('menu')).toBeVisible();
}

// A point on a row's title, clear of the strip at its right end.
async function rightClickTitle(page: Page, row: Locator): Promise<void> {
  const box = await boxOf(row);
  await page.mouse.click(
    Math.round(box.x + 60),
    Math.round(box.y + box.height / 2),
    { button: 'right' }
  );
  await expect(page.getByRole('menu')).toBeVisible();
}

for (const view of VIEWS) {
  test.describe(`${view}, a saved window`, () => {
    test('⋮ and right-click offer it under Sort tabs by site; it moves only the groups; ⌘Z restores; then it is gone', async ({
      context,
      extensionId,
    }) => {
      const page = await openSaved(context, extensionId, view, {
        sessions: [session('S1', 'Planning', [WINDOW])],
      });
      const groupsBefore = await storedGroups(page);
      expect(await screenOrder(page)).toEqual(SAVED_BEFORE);

      await rightClickTitle(page, header(page, 'w1'));
      const rowItems = await menuNames(page);
      await closeMenu(page);
      await openSavedMenu(page);
      const dotItems = await menuNames(page);
      // KAN-793. The right-click leads with the row's buttons; Add tab is popup only.
      // KAN-805. Its top row holds Rename, so its list leaves out the ⋮'s Rename window.
      expect(rowItems).toEqual([
        ...(view === 'popup'
          ? ['Open', 'Add tab', 'Rename']
          : ['Open', 'Rename']),
        ...dotItems.filter((name) => name !== 'Rename window'),
      ]);
      expect(dotItems.slice(0, 4)).toEqual([
        'Copy all links',
        'Rename window',
        'Sort tabs by site',
        'Sort groups by name',
      ]);

      await sortGroupsItem(page).click();

      await expect.poll(() => storedOrder(page)).toEqual(SAVED_AFTER);
      expect(await screenOrder(page)).toEqual(SAVED_AFTER);
      expect(await storedGroups(page)).toEqual(groupsBefore);
      await sortedToastShows(page);

      await openSavedMenu(page);
      // PREMISE: the menu is open and still holds Delete window.
      await expect(
        page.getByRole('menuitem', { name: 'Delete window' })
      ).toBeVisible();
      await expect(sortGroupsItem(page)).toHaveCount(0);
      await closeMenu(page);

      await page.keyboard.press('ControlOrMeta+z');
      await expect.poll(() => storedOrder(page)).toEqual(SAVED_BEFORE);
      expect(await screenOrder(page)).toEqual(SAVED_BEFORE);
    });
  });
}

// The live half, on a real Chrome window.

interface LiveTab {
  n: string;
  pinned?: true;
  group?: string;
}
interface Row {
  label: string;
  pinned: boolean;
  groupId: number;
}

const VIEW_TAB = 'index.html?view=tab';
const OPEN_NOW = '[data-pane="open-now"]';

const LIVE: LiveTab[] = [
  { n: 'pin', pinned: true },
  { n: 'looseX' },
  { n: 'z1', group: 'Zulu' },
  { n: 'z2', group: 'Zulu' },
  { n: 'looseY' },
  { n: 't10', group: 'Trip 10' },
  { n: 't2', group: 'Trip 2' },
  { n: 'a1', group: 'alpha' },
];
const LIVE_BEFORE = LIVE.map((t) => t.n);
const LIVE_AFTER = ['pin', 'looseX', 'a1', 'looseY', 't2', 't10', 'z1', 'z2'];
const GROUPED = new Set(LIVE.flatMap((t) => (t.group ? [t.n] : [])));

// A real window of these tabs, unfocused so the tab view stays in front, each group made where its members sit.
async function makeLiveWindow(worker: Worker): Promise<number> {
  const urls = LIVE.map((t) => standIn(t.n));
  const pinned = LIVE.flatMap((t, i) => (t.pinned ? [i] : []));
  const groups = [
    ...new Set(LIVE.flatMap((t) => (t.group ? [t.group] : []))),
  ].map((title) => ({
    title,
    at: LIVE.flatMap((t, i) => (t.group === title ? [i] : [])),
  }));
  const made = await worker.evaluate(
    async ({ urls, pinned, groups }) => {
      const win = await chrome.windows.create({ focused: false, url: urls });
      const windowId = win?.id;
      const ids = (win?.tabs ?? []).flatMap((t) =>
        t.id === undefined ? [] : [t.id]
      );
      if (windowId === undefined || ids.length !== urls.length) return null;
      for (const i of pinned)
        await chrome.tabs.update(ids[i], { pinned: true });
      for (const { title, at } of groups) {
        const [head, ...tail] = at.map((i) => ids[i]);
        if (head === undefined) return null;
        const groupId = await chrome.tabs.group({
          tabIds: [head, ...tail],
          createProperties: { windowId },
        });
        await chrome.tabGroups.update(groupId, { title, color: 'blue' });
      }
      return windowId;
    },
    { urls, pinned, groups }
  );
  if (made === null) throw new Error('Chrome gave no window or tab ids');
  return made;
}

// The window's strip as Chrome has it, by index.
const liveStrip = (worker: Worker, windowId: number): Promise<Row[]> =>
  worker.evaluate(async (id) => {
    const tabs = await chrome.tabs.query({ windowId: id });
    return tabs
      .sort((a, b) => a.index - b.index)
      .map((t) => {
        const url = t.url ?? '';
        const label =
          url === '' ? '' : decodeURIComponent(new URL(url).pathname.slice(1));
        return { label, pinned: t.pinned, groupId: t.groupId };
      });
  }, windowId);
const labelsOf = async (worker: Worker, windowId: number) =>
  (await liveStrip(worker, windowId)).map((r) => r.label);

// Chrome's own record of every tab moved in the window, from now on, by label.
const recordMoves = (worker: Worker, windowId: number) =>
  worker.evaluate((id) => {
    const g = globalThis as unknown as { kan746bMoved: number[] };
    g.kan746bMoved = [];
    chrome.tabs.onMoved.addListener((tabId, info) => {
      if (info.windowId === id) g.kan746bMoved.push(tabId);
    });
  }, windowId);
const movesSoFar = (worker: Worker): Promise<string[]> =>
  worker.evaluate(async () => {
    const g = globalThis as unknown as { kan746bMoved: number[] };
    return Promise.all(
      g.kan746bMoved.map(async (id) => {
        const url = (await chrome.tabs.get(id)).url ?? '';
        return decodeURIComponent(new URL(url).pathname.slice(1));
      })
    );
  });

async function openTabView(
  context: BrowserContext,
  extensionId: string
): Promise<Page> {
  const page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`chrome-extension://${extensionId}/${VIEW_TAB}`);
  // Barrier: goto resolves before React mounts.
  await page
    .getByRole('button', { name: 'Sort sessions', exact: true })
    .waitFor();
  return page;
}

const liveRow = (page: Page, windowId: number): Locator =>
  page.locator(
    `${OPEN_NOW} [data-open-window-id="${windowId}"] [data-window-row]`
  );

async function openLiveMenu(page: Page, windowId: number): Promise<void> {
  await liveRow(page, windowId).hover();
  await liveRow(page, windowId)
    .locator('[data-row-actions]')
    .getByRole('button', { name: /^More actions: Window \d+$/ })
    .click();
  await expect(page.getByRole('menu')).toBeVisible();
}

test.describe('Open now window', () => {
  test('⋮ and right-click offer it under Sort tabs by site; only group tabs move; ⌘Z restores; then it is gone', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const windowId = await makeLiveWindow(serviceWorker);
    await expect
      .poll(() => labelsOf(serviceWorker, windowId))
      .toEqual(LIVE_BEFORE);
    const before = await liveStrip(serviceWorker, windowId);
    const page = await openTabView(context, extensionId);

    await rightClickTitle(page, liveRow(page, windowId));
    const rowItems = await menuNames(page);
    await closeMenu(page);
    await openLiveMenu(page, windowId);
    const dotItems = await menuNames(page);
    // KAN-793. The right-click leads with the row's Go to · Save.
    expect(rowItems).toEqual(['Go to', 'Save', ...dotItems]);
    expect(dotItems.slice(0, 3)).toEqual([
      'Copy all links',
      'Sort tabs by site',
      'Sort groups by name',
    ]);

    await recordMoves(serviceWorker, windowId);
    await sortGroupsItem(page).click();

    await expect
      .poll(() => labelsOf(serviceWorker, windowId))
      .toEqual(LIVE_AFTER);
    await sortedToastShows(page);
    const moved = await movesSoFar(serviceWorker);
    // PREMISE: Chrome reported the moves.
    expect(moved.length).toBeGreaterThan(0);
    expect(moved.filter((label) => !GROUPED.has(label))).toEqual([]);
    // Every tab kept its pin and its group.
    const after = await liveStrip(serviceWorker, windowId);
    for (const row of after) {
      const was = before.find((b) => b.label === row.label);
      expect({ pinned: row.pinned, groupId: row.groupId }).toEqual({
        pinned: was?.pinned,
        groupId: was?.groupId,
      });
    }

    await openLiveMenu(page, windowId);
    // PREMISE: the menu is open and still holds Close window.
    await expect(
      page.getByRole('menuitem', { name: 'Close window', exact: true })
    ).toBeVisible();
    await expect(sortGroupsItem(page)).toHaveCount(0);
    await closeMenu(page);

    await page.keyboard.press('ControlOrMeta+z');

    await expect
      .poll(() => labelsOf(serviceWorker, windowId))
      .toEqual(LIVE_BEFORE);
    expect(await liveStrip(serviceWorker, windowId)).toEqual(before);
    await expect(toast(page)).toHaveCount(0);
    await openLiveMenu(page, windowId);
    await expect(sortGroupsItem(page)).toHaveCount(1);
  });

  test("⌘Z after a tab was moved by hand moves nothing, and says the sort can't be undone", async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const windowId = await makeLiveWindow(serviceWorker);
    await expect
      .poll(() => labelsOf(serviceWorker, windowId))
      .toEqual(LIVE_BEFORE);
    const page = await openTabView(context, extensionId);
    await openLiveMenu(page, windowId);
    await sortGroupsItem(page).click();
    await expect
      .poll(() => labelsOf(serviceWorker, windowId))
      .toEqual(LIVE_AFTER);
    await sortedToastShows(page);

    // looseX to the end of the strip.
    await serviceWorker.evaluate(async (id) => {
      const tabs = await chrome.tabs.query({ windowId: id });
      const moving = tabs.find((t) => t.url?.endsWith('/looseX'));
      if (moving?.id === undefined) throw new Error('no looseX');
      await chrome.tabs.move(moving.id, { index: -1 });
    }, windowId);
    const byHand = await liveStrip(serviceWorker, windowId);
    // PREMISE: the hand move changed the sorted order.
    expect(byHand.map((r) => r.label)).not.toEqual(LIVE_AFTER);

    await page.keyboard.press('ControlOrMeta+z');

    await expect(toast(page)).toHaveCount(1);
    await expect(toast(page)).toContainText(
      "Couldn't undo the sort. That window's tabs changed since."
    );
    // The undo is not awaited by the key: every sample over 1.5 s must still be the hand-moved strip.
    for (let sample = 0; sample < 15; sample++) {
      expect(await liveStrip(serviceWorker, windowId)).toEqual(byHand);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  });

  test("the toast's Undo restores the order", async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const windowId = await makeLiveWindow(serviceWorker);
    await expect
      .poll(() => labelsOf(serviceWorker, windowId))
      .toEqual(LIVE_BEFORE);
    const before = await liveStrip(serviceWorker, windowId);
    const page = await openTabView(context, extensionId);
    await openLiveMenu(page, windowId);
    await sortGroupsItem(page).click();
    await expect
      .poll(() => labelsOf(serviceWorker, windowId))
      .toEqual(LIVE_AFTER);

    await page
      .getByRole('status')
      .getByRole('button', { name: 'Undo', exact: true })
      .click();

    await expect
      .poll(() => labelsOf(serviceWorker, windowId))
      .toEqual(LIVE_BEFORE);
    expect(await liveStrip(serviceWorker, windowId)).toEqual(before);
  });
});
