import type { BrowserContext, Page, Worker } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { saveRowMenu } from './fixtures/menus';
import { buildSession } from './fixtures/seed';
import { seedOnce } from './fixtures/cloud';

// KAN-635 on the real artifact: Settings › Sessions › Default save decides
// what the row's button and Enter save; the ⋮ menu's first item is the other.
// The full view's own window holds Here; a second window holds Far, so a
// current-window save keeps Here and leaves Far out.

const VIEW = { width: 1280, height: 800 };
const ALL = 'Save all open windows as a session';
const CURRENT = 'Save current window as a session';

/** No spaces in the title: a data: URL keeps them only when encoded. */
const titled = (title: string) =>
  `data:text/html,<title>${title}</title><p>${title}</p>`;

async function openFarWindow(worker: Worker): Promise<void> {
  await worker.evaluate(async (url) => {
    const win = await chrome.windows.create({ url, focused: false });
    const tabId = win?.tabs?.[0]?.id;
    if (tabId === undefined) throw new Error('no window with a tab');
    for (let i = 0; i < 100; i++) {
      const now = await chrome.tabs.get(tabId);
      if (now.status === 'complete' && now.title === 'Far') return;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error('the far tab never loaded');
  }, titled('Far'));
}

async function openFullView(
  context: BrowserContext,
  extensionId: string
): Promise<Page> {
  const here = await context.newPage();
  await here.goto(titled('Here'));
  const page = await context.newPage();
  await page.setViewportSize(VIEW);
  await page.goto(`chrome-extension://${extensionId}/index.html?view=tab`);
  // Barrier: goto resolves before React mounts.
  await page.locator('[data-tour-anchor="save"]').waitFor();
  return page;
}

// The titles of every stored session's tabs, by session title.
const storedTitles = (page: Page) =>
  page.evaluate(() => {
    const parsed = JSON.parse(
      window.localStorage.getItem('tabContainerData') ?? '{}'
    ) as {
      tabGroups?: {
        title: string;
        windows: { tabs: { title: string }[] }[];
      }[];
    };
    return Object.fromEntries(
      (parsed.tabGroups ?? []).map((g) => [
        g.title,
        g.windows.flatMap((w) => w.tabs.map((t) => t.title)),
      ])
    );
  });

async function saveByEnter(page: Page, name: string): Promise<void> {
  await page.locator('input#name').fill(name);
  await page.locator('input#name').press('Enter');
  await expect(
    page.getByRole('button', { name, exact: true }).first()
  ).toBeVisible();
}

// Scoped to the save row: Open now's own save-all button has the same name.
const saveRow = (page: Page) => page.locator('[data-save-row]');
const glyph = (page: Page, name: string) =>
  saveRow(page)
    .getByRole('button', { name, exact: true })
    .locator('.material-symbols-outlined');

test.beforeEach(async ({ context }) => {
  await seedOnce(context, [
    buildSession({ tabGroupId: 's0', title: 'Already saved' }),
  ]);
});

test('CONTROL, all windows by default: Enter saves the far window too', async ({
  context,
  serviceWorker,
  extensionId,
}) => {
  await openFarWindow(serviceWorker);
  const page = await openFullView(context, extensionId);
  await expect(glyph(page, ALL)).toHaveText('library_add');

  await saveByEnter(page, 'Everything');
  const titles = (await storedTitles(page))['Everything'] ?? [];
  expect(titles).toContain('Here');
  expect(titles).toContain('Far');
});

test('Current window: the button and Enter save this window; the menu saves all; it survives a reload', async ({
  context,
  serviceWorker,
  extensionId,
}, testInfo) => {
  await openFarWindow(serviceWorker);
  const page = await openFullView(context, extensionId);

  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Sessions', exact: true }).click();
  const group = page.getByRole('radiogroup', { name: 'Default save' });
  await expect(group.getByRole('radio', { name: 'All windows' })).toBeChecked();
  await page.screenshot({ path: testInfo.outputPath('settings-all.png') });
  // The tile, not the hidden input: a click anywhere on the box chooses it.
  await group.locator('label', { hasText: 'Current window' }).click();
  await expect(
    group.getByRole('radio', { name: 'Current window' })
  ).toBeChecked();
  await page.screenshot({ path: testInfo.outputPath('settings-current.png') });
  await page.getByText('Back', { exact: true }).click();

  await expect(glyph(page, CURRENT)).toHaveText('add_box');
  await expect(saveRow(page).getByRole('button', { name: ALL })).toHaveCount(0);

  await saveByEnter(page, 'Here only');
  const hereOnly = (await storedTitles(page))['Here only'] ?? [];
  expect(hereOnly).toContain('Here');
  expect(hereOnly).not.toContain('Far');

  await page.locator('input#name').fill('Both');
  await saveRowMenu(page).click();
  const first = page.getByRole('menuitem').first();
  await expect(first).toHaveAccessibleName(ALL);
  await first.click();
  await expect(
    page.getByRole('button', { name: 'Both', exact: true }).first()
  ).toBeVisible();
  const both = (await storedTitles(page))['Both'] ?? [];
  expect(both).toContain('Here');
  expect(both).toContain('Far');

  await page.reload();
  await page.locator('[data-tour-anchor="save"]').waitFor();
  await expect(glyph(page, CURRENT)).toHaveText('add_box');
});

test('another open page swaps its row without a reload', async ({
  context,
  extensionId,
}) => {
  const other = await openFullView(context, extensionId);
  await expect(glyph(other, ALL)).toHaveText('library_add');

  const page = await openFullView(context, extensionId);
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Sessions', exact: true }).click();
  await page
    .getByRole('radiogroup', { name: 'Default save' })
    .locator('label', { hasText: 'Current window' })
    .click();

  await expect(glyph(other, CURRENT)).toHaveText('add_box');
});
