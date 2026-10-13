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

// KAN-582 (picks: A without the reveal; Delete only in the header's ⋮). On the built artifact,
// with a real mouse: Chrome's own pointer events when the strip appears under a resting pointer
// must not arm the button under it.

const SESSIONS = [
  session('S1', 'Q4 product roadmap', [savedWindow('a1', '', 3)]),
  session('S2', 'Movie night', [savedWindow('b1', '', 2)]),
  session('S3', 'Weekend in Kyoto', [savedWindow('c1', '', 2)]),
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
const nameUnder = (page: Page, at: { x: number; y: number }) =>
  page.evaluate(
    ({ x, y }) =>
      document
        .elementFromPoint(x, y)
        ?.closest('[role="button"]')
        ?.getAttribute('aria-label') ?? null,
    at
  );

test('only the session shown has row actions, Open, Switch and Replace; another row has none however long it is hovered', async ({
  context,
  extensionId,
}) => {
  const page = await openSaved(context, extensionId, 'popup', {
    sessions: SESSIONS,
  });
  await expect(actions(page, 'S1').getByRole('button')).toHaveText([
    /Open/,
    /Switch/,
    /Replace/,
  ]);

  const { x, y } = await centreOf(row(page, 'S3'));
  await page.mouse.move(x, y, { steps: 4 });
  await page.waitForTimeout(3000);
  await expect(actions(page, 'S3')).toHaveCount(0);
});

test('a double-click on another row, where its Switch will appear, selects it and presses nothing; leaving Switch and coming back presses it', async ({
  context,
  extensionId,
}) => {
  const page = await openSaved(context, extensionId, 'popup', {
    sessions: SESSIONS,
  });
  // Every row's strip sits at the same x: aim at S3 where S1's Switch is.
  const sw = await centreOf(button(page, 'S1', 'Switch'));
  const at = { x: sw.x, y: (await centreOf(row(page, 'S3'))).y };
  await page.mouse.move(at.x, at.y, { steps: 4 });
  await page.mouse.dblclick(at.x, at.y);

  await expect(shownTitle(page)).toHaveText('Weekend in Kyoto');
  // The premise: the strip appeared with Switch under the pointer.
  expect(await nameUnder(page, at)).toBe('Switch');
  // A double-click can land both clicks before the strip is drawn, so press once more, unmoved.
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(300);
  await expect(focusConfirm(page)).toHaveCount(0);

  const open = await centreOf(button(page, 'S3', 'Open'));
  await page.mouse.move(open.x, open.y, { steps: 4 });
  await page.mouse.move(at.x, at.y, { steps: 4 });
  await page.mouse.down();
  await page.mouse.up();
  await expect(focusConfirm(page)).toBeVisible();
});

test('the shown session: the pointer arriving on its Replace replaces at the first press', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  const page = await openSaved(context, extensionId, 'popup', {
    sessions: SESSIONS,
  });
  const before = (await stored(page)).tabGroups[0].windows;
  await serviceWorker.evaluate(() =>
    chrome.windows.create({ url: 'data:text/html,<title>Open A</title>' })
  );
  await button(page, 'S1', 'Replace').click();

  await expect
    .poll(async () => (await stored(page)).tabGroups[0].windows)
    .not.toEqual(before);
});

test('Delete is not on the row; the session header’s ⋮ deletes the session shown', async ({
  context,
  extensionId,
}) => {
  const page = await openSaved(context, extensionId, 'popup', {
    sessions: SESSIONS,
  });
  await expect(button(page, 'S1', 'Delete')).toHaveCount(0);

  await page
    .locator('[data-pane="detail"] [data-tour-anchor="session-menu"]')
    .getByRole('button', { name: 'More actions' })
    .click();
  await page.getByRole('menuitem', { name: 'Delete session' }).click();

  await expect
    .poll(async () => (await stored(page)).tabGroups.map((s) => s.tabGroupId))
    .toEqual(['S2', 'S3']);
});
