import type { BrowserContext, Locator, Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import {
  buildContainer,
  buildSession,
  seedSessions,
  seedSettings,
} from './fixtures/seed';
import { ON_TITLE } from './fixtures/savedRow';

// KAN-681, KAN-682 on the real artifact: the narrow Open now drawer is not
// modal. What jsdom cannot show: a click on blank space moving focus to the
// body, a saved row's own press handling, and the toast over the drawer.

const NARROW_VIEWPORT = { width: 1024, height: 768 };
const DETAIL = '[data-pane="detail"]';

const SELECTED = buildSession({
  tabGroupId: 'selected',
  title: 'Selected session',
  isSelected: true,
});
const OTHER = buildSession({ tabGroupId: 'other', title: 'Other session' });

async function openDrawer(
  context: BrowserContext,
  extensionId: string,
  viewport = NARROW_VIEWPORT
): Promise<{ page: Page; rail: Locator; drawer: Locator }> {
  await seedSessions(context, {
    ...buildContainer([SELECTED, OTHER]),
    selectedTabGroupId: SELECTED.tabGroupId,
  });
  await seedSettings(context, { foldSavedSessionInTabView: false });
  const page = await context.newPage();
  await page.setViewportSize(viewport);
  await page.goto(`chrome-extension://${extensionId}/index.html?view=tab`);
  const rail = page.getByRole('button', { name: /^Open now/ });
  await rail.click();
  const drawer = page.getByRole('dialog', { name: 'Open now' });
  await expect(drawer).toBeVisible();
  return { page, rail, drawer };
}

// What a click at the point lands on: blank, or something that takes a press.
const interactiveAt = (page: Page, x: number, y: number) =>
  page.evaluate(
    ({ x, y }) =>
      document
        .elementFromPoint(x, y)
        ?.closest('button, a, input, [tabindex], [data-drag-row-id]') !== null,
    { x, y }
  );

const activeIsBody = (page: Page) =>
  page.evaluate(() => document.activeElement === document.body);

test('Esc after a click on blank space in the drawer closes it, and focus goes to the rail', async ({
  context,
  extensionId,
}) => {
  const { page, rail, drawer } = await openDrawer(context, extensionId);
  const box = await drawer.boundingBox();
  if (box === null) throw new Error('the drawer has no box');
  const x = box.x + box.width - 20;
  const y = box.y + box.height - 10;
  // PREMISE: blank, so the click moves focus to the body (the report).
  expect(await interactiveAt(page, x, y)).toBe(false);
  await page.mouse.click(x, y);
  await expect(drawer).toBeVisible();
  expect(await activeIsBody(page)).toBe(true);

  await page.keyboard.press('Escape');

  await expect(drawer).toHaveCount(0);
  await expect(rail).toBeFocused();
});

test('a click on blank space outside closes the drawer, and focus goes to the rail', async ({
  context,
  extensionId,
}) => {
  const { page, rail, drawer } = await openDrawer(context, extensionId);
  const [x, y] = [20, NARROW_VIEWPORT.height - 8];
  // PREMISE: blank, and outside the drawer.
  expect(await interactiveAt(page, x, y)).toBe(false);

  await page.mouse.click(x, y);

  await expect(drawer).toHaveCount(0);
  await expect(rail).toBeFocused();
});

test('a click on another session outside closes the drawer and still shows that session', async ({
  context,
  extensionId,
}) => {
  const { page, drawer } = await openDrawer(context, extensionId);
  // PREMISE: the detail shows the selected session.
  await expect(page.locator(DETAIL)).toContainText('Selected session');

  await page
    .locator(`[data-pane="sessions"] [data-drag-row-id="${OTHER.tabGroupId}"]`)
    .click(ON_TITLE);

  await expect(drawer).toHaveCount(0);
  await expect(page.locator(DETAIL)).toContainText('Other session');
});

// Why an outside press needs no rail case: no press reaches the rail while the
// drawer is open. Uncovered, a press there would close and its click reopen.
test('the open drawer covers the rail', async ({ context, extensionId }) => {
  const { page, rail, drawer } = await openDrawer(context, extensionId);
  const box = await rail.boundingBox();
  if (box === null) throw new Error('the rail has no box');

  const hit = await page.evaluate(
    ({ x, y }) =>
      document.elementFromPoint(x, y)?.closest('[role="dialog"]')?.id ?? null,
    { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  );

  expect(hit).toBe(await drawer.getAttribute('id'));
});

test('a click on the toast leaves the drawer open', async ({
  context,
  extensionId,
}) => {
  // Narrow enough that the drawer reaches the toast (open-now.spec 6a).
  const { page, drawer } = await openDrawer(context, extensionId, {
    width: 680,
    height: 768,
  });
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
  await page
    .locator(
      `${DETAIL} [data-tour-anchor="session-menu"] [aria-label="More actions"][aria-haspopup="menu"]`
    )
    .click();
  await page.getByRole('menuitem', { name: 'Copy all links' }).click();
  const toast = page.locator('[data-toast]', { hasText: '1 link copied.' });
  await expect(toast).toBeVisible();
  await page.getByRole('button', { name: /^Open now/ }).click();
  await expect(drawer).toBeVisible();

  await toast.getByText('1 link copied.').click();

  await page.waitForTimeout(300);
  await expect(drawer).toBeVisible();
});

test('a click on blank space in the drawer leaves it open', async ({
  context,
  extensionId,
}) => {
  const { page, drawer } = await openDrawer(context, extensionId);
  const box = await drawer.boundingBox();
  if (box === null) throw new Error('the drawer has no box');

  await page.mouse.click(box.x + box.width - 20, box.y + box.height - 10);

  await page.waitForTimeout(300);
  await expect(drawer).toBeVisible();
});
