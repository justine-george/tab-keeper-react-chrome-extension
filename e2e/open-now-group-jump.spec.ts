import type { BrowserContext, Locator, Page, Worker } from '@playwright/test';

import { grantedTest as test, expect } from './fixtures/grantedExtension';

// KAN-797 (pick A) on the real artifact: a click on a live group's title row
// goes to the group, as its right-click's Go to does (KAN-793); its name still
// renames. As open-now-window-jump.spec.ts: every "went there" reads
// chrome.windows.getLastFocused(), every "went nowhere" waits 500ms, and its
// CONTROL comes last, since the tab view's window cannot be put back in front.

const VIEW_TAB = 'index.html?view=tab';
const OPEN_NOW = '[data-pane="open-now"]';
const VIEWPORT = { width: 1600, height: 800 };

// How long a "nothing was focused" check waits, and so the most a control's
// focus may take for that wait to mean anything.
const QUIET_MS = 500;

// The helpers below are copied from open-now-search.spec.ts and
// open-now-close.spec.ts, where they are file-local, as every Open now spec
// keeps its own.

async function openPage(
  context: BrowserContext,
  extensionId: string
): Promise<Page> {
  const page = await context.newPage();
  await page.setViewportSize(VIEWPORT);
  await page.goto(`chrome-extension://${extensionId}/${VIEW_TAB}`);
  // Barrier: goto resolves before React mounts. "Sort sessions" is in the
  // header of both the popup and the tab view.
  await page.getByRole('button', { name: 'Sort sessions' }).waitFor();
  return page;
}

const dataUrl = (title: string) => `data:text/html,<title>${title}</title>`;

interface MadeWindow {
  windowId: number;
  tabIds: number[];
}

// A window the browser opens, unfocused so the tab view stays in front, with
// one data: tab per title, in order.
async function openWindow(
  worker: Worker,
  titles: string[]
): Promise<MadeWindow> {
  const made = await worker.evaluate(async (urls: string[]) => {
    const win = await chrome.windows.create({ focused: false, url: urls });
    const tabIds = (win?.tabs ?? []).flatMap((tab) =>
      tab.id === undefined ? [] : [tab.id]
    );
    if (win?.id === undefined || tabIds.length !== urls.length) return null;
    return { windowId: win.id, tabIds };
  }, titles.map(dataUrl));
  if (made === null) throw new Error('Chrome gave no window or tab ids');
  return made;
}

// The window the tab view is a tab of: Open now's "This window".
async function tabViewWindowId(page: Page): Promise<number> {
  const id = await page.evaluate(
    async () => (await chrome.tabs.getCurrent())?.windowId ?? null
  );
  if (id === null) throw new Error('the tab view is not a tab');
  return id;
}

const lastFocused = (worker: Worker): Promise<number | null> =>
  worker.evaluate(
    async () => (await chrome.windows.getLastFocused()).id ?? null
  );

async function activeTabIn(worker: Worker, windowId: number): Promise<number> {
  const id = await worker.evaluate(
    async (id: number) =>
      (await chrome.tabs.query({ windowId: id, active: true }))[0]?.id ?? null,
    windowId
  );
  if (id === null) throw new Error(`window ${windowId} has no active tab`);
  return id;
}

// One Chrome window's block in the Open now pane.
const windowBlock = (page: Page, windowId: number): Locator =>
  page.locator(`${OPEN_NOW} [data-open-window-id="${windowId}"]`);

const liveRowIn = (block: Locator, title: string): Locator =>
  block.getByRole('button', { name: `Switch to tab: ${title}`, exact: true });

const field = (page: Page): Locator =>
  page
    .locator(OPEN_NOW)
    .getByRole('textbox', { name: 'Search open tabs', exact: true });

// Moves the pointer to the centre of `locator` and reads the cursor of the
// element actually under it: an inherited cursor loses to a descendant's
// own, so the button's cursor alone says nothing about what the title shows.
async function cursorOver(
  page: Page,
  locator: Locator
): Promise<{ cursor: string; text: string }> {
  const box = await locator.boundingBox();
  if (box === null) throw new Error('nothing to point at');
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  const seen = await page.evaluate(
    ({ x, y }) => {
      const el = document.elementFromPoint(x, y);
      return el === null
        ? null
        : { cursor: getComputedStyle(el).cursor, text: el.textContent ?? '' };
    },
    { x, y }
  );
  if (seen === null) throw new Error(`no element at ${x},${y}`);
  return seen;
}

const isHeld = (page: Page) =>
  page.evaluate(() => document.querySelector('[data-drag-held]') !== null);

// Whether a row is held at any point within `ms`.
async function heldWithin(page: Page, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await isHeld(page)) return true;
    await page.waitForTimeout(50);
  }
  return isHeld(page);
}

// Acts, then returns how long `read` took to give `expected`: the CONTROL
// every "went nowhere" leans on, and the evidence that QUIET_MS is long
// enough to have seen it.
async function timeUntil<T>(
  act: () => Promise<void>,
  read: () => Promise<T>,
  expected: T
): Promise<number> {
  const start = Date.now();
  await act();
  await expect.poll(read, { intervals: [25] }).toBe(expected);
  return Date.now() - start;
}

interface Setup {
  page: Page;
  home: number;
  made: MadeWindow;
  homeBlock: Locator;
  block: Locator;
}

// The tab view, then a second window with `titles`, both drawn. The launch
// window's first tab shares it with the tab view, so "This window" is listed.
async function setUp(
  context: BrowserContext,
  extensionId: string,
  worker: Worker,
  titles: string[]
): Promise<Setup> {
  const page = await openPage(context, extensionId);
  const home = await tabViewWindowId(page);
  const made = await openWindow(worker, titles);
  const homeBlock = windowBlock(page, home);
  const block = windowBlock(page, made.windowId);
  // Barrier: the new window's rows and This window are both drawn.
  for (const title of titles) {
    await expect(liveRowIn(block, title)).toBeVisible();
  }
  await expect(
    homeBlock.getByText('This window', { exact: true })
  ).toBeVisible();
  return { page, home, made, homeBlock, block };
}

interface GroupSetup extends Setup {
  groupTabs: number[];
  row: Locator;
}

// A second window whose last two tabs are the group Temples.
async function setUpGroup(
  context: BrowserContext,
  extensionId: string,
  worker: Worker
): Promise<GroupSetup> {
  const setup = await setUp(context, extensionId, worker, [
    'Loose tab',
    'Fushimi hours',
    'Kinkaku tickets',
  ]);
  const [first, second] = setup.made.tabIds.slice(1);
  if (first === undefined || second === undefined)
    throw new Error('no tabs to group');
  await worker.evaluate(
    async ({ tabIds, windowId }) => {
      const id = await chrome.tabs.group({
        tabIds,
        createProperties: { windowId },
      });
      await chrome.tabGroups.update(id, { title: 'Temples', color: 'red' });
    },
    {
      tabIds: [first, second] as [number, number],
      windowId: setup.made.windowId,
    }
  );
  const row = setup.block.locator('[data-group-drag-handle]', {
    has: setup.page.getByRole('button', {
      name: 'Rename group: Temples',
      exact: true,
    }),
  });
  await expect(row).toBeVisible();
  return { ...setup, groupTabs: [first, second], row };
}

const groupName = (row: Locator) =>
  row.getByRole('button', { name: 'Rename group: Temples', exact: true });

// The first point right of the name whose hit is the row itself, a little in.
async function rowSpace(row: Locator): Promise<{ x: number; y: number }> {
  const name = await groupName(row).boundingBox();
  if (name === null) throw new Error('the group name has no box');
  const y = Math.round(name.y + name.height / 2);
  const x = await row.evaluate(
    (el, { from, y }) => {
      for (let x = from; x < from + 400; x += 4) {
        if (document.elementFromPoint(x, y) === el) return x + 16;
      }
      return null;
    },
    { from: Math.round(name.x + name.width + 4), y }
  );
  if (x === null) throw new Error('no bare row space right of the name');
  return { x, y };
}

const cursorAt = (page: Page, at: { x: number; y: number }) =>
  page.evaluate(({ x, y }) => {
    const el = document.elementFromPoint(x, y);
    return el === null ? null : getComputedStyle(el).cursor;
  }, at);

test('a click on the row’s space puts the group’s window in front on one of its tabs; the row shows the pointer, the name the text caret', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  const { page, row, made, groupTabs } = await setUpGroup(
    context,
    extensionId,
    serviceWorker
  );
  const at = await rowSpace(row);
  await page.mouse.move(at.x, at.y);
  expect(await cursorAt(page, at)).toBe('pointer');
  expect((await cursorOver(page, groupName(row))).cursor).toBe('text');

  await page.mouse.click(at.x, at.y);
  await expect.poll(() => lastFocused(serviceWorker)).toBe(made.windowId);
  const front = await activeTabIn(serviceWorker, made.windowId);
  expect(groupTabs).toContain(front);
});

test('a click on the name opens its field and goes nowhere', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  const { page, row, home, made } = await setUpGroup(
    context,
    extensionId,
    serviceWorker
  );
  await groupName(row).click();
  await expect(page.getByPlaceholder('Name this group')).toBeFocused();
  await page.waitForTimeout(QUIET_MS);
  expect(await lastFocused(serviceWorker)).toBe(home);

  // CONTROL: Esc, then the row's space goes, well inside the wait above.
  await page.keyboard.press('Escape');
  const at = await rowSpace(row);
  const took = await timeUntil(
    () => page.mouse.click(at.x, at.y),
    () => lastFocused(serviceWorker),
    made.windowId
  );
  expect(took).toBeLessThan(QUIET_MS);
});

test('a drag of the group that moves nothing goes nowhere', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  const { page, row, home, made } = await setUpGroup(
    context,
    extensionId,
    serviceWorker
  );
  const at = await rowSpace(row);
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.move(at.x + 60, at.y, { steps: 6 });
  expect(await heldWithin(page, 1000), 'the drag never held').toBe(true);
  await page.mouse.up();
  await page.waitForTimeout(QUIET_MS);
  expect(await lastFocused(serviceWorker)).toBe(home);

  // CONTROL: a plain click at the same point goes.
  const took = await timeUntil(
    () => page.mouse.click(at.x, at.y),
    () => lastFocused(serviceWorker),
    made.windowId
  );
  expect(took).toBeLessThan(QUIET_MS);
});

test('while a search is held the row goes nowhere', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  const { page, row, home, made } = await setUpGroup(
    context,
    extensionId,
    serviceWorker
  );
  await field(page).fill('Fushimi');
  await expect(row).toBeVisible();
  const at = await rowSpace(row);
  expect(await cursorAt(page, at)).not.toBe('pointer');
  await page.mouse.click(at.x, at.y);
  await page.waitForTimeout(QUIET_MS);
  expect(await lastFocused(serviceWorker)).toBe(home);

  // CONTROL: with the search cleared, the same row goes.
  await field(page).press('Escape');
  await expect(field(page)).toHaveValue('');
  const again = await rowSpace(row);
  const took = await timeUntil(
    () => page.mouse.click(again.x, again.y),
    () => lastFocused(serviceWorker),
    made.windowId
  );
  expect(took).toBeLessThan(QUIET_MS);
});
