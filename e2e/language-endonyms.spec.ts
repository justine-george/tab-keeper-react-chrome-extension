import type { BrowserContext, Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { buildContainer, seedSessions, seedSettings } from './fixtures/seed';

// KAN-244. A language picker is the one screen that must be usable by someone
// who cannot read the current UI language -- that is why they are on it. It
// was ten buttons labelled through t(), so a user who landed in Russian was
// looking for "Английский" to get back to English, and nothing on the page
// said which language was current.
//
// The jsdom test pins the contract (each language names itself, the current
// one is aria-pressed and wears the 2px frame, the order). What only a real
// browser can say is that the marker moves nothing when it thickens, and that
// the Devanagari and Cyrillic names on a Latin-locale page get real glyphs
// rather than tofu -- Libre Franklin has neither script, so they must fall
// through to the system sans.

const ENDONYMS = [
  'Deutsch',
  'English',
  'Español',
  'Français',
  'Italiano',
  'Português',
  'Русский',
  'हिन्दी',
  '中文',
  '日本語',
];

// i18n reads `language` out of settingsData at MODULE LOAD (config/i18n.tsx),
// so it must be seeded before the first render -- seedSettings does that via
// addInitScript, and so must run before context.newPage().
//
// The controls on the way are translated (Settings is "Настройки" in
// Russian, the category row "Язык"), so the caller says what they are called
// in the language it booted.
async function openLanguagePaneIn(
  context: BrowserContext,
  extensionId: string,
  language: string,
  labels: { settings: string; category: string }
): Promise<Page> {
  await seedSessions(context, buildContainer());
  await seedSettings(context, { language });
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/index.html`);
  await page.locator(`[aria-label="${labels.settings}"]`).click();
  await page.locator(`button[aria-label="${labels.category}"]`).click();
  await expect(page.getByRole('button', { name: 'English' })).toBeVisible();
  return page;
}

const option = (page: Page, name: string) =>
  page.getByRole('button', { name, exact: true });

test.describe('the language picker names each language in its own language (KAN-244)', () => {
  test('booted in Russian, the way back to English reads "English" and Russian is the one pressed', async ({
    context,
    extensionId,
  }) => {
    const page = await openLanguagePaneIn(context, extensionId, 'ru', {
      settings: 'Настройки',
      category: 'Язык',
    });

    // CONTROL: the popup really is in Russian -- the pane heading is.
    await expect(page.getByText('Выберите язык')).toBeVisible();

    for (const name of ENDONYMS) {
      await expect(option(page, name)).toBeVisible();
    }
    await expect(option(page, 'Английский')).toHaveCount(0);

    await expect(option(page, 'Русский')).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    for (const name of ENDONYMS) {
      if (name === 'Русский') continue;
      await expect(option(page, name)).toHaveAttribute('aria-pressed', 'false');
    }
  });

  test('the names in scripts Libre Franklin lacks get real glyphs, not tofu', async ({
    context,
    extensionId,
  }) => {
    const page = await openLanguagePaneIn(context, extensionId, 'en', {
      settings: 'Settings',
      category: 'Language',
    });

    // A string with no glyphs renders as a row of identical boxes and is
    // still "visible", so visibility proves nothing. Tofu is a run of equal
    // widths; the glyphs of a real script are not. (中 and 文 ARE equal --
    // CJK is monospaced by design -- so this is asked of the two scripts
    // whose letters differ in width.)
    for (const name of ['हिन्दी', 'Русский']) {
      const widths = await option(page, name).evaluate((el) => {
        const node = el.querySelector('span')?.firstChild;
        if (!node?.textContent) return [];
        const range = document.createRange();
        return Array.from({ length: node.textContent.length }, (_, i) => {
          range.setStart(node, i);
          range.setEnd(node, i + 1);
          return Math.round(range.getBoundingClientRect().width * 100) / 100;
        });
      });
      expect(widths.length, `${name} has no text node`).toBeGreaterThan(1);
      expect(new Set(widths).size, `${name} rendered as tofu`).toBeGreaterThan(
        1
      );
    }
  });

  test('the marker thickens the frame without moving the option', async ({
    context,
    extensionId,
  }) => {
    const page = await openLanguagePaneIn(context, extensionId, 'en', {
      settings: 'Settings',
      category: 'Language',
    });

    const before = (await option(page, 'Deutsch').boundingBox())!;
    const neighbour = (await option(page, 'English').boundingBox())!;

    await option(page, 'Deutsch').click();
    await expect(option(page, 'Deutsch')).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    await expect(option(page, 'English')).toHaveAttribute(
      'aria-pressed',
      'false'
    );

    const after = (await option(page, 'Deutsch').boundingBox())!;
    expect(after, 'the option must not resize as it activates').toEqual(before);
    expect(await option(page, 'English').boundingBox()).toEqual(neighbour);

    // And it is a frame, not a fill: 2px on the pressed one, 1px on the rest.
    const widthOf = (name: string) =>
      option(page, name).evaluate((el) => getComputedStyle(el).borderTopWidth);
    expect(await widthOf('Deutsch')).toBe('2px');
    expect(await widthOf('English')).toBe('1px');
  });
});
