import type { Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { buildContainer, buildSession, seedSessions } from './fixtures/seed';

// KAN-252. "Replace sessions from a backup" asks before it replaces. The unit
// tests drive the handler with a synthetic file event; what a real browser
// adds is the file chooser itself, the dialog in the top layer, and the
// unlit opening (KAN-243) that jsdom's showModal shim cannot reproduce.

const HERE = buildContainer([
  buildSession({ tabGroupId: 'h1', title: 'Here one' }),
  buildSession({ tabGroupId: 'h2', title: 'Here two' }),
  buildSession({ tabGroupId: 'h3', title: 'Here three' }),
]);

const FROM_FILE = buildContainer([
  buildSession({ tabGroupId: 'f1', title: 'From the file' }),
]);

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
    page.getByRole('button', { name: 'Replace sessions from a backup' })
  ).toBeVisible();
  return page;
}

// Click the button and answer the OS file chooser with a backup file.
async function pickBackup(page: Page, name: string): Promise<void> {
  const chooser = page.waitForEvent('filechooser');
  await page
    .getByRole('button', { name: 'Replace sessions from a backup' })
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

test.describe('Replace sessions from a backup asks first (KAN-252)', () => {
  test('a picked file opens a modal, unlit, naming both counts; Cancel changes nothing; Replace replaces', async ({
    context,
    extensionId,
  }) => {
    const page = await openSyncAndBackup(context, extensionId);

    await pickBackup(page, 'monday.json');

    const dialog = page.getByRole('dialog', {
      name: 'Replace your saved sessions?',
    });
    await expect(dialog).toBeVisible();
    expect(await dialog.evaluate((el) => (el as HTMLDialogElement).open)).toBe(
      true
    );
    await expect(dialog).toContainText(
      'Your 3 saved sessions here will be replaced.'
    );
    await expect(dialog).toContainText('monday.json holds 1 session.');
    // Unlit: the dialog holds the focus, no button is pre-chosen, so Enter on
    // open does nothing -- Replace is a click away, not a keypress away.
    await expect(dialog).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(dialog).toBeVisible();
    expect(await titlesHere(page)).toEqual([
      'Here one',
      'Here two',
      'Here three',
    ]);

    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toHaveCount(0);
    expect(await titlesHere(page)).toEqual([
      'Here one',
      'Here two',
      'Here three',
    ]);

    await pickBackup(page, 'monday.json');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Replace' }).click();
    await expect(dialog).toHaveCount(0);
    await expect.poll(() => titlesHere(page)).toEqual(['From the file']);
  });

  test('Escape is Cancel', async ({ context, extensionId }) => {
    const page = await openSyncAndBackup(context, extensionId);
    await pickBackup(page, 'backup.json');
    const dialog = page.getByRole('dialog', {
      name: 'Replace your saved sessions?',
    });
    await expect(dialog).toBeVisible();

    await page.keyboard.press('Escape');

    await expect(dialog).toHaveCount(0);
    expect(await titlesHere(page)).toEqual([
      'Here one',
      'Here two',
      'Here three',
    ]);
  });
});
