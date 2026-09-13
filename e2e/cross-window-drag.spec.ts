// KAN-132. A tab drag is one drag area over every tab in the session, rather
// than one per window, so that a tab can be dropped into another window.
//
// A drag inside one window must behave as it did when each window had a list of
// its own: it moves only that window's rows and lands at its place in that
// window. A release over another window moves the tab there, previewed in each
// window's own frame; a release in no window at all is refused.
//
// Previews are read from the COMMANDED inline transforms, never from rects: the
// rows ease into place over 0.18s (KAN-165), and a rect read straight after a
// move describes a row still on its way.

import type { BrowserContext, Page } from '@playwright/test';

import { grantedTest as test, expect } from './fixtures/grantedExtension';
import { buildContainer, buildSession, seedSessions } from './fixtures/seed';

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

// w1: three loose tabs, then a one-tab group. w2: a LEADING group, then two
// loose tabs -- so w2's group starts at window-local index 0, the same number as
// w1's first tab.
//
// As small as those shapes allow: the popup's pane is a fixed 415px whatever
// the viewport, and a session that overflows it scrolls, which a drag near an
// edge turns into auto-scroll moving rows under the held pointer.
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
  // PREMISE: nothing scrolls, so no drag here can auto-scroll -- none of these
  // claims is about scrolling.
  const pane = await page.evaluate(() => {
    let el = document.querySelector<HTMLElement>(
      '[data-drag-row-id="w1"]'
    )!.parentElement;
    while (el && !['auto', 'scroll'].includes(getComputedStyle(el).overflowY))
      el = el.parentElement;
    return { scrollHeight: el!.scrollHeight, clientHeight: el!.clientHeight };
  });
  expect(pane.scrollHeight).toBeLessThanOrEqual(pane.clientHeight);
  return page;
}

// A window's stored tab order, with a star on every grouped tab.
const order = (page: Page, windowId: string) =>
  page.evaluate((windowId) => {
    const data = JSON.parse(localStorage.getItem('tabContainerData')!) as {
      tabGroups: {
        tabGroupId: string;
        windows: {
          windowId: string;
          tabs: { tabId: string; chromeGroupId?: string }[];
        }[];
      }[];
    };
    return data.tabGroups
      .find((g) => g.tabGroupId === 's1')!
      .windows.find((w) => w.windowId === windowId)!
      .tabs.map((t) => t.tabId + (t.chromeGroupId ? '*' : ''))
      .join(' ');
  }, windowId);

const rowBox = async (page: Page, rowId: string) =>
  (await page.locator(`[data-drag-row-id="${rowId}"]`).boundingBox())!;

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

// Every commanded shift inside a window's block: its tab and item rows, and its
// groups' title rows, which the frame follower moves by transform.
const shiftsIn = (page: Page, windowId: string) =>
  page.evaluate((windowId) => {
    const block = document.querySelector<HTMLElement>(
      `[data-drop-window-id="${windowId}"]`
    )!;
    const out: Record<string, number> = {};
    for (const el of block.querySelectorAll<HTMLElement>(
      '[data-drag-row-id], [data-group-drag-handle]'
    )) {
      if (el.hasAttribute('data-drag-held')) continue;
      const key =
        el.dataset.dragRowId ??
        `title:${el.closest<HTMLElement>('[data-band-id]')!.dataset.bandId}`;
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
  // The regression guard for a pane-wide preview range: the rows the preview
  // shifts must stay inside the window the drag is in.
  test('moves no row in the other window', async ({ context, extensionId }) => {
    const page = await open(context, extensionId);

    // a1 to the top of w1: index 0, where w2's leading group also starts.
    const a0 = await rowBox(page, 'a0');
    await holdAt(page, 'a1', a0.y + 4);

    // THE CONTROL: the preview is live in w1 -- a0 steps down into a1's slot,
    // and nothing past a1 moves. Without it, "nothing moved in w2" would pass
    // for a preview that moved nothing anywhere.
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

  // The index a drop reports is applied to the tab's own window, so it must
  // count that window's rows -- not every row above it in the pane.
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

  // A release inside another window's band joins that group, so the band says
  // so (KAN-164) -- and the band the pointer left, in the other window, goes
  // dark rather than staying lit beside it.
  test('marks the band of whichever window it is over, and clears the one it left', async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId);

    const centre = async (bandId: string) => {
      const b = (await page
        .locator(`[data-band-id="${bandId}"]`)
        .boundingBox())!;
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
          const r = document
            .querySelector('[data-band-id="beta"]')!
            .getBoundingClientRect();
          return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
        },
        [x, betaY]
      )
    ).toBe(true);
    // THE CLAIM. Marking is synchronous with the move that has already
    // resolved, so this is the answer for the pointer where it now is.
    expect(await marked(page)).toEqual(['beta']);

    await page.keyboard.press('Escape');
    await page.mouse.up();
    expect(await marked(page)).toEqual([]);
  });
});

// A window's block -- header and tabs -- in the viewport.
const blockBox = async (page: Page, windowId: string) =>
  (await page.locator(`[data-drop-window-id="${windowId}"]`).boundingBox())!;

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

// A release that names no window has nowhere to go, and doing nothing is the
// honest answer (KAN-131, KAN-132). Each pairs with a drop above that does move,
// so a list that refused everything cannot pass here.
test.describe('a tab released in no window', () => {
  test('in the gap above the next window, from that window, commits nothing', async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId);

    const w1 = await blockBox(page, 'w1');
    const w2 = await blockBox(page, 'w2');
    const gapY = (w1.y + w1.height + w2.y) / 2;
    // PREMISE: there is a gap, and the release point is in neither block.
    expect(w2.y - (w1.y + w1.height)).toBeGreaterThanOrEqual(4);

    await holdAt(page, 'b0', gapY);
    await page.mouse.up();

    await page.waitForTimeout(150);
    expect(await order(page, 'w1')).toBe(W1_START);
    expect(await order(page, 'w2')).toBe(W2_START);
  });

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

// The landing slot's top. The slot rides on the held row, and neither carries a
// transition, so -- unlike the rows stepping aside -- its box is where it was
// commanded to be the moment the pointer stops.
const slotTop = (page: Page) =>
  page.evaluate(
    () =>
      document
        .querySelector('[data-drag-landing-slot]')!
        .getBoundingClientRect().top
  );

const titleBox = async (page: Page, bandId: string) =>
  (await page
    .locator(`[data-band-id="${bandId}"] [data-group-drag-handle]`)
    .boundingBox())!;

// KAN-132. Each window is previewed in its OWN frame: the one the tab leaves
// closes up below it, the one it enters opens up from the insertion point down,
// and nothing else moves. A single range across both windows -- the design's
// first claim -- lifted the destination's rows above that point into their own
// window's header, and drew the landing slot one row past where the tab lands.
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

  // Past another window's last row there is no row to step aside for. The slot
  // goes where a row appended to that window is drawn: its block's bottom.
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

  // A collapsed window draws no rows, so a release anywhere on it passes no
  // midpoint: index 0, which is where adding a tab to a window already puts it
  // (spec 7.1). The slot is under its header, where that row will be.
  test('into a collapsed window: lands first, and the slot sits under its header', async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId);
    await page
      .locator('[data-drop-window-id="w2"] [aria-label="Collapse"]')
      .click();
    await expect(
      page.locator('[data-drop-window-id="w2"] [data-window-tabs]')
    ).toHaveCount(0);
    const w2 = await blockBox(page, 'w2');

    await holdAt(page, 'a0', w2.y + w2.height / 2);

    await expect
      .poll(async () => Object.keys(await shiftsIn(page, 'w1')).length)
      .toBe(4);
    expect(await shiftsIn(page, 'w2')).toEqual({});
    expect(await slotTop(page)).toBeCloseTo(w2.y + w2.height, 0);

    await page.mouse.up();
    await expect.poll(() => order(page, 'w2')).toBe(`a0 ${W2_START}`);
    expect(await order(page, 'w1')).toBe('a1 a2 al0*');
  });

  // Group edges in the destination are answered by the destination's own
  // positions, with no allowance for a held row that was never in its list
  // (KAN-170's lift-out adjustment applies only to a row the list contains).
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
    expect(await slotTop(page)).toBeCloseTo(title.y, 0);
    expect(await marked(page)).toEqual([]);

    await page.mouse.up();
    await expect.poll(() => order(page, 'w1')).toBe('a0 a1 a2 b0 al0*');
  });

  test("inside another window's group, at its head: joins it under the title row", async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId);
    const title = await titleBox(page, 'alpha');
    const al0 = await rowBox(page, 'al0');

    await holdAt(page, 'b0', title.y + title.height / 2);

    await expect.poll(() => marked(page)).toEqual(['alpha']);
    await expect
      .poll(() => shiftsIn(page, 'w1'))
      .toEqual({
        al0: expect.any(Number),
      });
    expect(await slotTop(page)).toBeCloseTo(al0.y, 0);

    await page.mouse.up();
    await expect.poll(() => order(page, 'w1')).toBe('a0 a1 a2 b0* al0*');
    expect(await order(page, 'w2')).toBe('be0* be1* b1');
  });
});

// A window's block is a drop into that window, and its own header is part of
// its block: a release there lands first, as it does on any other window's
// header. The top of the header used to be refused, being further than half a
// row above the first row.
test.describe('a tab released on its own window header', () => {
  test('lands first in that window', async ({ context, extensionId }) => {
    const page = await open(context, extensionId);
    const header = (await page
      .locator('[data-drop-window-id="w1"] [data-window-drag-handle]')
      .boundingBox())!;
    const a0 = await rowBox(page, 'a0');
    const y = header.y + 4;
    // PREMISE: beyond the half-row overshoot above the first row, which is all
    // the list accepted there before a window's block counted.
    expect(y).toBeLessThan(a0.y - a0.height / 2);

    await holdAt(page, 'a2', y);
    await page.mouse.up();

    await expect.poll(() => order(page, 'w1')).toBe('a2 a0 a1 al0*');
    expect(await order(page, 'w2')).toBe(W2_START);
  });
});
