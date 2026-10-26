import type { Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { buildContainer, seedSessions, seedSettings } from './fixtures/seed';
import { localeStrings } from './fixtures/locales';
import { openPage } from './fixtures/onboarding';
import { SettingsCategory } from '../src/redux/slices/settingsCategoryStateSlice';

// KAN-802. The app draws its own 10px scrollbars, so Chrome lays them out as
// real bars: a box that starts to scroll used to narrow every row in it by
// 10px. The details pane keeps that room free, so a long page or a short
// window moves nothing. KAN-807: the category list does not; a gutter it
// rarely needs drew an empty strip beside every row. Its column keeps the
// 10px, so a scrolling list's rows are as wide as KAN-802 made them.
test.use({ showScrollbars: true });

// Each category's label in a language.
const labelsIn = (lang: string) => {
  const L = localeStrings(lang);
  return Object.values(SettingsCategory).map((k) => L[k] ?? k);
};

// The details pane's content width, and whether it scrolls.
const detail = (page: Page) =>
  page.evaluate(() => {
    const root = document.querySelector('[data-pane="detail"]')!;
    const scroller = [root, ...root.querySelectorAll('*')].find(
      (el) => getComputedStyle(el).overflowY === 'auto'
    )!;
    return {
      width: scroller.clientWidth,
      scrolls: scroller.scrollHeight > scroller.clientHeight,
    };
  });

// The category list: whether it scrolls, the gap between a row and the
// list's inner right edge, and any label that does not fit: the full view
// keeps each on one line, the popup's may wrap to two between words.
const categories = (
  page: Page,
  row: string,
  names = labelsIn('en'),
  { maxLines = 1, splitWords = false } = {}
) =>
  page.evaluate(
    ({ row, names, maxLines, splitWords }) => {
      const root = document.querySelector('[data-pane="sessions"]')!;
      const scroller = [root, ...root.querySelectorAll('*')].find(
        (el) => getComputedStyle(el).overflowY === 'auto'
      )!;
      const label = (name: string) =>
        scroller.querySelector(`button[aria-label="${name}"]`);
      // The border's inside edge: clientWidth stops short of a gutter or a bar.
      const inner =
        scroller.getBoundingClientRect().right -
        parseFloat(getComputedStyle(scroller).borderRightWidth);
      return {
        scrolls: scroller.scrollHeight > scroller.clientHeight,
        gap: inner - label(row)!.getBoundingClientRect().right,
        // A label cut short, on more lines than allowed, or with a word
        // split across two lines.
        broken: names.filter((name) => {
          const text = [...(label(name)?.querySelectorAll('span') ?? [])].find(
            (s) => s.textContent === name
          );
          if (!text) throw new Error(`no rail label "${name}"`);
          const linesOf = (range: Range) =>
            new Set([...range.getClientRects()].map((r) => Math.round(r.top)))
              .size;
          const range = document.createRange();
          range.selectNodeContents(text);
          let at = 0;
          const splitWord =
            splitWords &&
            name.split(' ').some((word) => {
              const start = name.indexOf(word, at);
              at = start + word.length;
              const r = document.createRange();
              r.setStart(text.firstChild!, start);
              r.setEnd(text.firstChild!, start + word.length);
              return linesOf(r) > 1;
            });
          return (
            text.scrollWidth > text.clientWidth + 1 ||
            linesOf(range) > maxLines ||
            splitWord
          );
        }),
      };
    },
    { row, names, maxLines, splitWords }
  );

async function settings(page: Page, category: string) {
  await page.locator('[aria-label="Settings"]').click();
  await page.locator(`button[aria-label="${category}"]`).click();
  await page.waitForTimeout(100);
}

test('the details pane keeps its width whether or not it scrolls', async ({
  context,
  extensionId,
}) => {
  await seedSessions(context, buildContainer());
  const page = await openPage(context, extensionId, 'index.html?view=tab', {
    width: 1280,
    height: 800,
  });
  await settings(page, 'Sessions');
  const fits = await detail(page);
  // PREMISE: it does not scroll here.
  expect(fits.scrolls).toBe(false);

  // A short window and the longest page.
  await page.setViewportSize({ width: 1280, height: 460 });
  await page.locator('button[aria-label="Help"]').click();
  await expect.poll(async () => (await detail(page)).scrolls).toBe(true);

  expect((await detail(page)).width).toBe(fits.width);
});

for (const view of [
  { name: 'popup', path: 'index.html', width: 790, height: 550 },
  { name: 'full view', path: 'index.html?view=tab', width: 1280, height: 800 },
]) {
  test(`${view.name}: the selected category reaches the list's right edge`, async ({
    context,
    extensionId,
  }) => {
    await seedSessions(context, buildContainer());
    const page = await openPage(context, extensionId, view.path, view);
    await settings(page, 'Display');
    const list = await categories(page, 'Display');
    // PREMISE: the list does not scroll, so nothing may stand beside the rows.
    expect(list.scrolls).toBe(false);
    expect(list.gap).toBeCloseTo(0, 0);
  });
}

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

for (const view of [
  // The popup is a fixed 550px tall: its list scrolls only at 24px.
  { name: 'popup', path: 'index.html', width: 790, roots: [24] },
  {
    name: 'full view',
    path: 'index.html?view=tab',
    width: 1280,
    roots: [16, 20, 24],
  },
]) {
  for (const lang of LANGS) {
    test(`${view.name}, ${lang}: the scrolling list's labels stay whole at ${view.roots.join(', ')}px`, async ({
      context,
      extensionId,
    }) => {
      const L = localeStrings(lang);
      const names = labelsIn(lang);
      const rules =
        view.name === 'popup'
          ? {
              maxLines: 2,
              // Chinese and Japanese break between characters by design.
              splitWords: !['ja', 'zh', 'zh-TW'].includes(lang),
            }
          : {};
      await seedSessions(context, buildContainer());
      await seedSettings(context, lang === 'en' ? {} : { language: lang });
      const page = await context.newPage();
      await page.setViewportSize({ width: view.width, height: 300 });
      await page.goto(`chrome-extension://${extensionId}/${view.path}`);
      await page
        .locator(`[aria-label="${L['Settings'] ?? 'Settings'}"]`)
        .first()
        .click();
      await page.locator(`button[aria-label="${names[0]}"]`).click();
      for (const root of view.roots) {
        await page.evaluate((px) => {
          document.documentElement.style.fontSize = `${px}px`;
        }, root);
        // PREMISE: the list scrolls, so its bar takes the column's 10px. The
        // popup's fits in some languages; it scrolls in Swedish, whose label
        // KAN-802 broke.
        if (view.name === 'full view' || lang === 'sv')
          await expect
            .poll(
              async () =>
                (await categories(page, names[0], names, rules)).scrolls
            )
            .toBe(true);
        expect(
          (await categories(page, names[0], names, rules)).broken,
          `${root}px`
        ).toEqual([]);
      }
    });
  }
}
