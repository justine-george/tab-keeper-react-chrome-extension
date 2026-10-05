import type { BrowserContext, Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { buildContainer, seedSessions, seedSettings } from './fixtures/seed';
import { POPUP, THEMES, openPage, pageGround } from './fixtures/onboarding';
import { expectReadable } from './fixtures/textContrast';

// KAN-420. Chrome's own language is the first cell of Settings -> Language,
// a pick fills its cell where it stands, and the filled cell reads in every
// theme. Chrome's answer is replaced in the page (the harness cannot set the
// browser's language), so everything downstream is the real build.

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

async function openLanguagePane(
  context: BrowserContext,
  extensionId: string
): Promise<Page> {
  await seedSessions(context, buildContainer());
  const page = await openPage(context, extensionId, 'index.html', POPUP);
  await page.locator('[aria-label="Settings"]').click();
  await page.locator('button[aria-label="Language"]').click();
  await expect(
    page.getByRole('button', { name: 'English', exact: true })
  ).toBeVisible();
  return page;
}

const cells = (page: Page) =>
  page.locator('div:has(> button:has-text("Deutsch")) > button');

const names = async (page: Page) =>
  (await cells(page).allTextContents()).map((n) => n.replace(/^check/, ''));

test('Chrome in French puts Français first; a pick fills its cell and moves nothing', async ({
  context,
  extensionId,
}) => {
  await chromeSays(context, 'fr-FR');
  await seedSettings(context, { language: 'en' });
  const page = await openLanguagePane(context, extensionId);

  // CONTROL: the page reports the language this spec gives it.
  expect(await page.evaluate(() => chrome.i18n.getUILanguage())).toBe('fr-FR');

  await expect(cells(page).first()).toHaveText('Français');
  const before = await names(page);
  expect(before).toHaveLength(13);
  const box = (name: string) =>
    page.getByRole('button', { name, exact: true }).boundingBox();
  const deutsch = await box('Deutsch');

  await page.getByRole('button', { name: 'Deutsch', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Deutsch', exact: true })
  ).toHaveAttribute('aria-pressed', 'true');

  expect(await names(page)).toEqual(before);
  // The ✓ appears inside a fixed-height cell: nothing resizes or shifts.
  expect(await box('Deutsch')).toEqual(deutsch);
});

test('Chrome in a language this build does not ship leaves the picker order', async ({
  context,
  extensionId,
}) => {
  await chromeSays(context, 'pl-PL');
  await seedSettings(context, { language: 'en' });
  const page = await openLanguagePane(context, extensionId);
  await expect(cells(page).first()).toHaveText('Deutsch');
});

for (const [theme, palette] of THEMES) {
  test(`${theme}: the filled language cell reads at 4.5:1`, async ({
    context,
    extensionId,
  }) => {
    await chromeSays(context, 'fr-FR');
    await seedSettings(context, { theme, language: 'en' });
    const page = await openLanguagePane(context, extensionId);
    expect(await pageGround(page)).toBe(palette.PRIMARY_COLOR);
    const pressed = page.getByRole('button', {
      name: 'English',
      exact: true,
    });
    await expect(pressed).toHaveAttribute('aria-pressed', 'true');
    await expectReadable(pressed, `${theme} filled language cell`);
  });
}
