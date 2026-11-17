import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import {
  buildContainer,
  buildSession,
  seedSessions,
  seedSettings,
} from './fixtures/seed';
import { FULL_VIEW_PATH, pageGround } from './fixtures/onboarding';
import { localeStrings } from './fixtures/locales';
import { CHALK_THEME, CHARCOAL_THEME } from '../src/hooks/useThemeColors';

// KAN-252 / KAN-261. "Load a backup" reads the file, then asks:
// Merge (keep everything here, add the file's) or Replace (throw away what is
// here first). The unit tests drive the handler with a synthetic file event;
// what a real browser adds is the file chooser itself, the dialog in the top
// layer, and the unlit opening (KAN-243) that jsdom's showModal shim cannot
// reproduce. In the full view: the popup hands its file step there (KAN-579).

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
  extensionId: string,
  here = HERE
): Promise<Page> {
  await seedSessions(context, here);
  const page = await context.newPage();
  await page.setViewportSize({ width: 790, height: 550 });
  await page.goto(`chrome-extension://${extensionId}/${FULL_VIEW_PATH}`);
  await page.locator('[aria-label="Settings"]').click();
  await page.locator('button[aria-label="Sync & backup"]').click();
  await expect(
    page.getByRole('button', { name: 'Load a backup' })
  ).toBeVisible();
  return page;
}

// Click the button and answer the OS file chooser with a backup file.
async function pickBackup(
  page: Page,
  name: string,
  file: object = FROM_FILE
): Promise<void> {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Load a backup' }).click();
  await (
    await chooser
  ).setFiles({
    name,
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(file)),
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

test.describe('Load a backup asks first (KAN-252, KAN-261)', () => {
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
      'Replace',
      'Merge',
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

    await dialog.getByRole('button', { name: 'Merge' }).click();

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

  // KAN-618. Auto Sync off, so no cloud write can turn it into the sync-failed toast.
  test('a merge says "Tabs restored." with a full stop', async ({
    context,
    extensionId,
  }) => {
    await seedSettings(context, { isAutoSync: false });
    const page = await openSyncAndBackup(context, extensionId);
    await pickBackup(page, 'monday.json');
    await dialogOf(page).getByRole('button', { name: 'Merge' }).click();

    await expect(page.locator('[role="status"] [data-toast]')).toHaveText(
      'Tabs restored.'
    );
  });

  test('Replace puts the file in place of what is here', async ({
    context,
    extensionId,
  }) => {
    const page = await openSyncAndBackup(context, extensionId);
    await pickBackup(page, 'monday.json');
    const dialog = dialogOf(page);
    await expect(dialog).toBeVisible();

    await dialog.getByRole('button', { name: 'Replace' }).click();

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

// KAN-961. A backup carries the settings changed from a new install; Replace and an empty Tab Keeper take them, Merge doesn't.
test.describe('a backup brings its settings (KAN-961)', () => {
  const WITH_SETTINGS = {
    ...FROM_FILE,
    settings: { theme: 'Charcoal', language: 'de' },
  };
  const DE = localeStrings('de');

  const storedSettings = (page: Page) =>
    page.evaluate(
      () =>
        JSON.parse(localStorage.getItem('settingsData') ?? '{}') as Record<
          string,
          unknown
        >
    );

  test.beforeEach(async ({ context }) => {
    // Auto Sync off, so no cloud write turns the toast into the sync-failed one.
    await seedSettings(context, {
      isAutoSync: false,
      theme: 'Chalk',
      language: 'en',
    });
  });

  test('Replace switches the theme and language and says settings came across', async ({
    context,
    extensionId,
  }) => {
    const page = await openSyncAndBackup(context, extensionId);
    expect(await pageGround(page)).toBe(
      CHALK_THEME.PRIMARY_COLOR.toUpperCase()
    );
    await pickBackup(page, 'monday.json', WITH_SETTINGS);
    const dialog = dialogOf(page);
    await expect(dialog).toContainText(
      'Replace deletes the 3 sessions on this device and on every device that syncs with it, then loads the backup and its settings. This can’t be undone.'
    );

    await dialog.getByRole('button', { name: 'Replace' }).click();

    await expect(page.locator('[role="status"] [data-toast]')).toHaveText(
      DE['Sessions and settings restored.']
    );
    await expect
      .poll(() => pageGround(page))
      .toBe(CHARCOAL_THEME.PRIMARY_COLOR.toUpperCase());
    await expect(
      page.getByRole('button', { name: DE['Sync & Backup'] })
    ).toBeVisible();
    expect(await storedSettings(page)).toMatchObject({
      theme: 'Charcoal',
      language: 'de',
      timeFormat: 'h23',
    });
    expect(await titlesHere(page)).toEqual(['From the file']);
  });

  test('Merge leaves the theme and language alone', async ({
    context,
    extensionId,
  }) => {
    const page = await openSyncAndBackup(context, extensionId);
    await pickBackup(page, 'monday.json', WITH_SETTINGS);
    const dialog = dialogOf(page);
    await expect(dialog).toContainText(
      'Replace deletes the 3 sessions on this device and on every device that syncs with it, then loads the backup and its settings. This can’t be undone.'
    );

    await dialog.getByRole('button', { name: 'Merge' }).click();

    await expect(page.locator('[role="status"] [data-toast]')).toHaveText(
      'Tabs restored.'
    );
    expect(await pageGround(page)).toBe(
      CHALK_THEME.PRIMARY_COLOR.toUpperCase()
    );
    await expect(
      page.getByRole('button', { name: 'Sync & backup' })
    ).toBeVisible();
    expect(await storedSettings(page)).toMatchObject({
      theme: 'Chalk',
      language: 'en',
    });
  });

  test('an empty Tab Keeper takes them with no question', async ({
    context,
    extensionId,
  }) => {
    const page = await openSyncAndBackup(
      context,
      extensionId,
      buildContainer([])
    );
    await pickBackup(page, 'monday.json', WITH_SETTINGS);

    await expect(page.locator('[role="status"] [data-toast]')).toHaveText(
      DE['Sessions and settings restored.']
    );
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(await storedSettings(page)).toMatchObject({
      theme: 'Charcoal',
      language: 'de',
    });
    expect(await titlesHere(page)).toEqual(['From the file']);
  });

  test('Save a backup writes only the settings changed from a new install', async ({
    context,
    extensionId,
  }) => {
    await seedSettings(context, {
      isAutoSync: false,
      theme: 'Chalk',
      language: 'en',
      timeFormat: 'h12',
      skipDuplicateTabs: true,
    });
    const page = await openSyncAndBackup(context, extensionId);
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Save a backup' }).click();
    const path = await (await download).path();
    const file = JSON.parse(readFileSync(path, 'utf8')) as {
      settings?: unknown;
      tabGroups: { title: string }[];
    };
    expect(file.settings).toEqual({ skipDuplicateTabs: true });
    expect(file.tabGroups.map((g) => g.title)).toEqual(HERE_TITLES);
  });
});
