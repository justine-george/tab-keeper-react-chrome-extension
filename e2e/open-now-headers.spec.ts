import type { Locator, Page, Worker } from '@playwright/test';

import { grantedTest as test, expect } from './fixtures/grantedExtension';
import { openNowWindowMenu } from './fixtures/menus';
import { openPage } from './fixtures/onboarding';
import { standIn } from './fixtures/standInPages';
import { isValidTabMasterContainer } from '../src/utils/functions/local';

// KAN-696 on the real extension: Open now's window strip (Save, then a ⋮ with
// Close window) and a live group's strip (Save, then a ⋮ with Ungroup and
// Close group). What jsdom cannot model: Chrome's own group rules on a Reopen
// into a window that changed meanwhile, the focus after a real close, and the
// reveal of a strip by keyboard focus and not by a mouse elsewhere.
//
// `sessions` is refused (as open-now-close.spec.ts does): a close then asks for
// it, Chrome declines, and Reopen recreates. A group's Reopen recreates either
// way, since Chrome keeps no history of a group.

test.use({ refuseSessions: true });

const VIEW_TAB = 'index.html?view=tab';
const TAB_VIEWPORT = { width: 1280, height: 800 };
const OPEN_NOW = '[data-pane="open-now"]';

interface GroupSpec {
  title: string;
  color: 'blue' | 'green' | 'red';
  // The tabs it holds, as indices into the window's names.
  from: number;
  to: number;
  collapsed?: boolean;
}

interface MadeWindow {
  windowId: number;
  tabIds: number[];
  groupIds: number[];
}

// A window of stand-in pages titled `names`, in order, with the groups given.
async function makeWindow(
  worker: Worker,
  names: string[],
  groups: GroupSpec[] = []
): Promise<MadeWindow> {
  const made = await worker.evaluate(
    async ({ urls, groups }) => {
      const win = await chrome.windows.create({ url: urls, focused: false });
      const tabIds = (win?.tabs ?? []).flatMap((tab) =>
        tab.id === undefined ? [] : [tab.id]
      );
      if (win?.id === undefined || tabIds.length !== urls.length) return null;
      const groupIds: number[] = [];
      for (const group of groups) {
        const [head, ...rest] = tabIds.slice(group.from, group.to + 1);
        if (head === undefined) continue;
        const groupId = await chrome.tabs.group({
          tabIds: [head, ...rest],
          createProperties: { windowId: win.id },
        });
        await chrome.tabGroups.update(groupId, {
          title: group.title,
          color: group.color,
        });
        if (group.collapsed) {
          await chrome.tabGroups.update(groupId, { collapsed: true });
        }
        groupIds.push(groupId);
      }
      return { windowId: win.id, tabIds, groupIds };
    },
    { urls: names.map(standIn), groups }
  );
  if (made === null) throw new Error('Chrome gave no window or tab ids');
  return made;
}

interface TabFacts {
  id: number;
  name: string;
  index: number;
  groupId: number;
}

interface GroupFacts {
  title: string;
  color: string;
  collapsed: boolean;
}

// The page's name out of a stand-in address (or a Tab Keeper page's).
const nameOf = (url: string): string =>
  decodeURIComponent(new URL(url).pathname.slice(1));

// What Chrome says about a window's tabs in order; [] once it has gone.
const tabsOf = (worker: Worker, windowId: number): Promise<TabFacts[]> =>
  worker
    .evaluate(async (windowId) => {
      const tabs = await chrome.tabs.query({ windowId }).catch(() => []);
      return tabs
        .sort((a, b) => a.index - b.index)
        .map((tab) => ({
          id: tab.id ?? -1,
          url: tab.url || tab.pendingUrl || '',
          index: tab.index,
          groupId: tab.groupId,
        }));
    }, windowId)
    .then((tabs) =>
      tabs.map(({ url, ...rest }) => ({ ...rest, name: nameOf(url) }))
    );

const groupFacts = (worker: Worker, groupId: number): Promise<GroupFacts> =>
  worker.evaluate(async (groupId) => {
    const { title, color, collapsed } = await chrome.tabGroups.get(groupId);
    return { title: title ?? '', color, collapsed };
  }, groupId);

const allWindowIds = (worker: Worker): Promise<number[]> =>
  worker.evaluate(async () =>
    (await chrome.windows.getAll()).flatMap((w) =>
      w.id === undefined ? [] : [w.id]
    )
  );

// Every window now holding a tab named `name`.
const windowsHolding = (worker: Worker, name: string): Promise<number[]> =>
  worker.evaluate(async (name) => {
    const tabs = await chrome.tabs.query({});
    return [
      ...new Set(
        tabs
          .filter((tab) => {
            const url = tab.url || tab.pendingUrl || '';
            return url !== '' && new URL(url).pathname === `/${name}`;
          })
          .map((tab) => tab.windowId)
      ),
    ];
  }, encodeURIComponent(name));

const windowBlock = (page: Page, windowId: number): Locator =>
  page.locator(`${OPEN_NOW} [data-open-window-id="${windowId}"]`);

const liveRowIn = (block: Locator, title: string): Locator =>
  block.getByRole('button', { name: `Switch to tab: ${title}`, exact: true });

const band = (block: Locator, name: string): Locator =>
  block.getByRole('group', { name, exact: true });

const groupStrip = (bandBlock: Locator): Locator =>
  bandBlock.locator('[data-group-drag-handle] [data-row-actions]');

const groupSave = (bandBlock: Locator, name: string): Locator =>
  groupStrip(bandBlock).getByRole('button', {
    name: `Save group as a session: ${name}`,
    exact: true,
  });

const groupMenu = (bandBlock: Locator, name: string): Locator =>
  groupStrip(bandBlock).getByRole('button', {
    name: `More actions: ${name}`,
    exact: true,
  });

const reopenButton = (page: Page): Locator =>
  page.getByRole('status').getByRole('button', { name: 'Reopen', exact: true });

// The first menu item named `name`, with the group's ⋮ already open.
async function chooseGroupMenuItem(
  page: Page,
  bandBlock: Locator,
  groupName: string,
  item: string
): Promise<void> {
  await bandBlock.locator('[data-group-drag-handle]').hover();
  await groupMenu(bandBlock, groupName).click();
  await page.getByRole('menuitem', { name: item, exact: true }).click();
}

// The tab view, mounted (openPage waits for its header).
const tabViewPage = (
  context: Parameters<typeof openPage>[0],
  extensionId: string
): Promise<Page> => openPage(context, extensionId, VIEW_TAB, TAB_VIEWPORT);

// Sessions as saved in localStorage, trimmed to what these tests compare.
const stored = async (page: Page) => {
  const raw = await page.evaluate(() =>
    localStorage.getItem('tabContainerData')
  );
  const parsed: unknown = JSON.parse(raw ?? 'null');
  if (!isValidTabMasterContainer(parsed)) return [];
  return parsed.tabGroups.map((session) => ({
    windowCount: session.windowCount,
    tabCount: session.tabCount,
    tabs: session.windows.flatMap((w) =>
      w.tabs.map((t) => ({
        name: nameOf(t.url),
        chromeGroupId: t.chromeGroupId ?? null,
      }))
    ),
    groups: session.windows.flatMap((w) =>
      (w.chromeTabGroups ?? []).map((g) => ({
        groupId: g.groupId,
        title: g.title,
        color: g.color,
      }))
    ),
  }));
};

const names = (tabs: TabFacts[]): string[] => tabs.map((t) => t.name);

test('(a) a window strip Save adds one session and closes nothing', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  const page = await tabViewPage(context, extensionId);
  const made = await makeWindow(serviceWorker, ['Temples-a', 'Gardens-a']);
  const block = windowBlock(page, made.windowId);
  await expect(liveRowIn(block, 'Temples-a')).toBeVisible();
  await expect(liveRowIn(block, 'Gardens-a')).toBeVisible();
  const before = (await stored(page)).length;

  // The labeled button, named by its window; its visible text is "Save".
  const save = block
    .locator('[data-window-row] [data-row-actions]')
    .getByRole('button', { name: /^Save window as a session: / });
  await expect(save).toHaveText(/Save$/);
  await block.locator('[data-window-row]').hover();
  await save.click();

  await expect(page.getByRole('status')).toContainText(
    'Window saved as a session.'
  );
  await expect.poll(async () => (await stored(page)).length).toBe(before + 1);
  const saved = (await stored(page))[before];
  expect(saved.tabs.map((t) => t.name)).toEqual(['Temples-a', 'Gardens-a']);
  // Nothing closed: the window and both tabs are still there.
  expect(names(await tabsOf(serviceWorker, made.windowId))).toEqual([
    'Temples-a',
    'Gardens-a',
  ]);
  await expect(liveRowIn(block, 'Temples-a')).toBeVisible();
});

test('(b) Close window from the menu closes it, and the toast Reopen brings it back', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  const page = await tabViewPage(context, extensionId);
  const made = await makeWindow(serviceWorker, ['Temples-b', 'Gardens-b']);
  const block = windowBlock(page, made.windowId);
  await expect(liveRowIn(block, 'Gardens-b')).toBeVisible();

  await block.locator('[data-window-row]').hover();
  await openNowWindowMenu(page, block).click();
  await page
    .getByRole('menuitem', { name: 'Close window', exact: true })
    .click();

  await expect
    .poll(() => allWindowIds(serviceWorker))
    .not.toContain(made.windowId);
  await expect(page.getByRole('status')).toContainText(
    'Window closed (2 tabs).'
  );
  await reopenButton(page).click();

  // A new window, holding the same pages in order. Polled: Chrome settles a
  // recreate a call at a time.
  await expect
    .poll(() => windowsHolding(serviceWorker, 'Gardens-b'))
    .toHaveLength(1);
  const [reopenedId] = await windowsHolding(serviceWorker, 'Gardens-b');
  expect(reopenedId).not.toBe(made.windowId);
  await expect
    .poll(async () => names(await tabsOf(serviceWorker, reopenedId)))
    .toEqual(['Temples-b', 'Gardens-b']);
});

test('(c) a double-click on Close window closes exactly one window', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  const page = await tabViewPage(context, extensionId);
  const first = await makeWindow(serviceWorker, ['First-c']);
  const second = await makeWindow(serviceWorker, ['Second-c']);
  const firstBlock = windowBlock(page, first.windowId);
  await expect(liveRowIn(firstBlock, 'First-c')).toBeVisible();
  await expect(
    liveRowIn(windowBlock(page, second.windowId), 'Second-c')
  ).toBeVisible();
  const before = await allWindowIds(serviceWorker);
  expect(before).toEqual(
    expect.arrayContaining([first.windowId, second.windowId])
  );

  await firstBlock.locator('[data-window-row]').hover();
  await openNowWindowMenu(page, firstBlock).click();
  // Records every click the page is sent, from the window's capture phase so
  // it runs before the guard's own listener (added on the first click).
  await page.evaluate(() => {
    const seen: { detail: number; target: string }[] = [];
    (window as unknown as { clicksSeen: typeof seen }).clicksSeen = seen;
    window.addEventListener(
      'click',
      (e) => {
        const el = e.target instanceof Element ? e.target : null;
        const labelled = el?.closest('[aria-label]');
        seen.push({
          detail: e.detail,
          target: labelled?.getAttribute('aria-label') ?? el?.tagName ?? '',
        });
      },
      true
    );
  });
  await page
    .getByRole('menuitem', { name: 'Close window', exact: true })
    .dblclick();

  // PREMISE: both halves reached the page (detail 1, then detail 2), so the
  // second click was really sent after the first had closed the window and the
  // menu; only the guard can stop it acting.
  const clicks = () =>
    page.evaluate(
      () =>
        (window as unknown as { clicksSeen: { detail: number }[] }).clicksSeen
    );
  await expect
    .poll(async () => (await clicks()).map((c) => c.detail))
    .toEqual([1, 2]);

  // PREMISE: the first half of the double-click closed the window.
  await expect
    .poll(() => allWindowIds(serviceWorker))
    .not.toContain(first.windowId);
  // Then a second of watching: nothing else closes.
  const expected = before.filter((id) => id !== first.windowId).sort();
  const until = Date.now() + 1000;
  while (Date.now() < until) {
    expect((await allWindowIds(serviceWorker)).sort()).toEqual(expected);
    await page.waitForTimeout(100);
  }
});

test('(d) a group strip Save saves only the group, whole, and closes nothing', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  const page = await tabViewPage(context, extensionId);
  const made = await makeWindow(
    serviceWorker,
    ['Loose-d', 'Temples-d', 'Gardens-d', 'Tail-d'],
    [{ title: 'Kyoto', color: 'blue', from: 1, to: 2 }]
  );
  const block = windowBlock(page, made.windowId);
  const kyoto = band(block, 'Kyoto');
  await expect(liveRowIn(block, 'Tail-d')).toBeVisible();
  await expect(kyoto).toBeVisible();
  const before = (await stored(page)).length;

  await kyoto.locator('[data-group-drag-handle]').hover();
  await expect(groupSave(kyoto, 'Kyoto')).toHaveText(/Save$/);
  await groupSave(kyoto, 'Kyoto').click();

  await expect(page.getByRole('status')).toContainText(
    'Group saved as a session.'
  );
  await expect.poll(async () => (await stored(page)).length).toBe(before + 1);
  const saved = (await stored(page))[before];
  expect(saved.tabs.map((t) => t.name)).toEqual(['Temples-d', 'Gardens-d']);
  // One group, the same title and colour, holding both.
  expect(saved.groups).toHaveLength(1);
  expect(saved.groups[0]).toMatchObject({ title: 'Kyoto', color: 'blue' });
  expect(saved.tabs.map((t) => t.chromeGroupId)).toEqual([
    saved.groups[0].groupId,
    saved.groups[0].groupId,
  ]);
  // Every live tab is still open, in its group.
  const live = await tabsOf(serviceWorker, made.windowId);
  expect(live.map((t) => [t.name, t.groupId])).toEqual([
    ['Loose-d', -1],
    ['Temples-d', made.groupIds[0]],
    ['Gardens-d', made.groupIds[0]],
    ['Tail-d', -1],
  ]);
});

test('(e) Ungroup leaves the tabs where they were, ungrouped', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  const page = await tabViewPage(context, extensionId);
  const made = await makeWindow(
    serviceWorker,
    ['Loose-e', 'Temples-e', 'Gardens-e', 'Tail-e'],
    [{ title: 'Kyoto', color: 'blue', from: 1, to: 2 }]
  );
  const block = windowBlock(page, made.windowId);
  await expect(band(block, 'Kyoto')).toBeVisible();
  const ids = (await tabsOf(serviceWorker, made.windowId)).map((t) => t.id);

  await chooseGroupMenuItem(page, band(block, 'Kyoto'), 'Kyoto', 'Ungroup');

  await expect
    .poll(async () =>
      (await tabsOf(serviceWorker, made.windowId)).map((t) => [
        t.name,
        t.index,
        t.groupId,
      ])
    )
    .toEqual([
      ['Loose-e', 0, -1],
      ['Temples-e', 1, -1],
      ['Gardens-e', 2, -1],
      ['Tail-e', 3, -1],
    ]);
  // The same tabs: ungrouping closed and recreated nothing.
  expect((await tabsOf(serviceWorker, made.windowId)).map((t) => t.id)).toEqual(
    ids
  );
  await expect(band(block, 'Kyoto')).toHaveCount(0);
});

test('(f) Close group then Reopen: the members return to their indices in the group that stayed, and a Tab Keeper page in it never closes', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  const page = await tabViewPage(context, extensionId);
  const made = await makeWindow(
    serviceWorker,
    ['Loose-f', 'Temples-f', 'Gardens-f', 'Pad-f'],
    []
  );
  // Pad-f becomes a Tab Keeper page, which Close group leaves open; the group
  // is Temples, Gardens, it, so the members sit at indices 1 and 2.
  const keeperTabId = await serviceWorker.evaluate(
    async ({ tabId, url }) => {
      const tab = await chrome.tabs.update(tabId, { url });
      return tab?.id ?? -1;
    },
    {
      tabId: made.tabIds[3],
      url: `chrome-extension://${extensionId}/${VIEW_TAB}`,
    }
  );
  expect(keeperTabId).toBe(made.tabIds[3]);
  const groupId = await serviceWorker.evaluate(
    async ({ first, rest, windowId }) => {
      const id = await chrome.tabs.group({
        tabIds: [first, ...rest],
        createProperties: { windowId },
      });
      await chrome.tabGroups.update(id, { title: 'Kyoto', color: 'blue' });
      return id;
    },
    {
      first: made.tabIds[1],
      rest: made.tabIds.slice(2),
      windowId: made.windowId,
    }
  );
  const block = windowBlock(page, made.windowId);
  await expect(band(block, 'Kyoto')).toBeVisible();
  await expect(liveRowIn(block, 'Gardens-f')).toBeVisible();
  const startFacts = await tabsOf(serviceWorker, made.windowId);
  expect(startFacts.map((t) => [t.index, t.groupId])).toEqual([
    [0, -1],
    [1, groupId],
    [2, groupId],
    [3, groupId],
  ]);

  await chooseGroupMenuItem(page, band(block, 'Kyoto'), 'Kyoto', 'Close group');

  // The members are gone; the Tab Keeper page is the same tab, still in the
  // group, now at index 1.
  await expect
    .poll(async () =>
      (await tabsOf(serviceWorker, made.windowId)).map((t) => [
        t.id,
        t.index,
        t.groupId,
      ])
    )
    .toEqual([
      [made.tabIds[0], 0, -1],
      [keeperTabId, 1, groupId],
    ]);
  await expect(page.getByRole('status')).toContainText(
    'Group closed (2 tabs).'
  );

  await reopenButton(page).click();

  await expect
    .poll(async () =>
      (await tabsOf(serviceWorker, made.windowId)).map((t) => [
        t.index,
        t.groupId,
        t.id === keeperTabId,
      ])
    )
    .toEqual([
      [0, -1, false],
      [1, groupId, false],
      [2, groupId, false],
      [3, groupId, true],
    ]);
  const back = await tabsOf(serviceWorker, made.windowId);
  expect(back[1].name).toBe('Temples-f');
  expect(back[2].name).toBe('Gardens-f');
  expect(await groupFacts(serviceWorker, groupId)).toEqual({
    title: 'Kyoto',
    color: 'blue',
    collapsed: false,
  });
});

test('(g) Close group on a window that is only that group, then Reopen: a new window holds the group', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  const page = await tabViewPage(context, extensionId);
  const made = await makeWindow(
    serviceWorker,
    ['Temples-g', 'Gardens-g'],
    [{ title: 'Solo', color: 'green', from: 0, to: 1 }]
  );
  const block = windowBlock(page, made.windowId);
  await expect(band(block, 'Solo')).toBeVisible();
  await expect(liveRowIn(block, 'Gardens-g')).toBeVisible();

  await chooseGroupMenuItem(page, band(block, 'Solo'), 'Solo', 'Close group');

  await expect
    .poll(() => allWindowIds(serviceWorker))
    .not.toContain(made.windowId);
  await expect(page.getByRole('status')).toContainText(
    'Group closed (2 tabs).'
  );
  await reopenButton(page).click();

  await expect
    .poll(() => windowsHolding(serviceWorker, 'Gardens-g'))
    .toHaveLength(1);
  const [reopenedId] = await windowsHolding(serviceWorker, 'Gardens-g');
  expect(reopenedId).not.toBe(made.windowId);
  await expect
    .poll(async () =>
      (await tabsOf(serviceWorker, reopenedId)).map((t) => [t.name, t.index])
    )
    .toEqual([
      ['Temples-g', 0],
      ['Gardens-g', 1],
    ]);
  const [first, second] = await tabsOf(serviceWorker, reopenedId);
  expect(first.groupId).not.toBe(-1);
  expect(second.groupId).toBe(first.groupId);
  expect(await groupFacts(serviceWorker, first.groupId)).toMatchObject({
    title: 'Solo',
    color: 'green',
  });
});

test('(h) the group strip shows for keyboard focus on its Save, and not for a mouse elsewhere', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  const page = await tabViewPage(context, extensionId);
  const made = await makeWindow(
    serviceWorker,
    ['Loose-h', 'Temples-h', 'Gardens-h', 'Sushi-h', 'Ramen-h'],
    [
      { title: 'Kyoto', color: 'blue', from: 1, to: 2 },
      { title: 'Food', color: 'red', from: 3, to: 4 },
    ]
  );
  const block = windowBlock(page, made.windowId);
  const kyoto = band(block, 'Kyoto');
  const food = band(block, 'Food');
  await expect(kyoto).toBeVisible();
  await expect(food).toBeVisible();
  const opacityOf = (control: Locator) =>
    control.evaluate((el) => getComputedStyle(el).opacity);
  const kyotoSave = groupSave(kyoto, 'Kyoto');
  const foodSave = groupSave(food, 'Food');

  // At rest, with the mouse on neither.
  await page.mouse.move(2, 2);
  await expect.poll(() => opacityOf(kyotoSave)).toBe('0');
  await expect.poll(() => opacityOf(foodSave)).toBe('0');

  // CONTROL: hovering Food's title row draws Food's strip; Kyoto's, which the
  // mouse is elsewhere from, stays hidden.
  await food.locator('[data-group-drag-handle]').hover();
  await expect.poll(() => opacityOf(foodSave)).toBe('1');
  expect(await opacityOf(kyotoSave)).toBe('0');
  await page.mouse.move(2, 2);
  await expect.poll(() => opacityOf(foodSave)).toBe('0');

  // The keyboard: from the colour control, Tab to the name, Tab to Save.
  await kyoto
    .getByRole('button', { name: 'Change group color: Kyoto', exact: true })
    .focus();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await expect(kyotoSave).toBeFocused();
  await expect.poll(() => opacityOf(kyotoSave)).toBe('1');
  expect(await opacityOf(foodSave)).toBe('0');
  // The mouse over the centre of a loose tab row, clear of both groups.
  const looseRow = liveRowIn(block, 'Loose-h');
  await looseRow.hover();
  // Proves the hover is really on that row: its own Close tab shows.
  await expect
    .poll(() =>
      opacityOf(block.getByRole('button', { name: 'Close tab: Loose-h' }))
    )
    .toBe('1');
  // Proves a mouse elsewhere does not show Food's strip: it stays hidden for
  // half a second after the hover took effect. Proves keyboard focus still
  // holds Kyoto's strip and its Save focused while the mouse is elsewhere.
  const until = Date.now() + 500;
  while (Date.now() < until) {
    expect(await opacityOf(foodSave)).toBe('0');
    expect(await opacityOf(kyotoSave)).toBe('1');
    await page.waitForTimeout(50);
  }
  await expect(kyotoSave).toBeFocused();
});

test('(i) Reopen into a window where another group now spans the old index: the members return together, in order, in their own group, and the other group is unchanged', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  const page = await tabViewPage(context, extensionId);
  const made = await makeWindow(
    serviceWorker,
    ['Anchor-i', 'Temples-i', 'Gardens-i', 'Tail-i'],
    [{ title: 'Kyoto', color: 'blue', from: 1, to: 2 }]
  );
  const block = windowBlock(page, made.windowId);
  await expect(band(block, 'Kyoto')).toBeVisible();
  await expect(liveRowIn(block, 'Tail-i')).toBeVisible();

  await chooseGroupMenuItem(page, band(block, 'Kyoto'), 'Kyoto', 'Close group');
  await expect
    .poll(async () => names(await tabsOf(serviceWorker, made.windowId)))
    .toEqual(['Anchor-i', 'Tail-i']);
  await expect(reopenButton(page)).toBeVisible();

  // Meanwhile another group H takes the old place: Anchor and two new tabs,
  // indices 0-2, so the old index 1 falls strictly inside H's run.
  const hId = await serviceWorker.evaluate(
    async ({ windowId, anchorId, urls }) => {
      const first = await chrome.tabs.create({
        windowId,
        url: urls[0],
        index: 1,
        active: false,
      });
      const second = await chrome.tabs.create({
        windowId,
        url: urls[1],
        index: 2,
        active: false,
      });
      const id = await chrome.tabs.group({
        tabIds: [anchorId, first.id ?? -1, second.id ?? -1],
        createProperties: { windowId },
      });
      await chrome.tabGroups.update(id, { title: 'Hotels', color: 'red' });
      return id;
    },
    {
      windowId: made.windowId,
      anchorId: made.tabIds[0],
      urls: [standIn('Inn-i'), standIn('Hostel-i')],
    }
  );
  await expect(band(block, 'Hotels')).toBeVisible();
  const hotelsBefore = (await tabsOf(serviceWorker, made.windowId))
    .filter((t) => t.groupId === hId)
    .map((t) => [t.id, t.name]);
  // PREMISE: Hotels spans indices 0-2, so the old index 1 is strictly inside.
  expect(
    (await tabsOf(serviceWorker, made.windowId))
      .filter((t) => t.groupId === hId)
      .map((t) => t.index)
  ).toEqual([0, 1, 2]);
  expect(hotelsBefore.map(([, name]) => name)).toEqual([
    'Anchor-i',
    'Inn-i',
    'Hostel-i',
  ]);

  await reopenButton(page).click();

  await expect
    .poll(async () => names(await tabsOf(serviceWorker, made.windowId)).length)
    .toBe(6);
  const after = await tabsOf(serviceWorker, made.windowId);
  const member = (name: string) => after.find((t) => t.name === name);
  const temples = member('Temples-i');
  const gardens = member('Gardens-i');
  if (temples === undefined || gardens === undefined) {
    throw new Error(`members missing: ${JSON.stringify(after)}`);
  }
  // Together, in order, adjacent, in a group of their own.
  expect(temples.groupId).not.toBe(-1);
  expect(temples.groupId).not.toBe(hId);
  expect(gardens.groupId).toBe(temples.groupId);
  expect(gardens.index).toBe(temples.index + 1);
  expect(await groupFacts(serviceWorker, temples.groupId)).toEqual({
    title: 'Kyoto',
    color: 'blue',
    collapsed: false,
  });
  // The other group: the same three tabs, in order, still its own.
  const hotels = after.filter((t) => t.groupId === hId);
  expect(hotels.map((t) => [t.id, t.name])).toEqual(hotelsBefore);
  expect(hotels[2].index - hotels[0].index).toBe(2);
  expect(await groupFacts(serviceWorker, hId)).toEqual({
    title: 'Hotels',
    color: 'red',
    collapsed: false,
  });
  // The tab that was never grouped is still loose.
  expect(member('Tail-i')?.groupId).toBe(-1);
});

test('(j) Close group by keyboard leaves focus on the window chevron', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  const page = await tabViewPage(context, extensionId);
  const made = await makeWindow(
    serviceWorker,
    ['Loose-j', 'Temples-j', 'Gardens-j'],
    [{ title: 'Kyoto', color: 'blue', from: 1, to: 2 }]
  );
  const block = windowBlock(page, made.windowId);
  const kyoto = band(block, 'Kyoto');
  await expect(kyoto).toBeVisible();

  // Colour control, Tab to the name, Save, then the ⋮.
  await kyoto
    .getByRole('button', { name: 'Change group color: Kyoto', exact: true })
    .focus();
  for (let i = 0; i < 3; i++) await page.keyboard.press('Tab');
  await expect(groupMenu(kyoto, 'Kyoto')).toBeFocused();
  await page.keyboard.press('Enter');
  const closeGroup = page.getByRole('menuitem', {
    name: 'Close group',
    exact: true,
  });
  await expect(closeGroup).toBeVisible();
  for (
    let i = 0;
    i < 3 &&
    !(await closeGroup.evaluate((el) => el === document.activeElement));
    i++
  ) {
    await page.keyboard.press('ArrowDown');
  }
  await expect(closeGroup).toBeFocused();
  await page.keyboard.press('Enter');

  await expect
    .poll(async () => names(await tabsOf(serviceWorker, made.windowId)))
    .toEqual(['Loose-j']);
  // The window survives, and its chevron has the focus.
  const chevron = block.getByRole('button', { name: /^Collapse: / });
  await expect(chevron).toBeFocused();
  expect(await chevron.evaluate((el) => el === document.activeElement)).toBe(
    true
  );
});

test('(k) a collapsed group comes back collapsed', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  const page = await tabViewPage(context, extensionId);
  const made = await makeWindow(
    serviceWorker,
    ['Loose-k', 'Temples-k', 'Gardens-k'],
    [{ title: 'Kyoto', color: 'blue', from: 1, to: 2, collapsed: true }]
  );
  const block = windowBlock(page, made.windowId);
  await expect(band(block, 'Kyoto')).toBeVisible();
  expect(
    (await groupFacts(serviceWorker, made.groupIds[0])).collapsed,
    'PREMISE: the group is collapsed'
  ).toBe(true);

  await chooseGroupMenuItem(page, band(block, 'Kyoto'), 'Kyoto', 'Close group');
  await expect
    .poll(async () => names(await tabsOf(serviceWorker, made.windowId)))
    .toEqual(['Loose-k']);
  await reopenButton(page).click();

  await expect
    .poll(async () =>
      (await tabsOf(serviceWorker, made.windowId)).map((t) => [t.name, t.index])
    )
    .toEqual([
      ['Loose-k', 0],
      ['Temples-k', 1],
      ['Gardens-k', 2],
    ]);
  const [, temples, gardens] = await tabsOf(serviceWorker, made.windowId);
  expect(temples.groupId).not.toBe(-1);
  expect(gardens.groupId).toBe(temples.groupId);
  expect(await groupFacts(serviceWorker, temples.groupId)).toEqual({
    title: 'Kyoto',
    color: 'blue',
    collapsed: true,
  });
});
