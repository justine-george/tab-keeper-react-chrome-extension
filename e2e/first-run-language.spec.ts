import type { BrowserContext, Page, Worker } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { seedSettings } from './fixtures/seed';

// KAN-282. A fresh install opened in English whatever Chrome's language was:
// nothing read `chrome.i18n.getUILanguage()`. The unit tests pin the mapping
// and the rule that a saved language wins; what only the built extension can
// show is that the page that renders and the settings that get saved agree.
// They are decided in two modules at load (i18n.tsx and the settings slice),
// and the very first open writes settings -- App stamps the install time --
// so a detection that reached only i18n.tsx rendered German once and saved
// `en`, and every later open was English.
//
// `--lang` is honoured on Linux, where CI runs, and ignored on macOS, which
// takes the system language list instead. Each test first asks Chrome what it
// is reporting and skips when the flag did not take, rather than passing
// against English for the wrong reason.

const open = async (context: BrowserContext, extensionId: string) => {
  const page = await context.newPage();
  await page.setViewportSize({ width: 790, height: 550 });
  await page.goto(`chrome-extension://${extensionId}/index.html`);
  // lang is mirrored from i18n (KAN-284), so it moves once i18n has settled.
  await expect(page.locator('html')).toHaveAttribute('lang', /.+/);
  return page;
};

const savedLanguage = (page: Page) =>
  page.evaluate(
    () =>
      (
        JSON.parse(localStorage.getItem('settingsData') ?? '{}') as {
          language?: string;
        }
      ).language
  );

const skipUnlessChromeReports = async (worker: Worker, tag: string) => {
  const reported = await worker.evaluate(() => chrome.i18n.getUILanguage());
  test.skip(
    reported.toLowerCase() !== tag.toLowerCase(),
    `--lang=${tag} did not take on this platform (Chrome reports ${reported}); macOS ignores the flag`
  );
};

test.describe('a fresh install opens in Chrome’s language (KAN-282)', () => {
  test.describe('Chrome in German', () => {
    test.use({ freshProfile: true, uiLanguage: 'de' });

    test('the first open is German, is saved as German, and stays German', async ({
      context,
      extensionId,
      serviceWorker,
    }) => {
      await skipUnlessChromeReports(serviceWorker, 'de');

      const page = await open(context, extensionId);
      await expect(page.locator('html')).toHaveAttribute('lang', 'de');
      await expect(
        page.getByRole('dialog', { name: 'Willkommen bei Tab Keeper' })
      ).toBeVisible();
      await expect.poll(() => savedLanguage(page)).toBe('de');

      await page.reload();
      await expect(page.locator('html')).toHaveAttribute('lang', 'de');
      expect(await savedLanguage(page)).toBe('de');
    });
  });

  test.describe('Chrome in Traditional Chinese', () => {
    test.use({ freshProfile: true, uiLanguage: 'zh-TW' });

    test('the first open is Traditional, not Simplified', async ({
      context,
      extensionId,
      serviceWorker,
    }) => {
      await skipUnlessChromeReports(serviceWorker, 'zh-TW');

      const page = await open(context, extensionId);
      await expect(page.locator('html')).toHaveAttribute('lang', 'zh-TW');
      await expect.poll(() => savedLanguage(page)).toBe('zh-TW');
    });
  });

  // Existing users. Everyone who has used the extension has `language` saved;
  // Chrome's language must not move them.
  test.describe('Chrome in German, English already saved', () => {
    test.use({ uiLanguage: 'de' });

    test('stays English', async ({ context, extensionId, serviceWorker }) => {
      await skipUnlessChromeReports(serviceWorker, 'de');
      await seedSettings(context, { language: 'en' });

      const page = await open(context, extensionId);
      await expect(page.locator('html')).toHaveAttribute('lang', 'en');
      expect(await savedLanguage(page)).toBe('en');
    });
  });

  // An unshipped language never reaches i18next as a raw tag (#42: a detector
  // did that once, i18next fetched /locales/<tag>/translation.json, and the
  // popup lost every string). It opens in English, with its strings.
  test.describe('Chrome in Dutch, which this build does not ship', () => {
    test.use({ freshProfile: true, uiLanguage: 'nl' });

    test('opens in English, with its strings', async ({
      context,
      extensionId,
      serviceWorker,
    }) => {
      await skipUnlessChromeReports(serviceWorker, 'nl');

      const page = await open(context, extensionId);
      await expect(page.locator('html')).toHaveAttribute('lang', 'en');
      await expect(
        page.getByRole('dialog', { name: 'Welcome to Tab Keeper' })
      ).toBeVisible();
    });
  });
});
