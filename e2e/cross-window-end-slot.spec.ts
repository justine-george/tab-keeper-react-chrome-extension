import type { BrowserContext, Page } from '@playwright/test';

import { grantedTest as test, expect } from './fixtures/grantedExtension';
import { buildContainer, buildSession, seedSessions } from './fixtures/seed';

// KAN-182. The ghost drawn for a row landing at the END of another window.
//
// Reported from the real popup, dragging a group up into the window above: the
// ghost covers the next window's header, reading as though the group were
// landing on that window rather than at the end of the one above it.
//
// The LANDING is right -- measured, the ghost's top sits exactly at the last
// row's bottom and the group comes to rest 2px below it (the KAN-167
// quantisation). What is wrong is the ghost's BOX. The slot is `inset: 0` on
// the held row, so it is a whole row tall, and appending to a window opens no
// space at that window's end: the rows that would step aside live in the NEXT
// window, and a cross-window preview only shifts rows within a window. So the
// box is drawn over whatever follows -- 24px into the next window's block,
// measured.
//
// Windows sit 8px apart, so there is a gap to draw in; there is just not a
// row's worth of it. The slot for this landing is drawn as an insertion LINE
// in that gap instead of a box in space that does not exist.
//
// Scrolled, because a long session is where this is seen and scrollTop 0 is
// the one position where the engine's coordinate bugs cannot appear.

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
  groups: { groupId: string; title: string; color: string }[] = []
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

// w1 is long enough that the pane scrolls; w2 LEADS with a group, as reported;
// w3 exists so an append to w2 also has something below it to cover.
const WINDOWS = [
  win(
    'w1',
    Array.from({ length: 8 }, (_, i) => tab(`a${i}`))
  ),
  win(
    'w2',
    [
      tab('be0', 'beta'),
      tab('be1', 'beta'),
      tab('be2', 'beta'),
      tab('b0'),
      tab('b1'),
    ],
    [{ groupId: 'beta', title: 'Beta', color: 'red' }]
  ),
  win(
    'w3',
    Array.from({ length: 4 }, (_, i) => tab(`c${i}`))
  ),
];

async function open(
  context: BrowserContext,
  extensionId: string
): Promise<Page> {
  const session = buildSession({
    tabGroupId: 's1',
    title: 'Cross window end slot',
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
  await expect(page.locator('[data-drag-row-id="group:beta"]')).toBeAttached();
  return page;
}

// Put `edge` ('top' or 'bottom') of the given element in the middle of the
// pane. Every test here scrolls: the session is longer than the pane, and
// scrollTop 0 is the one position where this engine's coordinate bugs cannot
// appear -- as well as being the arrangement the report was made in. Mid-pane
// also keeps the drag clear of both 48px auto-scroll zones.
async function centreOn(page: Page, selector: string, edge: 'top' | 'bottom') {
  return page.evaluate(
    ({ selector, edge }) => {
      let pane = document.querySelector<HTMLElement>(
        '[data-drag-row-id="w1"]'
      )!.parentElement;
      while (
        pane &&
        !['auto', 'scroll'].includes(getComputedStyle(pane).overflowY)
      )
        pane = pane.parentElement;
      const target = document.querySelector(selector)!.getBoundingClientRect();
      const box = pane!.getBoundingClientRect();
      pane!.scrollTop +=
        (edge === 'top' ? target.top : target.bottom) -
        (box.top + box.height / 2);
      return pane!.scrollTop;
    },
    { selector, edge }
  );
}

const scrollToBoundary = (page: Page) =>
  centreOn(page, '[data-drop-window-id="w2"]', 'top');

const boxOf = async (page: Page, selector: string) =>
  (await page.locator(selector).boundingBox())!;

const slotBox = (page: Page) =>
  page.evaluate(() => {
    const b = document
      .querySelector('[data-drag-landing-slot]')!
      .getBoundingClientRect();
    return { top: b.top, bottom: b.bottom, height: b.height };
  });

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

// Picks a group up by its title row. Boxes must be read AFTER this: the
// pick-up compresses the held group (KAN-160) and moves every window below it.
async function grabGroup(page: Page, groupId: string) {
  const b = await boxOf(
    page,
    `[data-drag-row-id="group:${groupId}"] [data-group-drag-handle]`
  );
  const x = b.x + 40;
  const y = b.y + b.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y - 8, { steps: 2 });
  return x;
}

test.describe('the ghost for a landing at the end of another window', () => {
  test('does not cover the window below it', async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId);
    await scrollToBoundary(page);

    const x = await grabGroup(page, 'beta');
    const w1 = await boxOf(page, '[data-drop-window-id="w1"]');
    // Past w1's last item but inside its block: an append to w1.
    await page.mouse.move(x, w1.y + w1.height - 3, { steps: 8 });
    await page.waitForTimeout(300);

    const slot = await slotBox(page);
    const lastRow = await boxOf(page, '[data-drag-row-id="tab:a7"]');
    const below = await boxOf(page, '[data-drop-window-id="w2"]');

    // PREMISE: the landing itself is right -- the ghost starts where the
    // appended row starts. This is what the fix must not move.
    expect(Math.abs(slot.top - lastRow.y - lastRow.height)).toBeLessThanOrEqual(
      2
    );
    // THE DEFECT: and it stays out of the window below.
    expect(slot.bottom).toBeLessThanOrEqual(below.y);

    await page.mouse.up();
    await expect
      .poll(() => order(page, 'w1'))
      .toBe('a0 a1 a2 a3 a4 a5 a6 a7 be0* be1* be2*');
  });

  // A TAB, appended to a MIDDLE window, coming from the window below it. Same
  // landing, different scope and different direction of travel -- the rule is
  // about the landing, so neither should matter.
  test('does not cover the window below it for a tab either', async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId);
    await centreOn(page, '[data-drop-window-id="w3"]', 'top');

    const held = await boxOf(page, '[data-drag-row-id="c0"]');
    const x = held.x + 60;
    const startY = held.y + held.height / 2;
    await page.mouse.move(x, startY);
    await page.mouse.down();
    await page.mouse.move(x, startY - 8);

    const w2 = await boxOf(page, '[data-drop-window-id="w2"]');
    await page.mouse.move(x, w2.y + w2.height - 3, { steps: 8 });
    await page.waitForTimeout(300);

    const slot = await slotBox(page);
    const below = await boxOf(page, '[data-drop-window-id="w3"]');

    expect(slot.bottom).toBeLessThanOrEqual(below.y);

    await page.mouse.up();
    await expect.poll(() => order(page, 'w2')).toBe('be0* be1* be2* b0 b1 c0');
  });

  // CONTROL: a landing among another window's rows opens a real gap, and the
  // ghost is still the full row-sized box that fills it. Without this, a fix
  // that drew every slot as a line would pass the two tests above.
  test('CONTROL: a landing among rows is still drawn as a full box', async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId);
    await scrollToBoundary(page);

    const x = await grabGroup(page, 'beta');
    const b1 = await boxOf(page, '[data-drag-row-id="tab:b1"]');
    await page.mouse.move(x, b1.y + 4, { steps: 8 });
    await page.waitForTimeout(300);

    const slot = await slotBox(page);
    const held = await boxOf(page, '[data-drag-row-id="group:beta"]');

    expect(slot.height).toBeGreaterThanOrEqual(held.height - 2);

    await page.mouse.up();
  });

  // KAN-183. The box has to COME BACK, within the same drag.
  //
  // The two shapes are two branches of one inline style object, and React
  // diffs those property by property: written as `inset` plus a `bottom`
  // override, going back to the box removed `bottom` instead of restoring it,
  // and the slot stayed collapsed to its own borders -- 2px -- for the rest of
  // the drag. Measured, and reported from the popup as a ghost that changed
  // shape as it moved.
  //
  // The controls above cannot see it: each starts a FRESH drag, where the box
  // is the first shape drawn. Only crossing from one to the other does.
  test('the box comes back after the line, within one drag', async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId);
    await scrollToBoundary(page);

    const x = await grabGroup(page, 'beta');
    const w1 = await boxOf(page, '[data-drop-window-id="w1"]');

    // First the append: the slot is a line.
    await page.mouse.move(x, w1.y + w1.height - 3, { steps: 8 });
    await page.waitForTimeout(300);
    const asLine = await slotBox(page);
    expect(asLine.height).toBeLessThan(16);

    // Then up among w1's rows, where a gap really does open.
    const a4 = await boxOf(page, '[data-drag-row-id="tab:a4"]');
    await page.mouse.move(x, a4.y + 4, { steps: 8 });
    await page.waitForTimeout(300);

    const asBox = await slotBox(page);
    const held = await boxOf(page, '[data-drag-row-id="group:beta"]');
    expect(asBox.height).toBeGreaterThanOrEqual(held.height - 2);

    await page.mouse.up();
  });

  // CONTROL: the same landing at the end of the LAST window, where nothing is
  // drawn below. It is the same "no gap opens" case, so it is drawn the same
  // way -- the rule is about the landing, not about what happens to be below.
  test('CONTROL: the last window in the pane is treated the same way', async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId);
    await centreOn(page, '[data-drop-window-id="w3"]', 'bottom');

    const x = await grabGroup(page, 'beta');
    const w3 = await boxOf(page, '[data-drop-window-id="w3"]');
    await page.mouse.move(x, w3.y + w3.height - 3, { steps: 8 });
    await page.waitForTimeout(300);

    const slot = await slotBox(page);
    const held = await boxOf(page, '[data-drag-row-id="group:beta"]');

    expect(slot.height).toBeLessThan(held.height / 2);

    await page.mouse.up();
    await expect
      .poll(() => order(page, 'w3'))
      .toBe('c0 c1 c2 c3 be0* be1* be2*');
  });
});
