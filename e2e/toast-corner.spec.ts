import type { Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { FULL, FULL_VIEW_PATH, openPage } from './fixtures/onboarding';

// KAN-574. Toasts sit bottom-left on every page; Settings used to put them bottom-right.
// There they stay inside the category column, so they never cover the pane beside it.

const toast = (page: Page) => page.locator('[role="status"] [data-toast]');
const POPUP = { width: 790, height: 550 };

// Where the toast's box sits from the window's left and bottom edges, once it has finished arriving.
async function corner(page: Page) {
  await toast(page).evaluate((el) =>
    Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished))
  );
  const box = await toast(page).boundingBox();
  if (box === null) throw new Error('no toast drawn');
  const viewport = page.viewportSize();
  if (viewport === null) throw new Error('no viewport');
  return {
    left: box.x,
    right: viewport.width - (box.x + box.width),
    bottom: viewport.height - (box.y + box.height),
  };
}

// KAN-579. The popup's Settings can no longer raise a toast (the bad backup file is the full view's), so the
// popup's 790x550 window is measured with a full view at that size: the same Settings layout.
for (const [view, path, size] of [
  ["full view at the popup's size", FULL_VIEW_PATH, POPUP],
  ['full view', FULL_VIEW_PATH, FULL],
] as const) {
  test(`${view}: a toast on Settings sits bottom-left, as on home`, async ({
    context,
    extensionId,
  }) => {
    const page = await openPage(context, extensionId, path, size);

    // CONTROL: home's corner.
    await page.evaluate(async () => {
      const own = chrome.runtime.getURL('');
      const tabs = await chrome.tabs.query({});
      const others = tabs.filter((t) => !(t.url ?? '').startsWith(own));
      await chrome.tabs.remove(others.flatMap((t) => (t.id ? [t.id] : [])));
    });
    await page
      .getByRole('button', {
        name: 'Save all open windows as a session',
        exact: true,
      })
      .first()
      .click();
    await expect(toast(page)).toBeVisible();
    const home = await corner(page);
    expect(home.left).toBe(20);
    expect(home.bottom).toBe(20);
    // Gone on its own timer, so the one toast measured on Settings is that page's.
    await expect(toast(page)).toHaveCount(0, { timeout: 15_000 });

    // Settings: a file that is not a backup raises the import error toast.
    await page.locator('[aria-label="Settings"]').click();
    await page.locator('button[aria-label="Sync & backup"]').click();
    const chooser = page.waitForEvent('filechooser');
    await page
      .getByRole('button', { name: 'Load sessions from a backup' })
      .click();
    await (
      await chooser
    ).setFiles({
      name: 'not-a-backup.json',
      mimeType: 'application/json',
      buffer: Buffer.from('not json'),
    });
    // KAN-618. Our own sentence, with its full stop, not the parser's message.
    await expect(toast(page)).toHaveText(
      'Error restoring tabs: The file is not valid JSON.'
    );
    const settings = await corner(page);
    expect(settings.left).toBe(20);
    expect(settings.bottom).toBe(20);
    const column = await page.locator('[data-pane="sessions"]').boundingBox();
    if (column === null) throw new Error('no settings column');
    const box = await toast(page).boundingBox();
    if (box === null) throw new Error('no toast drawn');
    // As far inside the column's right edge as the toast is from the window's left.
    expect(column.x + column.width - (box.x + box.width)).toBeCloseTo(20, 0);
  });
}
