import type { Locator, Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { buildContainer, buildSession, seedSessions } from './fixtures/seed';
import { POPUP, stored } from './fixtures/savedWindows';

// KAN-592 on the real artifact (picks K1, F2): ⌫, fn⌫ (Delete) and ⌘⌫ delete the session whose
// row has focus, with the Undo toast; no row takes focus after, and Tab carries on from where the
// row was. The header ⋮ names the key beside Delete session; with it open, the key runs that
// item (KAN-638).

const SESSIONS = ['Alpha', 'Bravo', 'Charlie', 'Delta'].map((t) =>
  buildSession({ tabGroupId: `s-${t.toLowerCase()}`, title: t })
);
const ALL = SESSIONS.map((s) => s.tabGroupId);

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
const ids = async (page: Page) =>
  (await stored(page)).tabGroups.map((g) => g.tabGroupId);
const toasts = (page: Page): Locator =>
  page.locator('[role="status"] > [data-toast]:not([aria-hidden="true"])');
const focusedName = (page: Page) =>
  page.evaluate(() => document.activeElement?.getAttribute('aria-label'));

for (const key of ['Backspace', 'Delete', 'Meta+Backspace']) {
  test(`${key} on a clicked row deletes its session, with Undo`, async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId);
    await row(page, 'Bravo').click();

    await page.keyboard.press(key);

    await expect
      .poll(() => ids(page))
      .toEqual(['s-alpha', 's-charlie', 's-delta']);
    await expect(toasts(page)).toContainText('Session deleted.');
    await page
      .getByRole('status')
      .getByRole('button', { name: 'Undo', exact: true })
      .click();
    await expect.poll(() => ids(page)).toEqual(ALL);
  });
}

const sessionMenu = (page: Page): Locator =>
  page
    .locator('[data-pane="detail"] [data-tour-anchor="session-menu"]')
    .locator('[aria-haspopup="menu"]');

for (const opened of ['click', 'keyboard'] as const) {
  for (const key of ['Backspace', 'Delete', 'Meta+Backspace']) {
    test(`KAN-638: ${key} in the ⋮ opened by ${opened} deletes the shown session, with Undo`, async ({
      context,
      extensionId,
    }) => {
      const page = await openPopup(context, extensionId);
      if (opened === 'click') {
        await sessionMenu(page).click();
      } else {
        await sessionMenu(page).focus();
        await page.keyboard.press('Enter');
      }
      // PREMISE: the key lands in the menu, on its first item, not on a row.
      await expect(
        page.getByRole('menuitem', { name: 'Copy all links' })
      ).toBeFocused();

      await page.keyboard.press(key);

      await expect
        .poll(() => ids(page))
        .toEqual(['s-bravo', 's-charlie', 's-delta']);
      await expect(page.getByRole('menu')).toHaveCount(0);
      await expect(toasts(page)).toContainText('Session deleted.');
      await page
        .getByRole('status')
        .getByRole('button', { name: 'Undo', exact: true })
        .click();
      await expect.poll(() => ids(page)).toEqual(ALL);
    });
  }
}

test('a row reached by Tab deletes its own session, not the one shown', async ({
  context,
  extensionId,
}) => {
  const page = await openPopup(context, extensionId);
  await row(page, 'Charlie').focus();

  await page.keyboard.press('Delete');

  await expect.poll(() => ids(page)).toEqual(['s-alpha', 's-bravo', 's-delta']);
  await expect(
    page.getByRole('button', { name: 'Rename session: Alpha', exact: true })
  ).toBeVisible();
});

test('F2: no row keeps focus, so a second press deletes nothing; Tab goes to the next row', async ({
  context,
  extensionId,
}) => {
  const page = await openPopup(context, extensionId);
  await row(page, 'Bravo').click();
  await page.keyboard.press('Backspace');
  await expect
    .poll(() => ids(page))
    .toEqual(['s-alpha', 's-charlie', 's-delta']);

  await page.keyboard.press('Backspace');
  await page.keyboard.press('Delete');
  // A stored write is synchronous with the delete; a toast count of one rules out a late second.
  await expect(toasts(page)).toHaveCount(1);
  expect(await ids(page)).toEqual(['s-alpha', 's-charlie', 's-delta']);

  await page.keyboard.press('Tab');
  expect(await focusedName(page)).toBe('Charlie');
});

test('a held key deletes one session', async ({ context, extensionId }) => {
  const page = await openPopup(context, extensionId);
  await row(page, 'Bravo').focus();

  // A second down without an up is an auto-repeat (event.repeat).
  await page.keyboard.down('Backspace');
  await page.keyboard.down('Backspace');
  await page.keyboard.down('Backspace');
  await page.keyboard.up('Backspace');

  await expect(toasts(page)).toHaveCount(1);
  expect(await ids(page)).toEqual(['s-alpha', 's-charlie', 's-delta']);
});

test('Backspace in the search, rename and save fields edits text and deletes nothing', async ({
  context,
  extensionId,
}) => {
  const page = await openPopup(context, extensionId);

  const search = page.getByRole('textbox', {
    name: 'Search saved tabs',
    exact: true,
  });
  await search.fill('Alp');
  await search.press('Backspace');
  await expect(search).toHaveValue('Al');
  await search.fill('');

  await page
    .getByRole('button', { name: 'Rename session: Alpha', exact: true })
    .click();
  const rename = page.locator('[data-pane="detail"] input');
  await expect(rename).toBeFocused();
  await rename.press('End');
  await rename.press('Backspace');
  await expect(rename).toHaveValue('Alph');
  await rename.press('Escape');

  const save = page.locator('[data-tour-anchor="save"] input');
  await save.fill('Mine');
  await save.press('Backspace');
  await expect(save).toHaveValue('Min');

  expect(await ids(page)).toEqual(ALL);
  await expect(toasts(page)).toHaveCount(0);
});

test('K1: the ⋮ shows ⌫ beside Delete session, readable on its red hover', async ({
  context,
  extensionId,
}) => {
  const page = await openPopup(context, extensionId);
  await sessionMenu(page).click();
  const item = page.getByRole('menuitem', { name: 'Delete session' });
  const hint = item.locator('[data-key-hint]');

  // Per the host: CI runs Linux, a Mac run reads the Mac form.
  const isMac = await page.evaluate(
    async () => (await chrome.runtime.getPlatformInfo()).os === 'mac'
  );
  await expect(hint).toHaveText(isMac ? '⌫' : 'Del');
  await expect(hint).toHaveAttribute('aria-hidden', 'true');
  const color = (l: Locator) => l.evaluate((e) => getComputedStyle(e).color);
  expect(await color(hint)).not.toBe(await color(item));

  await item.hover();
  // On the danger fill the hint takes the label's colour, which KAN-204 holds readable there.
  await expect.poll(() => color(hint)).toBe(await color(item));
  // The keys are named on the row and the item; the item's name is its label alone.
  const keys = isMac ? 'Backspace Meta+Backspace Delete' : 'Delete Backspace';
  await expect(row(page, 'Alpha')).toHaveAttribute('aria-keyshortcuts', keys);
  await expect(item).toHaveAttribute('aria-keyshortcuts', keys);
});
