import type { Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { waitForFontsLoaded } from './fixtures/fonts';
import { seedSessions, seedSettings } from './fixtures/seed';
import { standIn } from './fixtures/standInPages';

// KAN-794 (his pick F). The fold sits on the heading's line, so the icon row
// keeps 32px for Back: in English Back keeps its whole label at the narrowest
// side by side (a 1100px window, Open now 323px wide) and in the 380px drawer.
// Measured on main before the move: cut to 121px of its 134 at 1100.

const BACK = 'Back to your tab';
const FOLD = 'Fold the saved session away';

test.beforeEach(async ({ context, serviceWorker }) => {
  await seedSettings(context, { foldSavedSessionInTabView: false });
  await seedSessions(context);
  await serviceWorker.evaluate(
    async (urls) => {
      const [w] = await chrome.windows.getAll({ windowTypes: ['normal'] });
      for (const url of urls)
        await chrome.tabs.create({ windowId: w.id, url, active: false });
    },
    [standIn('Q4 roadmap'), standIn('KAN board')]
  );
});

async function openAt(page: Page, extensionId: string, width: number) {
  await page.setViewportSize({ width, height: 700 });
  await page.goto(`chrome-extension://${extensionId}/index.html?view=tab`);
  await page.locator('[aria-label="Sort sessions"]').first().waitFor();
  // A glyph's width is its ligature's text until the icon font lands.
  await waitForFontsLoaded(page, ['Material Symbols Outlined']);
}

// Back's label against the room it was given, and the fold against the heading.
async function measure(page: Page) {
  const header = page.locator('[data-open-now-header]').last();
  const label = header
    .getByRole('button', { name: BACK })
    .locator('span', { hasText: BACK })
    .last();
  await expect(label).toBeVisible();
  const cut = await label.evaluate((el) => el.scrollWidth > el.clientWidth);
  const fold = await header.getByRole('button', { name: FOLD }).boundingBox();
  const heading = await header
    .getByRole('heading', { name: 'Currently open' })
    .boundingBox();
  if (fold === null || heading === null) throw new Error('not drawn');
  return {
    cut,
    // Centre to centre: on the heading's line, not the icon row 50px below.
    foldOffLine: Math.abs(
      fold.y + fold.height / 2 - (heading.y + heading.height / 2)
    ),
  };
}

test('side by side at a 1100px window: Back keeps its whole label, the fold is on the heading line', async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage();
  await openAt(page, extensionId, 1100);

  const m = await measure(page);

  expect(m.cut).toBe(false);
  expect(m.foldOffLine).toBeLessThan(8);
});

test('in the drawer: Back keeps its whole label, the fold is on the heading line', async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage();
  await openAt(page, extensionId, 1000);
  await page
    .locator('button[aria-expanded][aria-label^="Currently open"]')
    .click();
  await expect(page.getByRole('dialog')).toBeVisible();

  const m = await measure(page);

  expect(m.cut).toBe(false);
  expect(m.foldOffLine).toBeLessThan(8);
});

// CONTROL for the cut probe: the same reading reports a cut where one is drawn.
test('CONTROL: a 1100px window with a 40px Back reads as cut', async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage();
  await openAt(page, extensionId, 1100);
  await page
    .locator('[data-open-now-header]')
    .last()
    .getByRole('button', { name: BACK })
    .evaluate((el) => {
      (el as HTMLElement).style.maxWidth = '40px';
    });

  expect((await measure(page)).cut).toBe(true);
});
