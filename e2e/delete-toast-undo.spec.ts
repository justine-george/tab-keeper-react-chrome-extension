import type { Locator, Page } from '@playwright/test';

import { grantedTest as test, expect } from './fixtures/grantedExtension';
import {
  bandHandle,
  groupedWindow,
  header,
  openSaved,
  savedWindow,
  session,
  stored,
} from './fixtures/savedWindows';

// KAN-640, KAN-641 on the real artifact. Deleting a tab group says so in a
// toast; window, tab and tab group delete toasts offer Undo, which puts the
// deleted part back and closes the toast, as "Session deleted." does (KAN-583).

const TRIP = session('S1', 'Trip', [
  groupedWindow('gw', 'Grouped', [
    { groupId: 'gr', title: 'Booked', color: 'blue' },
  ]),
  savedWindow('w2', 'Reading', 2),
]);

const toasts = (page: Page): Locator =>
  page.locator('[role="status"] > [data-toast]:not([aria-hidden="true"])');
const undoButton = (page: Page): Locator =>
  page.getByRole('status').getByRole('button', { name: 'Undo', exact: true });

// Each window's tab ids and group ids, as stored.
const shape = async (page: Page) =>
  (await stored(page)).tabGroups
    .find((g) => g.tabGroupId === 'S1')
    ?.windows.map((w) => ({
      windowId: w.windowId,
      tabIds: w.tabs.map((t) => t.tabId),
      groupIds: (w.chromeTabGroups ?? []).map((g) => g.groupId),
    }));

async function expectUndoPutsBack(
  page: Page,
  before: Awaited<ReturnType<typeof shape>>,
  text: string
): Promise<void> {
  await expect(toasts(page)).toHaveCount(1);
  await expect(toasts(page)).toContainText(text);
  // PREMISE: the delete reached storage.
  await expect.poll(() => shape(page)).not.toEqual(before);

  await undoButton(page).click();

  await expect.poll(() => shape(page)).toEqual(before);
  await expect(toasts(page)).toHaveCount(0);
}

test('Delete tab group says so, and Undo brings the group and its tabs back', async ({
  context,
  extensionId,
}) => {
  const page = await openSaved(context, extensionId, 'popup', {
    sessions: [TRIP],
  });
  const before = await shape(page);
  const band = bandHandle(page, 'gr');
  await band.hover();
  await band.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Delete tab group' }).click();

  await expectUndoPutsBack(page, before, 'Session tab group deleted.');
});

test('Delete window offers Undo, which brings the window back', async ({
  context,
  extensionId,
}) => {
  const page = await openSaved(context, extensionId, 'popup', {
    sessions: [TRIP],
  });
  const before = await shape(page);
  const head = header(page, 'w2');
  await head.hover();
  await head.getByRole('button', { name: /^More actions/ }).click();
  await page.getByRole('menuitem', { name: 'Delete window' }).click();

  await expectUndoPutsBack(page, before, 'Session window deleted.');
});

test('Delete tab offers Undo, which brings the tab back', async ({
  context,
  extensionId,
}) => {
  const page = await openSaved(context, extensionId, 'popup', {
    sessions: [TRIP],
  });
  const before = await shape(page);
  const row = page.locator('[data-pane="detail"] [data-drag-row-id="w2-t0"]');
  await row.hover();
  await row.getByRole('button', { name: 'Delete tab' }).click();

  await expectUndoPutsBack(page, before, 'Session tab deleted.');
});
