import type { Locator, Page, Worker } from '@playwright/test';

import { expect, grantedTest as test } from './fixtures/grantedExtension';
import { documentLanded } from './fixtures/landed';
import {
  FULL,
  FULL_VIEW_PATH,
  openFullView,
  openPopup,
} from './fixtures/onboarding';
import { stubToolbarPin } from './fixtures/toolbarPin';
import { seedSettings } from './fixtures/seed';
import { localeStrings } from './fixtures/locales';

// KAN-862. Settings › Import › Bookmarks opens the bookmark import dialog. `bookmarks` is made required in the
// scratch manifest, so the full view's ask resolves without a prompt. The real optional-grant prompt on a press is
// checked by hand, not here.
test.use({ grantBookmarks: true });

// Two folders with distinctive names; each has its own link, subfolders that become windows, and one deeper
// folder that folds into its parent window. A third folder is never ticked. Two loose links sit in the bar itself.
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
    await make(bar.id, 'bar-loose-1', 'https://example.com/bar-loose-1');
    const alpha = await fold(bar.id, 'Alpha trip', ['alpha-own']);
    await fold(alpha.id, 'Alpha flights', ['flight-1', 'flight-2']);
    const hotels = await fold(alpha.id, 'Alpha hotels', ['hotel-1']);
    await fold(hotels.id, 'Alpha deep', ['deep-1']);
    const beta = await fold(bar.id, 'Beta research', ['beta-own']);
    await fold(beta.id, 'Beta papers', ['paper-1']);
    await fold(bar.id, 'Gamma untouched', ['gamma-1']);
    await make(bar.id, 'bar-loose-2', 'https://example.com/bar-loose-2');
  });
}

// Chrome names the bar in the browser's language.
const barTitle = (worker: Worker): Promise<string> =>
  worker.evaluate(
    async () =>
      (await chrome.bookmarks.getTree())[0]?.children?.[0]?.title ?? ''
  );

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

async function onImportPane(page: Page): Promise<void> {
  await page.locator('[aria-label="Settings"]').click();
  await page.locator('button[aria-label="Import"]').click();
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
    await onImportPane(page);
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

  // KAN-862 (11-16 13:05). An imported session's date line says where it came from until its contents are edited.
  test('full view: an imported session reads "Imported from bookmarks", and "Edited" once a tab is deleted from it', async ({
    context,
    extensionId,
  }) => {
    const page = await openFullView(context, extensionId);
    await onImportPane(page);
    await page.getByRole('button', { name: 'Import from bookmarks' }).click();
    const dialog = dialogOn(page);
    await dialog.getByRole('checkbox', { name: 'Alpha trip' }).check();
    await dialog.getByRole('checkbox', { name: 'Beta research' }).check();
    await dialog.getByRole('button', { name: 'Import 2 sessions' }).click();
    await expect(dialog).toBeHidden();

    // Reloaded onto the session list.
    await page.reload();
    const dateLine = (title: string) =>
      page
        .locator('[data-pane="sessions"]')
        .getByRole('button', { name: title, exact: true })
        .locator('[aria-description]');
    for (const title of ['Alpha trip', 'Beta research']) {
      await expect(dateLine(title)).toHaveText(/^Imported from bookmarks · /);
      // The hover and the description say it too, with the full date.
      await expect(dateLine(title)).toHaveAttribute(
        'aria-description',
        /^Imported from bookmarks · .*\d{4}/
      );
    }

    await page
      .locator('[data-pane="sessions"]')
      .getByRole('button', { name: 'Alpha trip', exact: true })
      .click();
    const tab = page
      .locator(
        '[data-pane="detail"] [data-drag-row-id]:has([aria-label="Delete tab"])'
      )
      .first();
    await tab.hover();
    await tab.getByRole('button', { name: 'Delete tab' }).click();
    await expect(dateLine('Alpha trip')).toHaveText(/^Edited /);
    await expect(dateLine('Alpha trip')).not.toHaveAttribute(
      'aria-description',
      /Imported/
    );
    await expect(dateLine('Beta research')).toHaveText(
      /^Imported from bookmarks · /
    );
  });

  // KAN-862 (11-16). A top folder is no one session: its loose links are one, and each folder in it is another.
  test('full view: tick the bookmarks bar, Import, and its loose links and each folder in it are saved as sessions', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const bar = await barTitle(serviceWorker);
    expect(bar).not.toBe('');
    const page = await openFullView(context, extensionId);
    await onImportPane(page);
    await page.getByRole('button', { name: 'Import from bookmarks' }).click();

    const dialog = dialogOn(page);
    await dialog.getByRole('checkbox', { name: bar, exact: true }).check();
    for (const name of ['Alpha trip', 'Beta research', 'Gamma untouched'])
      await expect(dialog.getByRole('checkbox', { name })).toBeChecked();
    await dialog.getByRole('button', { name: 'Import 4 sessions' }).click();
    await expect(dialog).toBeHidden();

    await expect
      .poll(async () => (await storedSessions(page)).map((s) => s.title))
      .toEqual([bar, 'Alpha trip', 'Beta research', 'Gamma untouched']);
    expect(
      (await storedSessions(page)).map((s) =>
        s.windows.map((w) => [w.title, w.tabCount])
      )
    ).toEqual([
      [[bar, 2]],
      [
        ['Alpha trip', 1],
        ['Alpha flights', 2],
        ['Alpha hotels', 2],
      ],
      [
        ['Beta research', 1],
        ['Beta papers', 1],
      ],
      [['Gamma untouched', 1]],
    ]);
  });

  // KAN-862 (11-16). What was imported once is left out of the tree on this device, even after a reload (R19).
  test('full view: after a reload an imported folder is gone from the tree; the bar imports the rest, one copy each', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const bar = await barTitle(serviceWorker);
    const page = await openFullView(context, extensionId);
    await onImportPane(page);
    await page.getByRole('button', { name: 'Import from bookmarks' }).click();
    const dialog = dialogOn(page);
    await dialog.getByRole('checkbox', { name: 'Alpha trip' }).check();
    await dialog.getByRole('button', { name: 'Import 1 session' }).click();
    await expect(dialog).toBeHidden();
    await expect
      .poll(async () => (await storedSessions(page)).map((s) => s.title))
      .toEqual(['Alpha trip']);

    await page.reload();
    await onImportPane(page);
    await page.getByRole('button', { name: 'Import from bookmarks' }).click();
    await expect(
      dialog.getByRole('checkbox', { name: 'Beta research' })
    ).toBeVisible();
    await expect(
      dialog.getByRole('checkbox', { name: 'Alpha trip' })
    ).toHaveCount(0);

    await dialog.getByRole('checkbox', { name: bar, exact: true }).check();
    await dialog.getByRole('button', { name: 'Import 3 sessions' }).click();
    await expect(dialog).toBeHidden();

    await expect
      .poll(async () => (await storedSessions(page)).map((s) => s.title))
      .toEqual([bar, 'Beta research', 'Gamma untouched', 'Alpha trip']);
  });

  // KAN-862 R20, R22, R23. With everything imported a press only toasts; a link added to the bar later brings the bar back.
  test('full view: Select all imports everything; a press then opens no dialog and a toast says so; a link added to the bar later is importable', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const bar = await barTitle(serviceWorker);
    const page = await openFullView(context, extensionId);
    await onImportPane(page);
    const importButton = page.getByRole('button', {
      name: 'Import from bookmarks',
    });
    await importButton.click();
    const dialog = dialogOn(page);
    await dialog.getByRole('button', { name: 'Select all' }).click();
    await expect(
      dialog.getByRole('button', { name: 'Deselect all' })
    ).toBeVisible();
    await dialog.getByRole('button', { name: 'Import 4 sessions' }).click();
    await expect(dialog).toBeHidden();

    // R23: nothing left, so the press opens no dialog; a toast says so, and focus stays on the button.
    await importButton.click();
    await expect(
      page.getByText('Everything in your bookmarks is already imported.')
    ).toBeVisible();
    await expect(dialog).toHaveCount(0);
    await expect(importButton).toBeFocused();

    await serviceWorker.evaluate(async () => {
      const [root] = await chrome.bookmarks.getTree();
      const barId = root.children?.[0]?.id;
      if (barId === undefined) throw new Error('no bookmarks bar');
      await chrome.bookmarks.create({
        parentId: barId,
        title: 'bar-loose-3',
        url: 'https://example.com/bar-loose-3',
      });
    });
    await importButton.click();
    await dialog.getByRole('checkbox', { name: bar, exact: true }).check();
    await dialog.getByRole('button', { name: 'Import 1 session' }).click();
    await expect(dialog).toBeHidden();

    await expect
      .poll(async () =>
        (await storedSessions(page)).map((s) => [
          s.title,
          s.windows.map((w) => w.tabCount),
        ])
      )
      .toEqual([
        [bar, [1]],
        [bar, [2]],
        ['Alpha trip', [1, 2, 2]],
        ['Beta research', [1, 1]],
        ['Gamma untouched', [1]],
      ]);
  });

  // KAN-862 R25. A folder counts as imported only while its session is saved: deleting it frees the folder, restoring it takes it back.
  test('full view: deleting an imported session puts its folder back in the tree; restoring it leaves nothing to import', async ({
    context,
    extensionId,
  }) => {
    const page = await openFullView(context, extensionId);
    await onImportPane(page);
    const importButton = page.getByRole('button', {
      name: 'Import from bookmarks',
    });
    const nothingLeft = page.getByText(
      'Everything in your bookmarks is already imported.'
    );
    await importButton.click();
    const dialog = dialogOn(page);
    await dialog.getByRole('button', { name: 'Select all' }).click();
    await dialog.getByRole('button', { name: 'Import 4 sessions' }).click();
    await expect(dialog).toBeHidden();
    // PREMISE: with everything imported, a press only says so.
    await importButton.click();
    await expect(nothingLeft).toBeVisible();
    await expect(dialog).toHaveCount(0);

    // Reloaded so that toast is gone; then Delete on the focused row, as recently-deleted.spec does.
    await page.reload();
    const alphaRow = page
      .locator('[data-pane="sessions"]')
      .getByRole('button', { name: 'Alpha trip', exact: true });
    await alphaRow.focus();
    await page.keyboard.press('Delete');
    await expect(alphaRow).toHaveCount(0);

    await onImportPane(page);
    await importButton.click();
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole('checkbox', { name: 'Alpha trip' })
    ).toBeVisible();
    await expect(
      dialog.getByRole('checkbox', { name: 'Beta research' })
    ).toHaveCount(0);
    await expect(nothingLeft).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();

    await page
      .getByRole('button', { name: 'Recently deleted', exact: true })
      .click();
    await page.getByRole('button', { name: 'Restore Alpha trip' }).click();
    await expect
      .poll(async () => (await storedSessions(page)).map((s) => s.title))
      .toContain('Alpha trip');
    await page.locator('button[aria-label="Import"]').click();
    await importButton.click();
    await expect(nothingLeft).toBeVisible();
    await expect(dialog).toHaveCount(0);
  });

  test('full view: Cancel closes the dialog and saves nothing', async ({
    context,
    extensionId,
  }) => {
    const page = await openFullView(context, extensionId);
    await onImportPane(page);
    await page.getByRole('button', { name: 'Import from bookmarks' }).click();
    const dialog = dialogOn(page);
    await dialog.getByRole('checkbox', { name: 'Alpha trip' }).check();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
    expect(await storedSessions(page)).toEqual([]);
  });

  test('popup: the button opens a full view on Settings › Import with Import from bookmarks focused, and a press opens the dialog', async ({
    context,
    extensionId,
  }) => {
    const popup = await openPopup(context, extensionId);
    await onImportPane(popup);
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
    // On Settings › Import: its one section, and nothing of Sync & backup.
    await expect(full.getByText('Bookmarks', { exact: true })).toBeVisible();
    await expect(full.getByRole('group', { name: 'Auto sync' })).toHaveCount(0);
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
    await documentLanded(page);
  }
  await expect(setup.getByRole('heading', { level: 3 })).toHaveText(
    IMPORT_STEP
  );
}

const LINE =
  'Turn bookmark folders into saved sessions. Your bookmarks stay as they are.';
const SMALL_PRINT = 'You can also import from Settings › Import.';
// Setup's button shares its words with Settings' button and the import dialog's title.
const importButtonIn = (setup: Locator, name = 'Import from bookmarks') =>
  setup.getByRole('button', { name, exact: true });

test.describe('Import from bookmarks in setup (KAN-862)', () => {
  test.beforeEach(async ({ context, serviceWorker }) => {
    await stubToolbarPin(context, { pinned: true });
    await seedSettings(context, { setupState: 'pending' });
    await seedBookmarks(serviceWorker);
  });

  test('the button opens the import over setup; after Import it is back on the same step, Import more, with the session behind', async ({
    context,
    extensionId,
  }) => {
    const page = await openFullView(context, extensionId);
    await onImportStep(page);
    const setup = setupOn(page);
    await importButtonIn(setup).click();
    const dialog = dialogOn(page);
    // A click on a dialog under setup's backdrop would fail: the import sits on top.
    await dialog.getByRole('checkbox', { name: 'Alpha trip' }).check();
    await dialog.getByRole('button', { name: 'Import 1 session' }).click();
    await expect(dialog).toBeHidden();
    // Focus back on the button, not on <body>, where the next Tab reaches setup's ✕.
    const more = importButtonIn(setup, 'Import more');
    await expect(more).toBeFocused();

    await expect(setup).toBeVisible();
    await expect(setup.getByRole('heading', { level: 3 })).toHaveText(
      IMPORT_STEP
    );
    const imported = setup.getByText('1 session imported.', { exact: true });
    await expect(imported).toBeVisible();
    await expect(more).toHaveAccessibleDescription('1 session imported.');
    await expect
      .poll(async () => (await storedSessions(page)).map((s) => s.title))
      .toEqual(['Alpha trip']);
    await expect(
      page.locator('[data-pane="sessions"]').getByText('Alpha trip')
    ).toBeVisible();

    await setup.getByRole('button', { name: 'Next', exact: true }).click();
    await documentLanded(page);
    await expect(setup.getByRole('heading', { level: 3 })).toHaveText(
      'Sync across your devices?'
    );
  });

  // KAN-862. No card: the line, the button and the small print start where the step heading does,
  // before an import and after it, when the line and the button have new words.
  test('the heading, the line, the button and the small print share one left edge, before and after an import', async ({
    context,
    extensionId,
  }) => {
    const page = await openFullView(context, extensionId);
    await onImportStep(page);
    const setup = setupOn(page);
    const left = async (locator: Locator) => {
      const box = await locator.boundingBox();
      if (box === null) throw new Error('not laid out');
      return box.x;
    };
    const edge = await left(setup.getByRole('heading', { level: 3 }));
    const shareTheEdge = async (line: string, button: string) => {
      for (const part of [
        setup.getByText(line, { exact: true }),
        importButtonIn(setup, button),
        setup.getByText(SMALL_PRINT, { exact: true }),
      ])
        expect(Math.abs((await left(part)) - edge)).toBeLessThanOrEqual(1);
    };
    await shareTheEdge(LINE, 'Import from bookmarks');

    await importButtonIn(setup).click();
    const dialog = dialogOn(page);
    await dialog.getByRole('checkbox', { name: 'Alpha trip' }).check();
    await dialog.getByRole('button', { name: 'Import 1 session' }).click();
    await expect(dialog).toBeHidden();
    await expect(left(setup.getByRole('heading', { level: 3 }))).resolves.toBe(
      edge
    );
    await shareTheEdge('1 session imported.', 'Import more');
  });

  // KAN-862. German's line before an import takes two lines at this width and its later lines take one,
  // so the line has to hold the tallest one's room or the button just focused and the small print jump up.
  test('in German the line, the button and the small print stay put through an import and a press with nothing left', async ({
    context,
    extensionId,
  }) => {
    const de = localeStrings('de');
    await seedSettings(context, { setupState: 'pending', language: 'de' });
    // openFullView waits for an English label.
    const page = await context.newPage();
    await page.setViewportSize(FULL);
    await page.goto(`chrome-extension://${extensionId}/${FULL_VIEW_PATH}`);
    const setup = page.getByRole('dialog', {
      name: de['Make Tab Keeper yours'],
      exact: true,
    });
    for (let n = 0; n < 4; n++) {
      await setup.getByRole('button', { name: de.Next, exact: true }).click();
      await documentLanded(page);
    }
    await expect(setup.getByRole('heading', { level: 3 })).toHaveText(
      de[IMPORT_STEP]
    );
    const top = async (locator: Locator) => {
      await expect(locator).toBeVisible();
      const box = await locator.boundingBox();
      if (box === null) throw new Error('not laid out');
      return box.y;
    };
    const smallPrint = setup.getByText(de[SMALL_PRINT], { exact: true });
    const tops = async (line: string, button: string) => [
      await top(setup.getByText(line, { exact: true })),
      await top(importButtonIn(setup, button)),
      await top(smallPrint),
    ];
    const lineBefore = setup.getByText(de[LINE], { exact: true });
    // CONTROL: the line wraps here, so a line that shrinks after an import would move what is under it.
    const lineCount = await lineBefore.evaluate((el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      return new Set([...range.getClientRects()].map((r) => Math.round(r.top)))
        .size;
    });
    expect(lineCount).toBe(2);
    const before = await tops(de[LINE], de['Import from bookmarks']);

    await importButtonIn(setup, de['Import from bookmarks']).click();
    const dialog = page.getByRole('dialog', {
      name: de['Import from bookmarks'],
    });
    await dialog.getByRole('button', { name: de['Select all'] }).click();
    await dialog
      .getByRole('button', {
        name: de.ImportSessions_other.replace('{{count}}', '4'),
      })
      .click();
    await expect(dialog).toBeHidden();
    const more = importButtonIn(setup, de['Import more']);
    await expect(more).toBeFocused();
    expect(
      await tops(
        de.SessionsImportedInSetup_other.replace('{{count}}', '4'),
        de['Import more']
      )
    ).toEqual(before);

    await more.click();
    expect(
      await tops(
        de['Everything in your bookmarks is already imported.'],
        de['Import more']
      )
    ).toEqual(before);
  });

  test('Esc in the import closes only the import: setup stays on the step, focus on the button, nothing imported', async ({
    context,
    extensionId,
  }) => {
    const page = await openFullView(context, extensionId);
    await onImportStep(page);
    const setup = setupOn(page);
    await importButtonIn(setup).click();
    const dialog = dialogOn(page);
    await dialog.getByRole('checkbox', { name: 'Alpha trip' }).check();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();

    await expect(setup).toBeVisible();
    await expect(setup.getByRole('heading', { level: 3 })).toHaveText(
      IMPORT_STEP
    );
    await expect(importButtonIn(setup)).toBeFocused();
    await expect(setup.getByText(LINE, { exact: true })).toBeVisible();
    expect(await storedSessions(page)).toEqual([]);
  });

  // KAN-862 R23. Toasts sit under setup's backdrop, so with nothing left the block's line says so.
  test('with everything imported, a press opens no import: the button stays focused, the line says so', async ({
    context,
    extensionId,
  }) => {
    const page = await openFullView(context, extensionId);
    await onImportStep(page);
    const setup = setupOn(page);
    await importButtonIn(setup).click();
    const dialog = dialogOn(page);
    await dialog.getByRole('button', { name: 'Select all' }).click();
    await dialog.getByRole('button', { name: 'Import 4 sessions' }).click();
    await expect(dialog).toBeHidden();

    const more = importButtonIn(setup, 'Import more');
    await more.click();

    const nothingLeft = 'Everything in your bookmarks is already imported.';
    await expect(setup.getByText(nothingLeft, { exact: true })).toBeVisible();
    await expect(more).toHaveAccessibleDescription(nothingLeft);
    await expect(more).toBeFocused();
    await expect(dialog).toHaveCount(0);
    await expect(setup.getByRole('heading', { level: 3 })).toHaveText(
      IMPORT_STEP
    );
  });
});
