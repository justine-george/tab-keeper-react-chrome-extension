import type { BrowserContext, Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { buildContainer, buildSession, seedSessions } from './fixtures/seed';

// KAN-177. A drag swallows the click Chrome synthesizes for its own release, so
// dragging a tab does not also open it (KAN-128). It used to swallow the first
// click ANYWHERE in the next 400ms instead -- and a drag that commits gets no
// click from Chrome at all, because React moves the row inside the pointerup
// handler. So the click it ate was the user's next one: very often Undo.
//
// The fix tells the drag's own click apart by gesture: it follows the release
// with no press in between, and a click the user makes afterwards starts with a
// pointerdown of its own. That premise is about Chrome's event order, which
// jsdom cannot show, so it is asserted here in the real popup.

const TABS = ['t0', 't1', 't2', 't3'].map((id) => ({
  tabId: id,
  favicon: '',
  title: `Tab ${id}`,
  url: `https://${id}.test/`,
}));
const START = 't0 t1 t2 t3';

async function open(
  context: BrowserContext,
  extensionId: string
): Promise<Page> {
  const session = buildSession({
    tabGroupId: 's1',
    title: 'Click after drag',
    isSelected: true,
    windowCount: 1,
    tabCount: TABS.length,
    windows: [
      {
        windowId: 'w1',
        windowHeight: 1080,
        windowWidth: 1920,
        windowOffsetTop: 0,
        windowOffsetLeft: 0,
        tabCount: TABS.length,
        title: 'w1',
        tabs: TABS,
      },
    ],
  });
  await seedSessions(context, {
    ...buildContainer([session]),
    selectedTabGroupId: 's1',
  });
  const page = await context.newPage();
  await page.setViewportSize({ width: 790, height: 550 });
  await page.goto(`chrome-extension://${extensionId}/index.html`);
  // goto resolves before React mounts (KAN-105).
  await expect(page.locator('[data-drag-row-id="t3"]')).toBeAttached();
  return page;
}

const order = (page: Page) =>
  page.evaluate(() => {
    const data = JSON.parse(localStorage.getItem('tabContainerData')!) as {
      tabGroups: {
        tabGroupId: string;
        windows: { tabs: { tabId: string }[] }[];
      }[];
    };
    return data.tabGroups
      .find((g) => g.tabGroupId === 's1')!
      .windows[0].tabs.map((t) => t.tabId)
      .join(' ');
  });

const rowBox = async (page: Page, rowId: string) =>
  (await page.locator(`[data-drag-row-id="${rowId}"]`).boundingBox())!;

// Every pointerdown, pointerup and click the window sees, in order, with its
// time. Capture phase, so the drag's own suppression cannot hide one from it.
async function recordInput(page: Page) {
  await page.evaluate(() => {
    const log: { type: string; t: number }[] = [];
    (window as unknown as { __input: typeof log }).__input = log;
    for (const type of ['pointerdown', 'pointerup', 'click']) {
      window.addEventListener(
        type,
        (e) => log.push({ type: e.type, t: performance.now() }),
        true
      );
    }
  });
}

const readInput = (page: Page) =>
  page.evaluate(
    () =>
      (window as unknown as { __input: { type: string; t: number }[] }).__input
  );

test.describe('the click after a drag', () => {
  // THE PREMISE the fix rests on, measured rather than assumed. A drag that
  // moves nothing is the one Chrome DOES send a click for, on the held row --
  // and that click must arrive with no press between it and the release.
  test("PREMISE: a drag's own click follows its release with no press in between", async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId);
    await recordInput(page);

    // Sideways past the activation distance: zero vertical travel, so the drop
    // is a no-op and Chrome keeps the row under the pointer for the click.
    const b = await rowBox(page, 't1');
    const y = b.y + b.height / 2;
    await page.mouse.move(b.x + 60, y);
    await page.mouse.down();
    await page.mouse.move(b.x + 120, y, { steps: 6 });
    await page.mouse.up();

    await expect
      .poll(async () => (await readInput(page)).map((e) => e.type))
      .toEqual(['pointerdown', 'pointerup', 'click']);
    expect(await order(page)).toBe(START);
  });

  // CONTROL: the probe below can see a tab being opened. Without it, "no tab
  // opened" proves nothing -- a broken probe reports it too.
  test('CONTROL: a plain click on a tab row opens that tab', async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId);
    const before = context.pages().length;

    const b = await rowBox(page, 't1');
    await page.mouse.click(b.x + 60, b.y + b.height / 2);

    await expect
      .poll(() => context.pages().length, { timeout: 1000 })
      .toBe(before + 1);
  });

  // The KAN-128 guarantee, which the fix must keep.
  test('a drag that moves nothing does not open the tab it was dragging', async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId);
    const before = context.pages().length;

    const b = await rowBox(page, 't1');
    const y = b.y + b.height / 2;
    await page.mouse.move(b.x + 60, y);
    await page.mouse.down();
    await page.mouse.move(b.x + 120, y, { steps: 6 });
    await page.mouse.up();

    // As long as the control above allows a tab to appear in.
    await page.waitForTimeout(1000);
    expect(context.pages().length).toBe(before);
    expect(await order(page)).toBe(START);
  });

  // THE DEFECT.
  test('Undo clicked straight after a drag undoes the drag', async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId);
    const undo = page.getByRole('button', { name: 'Undo' });
    const undoBox = (await undo.boundingBox())!;
    await recordInput(page);

    // t0 carried past t2's midpoint: a committed move.
    const from = await rowBox(page, 't0');
    const to = await rowBox(page, 't2');
    const x = from.x + 60;
    const startY = from.y + from.height / 2;
    await page.mouse.move(x, startY);
    await page.mouse.down();
    await page.mouse.move(x, startY + 8);
    await page.mouse.move(x, to.y + to.height * 0.75, { steps: 8 });
    await page.mouse.up();

    // PREMISE: the drag really committed. If it had not, the order below would
    // read START with or without Undo, and this test would pass on the bug.
    expect(await order(page)).toBe('t1 t2 t0 t3');

    await page.mouse.click(
      undoBox.x + undoBox.width / 2,
      undoBox.y + undoBox.height / 2
    );

    // PREMISE: Undo was pressed INSIDE the 400ms the old suppression stayed
    // armed. A slower run would miss the window and pass on the bug.
    const input = await readInput(page);
    const release = input.filter((e) => e.type === 'pointerup')[0];
    const press = input.filter(
      (e) => e.type === 'pointerdown' && e.t > release.t
    )[0];
    expect(press.t - release.t).toBeLessThan(400);

    await expect.poll(() => order(page)).toBe(START);
  });
});
