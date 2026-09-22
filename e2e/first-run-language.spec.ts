import type { BrowserContext, Page } from '@playwright/test';

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
// WHY THE ANSWER IS SET IN THE PAGE. The browser's own language cannot be set
// for the page from here. Measured on 2026-09-22: macOS ignores `--lang` and
// LANGUAGE; on CI's headless Linux, LANGUAGE made the SERVICE WORKER report
// `de` while `getUILanguage()` in the popup page still returned `en-US`. So
// this spec replaces only Chrome's answer, in the page, before the bundle
// runs. Everything downstream of it is the real build. The real-browser check
// -- macOS set to German, a headed window -- was done by hand on the same
// change and is in the PR.

const chromeSays = (context: BrowserContext, tag: string) =>
  context.addInitScript((uiTag: string) => {
    const i18n = (globalThis as { chrome?: { i18n?: object } }).chrome?.i18n;
    if (i18n) {
      Object.defineProperty(i18n, 'getUILanguage', {
        value: () => uiTag,
        configurable: true,
      });
    }
  }, tag);

const open = async (context: BrowserContext, extensionId: string) => {
  const page = await context.newPage();
  await page.setViewportSize({ width: 790, height: 550 });
  await page.goto(`chrome-extension://${extensionId}/index.html`);
  // lang is mirrored from i18n (KAN-284), so it is set once i18n has settled.
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

test.describe('a fresh install opens in Chrome’s language (KAN-282)', () => {
  test.describe('on a fresh profile', () => {
    test.use({ freshProfile: true });

    // CONTROL for the override itself: if it did not reach the page, every
    // assertion below would be about a browser still saying en-US.
    test('CONTROL: the page reports the language this spec gives it', async ({
      context,
      extensionId,
    }) => {
      await chromeSays(context, 'de');
      const page = await open(context, extensionId);
      expect(await page.evaluate(() => chrome.i18n.getUILanguage())).toBe('de');
    });

    test('Chrome in German: the first open is German, is saved, and stays German', async ({
      context,
      extensionId,
    }) => {
      await chromeSays(context, 'de-DE');
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

    test('Chrome in Traditional Chinese: Traditional, not Simplified', async ({
      context,
      extensionId,
    }) => {
      await chromeSays(context, 'zh-TW');
      const page = await open(context, extensionId);

      await expect(page.locator('html')).toHaveAttribute('lang', 'zh-TW');
      await expect.poll(() => savedLanguage(page)).toBe('zh-TW');
    });

    // An unshipped language never reaches i18next as a raw tag (#42: a
    // detector did that once, i18next fetched /locales/<tag>/translation.json,
    // and the popup lost every string). English, with its strings.
    test('Chrome in Dutch, which this build does not ship: English, with its strings', async ({
      context,
      extensionId,
    }) => {
      await chromeSays(context, 'nl');
      const page = await open(context, extensionId);

      await expect(page.locator('html')).toHaveAttribute('lang', 'en');
      await expect(
        page.getByRole('dialog', { name: 'Welcome to Tab Keeper' })
      ).toBeVisible();
    });
  });

  // Existing users. Everyone who has used the extension has `language` saved;
  // Chrome's language must not move them.
  test('Chrome in German, English already saved: stays English', async ({
    context,
    extensionId,
  }) => {
    await chromeSays(context, 'de');
    await seedSettings(context, { language: 'en' });

    const page = await open(context, extensionId);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    expect(await savedLanguage(page)).toBe('en');
  });
});
