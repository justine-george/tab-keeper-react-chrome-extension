import type { BrowserContext, Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { buildSession } from './fixtures/seed';
import { seedOnce } from './fixtures/cloud';

// KAN-925. Chrome does not always fire `storage` in another open page when one
// writes (8 in 6,183 runs), so the writer also posts the key on a
// BroadcastChannel. Here no page ever hears a `storage` event: what reaches
// the other page is the post alone.

const ALPHA = buildSession({ tabGroupId: 'alpha', title: 'Alpha session' });
const BRAVO = buildSession({ tabGroupId: 'bravo', title: 'Bravo session' });

test.beforeEach(async ({ context }) => {
  await seedOnce(context, [ALPHA, BRAVO]);
  // First listener on the window, and at capture: the app's never runs.
  await context.addInitScript(() => {
    window.addEventListener('storage', (e) => e.stopImmediatePropagation(), {
      capture: true,
    });
  });
});

const titled = (title: string) =>
  `data:text/html,<title>${title}</title><p>${title}</p>`;

async function openFullView(
  context: BrowserContext,
  extensionId: string
): Promise<Page> {
  const here = await context.newPage();
  await here.goto(titled('Here'));
  const page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`chrome-extension://${extensionId}/index.html?view=tab`);
  // Barrier: goto resolves before React mounts.
  await page.locator('[data-tour-anchor="save"]').waitFor();
  return page;
}

const saveGlyph = (page: Page, name: string) =>
  page
    .locator('[data-save-row]')
    .getByRole('button', { name, exact: true })
    .locator('[data-icon]');

const row = (page: Page, title: string) =>
  page.getByRole('button', { name: title, exact: true });

const renameControl = (page: Page, title: string) =>
  page.getByRole('button', { name: `Rename session: ${title}`, exact: true });

test('with no storage event, another open page still swaps its save row', async ({
  context,
  extensionId,
}) => {
  const other = await openFullView(context, extensionId);
  await expect(
    saveGlyph(other, 'Save all open windows as a session')
  ).toHaveAttribute('data-icon', 'two_windows_add');

  const page = await openFullView(context, extensionId);
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Sessions', exact: true }).click();
  await page
    .getByRole('radiogroup', { name: 'Default save' })
    .locator('label', { hasText: 'Current window' })
    .click();

  await expect(
    saveGlyph(other, 'Save current window as a session')
  ).toHaveAttribute('data-icon', 'window_add');
});

test('with no storage event, a rename in one page still appears in the other', async ({
  context,
  extensionId,
}) => {
  const open = async () => {
    const page = await context.newPage();
    await page.setViewportSize({ width: 790, height: 550 });
    await page.goto(`chrome-extension://${extensionId}/index.html`);
    await expect(row(page, ALPHA.title)).toBeVisible();
    return page;
  };
  const other = await open();
  const page = await open();

  // Near the left edge: the row's Open/Switch/Delete overlay its right half.
  await row(page, BRAVO.title).click({ position: { x: 20, y: 20 } });
  await renameControl(page, BRAVO.title).click();
  const input = page.locator('input:focus');
  await input.fill('Renamed elsewhere');
  await input.press('Enter');
  await expect(renameControl(page, 'Renamed elsewhere')).toBeVisible();

  await expect(row(other, 'Renamed elsewhere')).toBeVisible();
  await expect(row(other, BRAVO.title)).toHaveCount(0);
});
