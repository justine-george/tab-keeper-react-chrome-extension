import type { Locator, Page, Worker } from '@playwright/test';

import { expect, grantedTest as test } from './fixtures/grantedExtension';
import { openTabView, session, tab, win } from './fixtures/betweenSessions';
import {
  carryTo,
  liveRow,
  openLiveWindow,
  strip,
  tabCount,
} from './fixtures/liveWindows';
import { boxOf, pickUp } from './fixtures/sessionDrag';

// KAN-949 on the real artifact: an open tab, pair or group dragged in Currently open is offered the header's
// New window box and the box below the last window; let go on either, it moves into a new window of its own.
// What the fake cannot show: Chrome's answer to windows.create({tabId}) and the rest of each route, the
// engine's landings on boxes drawn at pick-up, and the list's re-read.
//
// Every live tab is a data: page in a window the worker opens unfocused; Tab Keeper's page is in the launch
// window, which Open now does not list.

const OPEN_NOW = '[data-pane="open-now"]';
const HEADER_BOX = `${OPEN_NOW} [data-new-window-target="open-now-first"]`;
const LAST_BOX = `${OPEN_NOW} [data-new-window-target="open-now-last"]`;
const TOOLBAR = `${OPEN_NOW} [data-shows-new-window]`;
const SCROLLER = `${OPEN_NOW} [data-open-now-scroller]`;
const UNDO_MOVE = "Couldn't undo the move. Those tabs moved or closed since.";

const toasts = (page: Page) =>
  page.locator('[role="status"] > [data-toast]:not([aria-hidden="true"])');

const liveHandle = (page: Page, tabId: number) =>
  page.locator(`${OPEN_NOW} [data-drag-row-id="${tabId}"]`);
const liveGroupHandle = (page: Page, groupId: number) =>
  page.locator(
    `${OPEN_NOW} [data-drag-row-id="group:${groupId}"] [data-group-drag-handle]`
  );

const setUp = async (
  context: Parameters<typeof openTabView>[0],
  extensionId: string
) => {
  const page = await openTabView(context, extensionId, false, [
    session('S1', 'Trip', [win('w1', [tab('s0'), tab('s1')])]),
  ]);
  return page;
};

async function middleOf(el: Locator) {
  const b = await boxOf(el);
  return { x: b.x + Math.min(80, b.width / 2), y: b.y + b.height / 2 };
}

// The header's title: on the header, clear of its controls.
const headerAim = (page: Page) =>
  middleOf(page.locator(`${OPEN_NOW} [data-open-now-header] h2`));

const windowIds = (worker: Worker) =>
  worker.evaluate(async () =>
    (await chrome.windows.getAll({ windowTypes: ['normal'] })).map(
      (w) => w.id ?? -1
    )
  );

// The one window listed now that `before` did not list.
async function madeWindow(worker: Worker, before: number[]): Promise<number> {
  await expect
    .poll(async () => (await windowIds(worker)).length)
    .toBe(before.length + 1);
  const made = (await windowIds(worker)).find((id) => !before.includes(id));
  if (made === undefined) throw new Error('no new window');
  return made;
}

const lastFocused = (worker: Worker) =>
  worker.evaluate(async () => (await chrome.windows.getLastFocused()).id);

const anyNewTab = (worker: Worker) =>
  worker.evaluate(async () =>
    (await chrome.tabs.query({})).some((t) =>
      (t.pendingUrl || t.url || '').startsWith('chrome://newtab')
    )
  );

const ids = async (worker: Worker, windowId: number) =>
  (await strip(worker, windowId)).map((t) => t.id);

async function makeGroup(
  worker: Worker,
  windowId: number,
  tabIds: [number, ...number[]],
  look: { title: string; color: 'blue' | 'red'; collapsed: boolean }
) {
  return worker.evaluate(
    async ({ windowId, tabIds, look }) => {
      const groupId = await chrome.tabs.group({
        tabIds,
        createProperties: { windowId },
      });
      await chrome.tabGroups.update(groupId, look);
      return groupId;
    },
    { windowId, tabIds, look }
  );
}

const makeSplit = (worker: Worker, tabIds: [number, number]) =>
  worker.evaluate(async (pair) => {
    const createSplit: unknown = Reflect.get(chrome.tabs, 'createSplit');
    if (typeof createSplit !== 'function') throw new Error('no createSplit');
    return Reflect.apply(createSplit, chrome.tabs, [pair]) as Promise<number>;
  }, tabIds);

const splitIds = (worker: Worker, tabIds: number[]) =>
  worker.evaluate(
    async (all) =>
      Promise.all(
        all.map(async (id) => (await chrome.tabs.get(id)).splitViewId)
      ),
    tabIds
  );

// The boxes of every live row but `held`, rounded.
const rowBoxes = (page: Page, held: number) =>
  page.evaluate(
    ({ pane, held }) =>
      [...document.querySelectorAll<HTMLElement>(`${pane} [data-open-tab-id]`)]
        .filter((row) => row.dataset.openTabId !== String(held))
        .map((row) => {
          const b = row.getBoundingClientRect();
          return `${row.dataset.openTabId}@${Math.round(b.top)}`;
        }),
    { pane: OPEN_NOW, held }
  );

test.describe('the boxes a live drag is offered', () => {
  test('from pick-up the header shows New window in place of its toolbar', async ({
    context,
    extensionId,
    serviceWorker: worker,
  }) => {
    const live = await openLiveWindow(worker, ['A', 'B', 'C']);
    const page = await setUp(context, extensionId);
    await expect(liveRow(page, live.idOf('C'))).toBeVisible();
    // PREMISE: at rest neither box is drawn.
    await expect(page.locator(HEADER_BOX)).toHaveCount(0);
    await expect(page.locator(LAST_BOX)).toHaveCount(0);

    await pickUp(page, liveHandle(page, live.idOf('B')));

    await expect(page.locator(HEADER_BOX)).toBeVisible();
    await expect(page.locator(HEADER_BOX)).not.toHaveAttribute('data-landing');
    await expect(page.locator(TOOLBAR)).toHaveCount(1);
    await expect(page.locator(LAST_BOX)).toBeAttached();
    await expect(page.locator(LAST_BOX)).not.toHaveAttribute('data-landing');

    await page.keyboard.press('Escape');
    await page.mouse.up();
    await expect(page.locator(HEADER_BOX)).toHaveCount(0);
    await expect(page.locator(LAST_BOX)).toHaveCount(0);
    expect(await ids(worker, live.windowId)).toEqual(
      ['A', 'B', 'C'].map(live.idOf)
    );
  });

  test("a window's only tab is offered none", async ({
    context,
    extensionId,
    serviceWorker: worker,
  }) => {
    await openLiveWindow(worker, ['A', 'B']);
    const lone = await openLiveWindow(worker, ['Lone']);
    const page = await setUp(context, extensionId);
    await expect(liveRow(page, lone.idOf('Lone'))).toBeVisible();

    await pickUp(page, liveHandle(page, lone.idOf('Lone')));
    // PREMISE: the drag is on.
    await expect(page.locator(`${OPEN_NOW} [data-drag-held]`)).toHaveCount(1);

    await expect(page.locator(TOOLBAR)).toHaveCount(0);
    await expect(page.locator(HEADER_BOX)).toHaveCount(0);
    await expect(page.locator(LAST_BOX)).toHaveCount(0);
    await page.keyboard.press('Escape');
    await page.mouse.up();
  });

  test('the group holding this page is offered none', async ({
    context,
    extensionId,
    serviceWorker: worker,
  }) => {
    const page = await setUp(context, extensionId);
    const here = await page.evaluate(async () => {
      const me = await chrome.tabs.getCurrent();
      if (me?.id === undefined) throw new Error('no current tab');
      const other = await chrome.tabs.create({
        windowId: me.windowId,
        url: 'data:text/html,<title>Beside</title>',
        active: false,
      });
      const groupId = await chrome.tabs.group({
        tabIds: [me.id, other.id ?? -1],
      });
      return { groupId, other: other.id ?? -1 };
    });
    await expect(liveRow(page, here.other)).toBeVisible();
    void worker;

    await pickUp(page, liveGroupHandle(page, here.groupId));
    await expect(page.locator(`${OPEN_NOW} [data-drag-held]`)).toHaveCount(1);

    await expect(page.locator(HEADER_BOX)).toHaveCount(0);
    await expect(page.locator(LAST_BOX)).toHaveCount(0);
    await page.keyboard.press('Escape');
    await page.mouse.up();
  });
});

test.describe('a live tab let go on a box moves into a new window', () => {
  test('on the header: the same tab, alone in a new window in front, the old window in order', async ({
    context,
    extensionId,
    serviceWorker: worker,
  }) => {
    const live = await openLiveWindow(worker, ['A', 'B', 'C']);
    const page = await setUp(context, extensionId);
    await expect(liveRow(page, live.idOf('C'))).toBeVisible();
    const before = await windowIds(worker);
    const count = await tabCount(worker);

    await pickUp(page, liveHandle(page, live.idOf('B')));
    await carryTo(page, await headerAim(page));
    await expect(page.locator(HEADER_BOX)).toHaveAttribute('data-landing', '');
    await page.mouse.up();

    const made = await madeWindow(worker, before);
    await expect.poll(() => ids(worker, made)).toEqual([live.idOf('B')]);
    expect(await ids(worker, live.windowId)).toEqual(['A', 'C'].map(live.idOf));
    await expect.poll(() => lastFocused(worker)).toBe(made);
    expect(await tabCount(worker)).toBe(count);
    expect(await anyNewTab(worker)).toBe(false);
    await expect(
      page.locator(`${OPEN_NOW} [data-open-window-id="${made}"]`)
    ).toBeVisible();
    // No toast for a move that worked (Goal 8).
    await expect(toasts(page)).toHaveCount(0);
  });

  test('released over the Back to your tab chip: a new window, not a click', async ({
    context,
    extensionId,
    serviceWorker: worker,
  }) => {
    const live = await openLiveWindow(worker, ['A', 'B', 'C']);
    const page = await setUp(context, extensionId);
    await expect(liveRow(page, live.idOf('C'))).toBeVisible();
    const chip = await middleOf(
      page.locator(`${OPEN_NOW} [data-open-now-header] [role="button"]`).last()
    );
    const before = await windowIds(worker);
    const pages = context.pages().length;

    await pickUp(page, liveHandle(page, live.idOf('A')));
    await carryTo(page, chip);
    await expect(page.locator(HEADER_BOX)).toHaveAttribute('data-landing', '');
    await page.mouse.up();

    const made = await madeWindow(worker, before);
    await expect.poll(() => ids(worker, made)).toEqual([live.idOf('A')]);
    // The chip's click would have closed or left this page.
    expect(context.pages().length).toBe(pages);
    expect(page.isClosed()).toBe(false);
  });

  test('the box below the last window lights and lands', async ({
    context,
    extensionId,
    serviceWorker: worker,
  }) => {
    const first = await openLiveWindow(worker, ['A', 'B', 'C']);
    const last = await openLiveWindow(worker, ['D', 'E']);
    const page = await setUp(context, extensionId);
    await expect(liveRow(page, last.idOf('E'))).toBeVisible();
    const before = await windowIds(worker);

    await pickUp(page, liveHandle(page, first.idOf('A')));
    await expect(page.locator(LAST_BOX)).toBeAttached();
    await carryTo(page, await middleOf(page.locator(LAST_BOX)));
    await expect(page.locator(LAST_BOX)).toHaveAttribute('data-landing', '');
    await expect(page.locator(HEADER_BOX)).not.toHaveAttribute('data-landing');
    await page.mouse.up();

    const made = await madeWindow(worker, before);
    await expect.poll(() => ids(worker, made)).toEqual([first.idOf('A')]);
    expect(await ids(worker, first.windowId)).toEqual(
      ['B', 'C'].map(first.idOf)
    );
    expect(await ids(worker, last.windowId)).toEqual(['D', 'E'].map(last.idOf));
  });

  test('while a box is lit the rows do not move', async ({
    context,
    extensionId,
    serviceWorker: worker,
  }) => {
    const live = await openLiveWindow(worker, ['A', 'B', 'C', 'D']);
    const page = await setUp(context, extensionId);
    await expect(liveRow(page, live.idOf('D'))).toBeVisible();
    const held = live.idOf('B');

    await pickUp(page, liveHandle(page, held));
    // At rest after the pick-up, the room still where B was.
    await page.waitForTimeout(400);
    const atPickUp = await rowBoxes(page, held);
    await carryTo(page, await headerAim(page));
    await expect(page.locator(HEADER_BOX)).toHaveAttribute('data-landing', '');
    await page.waitForTimeout(400);

    expect(await rowBoxes(page, held)).toEqual(atPickUp);
    await page.keyboard.press('Escape');
    await page.mouse.up();
  });

  test('a pinned tab stays pinned', async ({
    context,
    extensionId,
    serviceWorker: worker,
  }) => {
    const live = await openLiveWindow(worker, ['P', 'A', 'B']);
    await worker.evaluate(
      (id) => chrome.tabs.update(id, { pinned: true }),
      live.idOf('P')
    );
    const page = await setUp(context, extensionId);
    await expect(liveRow(page, live.idOf('B'))).toBeVisible();
    const before = await windowIds(worker);

    await pickUp(page, liveHandle(page, live.idOf('P')));
    await carryTo(page, await headerAim(page));
    await page.mouse.up();

    const made = await madeWindow(worker, before);
    await expect
      .poll(async () =>
        (await strip(worker, made)).map((t) => [t.id, t.pinned])
      )
      .toEqual([[live.idOf('P'), true]]);
  });

  test('a pair stays split', async ({
    context,
    extensionId,
    serviceWorker: worker,
  }) => {
    const live = await openLiveWindow(worker, ['A', 'S1', 'S2', 'B']);
    const pair: [number, number] = [live.idOf('S1'), live.idOf('S2')];
    await makeSplit(worker, pair);
    const page = await setUp(context, extensionId);
    await expect(liveRow(page, live.idOf('B'))).toBeVisible();
    const before = await windowIds(worker);

    await pickUp(page, liveHandle(page, pair[0]));
    await carryTo(page, await headerAim(page));
    await expect(page.locator(HEADER_BOX)).toHaveAttribute('data-landing', '');
    await page.mouse.up();

    const made = await madeWindow(worker, before);
    await expect.poll(() => ids(worker, made)).toEqual(pair);
    await expect
      .poll(async () => {
        const [a, b] = await splitIds(worker, pair);
        return a !== undefined && a > 0 && a === b;
      })
      .toBe(true);
    expect(await ids(worker, live.windowId)).toEqual(['A', 'B'].map(live.idOf));
  });

  test('a group keeps its title, color and collapsed state', async ({
    context,
    extensionId,
    serviceWorker: worker,
  }) => {
    const live = await openLiveWindow(worker, ['A', 'G1', 'G2', 'G3']);
    const groupId = await makeGroup(
      worker,
      live.windowId,
      [live.idOf('G1'), live.idOf('G2'), live.idOf('G3')],
      { title: 'Trip', color: 'red', collapsed: true }
    );
    const page = await setUp(context, extensionId);
    await expect(liveGroupHandle(page, groupId)).toBeVisible();
    const before = await windowIds(worker);
    const count = await tabCount(worker);

    await pickUp(page, liveGroupHandle(page, groupId));
    await carryTo(page, await headerAim(page));
    await expect(page.locator(HEADER_BOX)).toHaveAttribute('data-landing', '');
    await page.mouse.up();

    const made = await madeWindow(worker, before);
    await expect
      .poll(() => ids(worker, made))
      .toEqual(['G1', 'G2', 'G3'].map(live.idOf));
    const look = await worker.evaluate(async (windowId) => {
      const [group, ...more] = await chrome.tabGroups.query({ windowId });
      return group === undefined || more.length > 0
        ? null
        : [group.title, group.color, group.collapsed];
    }, made);
    expect(look).toEqual(['Trip', 'red', true]);
    expect(await ids(worker, live.windowId)).toEqual([live.idOf('A')]);
    expect(await tabCount(worker)).toBe(count);
    expect(await anyNewTab(worker)).toBe(false);
  });

  test('the new window is scrolled into view', async ({
    context,
    extensionId,
    serviceWorker: worker,
  }) => {
    const live = [];
    for (let w = 0; w < 6; w++)
      live.push(
        await openLiveWindow(worker, [`W${w} a`, `W${w} b`, `W${w} c`])
      );
    const page = await setUp(context, extensionId);
    const top = live[0];
    if (top === undefined) throw new Error('no live windows');
    await expect(liveRow(page, top.idOf('W0 a'))).toBeVisible();
    const scroller = page.locator(SCROLLER);
    // PREMISE: the list scrolls, and is at its top.
    expect(
      await scroller.evaluate((el) => el.scrollHeight - el.clientHeight)
    ).toBeGreaterThan(100);
    expect(await scroller.evaluate((el) => el.scrollTop)).toBe(0);
    const before = await windowIds(worker);

    await pickUp(page, liveHandle(page, top.idOf('W0 b')));
    await carryTo(page, await headerAim(page));
    await expect(page.locator(HEADER_BOX)).toHaveAttribute('data-landing', '');
    await page.mouse.up();

    const made = await madeWindow(worker, before);
    await expect
      .poll(() =>
        page.evaluate(
          ({ scroller, windowId }) => {
            const view = document
              .querySelector(scroller)
              ?.getBoundingClientRect();
            const block = document
              .querySelector(`[data-open-window-id="${windowId}"]`)
              ?.getBoundingClientRect();
            if (!view || !block) return 'not drawn';
            return block.top >= view.top - 1 && block.bottom <= view.bottom + 1
              ? 'whole'
              : `${Math.round(block.top)}..${Math.round(block.bottom)}`;
          },
          { scroller: SCROLLER, windowId: made }
        )
      )
      .toBe('whole');
  });
});

test.describe('undo and redo', () => {
  test('⌘Z moves it back and the made window closes; ⌘⇧Z makes a new window again', async ({
    context,
    extensionId,
    serviceWorker: worker,
  }) => {
    const live = await openLiveWindow(worker, ['A', 'B', 'C']);
    const page = await setUp(context, extensionId);
    await expect(liveRow(page, live.idOf('C'))).toBeVisible();
    const before = await windowIds(worker);

    await pickUp(page, liveHandle(page, live.idOf('B')));
    await carryTo(page, await headerAim(page));
    await page.mouse.up();
    const made = await madeWindow(worker, before);
    await expect.poll(() => ids(worker, made)).toEqual([live.idOf('B')]);

    await page.keyboard.press('ControlOrMeta+z');
    await expect
      .poll(() => ids(worker, live.windowId))
      .toEqual(['A', 'B', 'C'].map(live.idOf));
    await expect.poll(() => windowIds(worker)).toEqual(before);

    await page.keyboard.press('ControlOrMeta+Shift+z');
    const again = await madeWindow(worker, before);
    expect(again).not.toBe(made);
    await expect.poll(() => ids(worker, again)).toEqual([live.idOf('B')]);
    expect(await ids(worker, live.windowId)).toEqual(['A', 'C'].map(live.idOf));
    await expect(toasts(page)).toHaveCount(0);
  });

  test('⌘Z after the tab was moved since refuses with the move toast', async ({
    context,
    extensionId,
    serviceWorker: worker,
  }) => {
    const live = await openLiveWindow(worker, ['A', 'B', 'C']);
    const page = await setUp(context, extensionId);
    await expect(liveRow(page, live.idOf('C'))).toBeVisible();
    const before = await windowIds(worker);

    await pickUp(page, liveHandle(page, live.idOf('B')));
    await carryTo(page, await headerAim(page));
    await page.mouse.up();
    const made = await madeWindow(worker, before);
    await expect.poll(() => ids(worker, made)).toEqual([live.idOf('B')]);
    await worker.evaluate(
      ({ tabId, windowId }) => chrome.tabs.move(tabId, { windowId, index: 0 }),
      { tabId: live.idOf('B'), windowId: live.windowId }
    );
    await expect(liveRow(page, live.idOf('B'))).toBeVisible();

    await page.keyboard.press('ControlOrMeta+z');

    await expect(toasts(page)).toHaveCount(1);
    await expect(toasts(page)).toContainText(UNDO_MOVE);
    expect(await ids(worker, live.windowId)).toEqual(
      ['B', 'A', 'C'].map(live.idOf)
    );
  });
});
