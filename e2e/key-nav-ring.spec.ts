import { writeFileSync } from 'node:fs';

import type { Locator, Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { documentLanded } from './fixtures/landed';
import { buildContainer, buildSession, seedSessions } from './fixtures/seed';
import { POPUP, stored } from './fixtures/savedWindows';
import { differingPixels, pixelsAt, rgb } from './fixtures/pixels';
import { CHALK_THEME } from '../src/hooks/useThemeColors';

// KAN-689. Rings show after keyboard navigation only. Chrome's heuristic
// makes a scripted focus :focus-visible after ANY key, so a click then Delete
// (focus moves to the next row, KAN-657 F1) drew a ring, and a text field
// draws one on every click.

const SESSIONS = ['Alpha', 'Bravo', 'Charlie', 'Delta'].map((t) =>
  buildSession({ tabGroupId: `s-${t.toLowerCase()}`, title: t })
);
// KAN-731. Chalk, the default on a light OS.
const RING = CHALK_THEME.TEXT_COLOR.toUpperCase();

async function openPopup(
  context: Parameters<typeof seedSessions>[0],
  extensionId: string
): Promise<Page> {
  await seedSessions(context, {
    ...buildContainer(SESSIONS),
    selectedTabGroupId: 's-alpha',
  });
  const page = await context.newPage();
  await page.setViewportSize(POPUP);
  await page.goto(`chrome-extension://${extensionId}/index.html`);
  // Barrier: goto resolves before React mounts. Locale-free.
  await page.locator('[data-tour-anchor="save"]').waitFor();
  return page;
}

const row = (page: Page, title: string): Locator =>
  page
    .locator('[data-pane="sessions"]')
    .getByRole('button', { name: title, exact: true });
const search = (page: Page): Locator =>
  page.getByRole('textbox', { name: 'Search saved tabs', exact: true });
const ids = async (page: Page) =>
  (await stored(page)).tabGroups.map((g) => g.tabGroupId);

// Pointer away, and fills and reveals landed.
async function settle(page: Page) {
  await page.mouse.move(2, 540);
  await documentLanded(page);
}

// The pixel 3px inside `box`'s left edge, mid height: inside every ring's
// 2px band (outline offset -4, or a ::after inset 2 with a 2px border).
async function leftEdge(page: Page, box: Locator): Promise<string> {
  await settle(page);
  const b = await box.boundingBox();
  if (b === null) throw new Error('no box');
  const [edge] = await pixelsAt(page, [[b.x + 3, b.y + b.height / 2]]);
  return edge;
}

// How many pixels around `box` focus changes: a shot focused, then one after
// blur. Any indicator counts, Chrome's own ring and a reveal included; a
// glyph's anti-aliasing moving 1 does not. Ends with focus gone. When they
// differ, both shots go in the test's output, with where and by how much.
// `skip` is a control inside the box that is not read.
async function focusPaint(page: Page, box: Locator, skip?: Locator) {
  await settle(page);
  const b = await box.boundingBox();
  if (b === null) throw new Error('no box');
  const clip = {
    x: b.x - 4,
    y: b.y - 4,
    width: b.width + 8,
    height: b.height + 8,
  };
  const s = skip ? await skip.boundingBox() : null;
  if (skip && s === null) throw new Error('no box to skip');
  const skipped = ([x, y]: [number, number]) =>
    s !== null &&
    x + clip.x >= s.x &&
    x + clip.x <= s.x + s.width &&
    y + clip.y >= s.y &&
    y + clip.y <= s.y + s.height;
  const focused = await page.screenshot({ clip });
  await page.evaluate(() => (document.activeElement as HTMLElement).blur());
  await settle(page);
  const blurred = await page.screenshot({ clip });
  const differ = (await differingPixels(page, focused, blurred, 2)).filter(
    (p) => !skipped(p)
  );
  if (differ.length > 0) {
    writeFileSync(test.info().outputPath('focused.png'), focused);
    writeFileSync(test.info().outputPath('blurred.png'), blurred);
    const xs = differ.map(([x]) => x);
    const ys = differ.map(([, y]) => y);
    console.log(
      `focus paint: ${differ.length} px, x ${Math.min(...xs)}..${Math.max(...xs)}, y ${Math.min(...ys)}..${Math.max(...ys)} of ${clip.width}x${clip.height}`
    );
  }
  return differ.length;
}

// Tab onto `control` the way a keyboard user arrives: from its neighbour.
async function tabOnto(page: Page, control: Locator) {
  await control.focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await expect(control).toBeFocused();
}

test('click a row, then Delete: the next row takes focus without a ring', async ({
  context,
  extensionId,
}) => {
  const page = await openPopup(context, extensionId);
  await row(page, 'Bravo').click();

  await page.keyboard.press('Delete');

  await expect
    .poll(() => ids(page))
    .toEqual(['s-alpha', 's-charlie', 's-delta']);
  // PREMISE: focus moved to the next row (KAN-657 F1), as a scripted focus.
  await expect(row(page, 'Charlie')).toBeFocused();
  expect(await focusPaint(page, row(page, 'Charlie').locator('..'))).toBe(0);
});

test('Tab to a row, then Delete: the next row takes focus with the ring', async ({
  context,
  extensionId,
}) => {
  const page = await openPopup(context, extensionId);
  await tabOnto(page, row(page, 'Bravo'));

  await page.keyboard.press('Delete');

  await expect
    .poll(() => ids(page))
    .toEqual(['s-alpha', 's-charlie', 's-delta']);
  await expect(row(page, 'Charlie')).toBeFocused();
  expect(await leftEdge(page, row(page, 'Charlie').locator('..'))).toBe(RING);
});

test('a click into a text field draws no ring; Tab into it does', async ({
  context,
  extensionId,
}) => {
  const page = await openPopup(context, extensionId);
  const field = search(page);

  // The caret blinks, and is not what this reads.
  await page.addStyleTag({ content: 'input { caret-color: transparent; }' });

  await field.click();
  await expect(field).toBeFocused();
  // Typing is not navigation.
  await page.keyboard.type('a');
  // Not the Clear search ×: on Linux its glyph re-rasterises when the field
  // blurs (up to 68 levels, CI), and nothing styles it by the field's focus.
  const clear = page.getByRole('button', { name: 'Clear search' });
  expect(await focusPaint(page, field.locator('..'), clear)).toBe(0);

  await tabOnto(page, field);
  expect(await leftEdge(page, field.locator('..'))).toBe(RING);
});

// KAN-685. In a text field the arrows, Home and End move the caret.
test('a click into a text field, then the caret keys: still no ring', async ({
  context,
  extensionId,
}) => {
  const page = await openPopup(context, extensionId);
  const field = search(page);
  await page.addStyleTag({ content: 'input { caret-color: transparent; }' });
  await field.click();
  await page.keyboard.type('ab');

  for (const k of ['ArrowLeft', 'ArrowRight', 'Home', 'End', 'ArrowUp'])
    await page.keyboard.press(k);

  await expect(field).toBeFocused();
  const clear = page.getByRole('button', { name: 'Clear search' });
  expect(await focusPaint(page, field.locator('..'), clear)).toBe(0);
});

// KAN-685. A caret key a handler moves focus out on is navigation: Open now's
// search field hands ArrowDown to its first result (KAN-330 K1).
test('ArrowDown from a clicked search field to a result draws its ring', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  await serviceWorker.evaluate(() =>
    chrome.tabs.create({
      url: 'data:text/html,<title>Kiwi</title>',
      active: false,
    })
  );
  const page = await context.newPage();
  await page.setViewportSize({ width: 1600, height: 800 });
  await page.goto(`chrome-extension://${extensionId}/index.html?view=tab`);
  const openNow = page.locator('[data-pane="open-now"]');
  const result = openNow.getByRole('button', {
    name: 'Switch to tab: Kiwi',
    exact: true,
  });
  await expect(result).toBeVisible();
  await openNow
    .getByRole('textbox', { name: 'Search open tabs', exact: true })
    .click();
  // Typing is not navigation; it leaves Kiwi the first result.
  await page.keyboard.type('Kiwi');

  await page.keyboard.press('ArrowDown');

  await expect(result).toBeFocused();
  expect(await focusPaint(page, result)).toBeGreaterThan(0);
});

test('a click after keyboard navigation takes the ring away', async ({
  context,
  extensionId,
}) => {
  const page = await openPopup(context, extensionId);
  await tabOnto(page, row(page, 'Bravo'));
  // PREMISE: the keyboard drew it.
  expect(await leftEdge(page, row(page, 'Bravo').locator('..'))).toBe(RING);

  await row(page, 'Bravo').click();

  await expect(row(page, 'Bravo')).toBeFocused();
  expect(await focusPaint(page, row(page, 'Bravo').locator('..'))).toBe(0);
});

// The export page is its own document: it tracks keyboard navigation too.
test('Tab on the export page draws the themed ring', async ({
  context,
  extensionId,
}) => {
  await seedSessions(context, {
    ...buildContainer(SESSIONS),
    selectedTabGroupId: 's-alpha',
  });
  const page = await context.newPage();
  await page.goto(
    `chrome-extension://${extensionId}/export.html?session=s-alpha`
  );
  const edit = page.getByRole('button', { name: 'Edit', exact: true });
  await edit.waitFor();
  const outline = (el: Element) => {
    const s = getComputedStyle(el);
    return `${s.outlineStyle} ${s.outlineWidth} ${s.outlineColor}`;
  };

  // KAN-880. The way back comes first, ringed whole, then the toolbar.
  await page.keyboard.press('Tab');
  const back = page.getByRole('button', {
    name: 'Back to Tab Keeper',
    exact: true,
  });
  await expect(back).toBeFocused();
  expect(await back.evaluate(outline)).toBe(`solid 2px ${rgb(RING)}`);

  await page.keyboard.press('Tab');
  await expect(edit).toBeFocused();
  expect(await edit.evaluate(outline)).toBe(`solid 2px ${rgb(RING)}`);
});
