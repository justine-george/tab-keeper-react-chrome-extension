import type { BrowserContext, Locator, Page, Worker } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { LIGHT_THEME } from '../src/hooks/useThemeColors';

// KAN-331 O15 and KAN-341 on the real artifact: a window row in Open now goes
// to its Chrome window, and a tab click brings back a minimized one. What
// jsdom and the chrome fake cannot show: which window Chrome really puts in
// front, what a minimized or maximized window really comes back as, a real
// :hover and the cursor under a real pointer, a real drag's release over a
// window row, and the row's real geometry as a button and as a plain box.
//
// Every "went there" reads chrome.windows.getLastFocused(), never a window's
// `focused`: in headless Chromium the last-focused window follows a window
// GAINING focus, but the old window's `focused` flag never clears (measured
// 2026-09-28). Every "went nowhere" waits a fixed 500ms, and a CONTROL in
// the same test then shows the same probe see the window go, faster than
// that. The control comes last because the tab view's window cannot be put
// back in front: its stuck `focused` makes windows.update(focused: true) and
// page.bringToFront() both leave getLastFocused() on the other window
// (measured 2026-09-28).

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

const windowState = (worker: Worker, windowId: number): Promise<string> =>
  worker.evaluate(
    async (id: number) => (await chrome.windows.get(id)).state ?? '',
    windowId
  );

const setState = (
  worker: Worker,
  windowId: number,
  state: 'minimized' | 'maximized'
): Promise<void> =>
  worker.evaluate(
    async ({ id, state }) => {
      await chrome.windows.update(id, { state });
    },
    { id: windowId, state }
  );

const activeTabIn = (worker: Worker, windowId: number): Promise<number> =>
  worker.evaluate(
    async (id: number) =>
      (await chrome.tabs.query({ windowId: id, active: true }))[0]?.id ?? -1,
    windowId
  );

const windowOfTab = (worker: Worker, tabId: number): Promise<number> =>
  worker.evaluate(
    async (id: number) => (await chrome.tabs.get(id)).windowId,
    tabId
  );

const isActive = (worker: Worker, tabId: number): Promise<boolean> =>
  worker.evaluate(
    async (id: number) => (await chrome.tabs.get(id)).active,
    tabId
  );

// One Chrome window's block in the Open now pane.
const windowBlock = (page: Page, windowId: number): Locator =>
  page.locator(`${OPEN_NOW} [data-open-window-id="${windowId}"]`);

// The block's own row: chevron, glyph, title, and the Save/Close strip.
const windowRow = (block: Locator): Locator =>
  block.locator('[data-window-row]');

// "Window N": N is the window's place in Chrome's list, so it is read from
// the block rather than assumed.
const windowTitle = (block: Locator): Locator =>
  windowRow(block).getByText(/^Window \d+$/);

// The row's "Go to window" button, by the exact name its title gives it.
async function goTo(block: Locator): Promise<Locator> {
  const title = await windowTitle(block).textContent();
  if (title === null) throw new Error('the window row has no title');
  return windowRow(block).getByRole('button', {
    name: `Go to window: ${title}`,
    exact: true,
  });
}

const anyGoTo = (page: Page): Locator =>
  page.locator(OPEN_NOW).getByRole('button', { name: /^Go to window: / });

const liveRowIn = (block: Locator, title: string): Locator =>
  block.getByRole('button', { name: `Switch to tab: ${title}`, exact: true });

const field = (page: Page): Locator =>
  page
    .locator(OPEN_NOW)
    .getByRole('textbox', { name: 'Search open tabs', exact: true });

// A #RRGGBB token as getComputedStyle spells it.
const rgb = (hex: string): string => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `rgb(${r}, ${g}, ${b})`;
};

const backgroundOf = (locator: Locator): Promise<string> =>
  locator.evaluate((el) => getComputedStyle(el).backgroundColor);

// Somewhere in the sessions pane, over no window row.
const pointerAway = (page: Page) => page.mouse.move(5, 700);

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

test.describe('a window row goes to its window (KAN-331, KAN-341)', () => {
  test('1. PREMISE: a window opened unfocused leaves the tab view in front', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const { home, made } = await setUp(context, extensionId, serviceWorker, [
      'Alpha',
    ]);
    expect(home).not.toBe(made.windowId);
    expect(await lastFocused(serviceWorker)).toBe(home);
  });

  test('2. a click on the row puts its window in front, with the same front tab', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const { block, home, made } = await setUp(
      context,
      extensionId,
      serviceWorker,
      ['Alpha', 'Beta', 'Gamma']
    );
    // Not the first tab, so "unchanged" is not merely Chrome's default.
    const front = made.tabIds[2];
    if (front === undefined) throw new Error('no Gamma tab');
    await serviceWorker.evaluate(async (id: number) => {
      await chrome.tabs.update(id, { active: true });
    }, front);
    await expect
      .poll(() => activeTabIn(serviceWorker, made.windowId))
      .toBe(front);
    // PREMISE: the tab view's window is in front.
    expect(await lastFocused(serviceWorker)).toBe(home);

    const go = await goTo(block);
    await expect(go).toBeVisible();
    await go.click();
    await expect.poll(() => lastFocused(serviceWorker)).toBe(made.windowId);
    expect(await activeTabIn(serviceWorker, made.windowId)).toBe(front);
  });

  test('3. Enter on the focused row puts its window in front', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const { block, home, made } = await setUp(
      context,
      extensionId,
      serviceWorker,
      ['Alpha']
    );
    expect(await lastFocused(serviceWorker)).toBe(home);

    const go = await goTo(block);
    await go.focus();
    await expect(go).toBeFocused();
    await go.page().keyboard.press('Enter');
    await expect.poll(() => lastFocused(serviceWorker)).toBe(made.windowId);
  });

  test('4. M1: a minimized window comes back normal and in front', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const { block, home, made } = await setUp(
      context,
      extensionId,
      serviceWorker,
      ['Alpha']
    );
    await setState(serviceWorker, made.windowId, 'minimized');
    // PREMISE: Chrome really minimized it.
    await expect
      .poll(() => windowState(serviceWorker, made.windowId))
      .toBe('minimized');
    expect(await lastFocused(serviceWorker)).toBe(home);

    await (await goTo(block)).click();
    await expect
      .poll(() => windowState(serviceWorker, made.windowId))
      .toBe('normal');
    await expect.poll(() => lastFocused(serviceWorker)).toBe(made.windowId);
  });

  test('5. a window maximized, then minimized, comes back maximized', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const { block, made } = await setUp(context, extensionId, serviceWorker, [
      'Alpha',
    ]);
    await setState(serviceWorker, made.windowId, 'maximized');
    // PREMISE, and the CONTROL for "comes back maximized": headless can
    // hold a window maximized at all.
    await expect
      .poll(() => windowState(serviceWorker, made.windowId))
      .toBe('maximized');
    await setState(serviceWorker, made.windowId, 'minimized');
    await expect
      .poll(() => windowState(serviceWorker, made.windowId))
      .toBe('minimized');

    await (await goTo(block)).click();
    await expect
      .poll(() => windowState(serviceWorker, made.windowId))
      .toBe('maximized');
    await expect.poll(() => lastFocused(serviceWorker)).toBe(made.windowId);
  });

  test('6. KAN-341: a tab click in a minimized window brings the window back with that tab in front', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const { block, made } = await setUp(context, extensionId, serviceWorker, [
      'Front',
      'Behind',
    ]);
    const behind = made.tabIds[1];
    if (behind === undefined) throw new Error('no Behind tab');
    await setState(serviceWorker, made.windowId, 'minimized');
    // PREMISE: minimized, and the clicked tab is not already the front one.
    await expect
      .poll(() => windowState(serviceWorker, made.windowId))
      .toBe('minimized');
    expect(await isActive(serviceWorker, behind)).toBe(false);

    await liveRowIn(block, 'Behind').click();
    await expect.poll(() => isActive(serviceWorker, behind)).toBe(true);
    await expect
      .poll(() => windowState(serviceWorker, made.windowId))
      .toBe('normal');
    await expect.poll(() => lastFocused(serviceWorker)).toBe(made.windowId);
  });

  test('7. T2: hovering This window shows its strip without shading the row; another row shades', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const { page, homeBlock, block } = await setUp(
      context,
      extensionId,
      serviceWorker,
      ['Alpha']
    );
    const hover = rgb(LIGHT_THEME.HOVER_COLOR);
    const homeRow = windowRow(homeBlock);
    const homeStrip = homeRow.locator('[data-row-actions] > *').first();
    await pointerAway(page);
    const resting = await backgroundOf(homeRow);
    // PREMISE: at rest the row is not the hover colour, so "stays resting"
    // below can tell the two apart.
    console.log(`[7] resting ${resting}, hover ${hover}`);
    expect(resting).not.toBe(hover);
    await expect.poll(() => backgroundOf(windowRow(block))).toBe(resting);

    await windowTitle(homeBlock).hover();
    // The pointer really is over the row: its Save window strip shows.
    await expect
      .poll(() => homeStrip.evaluate((el) => getComputedStyle(el).opacity))
      .toBe('1');
    expect(await backgroundOf(homeRow)).toBe(resting);

    // CONTROL: the same hover on a row that goes to its window shades it.
    await windowTitle(block).hover();
    await expect.poll(() => backgroundOf(windowRow(block))).toBe(hover);
  });

  test("8. a button row's title shows the pointer cursor; This window's does not", async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const { page, homeBlock, block } = await setUp(
      context,
      extensionId,
      serviceWorker,
      ['Alpha']
    );
    const title = await windowTitle(block).textContent();
    const homeTitle = await windowTitle(homeBlock).textContent();

    // CONTROL: the probe reads the title, and can see a pointer.
    const onButton = await cursorOver(page, windowTitle(block));
    expect(onButton.text).toBe(title);
    expect(onButton.cursor).toBe('pointer');

    const onThis = await cursorOver(page, windowTitle(homeBlock));
    console.log(`[8] ${JSON.stringify({ onButton, onThis })}`);
    expect(onThis.text).toBe(homeTitle);
    expect(onThis.cursor).not.toBe('pointer');
  });

  test('9. S2: while a search is held the row is no button and a click on it goes nowhere', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const { page, block, home, made } = await setUp(
      context,
      extensionId,
      serviceWorker,
      ['Kyoto maps', 'Osaka flights']
    );
    await field(page).fill('kyoto');
    await expect(liveRowIn(block, 'Kyoto maps')).toBeVisible();
    await expect(liveRowIn(block, 'Osaka flights')).toHaveCount(0);
    await expect(anyGoTo(page)).toHaveCount(0);
    await expect(windowTitle(block)).toBeVisible();

    await windowTitle(block).click();
    await page.waitForTimeout(QUIET_MS);
    expect(await lastFocused(serviceWorker)).toBe(home);

    // CONTROL: with the search cleared, a click on the same title goes, and
    // well inside the wait above.
    await field(page).press('Escape');
    await expect(field(page)).toHaveValue('');
    const took = await timeUntil(
      () => windowTitle(block).click(),
      () => lastFocused(serviceWorker),
      made.windowId
    );
    console.log(`[9] control focus took ${took}ms`);
    expect(took).toBeLessThan(QUIET_MS);
  });

  test('10. a drag never puts a window in front: not a release over a window row, not a drag that moves nothing', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const { page, home, homeBlock, block, made } = await setUp(
      context,
      extensionId,
      serviceWorker,
      ['Far one', 'Far two']
    );
    const farTwo = made.tabIds[1];
    if (farTwo === undefined) throw new Error('no Far two tab');
    // A tab of This window to drag.
    const homeRow = await serviceWorker.evaluate(
      async ({ windowId, url }) =>
        (await chrome.tabs.create({ windowId, url, active: false })).id ?? -1,
      { windowId: home, url: dataUrl('Home row') }
    );
    await expect(liveRowIn(homeBlock, 'Home row')).toBeVisible();

    // (a) This window's tab, carried onto the other window's row and dropped
    // there: Chrome moves it into that window.
    const from = await liveRowIn(homeBlock, 'Home row').boundingBox();
    if (from === null) throw new Error('Home row has no box');
    const x = from.x + from.width / 2;
    const y = from.y + from.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    // Past the 5px activation distance.
    await page.mouse.move(x, y + 10, { steps: 3 });
    expect(await heldWithin(page, 1000), 'the drag never picked up').toBe(true);
    const to = await windowRow(block).boundingBox();
    if (to === null) throw new Error('the window row has no box');
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, {
      steps: 10,
    });
    await page.waitForTimeout(350);
    // What the release lands on is the held row, which follows the pointer:
    // the window row's own handlers never see it (measured 2026-09-28), so
    // what (a) guards is the cross-window drop itself.
    const underPointer = await page.evaluate(
      ({ x, y }) =>
        (document.elementFromPoint(x, y)?.closest('[data-drag-held]') ??
          null) !== null,
      { x: to.x + to.width / 2, y: to.y + to.height / 2 }
    );
    expect(underPointer, 'the held row is not under the pointer').toBe(true);
    await page.mouse.up();
    // PREMISE: the drop moved the tab into the other window.
    await expect
      .poll(() => windowOfTab(serviceWorker, homeRow))
      .toBe(made.windowId);
    await page.waitForTimeout(QUIET_MS);
    expect(await lastFocused(serviceWorker)).toBe(home);

    // (b) The other window's tab, dragged sideways and released: the drop is
    // a no-op, so Chrome sends a click on the held row (click-after-drag).
    await expect(liveRowIn(block, 'Far two')).toBeVisible();
    expect(await isActive(serviceWorker, farTwo)).toBe(false);
    const row = await liveRowIn(block, 'Far two').boundingBox();
    if (row === null) throw new Error('Far two has no box');
    const rowY = row.y + row.height / 2;
    await page.mouse.move(row.x + 60, rowY);
    await page.mouse.down();
    await page.mouse.move(row.x + 120, rowY, { steps: 6 });
    expect(await heldWithin(page, 1000), 'the no-op drag never held').toBe(
      true
    );
    await page.mouse.up();
    await page.waitForTimeout(QUIET_MS);
    expect(await lastFocused(serviceWorker)).toBe(home);
    expect(await isActive(serviceWorker, farTwo)).toBe(false);

    // CONTROL for (a): a plain click on the row the drag was released over
    // goes, and well inside the waits above.
    const took = await timeUntil(
      async () => (await goTo(block)).click(),
      () => lastFocused(serviceWorker),
      made.windowId
    );
    expect(took).toBeLessThan(QUIET_MS);
    // CONTROL for (b): a plain click on the row dragged sideways switches to
    // its tab (its window is in front already, so the tab is what shows it).
    const tookTab = await timeUntil(
      () => liveRowIn(block, 'Far two').click(),
      () => isActive(serviceWorker, farTwo),
      true
    );
    console.log(`[10] controls took ${took}ms (focus), ${tookTab}ms (tab)`);
    expect(tookTab).toBeLessThan(QUIET_MS);
  });

  test('11. the title does not move when the row stops being a button', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const { page, homeBlock, block } = await setUp(
      context,
      extensionId,
      serviceWorker,
      ['Kyoto maps']
    );
    const measure = async (b: Locator) => {
      const titleBox = await windowTitle(b).boundingBox();
      const rowBox = await windowRow(b).boundingBox();
      if (titleBox === null || rowBox === null) {
        throw new Error('the window row has no box');
      }
      return { x: titleBox.x, height: rowBox.height };
    };
    // PREMISE: one row is a button and the other is not.
    await expect(await goTo(block)).toBeVisible();
    await expect(
      windowRow(homeBlock).getByRole('button', { name: /^Go to window: / })
    ).toHaveCount(0);

    const asButton = await measure(block);
    const asPlain = await measure(homeBlock);
    expect(asButton.x).toBe(asPlain.x);
    expect(asButton.height).toBe(asPlain.height);

    // The same row, made plain by a search (S2), stays where it was.
    await field(page).fill('kyoto');
    await expect(anyGoTo(page)).toHaveCount(0);
    await expect(windowTitle(block)).toBeVisible();
    const underSearch = await measure(block);
    expect(underSearch.x).toBe(asButton.x);
    expect(underSearch.height).toBe(asButton.height);
  });
});
