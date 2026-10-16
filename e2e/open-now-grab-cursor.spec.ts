import type { Locator, Page, Worker } from '@playwright/test';

import { grantedTest as test, expect } from './fixtures/grantedExtension';
import { openPage } from './fixtures/onboarding';
import { standIn } from './fixtures/standInPages';

// KAN-639 in Open now. A handle only the drag uses shows the hand: This
// window's header and a group's title row. A header that goes to its window
// is a button and keeps the pointer. Under Open now's search both drags are
// off, and both show the arrow.
const VIEW_TAB = 'index.html?view=tab';
const TAB_VIEWPORT = { width: 1280, height: 800 };
const OPEN_NOW = '[data-pane="open-now"]';

async function openKyoto(worker: Worker) {
  return worker.evaluate(async (urls) => {
    const win = await chrome.windows.create({ url: urls, focused: false });
    const [first, second] = (win?.tabs ?? []).map((tab) => tab.id ?? -1);
    await chrome.tabs.group({
      tabIds: [first, second],
      createProperties: { windowId: win?.id },
    });
    const [group] = await chrome.tabGroups.query({ windowId: win?.id });
    await chrome.tabGroups.update(group.id, { title: 'Kyoto', color: 'blue' });
    return win?.id ?? -1;
  }, ['Temples', 'Gardens', 'Loose'].map(standIn));
}

const windowBlock = (page: Page, windowId: number): Locator =>
  page.locator(`${OPEN_NOW} [data-open-window-id="${windowId}"]`);
const glyphIn = (block: Locator): Locator =>
  block.locator('[data-window-row]').getByText('web_asset', { exact: true });

async function thisWindowId(page: Page): Promise<number> {
  const id = await page.evaluate(
    async () => (await chrome.tabs.getCurrent())?.windowId ?? null
  );
  if (id === null) throw new Error('the tab view is not a tab');
  return id;
}

async function cursorAt(page: Page, x: number, y: number): Promise<string> {
  return page.evaluate(
    ([px, py]) => {
      const el = document.elementFromPoint(px, py);
      return el === null ? '<nothing>' : getComputedStyle(el).cursor;
    },
    [x, y]
  );
}

async function cursorAtCentreOf(page: Page, target: Locator): Promise<string> {
  const box = await target.boundingBox();
  if (box === null) throw new Error('the target has no layout box');
  return cursorAt(page, box.x + box.width / 2, box.y + box.height / 2);
}

// Midway between the group title's right edge and the first button after it.
async function gapBesideGroupTitle(
  band: Locator
): Promise<{ x: number; y: number }> {
  const title = await band
    .getByRole('button', { name: 'Rename group: Kyoto' })
    .boundingBox();
  const row = await band.boundingBox();
  if (title === null || row === null) throw new Error('no band layout');
  await band.hover();
  const rights: number[] = [];
  for (const b of await band.locator('button').all()) {
    const bb = await b.boundingBox();
    if (bb !== null && bb.x > title.x + title.width + 1) rights.push(bb.x);
  }
  const edge = Math.min(row.x + row.width, ...rights);
  const left = title.x + title.width;
  if (edge - left < 8) throw new Error('no empty gap beside the title');
  return { x: left + (edge - left) / 2, y: title.y + title.height / 2 };
}

async function setUp(
  context: Parameters<typeof openPage>[0],
  extensionId: string,
  serviceWorker: Worker
) {
  const page = await openPage(context, extensionId, VIEW_TAB, TAB_VIEWPORT);
  const windowId = await openKyoto(serviceWorker);
  const block = windowBlock(page, windowId);
  const home = windowBlock(page, await thisWindowId(page));
  const band = block.locator('[data-group-drag-handle]');
  await expect(band).toBeVisible();
  await expect(glyphIn(home)).toBeVisible();
  return { page, block, home, band };
}

test('This window shows the hand; a window that goes to its window keeps the pointer', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  const { page, block, home } = await setUp(
    context,
    extensionId,
    serviceWorker
  );
  expect(await cursorAtCentreOf(page, glyphIn(home))).toBe('grab');
  // Same handle, inside the Go to window button: the click's pointer wins.
  await expect(
    block.getByRole('button', { name: /^Go to window: / })
  ).toBeVisible();
  expect(await cursorAtCentreOf(page, glyphIn(block))).toBe('pointer');
});

test("a group's title row shows the hand beside its title; the title keeps the caret", async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  const { page, band } = await setUp(context, extensionId, serviceWorker);
  const gap = await gapBesideGroupTitle(band);
  expect(await cursorAt(page, gap.x, gap.y)).toBe('grab');
  const title = band
    .getByRole('button', { name: 'Rename group: Kyoto' })
    .getByText('Kyoto', { exact: true });
  expect(await cursorAtCentreOf(page, title)).toBe('text');
});

test("under Open now's search, where both drags are off, both show the arrow", async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  const { page, block, band } = await setUp(
    context,
    extensionId,
    serviceWorker
  );
  await page
    .locator(OPEN_NOW)
    .getByRole('textbox', { name: 'Search open tabs', exact: true })
    .fill('Temples');
  await expect(band).toBeVisible();
  const gap = await gapBesideGroupTitle(band);
  expect(await cursorAt(page, gap.x, gap.y)).toBe('default');
  // PREMISE (S2): under a search the header is no button, so only the guard can keep the hand off.
  await expect(
    block.getByRole('button', { name: /^Go to window: / })
  ).toHaveCount(0);
  expect(await cursorAtCentreOf(page, glyphIn(block))).toBe('default');
});
