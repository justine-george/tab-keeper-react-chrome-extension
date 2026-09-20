import type { BrowserContext, Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { buildContainer, buildSession, seedSessions } from './fixtures/seed';

// KAN-232. A tab drag that starts on the favicon picks the tab up.
//
// It did not. The favicon is an <img>, and an image is natively draggable by
// default: a press-and-move on it started the browser's own HTML5 drag -- a
// translucent ghost of the icon -- and the page stopped receiving pointer
// moves. The app's hand-rolled engine never saw the gesture, so every tab row
// had a 24px dead zone for pickup at its left edge, and the only feedback was
// a ghost that read as "the drag is happening" while nothing was.
//
// Found writing KAN-231's drag control at `row + 20`, which lands on the icon.
// Every existing drag spec picks up at `row + 60`, the title, so none had
// touched it.

const tab = (id: string) => ({
  tabId: id,
  favicon: '',
  title: `Tab ${id}`,
  url: `https://${id}.test/`,
});

const WINDOW = {
  windowId: 'w0',
  windowHeight: 1080,
  windowWidth: 1920,
  windowOffsetTop: 0,
  windowOffsetLeft: 0,
  tabCount: 4,
  title: 'w0',
  tabs: ['t0', 't1', 't2', 't3'].map(tab),
};
const TAB_IDS = WINDOW.tabs.map((t) => t.tabId);

async function open(
  context: BrowserContext,
  extensionId: string
): Promise<Page> {
  await seedSessions(context, {
    ...buildContainer([
      buildSession({
        tabGroupId: 's1',
        title: 'Favicon drag',
        isSelected: true,
        windowCount: 1,
        tabCount: WINDOW.tabs.length,
        windows: [WINDOW],
      }),
    ]),
    selectedTabGroupId: 's1',
  });
  const page = await context.newPage();
  await page.setViewportSize({ width: 790, height: 550 });
  await page.goto(`chrome-extension://${extensionId}/index.html`);
  await expect(page.locator('[data-drag-row-id="t1"]')).toBeVisible();
  return page;
}

const order = (page: Page) =>
  page.evaluate(
    (ids) =>
      Array.from(document.querySelectorAll<HTMLElement>('[data-drag-row-id]'))
        .map((el) => el.dataset.dragRowId!)
        .filter((id) => ids.includes(id)),
    TAB_IDS
  );

/**
 * Drags t1 to t3's centre, pressing at `x` -- the caller's choice of pixel.
 * A release at a row's centre lands just ABOVE that row, so t1 ends up between
 * t2 and t3.
 */
async function dragT1To3At(page: Page, x: number) {
  const from = (await page.locator('[data-drag-row-id="t1"]').boundingBox())!;
  const to = (await page.locator('[data-drag-row-id="t3"]').boundingBox())!;
  await page.mouse.move(x, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(x, from.y + from.height / 2 + 8);
  await page.mouse.move(x, to.y + to.height / 2, { steps: 8 });
  await page.mouse.up();
}

test.describe('a drag that starts on the favicon (KAN-232)', () => {
  test('picks the tab up, the same as a drag from its title', async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId);
    expect(await order(page)).toEqual(['t0', 't1', 't2', 't3']);

    // PREMISE: the pixel pressed is the favicon image, not the row's padding
    // and not the title. Without this, a layout change could move the press
    // onto the title and the test would pass for the wrong reason.
    const img = page.locator('[data-drag-row-id="t1"] img').first();
    await expect(img).toBeVisible();
    const box = (await img.boundingBox())!;
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    expect(
      await page.evaluate(
        ([x, y]) => document.elementFromPoint(x, y)?.tagName,
        [x, y] as const
      )
    ).toBe('IMG');

    await dragT1To3At(page, x);

    await expect.poll(() => order(page)).toEqual(['t0', 't2', 't1', 't3']);
  });

  // CONTROL: the same gesture from the title, which always worked. If this
  // fails too, the harness is broken rather than the favicon.
  test('CONTROL: the same drag from the title moves the tab', async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId);
    const from = (await page.locator('[data-drag-row-id="t1"]').boundingBox())!;

    await dragT1To3At(page, from.x + 60);

    await expect.poll(() => order(page)).toEqual(['t0', 't2', 't1', 't3']);
  });
});
