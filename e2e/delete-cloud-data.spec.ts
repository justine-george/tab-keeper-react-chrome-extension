import { test, expect } from './fixtures/extension';
import { buildContainer, seedSessions } from './fixtures/seed';

// KAN-254. "Delete cloud data" on Sync & Backup opens a confirm dialog; Cancel
// and Escape close it with nothing changed. The confirm path is unit-only: CI
// builds without a cloud (KAN-147), and a local run would delete a document
// in the real project.

test.describe('Delete cloud data asks before it acts (KAN-254)', () => {
  test('the button opens a real dialog; Cancel and Escape close it, auto sync untouched', async ({
    context,
    extensionId,
  }) => {
    await seedSessions(context, buildContainer());
    const page = await context.newPage();
    await page.setViewportSize({ width: 790, height: 550 });
    await page.goto(`chrome-extension://${extensionId}/index.html`);
    await page.locator('[aria-label="Settings"]').click();
    await page.locator('button[aria-label="Sync & Backup"]').click();

    const button = page.getByRole('button', { name: 'Delete cloud data' });
    await expect(button).toBeVisible();
    await button.click();

    const dialog = page.getByRole('dialog', {
      name: 'Delete your cloud data?',
    });
    await expect(dialog).toBeVisible();
    // Modal: showModal() put it in the top layer.
    expect(await dialog.evaluate((el) => (el as HTMLDialogElement).open)).toBe(
      true
    );
    // Focus landed on Cancel, the action that changes nothing.
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();

    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toHaveCount(0);

    await button.click();
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);

    const on = page
      .getByRole('group', { name: 'Auto Sync' })
      .getByRole('button', { name: 'On' });
    await expect(on).toHaveAttribute('aria-pressed', 'true');
  });
});
