// KAN-132. A tab drag is one drag area over every tab in the session, rather
// than one per window, so that a tab can be dropped into another window.
//
// This file starts with the regression guards for that move, which must change
// nothing a user can see: a drag inside one window moves only that window's
// rows, lands at its place in that window, marks only that window's bands, and
// a release over another window is still refused.
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

  test("marks its own window's band, and never the other window's", async ({
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
    // resolved, and alpha's mark was cleared on the way, so this is a real
    // answer rather than a state nothing has touched yet.
    expect(await marked(page)).toEqual([]);

    await page.keyboard.press('Escape');
    await page.mouse.up();
  });
});

test.describe('a tab released over another window', () => {
  test('from the first window, commits nothing and previews nothing', async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId);

    const b0 = await rowBox(page, 'b0');
    await holdAt(page, 'a0', b0.y + b0.height / 2);
    await page.waitForTimeout(100);
    // A refused release previews the row going back where it came from.
    expect(await shiftsIn(page, 'w1')).toEqual({});
    expect(await shiftsIn(page, 'w2')).toEqual({});
    await page.mouse.up();

    await page.waitForTimeout(150);
    expect(await order(page, 'w1')).toBe(W1_START);
    expect(await order(page, 'w2')).toBe(W2_START);
  });

  test('from the second window, commits nothing', async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId);

    const a1 = await rowBox(page, 'a1');
    await holdAt(page, 'b0', a1.y + a1.height / 2);
    await page.mouse.up();

    await page.waitForTimeout(150);
    expect(await order(page, 'w1')).toBe(W1_START);
    expect(await order(page, 'w2')).toBe(W2_START);
  });
});
