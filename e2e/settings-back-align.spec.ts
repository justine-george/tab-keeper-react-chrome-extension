import type { BrowserContext, Page } from '@playwright/test';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { test, expect } from './fixtures/extension';
import { buildContainer, seedSessions, seedSettings } from './fixtures/seed';
import { POPUP, openPage } from './fixtures/onboarding';
import { localeStrings } from './fixtures/locales';

// KAN-517. Settings' category labels start where the header's "Back" starts.

const CATEGORIES = [
  'Display',
  'Language',
  'Sync & Backup',
  'Sessions',
  'Recently deleted',
  'About',
  'Help',
];

async function openSettings(
  context: BrowserContext,
  extensionId: string,
  path: string,
  size: { width: number; height: number },
  language = 'en'
): Promise<Page> {
  await seedSessions(context, buildContainer());
  await seedSettings(context, { language });
  const page = await openPage(context, extensionId, path, size);
  await page.locator('[aria-label="Settings"]').click();
  await expect(page.getByRole('button', { name: 'Go back' })).toBeVisible();
  return page;
}

// The category rows: the buttons in the column that holds the Display row, each with its label's box.
async function rowLabels(page: Page, display = 'Display') {
  return page
    .locator(`div:has(> button[aria-label="${display}"]) > button`)
    .evaluateAll((rows) =>
      rows.map((row) => {
        const label = row.firstElementChild!.getBoundingClientRect();
        const textNode = document
          .createTreeWalker(row, NodeFilter.SHOW_TEXT)
          .nextNode()!;
        const range = document.createRange();
        range.selectNodeContents(textNode);
        const text = range.getBoundingClientRect();
        const tops = new Set(
          [...range.getClientRects()].map((r) => Math.round(r.top))
        );
        const style = getComputedStyle(row);
        const box = row.getBoundingClientRect();
        return {
          name: row.getAttribute('aria-label'),
          x: label.x,
          lines: tops.size,
          textRight: text.right,
          contentRight: box.right - parseFloat(style.paddingRight),
        };
      })
    );
}

const backLabelX = async (page: Page) =>
  (await page
    .getByRole('button', { name: 'Go back' })
    .getByText('Back', { exact: true })
    .boundingBox())!.x;

const VIEWS = [
  ['the popup', 'index.html', POPUP],
  ['a 1280 full view', 'index.html?view=tab', { width: 1280, height: 800 }],
  ['a 1920 full view', 'index.html?view=tab', { width: 1920, height: 1000 }],
] as const;

for (const [name, path, size] of VIEWS) {
  test(`in ${name}, every category label starts where "Back" starts`, async ({
    context,
    extensionId,
  }) => {
    const page = await openSettings(context, extensionId, path, size);
    const back = await backLabelX(page);
    const rows = await rowLabels(page);
    expect(rows.map((r) => r.name)).toEqual(CATEGORIES);
    for (const r of rows) expect(Math.abs(r.x - back)).toBeLessThan(0.5);
  });
}

test('at the largest Chrome font size (a 24px root), the labels still start where "Back" starts', async ({
  context,
  extensionId,
}) => {
  const page = await openSettings(context, extensionId, 'index.html', POPUP);
  const before = await backLabelX(page);
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '24px';
  });
  const back = await backLabelX(page);
  // PREMISE: the bigger root moved "Back", so the match below is not the 16px one again.
  expect(back).toBeGreaterThan(before + 4);
  for (const r of await rowLabels(page))
    expect(Math.abs(r.x - back)).toBeLessThan(0.5);
});

const LANGS = readdirSync(
  fileURLToPath(new URL('../public/locales', import.meta.url))
);

test('PREMISE: all 13 shipped languages are checked below', () => {
  expect(LANGS).toHaveLength(13);
});

for (const lang of LANGS) {
  test(`in ${lang}, each category label fits on one line in its row`, async ({
    context,
    extensionId,
  }) => {
    const strings = localeStrings(lang);
    const say = (key: string) => strings[key] || key;
    await seedSessions(context, buildContainer());
    await seedSettings(context, { language: lang });
    const page = await context.newPage();
    await page.setViewportSize(POPUP);
    await page.goto(`chrome-extension://${extensionId}/index.html`);
    // CONTROL: the page is in the seeded language, so the labels measured are its translations.
    await expect(page.locator('html')).toHaveAttribute('lang', lang);
    await page
      .locator(`[aria-label="${say('Settings')}"]`)
      .first()
      .click();
    await page.locator(`button[aria-label="${say('Display')}"]`).waitFor();
    const rows = await rowLabels(page, say('Display'));
    expect(rows).toHaveLength(CATEGORIES.length);
    const overflow = rows.flatMap((r) =>
      r.lines !== 1 || r.textRight > r.contentRight + 0.5
        ? [
            `${r.name}: ${r.lines} lines, ${Math.round(r.textRight - r.contentRight)}px over`,
          ]
        : []
    );
    expect(overflow).toEqual([]);
  });
}
