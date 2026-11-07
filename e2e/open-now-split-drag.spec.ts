import type { Locator, Page, Worker } from '@playwright/test';

import { test as ungrantedTest } from './fixtures/extension';
import { expect, grantedTest as test } from './fixtures/grantedExtension';
import { openTabView, session, tab, win } from './fixtures/betweenSessions';
import { elementLanded } from './fixtures/landed';
import {
  carryTo,
  liveRow,
  openLiveWindow,
  strip,
  topOf,
} from './fixtures/liveWindows';
import { boxOf, pickUp, stored, tabHandle } from './fixtures/sessionDrag';

// KAN-486 on the real artifact: a Chrome split moves as one in Currently open.
// What the fake cannot show: Chrome's own answer to each route on Chromium 156,
// the engine's geometry with a two-tab row, and the re-read after a drop.
// The divider is not readable headless: the headed demo checks it.

const OPEN_NOW = '[data-pane="open-now"]';
const HELD = '[data-drag-held]';
const SLOT = '[data-drag-landing-slot]';
const CARD_NAMES = '[data-carry-card-name]';
const toasts = (page: Page) =>
  page.locator('[role="status"] > [data-toast]:not([aria-hidden="true"])');

const SAVED = () =>
  session('S1', 'Trip', [
    win(
      'w1',
      [tab('s0'), tab('s1'), tab('g0', 'day'), tab('g1', 'day')],
      [{ groupId: 'day', title: 'Day trips', color: 'green' }]
    ),
  ]);

const setUp = (
  context: Parameters<typeof openTabView>[0],
  extensionId: string
) => openTabView(context, extensionId, false, [SAVED()]);

const makeSplit = (worker: Worker, ids: [number, number]) =>
  worker.evaluate(async (tabIds) => {
    const createSplit: unknown = Reflect.get(chrome.tabs, 'createSplit');
    if (typeof createSplit !== 'function') throw new Error('no createSplit');
    return Reflect.apply(createSplit, chrome.tabs, [tabIds]) as Promise<number>;
  }, ids);

const makeGroup = (
  worker: Worker,
  windowId: number,
  tabIds: [number, ...number[]],
  title: string
) =>
  worker.evaluate(
    async ({ windowId, tabIds, title }) => {
      const groupId = await chrome.tabs.group({
        tabIds,
        createProperties: { windowId },
      });
      await chrome.tabGroups.update(groupId, { title, color: 'blue' });
      return groupId;
    },
    { windowId, tabIds, title }
  );

const activate = (worker: Worker, id: number) =>
  worker.evaluate(async (tabId) => {
    await chrome.tabs.update(tabId, { active: true });
  }, id);

const pin = (worker: Worker, ids: number[]) =>
  worker.evaluate(async (tabIds) => {
    for (const id of tabIds) await chrome.tabs.update(id, { pinned: true });
  }, ids);

const order = async (worker: Worker, windowId: number) =>
  (await strip(worker, windowId)).map((t) => t.id);

const splitIds = (worker: Worker, ids: number[]) =>
  worker.evaluate(
    async (tabIds) =>
      Promise.all(
        tabIds.map(async (id) => (await chrome.tabs.get(id)).splitViewId)
      ),
    ids
  );

const frontOf = (worker: Worker, windowId: number) =>
  worker.evaluate(
    async (id) =>
      (await chrome.tabs.query({ windowId: id, active: true }))[0]?.id,
    windowId
  );

const groupOf = (worker: Worker, id: number) =>
  worker.evaluate(async (tabId) => (await chrome.tabs.get(tabId)).groupId, id);

const groupCount = (worker: Worker) =>
  worker.evaluate(async () => (await chrome.tabGroups.query({})).length);

// Both tabs report one split, Chrome's order is `expected`, and the list draws that order.
async function expectPairAt(
  page: Page,
  worker: Worker,
  windowId: number,
  pair: [number, number],
  expected: number[]
) {
  await expect.poll(() => order(worker, windowId)).toEqual(expected);
  await expect
    .poll(async () => {
      const [first, second] = await splitIds(worker, pair);
      return first !== undefined && first > 0 && first === second;
    })
    .toBe(true);
  await expect
    .poll(() =>
      page.evaluate(
        (id) =>
          [
            ...document.querySelectorAll(
              `[data-open-window-id="${id}"] [data-open-tab-id]`
            ),
          ].map((row) => Number(row.getAttribute('data-open-tab-id'))),
        windowId
      )
    )
    .toEqual(expected);
}

// Presses a live row and moves past the activation distance, then requires a held row.
async function lift(page: Page, row: Locator) {
  await elementLanded(row, 'ancestors');
  const at = await pickUp(page, row);
  await expect(page.locator(HELD)).toHaveCount(1);
  return at;
}

// Moves the held row, then rests past DURATION.MOVE so the rows have eased.
async function hover(page: Page, x: number, y: number) {
  await page.mouse.move(x, y, { steps: 10 });
  await page.waitForTimeout(350);
}

async function drag(page: Page, row: Locator, aim: () => Promise<number>) {
  const { x } = await lift(page, row);
  await hover(page, x, await aim());
  await page.mouse.up();
}

const justInside = async (row: Locator) => (await boxOf(row)).y + 6;
const justBelow = async (row: Locator) => {
  const box = await boxOf(row);
  return box.y + box.height - 6;
};

// The drawn space between two rows, read at rest: a slot between them shows as a gap.
const gapBetween = async (upper: Locator, lower: Locator) => {
  const top = await boxOf(upper);
  const bottom = await boxOf(lower);
  return bottom.y - (top.y + top.height);
};

// Sweeps the held row over the pair: no point opens a slot between its halves.
async function expectNoSlotBetween(
  page: Page,
  x: number,
  first: Locator,
  second: Locator
) {
  const a = await boxOf(first);
  const b = await boxOf(second);
  const steps = [a.y + 4, a.y + a.height - 4, b.y + 4, b.y + b.height - 4];
  for (const y of steps) {
    await hover(page, x, y);
    expect(await gapBetween(first, second)).toBeLessThan(2);
  }
}

const groupTitle = (page: Page, windowId: number, title: string) =>
  page
    .locator(`[data-open-window-id="${windowId}"]`)
    .getByText(title, { exact: true });

const undoPress = (page: Page) => page.keyboard.press('ControlOrMeta+z');
const redoPress = (page: Page) => page.keyboard.press('ControlOrMeta+Shift+z');

test.describe('a split is one row in Currently open (KAN-486)', () => {
  test('1. pressing either half lifts both: slot two rows tall', async ({
    context,
    extensionId,
    serviceWorker: worker,
  }) => {
    const w = await openLiveWindow(worker, ['A', 'B', 'C', 'D']);
    const [b, c] = [w.idOf('B'), w.idOf('C')];
    await makeSplit(worker, [b, c]);
    const page = await setUp(context, extensionId);
    const first = liveRow(page, b);
    const second = liveRow(page, c);
    await expect(second).toBeVisible();
    const both = (await boxOf(first)).height + (await boxOf(second)).height;

    for (const row of [first, second]) {
      await lift(page, row);
      const held = page.locator(HELD);
      await expect(held).toHaveAttribute('data-drag-row-id', String(b));
      await expect(held.locator('[data-open-tab-id]')).toHaveCount(2);
      const slot = await boxOf(page.locator(SLOT));
      expect(Math.abs(slot.height - both)).toBeLessThan(2);
      await page.mouse.up();
      await expect(page.locator(HELD)).toHaveCount(0);
    }
    expect(await order(worker, w.windowId)).toEqual([
      w.idOf('A'),
      b,
      c,
      w.idOf('D'),
    ]);
  });

  test('2. a pair dropped lower and higher in its window stays one split', async ({
    context,
    extensionId,
    serviceWorker: worker,
  }) => {
    const w = await openLiveWindow(worker, ['A', 'B', 'C', 'D', 'E']);
    const [a, b, c, d, e] = ['A', 'B', 'C', 'D', 'E'].map(w.idOf) as [
      number,
      number,
      number,
      number,
      number,
    ];
    const id = await makeSplit(worker, [b, c]);
    const page = await setUp(context, extensionId);
    await expect(liveRow(page, e)).toBeVisible();

    await drag(page, liveRow(page, c), () => justBelow(liveRow(page, e)));
    await expectPairAt(page, worker, w.windowId, [b, c], [a, d, e, b, c]);
    // The same id: the group route never ended the split, so the divider stays.
    expect(await splitIds(worker, [b, c])).toEqual([id, id]);

    await drag(page, liveRow(page, b), () => justInside(liveRow(page, a)));
    await expectPairAt(page, worker, w.windowId, [b, c], [b, c, a, d, e]);
    expect(await splitIds(worker, [b, c])).toEqual([id, id]);
    expect(await groupCount(worker)).toBe(0);
  });

  test('3. a pair dropped in another window stays one split, its front tab stays', async ({
    context,
    extensionId,
    serviceWorker: worker,
  }) => {
    const w = await openLiveWindow(worker, ['A', 'B', 'C', 'D']);
    const x = await openLiveWindow(worker, ['X', 'Y', 'Z']);
    const [b, c] = [w.idOf('B'), w.idOf('C')];
    const id = await makeSplit(worker, [b, c]);
    await activate(worker, c);
    await activate(worker, x.idOf('Y'));
    const page = await setUp(context, extensionId);
    await expect(liveRow(page, x.idOf('Z'))).toBeVisible();

    await drag(page, liveRow(page, b), () =>
      justInside(liveRow(page, x.idOf('Z')))
    );
    await expectPairAt(
      page,
      worker,
      x.windowId,
      [b, c],
      [x.idOf('X'), x.idOf('Y'), b, c, x.idOf('Z')]
    );
    expect(await splitIds(worker, [b, c])).toEqual([id, id]);
    expect(await frontOf(worker, x.windowId)).toBe(x.idOf('Y'));
    expect(await groupCount(worker)).toBe(0);
  });

  test('4. into a group at its tail, inside it, and out again', async ({
    context,
    extensionId,
    serviceWorker: worker,
  }) => {
    const w = await openLiveWindow(worker, ['A', 'B', 'C', 'G1', 'G2', 'H']);
    const [a, b, c, g1, g2, h] = ['A', 'B', 'C', 'G1', 'G2', 'H'].map(
      w.idOf
    ) as [number, number, number, number, number, number];
    await makeSplit(worker, [b, c]);
    const g = await makeGroup(worker, w.windowId, [g1, g2], 'Work');
    const page = await setUp(context, extensionId);
    await expect(liveRow(page, h)).toBeVisible();

    await drag(page, liveRow(page, b), () => justBelow(liveRow(page, g2)));
    await expectPairAt(page, worker, w.windowId, [b, c], [a, g1, g2, b, c, h]);
    expect(await groupOf(worker, b)).toBe(g);
    expect(await groupOf(worker, c)).toBe(g);

    await drag(page, liveRow(page, b), () => justInside(liveRow(page, g2)));
    await expectPairAt(page, worker, w.windowId, [b, c], [a, g1, b, c, g2, h]);
    expect(await groupOf(worker, c)).toBe(g);

    await drag(page, liveRow(page, c), () => justInside(liveRow(page, a)));
    await expectPairAt(page, worker, w.windowId, [b, c], [b, c, a, g1, g2, h]);
    expect(await groupOf(worker, b)).toBe(-1);
    expect(await groupCount(worker)).toBe(1);
  });

  test('5. a pair dropped into the pinned run pins both, one toast', async ({
    context,
    extensionId,
    serviceWorker: worker,
  }) => {
    const w = await openLiveWindow(worker, ['P', 'A', 'B', 'C']);
    const [p, a, b, c] = ['P', 'A', 'B', 'C'].map(w.idOf) as [
      number,
      number,
      number,
      number,
    ];
    await pin(worker, [p]);
    await makeSplit(worker, [b, c]);
    const page = await setUp(context, extensionId);
    await expect(liveRow(page, c)).toBeVisible();

    await drag(page, liveRow(page, b), () => justInside(liveRow(page, p)));
    await expectPairAt(page, worker, w.windowId, [b, c], [b, c, p, a]);
    expect((await strip(worker, w.windowId)).map((t) => t.pinned)).toEqual([
      true,
      true,
      true,
      false,
    ]);
    await expect(toasts(page)).toHaveCount(1);
    await expect(toasts(page)).toHaveText(/^Tab pinned\./);
  });

  test('6. another tab finds no slot between the halves', async ({
    context,
    extensionId,
    serviceWorker: worker,
  }) => {
    const w = await openLiveWindow(worker, ['A', 'B', 'C', 'D']);
    const [a, b, c, d] = ['A', 'B', 'C', 'D'].map(w.idOf) as [
      number,
      number,
      number,
      number,
    ];
    await makeSplit(worker, [b, c]);
    const page = await setUp(context, extensionId);
    await expect(liveRow(page, d)).toBeVisible();
    const [first, second] = [liveRow(page, b), liveRow(page, c)];

    // From above.
    const down = await lift(page, liveRow(page, a));
    await expectNoSlotBetween(page, down.x, first, second);
    await page.mouse.up();
    await expect(page.locator(HELD)).toHaveCount(0);
    await expect
      .poll(async () => {
        const [one, two] = await splitIds(worker, [b, c]);
        return one !== undefined && one > 0 && one === two;
      })
      .toBe(true);

    // From below.
    await expect(liveRow(page, d)).toBeVisible();
    const up = await lift(page, liveRow(page, d));
    await expectNoSlotBetween(page, up.x, first, second);
    await page.mouse.up();
    await expect
      .poll(async () => {
        const [one, two] = await splitIds(worker, [b, c]);
        return one !== undefined && one > 0 && one === two;
      })
      .toBe(true);
  });

  test('7. a saved tab finds no slot between the halves', async ({
    context,
    extensionId,
    serviceWorker: worker,
  }) => {
    const w = await openLiveWindow(worker, ['A', 'B', 'C', 'D']);
    const [b, c] = [w.idOf('B'), w.idOf('C')];
    await makeSplit(worker, [b, c]);
    const page = await setUp(context, extensionId);
    await expect(liveRow(page, w.idOf('D'))).toBeVisible();
    const [first, second] = [liveRow(page, b), liveRow(page, c)];

    await pickUp(page, tabHandle(page, 's1'));
    await carryTo(page, await topOf(first));
    await page.waitForTimeout(350);
    const { x } = await topOf(first);
    await expectNoSlotBetween(page, x, first, second);
    await page.mouse.up();

    await expect
      .poll(async () => (await order(worker, w.windowId)).length)
      .toBe(5);
    const now = await order(worker, w.windowId);
    expect(now.indexOf(c)).toBe(now.indexOf(b) + 1);
    const [one, two] = await splitIds(worker, [b, c]);
    expect(one).toBeGreaterThan(0);
    expect(two).toBe(one);
  });

  test('8. a group finds no slot between the halves', async ({
    context,
    extensionId,
    serviceWorker: worker,
  }) => {
    const w = await openLiveWindow(worker, ['A', 'B', 'C', 'G1', 'G2']);
    const [b, c, g1, g2] = ['B', 'C', 'G1', 'G2'].map(w.idOf) as [
      number,
      number,
      number,
      number,
    ];
    await makeSplit(worker, [b, c]);
    await makeGroup(worker, w.windowId, [g1, g2], 'Work');
    const page = await setUp(context, extensionId);
    await expect(liveRow(page, g2)).toBeVisible();
    const [first, second] = [liveRow(page, b), liveRow(page, c)];

    const title = groupTitle(page, w.windowId, 'Work');
    await elementLanded(title, 'ancestors');
    const { x } = await pickUp(page, title);
    await expect(page.locator(HELD)).toHaveCount(1);
    await page.waitForTimeout(350);
    await expectNoSlotBetween(page, x, first, second);
    await page.mouse.up();
    await expect(page.locator(HELD)).toHaveCount(0);

    await expect
      .poll(async () => {
        const now = await order(worker, w.windowId);
        return now.indexOf(c) - now.indexOf(b);
      })
      .toBe(1);
    const [one, two] = await splitIds(worker, [b, c]);
    expect(one).toBeGreaterThan(0);
    expect(two).toBe(one);
  });

  test('9. undo and redo keep the pair', async ({
    context,
    extensionId,
    serviceWorker: worker,
  }) => {
    const w = await openLiveWindow(worker, ['A', 'B', 'C', 'D']);
    const x = await openLiveWindow(worker, ['X', 'Y']);
    const [a, b, c, d] = ['A', 'B', 'C', 'D'].map(w.idOf) as [
      number,
      number,
      number,
      number,
    ];
    await makeSplit(worker, [b, c]);
    const page = await setUp(context, extensionId);
    await expect(liveRow(page, x.idOf('Y'))).toBeVisible();

    await drag(page, liveRow(page, b), () =>
      justInside(liveRow(page, x.idOf('Y')))
    );
    const moved = [x.idOf('X'), b, c, x.idOf('Y')];
    await expectPairAt(page, worker, x.windowId, [b, c], moved);

    await undoPress(page);
    await expectPairAt(page, worker, w.windowId, [b, c], [a, b, c, d]);

    await redoPress(page);
    await expectPairAt(page, worker, x.windowId, [b, c], moved);
    expect(await groupCount(worker)).toBe(0);
  });

  test('10. two pairs side by side, and a folded window', async ({
    context,
    extensionId,
    serviceWorker: worker,
  }) => {
    const w = await openLiveWindow(worker, ['A', 'B', 'C', 'D', 'E']);
    const x = await openLiveWindow(worker, ['X', 'Y']);
    const [a, b, c, d, e] = ['A', 'B', 'C', 'D', 'E'].map(w.idOf) as [
      number,
      number,
      number,
      number,
      number,
    ];
    await makeSplit(worker, [b, c]);
    await makeSplit(worker, [d, e]);
    const page = await setUp(context, extensionId);
    await expect(liveRow(page, x.idOf('Y'))).toBeVisible();

    await drag(page, liveRow(page, e), () => justInside(liveRow(page, b)));
    await expectPairAt(page, worker, w.windowId, [d, e], [a, d, e, b, c]);
    const [one, two] = await splitIds(worker, [b, c]);
    expect(one).toBeGreaterThan(0);
    expect(two).toBe(one);

    const block = page.locator(`[data-open-window-id="${x.windowId}"]`);
    await block.getByRole('button', { name: /^Collapse:/ }).click();
    await expect(liveRow(page, x.idOf('Y'))).toBeHidden();
    await drag(page, liveRow(page, b), async () => {
      const box = await boxOf(block);
      return box.y + box.height / 2;
    });
    await expect
      .poll(() => order(worker, x.windowId))
      .toEqual([b, c, x.idOf('X'), x.idOf('Y')]);
    const [three, four] = await splitIds(worker, [b, c]);
    expect(three).toBeGreaterThan(0);
    expect(four).toBe(three);
  });

  test('11. under a search, a lone half carries out', async ({
    context,
    extensionId,
    serviceWorker: worker,
  }) => {
    const w = await openLiveWindow(worker, ['Alpha', 'Bravo', 'Charlie']);
    const [b, c] = [w.idOf('Bravo'), w.idOf('Charlie')];
    await makeSplit(worker, [b, c]);
    const page = await setUp(context, extensionId);
    await expect(liveRow(page, c)).toBeVisible();

    await page
      .locator(OPEN_NOW)
      .getByRole('textbox', { name: 'Search open tabs', exact: true })
      .fill('Charlie');
    await expect(liveRow(page, b)).toHaveCount(0);
    // Under a search a row is only carried out: its card shows outside the pane.
    const { y } = await pickUp(page, liveRow(page, c));
    const pane = await boxOf(page.locator(OPEN_NOW));
    await page.mouse.move(pane.x - 40, y, { steps: 6 });
    await expect(page.locator('[data-carry-card]')).toHaveCount(1);
    await expect(page.locator(CARD_NAMES)).toHaveText(['Bravo', 'Charlie']);
    await page.keyboard.press('Escape');
    await page.mouse.up();
  });

  test('12. a group holding a split and the front tab, to another window', async ({
    context,
    extensionId,
    serviceWorker: worker,
  }) => {
    const w = await openLiveWindow(worker, ['A', 'G1', 'G2', 'G3']);
    const x = await openLiveWindow(worker, ['X', 'Y']);
    const [a, g1, g2, g3] = ['A', 'G1', 'G2', 'G3'].map(w.idOf) as [
      number,
      number,
      number,
      number,
    ];
    await makeSplit(worker, [g1, g2]);
    const g = await makeGroup(worker, w.windowId, [g1, g2, g3], 'Work');
    await activate(worker, g2);
    await activate(worker, x.idOf('Y'));
    const page = await setUp(context, extensionId);
    await expect(liveRow(page, x.idOf('Y'))).toBeVisible();

    const title = groupTitle(page, w.windowId, 'Work');
    await elementLanded(title, 'ancestors');
    const { x: left } = await pickUp(page, title);
    await expect(page.locator(HELD)).toHaveCount(1);
    await page.waitForTimeout(350);
    await hover(page, left, await justInside(liveRow(page, x.idOf('Y'))));
    await page.mouse.up();

    await expectPairAt(
      page,
      worker,
      x.windowId,
      [g1, g2],
      [x.idOf('X'), g1, g2, g3, x.idOf('Y')]
    );
    expect(await groupOf(worker, g1)).toBe(g);
    expect(await frontOf(worker, x.windowId)).toBe(x.idOf('Y'));
    expect(await order(worker, w.windowId)).toEqual([a]);
  });
});

test.describe('a pair carried to the saved side (KAN-486)', () => {
  test('14. a pair carried to a saved session restores as a split', async ({
    context,
    extensionId,
    serviceWorker: worker,
  }) => {
    const w = await openLiveWindow(worker, ['A', 'B', 'C', 'D']);
    const [b, c] = [w.idOf('B'), w.idOf('C')];
    await makeSplit(worker, [b, c]);
    const page = await setUp(context, extensionId);
    await expect(liveRow(page, c)).toBeVisible();

    // Onto the saved tab s1: a spot in the session on screen.
    const { y } = await lift(page, liveRow(page, b));
    const pane = await boxOf(page.locator(OPEN_NOW));
    await page.mouse.move(pane.x - 40, y, { steps: 6 });
    await expect(page.locator('[data-carry-card]')).toHaveCount(1);
    const to = await topOf(tabHandle(page, 's1'));
    await carryTo(page, to);
    await page.mouse.up();

    await expect
      .poll(async () => {
        const { tabGroups } = await stored(page);
        return tabGroups[0]?.windows[0]?.tabs.map((t) => t.title);
      })
      .toEqual(['Tab s0', 'B', 'C', 'Tab s1', 'Tab g0', 'Tab g1']);
    const saved = (await stored(page)).tabGroups[0]?.windows[0]?.tabs ?? [];
    expect(saved[1]?.splitId).toBeDefined();
    expect(saved[2]?.splitId).toBe(saved[1]?.splitId);
    // Chrome is not touched: a copy.
    expect(await order(worker, w.windowId)).toEqual([
      w.idOf('A'),
      b,
      c,
      w.idOf('D'),
    ]);

    // A restore splits them again.
    const before = await worker.evaluate(async () =>
      (await chrome.windows.getAll()).map((x) => x.id)
    );
    const header = page.locator('[data-drag-row-id="w1"]').first();
    await header.hover();
    await header
      .getByRole('button', { name: /^Open in new window: / })
      .first()
      .click();
    await expect
      .poll(async () =>
        worker.evaluate(async (known) => {
          const opened = (await chrome.windows.getAll({ populate: true }))
            .filter((x) => !known.includes(x.id))
            .flatMap((x) => x.tabs ?? []);
          const ids = opened
            .map((t) => t.splitViewId ?? -1)
            .filter((id) => id > 0);
          return ids.length === 2 && ids[0] === ids[1];
        }, before)
      )
      .toBe(true);
  });

  test('16. the landing spot on the saved side is two rows tall', async ({
    context,
    extensionId,
    serviceWorker: worker,
  }) => {
    const w = await openLiveWindow(worker, ['A', 'B', 'C']);
    const [b, c] = [w.idOf('B'), w.idOf('C')];
    await makeSplit(worker, [b, c]);
    const page = await setUp(context, extensionId);
    await expect(liveRow(page, c)).toBeVisible();
    const row = (await boxOf(tabHandle(page, 's1'))).height;

    const { y } = await lift(page, liveRow(page, b));
    const pane = await boxOf(page.locator(OPEN_NOW));
    await page.mouse.move(pane.x - 40, y, { steps: 6 });
    await expect(page.locator('[data-carry-card]')).toHaveCount(1);
    await carryTo(page, await topOf(tabHandle(page, 's1')));
    await page.waitForTimeout(350);

    const slot = await boxOf(page.locator(SLOT));
    expect(Math.abs(slot.height - 2 * row)).toBeLessThan(3);
    await page.keyboard.press('Escape');
    await page.mouse.up();
  });

  test('17. the last New window target is two rows tall, and takes the pair', async ({
    context,
    extensionId,
    serviceWorker: worker,
  }) => {
    const w = await openLiveWindow(worker, ['A', 'B', 'C']);
    const [b, c] = [w.idOf('B'), w.idOf('C')];
    await makeSplit(worker, [b, c]);
    const page = await setUp(context, extensionId);
    await expect(liveRow(page, c)).toBeVisible();
    const row = (await boxOf(tabHandle(page, 's1'))).height;

    const { y } = await lift(page, liveRow(page, b));
    const pane = await boxOf(page.locator(OPEN_NOW));
    await page.mouse.move(pane.x - 40, y, { steps: 6 });
    await expect(page.locator('[data-carry-card]')).toHaveCount(1);
    const target = page.locator('[data-new-window-target="last"]');
    const lastRow = await boxOf(tabHandle(page, 'g1'));
    await carryTo(page, {
      x: lastRow.x + 80,
      y: lastRow.y + lastRow.height + 40,
    });
    await expect(target).toHaveAttribute('data-landing', /.*/);
    await page.waitForTimeout(350);
    const box = await boxOf(target);
    expect(Math.abs(box.height - 2 * row)).toBeLessThan(6);
    await page.mouse.up();

    await expect
      .poll(async () => {
        const { tabGroups } = await stored(page);
        const windows = tabGroups[0]?.windows ?? [];
        return windows[windows.length - 1]?.tabs.map((t) => t.title);
      })
      .toEqual(['B', 'C']);
  });

  test('15. the card has two rows', async ({
    context,
    extensionId,
    serviceWorker: worker,
  }) => {
    const w = await openLiveWindow(worker, ['A', 'B', 'C']);
    const [b, c] = [w.idOf('B'), w.idOf('C')];
    await makeSplit(worker, [b, c]);
    const page = await setUp(context, extensionId);
    await expect(liveRow(page, c)).toBeVisible();

    await lift(page, liveRow(page, c));
    await expect(page.locator(CARD_NAMES)).toHaveText(['B', 'C']);
    const [one, two] = await page
      .locator(CARD_NAMES)
      .evaluateAll((names) =>
        names.map((name) => name.getBoundingClientRect().top)
      );
    expect(two).toBeGreaterThan(one ?? 0);
    await page.keyboard.press('Escape');
    await page.mouse.up();
  });
});

ungrantedTest.describe('without the grant (KAN-486)', () => {
  ungrantedTest(
    '13. without the grant a pair still moves as one',
    async ({ context, extensionId, serviceWorker: worker }) => {
      const w = await openLiveWindow(worker, ['A', 'B', 'C', 'D']);
      const [a, b, c, d] = ['A', 'B', 'C', 'D'].map(w.idOf) as [
        number,
        number,
        number,
        number,
      ];
      await makeSplit(worker, [b, c]);
      const page = await setUp(context, extensionId);
      await expect(liveRow(page, d)).toBeVisible();

      await drag(page, liveRow(page, b), () => justBelow(liveRow(page, d)));
      await expectPairAt(page, worker, w.windowId, [b, c], [a, d, b, c]);
    }
  );
});
