import type { Locator, Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { seedSettings } from './fixtures/seed';
import {
  openSaved,
  savedWindow,
  session,
  stored,
} from './fixtures/savedWindows';
import { focusConfirm } from './fixtures/sessionActions';

// KAN-582 (pick A + guarded reveal, 2s). On the built artifact, with a real mouse: Chrome's own
// pointer events when the strip appears under a resting pointer must not arm the button under it.

const SESSIONS = [
  session('S1', 'Q4 product roadmap', [savedWindow('a1', '', 3)]),
  session('S2', 'Movie night', [savedWindow('b1', '', 2)]),
  session('S3', 'Weekend in Kyoto', [savedWindow('c1', '', 2)]),
  session('S4', 'Onboarding redesign', [savedWindow('d1', '', 2)]),
];

test.beforeEach(async ({ context }) => {
  await seedSettings(context, {});
});

const row = (page: Page, id: string) =>
  page.locator(`[data-pane="sessions"] [data-drag-row-id="${id}"]`);
const actions = (page: Page, id: string) =>
  row(page, id).locator('[data-row-actions]');
const button = (page: Page, id: string, name: string) =>
  actions(page, id).getByRole('button', { name, exact: true });
const shownTitle = (page: Page) => page.locator('[data-tour-anchor="title"]');

async function centreOf(target: Locator) {
  const box = await target.boundingBox();
  if (box === null) throw new Error('no box');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

// The pointer comes to rest at the row's middle, where people click.
async function restOnMiddle(page: Page, id: string) {
  const { x, y } = await centreOf(row(page, id));
  await page.mouse.move(x, y, { steps: 4 });
  return { x, y };
}

test('only the shown session has its actions; another row has none on hover until 2s on it', async ({
  context,
  extensionId,
}) => {
  const page = await openSaved(context, extensionId, 'popup', {
    sessions: SESSIONS,
  });
  await expect(actions(page, 'S1')).toHaveCount(1);
  await expect(actions(page, 'S3')).toHaveCount(0);

  await restOnMiddle(page, 'S3');
  await page.waitForTimeout(1000);
  await expect(actions(page, 'S3')).toHaveCount(0);
  await expect(button(page, 'S3', 'Switch')).toBeVisible({ timeout: 3000 });

  await page.mouse.move(0, 0, { steps: 4 });
  await expect(actions(page, 'S3')).toHaveCount(0);
});

test('revealed under the resting pointer: the press selects the row; after leaving that button, it acts', async ({
  context,
  extensionId,
}) => {
  const page = await openSaved(context, extensionId, 'popup', {
    sessions: SESSIONS,
  });
  const at = await restOnMiddle(page, 'S3');
  await expect(button(page, 'S3', 'Switch')).toBeVisible({ timeout: 3000 });
  // The premise: the strip appeared with Switch under the pointer.
  const under = await page.evaluate(
    ({ x, y }) =>
      document
        .elementFromPoint(x, y)
        ?.closest('[role="button"]')
        ?.getAttribute('aria-label') ?? null,
    at
  );
  expect(under).toBe('Switch');

  await page.mouse.down();
  await page.mouse.up();
  await expect(shownTitle(page)).toHaveText('Weekend in Kyoto');
  await expect(focusConfirm(page)).toHaveCount(0);

  const open = await centreOf(button(page, 'S3', 'Open'));
  await page.mouse.move(open.x, open.y, { steps: 4 });
  await page.mouse.move(at.x, at.y, { steps: 4 });
  await page.mouse.down();
  await page.mouse.up();
  await expect(focusConfirm(page)).toBeVisible();
});

test('revealed: a button the pointer moves onto acts at once', async ({
  context,
  extensionId,
}) => {
  const page = await openSaved(context, extensionId, 'popup', {
    sessions: SESSIONS,
  });
  await restOnMiddle(page, 'S3');
  await button(page, 'S3', 'Delete').click({ timeout: 3000 });

  await expect
    .poll(async () => (await stored(page)).tabGroups.map((s) => s.tabGroupId))
    .toEqual(['S1', 'S2', 'S4']);
});

test('a double-click at the middle of another row selects it and presses nothing', async ({
  context,
  extensionId,
}) => {
  const page = await openSaved(context, extensionId, 'popup', {
    sessions: SESSIONS,
  });
  const { x, y } = await restOnMiddle(page, 'S4');
  await page.mouse.dblclick(x, y);

  await expect(shownTitle(page)).toHaveText('Onboarding redesign');
  await expect(button(page, 'S4', 'Switch')).toBeVisible();
  await expect(focusConfirm(page)).toHaveCount(0);
  expect((await stored(page)).tabGroups).toHaveLength(4);
});

test('the shown session: the pointer arriving on its Delete deletes at the first press', async ({
  context,
  extensionId,
}) => {
  const page = await openSaved(context, extensionId, 'popup', {
    sessions: SESSIONS,
  });
  await button(page, 'S1', 'Delete').click();

  await expect
    .poll(async () => (await stored(page)).tabGroups.map((s) => s.tabGroupId))
    .toEqual(['S2', 'S3', 'S4']);
});
