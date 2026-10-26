import type { Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { waitForFontsLoaded } from './fixtures/fonts';
import { localeStrings } from './fixtures/locales';
import { buildContainer, seedSessions } from './fixtures/seed';
import { POPUP, openPage } from './fixtures/onboarding';

// KAN-802. Libre Franklin has no Devanagari or CJK, so under `line-height:
// normal` those lines took the Mac fallback font's taller metrics: switching
// to Hindi, Japanese or Chinese moved the whole layout down, and Japanese
// overflowed the popup's Settings pane. Every line is now as tall as a Latin
// line, and a Latin line is as tall as it always was.

const ENDONYM: Record<string, string> = {
  de: 'Deutsch',
  es: 'Español',
  fr: 'Français',
  hi: 'हिन्दी',
  it: 'Italiano',
  ja: '日本語',
  ko: '한국어',
  pt: 'Português',
  ru: 'Русский',
  sv: 'Svenska',
  zh: '简体中文',
  'zh-TW': '繁體中文',
};

const cells = (page: Page) =>
  page.locator('div:has(> button:has-text("Deutsch")) > button');

// Every Settings category row and every language cell, with the pane's overflow.
const layout = (page: Page) =>
  page.evaluate(() => {
    const box = (el: Element) => {
      const r = el.getBoundingClientRect();
      return [r.x, r.y, r.width, r.height].map(
        (n) => Math.round(n * 100) / 100
      );
    };
    const nav = [...document.querySelectorAll('button')].filter(
      (b) =>
        b.getBoundingClientRect().x < 300 &&
        b.getBoundingClientRect().height > 40
    );
    const cellRow = [...document.querySelectorAll('button')].find((b) =>
      b.textContent?.endsWith('Deutsch')
    )!.parentElement!;
    const pane = cellRow.closest<HTMLElement>('[class]')!;
    let scroller: HTMLElement | null = cellRow;
    while (scroller && getComputedStyle(scroller).overflowY !== 'auto')
      scroller = scroller.parentElement;
    return {
      // Rows, not widths: a label like "Back" is as wide as its own language makes it.
      nav: nav.map((el) => box(el).filter((_, i) => i === 1 || i === 3)),
      cells: [...cellRow.children].map(box),
      paneScrolls: scroller
        ? scroller.scrollHeight > scroller.clientHeight
        : null,
      paneWidth: pane.clientWidth,
    };
  });

for (const [language, endonym] of Object.entries(ENDONYM))
  test(`switching to ${language} moves nothing on the Language page`, async ({
    context,
    extensionId,
  }) => {
    await seedSessions(context, buildContainer());
    const page = await openPage(context, extensionId, 'index.html', POPUP);
    await page.locator('[aria-label="Settings"]').click();
    await page.locator('button[aria-label="Language"]').click();
    await expect(cells(page)).toHaveCount(13);
    await waitForFontsLoaded(page, ['Libre Franklin']);
    const english = await layout(page);
    // PREMISE: English fits the pane.
    expect(english.paneScrolls).toBe(false);

    await page.getByRole('button', { name: endonym, exact: true }).click();
    // Barrier: the page now speaks the chosen language.
    await expect(
      page.getByRole('button', {
        name: localeStrings(language).Language,
        exact: true,
      })
    ).toBeVisible();

    expect(await layout(page)).toEqual(english);
  });

// The app's TYPE sizes, at Chrome's default and Large text.
for (const root of [16, 20])
  test(`a Latin line is exactly as tall as line-height: normal made it (${root}px root)`, async ({
    context,
    extensionId,
  }) => {
    const page = await openPage(context, extensionId, 'index.html', POPUP);
    await page.locator('[aria-label="Settings"]').waitFor();
    await waitForFontsLoaded(page, ['Libre Franklin']);
    const heights = await page.evaluate((root) => {
      document.documentElement.style.fontSize = `${root}px`;
      const at = (rem: number, lineHeight: string | null) => {
        const el = document.createElement('div');
        el.style.cssText = `position: absolute; font-family: "Libre Franklin", sans-serif; font-size: ${rem}rem; white-space: nowrap;`;
        if (lineHeight !== null) el.style.lineHeight = lineHeight;
        el.textContent = 'Settings · Quick access';
        document.body.appendChild(el);
        const h = el.getBoundingClientRect().height;
        el.remove();
        return h;
      };
      return [0.7, 0.8, 0.9, 1, 1.1, 1.25].map((rem) => ({
        rem,
        app: at(rem, null),
        normal: at(rem, 'normal'),
      }));
    }, root);
    for (const { rem, app, normal } of heights)
      expect(app, `${rem}rem`).toBe(normal);
  });
