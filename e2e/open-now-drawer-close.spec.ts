import type { Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { seedSessions, seedSettings } from './fixtures/seed';
import { standIn } from './fixtures/standInPages';

// KAN-784. Below 1100px Open now opens as a drawer, and its ✕ sits in the
// header's top-right corner, flush, as a dialog's close does (his pick). The
// action row keeps « and gives the ✕'s 32px to Back to last tab.

const CLOSE = 'Close Open now';

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

async function openDrawer(page: Page, extensionId: string) {
  await page.setViewportSize({ width: 1024, height: 700 });
  await page.goto(`chrome-extension://${extensionId}/index.html?view=tab`);
  await page.locator('[data-tour-anchor="save"]').waitFor();
  const rail = page.locator('button[aria-expanded][aria-label^="Open now"]');
  await rail.click();
  const drawer = page.getByRole('dialog');
  await expect(drawer.getByRole('button', { name: CLOSE })).toBeVisible();
  return { rail, drawer };
}

test("the drawer's ✕ is flush in the header's top-right corner, on the heading's line", async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage();
  const { drawer } = await openDrawer(page, extensionId);

  const box = await drawer
    .getByRole('button', { name: CLOSE })
    .evaluate((close) => {
      const header = close.closest('[data-open-now-header]')!;
      const h = header.getBoundingClientRect();
      const c = close.getBoundingClientRect();
      const style = getComputedStyle(header);
      const heading = header.querySelector('h2')!.getBoundingClientRect();
      return {
        right: h.right - parseFloat(style.borderRightWidth) - c.right,
        top: c.top - (h.top + parseFloat(style.borderTopWidth)),
        middleOffHeading:
          c.top + c.height / 2 - (heading.top + heading.height / 2),
      };
    });
  expect(box.right).toBeCloseTo(0, 1);
  expect(box.top).toBeCloseTo(0, 1);
  expect(box.middleOffHeading).toBeCloseTo(0, 1);

  // The action row holds « and no ✕.
  const row = drawer.getByRole('button', {
    name: 'Fold the saved session away',
  });
  const rowParent = await row.evaluate((el) => el.parentElement!.outerHTML);
  expect(rowParent).not.toContain(CLOSE);
});

test('the ✕ closes the drawer and hands focus back to the rail button', async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage();
  const { rail, drawer } = await openDrawer(page, extensionId);

  await drawer.getByRole('button', { name: CLOSE }).click();

  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(rail).toBeFocused();
  await expect(rail).toHaveAttribute('aria-expanded', 'false');
});
