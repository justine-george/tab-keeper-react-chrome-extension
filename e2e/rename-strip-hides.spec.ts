import { grantedTest as test, expect } from './fixtures/grantedExtension';
import {
  header,
  openSaved,
  savedWindow,
  session,
} from './fixtures/savedWindows';

// KAN-724. The field under the pointer goes with Enter, so the pointer leaving at that moment sends no mouseout.
test('a window row hides its strip when the pointer leaves as Enter ends a rename', async ({
  context,
  extensionId,
}) => {
  const page = await openSaved(context, extensionId, 'tab view', {
    sessions: [session('S1', 'Trip', [savedWindow('w1', 'Current flow', 4)])],
  });
  const row = header(page, 'w1');
  const strip = row.locator('[data-row-actions] > :last-child');
  const box = await row.boundingBox();
  if (box === null) throw new Error('no row');
  await page.mouse.move(box.x + 40, box.y + box.height / 2);
  await expect(strip).toHaveCSS('opacity', '1');
  await page
    .getByRole('button', { name: 'Rename window: Current flow', exact: true })
    .click();
  await page.locator('input:focus').fill('Flow');

  await Promise.all([page.keyboard.press('Enter'), page.mouse.move(0, 0)]);

  await expect(
    page.getByRole('button', { name: 'Rename window: Flow', exact: true })
  ).toBeVisible();
  await expect(strip).toHaveCSS('opacity', '0');
});

// KAN-927. The same gap on the two other rows that kept their hover in React.
test('a saved tab row hides its actions when the pointer leaves as Enter ends a rename', async ({
  context,
  extensionId,
}) => {
  const page = await openSaved(context, extensionId, 'tab view', {
    sessions: [session('S1', 'Trip', [savedWindow('w1', 'Flow', 3)])],
  });
  const rowOf = (name: RegExp) =>
    page
      .getByRole('button', { name })
      .first()
      .locator('xpath=ancestor::*[@data-drag-handle-row][1]');
  const row = rowOf(/Page w1\.1/);
  await row.hover();
  await row.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Rename tab', exact: true }).click();
  const field = page.locator('input:focus');
  await field.hover();
  await field.fill('Renamed');

  await Promise.all([page.keyboard.press('Enter'), page.mouse.move(0, 0)]);

  const renamed = rowOf(/Renamed/);
  await renamed.waitFor();
  // Off the keyboard reveal: only a stuck hover still shows them.
  await page.evaluate(() => (document.activeElement as HTMLElement).blur());
  await expect(renamed.locator('[data-row-actions] > :last-child')).toHaveCSS(
    'opacity',
    '0'
  );
});

test('the session card hides its action when the pointer leaves as Enter ends a rename', async ({
  context,
  extensionId,
}) => {
  const page = await openSaved(context, extensionId, 'popup', {
    sessions: [session('S1', 'Trip', [savedWindow('w1', 'Flow', 3)])],
  });
  const action = page.locator('[data-pane-layer="saved-title-action"]').first();
  const box = await page.locator('[data-panel="session-card"]').boundingBox();
  if (box === null) throw new Error('no card');
  await page.mouse.move(box.x + 60, box.y + 20);
  await expect(action).toHaveCSS('opacity', '1');
  await page
    .getByRole('button', { name: 'Rename session: Trip', exact: true })
    .click();
  const field = page.locator('input:focus');
  await field.hover();
  await field.fill('Trip2');

  await Promise.all([page.keyboard.press('Enter'), page.mouse.move(0, 0)]);

  await page
    .getByRole('button', { name: 'Rename session: Trip2', exact: true })
    .waitFor({ state: 'attached' });
  await page.evaluate(() => (document.activeElement as HTMLElement).blur());
  await expect(action).toHaveCSS('opacity', '0');
});

test('CONTROL: a plain hover and leave still shows and hides a tab row actions', async ({
  context,
  extensionId,
}) => {
  const page = await openSaved(context, extensionId, 'tab view', {
    sessions: [session('S1', 'Trip', [savedWindow('w1', 'Flow', 3)])],
  });
  const row = page
    .getByRole('button', { name: /Page w1\.1/ })
    .first()
    .locator('xpath=ancestor::*[@data-drag-handle-row][1]');
  const actions = row.locator('[data-row-actions] > :last-child');
  await row.hover();
  await expect(actions).toHaveCSS('opacity', '1');
  await page.mouse.move(0, 0);
  await expect(actions).toHaveCSS('opacity', '0');
});

// KAN-927. React's enter comes from the native mouseout, before the old row's native mouseleave.
test('moving straight from one tab row to the next keeps the next row actions', async ({
  context,
  extensionId,
}) => {
  const page = await openSaved(context, extensionId, 'tab view', {
    sessions: [session('S1', 'Trip', [savedWindow('w1', 'Flow', 3)])],
  });
  const rowOf = (name: RegExp) =>
    page
      .getByRole('button', { name })
      .first()
      .locator('xpath=ancestor::*[@data-drag-handle-row][1]');
  await rowOf(/Page w1\.1/).hover();
  await expect(
    rowOf(/Page w1\.1/).locator('[data-row-actions] > :last-child')
  ).toHaveCSS('opacity', '1');

  await rowOf(/Page w1\.2/).hover();

  await expect(
    rowOf(/Page w1\.2/).locator('[data-row-actions] > :last-child')
  ).toHaveCSS('opacity', '1');
  await expect(
    rowOf(/Page w1\.1/).locator('[data-row-actions] > :last-child')
  ).toHaveCSS('opacity', '0');
});
