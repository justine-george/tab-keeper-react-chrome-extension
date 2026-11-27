import type { BrowserContext, Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { buildContainer, seedSessions } from './fixtures/seed';
import { POPUP, openPage } from './fixtures/onboarding';

// KAN-510. Settings' language cells are two to a row at the label's left edge, not half the pane each.
// KAN-1032. The popup's are 200×48 (gap 12); the full view's are setup's 274×48 (gap 10), narrower only when the pane is.

async function openLanguagePane(
  context: BrowserContext,
  extensionId: string,
  path: string,
  size: { width: number; height: number }
): Promise<Page> {
  await seedSessions(context, buildContainer());
  const page = await openPage(context, extensionId, path, size);
  await page.locator('[aria-label="Settings"]').click();
  await page.locator('button[aria-label="Language"]').click();
  await expect(
    page.getByRole('button', { name: 'English', exact: true })
  ).toBeVisible();
  return page;
}

const cells = (page: Page) =>
  page.locator('div:has(> button:has-text("Deutsch")) > button');

const VIEWS = [
  ['the popup', 'index.html', POPUP, 200, 12],
  [
    'a 1280 full view',
    'index.html?view=tab',
    { width: 1280, height: 800 },
    274,
    10,
  ],
  [
    'a 1920 full view',
    'index.html?view=tab',
    { width: 1920, height: 1000 },
    274,
    10,
  ],
] as const;

async function cellBoxes(page: Page) {
  return cells(page).evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height, right: r.right };
    })
  );
}

for (const [name, path, size, width, gap] of VIEWS) {
  test(`in ${name}, every language cell is ${width}×48, ${gap}px apart, two to a row, from the label's left edge`, async ({
    context,
    extensionId,
  }) => {
    const page = await openLanguagePane(context, extensionId, path, size);
    const boxes = await cellBoxes(page);
    const label = await page
      .getByText('Choose language', { exact: true })
      .boundingBox();
    // PREMISE: all 13 languages are drawn.
    expect(boxes).toHaveLength(13);
    for (const b of boxes) {
      expect(b.w).toBeCloseTo(width, 0);
      expect(b.h).toBeCloseTo(48, 0);
    }
    expect(boxes[1].y).toBeCloseTo(boxes[0].y, 0);
    expect(boxes[1].x - (boxes[0].x + boxes[0].w)).toBeCloseTo(gap, 0);
    expect(boxes[2].y - (boxes[0].y + boxes[0].h)).toBeCloseTo(gap, 0);
    expect(boxes[0].x).toBeCloseTo(label!.x, 0);
  });
}

test('in a full view too narrow for 274, the cells share the pane: equal, side by side, inside its padding', async ({
  context,
  extensionId,
}) => {
  const page = await openLanguagePane(
    context,
    extensionId,
    'index.html?view=tab',
    { width: 800, height: 700 }
  );
  const boxes = await cellBoxes(page);
  // The right edge of the box the grid sits in, inside its padding.
  const contentRight = await cells(page)
    .first()
    .evaluate((el) => {
      const pane = el.parentElement!.parentElement!;
      return (
        pane.getBoundingClientRect().right -
        parseFloat(getComputedStyle(pane).paddingRight)
      );
    });
  const label = await page
    .getByText('Choose language', { exact: true })
    .boundingBox();
  expect(boxes).toHaveLength(13);
  // PREMISE: two 274 cells and their gap would not fit.
  expect(contentRight - boxes[0].x).toBeLessThan(2 * 274 + 10);
  expect(boxes[0].w).toBeLessThan(274);
  expect(boxes[1].w).toBeCloseTo(boxes[0].w, 0);
  expect(boxes[1].y).toBeCloseTo(boxes[0].y, 0);
  expect(boxes[0].x).toBeCloseTo(label!.x, 0);
  expect(boxes[1].right).toBeCloseTo(contentRight, 0);
});

test('at the largest Chrome font size (a 24px root), every language name fits inside its cell', async ({
  context,
  extensionId,
}) => {
  const page = await openLanguagePane(
    context,
    extensionId,
    'index.html',
    POPUP
  );
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '24px';
  });
  const overflow = await cells(page).evaluateAll((els) =>
    els.flatMap((el) => {
      const cell = el.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(el);
      const text = range.getBoundingClientRect();
      return text.left < cell.left || text.right > cell.right
        ? [
            `${el.textContent}: ${Math.round(text.width)} in ${Math.round(cell.width)}`,
          ]
        : [];
    })
  );
  // PREMISE: the root took, so the names are drawn at their largest.
  expect(
    await cells(page)
      .first()
      .evaluate((el) => parseFloat(getComputedStyle(el).fontSize))
  ).toBeGreaterThan(20);
  expect(overflow).toEqual([]);
});
