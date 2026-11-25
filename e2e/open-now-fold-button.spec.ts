import type { BrowserContext, Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import {
  buildContainer,
  buildSession,
  seedSessions,
  seedSettings,
} from './fixtures/seed';

// KAN-808 on the real artifact. In the full view, the saved session's
// title-line button folds Open now to its 53px rail column (KAN-999: a 44px card in it), so the saved session
// takes the width, and shows it again. What jsdom cannot show: the grid's
// real widths, the drawer over a wide window, the choice surviving a reload,
// the window crossing 1100px, and a long title stopping before the button.

const WIDE = { width: 1400, height: 800 };
const NARROW = { width: 1024, height: 768 };
const POPUP = { width: 790, height: 550 };
const OPEN_NOW = '[data-pane="open-now"]';
const DETAIL = '[data-pane="detail"]';
const FOLD = 'Give the saved session the full width';
const SHOW = 'Show Currently open beside it';
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
// By its place: wide, it is named by its action (KAN-1002).
const rail = (page: Page) => page.locator('[data-open-now-rail] > button');

test('the button folds Currently open to its rail (a 53px column) and shows it again; the saved session takes the width', async ({
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
  await expect.poll(() => widthOf(page, OPEN_NOW)).toBe(53);
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
  expect(await widthOf(page, OPEN_NOW)).toBe(53);
});

// KAN-1002. Wide, the rail is there only because Currently open was folded
// by hand: its press shows it beside the saved session again, and focus goes
// to the saved session's button, which folds it again.
test('folded, a click on the rail shows Currently open beside the saved session', async ({
  context,
  extensionId,
}) => {
  await seed(context);
  const page = await open(context, extensionId, WIDE);
  const sideBySide = await widthOf(page, DETAIL);
  await detail(page).getByRole('button', { name: FOLD }).click();
  await expect(rail(page)).toHaveAccessibleName(SHOW);
  await expect(rail(page)).toHaveAttribute('data-tooltip', /^Currently open, /);

  await rail(page).click();
  await expect(rail(page)).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect.poll(() => widthOf(page, DETAIL)).toBe(sideBySide);
  await expect(detail(page).getByRole('button', { name: FOLD })).toBeFocused();
});

test('folded, / from the rail shows Currently open beside it, with the cursor in its search', async ({
  context,
  extensionId,
}) => {
  await seed(context);
  const page = await open(context, extensionId, WIDE);
  const sideBySide = await widthOf(page, DETAIL);
  await detail(page).getByRole('button', { name: FOLD }).click();
  // A key brings focus to the rail, so / is Currently open's.
  await page.keyboard.press('Shift');
  await rail(page).focus();
  await page.keyboard.press('/');

  await expect(rail(page)).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect.poll(() => widthOf(page, DETAIL)).toBe(sideBySide);
  await expect(
    page.locator(OPEN_NOW).getByRole('textbox', { name: 'Search open tabs' })
  ).toBeFocused();
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
  expect(await widthOf(page, OPEN_NOW)).toBe(53);
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
