import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { BrowserContext, Locator, Page, Worker } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { buildContainer, seedSessions, seedSettings } from './fixtures/seed';

// Does the UI still fit once it is translated?
//
// English is the shortest label in this app for almost every control, so a
// card sized to the English copy looks fine right up until it ships. This spec
// renders the tab-groups offer in the widest locale and asserts the CTA label
// still fits on ONE LINE.
//
// One line, specifically -- and that is the whole lesson of this file. A label
// too long for its button here does not clip and does not overflow: it WRAPS.
// Measured against a card deliberately shrunk to 300px, `scrollWidth ===
// clientWidth` (nothing clipped), the button's own height stays 56px, and
// `document.scrollWidth` never exceeds the viewport. An earlier version of
// this spec asserted exactly those three things and passed against the broken
// layout. Only the line count moves: the label's text goes from one line box
// to two.
//
// Counted with a Range over the text rather than `span.getClientRects()`,
// which returns a single box regardless -- the label is `display: block`, so
// its own rect covers both lines. A Range over its contents reports one rect
// per line box, which is the real question being asked.
//
// The expected strings are READ FROM THE LOCALE FILES rather than hardcoded,
// so rewording the copy never touches this spec -- it fails only when the
// LAYOUT breaks. That is deliberate: the component tests already pin the
// wording, and duplicating it here would mean two files to edit for every copy
// change and a spec that goes red for a reason it does not care about.
//
// Locale choice is not arbitrary. Measured 2026-09-04 across all ten:
//   es 404px, fr 397px, de 338px, ru 333px, ja 320px, it 320px,
//   pt 305px, en 247px, hi 206px, zh 181px   (CTA width, 500px card)
// so `es` is the binding case at 81% of the card. `hi` is here for a different
// reason -- Devanagari, to catch a font-fallback or line-height regression
// that a Latin-script measurement cannot see. `en` is the CONTROL: if it fails
// too, the harness is broken rather than the translations.
const LOCALES = ['en', 'es', 'hi'] as const;
const ALL_LOCALES = [
  'de',
  'en',
  'es',
  'fr',
  'hi',
  'it',
  'ja',
  'ko',
  'pt',
  'ru',
  'sv',
  'zh',
  'zh-TW',
] as const;

function localeStrings(lang: string): Record<string, string> {
  return JSON.parse(
    readFileSync(
      fileURLToPath(
        new URL(`../public/locales/${lang}/translation.json`, import.meta.url)
      ),
      'utf8'
    )
  );
}

/**
 * Puts two real Chrome tab groups in the browser and returns how many exist.
 *
 * Made through the extension's own service worker, not faked: the offer is
 * gated on countOpenTabGroups(), which reads `Tab.groupId` via
 * chrome.tabs.query. That field is NOT privileged -- it arrives whether or not
 * the optional tabGroups permission is granted, which is the premise of the
 * whole feature (see liveTabGroups.ts). Creating them for real is what proves
 * that still holds.
 */
async function createTabGroups(serviceWorker: Worker): Promise<number> {
  return serviceWorker.evaluate(async () => {
    const newTab = () =>
      new Promise<chrome.tabs.Tab>((resolve) =>
        chrome.tabs.create({ url: 'about:blank', active: false }, resolve)
      );
    const [a, b, c] = [await newTab(), await newTab(), await newTab()];
    await chrome.tabs.group({ tabIds: [a.id!, b.id!] });
    await chrome.tabs.group({ tabIds: [c.id!] });
    const tabs = await chrome.tabs.query({});
    return new Set(
      tabs.map((t) => t.groupId).filter((g) => g !== undefined && g !== -1)
    ).size;
  });
}

async function openPopupIn(
  context: BrowserContext,
  extensionId: string,
  lang: string
): Promise<Page> {
  await seedSessions(context, buildContainer());
  // i18n reads `language` out of settingsData at MODULE LOAD (config/i18n.tsx),
  // so this has to be seeded before the first render -- which seedSettings does
  // via addInitScript. Setting it after navigation would be too late.
  await seedSettings(context, { language: lang });
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/index.html`);
  return page;
}

/**
 * Opens the review card (KAN-653): the day-after-install ask, offering "Never
 * ask again" so the card is at its tallest. The install date is a NUMBER of
 * milliseconds: a plausible ISO string reads as "never installed" and the
 * card silently never shows.
 */
async function openReviewCardIn(
  context: BrowserContext,
  extensionId: string,
  lang: string
): Promise<Page> {
  await seedSettings(context, {
    language: lang,
    isNeverAskAgainToRate: false,
    extensionInstalledTime: Date.now() - 2 * 24 * 60 * 60 * 1000,
    isSkippedUserReviewOnce: true,
  });
  await seedSessions(context, buildContainer());
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/index.html`);
  return page;
}

/**
 * How the CTA is sitting in its card: how many line boxes its label occupies,
 * and whether the button has burst out of the card.
 *
 * Takes a Locator rather than an accessible name because the two CTAs are not
 * addressable the same way -- the tab-groups button is a bare <button> with
 * no icon, the review card's Rate wraps its label in a span.
 */
async function ctaFit(cta: Locator) {
  return cta.evaluate((button: HTMLElement) => {
    // The label, not the leading icon: Material Symbols renders its glyph as
    // ligature TEXT in a span of its own, so the first span is the icon.
    const label =
      Array.from(button.querySelectorAll('span')).find(
        (s) => !s.className.includes('material-symbols')
      ) ?? button;
    if (!label) return null;
    const range = document.createRange();
    range.selectNodeContents(label);
    // The card: nearest ancestor wider than the button. Measured rather than
    // hardcoded to 500 -- a hardcoded bound passes trivially when the card
    // itself is what shrank.
    let card: HTMLElement | null = button.parentElement;
    while (
      card &&
      card.getBoundingClientRect().width <= button.getBoundingClientRect().width
    ) {
      card = card.parentElement;
    }
    return {
      lineBoxes: range.getClientRects().length,
      burstsCardBy: card
        ? Math.round(
            button.getBoundingClientRect().right -
              card.getBoundingClientRect().right
          )
        : null,
      pageOverflowsX:
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth,
    };
  });
}

function expectFits(fit: Awaited<ReturnType<typeof ctaFit>>, lang: string) {
  expect(fit).not.toBeNull();
  // The assertion that has teeth. The two below it are cheaper checks for a
  // coarser break that neither of these layouts happens to produce.
  expect(fit!.lineBoxes, `${lang}: CTA label must stay on one line`).toBe(1);
  expect(fit!.burstsCardBy).toBeLessThanOrEqual(0);
  expect(fit!.pageOverflowsX).toBe(false);
}

test.describe('translated UI still fits its layout', () => {
  for (const lang of LOCALES) {
    test(`the tab groups offer fits the card in ${lang}`, async ({
      context,
      serviceWorker,
      extensionId,
    }) => {
      const t = localeStrings(lang);

      const groupCount = await createTabGroups(serviceWorker);
      // The fixture's own control. Without real groups the offer never opens,
      // and every assertion below would fail as "element not found" -- which
      // reads as a broken modal rather than a broken setup.
      expect(groupCount, 'fixture must create real tab groups').toBe(2);

      const page = await openPopupIn(context, extensionId, lang);

      // Located by the LOCALIZED accessible name, so a locale that silently
      // failed to load and fell back to English fails here rather than quietly
      // passing the layout assertions against English text.
      const cta = page.getByRole('button', {
        name: t['Turn on'],
        exact: true,
      });
      await expect(cta).toBeVisible();

      expectFits(await ctaFit(cta), lang);
    });
  }

  // KAN-78, carried to the review card (KAN-653): Rate is full width, so the
  // check is that its label stays on one line in the card.
  for (const lang of LOCALES) {
    test(`the review card's Rate fits the card in ${lang}`, async ({
      context,
      extensionId,
    }) => {
      const t = localeStrings(lang);
      const page = await openReviewCardIn(context, extensionId, lang);

      const cta = page.getByRole('button', {
        name: t['Rate Tab Keeper'],
        exact: true,
      });
      await expect(cta).toBeVisible();

      expectFits(await ctaFit(cta), lang);
    });
  }

  // KAN-653 Review Focus 4. The popup's 360px card in every locale: the
  // title wraps rather than running under the ✕, and the card stays on screen.
  for (const lang of ALL_LOCALES) {
    test(`the review card's title keeps clear of its ✕ in ${lang}`, async ({
      context,
      extensionId,
    }) => {
      const t = localeStrings(lang);
      const page = await openReviewCardIn(context, extensionId, lang);
      const card = page.getByRole('complementary', {
        name: t['Thanks for using Tab Keeper'],
        exact: true,
      });
      await expect(card).toBeVisible();

      const fit = await card.evaluate((el) => {
        const title = el.querySelector('h2 > span:last-child')!;
        const range = document.createRange();
        range.selectNodeContents(title);
        const inkRight = Math.max(
          ...Array.from(range.getClientRects(), (r) => r.right)
        );
        const close = el
          .querySelector('[role="button"][aria-label]')!
          .getBoundingClientRect();
        const box = el.getBoundingClientRect();
        return {
          clearOfClose: inkRight <= close.left,
          onScreen:
            box.left >= 0 &&
            box.top >= 0 &&
            box.right <= window.innerWidth &&
            box.bottom <= window.innerHeight,
        };
      });
      expect(fit, lang).toEqual({ clearOfClose: true, onScreen: true });
    });
  }
});
