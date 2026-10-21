// KAN-723 on the real artifact: while a row's action strip shows, a count tag
// the strip would cover hides instead of being cut, and a tag clear of it
// stays. What jsdom cannot show: real geometry, :hover, keyboard
// :focus-visible, and the drag override. The tab view at 1100x800, where his
// short title's tag runs under the strip (the round-7 capture's layout).

import type { Locator, Page } from '@playwright/test';

import { grantedTest as test, expect } from './fixtures/grantedExtension';
import {
  bandHandle,
  boxOf,
  groupedWindow,
  header,
  openSaved,
  savedWindow,
  session,
} from './fixtures/savedWindows';
import { pickUp, windowHandle } from './fixtures/sessionDrag';
import type { windowGroupData } from '../src/redux/slices/tabContainerDataStateSlice';

const TAG = '[data-row-tag]';
const SHORT = 'Current flow & friction';
const LONG =
  'Apartment viewings, mortgage calculators and neighbourhood guides';
const CLEAR = 'Reading';
const GROUP = { groupId: 'gz', title: 'Temples & zen gardens', color: 'blue' };

// A window of a two-tab group and one loose tab.
const groupWindow = (): windowGroupData => {
  const w = groupedWindow('w4', '', [GROUP], 2);
  const loose = savedWindow('w4', '', 1).tabs.map((t) => ({
    ...t,
    tabId: 'w4-loose',
  }));
  return { ...w, tabs: [...w.tabs, ...loose], tabCount: 3 };
};

async function open(page: Promise<Page>) {
  const p = await page;
  await p.setViewportSize({ width: 1100, height: 800 });
  await p.mouse.move(0, 0);
  return p;
}

const openTabView = (
  context: Parameters<typeof openSaved>[0],
  extensionId: string
) =>
  open(
    openSaved(context, extensionId, 'tab view', {
      sessions: [
        session('S1', 'Kyoto trip', [
          savedWindow('w1', SHORT, 4),
          savedWindow('w2', LONG, 3),
          savedWindow('w3', CLEAR, 1),
          groupWindow(),
        ]),
      ],
    })
  );

// The covered line: the strip's first visible control's left edge, less 4px.
// Its controls are laid out at rest (opacity 0), so a width means visible.
const coverLine = (row: Locator) =>
  row.evaluate((r) => {
    const lefts = Array.from(
      r.querySelector('[data-row-actions]')?.children ?? []
    )
      .map((c) => c.getBoundingClientRect())
      .filter((b) => b.width > 0)
      .map((b) => b.left);
    return Math.min(...lefts) - 4;
  });

const stripShown = (row: Locator) =>
  row.evaluate((r) => {
    const kids = Array.from(
      r.querySelector('[data-row-actions]')?.children ?? []
    ).filter((c) => c.getBoundingClientRect().width > 0);
    return (
      kids.length > 0 && kids.every((k) => getComputedStyle(k).opacity === '1')
    );
  });

const rightOf = async (tag: Locator) => {
  const b = await boxOf(tag);
  return b.x + b.width;
};

// The real mouse onto the row's left part, then the strip fully revealed.
async function hover(page: Page, row: Locator) {
  await row.scrollIntoViewIfNeeded();
  const b = await boxOf(row);
  await page.mouse.move(b.x + 40, b.y + b.height / 2);
  await expect.poll(() => stripShown(row)).toBe(true);
}

async function park(page: Page, row: Locator) {
  await page.mouse.move(0, 0);
  await expect.poll(() => stripShown(row)).toBe(false);
}

async function expectEveryTagVisible(page: Page) {
  const tags = page.locator(TAG);
  expect(await tags.count()).toBeGreaterThan(0);
  for (const tag of await tags.all()) {
    await expect(tag).toHaveCSS('visibility', 'visible');
  }
}

// Hovered (or revealed), the tag's right edge against the covered line.
async function expectCovered(row: Locator, tag: Locator, covered: boolean) {
  const [right, line] = [await rightOf(tag), await coverLine(row)];
  console.log(
    `[KAN-723] ${await tag.textContent()}: right ${right}, line ${line}`
  );
  if (covered) expect(right).toBeGreaterThan(line);
  else expect(right).toBeLessThanOrEqual(line);
}

test('his row: hovered, the cut tag hides; moved away, it shows', async ({
  context,
  extensionId,
}) => {
  const page = await openTabView(context, extensionId);
  const row = header(page, 'w1');
  const tag = row.locator(TAG);
  await expect(tag).toHaveText(['4 Tabs']);
  await expectEveryTagVisible(page);

  await hover(page, row);
  // PREMISE: the strip covers the tag.
  await expectCovered(row, tag, true);
  await expect(tag).toHaveCSS('visibility', 'hidden');

  await park(page, row);
  await expect(tag).toHaveCSS('visibility', 'visible');
});

test('a tag clear of the strip stays while hovered', async ({
  context,
  extensionId,
}) => {
  const page = await openTabView(context, extensionId);
  const row = header(page, 'w3');
  const tag = row.locator(TAG);
  await expect(tag).toHaveText(['1 Tab']);

  await hover(page, row);
  // PREMISE: the tag ends before the covered line.
  await expectCovered(row, tag, false);
  await expect(tag).toHaveCSS('visibility', 'visible');
});

test("a group band's covered tag hides on hover", async ({
  context,
  extensionId,
}) => {
  const page = await openTabView(context, extensionId);
  const row = bandHandle(page, GROUP.groupId);
  const tag = row.locator(TAG);
  await expect(tag).toHaveText(['2 Tabs']);
  await expect(tag).toHaveCSS('visibility', 'visible');

  await hover(page, row);
  await expectCovered(row, tag, true);
  await expect(tag).toHaveCSS('visibility', 'hidden');

  await park(page, row);
  await expect(tag).toHaveCSS('visibility', 'visible');
});

test('Open now: "1 Tab" stays, "This window" hides', async ({
  context,
  extensionId,
}) => {
  const page = await openTabView(context, extensionId);
  const row = page
    .locator('[data-pane="open-now"] [data-window-row]')
    .filter({ hasText: 'This window' });
  const tags = row.locator(TAG);
  await expect(tags).toHaveText(['1 Tab', 'This window']);
  await expect(tags.nth(0)).toHaveCSS('visibility', 'visible');
  await expect(tags.nth(1)).toHaveCSS('visibility', 'visible');

  await hover(page, row);
  await expectCovered(row, tags.nth(0), false);
  await expectCovered(row, tags.nth(1), true);
  await expect(tags.nth(0)).toHaveCSS('visibility', 'visible');
  await expect(tags.nth(1)).toHaveCSS('visibility', 'hidden');
});

test("keyboard: focusing a row's control hides its covered tag", async ({
  context,
  extensionId,
}) => {
  const page = await openTabView(context, extensionId);
  const row = header(page, 'w1');
  const tag = row.locator(TAG);
  const control = row.locator('[data-row-actions] button').first();
  await expect(tag).toHaveCSS('visibility', 'visible');

  // Arrive from the neighbour, as key-nav-ring.spec.ts does; the pointer stays at (0, 0).
  await control.focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await expect(control).toBeFocused();
  await expect(page.locator('html[data-key-nav]')).toHaveCount(1);
  // PREMISE: the keyboard revealed the strip, and it covers the tag.
  await expect.poll(() => stripShown(row)).toBe(true);
  await expectCovered(row, tag, true);

  await expect(tag).toHaveCSS('visibility', 'hidden');
});

test('a drag over rows hides no tag', async ({ context, extensionId }) => {
  const page = await openTabView(context, extensionId);
  const row = header(page, 'w1');
  const tag = row.locator(TAG);
  // PREMISE: hovered, this tag is marked covered and hides.
  await hover(page, row);
  await expect(tag).toHaveCSS('visibility', 'hidden');
  await park(page, row);

  const from = await pickUp(page, windowHandle(page, 'w3'));
  await expect(page.locator('html[data-dragging="window"]')).toHaveCount(1);
  // The pick-up folds every window (KAN-153): aim at where the row is now.
  const b = await boxOf(row);
  await page.mouse.move(b.x + 40, b.y + b.height / 2, { steps: 8 });
  await page.mouse.move(b.x + 60, b.y + b.height / 2, { steps: 4 });
  await expect(page.locator('html[data-dragging="window"]')).toHaveCount(1);

  await expect(tag).toHaveCSS('visibility', 'visible');
  await expectEveryTagVisible(page);

  await page.mouse.move(from.x, from.y, { steps: 8 });
  await page.mouse.up();
});

// The carried row stays hovered while the drag hides its strip; its tag must not hide with it.
test("a carried row's covered tag stays", async ({ context, extensionId }) => {
  const page = await openTabView(context, extensionId);
  const row = header(page, 'w1');
  const tag = row.locator(TAG);
  // PREMISE: hovered, this tag is marked covered and hides.
  await hover(page, row);
  await expect(tag).toHaveCSS('visibility', 'hidden');

  const from = await pickUp(page, windowHandle(page, 'w1'));
  await page.mouse.move(from.x + 40, from.y, { steps: 6 });
  await expect(page.locator('html[data-dragging="window"]')).toHaveCount(1);

  await expect(tag).toHaveCSS('visibility', 'visible');

  await page.mouse.move(from.x, from.y, { steps: 6 });
  await page.mouse.up();
});

// The same tag, laid out clear by a wider page: only a fresh measure on enter can show it.
test('widened, the tag shows on the next hover', async ({
  context,
  extensionId,
}) => {
  const page = await openTabView(context, extensionId);
  const row = header(page, 'w1');
  const tag = row.locator(TAG);
  // PREMISE: at 1100 the tag is covered and hides.
  await hover(page, row);
  await expect(tag).toHaveCSS('visibility', 'hidden');
  await park(page, row);

  await page.setViewportSize({ width: 1280, height: 800 });
  await hover(page, row);
  await expectCovered(row, tag, false);
  await expect(tag).toHaveCSS('visibility', 'visible');
});

test('renamed shorter, the tag shows on the next hover', async ({
  context,
  extensionId,
}) => {
  const page = await openTabView(context, extensionId);
  const row = header(page, 'w1');
  const tag = row.locator(TAG);
  // PREMISE: under the old title the tag is covered and hides.
  await hover(page, row);
  await expect(tag).toHaveCSS('visibility', 'hidden');

  await page
    .getByRole('button', { name: `Rename window: ${SHORT}`, exact: true })
    .click();
  await page.locator('input:focus').fill('Flow');
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('button', { name: 'Rename window: Flow', exact: true })
  ).toBeVisible();

  // Not park(): the title swapped under the pointer can leave the row's hover state set.
  await page.mouse.move(0, 0);
  await hover(page, row);
  await expectCovered(row, tag, false);
  await expect(tag).toHaveCSS('visibility', 'visible');
});
