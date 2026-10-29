import type { BrowserContext, Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { elementLanded } from './fixtures/landed';
import {
  buildContainer,
  buildSession,
  seedSessions,
  seedSettings,
} from './fixtures/seed';

// KAN-808 on the real artifact. In the full view, the saved session's
// title-line button folds Open now to its 44px rail, so the saved session
// takes the width, and shows it again. What jsdom cannot show: the grid's
// real widths, the drawer over a wide window, the choice surviving a reload,
// the window crossing 1100px, and a long title stopping before the button.

const WIDE = { width: 1400, height: 800 };
const NARROW = { width: 1024, height: 768 };
const POPUP = { width: 790, height: 550 };
const OPEN_NOW = '[data-pane="open-now"]';
const DETAIL = '[data-pane="detail"]';
const FOLD = 'Fold the Currently open panel away';
const SHOW = 'Show the Currently open panel';
const LONG =
  'Quarterly planning for the platform team, with every roadmap, budget and hiring doc in one place';

async function seed(context: BrowserContext, title = 'Q4 product roadmap') {
  await seedSessions(context, {
    ...buildContainer([
      { ...buildSession({ tabGroupId: 'S1', title }), isSelected: true },
    ]),
    selectedTabGroupId: 'S1',
  });
  await seedSettings(context, { foldSavedSessionInTabView: false });
}

async function open(
  context: BrowserContext,
  extensionId: string,
  viewport: { width: number; height: number },
  path = 'index.html?view=tab'
): Promise<Page> {
  const page = await context.newPage();
  await page.setViewportSize(viewport);
  await page.goto(`chrome-extension://${extensionId}/${path}`);
  // Barrier: goto resolves before React mounts.
  await page.getByRole('button', { name: 'Sort sessions' }).waitFor();
  return page;
}

const widthOf = async (page: Page, selector: string) => {
  const box = await page.locator(selector).boundingBox();
  if (box === null) throw new Error(`${selector} has no box`);
  return Math.round(box.width);
};
const detail = (page: Page) => page.locator(DETAIL);
const rail = (page: Page) =>
  page.getByRole('button', { name: /^Currently open/ });

test('the button folds Currently open to its 44px rail and shows it again; the saved session takes the width', async ({
  context,
  extensionId,
}, testInfo) => {
  await seed(context);
  const page = await open(context, extensionId, WIDE);
  const fold = detail(page).getByRole('button', { name: FOLD });
  // Shown at rest, with no hover: the mouse is away from the header.
  await page.mouse.move(5, WIDE.height - 5);
  await expect(fold).toBeVisible();
  await expect
    .poll(() =>
      fold.evaluate((el) => getComputedStyle(el.parentElement!).opacity)
    )
    .toBe('1');
  const sideBySide = await widthOf(page, DETAIL);
  // PREMISE: Currently open is its pane, not the rail.
  expect(await widthOf(page, OPEN_NOW)).toBeGreaterThan(300);

  await fold.click();
  await expect(rail(page)).toBeVisible();
  await expect.poll(() => widthOf(page, OPEN_NOW)).toBe(44);
  expect(await widthOf(page, DETAIL)).toBeGreaterThan(sideBySide + 250);
  await page.screenshot({ path: testInfo.outputPath('open-now-folded.png') });

  await detail(page).getByRole('button', { name: SHOW }).click();
  await expect(rail(page)).toHaveCount(0);
  await expect.poll(() => widthOf(page, DETAIL)).toBe(sideBySide);
});

test('the choice survives a reload', async ({ context, extensionId }) => {
  await seed(context);
  const page = await open(context, extensionId, WIDE);
  await detail(page).getByRole('button', { name: FOLD }).click();
  await expect(rail(page)).toBeVisible();

  await page.reload();
  await page.getByRole('button', { name: 'Sort sessions' }).waitFor();
  await expect(rail(page)).toBeVisible();
  await expect(detail(page).getByRole('button', { name: SHOW })).toBeVisible();
  expect(await widthOf(page, OPEN_NOW)).toBe(44);
});

test('folded, the rail opens its drawer over the saved session, and Esc leaves it folded', async ({
  context,
  extensionId,
}) => {
  await seed(context);
  const page = await open(context, extensionId, WIDE);
  await detail(page).getByRole('button', { name: FOLD }).click();
  await rail(page).click();
  const drawer = page.getByRole('dialog', { name: 'Currently open' });
  await expect(drawer).toBeVisible();
  // KAN-810. It slides in: measure it where it comes to rest.
  await elementLanded(drawer, 'subtree');
  const box = await drawer.boundingBox();
  if (box === null) throw new Error('the drawer has no box');
  expect(Math.round(box.width)).toBe(480);
  expect(Math.round(box.x + box.width)).toBe(WIDE.width);

  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
  await expect(rail(page)).toBeFocused();
  expect(await widthOf(page, OPEN_NOW)).toBe(44);
});

test('below 1100px the pencil is back; wide again, Currently open is still folded', async ({
  context,
  extensionId,
}) => {
  await seed(context);
  const page = await open(context, extensionId, WIDE);
  await detail(page).getByRole('button', { name: FOLD }).click();
  await expect(rail(page)).toBeVisible();

  await page.setViewportSize(NARROW);
  await expect(detail(page).getByRole('button', { name: SHOW })).toHaveCount(0);
  await expect(
    detail(page).getByRole('button', { name: 'Rename session', exact: true })
  ).toHaveCount(1);
  await expect(rail(page)).toBeVisible();

  await page.setViewportSize(WIDE);
  await expect(detail(page).getByRole('button', { name: SHOW })).toBeVisible();
  expect(await widthOf(page, OPEN_NOW)).toBe(44);
});

test('the popup keeps the pencil', async ({ context, extensionId }) => {
  await seed(context);
  const page = await open(context, extensionId, POPUP, 'index.html');
  await expect(
    page.getByRole('button', { name: 'Rename session', exact: true })
  ).toHaveCount(1);
  await expect(page.getByRole('button', { name: FOLD })).toHaveCount(0);
});

test('a long title stops before the button', async ({
  context,
  extensionId,
}) => {
  await seed(context, LONG);
  const page = await open(context, extensionId, WIDE);
  const fold = detail(page).getByRole('button', { name: FOLD });
  await expect(fold).toBeVisible();
  const title = detail(page).getByRole('button', {
    name: `Rename session: ${LONG}`,
  });
  const [t, f] = await Promise.all([title.boundingBox(), fold.boundingBox()]);
  if (t === null || f === null) throw new Error('no title or button box');
  // PREMISE: the title is long enough to reach the button's column.
  expect(
    await title.evaluate((el) => {
      const text = el.querySelector('span') ?? el;
      return text.scrollWidth > text.clientWidth;
    })
  ).toBe(true);
  expect(t.x + t.width).toBeLessThanOrEqual(f.x);
});
