// KAN-132. One drag area over every tab in the session, so a tab can drop into another window. Inside one window it moves
// only that window's rows; over another it moves there, previewed in each window's own frame; in no window it is refused.
// Previews are read from the COMMANDED transforms, never rects: rows ease over 0.18s (KAN-165).

import type { BrowserContext, Page } from '@playwright/test';

import { grantedTest as test, expect } from './fixtures/grantedExtension';
import { buildContainer, buildSession, seedSessions } from './fixtures/seed';
import { holdSweepAt } from './fixtures/dwell';
import { boxOf, stored } from './fixtures/savedWindows';

const tab = (id: string, g?: string) => ({
  tabId: id,
  favicon: '',
  title: `Tab ${id}`,
  url: `https://${id}.test/`,
  ...(g ? { chromeGroupId: g } : {}),
});

const win = (
  id: string,
  tabs: ReturnType<typeof tab>[],
  groups: { groupId: string; title: string; color: string }[]
) => ({
  windowId: id,
  windowHeight: 1080,
  windowWidth: 1920,
  windowOffsetTop: 0,
  windowOffsetLeft: 0,
  tabCount: tabs.length,
  title: id,
  tabs,
  chromeTabGroups: groups,
});

// w1: three loose tabs, then a one-tab group. w2: a LEADING group, then two loose tabs, so w2's group starts at local
// index 0, like w1's first tab. Small, because the popup's pane is a fixed 415px and an overflowing session auto-scrolls.
const WINDOWS = [
  win(
    'w1',
    [tab('a0'), tab('a1'), tab('a2'), tab('al0', 'alpha')],
    [{ groupId: 'alpha', title: 'Alpha', color: 'blue' }]
  ),
  win(
    'w2',
    [tab('be0', 'beta'), tab('be1', 'beta'), tab('b0'), tab('b1')],
    [{ groupId: 'beta', title: 'Beta', color: 'red' }]
  ),
];
const W1_START = 'a0 a1 a2 al0*';
const W2_START = 'be0* be1* b0 b1';

async function open(
  context: BrowserContext,
  extensionId: string
): Promise<Page> {
  const session = buildSession({
    tabGroupId: 's1',
    title: 'Cross window',
    isSelected: true,
    windowCount: WINDOWS.length,
    tabCount: WINDOWS.reduce((n, w) => n + w.tabs.length, 0),
    windows: WINDOWS,
  });
  await seedSessions(context, {
    ...buildContainer([session]),
    selectedTabGroupId: 's1',
  });
  const page = await context.newPage();
  await page.setViewportSize({ width: 790, height: 550 });
  await page.goto(`chrome-extension://${extensionId}/index.html`);
  // goto resolves before React mounts (KAN-105), and the bands need the grant.
  await expect(page.locator('[data-band-id="beta"]')).toBeAttached();
  // PREMISE: nothing scrolls, so no drag here auto-scrolls.
  const pane = await page.evaluate(() => {
    let el = document.querySelector<HTMLElement>(
      '[data-drag-row-id="w1"]'
    )?.parentElement;
    while (el && !['auto', 'scroll'].includes(getComputedStyle(el).overflowY))
      el = el.parentElement;
    if (!el) throw new Error('no scrolling pane around w1');
    return { scrollHeight: el.scrollHeight, clientHeight: el.clientHeight };
  });
  expect(pane.scrollHeight).toBeLessThanOrEqual(pane.clientHeight);
  return page;
}

// The stored session s1.
async function s1(page: Page) {
  const session = (await stored(page)).tabGroups.find(
    (g) => g.tabGroupId === 's1'
  );
  if (session === undefined) throw new Error('no session s1 stored');
  return session;
}

// One stored window of s1.
async function storedWindow(page: Page, windowId: string) {
  const window = (await s1(page)).windows.find((w) => w.windowId === windowId);
  if (window === undefined) throw new Error(`no window ${windowId} stored`);
  return window;
}

// A window's stored tab order, with a star on every grouped tab.
const order = async (page: Page, windowId: string) =>
  (await storedWindow(page, windowId)).tabs
    .map((t) => t.tabId + (t.chromeGroupId ? '*' : ''))
    .join(' ');

// A window's own stored group entries: order()'s '*' would still read empty with a tab-less entry left behind.
const chromeGroupIdsOf = async (page: Page, windowId: string) =>
  ((await storedWindow(page, windowId)).chromeTabGroups ?? []).map(
    (g) => g.groupId
  );

const rowBox = (page: Page, rowId: string) =>
  boxOf(page.locator(`[data-drag-row-id="${rowId}"]`));

// Picks `rowId` up and holds it at `toY`, without releasing.
async function holdAt(page: Page, rowId: string, toY: number) {
  const b = await rowBox(page, rowId);
  const x = b.x + 60;
  const startY = b.y + b.height / 2;
  const dir = toY > startY ? 1 : -1;
  await page.mouse.move(x, startY);
  await page.mouse.down();
  await page.mouse.move(x, startY + dir * 8);
  await page.mouse.move(x, toY, { steps: 8 });
  return x;
}

// Every commanded shift in a window's block: tab and item rows, and its groups' title rows.
const shiftsIn = (page: Page, windowId: string) =>
  page.evaluate((windowId) => {
    const block = document.querySelector<HTMLElement>(
      `[data-drop-window-id="${windowId}"]`
    );
    if (!block) throw new Error(`no block for ${windowId}`);
    const out: Record<string, number> = {};
    for (const el of block.querySelectorAll<HTMLElement>(
      '[data-drag-row-id], [data-group-drag-handle]'
    )) {
      if (el.hasAttribute('data-drag-held')) continue;
      const band = el.closest<HTMLElement>('[data-band-id]')?.dataset.bandId;
      if (el.dataset.dragRowId === undefined && band === undefined)
        throw new Error('a title row outside any band');
      const key = el.dataset.dragRowId ?? `title:${band}`;
      const n = Number(
        /translateY\((-?[\d.]+)px\)/.exec(el.style.transform)?.[1] ?? 0
      );
      if (n !== 0) out[key] = n;
    }
    return out;
  }, windowId);

const marked = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('[data-drop-target]')].map(
      (b) => b.dataset.bandId
    )
  );

test.describe('a tab drag inside one window', () => {
  // A pane-wide preview range would shift rows outside the window the drag is in.
  test('moves no row in the other window', async ({ context, extensionId }) => {
    const page = await open(context, extensionId);

    // a1 to the top of w1: index 0, where w2's leading group also starts.
    const a0 = await rowBox(page, 'a0');
    await holdAt(page, 'a1', a0.y + 4);

    // CONTROL: the preview is live in w1, or "nothing moved in w2" would pass for a preview that moved nothing.
    await expect
      .poll(() => shiftsIn(page, 'w1'))
      .toEqual({ a0: expect.any(Number) });
    expect((await shiftsIn(page, 'w1')).a0).toBeGreaterThan(0);

    // THE CLAIM.
    expect(await shiftsIn(page, 'w2')).toEqual({});

    // And at the far end of w1, the widest range a drag inside it can open.
    const al0 = await rowBox(page, 'al0');
    await page.mouse.move(a0.x + 60, al0.y + al0.height - 4, { steps: 8 });
    await expect
      .poll(async () => Object.keys(await shiftsIn(page, 'w1')).length)
      .toBeGreaterThan(1);
    expect(await shiftsIn(page, 'w2')).toEqual({});

    await page.keyboard.press('Escape');
    await page.mouse.up();
    expect(await order(page, 'w1')).toBe(W1_START);
    expect(await order(page, 'w2')).toBe(W2_START);
  });

  // The reported index applies to the tab's own window, so it counts that window's rows only.
  test('in the second window, lands at its place in that window', async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId);

    // b1 up, just inside b0's top: above b0's midpoint and below beta's band.
    const b0 = await rowBox(page, 'b0');
    await holdAt(page, 'b1', b0.y + 3);
    await page.mouse.up();

    await expect.poll(() => order(page, 'w2')).toBe('be0* be1* b1 b0');
    expect(await order(page, 'w1')).toBe(W1_START);
  });

  // A release in another window's band joins it, so that band lights (KAN-164) and the one left goes dark.
  test('marks the band of whichever window it is over, and clears the one it left', async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId);

    const centre = async (bandId: string) => {
      const b = await boxOf(page.locator(`[data-band-id="${bandId}"]`));
      return b.y + b.height / 2;
    };

    const x = await holdAt(page, 'a0', await centre('alpha'));
    // THE CONTROL: marking works at all.
    await expect.poll(() => marked(page)).toEqual(['alpha']);

    const betaY = await centre('beta');
    await page.mouse.move(x, betaY, { steps: 8 });
    // PREMISE: the pointer really is inside beta's band.
    expect(
      await page.evaluate(
        ([x, y]) => {
          const band = document.querySelector('[data-band-id="beta"]');
          if (!band) throw new Error('no beta band');
          const r = band.getBoundingClientRect();
          return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
        },
        [x, betaY]
      )
    ).toBe(true);
    // Marking is synchronous with the resolved move, so this is the answer for the pointer where it is now.
    expect(await marked(page)).toEqual(['beta']);

    await page.keyboard.press('Escape');
    await page.mouse.up();
    expect(await marked(page)).toEqual([]);
  });
});

// A window's block -- header and tabs -- in the viewport.
const blockBox = (page: Page, windowId: string) =>
  boxOf(page.locator(`[data-drop-window-id="${windowId}"]`));

test.describe('a tab released over another window', () => {
  // KAN-132. The drop this whole ticket is for.
  test('from the first window, lands there', async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId);

    // Past b0's midpoint, not b1's, and below beta's band: after b0, loose.
    const b0 = await rowBox(page, 'b0');
    await holdAt(page, 'a0', b0.y + b0.height - 4);
    await page.mouse.up();

    await expect.poll(() => order(page, 'w2')).toBe('be0* be1* b0 a0 b1');
    expect(await order(page, 'w1')).toBe('a1 a2 al0*');
  });

  test('from the second window, lands there', async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId);

    // Past a1's midpoint, not a2's: after a1.
    const a1 = await rowBox(page, 'a1');
    await holdAt(page, 'b0', a1.y + a1.height - 4);
    await page.mouse.up();

    await expect.poll(() => order(page, 'w1')).toBe('a0 a1 b0 a2 al0*');
    expect(await order(page, 'w2')).toBe('be0* be1* b1');
  });
});

// A grouped tab dragged LOOSE into another window carries no membership, and the group it leaves, now empty, is gone.
test.describe('a grouped tab leaving its group for another window', () => {
  test('lands with no group membership, and its old group is gone', async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId);

    // Past b0's midpoint, loose -- not inside beta's band.
    const b0 = await rowBox(page, 'b0');
    await holdAt(page, 'al0', b0.y + b0.height - 4);
    await page.mouse.up();

    // THE STORED MEMBERSHIP: al0 arrives with no chromeGroupId, so no '*'.
    await expect.poll(() => order(page, 'w2')).toBe('be0* be1* b0 al0 b1');
    // THE SOURCE: alpha's only member left, so it is gone from w1, title row too.
    expect(await order(page, 'w1')).toBe('a0 a1 a2');
    await expect(page.locator('[data-band-id="alpha"]')).toHaveCount(0);
    // THE STORED PRUNE: alpha is gone from w1's chromeTabGroups, not just unclaimed and undrawn.
    expect(await chromeGroupIdsOf(page, 'w1')).toEqual([]);
  });
});

// A release naming no window is refused (KAN-131, KAN-132). Each pairs with a drop above that moves.
test.describe('a tab released in no window', () => {
  test('beside the pane, level with another window, commits nothing', async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId);

    const b0 = await rowBox(page, 'b0');
    const w2 = await blockBox(page, 'w2');
    const x = await holdAt(page, 'a0', b0.y + b0.height / 2);
    // Out past the window's left edge, over the session list.
    const besideX = w2.x - 20;
    await page.mouse.move(besideX, b0.y + b0.height / 2, { steps: 8 });
    // PREMISE: that really is outside the window's block.
    expect(besideX).toBeLessThan(w2.x);
    expect(x).toBeGreaterThan(w2.x);
    await page.mouse.up();

    await page.waitForTimeout(150);
    expect(await order(page, 'w1')).toBe(W1_START);
    expect(await order(page, 'w2')).toBe(W2_START);
  });
});

// The landing slot's top: it rides the held row and neither eases, so its box is already where it was commanded.
const slotTop = (page: Page) =>
  page.evaluate(() => {
    const slot = document.querySelector('[data-drag-landing-slot]');
    if (!slot) throw new Error('no landing slot drawn');
    return slot.getBoundingClientRect().top;
  });

const titleBox = (page: Page, bandId: string) =>
  boxOf(page.locator(`[data-band-id="${bandId}"] [data-group-drag-handle]`));

// KAN-132. Each window is previewed in its OWN frame: the one left closes up, the one entered opens from the insertion
// point down, nothing else moves. One range across both lifted rows into a header and drew the slot a row late.
test.describe('what a drag into another window previews', () => {
  test('down into the middle: only rows past the landing point step down', async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId);
    const b0 = await rowBox(page, 'b0');
    const b1 = await rowBox(page, 'b1');

    await holdAt(page, 'a0', b0.y + b0.height - 4);

    await expect
      .poll(async () => Object.keys(await shiftsIn(page, 'w1')).length)
      .toBe(4);
    const fp = -(await shiftsIn(page, 'w1')).a1;
    expect(fp).toBeGreaterThan(0);
    // The window it left closes up, title row included.
    expect(await shiftsIn(page, 'w1')).toEqual({
      a1: -fp,
      a2: -fp,
      al0: -fp,
      'title:alpha': -fp,
    });
    // The window it enters opens at b1, and ONLY there.
    expect(await shiftsIn(page, 'w2')).toEqual({ b1: fp });
    // The slot is the space b1 vacated.
    expect(await slotTop(page)).toBeCloseTo(b1.y, 0);

    await page.keyboard.press('Escape');
    await page.mouse.up();
    expect(await order(page, 'w1')).toBe(W1_START);
    expect(await order(page, 'w2')).toBe(W2_START);
  });

  test('up into the middle: the same, the other way', async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId);
    const a1 = await rowBox(page, 'a1');
    const a2 = await rowBox(page, 'a2');

    await holdAt(page, 'b0', a1.y + a1.height - 4);

    await expect
      .poll(async () => Object.keys(await shiftsIn(page, 'w1')).length)
      .toBe(3);
    const fp = (await shiftsIn(page, 'w1')).a2;
    expect(fp).toBeGreaterThan(0);
    expect(await shiftsIn(page, 'w1')).toEqual({
      a2: fp,
      al0: fp,
      'title:alpha': fp,
    });
    expect(await shiftsIn(page, 'w2')).toEqual({ b1: -fp });
    expect(await slotTop(page)).toBeCloseTo(a2.y, 0);

    await page.mouse.up();
    await expect.poll(() => order(page, 'w1')).toBe('a0 a1 b0 a2 al0*');
  });

  // Past another window's last row nothing steps aside; the slot goes to the block's bottom.
  test("past another window's last row: nothing there moves, and the slot sits at its end", async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId);
    const w2 = await blockBox(page, 'w2');
    const b1 = await rowBox(page, 'b1');
    const y = w2.y + w2.height - 3;
    // PREMISE: past b1's midpoint, and still inside the window's block.
    expect(y).toBeGreaterThan(b1.y + b1.height / 2);

    await holdAt(page, 'a0', y);

    await expect
      .poll(async () => Object.keys(await shiftsIn(page, 'w1')).length)
      .toBe(4);
    expect(await shiftsIn(page, 'w2')).toEqual({});
    expect(await slotTop(page)).toBeCloseTo(w2.y + w2.height, 0);

    await page.mouse.up();
    await expect.poll(() => order(page, 'w2')).toBe('be0* be1* b0 b1 a0');
    expect(await order(page, 'w1')).toBe('a1 a2 al0*');
  });

  // A collapsed window draws no rows, so a release on it is index 0 (spec 7.1); the slot sits under its header.
  test('into a collapsed window: lands first, and the slot sits under its header', async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId);
    await page
      .locator('[data-drop-window-id="w2"]')
      .getByRole('button', { name: /^Collapse(: |$)/ })
      .click();
    await expect(
      page.locator('[data-drop-window-id="w2"] [data-window-tabs]')
    ).toHaveCount(0);
    const w2 = await blockBox(page, 'w2');

    await holdAt(page, 'a0', w2.y + w2.height / 2);
    // Resting on its title opens it (KAN-379); the sweep is held at 0, so these reads see it folded.
    await holdSweepAt(
      page,
      '[data-drop-window-id="w2"] > [data-window-drag-handle]',
      0
    );
    await expect(
      page.locator('[data-drop-window-id="w2"][data-spring-dwell]')
    ).toHaveCount(1);

    await expect
      .poll(async () => Object.keys(await shiftsIn(page, 'w1')).length)
      .toBe(4);
    expect(await shiftsIn(page, 'w2')).toEqual({});
    expect(await slotTop(page)).toBeCloseTo(w2.y + w2.height, 0);

    await page.mouse.up();
    await expect.poll(() => order(page, 'w2')).toBe(`a0 ${W2_START}`);
    expect(await order(page, 'w1')).toBe('a1 a2 al0*');
  });

  // The destination's group edges come from its own positions: KAN-170's lift-out applies only to a row the list contains.
  test("loose, just above another window's group: lands before its title row", async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId);
    const a2 = await rowBox(page, 'a2');
    const title = await titleBox(page, 'alpha');
    const y = a2.y + a2.height - 2;
    // PREMISE: past a2's midpoint, and above alpha's band.
    expect(y).toBeLessThan(title.y);

    await holdAt(page, 'b0', y);

    await expect
      .poll(async () => Object.keys(await shiftsIn(page, 'w1')).length)
      .toBe(2);
    const fp = (await shiftsIn(page, 'w1')).al0;
    expect(await shiftsIn(page, 'w1')).toEqual({ 'title:alpha': fp, al0: fp });
    // AGAINST WHERE THE TAB RESTS (KAN-167): the title row's top is 2px lower, the band's margin a loose tab does not pay.
    expect(await slotTop(page)).toBeCloseTo(a2.y + a2.height, 0);
    expect(await marked(page)).toEqual([]);

    await page.mouse.up();
    await expect.poll(() => order(page, 'w1')).toBe('a0 a1 a2 b0 al0*');
  });

  // Exact footprint and exact w2 shift: a flat range across both windows, or the lift-out applied to another window's row, fails here.
  test("inside another window's group, at its head: joins it under the title row", async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId);
    const title = await titleBox(page, 'alpha');
    const al0 = await rowBox(page, 'al0');
    const b0 = await rowBox(page, 'b0');

    await holdAt(page, 'b0', title.y + title.height / 2);

    await expect.poll(() => marked(page)).toEqual(['alpha']);
    await expect
      .poll(() => shiftsIn(page, 'w1'))
      .toEqual({ al0: expect.any(Number) });
    // THE DESTINATION SHIFT: al0, alpha's only other member, makes room by exactly b0's footprint.
    const fp = (await shiftsIn(page, 'w1')).al0;
    expect(fp).toBeCloseTo(b0.height, 0);
    // THE SOURCE SHIFT, exactly: only b1 moves in w2; be0, be1 or title:beta would mean the range crossed the group.
    expect(await shiftsIn(page, 'w2')).toEqual({ b1: -fp });
    expect(await slotTop(page)).toBeCloseTo(al0.y, 0);

    await page.mouse.up();
    await expect.poll(() => order(page, 'w1')).toBe('a0 a1 a2 b0* al0*');
    expect(await order(page, 'w2')).toBe('be0* be1* b1');
  });

  // Mid-group in another window: the index changes, so this counts PASSED midpoints, not the title-row special case.
  test("inside another window's group, mid-group: joins between its members", async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId);
    const be0 = await rowBox(page, 'be0');

    // Past be0's midpoint, before be1's: the second position in the group.
    await holdAt(page, 'a0', be0.y + be0.height - 4);
    await page.mouse.up();

    await expect.poll(() => order(page, 'w2')).toBe('be0* a0* be1* b0 b1');
    expect(await order(page, 'w1')).toBe('a1 a2 al0*');
  });

  test("inside another window's group, at its tail (KAN-176): joins after its last member", async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId);
    const be1 = await rowBox(page, 'be1');

    // Past be1's midpoint, still on its row: joins after the last member, not loose below the group.
    await holdAt(page, 'a0', be1.y + be1.height - 4);
    await page.mouse.up();

    await expect.poll(() => order(page, 'w2')).toBe('be0* be1* a0* b0 b1');
    expect(await order(page, 'w1')).toBe('a1 a2 al0*');
  });
});

// A window's header is part of its block: a release there lands first. Its top used to be refused, past half a row above the first row.
test.describe('a tab released on its own window header', () => {
  test('lands first in that window', async ({ context, extensionId }) => {
    const page = await open(context, extensionId);
    const header = await boxOf(
      page.locator('[data-drop-window-id="w1"] [data-window-drag-handle]')
    );
    const a0 = await rowBox(page, 'a0');
    const y = header.y + 4;
    // PREMISE: beyond the half-row overshoot above the first row.
    expect(y).toBeLessThan(a0.y - a0.height / 2);

    await holdAt(page, 'a2', y);
    await page.mouse.up();

    await expect.poll(() => order(page, 'w1')).toBe('a2 a0 a1 al0*');
    expect(await order(page, 'w2')).toBe(W2_START);
  });
});

// Spec §2.1, re-measured 2026-09-12. isInsideList's half-row slack reaches into a sliver of the next window's header: the
// only test of header precedence over that overshoot.
test.describe("the 8px residue at another window's header (spec §2.1)", () => {
  test('a drop on the next window header goes into that window, not the end of this one', async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId);
    const al0 = await rowBox(page, 'al0');
    const header = await boxOf(
      page.locator('[data-drop-window-id="w2"] [data-window-drag-handle]')
    );
    const y = header.y + 4;

    // MEASURED 2026-09-12 at 790x550: al0 ends at 319 and w2's header starts at 329; half a row (16) reached 335, 6px into it. Logged.
    console.log(
      `al0Bottom=${al0.y + al0.height} header.top=${header.y} probe=${y}`
    );

    // PREMISE 1: the probe really is inside w2's header.
    expect(y).toBeGreaterThanOrEqual(header.y);
    expect(y).toBeLessThan(header.y + header.height);
    // PREMISE 2: also inside w1's old overshoot zone (last row's bottom plus half a row).
    expect(header.y + 4).toBeLessThan(al0.y + al0.height + al0.height / 2);

    await holdAt(page, 'a0', y);
    await page.mouse.up();

    // THE CLAIM: it lands in B, at its head -- not saturated to the end of A.
    await expect.poll(() => order(page, 'w2')).toBe(`a0 ${W2_START}`);
    expect(await order(page, 'w1')).toBe('a1 a2 al0*');
  });

  // CONTROL: the overshoot itself still works -- inside it but short of B's header, the release lands last in A.
  test("CONTROL: a release just past A's last row, short of B's header, still lands in A", async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId);
    const al0 = await rowBox(page, 'al0');
    const header = await boxOf(
      page.locator('[data-drop-window-id="w2"] [data-window-drag-handle]')
    );
    const y = al0.y + al0.height + 4;

    console.log(
      `al0Bottom=${al0.y + al0.height} header.top=${header.y} probe=${y}`
    );

    // PREMISE: inside the overshoot zone, and NOT inside w2's header.
    expect(y).toBeLessThan(al0.y + al0.height + al0.height / 2);
    expect(y).toBeLessThan(header.y);

    await holdAt(page, 'a1', y);
    await page.mouse.up();

    await expect.poll(() => order(page, 'w1')).toBe('a0 a2 al0* a1');
    expect(await order(page, 'w2')).toBe(W2_START);
  });
});

// Spec §7.1, end to end: "an empty window is not a thing". Its own fixture: WINDOWS has no single-tab window.
test.describe('a one-tab window emptied by the move', () => {
  const soloTab = tab('solo');

  async function openSolo(
    context: BrowserContext,
    extensionId: string
  ): Promise<Page> {
    const session = buildSession({
      tabGroupId: 's1',
      title: 'Emptying window',
      isSelected: true,
      windowCount: 2,
      tabCount: 3,
      windows: [
        win('w1', [soloTab], []),
        win('w2', [tab('b0'), tab('b1')], []),
      ],
    });
    await seedSessions(context, {
      ...buildContainer([session]),
      selectedTabGroupId: 's1',
    });
    const page = await context.newPage();
    await page.setViewportSize({ width: 790, height: 550 });
    await page.goto(`chrome-extension://${extensionId}/index.html`);
    await expect(page.locator('[data-drag-row-id="solo"]')).toBeAttached();
    return page;
  }

  test('the window goes with its last tab', async ({
    context,
    extensionId,
  }) => {
    const page = await openSolo(context, extensionId);

    const b0 = await rowBox(page, 'b0');
    await holdAt(page, 'solo', b0.y + b0.height - 4);
    await page.mouse.up();

    // THE STORED MOVE.
    await expect.poll(() => order(page, 'w2')).toBe('b0 solo b1');
    // THE CLAIM: w1 is gone, block and bookkeeping (windowCount, windows) alike.
    await expect(page.locator('[data-drop-window-id="w1"]')).toHaveCount(0);
    const g = await s1(page);
    expect({
      windowCount: g.windowCount,
      windowIds: g.windows.map((w) => w.windowId),
    }).toEqual({ windowCount: 1, windowIds: ['w2'] });
  });
});
