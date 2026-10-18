import type { Locator, Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { buildContainer, buildSession, seedSessions } from './fixtures/seed';
import { POPUP, stored } from './fixtures/savedWindows';
import { pixelsAt } from './fixtures/pixels';
import { LIGHT_THEME } from '../src/hooks/useThemeColors';

// KAN-689. Rings show after keyboard navigation only. Chrome's heuristic
// makes a scripted focus :focus-visible after ANY key, so a click then Delete
// (focus moves to the next row, KAN-657 F1) drew a ring, and a text field
// draws one on every click.

const SESSIONS = ['Alpha', 'Bravo', 'Charlie', 'Delta'].map((t) =>
  buildSession({ tabGroupId: `s-${t.toLowerCase()}`, title: t })
);
const RING = LIGHT_THEME.TEXT_COLOR.toUpperCase();

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

// The pixel 3px inside `box`'s left edge, mid height: inside every ring's
// 2px band (outline offset -4, or a ::after inset 2 with a 2px border). The
// pointer rests away, and fills and reveals have landed.
async function leftEdge(page: Page, box: Locator): Promise<string> {
  await page.mouse.move(2, 540);
  await page.evaluate(() =>
    Promise.all(document.getAnimations().map((a) => a.finished))
  );
  const b = await box.boundingBox();
  if (b === null) throw new Error('no box');
  const [edge] = await pixelsAt(page, [[b.x + 3, b.y + b.height / 2]]);
  return edge;
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
  expect(await leftEdge(page, row(page, 'Charlie').locator('..'))).not.toBe(
    RING
  );
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

  await field.click();
  await expect(field).toBeFocused();
  // Typing is not navigation.
  await page.keyboard.type('a');
  expect(await leftEdge(page, field.locator('..'))).not.toBe(RING);

  await tabOnto(page, field);
  expect(await leftEdge(page, field.locator('..'))).toBe(RING);
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
  expect(await leftEdge(page, row(page, 'Bravo').locator('..'))).not.toBe(RING);
});
