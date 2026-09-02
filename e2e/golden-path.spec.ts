import { test, expect } from './fixtures/extension';
import { seedSessions } from './fixtures/seed';

test('the extension loads and its popup renders', async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/index.html`);

  await expect(page.locator('input#name')).toBeVisible();
});

test('seeded sessions reach localStorage before the app boots', async ({
  context,
  extensionId,
}) => {
  await seedSessions(context);
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/index.html`);

  await expect(page.getByText('Research').first()).toBeVisible();
});
