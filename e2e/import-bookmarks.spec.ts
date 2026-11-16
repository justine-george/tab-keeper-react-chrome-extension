import type { Page, Worker } from '@playwright/test';

import { expect, grantedTest as test } from './fixtures/grantedExtension';
import { FULL_VIEW_PATH, openFullView, openPopup } from './fixtures/onboarding';
import { stubToolbarPin } from './fixtures/toolbarPin';
import { seedSettings } from './fixtures/seed';

// KAN-862. Settings › Sync & backup › Import opens the bookmark import dialog. `bookmarks` is made required in the
// scratch manifest, so the full view's ask resolves without a prompt. The real optional-grant prompt on a press is
// checked by hand, not here.
test.use({ grantBookmarks: true });

// Two top folders with distinctive names; each has its own link, subfolders that become windows, and one deeper
// folder that folds into its parent window. A third folder is never ticked.
async function seedBookmarks(worker: Worker): Promise<void> {
  await worker.evaluate(async () => {
    const make = (parentId: string, title: string, url?: string) =>
      chrome.bookmarks.create({ parentId, title, url });
    const fold = async (parentId: string, title: string, links: string[]) => {
      const f = await make(parentId, title);
      for (const l of links) await make(f.id, l, `https://example.com/${l}`);
      return f;
    };
    const [root] = await chrome.bookmarks.getTree();
    const bar = root.children?.[0];
    if (bar === undefined) throw new Error('no bookmarks bar');
    // Bookmarks outlive a test's profile when one worker runs several, so start from an empty bar.
    for (const old of bar.children ?? [])
      await chrome.bookmarks.removeTree(old.id);
    const alpha = await fold(bar.id, 'Alpha trip', ['alpha-own']);
    await fold(alpha.id, 'Alpha flights', ['flight-1', 'flight-2']);
    const hotels = await fold(alpha.id, 'Alpha hotels', ['hotel-1']);
    await fold(hotels.id, 'Alpha deep', ['deep-1']);
    const beta = await fold(bar.id, 'Beta research', ['beta-own']);
    await fold(beta.id, 'Beta papers', ['paper-1']);
    await fold(bar.id, 'Gamma untouched', ['gamma-1']);
  });
}

interface StoredSession {
  title: string;
  isSelected: boolean;
  windows: { title?: string; tabCount: number }[];
}

const storedSessions = (page: Page): Promise<StoredSession[]> =>
  page.evaluate(() => {
    const data: unknown = JSON.parse(
      localStorage.getItem('tabContainerData') ?? '{}'
    );
    const groups =
      typeof data === 'object' && data !== null && 'tabGroups' in data
        ? data.tabGroups
        : [];
    return Array.isArray(groups) ? groups : [];
  });

async function onSyncAndBackup(page: Page): Promise<void> {
  await page.locator('[aria-label="Settings"]').click();
  await page.locator('button[aria-label="Sync & backup"]').click();
}

const dialogOn = (page: Page) =>
  page.getByRole('dialog', { name: 'Import from bookmarks' });

test.describe('Import from bookmarks in Settings (KAN-862)', () => {
  test.beforeEach(async ({ context, serviceWorker }) => {
    await seedSettings(context, {});
    await seedBookmarks(serviceWorker);
  });

  test('full view: tick two folders, Import, and both are saved with their subfolders as windows, the first selected', async ({
    context,
    extensionId,
  }) => {
    const page = await openFullView(context, extensionId);
    await onSyncAndBackup(page);
    await page.getByRole('button', { name: 'Import from bookmarks' }).click();

    const dialog = dialogOn(page);
    await expect(dialog).toBeVisible();
    await dialog.getByRole('checkbox', { name: 'Alpha trip' }).check();
    await dialog.getByRole('checkbox', { name: 'Beta research' }).check();
    await dialog.getByRole('button', { name: 'Import 2 sessions' }).click();
    await expect(dialog).toBeHidden();

    await expect
      .poll(async () => (await storedSessions(page)).map((s) => s.title))
      .toEqual(['Alpha trip', 'Beta research']);
    const [alpha, beta] = await storedSessions(page);
    expect(alpha.windows.map((w) => w.title)).toEqual([
      'Alpha trip',
      'Alpha flights',
      'Alpha hotels',
    ]);
    expect(alpha.windows.map((w) => w.tabCount)).toEqual([1, 2, 2]);
    expect(beta.windows.map((w) => w.title)).toEqual([
      'Beta research',
      'Beta papers',
    ]);
    expect([alpha.isSelected, beta.isSelected]).toEqual([true, false]);
    expect((await storedSessions(page)).map((s) => s.title)).not.toContain(
      'Gamma untouched'
    );
  });

  test('full view: Cancel closes the dialog and saves nothing', async ({
    context,
    extensionId,
  }) => {
    const page = await openFullView(context, extensionId);
    await onSyncAndBackup(page);
    await page.getByRole('button', { name: 'Import from bookmarks' }).click();
    const dialog = dialogOn(page);
    await dialog.getByRole('checkbox', { name: 'Alpha trip' }).check();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
    expect(await storedSessions(page)).toEqual([]);
  });

  test('popup: the button opens a full view on Sync & backup with Import from bookmarks focused, and a press opens the dialog', async ({
    context,
    extensionId,
  }) => {
    const popup = await openPopup(context, extensionId);
    await onSyncAndBackup(popup);
    await popup.getByRole('button', { name: 'Import from bookmarks' }).click();

    let full: Page | undefined;
    await expect
      .poll(() => {
        full = context.pages().find((p) => p.url().endsWith(FULL_VIEW_PATH));
        return full !== undefined;
      })
      .toBe(true);
    if (full === undefined) throw new Error('no full view page');
    const button = full.getByRole('button', { name: 'Import from bookmarks' });
    await expect(button).toBeFocused();
    await expect(dialogOn(full)).toHaveCount(0);

    // A real press is the gesture the permission prompt needs.
    await button.click();
    await expect(dialogOn(full)).toBeVisible();
    await expect(
      dialogOn(full).getByRole('checkbox', { name: 'Alpha trip' })
    ).toBeVisible();
    await expect(dialogOn(popup)).toHaveCount(0);
  });
});

const IMPORT_STEP = 'Already keep tabs somewhere?';
const setupOn = (page: Page) =>
  page.getByRole('dialog', { name: 'Make Tab Keeper yours', exact: true });

// A new install's setup, walked to the import step: tabGroups is granted here, so there is no tab groups step.
async function onImportStep(page: Page): Promise<void> {
  const setup = setupOn(page);
  for (let n = 0; n < 4; n++) {
    await setup.getByRole('button', { name: 'Next', exact: true }).click();
  }
  await expect(setup.getByRole('heading', { level: 3 })).toHaveText(
    IMPORT_STEP
  );
}

test.describe('Import from bookmarks in setup (KAN-862)', () => {
  test.beforeEach(async ({ context, serviceWorker }) => {
    await stubToolbarPin(context, { pinned: true });
    await seedSettings(context, { setupState: 'pending' });
    await seedBookmarks(serviceWorker);
  });

  test('the card opens the import over setup; after Import it is back on the same step, pressed, with the session behind', async ({
    context,
    extensionId,
  }) => {
    const page = await openFullView(context, extensionId);
    await onImportStep(page);
    const setup = setupOn(page);
    const card = setup.getByRole('button', { name: 'Chrome bookmarks' });
    await expect(card).toHaveAttribute('aria-pressed', 'false');

    await card.click();
    const dialog = dialogOn(page);
    // A click on a dialog under setup's backdrop would fail: the import sits on top.
    await dialog.getByRole('checkbox', { name: 'Alpha trip' }).check();
    await dialog.getByRole('button', { name: 'Import 1 session' }).click();
    await expect(dialog).toBeHidden();
    // Focus back on the card, not on <body>, where the next Tab reaches setup's ✕.
    await expect(card).toBeFocused();

    await expect(setup).toBeVisible();
    await expect(setup.getByRole('heading', { level: 3 })).toHaveText(
      IMPORT_STEP
    );
    await expect(card).toHaveAttribute('aria-pressed', 'true');
    await expect(card).toHaveAccessibleDescription(
      '1 session imported. Press to import more.'
    );
    await expect
      .poll(async () => (await storedSessions(page)).map((s) => s.title))
      .toEqual(['Alpha trip']);
    await expect(
      page.locator('[data-pane="sessions"]').getByText('Alpha trip')
    ).toBeVisible();

    await setup.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(setup.getByRole('heading', { level: 3 })).toHaveText(
      'Sync across your devices?'
    );
  });

  test('Esc in the import closes only the import: setup stays on the step, nothing imported', async ({
    context,
    extensionId,
  }) => {
    const page = await openFullView(context, extensionId);
    await onImportStep(page);
    const setup = setupOn(page);
    await setup.getByRole('button', { name: 'Chrome bookmarks' }).click();
    const dialog = dialogOn(page);
    await dialog.getByRole('checkbox', { name: 'Alpha trip' }).check();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();

    await expect(setup).toBeVisible();
    await expect(setup.getByRole('heading', { level: 3 })).toHaveText(
      IMPORT_STEP
    );
    await expect(
      setup.getByRole('button', { name: 'Chrome bookmarks' })
    ).toHaveAttribute('aria-pressed', 'false');
    expect(await storedSessions(page)).toEqual([]);
  });
});
