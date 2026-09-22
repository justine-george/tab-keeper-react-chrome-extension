import type { Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { buildContainer, buildSession, seedSessions } from './fixtures/seed';

// KAN-252 / KAN-261. "Load sessions from a backup" reads the file, then asks:
// Merge (keep everything here, add the file's) or Replace (throw away what is
// here first). The unit tests drive the handler with a synthetic file event;
// what a real browser adds is the file chooser itself, the dialog in the top
// layer, and the unlit opening (KAN-243) that jsdom's showModal shim cannot
// reproduce.

const HERE = buildContainer([
  buildSession({ tabGroupId: 'h1', title: 'Here one' }),
  buildSession({ tabGroupId: 'h2', title: 'Here two' }),
  buildSession({ tabGroupId: 'h3', title: 'Here three' }),
]);

const FROM_FILE = buildContainer([
  buildSession({ tabGroupId: 'f1', title: 'From the file' }),
]);

const HERE_TITLES = ['Here one', 'Here two', 'Here three'];

async function openSyncAndBackup(
  context: Parameters<typeof seedSessions>[0],
  extensionId: string
): Promise<Page> {
  await seedSessions(context, HERE);
  const page = await context.newPage();
  await page.setViewportSize({ width: 790, height: 550 });
  await page.goto(`chrome-extension://${extensionId}/index.html`);
  await page.locator('[aria-label="Settings"]').click();
  await page.locator('button[aria-label="Sync & Backup"]').click();
  await expect(
    page.getByRole('button', { name: 'Load sessions from a backup' })
  ).toBeVisible();
  return page;
}

// Click the button and answer the OS file chooser with a backup file.
async function pickBackup(page: Page, name: string): Promise<void> {
  const chooser = page.waitForEvent('filechooser');
  await page
    .getByRole('button', { name: 'Load sessions from a backup' })
    .click();
  await (
    await chooser
  ).setFiles({
    name,
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(FROM_FILE)),
  });
}

const titlesHere = (page: Page) =>
  page.evaluate(() => {
    const data = JSON.parse(localStorage.getItem('tabContainerData')!) as {
      tabGroups: { title: string }[];
    };
    return data.tabGroups.map((g) => g.title);
  });

const graveIdsHere = (page: Page) =>
  page.evaluate(() => {
    const data = JSON.parse(localStorage.getItem('tabContainerData')!) as {
      deletedTabGroups?: { tabGroupId: string }[];
    };
    return (data.deletedTabGroups ?? []).map((g) => g.tabGroupId).sort();
  });

const dialogOf = (page: Page) =>
  page.getByRole('dialog', { name: 'Load 1 session from this backup?' });

test.describe('Load sessions from a backup asks first (KAN-252, KAN-261)', () => {
  test('a picked file opens a modal, unlit, with Cancel, Merge and Replace; Cancel changes nothing', async ({
    context,
    extensionId,
  }) => {
    const page = await openSyncAndBackup(context, extensionId);

    await pickBackup(page, 'monday.json');

    const dialog = dialogOf(page);
    await expect(dialog).toBeVisible();
    expect(await dialog.evaluate((el) => (el as HTMLDialogElement).open)).toBe(
      true
    );
    await expect(dialog).toContainText('monday.json');
    await expect(dialog).toContainText(
      'Merge keeps the 3 sessions on this device and adds any sessions from the backup that aren’t already here.'
    );
    await expect(dialog).toContainText(
      'Replace deletes the 3 sessions on this device and on every device that syncs with it, then loads the backup. This can’t be undone.'
    );
    await expect(dialog.getByRole('button')).toHaveText([
      'Cancel',
      'Merge sessions',
      'Replace sessions',
    ]);
    // Unlit: the dialog holds the focus, no button is pre-chosen, so Enter on
    // open does nothing -- neither answer is a keypress away.
    await expect(dialog).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(dialog).toBeVisible();
    expect(await titlesHere(page)).toEqual(HERE_TITLES);

    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toHaveCount(0);
    expect(await titlesHere(page)).toEqual(HERE_TITLES);
  });

  test('Merge adds the file on top of what is here', async ({
    context,
    extensionId,
  }) => {
    const page = await openSyncAndBackup(context, extensionId);
    await pickBackup(page, 'monday.json');
    const dialog = dialogOf(page);
    await expect(dialog).toBeVisible();

    await dialog.getByRole('button', { name: 'Merge sessions' }).click();

    await expect(dialog).toHaveCount(0);
    await expect
      .poll(() => titlesHere(page))
      .toEqual(['From the file', ...HERE_TITLES]);
    // And it is in the list, on top, back on the home screen. Session rows
    // carry the id as their drag-row id (KAN-130).
    await page.getByRole('button', { name: 'Go back' }).click();
    const sessionRows = page.locator(
      '[data-drag-row-id^="h"], [data-drag-row-id="f1"]'
    );
    await expect(sessionRows.first()).toHaveAttribute('data-drag-row-id', 'f1');
  });

  test('Replace puts the file in place of what is here', async ({
    context,
    extensionId,
  }) => {
    const page = await openSyncAndBackup(context, extensionId);
    await pickBackup(page, 'monday.json');
    const dialog = dialogOf(page);
    await expect(dialog).toBeVisible();

    await dialog.getByRole('button', { name: 'Replace sessions' }).click();

    await expect(dialog).toHaveCount(0);
    await expect.poll(() => titlesHere(page)).toEqual(['From the file']);
    // KAN-262. The three it dropped are buried, so the next sync deletes
    // them from the cloud instead of bringing them back from it.
    expect(await graveIdsHere(page)).toEqual(['h1', 'h2', 'h3']);
  });

  test('Escape is Cancel', async ({ context, extensionId }) => {
    const page = await openSyncAndBackup(context, extensionId);
    await pickBackup(page, 'monday.json');
    const dialog = dialogOf(page);
    await expect(dialog).toBeVisible();

    await page.keyboard.press('Escape');

    await expect(dialog).toHaveCount(0);
    expect(await titlesHere(page)).toEqual(HERE_TITLES);
  });
});
