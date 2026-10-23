import type { Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { localeStrings } from './fixtures/locales';
import { buildContainer, seedSessions, seedSettings } from './fixtures/seed';

// KAN-749. Settings › Default view shows setup's picture cards. In the popup and
// the full view, at Chrome's 16, 20 and 24px text and in every language, both
// cards sit side by side inside the pane, nothing scrolls sideways, and no
// label or caption is clipped (the round-1 mock measured all of this).

const LANGS = [
  'en',
  'de',
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
];
const VIEWS = [
  { name: 'popup', path: 'index.html', width: 790, height: 550 },
  { name: 'full view', path: 'index.html?view=tab', width: 1280, height: 800 },
] as const;

interface Fit {
  cards: { left: number; right: number; top: number; width: number }[];
  section: { left: number; right: number };
  clipped: string[];
  sideways: boolean;
}

// The Default view group's cards against their section, and any text cut short.
const fitOf = (page: Page, groupName: string): Promise<Fit> =>
  page
    .getByRole('group', { name: groupName, exact: true })
    .evaluate((group) => {
      const section = group.closest('[data-settings-section]');
      if (!section) throw new Error('no settings section');
      const s = section.getBoundingClientRect();
      const pad = parseFloat(getComputedStyle(section).paddingRight);
      const cards = [...group.querySelectorAll('button')].map((b) => {
        const r = b.getBoundingClientRect();
        return { left: r.left, right: r.right, top: r.top, width: r.width };
      });
      const clipped = [...group.querySelectorAll<HTMLElement>('[id]')]
        .filter((n) => n.scrollWidth > n.clientWidth + 1)
        .map((n) => n.textContent ?? '');
      let pane: HTMLElement | null = section.parentElement;
      let sideways =
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth;
      while (pane) {
        if (pane.scrollWidth > pane.clientWidth + 1) sideways = true;
        pane = pane.parentElement;
      }
      return {
        cards,
        section: { left: s.left, right: s.right - pad },
        clipped,
        sideways,
      };
    });

for (const view of VIEWS) {
  for (const lang of LANGS) {
    test(`${view.name}, ${lang}: both cards fit the pane at 16, 20 and 24px`, async ({
      context,
      extensionId,
    }) => {
      const L = localeStrings(lang);
      await seedSessions(context, buildContainer());
      await seedSettings(context, lang === 'en' ? {} : { language: lang });
      const page = await context.newPage();
      await page.setViewportSize({ width: view.width, height: view.height });
      await page.goto(`chrome-extension://${extensionId}/${view.path}`);
      await page
        .locator(`[aria-label="${L['Settings'] ?? 'Settings'}"]`)
        .first()
        .click();
      await page
        .locator(`button[aria-label="${L['Quick access'] ?? 'Quick access'}"]`)
        .click();
      const groupName = L['Default view'] ?? 'Default view';
      const group = page.getByRole('group', { name: groupName, exact: true });
      // PREMISE: the cards rendered, with their captions.
      await expect(group.getByRole('button')).toHaveCount(2);
      await expect(
        group.getByRole('button').first()
      ).toHaveAccessibleDescription(
        L['Opens under the toolbar icon'] ?? 'Opens under the toolbar icon'
      );

      for (const root of [16, 20, 24]) {
        await page.evaluate((px) => {
          document.documentElement.style.fontSize = `${px}px`;
        }, root);
        const fit = await fitOf(page, groupName);
        const at = `${root}px`;
        expect(fit.cards, at).toHaveLength(2);
        const [compact, full] = fit.cards;
        // Side by side, the same width, inside the section's content box.
        expect(compact.top, at).toBeCloseTo(full.top, 0);
        expect(compact.width, at).toBeCloseTo(full.width, 0);
        expect(compact.right, at).toBeLessThan(full.left);
        expect(compact.left, at).toBeGreaterThanOrEqual(fit.section.left);
        expect(full.right, at).toBeLessThanOrEqual(fit.section.right + 0.5);
        expect(fit.clipped, at).toEqual([]);
        expect(fit.sideways, at).toBe(false);
      }
    });
  }
}
