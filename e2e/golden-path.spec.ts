import { test, expect } from './fixtures/extension';

test('the extension loads and its popup renders', async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/index.html`);

  await expect(page.locator('input#name')).toBeVisible();
});
