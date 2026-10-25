import type { BrowserContext, Locator, Page, Worker } from '@playwright/test';

import { test as plainTest } from './fixtures/extension';
import { grantedTest as test, expect } from './fixtures/grantedExtension';
import { standIn } from './fixtures/standInPages';
import {
  VIEWS,
  bandHandle,
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

    test('Sort tabs by site comes right after Copy all links and sorts; one ⌘Z restores', async ({
      context,
      extensionId,
    }) => {
      const page = await open(context, extensionId);
      expect(await screenOrder(page)).toEqual(BEFORE_IDS);

      await openMenu(page);
      // KAN-783. Copy all links leads every window and group menu.
      await expect(page.getByRole('menuitem').nth(0)).toHaveAccessibleName(
        'Copy all links'
      );
      await expect(page.getByRole('menuitem').nth(1)).toHaveAccessibleName(
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

// KAN-694, live half, on a real Chrome window. Open now's ⋮ sorts the window's
// tabs (pinned, then groups, then loose), ⌘Z and the toast's Undo put them
// back, and Chrome's pin state and group of every tab stay as they were.

interface LiveTab {
  n: string;
  site: string;
  pinned?: true;
  group?: true;
  // The Tab Keeper page itself, in the window being sorted.
  tabKeeper?: true;
}
interface Row {
  label: string;
  pinned: boolean;
  groupId: number;
}

const VIEW_TAB = 'index.html?view=tab';
const OPEN_NOW = '[data-pane="open-now"]';

const LIVE: LiveTab[] = [
  { n: 'pinBeta1', site: 'beta', pinned: true },
  { n: 'pinAlpha', site: 'alpha', pinned: true },
  { n: 'pinBeta2', site: 'beta', pinned: true },
  { n: 'looseBeta1', site: 'beta' },
  { n: 'looseAlpha1', site: 'alpha' },
  { n: 'groupGamma', site: 'gamma', group: true },
  { n: 'groupAlpha', site: 'alpha', group: true },
  { n: 'looseBeta2', site: 'beta' },
  { n: 'looseAlpha2', site: 'alpha' },
];
// Pinned by first-seen site, then the group as it is, then loose by first-seen site.
const LIVE_AFTER = [
  'pinBeta1',
  'pinBeta2',
  'pinAlpha',
  'groupGamma',
  'groupAlpha',
  'looseBeta1',
  'looseBeta2',
  'looseAlpha1',
  'looseAlpha2',
];
const LIVE_BEFORE = LIVE.map((t) => t.n);

// A page of this test's own server, on a host of its own: *.localhost is loopback.
function pageOn(tab: LiveTab): string {
  const url = new URL(standIn(tab.n));
  url.hostname = `${tab.site}.localhost`;
  return url.href;
}

// A real window of these tabs, unfocused so the tab view stays in front: the
// pinned first, then the group made where its members already sit.
async function makeLiveWindow(
  worker: Worker,
  extensionId: string,
  tabs: LiveTab[]
): Promise<number> {
  const urls = tabs.map((t) =>
    t.tabKeeper ? `chrome-extension://${extensionId}/${VIEW_TAB}` : pageOn(t)
  );
  const pinned = tabs.flatMap((t, i) => (t.pinned ? [i] : []));
  const grouped = tabs.flatMap((t, i) => (t.group ? [i] : []));
  const made = await worker.evaluate(
    async ({ urls, pinned, grouped }) => {
      const win = await chrome.windows.create({ focused: false, url: urls });
      const windowId = win?.id;
      const ids = (win?.tabs ?? []).flatMap((t) =>
        t.id === undefined ? [] : [t.id]
      );
      if (windowId === undefined || ids.length !== urls.length) return null;
      for (const i of pinned)
        await chrome.tabs.update(ids[i], { pinned: true });
      const [head, ...tail] = grouped.map((i) => ids[i]);
      if (head !== undefined) {
        const groupId = await chrome.tabs.group({
          tabIds: [head, ...tail],
          createProperties: { windowId },
        });
        await chrome.tabGroups.update(groupId, {
          title: 'Trip',
          color: 'blue',
        });
      }
      return windowId;
    },
    { urls, pinned, grouped }
  );
  if (made === null) throw new Error('Chrome gave no window or tab ids');
  return made;
}

// The window's strip as Chrome has it, by index. 'TK' is the Tab Keeper page.
const liveStrip = (worker: Worker, windowId: number): Promise<Row[]> =>
  worker.evaluate(async (id) => {
    const tabs = await chrome.tabs.query({ windowId: id });
    return tabs
      .sort((a, b) => a.index - b.index)
      .map((t) => {
        const url = t.url ?? '';
        const label = url.startsWith('chrome-extension://')
          ? 'TK'
          : url === ''
            ? ''
            : decodeURIComponent(new URL(url).pathname.slice(1));
        return { label, pinned: t.pinned, groupId: t.groupId };
      });
  }, windowId);

const labelsOf = async (worker: Worker, windowId: number) =>
  (await liveStrip(worker, windowId)).map((r) => r.label);

// Tab Keeper's own page is never moved by the sort, so orders compare without it.
const withoutTabKeeper = (labels: string[]) => labels.filter((l) => l !== 'TK');

// Resolves once every tab has committed its address, which the sort reads.
const loaded = (worker: Worker, windowId: number, names: string[]) =>
  expect
    .poll(async () => withoutTabKeeper(await labelsOf(worker, windowId)))
    .toEqual(names.filter((n) => n !== 'TK'));

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

// The tab view that opened inside the window being sorted ("This window").
async function tabViewInNewWindow(
  context: BrowserContext,
  extensionId: string
): Promise<Page> {
  const prefix = `chrome-extension://${extensionId}/index.html`;
  const found = () => context.pages().filter((p) => p.url().startsWith(prefix));
  await expect.poll(() => found().length).toBe(1);
  const page = found()[0];
  await page.setViewportSize({ width: 1280, height: 800 });
  await page
    .getByRole('button', { name: 'Sort sessions', exact: true })
    .waitFor();
  return page;
}

const liveBlock = (page: Page, windowId: number): Locator =>
  page.locator(`${OPEN_NOW} [data-open-window-id="${windowId}"]`);

const moreActions = (page: Page, windowId: number): Locator =>
  liveBlock(page, windowId)
    .locator('[data-window-row] [data-row-actions]')
    .getByRole('button', { name: /^More actions: Window \d+$/ });

const closeWindowItem = (page: Page): Locator =>
  page.getByRole('menuitem', { name: 'Close window', exact: true });

// Opens a window's ⋮ and returns what it offers, then closes it again.
async function menuOffers(
  page: Page,
  windowId: number
): Promise<{ sort: number; close: number }> {
  await liveBlock(page, windowId).locator('[data-window-row]').hover();
  await moreActions(page, windowId).click();
  await expect(page.getByRole('menu')).toBeVisible();
  const offers = {
    sort: await sortItem(page).count(),
    close: await closeWindowItem(page).count(),
  };
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  return offers;
}

async function chooseSortInOpenNow(
  page: Page,
  windowId: number
): Promise<void> {
  await liveBlock(page, windowId).locator('[data-window-row]').hover();
  await moreActions(page, windowId).click();
  await sortItem(page).click();
}

const sortedToastShows = (page: Page) =>
  expect(toast(page)).toContainText('Sorted the tabs by site.');

test.describe('Open now window menu (KAN-694)', () => {
  test('the item sorts the real window, keeps every pin and group, and is then gone; ⌘Z restores it and closes the toast', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const windowId = await makeLiveWindow(serviceWorker, extensionId, LIVE);
    await loaded(serviceWorker, windowId, LIVE_BEFORE);
    const before = await liveStrip(serviceWorker, windowId);
    const page = await openTabView(context, extensionId);

    await chooseSortInOpenNow(page, windowId);

    await expect
      .poll(() => labelsOf(serviceWorker, windowId))
      .toEqual(LIVE_AFTER);
    const after = await liveStrip(serviceWorker, windowId);
    // Chrome's own state of every tab: pinned, and which group.
    for (const row of after) {
      const was = before.find((b) => b.label === row.label);
      expect({ pinned: row.pinned, groupId: row.groupId }).toEqual({
        pinned: was?.pinned,
        groupId: was?.groupId,
      });
    }
    await sortedToastShows(page);
    // Sorted now, so the menu offers no Sort, and keeps Close window (KAN-696).
    expect(await menuOffers(page, windowId)).toEqual({ sort: 0, close: 1 });

    await page.keyboard.press('ControlOrMeta+z');

    await expect
      .poll(() => labelsOf(serviceWorker, windowId))
      .toEqual(LIVE_BEFORE);
    expect(await liveStrip(serviceWorker, windowId)).toEqual(before);
    await expect(toast(page)).toHaveCount(0);
    expect(await menuOffers(page, windowId)).toEqual({ sort: 1, close: 1 });
  });

  test("the toast's Undo restores the order", async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const windowId = await makeLiveWindow(serviceWorker, extensionId, LIVE);
    await loaded(serviceWorker, windowId, LIVE_BEFORE);
    const before = await liveStrip(serviceWorker, windowId);
    const page = await openTabView(context, extensionId);
    await chooseSortInOpenNow(page, windowId);
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

  test("⌘Z after a tab was moved by hand moves nothing, and says the sort can't be undone", async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const windowId = await makeLiveWindow(serviceWorker, extensionId, LIVE);
    await loaded(serviceWorker, windowId, LIVE_BEFORE);
    const page = await openTabView(context, extensionId);
    await chooseSortInOpenNow(page, windowId);
    await expect
      .poll(() => labelsOf(serviceWorker, windowId))
      .toEqual(LIVE_AFTER);
    await sortedToastShows(page);

    // looseAlpha2 to the front of the loose tabs.
    const target = (await labelsOf(serviceWorker, windowId)).indexOf(
      'looseBeta1'
    );
    await serviceWorker.evaluate(
      async ({ id, index }) => {
        const tabs = await chrome.tabs.query({ windowId: id });
        const moving = tabs.find((t) => t.url?.endsWith('/looseAlpha2'));
        if (moving?.id === undefined) throw new Error('no looseAlpha2');
        await chrome.tabs.move(moving.id, { index });
      },
      { id: windowId, index: target }
    );
    const byHand = await liveStrip(serviceWorker, windowId);
    // PREMISE: the hand move changed the sorted order.
    expect(byHand.map((r) => r.label)).not.toEqual(LIVE_AFTER);

    await page.keyboard.press('ControlOrMeta+z');

    // KAN-744 R10-R11. The key reached the sort's undo: the sort's toast closed, and the refusal shows.
    await expect(toast(page)).toHaveCount(1);
    await expect(toast(page)).toContainText(
      "Couldn't undo the sort. That window's tabs changed since."
    );
    // The undo is not awaited by the key, so a late move would land after the toast
    // closes: every sample over 1.5 s must still be the hand-moved strip.
    for (let sample = 0; sample < 15; sample++) {
      expect(await liveStrip(serviceWorker, windowId)).toEqual(byHand);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  });

  // KAN-743. Chrome's own record of every tab moved in the window, from now on.
  const recordMoves = (worker: Worker, windowId: number) =>
    worker.evaluate((id) => {
      const g = globalThis as unknown as { kan743Moved: number[] };
      g.kan743Moved = [];
      chrome.tabs.onMoved.addListener((tabId, info) => {
        if (info.windowId === id) g.kan743Moved.push(tabId);
      });
    }, windowId);
  // Every tab moved since recording began, by label, in the order they moved.
  const movedSoFar = (worker: Worker): Promise<string[]> =>
    worker.evaluate(async () => {
      const g = globalThis as unknown as { kan743Moved: number[] };
      return Promise.all(
        g.kan743Moved.map(async (id) => {
          const url = (await chrome.tabs.get(id)).url ?? '';
          return decodeURIComponent(new URL(url).pathname.slice(1));
        })
      );
    });
  const cycle = ['alpha', 'beta', 'gamma'];
  const KEEP_STILL: {
    name: string;
    tabs: LiveTab[];
    sortMoves: string[];
    undoMoves: string[];
  }[] = [
    {
      name: 'one tab out of place',
      tabs: ['a1', 'a2', 'b1', 'b2', 'c1', 'c2', 'a3'].map((n) => ({
        n,
        site: cycle['abc'.indexOf(n[0])],
      })),
      sortMoves: ['a3'],
      undoMoves: ['a3'],
    },
    {
      name: 'three sites interleaved',
      tabs: Array.from({ length: 10 }, (_, i) => ({
        n: `t${i}${cycle[i % 3]}`,
        site: cycle[i % 3],
      })),
      sortMoves: ['t9alpha', 't1beta', 't4beta', 't2gamma', 't5gamma'],
      undoMoves: ['t3alpha', 't6alpha', 't9alpha', 't4beta', 't7beta'],
    },
    {
      name: 'pinned, a group and loose',
      tabs: LIVE,
      sortMoves: ['pinAlpha', 'looseBeta1', 'looseAlpha1'],
      undoMoves: ['pinBeta2', 'looseBeta2', 'groupGamma', 'groupAlpha'],
    },
  ];
  for (const { name, tabs, sortMoves, undoMoves } of KEEP_STILL) {
    test(`Sort and ⌘Z move only the tabs out of place, each once: ${name} (KAN-743)`, async ({
      context,
      extensionId,
      serviceWorker,
    }) => {
      const names = tabs.map((t) => t.n);
      const windowId = await makeLiveWindow(serviceWorker, extensionId, tabs);
      await loaded(serviceWorker, windowId, names);
      const before = await liveStrip(serviceWorker, windowId);
      const page = await openTabView(context, extensionId);
      await recordMoves(serviceWorker, windowId);

      await chooseSortInOpenNow(page, windowId);
      await sortedToastShows(page);

      // onMoved reaches the worker on its own schedule: poll for the set, then check it held no repeat.
      await expect
        .poll(async () => [...(await movedSoFar(serviceWorker))].sort())
        .toEqual([...sortMoves].sort());
      const sorted = await movedSoFar(serviceWorker);
      expect(sorted.length).toBe(new Set(sorted).size);
      const after = await liveStrip(serviceWorker, windowId);
      for (const row of after) {
        const was = before.find((b) => b.label === row.label);
        expect({ pinned: row.pinned, groupId: row.groupId }).toEqual({
          pinned: was?.pinned,
          groupId: was?.groupId,
        });
      }

      await page.keyboard.press('ControlOrMeta+z');
      await expect.poll(() => labelsOf(serviceWorker, windowId)).toEqual(names);

      await expect
        .poll(async () =>
          (await movedSoFar(serviceWorker)).slice(sorted.length).sort()
        )
        .toEqual([...undoMoves].sort());
      const undone = (await movedSoFar(serviceWorker)).slice(sorted.length);
      expect(undone.length).toBe(new Set(undone).size);
      expect(await liveStrip(serviceWorker, windowId)).toEqual(before);
    });
  }

  for (const where of ['in the group', 'loose'] as const) {
    test(`the Tab Keeper tab ${where} stays ${where} through a sort of This window`, async ({
      context,
      extensionId,
      serviceWorker,
    }) => {
      const tabs: LiveTab[] =
        where === 'in the group'
          ? [
              ...LIVE.slice(0, 6),
              { n: 'TK', site: 'tk', group: true, tabKeeper: true },
              ...LIVE.slice(6),
            ]
          : [
              ...LIVE.slice(0, 8),
              { n: 'TK', site: 'tk', tabKeeper: true },
              ...LIVE.slice(8),
            ];
      const windowId = await makeLiveWindow(serviceWorker, extensionId, tabs);
      await loaded(
        serviceWorker,
        windowId,
        tabs.map((t) => t.n)
      );
      const page = await tabViewInNewWindow(context, extensionId);
      const before = await liveStrip(serviceWorker, windowId);
      const tkBefore = before.find((r) => r.label === 'TK');
      const groupOf = (rows: Row[], label: string) =>
        rows.find((r) => r.label === label)?.groupId;
      // PREMISE: Tab Keeper starts in the group, or loose.
      expect(tkBefore?.pinned).toBe(false);
      expect(tkBefore?.groupId).toBe(
        where === 'in the group' ? groupOf(before, 'groupGamma') : -1
      );

      await chooseSortInOpenNow(page, windowId);

      await expect
        .poll(async () =>
          withoutTabKeeper(await labelsOf(serviceWorker, windowId))
        )
        .toEqual(LIVE_AFTER);
      const after = await liveStrip(serviceWorker, windowId);
      const tkAfter = after.find((r) => r.label === 'TK');
      expect(tkAfter?.pinned).toBe(false);
      expect(tkAfter?.groupId).toBe(tkBefore?.groupId);
      // The others kept their pin state and group too.
      for (const row of after) {
        const was = before.find((b) => b.label === row.label);
        expect({ pinned: row.pinned, groupId: row.groupId }).toEqual({
          pinned: was?.pinned,
          groupId: was?.groupId,
        });
      }

      // ⌘Z puts every other tab back where it was, with its pin and group.
      await sortedToastShows(page);
      await page.keyboard.press('ControlOrMeta+z');
      await expect
        .poll(async () =>
          withoutTabKeeper(await labelsOf(serviceWorker, windowId))
        )
        .toEqual(LIVE_BEFORE);
      const undone = await liveStrip(serviceWorker, windowId);
      for (const row of undone) {
        const was = before.find((b) => b.label === row.label);
        expect({ pinned: row.pinned, groupId: row.groupId }).toEqual({
          pinned: was?.pinned,
          groupId: was?.groupId,
        });
      }
    });
  }

  test('a window with a split view is not offered the sort', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const tabs: LiveTab[] = [
      { n: 'splitBeta', site: 'beta' },
      { n: 'splitAlpha1', site: 'alpha' },
      { n: 'splitAlpha2', site: 'alpha' },
      { n: 'splitBeta2', site: 'beta' },
    ];
    const windowId = await makeLiveWindow(serviceWorker, extensionId, tabs);
    await loaded(
      serviceWorker,
      windowId,
      tabs.map((t) => t.n)
    );
    const split = await serviceWorker.evaluate(async (id) => {
      const createSplit: unknown = Reflect.get(chrome.tabs, 'createSplit');
      if (typeof createSplit !== 'function') return 'no tabs.createSplit';
      const ids = (await chrome.tabs.query({ windowId: id }))
        .sort((a, b) => a.index - b.index)
        .flatMap((t) => (t.id === undefined ? [] : [t.id]));
      await Reflect.apply(createSplit, chrome.tabs, [[ids[1], ids[2]]]);
      return 'split';
    }, windowId);
    // PREMISE: this browser can make a split (Chrome 155+).
    expect(split).toBe('split');
    const page = await openTabView(context, extensionId);

    // PREMISE: the window's strip is drawn, and unsorted, so only the split withholds the item.
    await expect(
      liveBlock(page, windowId).getByRole('button', {
        name: /^Save window as a session/,
      })
    ).toBeVisible();
    expect(await labelsOf(serviceWorker, windowId)).not.toEqual([
      'splitAlpha1',
      'splitAlpha2',
      'splitBeta',
      'splitBeta2',
    ]);
    expect(await menuOffers(page, windowId)).toEqual({ sort: 0, close: 1 });

    // Control: the same tabs with no split are offered the sort.
    const control = await makeLiveWindow(serviceWorker, extensionId, tabs);
    await loaded(
      serviceWorker,
      control,
      tabs.map((t) => t.n)
    );
    expect(await menuOffers(page, control)).toEqual({ sort: 1, close: 1 });
  });
});

plainTest(
  'without the tab group grant the window is not offered the sort',
  async ({ context, extensionId, serviceWorker }) => {
    const windowId = await makeLiveWindow(
      serviceWorker,
      extensionId,
      LIVE.filter((t) => !t.group)
    );
    await loaded(
      serviceWorker,
      windowId,
      LIVE.filter((t) => !t.group).map((t) => t.n)
    );
    const page = await openTabView(context, extensionId);
    // PREMISE: the window is drawn with its strip, and is unsorted.
    await expect(
      liveBlock(page, windowId).getByRole('button', {
        name: /^Save window as a session/,
      })
    ).toBeVisible();
    expect(await menuOffers(page, windowId)).toEqual({ sort: 0, close: 1 });
  }
);

// KAN-746. A group's ⋮ sorts the tabs inside that group only, saved and live.

const G_BEFORE: T[] = [
  { id: 'xLoose', host: 'x.test' },
  { id: 'tripB1', host: 'b.test', group: 'trip' },
  { id: 'tripA1', host: 'a.test', group: 'trip' },
  { id: 'tripB2', host: 'b.test', group: 'trip' },
  { id: 'yLoose', host: 'y.test' },
  { id: 'xLoose2', host: 'x.test' },
];
const G_AFTER = ['xLoose', 'tripB1', 'tripB2', 'tripA1', 'yLoose', 'xLoose2'];
const G_BEFORE_IDS = G_BEFORE.map((t) => t.id);
const G_WINDOW: windowGroupData = {
  ...WINDOW,
  tabCount: G_BEFORE.length,
  tabs: G_BEFORE.map((t) => ({
    tabId: t.id,
    favicon: '',
    title: t.id,
    url: `https://${t.host}/${t.id}`,
    ...(t.group ? { chromeGroupId: t.group } : {}),
  })),
};

async function openGroupMenu(page: Page): Promise<void> {
  await bandHandle(page, 'trip').hover();
  await bandHandle(page, 'trip')
    .getByRole('button', { name: 'More actions', exact: true })
    .click();
  await expect(page.getByRole('menu')).toBeVisible();
}

for (const view of VIEWS) {
  test.describe(`${view}, a saved group (KAN-746)`, () => {
    test("the group's ⋮ sorts its tabs only, right after Copy all links; ⌘Z restores; then it is gone", async ({
      context,
      extensionId,
    }) => {
      const page = await openSaved(context, extensionId, view, {
        sessions: [session('S1', 'Launch week', [G_WINDOW])],
      });

      await openGroupMenu(page);
      // KAN-783. Copy all links leads every window and group menu.
      await expect(page.getByRole('menuitem').nth(0)).toHaveAccessibleName(
        'Copy all links'
      );
      await expect(page.getByRole('menuitem').nth(1)).toHaveAccessibleName(
        'Sort tabs by site'
      );
      await sortItem(page).click();

      await expect.poll(() => storedOrder(page)).toEqual(G_AFTER);
      await expect(toast(page)).toContainText('Sorted the tabs by site.');

      await openGroupMenu(page);
      // PREMISE: the menu is open and still holds Ungroup.
      await expect(
        page.getByRole('menuitem', { name: 'Ungroup' })
      ).toBeVisible();
      await expect(sortItem(page)).toHaveCount(0);
      await page.keyboard.press('Escape');
      await expect(page.getByRole('menu')).toHaveCount(0);

      await page.keyboard.press('ControlOrMeta+z');
      await expect.poll(() => storedOrder(page)).toEqual(G_BEFORE_IDS);
    });
  });
}

const LIVE_G: LiveTab[] = [
  { n: 'looseBeta1', site: 'beta' },
  { n: 'gBeta1', site: 'beta', group: true },
  { n: 'gAlpha1', site: 'alpha', group: true },
  { n: 'gBeta2', site: 'beta', group: true },
  { n: 'gAlpha2', site: 'alpha', group: true },
  { n: 'looseAlpha1', site: 'alpha' },
];
const LIVE_G_BEFORE = LIVE_G.map((t) => t.n);
const LIVE_G_AFTER = [
  'looseBeta1',
  'gBeta1',
  'gBeta2',
  'gAlpha1',
  'gAlpha2',
  'looseAlpha1',
];

const groupMoreActions = (page: Page, windowId: number): Locator =>
  liveBlock(page, windowId).getByRole('button', {
    name: 'More actions: Trip',
    exact: true,
  });

async function chooseGroupSortInOpenNow(
  page: Page,
  windowId: number
): Promise<void> {
  await liveBlock(page, windowId)
    .getByRole('group', { name: /Trip/ })
    .locator('[data-group-drag-handle]')
    .hover();
  await groupMoreActions(page, windowId).click();
  await sortItem(page).click();
}

// Chrome's own record of every tab moved in the window, from now on, by label.
const recordGroupMoves = (worker: Worker, windowId: number) =>
  worker.evaluate((id) => {
    const g = globalThis as unknown as { kan746Moved: number[] };
    g.kan746Moved = [];
    chrome.tabs.onMoved.addListener((tabId, info) => {
      if (info.windowId === id) g.kan746Moved.push(tabId);
    });
  }, windowId);
const groupMovesSoFar = (worker: Worker): Promise<string[]> =>
  worker.evaluate(async () => {
    const g = globalThis as unknown as { kan746Moved: number[] };
    return Promise.all(
      g.kan746Moved.map(async (id) => {
        const url = (await chrome.tabs.get(id)).url ?? '';
        return url.startsWith('chrome-extension://')
          ? 'TK'
          : decodeURIComponent(new URL(url).pathname.slice(1));
      })
    );
  });

const keptPinAndGroup = (before: Row[], after: Row[]) => {
  for (const row of after) {
    const was = before.find((b) => b.label === row.label);
    expect({ pinned: row.pinned, groupId: row.groupId }).toEqual({
      pinned: was?.pinned,
      groupId: was?.groupId,
    });
  }
};

test.describe('Open now group menu (KAN-746)', () => {
  test("Sort moves only the group's tab out of place, once; ⌘Z puts it back the same way", async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const windowId = await makeLiveWindow(serviceWorker, extensionId, LIVE_G);
    await loaded(serviceWorker, windowId, LIVE_G_BEFORE);
    const before = await liveStrip(serviceWorker, windowId);
    const page = await openTabView(context, extensionId);
    await recordGroupMoves(serviceWorker, windowId);

    await chooseGroupSortInOpenNow(page, windowId);

    await expect
      .poll(() => labelsOf(serviceWorker, windowId))
      .toEqual(LIVE_G_AFTER);
    await sortedToastShows(page);
    await expect
      .poll(() => groupMovesSoFar(serviceWorker))
      .toEqual(['gAlpha1']);
    keptPinAndGroup(before, await liveStrip(serviceWorker, windowId));
    // Sorted now: the group's ⋮ offers no Sort, and the window's still does (its loose tabs are not).
    await groupMoreActions(page, windowId).click();
    await expect(page.getByRole('menuitem', { name: 'Ungroup' })).toBeVisible();
    await expect(sortItem(page)).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
    expect((await menuOffers(page, windowId)).sort).toBe(1);

    await page.keyboard.press('ControlOrMeta+z');

    await expect
      .poll(() => labelsOf(serviceWorker, windowId))
      .toEqual(LIVE_G_BEFORE);
    expect(await liveStrip(serviceWorker, windowId)).toEqual(before);
    await expect
      .poll(() => groupMovesSoFar(serviceWorker))
      .toEqual(['gAlpha1', 'gBeta2']);
  });

  test('the Tab Keeper tab first in the group stays first in it through a group sort of This window', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const tabs: LiveTab[] = [
      LIVE_G[0],
      { n: 'TK', site: 'tk', group: true, tabKeeper: true },
      ...LIVE_G.slice(1),
    ];
    const windowId = await makeLiveWindow(serviceWorker, extensionId, tabs);
    await loaded(
      serviceWorker,
      windowId,
      tabs.map((t) => t.n)
    );
    const page = await tabViewInNewWindow(context, extensionId);
    const before = await liveStrip(serviceWorker, windowId);
    // PREMISE: Tab Keeper starts first in the group.
    expect(before[1]).toEqual({
      label: 'TK',
      pinned: false,
      groupId: before[2].groupId,
    });
    await recordGroupMoves(serviceWorker, windowId);

    await chooseGroupSortInOpenNow(page, windowId);

    await expect
      .poll(() => labelsOf(serviceWorker, windowId))
      .toEqual([LIVE_G_AFTER[0], 'TK', ...LIVE_G_AFTER.slice(1)]);
    keptPinAndGroup(before, await liveStrip(serviceWorker, windowId));
    expect(await groupMovesSoFar(serviceWorker)).not.toContain('TK');

    await sortedToastShows(page);
    await page.keyboard.press('ControlOrMeta+z');
    await expect
      .poll(() => labelsOf(serviceWorker, windowId))
      .toEqual(tabs.map((t) => t.n));
    expect(await liveStrip(serviceWorker, windowId)).toEqual(before);
  });
});
