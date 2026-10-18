import type { Locator, Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { buildContainer, buildSession, seedSessions } from './fixtures/seed';
import { POPUP, stored } from './fixtures/savedWindows';

// KAN-678, KAN-684: Esc in the name field or the empty saved search left the
// page's default alone, and Chrome closes a popup on that (KAN-403). Keys sent
// here never close a popup, so this reads what the page did with Esc: whether
// it prevented the default, and where focus went. KAN-679: Enter saved and
// kept the field, where a click on + leaves it.

async function openPopup(
  context: Parameters<typeof seedSessions>[0],
  extensionId: string
): Promise<Page> {
  await seedSessions(context, {
    ...buildContainer([
      buildSession({ tabGroupId: 's-alpha', title: 'Alpha' }),
    ]),
    selectedTabGroupId: 's-alpha',
  });
  const page = await context.newPage();
  await page.setViewportSize(POPUP);
  await page.goto(`chrome-extension://${extensionId}/index.html`);
  // Barrier: goto resolves before React mounts. Locale-free.
  await page.locator('[data-tour-anchor="save"]').waitFor();
  // Every Esc, kept from the window's capture phase, so a handler that stops
  // it still lets it be read; its defaultPrevented is read once dispatch ends.
  await page.evaluate(() => {
    const w = window as unknown as { escapes: KeyboardEvent[] };
    w.escapes = [];
    window.addEventListener(
      'keydown',
      (e) => {
        if (e.key === 'Escape') w.escapes.push(e);
      },
      true
    );
  });
  return page;
}

const nameField = (page: Page): Locator => page.locator('input#name');
const search = (page: Page): Locator =>
  page.getByRole('textbox', { name: 'Search saved tabs', exact: true });
const escPrevented = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as { escapes: KeyboardEvent[] }).escapes.map(
      (e) => e.defaultPrevented
    )
  );

test('Esc in the name field leaves it, keeps the name, and keeps the popup', async ({
  context,
  extensionId,
}) => {
  const page = await openPopup(context, extensionId);
  await nameField(page).click();
  await page.keyboard.type('Kyoto');
  // PREMISE: the key lands in the field.
  await expect(nameField(page)).toBeFocused();

  await page.keyboard.press('Escape');

  expect(await escPrevented(page)).toEqual([true]);
  await expect(nameField(page)).not.toBeFocused();
  await expect(nameField(page)).toHaveValue('Kyoto');
});

test('Esc in the empty saved search leaves it, and keeps the popup', async ({
  context,
  extensionId,
}) => {
  const page = await openPopup(context, extensionId);
  await search(page).click();
  await expect(search(page)).toBeFocused();

  await page.keyboard.press('Escape');

  expect(await escPrevented(page)).toEqual([true]);
  await expect(search(page)).not.toBeFocused();
});

test('Esc with text in the saved search clears it and stays; a second Esc leaves', async ({
  context,
  extensionId,
}) => {
  const page = await openPopup(context, extensionId);
  await search(page).click();
  await page.keyboard.type('alp');

  await page.keyboard.press('Escape');
  await expect(search(page)).toHaveValue('');
  await expect(search(page)).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(search(page)).not.toBeFocused();
  expect(await escPrevented(page)).toEqual([true, true]);
});

test('Enter in the name field saves, then leaves the field', async ({
  context,
  extensionId,
}) => {
  const page = await openPopup(context, extensionId);
  await nameField(page).click();
  await page.keyboard.type('Kyoto');
  // PREMISE: focus is in the field before Enter.
  await expect(nameField(page)).toBeFocused();

  await page.keyboard.press('Enter');

  await expect
    .poll(async () => (await stored(page)).tabGroups.map((g) => g.title))
    .toContain('Kyoto');
  await expect(nameField(page)).not.toBeFocused();
});
