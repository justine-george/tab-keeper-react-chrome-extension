import type { Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { elementLanded } from './fixtures/landed';
import { localeStrings } from './fixtures/locales';
import { FULL, FULL_VIEW_PATH, openPage } from './fixtures/onboarding';
import { buildContainer, seedSessions, seedSettings } from './fixtures/seed';
import { SettingsCategory } from '../src/redux/slices/settingsCategoryStateSlice';

// KAN-754. At Chrome's 20 and 24px text the Settings rail cut its labels. The
// full view's column now grows with the text (14.875rem, 238px at 16), so each
// label stays on one line; the popup's rail keeps its 30% and a long label
// wraps instead. Every label is whole in every language at 16, 20 and 24px.

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

interface Rail {
  column: number;
  labels: { name: string; cut: boolean; lines: number; splitWords: string[] }[];
}

// The column's width, and each category label: cut short, and its line count.
const railOf = (page: Page, names: string[]): Promise<Rail> =>
  page.evaluate((names) => {
    const column = document.querySelector('[data-pane="sessions"]');
    if (!column) throw new Error('no settings column');
    return {
      column: column.getBoundingClientRect().width,
      labels: names.map((name) => {
        const row = column.querySelector(`button[aria-label="${name}"]`);
        const text = [...(row?.querySelectorAll('span') ?? [])].find(
          (s) => s.textContent === name
        );
        if (!text) throw new Error(`no rail label "${name}"`);
        const range = document.createRange();
        range.selectNodeContents(text);
        const tops = new Set(
          [...range.getClientRects()].map((r) => Math.round(r.top))
        );
        // Each space-separated word on one line: a word split across two reads as broken.
        const node = text.firstChild;
        let at = 0;
        const splitWords = (name.split(' ') ?? []).filter((word) => {
          const start = name.indexOf(word, at);
          at = start + word.length;
          if (!node) return false;
          const r = document.createRange();
          r.setStart(node, start);
          r.setEnd(node, start + word.length);
          return (
            new Set([...r.getClientRects()].map((c) => Math.round(c.top)))
              .size > 1
          );
        });
        return {
          name,
          cut: text.scrollWidth > text.clientWidth + 1,
          lines: tops.size,
          splitWords,
        };
      }),
    };
  }, names);

for (const view of VIEWS) {
  for (const lang of LANGS) {
    test(`${view.name}, ${lang}: every rail label is whole at 16, 20 and 24px`, async ({
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
        .waitFor();

      const names = Object.values(SettingsCategory).map((k) => L[k] ?? k);
      const at16 = await railOf(page, names);
      for (const root of [16, 20, 24]) {
        await page.evaluate((px) => {
          document.documentElement.style.fontSize = `${px}px`;
        }, root);
        const rail = await railOf(page, names);
        const at = `${root}px`;
        expect(
          rail.labels.filter((l) => l.cut).map((l) => l.name),
          at
        ).toEqual([]);
        if (view.name === 'full view') {
          // KAN-802: plus the 10px its scrollbar gutter keeps.
          expect(rail.column, at).toBeCloseTo(14.875 * root + 10, 0);
          expect(
            rail.labels.filter((l) => l.lines > 1).map((l) => l.name),
            at
          ).toEqual([]);
        } else {
          // The popup's rail keeps its share of the 790px box.
          expect(rail.column, at).toBeCloseTo(at16.column, 0);
          expect(
            rail.labels.filter((l) => l.lines > 2).map((l) => l.name),
            at
          ).toEqual([]);
          // Chinese and Japanese break between characters by design.
          if (!['ja', 'zh', 'zh-TW'].includes(lang)) {
            expect(
              rail.labels.flatMap((l) => l.splitWords),
              at
            ).toEqual([]);
          }
        }
      }
    });
  }
}

// KAN-574 at 24px: the Settings toast's cap follows the wider column.
test('full view at 24px: a toast on Settings is capped by the wider column, not the old 238px', async ({
  context,
  extensionId,
}) => {
  const page = await openPage(context, extensionId, FULL_VIEW_PATH, FULL);
  await page.locator('[aria-label="Settings"]').click();
  await page.locator('button[aria-label="Sync & backup"]').click();
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '24px';
  });
  const chooser = page.waitForEvent('filechooser');
  await page
    .getByRole('button', { name: 'Load sessions from a backup' })
    .click();
  await (
    await chooser
  ).setFiles({
    name: 'not-a-backup.json',
    mimeType: 'application/json',
    buffer: Buffer.from('not json'),
  });
  const toast = page.locator('[role="status"] [data-toast]');
  await expect(toast).toHaveText(
    'Error restoring tabs: The file is not valid JSON.'
  );
  await elementLanded(toast, 'subtree');
  const column = await page.locator('[data-pane="sessions"]').boundingBox();
  const box = await toast.boundingBox();
  if (column === null || box === null) throw new Error('no column or toast');
  // PREMISE: the column grew with the text (KAN-802: 14.875rem plus a 10px gutter).
  expect(column.width).toBeCloseTo(367, 0);
  expect(box.x).toBeCloseTo(20, 0);
  // The toast's own 300px, or the column less 20px each side where that is narrower.
  expect(box.width).toBeCloseTo(Math.min(300, column.width - 40), 0);
  expect(box.x + box.width).toBeLessThanOrEqual(column.x + column.width - 20);
});
