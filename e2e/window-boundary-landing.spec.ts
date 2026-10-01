import type { BrowserContext, Page } from '@playwright/test';

import { grantedTest as test, expect } from './fixtures/grantedExtension';
import { buildContainer, buildSession, seedSessions } from './fixtures/seed';

// KAN-185. The boundary between two saved windows is a POINT, not a band.
//
// Windows sit 8px apart, and a pointer in that gap named no window at all. The
// drop fell back to the window the row came from, could not place it there
// either, and previewed NO CHANGE -- so dragging slowly across the boundary
// showed the landing snap home to the row's own origin and out again. Measured
// over a 6px band, with a tab dragged out of a group in the window below:
//
//   y 349   slot 349   landing at the end of the window above
//   y 351   slot 455   <- the row's own origin, nothing shifted
//   y 353   slot 455
//   y 355   slot 455
//   y 357   slot 389   landing inside the window below
//
// The gap now belongs to the nearer block, so the landing changes hands once,
// in the middle of it.

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

// The arrangement reported: the held row is the FIRST MEMBER of a group in the
// lower window, so a landing back at its origin is a distinct position from
// every other -- which is what makes the snap-home visible at all.
const WINDOWS = [
  win(
    'w1',
    Array.from({ length: 6 }, (_, i) => tab(`a${i}`))
  ),
  win(
    'w2',
    [
      tab('d0'),
      tab('be0', 'beta'),
      tab('be1', 'beta'),
      tab('be2', 'beta'),
      tab('b1'),
    ],
    [{ groupId: 'beta', title: 'Beta', color: 'red' }]
  ),
];

async function open(
  context: BrowserContext,
  extensionId: string
): Promise<Page> {
  const session = buildSession({
    tabGroupId: 's1',
    title: 'Window boundary',
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
  await expect(page.locator('[data-drag-row-id="be0"]')).toBeAttached();
  return page;
}

const boxOf = async (page: Page, selector: string) =>
  (await page.locator(selector).boundingBox())!;

const slotTop = (page: Page) =>
  page.evaluate(() => {
    const el = document.querySelector('[data-drag-landing-slot]');
    return el ? Math.round(el.getBoundingClientRect().top) : null;
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

async function pickUp(page: Page, rowId: string) {
  const b = await boxOf(page, `[data-drag-row-id="${rowId}"]`);
  const x = b.x + 60;
  const y = b.y + b.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y - 8);
  return { x, originTop: Math.round(b.y) };
}

test.describe('the gap between two windows', () => {
  test('never previews a landing back at the row own origin', async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId);
    const { x, originTop } = await pickUp(page, 'be0');
    const w1 = await boxOf(page, '[data-drop-window-id="w1"]');
    const w2 = await boxOf(page, '[data-drop-window-id="w2"]');

    // PREMISE: there IS a gap to cross, and the origin is somewhere else
    // entirely -- otherwise "the ghost went home" could not be told apart.
    expect(w2.y).toBeGreaterThan(w1.y + w1.height);
    expect(originTop).toBeGreaterThan(w2.y);

    const seen: number[] = [];
    for (let y = w1.y + w1.height - 8; y <= w2.y + 8; y += 2) {
      await page.mouse.move(x, y);
      await page.waitForTimeout(140);
      const top = await slotTop(page);
      expect(top).not.toBeNull();
      // THE DEFECT: the landing falling back to where the row already is.
      expect(top).not.toBe(originTop);
      if (seen[seen.length - 1] !== top) seen.push(top!);
    }

    // And it changed hands exactly once on the way across.
    expect(seen).toHaveLength(2);

    await page.keyboard.press('Escape');
    await page.mouse.up();
  });

  test('a release in the gap lands in the nearer window', async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId);
    const { x } = await pickUp(page, 'be0');
    const w1 = await boxOf(page, '[data-drop-window-id="w1"]');

    // Just above the middle of the gap: the window ABOVE owns it.
    const gapTop = w1.y + w1.height;
    await page.mouse.move(x, gapTop + 1, { steps: 6 });
    await page.waitForTimeout(220);
    const promised = await slotTop(page);
    await page.mouse.up();

    await expect.poll(() => order(page, 'w1')).toBe('a0 a1 a2 a3 a4 a5 be0');
    // What it promised is where it went: the end of the window above.
    const landed = await boxOf(page, '[data-drag-row-id="be0"]');
    expect(Math.abs(landed.y - promised!)).toBeLessThanOrEqual(2);
  });

  // CONTROL: the gap rule is for BETWEEN two windows. Below the last one is
  // the release beside the pane that isInsideList exists to refuse (KAN-132),
  // and making every empty pixel droppable would hand that defect back.
  test('CONTROL: a release below the last window still changes nothing', async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId);
    const before = await order(page, 'w2');
    const { x } = await pickUp(page, 'be0');
    const w2 = await boxOf(page, '[data-drop-window-id="w2"]');

    await page.mouse.move(x, w2.y + w2.height + 40, { steps: 8 });
    await page.waitForTimeout(220);
    await page.mouse.up();

    await expect.poll(() => order(page, 'w2')).toBe(before);
  });

  // CONTROL: horizontally outside the blocks, the gap is not a target either --
  // the same test the containment loop applies, applied to the gap.
  test('CONTROL: beside the pane, the gap names no window', async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId);
    const beforeW1 = await order(page, 'w1');
    const beforeW2 = await order(page, 'w2');
    await pickUp(page, 'be0');
    const w1 = await boxOf(page, '[data-drop-window-id="w1"]');

    // Left of every block, level with the gap between them.
    await page.mouse.move(Math.max(2, w1.x - 30), w1.y + w1.height + 4, {
      steps: 8,
    });
    await page.waitForTimeout(220);
    await page.mouse.up();

    await expect.poll(() => order(page, 'w1')).toBe(beforeW1);
    expect(await order(page, 'w2')).toBe(beforeW2);
    // PREMISE: x really was outside the block.
    expect(w1.x).toBeGreaterThan(2);
  });
});
