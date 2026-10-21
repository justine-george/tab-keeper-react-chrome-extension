import type { Locator, Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { buildContainer, buildSession, seedSessions } from './fixtures/seed';
import { POPUP, stored } from './fixtures/savedWindows';
import { LIGHT_THEME } from '../src/hooks/useThemeColors';
import { rgb } from './fixtures/pixels';

// KAN-592 on the real artifact (pick K1): ⌫, fn⌫ (Delete) and ⌘⌫ delete the session whose row
// has focus, with the Undo toast. After the delete, focus moves to the row now in its place, or
// the new last (KAN-657, pick F1), so the key deletes back to back. The header ⋮ names the key
// beside Delete session; with it open, the key runs that item (KAN-638). With nothing focused,
// Delete alone deletes the session shown (KAN-688).

const SESSIONS = ['Alpha', 'Bravo', 'Charlie', 'Delta'].map((t) =>
  buildSession({ tabGroupId: `s-${t.toLowerCase()}`, title: t })
);
const ALL = SESSIONS.map((s) => s.tabGroupId);

async function openPopup(
  context: Parameters<typeof seedSessions>[0],
  extensionId: string,
  sessions = SESSIONS
): Promise<Page> {
  await seedSessions(context, {
    ...buildContainer(sessions),
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

test('F1: focus follows the selection, so the key deletes back to back; the last row hands it up', async ({
  context,
  extensionId,
}) => {
  const page = await openPopup(context, extensionId);
  await row(page, 'Bravo').click();

  await page.keyboard.press('Backspace');
  await expect
    .poll(() => ids(page))
    .toEqual(['s-alpha', 's-charlie', 's-delta']);
  await expect(row(page, 'Charlie')).toBeFocused();
  await expect(
    page.getByRole('button', { name: 'Rename session: Charlie', exact: true })
  ).toBeVisible();

  await page.keyboard.press('Delete');
  await expect.poll(() => ids(page)).toEqual(['s-alpha', 's-delta']);
  await expect(row(page, 'Delta')).toBeFocused();

  // Delta is the last row: the selection and focus go to the new last.
  await page.keyboard.press('Backspace');
  await expect.poll(() => ids(page)).toEqual(['s-alpha']);
  await expect(row(page, 'Alpha')).toBeFocused();
  await expect(
    page.getByRole('button', { name: 'Rename session: Alpha', exact: true })
  ).toBeVisible();
});

test('a focused row that is not the one shown hands focus to the row now in its place; the one shown stays shown', async ({
  context,
  extensionId,
}) => {
  const page = await openPopup(context, extensionId);
  await row(page, 'Charlie').focus();

  await page.keyboard.press('Delete');

  await expect.poll(() => ids(page)).toEqual(['s-alpha', 's-bravo', 's-delta']);
  await expect(row(page, 'Delta')).toBeFocused();
  await expect(
    page.getByRole('button', { name: 'Rename session: Alpha', exact: true })
  ).toBeVisible();
});

test('the only session: after it goes, no row is left to take focus', async ({
  context,
  extensionId,
}) => {
  const page = await openPopup(context, extensionId, SESSIONS.slice(0, 1));
  // On its title: the shown row keeps Open, Switch and Replace drawn over its middle (KAN-582).
  await row(page, 'Alpha').click({ position: { x: 24, y: 16 } });

  await page.keyboard.press('Backspace');

  await expect.poll(() => ids(page)).toEqual([]);
  await expect(toasts(page)).toContainText('Session deleted.');
  expect(
    await page.evaluate(() => document.activeElement === document.body)
  ).toBe(true);
});

test('under a search, focus goes to the next match on screen, not the next stored session', async ({
  context,
  extensionId,
}) => {
  const sessions = [
    ...SESSIONS,
    ...['Shasta', 'Thatcher'].map((t) =>
      buildSession({ tabGroupId: `s-${t.toLowerCase()}`, title: t })
    ),
  ];
  const page = await openPopup(context, extensionId, sessions);
  // "ha" matches Alpha, Charlie, Shasta and Thatcher: no default tab, window or URL holds it.
  await page
    .getByRole('textbox', { name: 'Search saved tabs', exact: true })
    .fill('ha');
  await expect(row(page, 'Bravo')).toHaveCount(0);
  await row(page, 'Charlie').click();

  await page.keyboard.press('Backspace');

  // Charlie was 2nd on screen and 3rd stored: the 2nd on screen is now Shasta, and the 3rd on
  // screen (where a stored index would land) Thatcher.
  await expect
    .poll(() => ids(page))
    .toEqual(['s-alpha', 's-bravo', 's-delta', 's-shasta', 's-thatcher']);
  await expect(row(page, 'Shasta')).toBeFocused();
  // The shown session follows: the search's own rule would show its first match, Alpha.
  await expect(
    page.getByRole('button', { name: 'Rename session: Shasta', exact: true })
  ).toBeVisible();
});

test('under a search with a long list, the row the key acts on next stays on screen', async ({
  context,
  extensionId,
}) => {
  // Stored Alpha, Match 1, Other 1, Match 2, Other 2, …: the session stored after each match is
  // not one, so the store's own next pick (removeSession) falls outside the search.
  const sessions = [
    buildSession({ tabGroupId: 's-alpha', title: 'Alpha' }),
    ...Array.from({ length: 12 }, (_, i) => [
      buildSession({ tabGroupId: `s-m${i + 1}`, title: `Match ${i + 1}` }),
      buildSession({ tabGroupId: `s-o${i + 1}`, title: `Other ${i + 1}` }),
    ]).flat(),
  ];
  const page = await openPopup(context, extensionId, sessions);
  await page
    .getByRole('textbox', { name: 'Search saved tabs', exact: true })
    .fill('match');
  // PREMISE: the list is longer than its pane, so the first match scrolls away.
  await row(page, 'Match 10').scrollIntoViewIfNeeded();
  await expect(row(page, 'Match 1')).not.toBeInViewport();
  await row(page, 'Match 10').click();

  await page.keyboard.press('Backspace');

  await expect(row(page, 'Match 10')).toHaveCount(0);
  await expect(row(page, 'Match 11')).toBeFocused();
  await expect(row(page, 'Match 11')).toBeInViewport();
  await expect(
    page.getByRole('button', { name: 'Rename session: Match 11', exact: true })
  ).toBeVisible();
});

const nothingFocused = (page: Page) =>
  page.evaluate(() => document.activeElement === document.body);
const shown = (page: Page, title: string): Locator =>
  page.getByRole('button', { name: `Rename session: ${title}`, exact: true });

// KAN-688 (pick A). With nothing focused, Delete (fn⌫ on a Mac, Del on a PC) deletes the
// session shown; ⌫ does not, as it is the key a typo reaches for. Focus stays where it was, so
// each press deletes the one shown then.
test('with nothing focused, Delete deletes the session shown, with Undo; the next press the next one', async ({
  context,
  extensionId,
}) => {
  const page = await openPopup(context, extensionId);
  // PREMISE: Alpha is shown and nothing has focus, as the popup opens.
  await expect(shown(page, 'Alpha')).toBeVisible();
  expect(await nothingFocused(page)).toBe(true);

  await page.keyboard.press('Delete');

  await expect
    .poll(() => ids(page))
    .toEqual(['s-bravo', 's-charlie', 's-delta']);
  await expect(toasts(page)).toContainText('Session deleted.');
  await expect(shown(page, 'Bravo')).toBeVisible();
  expect(await nothingFocused(page)).toBe(true);

  await page.keyboard.press('Delete');
  await expect.poll(() => ids(page)).toEqual(['s-charlie', 's-delta']);

  await page
    .getByRole('status')
    .getByRole('button', { name: 'Undo', exact: true })
    .first()
    .click();
  await expect.poll(() => ids(page)).toContain('s-bravo');
});

for (const key of ['Backspace', 'Meta+Backspace']) {
  test(`with nothing focused, ${key} deletes nothing`, async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId);
    expect(await nothingFocused(page)).toBe(true);

    await page.keyboard.press(key);

    await expect(toasts(page)).toHaveCount(0);
    expect(await ids(page)).toEqual(ALL);
  });
}

test('with nothing focused, a held Delete deletes one session', async ({
  context,
  extensionId,
}) => {
  const page = await openPopup(context, extensionId);
  expect(await nothingFocused(page)).toBe(true);

  await page.keyboard.down('Delete');
  await page.keyboard.down('Delete');
  await page.keyboard.down('Delete');
  await page.keyboard.up('Delete');

  await expect(toasts(page)).toHaveCount(1);
  expect(await ids(page)).toEqual(['s-bravo', 's-charlie', 's-delta']);
});

test('in Settings, Delete deletes nothing', async ({
  context,
  extensionId,
}) => {
  const page = await openPopup(context, extensionId);
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(
    page.getByRole('button', { name: 'Go back', exact: true })
  ).toBeVisible();
  await page.evaluate(() => (document.activeElement as HTMLElement).blur());

  await page.keyboard.press('Delete');

  await expect(toasts(page)).toHaveCount(0);
  expect(await ids(page)).toEqual(ALL);
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

test('K1: the ⋮ shows ⌫ beside Delete session, red at rest and white on its red hover', async ({
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
  // KAN-725. At rest the hint is red like the label; on the red fill both are white.
  expect(await color(item)).toBe(rgb(LIGHT_THEME.DANGER_INK));
  expect(await color(hint)).toBe(await color(item));

  await item.hover();
  await expect.poll(() => color(item)).toBe(rgb(LIGHT_THEME.ON_DANGER_FILL));
  await expect.poll(() => color(hint)).toBe(rgb(LIGHT_THEME.ON_DANGER_FILL));
  // The keys are named on the row and the item; the item's name is its label alone.
  const keys = isMac ? 'Backspace Meta+Backspace Delete' : 'Delete Backspace';
  await expect(row(page, 'Alpha')).toHaveAttribute('aria-keyshortcuts', keys);
  await expect(item).toHaveAttribute('aria-keyshortcuts', keys);
});
