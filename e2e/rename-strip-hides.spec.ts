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
