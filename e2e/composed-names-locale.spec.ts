import { test, expect } from './fixtures/extension';
import { savedWindow, session, openSaved } from './fixtures/savedWindows';

// KAN-307. A built name takes its punctuation from the locale, where the page really renders it.
test('Japanese names use the full-width colon and comma', async ({
  context,
  extensionId,
}) => {
  const page = await openSaved(context, extensionId, 'tab view', {
    sessions: [session('S1', '旅行', [savedWindow('w1', '', 2)])],
    settings: { language: 'ja' },
  });

  await expect(
    page.getByRole('button', {
      name: 'ウィンドウの名前を変更：ウィンドウ 1',
      exact: true,
    })
  ).toBeVisible();

  await page.setViewportSize({ width: 1024, height: 700 });

  await expect(
    page.locator('button[aria-expanded][aria-label^="現在開いているタブ"]')
  ).toHaveAttribute('aria-label', /^現在開いているタブ、\d+ 個のタブ$/);
});
