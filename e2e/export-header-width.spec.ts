import type { BrowserContext, Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import {
  buildContainer,
  buildSession,
  seedSessions,
  seedSettings,
} from './fixtures/seed';

// KAN-235. The header's content sits in a centred band near the 720px document.
// KAN-742: every locale's toolbar must fit one line in it, so all 13 are measured.
// KAN-880: the band is the sheet's width (816 at most), so the toolbar's edges are the sheet's.

const SHEET_MAX_PX = 816;
const WIDE = { width: 2000, height: 420 };
const ALL_LANGS = [
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

const POPUP = { width: 790, height: 550 };

const SESSION = buildSession({
  tabGroupId: 'session-wide',
  title: 'Q4 product roadmap',
  isSelected: true,
});

async function openExport(
  context: BrowserContext,
  extensionId: string,
  viewport: { width: number; height: number },
  lang = 'en'
): Promise<Page> {
  await seedSessions(context, {
    ...buildContainer([SESSION]),
    selectedTabGroupId: 'session-wide',
  });
  await seedSettings(context, { language: lang });
  const page = await context.newPage();
  await page.setViewportSize(viewport);
  await page.goto(
    `chrome-extension://${extensionId}/export.html?session=session-wide`
  );
  await expect(page.locator('[data-toolbar-row]')).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  return page;
}

/** The header, its two lines (the way back, the toolbar), the sheet, and how many lines the toolbar takes. */
const geometry = (page: Page) =>
  page.evaluate(() => {
    const row = document.querySelector('[data-toolbar-row]')!;
    const header = row.parentElement!;
    const back = row.previousElementSibling!;
    const r = (el: Element) => {
      const b = el.getBoundingClientRect();
      return { left: b.left, right: b.right, width: b.width };
    };
    // Lines from the row's height, not button tops: the pairs' 28px buttons sit
    // 3px lower than 34px neighbours, so tops read 2 lines on one row
    // (measured).
    const tallest = Math.max(
      ...Array.from(row.querySelectorAll('button')).map(
        (b) => b.getBoundingClientRect().height
      )
    );
    const toolbarLines = Math.round(
      (row.getBoundingClientRect().height + 10) / (tallest + 10)
    );
    return {
      // The window less a reserved scrollbar gutter (KAN-880): 0px where scroll bars overlay, ~15px where they always show.
      // From the body's box: an empty reserved gutter leaves documentElement.clientWidth at the window's width (CI, measured).
      layoutWidth: document.body.getBoundingClientRect().width,
      header: r(header),
      back: r(back),
      // The way back is the line's one control, named in any language.
      hasLink: back.querySelectorAll('button').length === 1,
      // After the mode label: the preview's frame, or the editor's sheet.
      sheet: r(header.nextElementSibling!.nextElementSibling!),
      toolbar: r(row),
      toolbarLines,
    };
  });

/** The row's own one-line width, for the slack each locale leaves. */
const oneLineWidth = (page: Page) =>
  page.evaluate(() => {
    const row = document.querySelector<HTMLElement>('[data-toolbar-row]');
    if (!row) throw new Error('no toolbar');
    const saved = row.style.cssText;
    row.style.width = 'max-content';
    row.style.maxWidth = 'none';
    const width = Math.round(row.getBoundingClientRect().width);
    row.style.cssText = saved;
    return width;
  });

for (const lang of ALL_LANGS) {
  test(`at 2000px the header content is the ${SHEET_MAX_PX}px sheet's width, centred, on one line (${lang})`, async ({
    context,
    extensionId,
  }) => {
    const page = await openExport(context, extensionId, WIDE, lang);
    const g = await geometry(page);

    // Only the content is constrained; the header itself is full bleed, up to any scrollbar gutter.
    expect(WIDE.width - g.layoutWidth).toBeLessThanOrEqual(20);
    expect(g.header.left).toBe(0);
    expect(g.header.right).toBe(g.layoutWidth);

    const expectedLeft = (g.layoutWidth - SHEET_MAX_PX) / 2;
    expect(g.toolbar.width).toBeCloseTo(SHEET_MAX_PX, 0);
    expect(g.toolbar.left).toBeCloseTo(expectedLeft, 0);
    expect(g.toolbar.right).toBeCloseTo(expectedLeft + SHEET_MAX_PX, 0);
    // The way back's line, and the sheet, share the toolbar's edges.
    expect(g.hasLink).toBe(true);
    expect(g.back.left).toBeCloseTo(g.toolbar.left, 0);
    expect(g.back.right).toBeCloseTo(g.toolbar.right, 0);
    expect(g.sheet.left).toBeCloseTo(g.toolbar.left, 0);
    expect(g.sheet.right).toBeCloseTo(g.toolbar.right, 0);

    const oneLine = await oneLineWidth(page);
    console.log(`${lang}: one line ${oneLine}px of ${SHEET_MAX_PX}px`);
    expect(g.toolbarLines).toBe(1);
  });
}

// KAN-734. Editing swaps the row but not the band. KAN-831: Done starts it,
// where Edit stood, and the tally ends it.
test(`at 2000px the editing row's Done and tally span the ${SHEET_MAX_PX}px band (ru)`, async ({
  context,
  extensionId,
}) => {
  const page = await openExport(context, extensionId, WIDE, 'ru');
  await page.locator('[data-toolbar-row] button').first().click();
  const tally = page.locator('[data-toolbar-row] [role="status"]');
  await expect(tally).toBeVisible();
  const g = await geometry(page);
  // The row is the band's width whatever it holds; its ends are what count.
  const tallyBox = (await tally.boundingBox())!;
  const done = (await page
    .locator('[data-toolbar-row] button')
    .first()
    .boundingBox())!;

  const expectedLeft = (g.layoutWidth - SHEET_MAX_PX) / 2;
  expect(done.x, 'Done starts the band').toBeCloseTo(expectedLeft, 0);
  expect(tallyBox.x + tallyBox.width, 'the tally ends the band').toBeCloseTo(
    expectedLeft + SHEET_MAX_PX,
    0
  );
  expect(g.toolbarLines).toBe(1);
  // The editor's sheet has the preview's edges (KAN-880).
  expect(g.sheet.left).toBeCloseTo(expectedLeft, 0);
  expect(g.sheet.right).toBeCloseTo(expectedLeft + SHEET_MAX_PX, 0);
});

// KAN-827. As words, Compact and Comfortable wrapped the row at the popup's width in these two.
for (const lang of ['ru', 'de']) {
  test(`at 790px the preview toolbar fits one line, but ru wraps to two (${lang})`, async ({
    context,
    extensionId,
  }) => {
    const page = await openExport(context, extensionId, POPUP, lang);
    const g = await geometry(page);
    console.log(
      `${lang} at 790: one line ${await oneLineWidth(page)}px of ${g.toolbar.width}px`
    );
    // Open, his call (KAN-880): the sheet's 24px gutters leave ru 742px at 790 for its 746px toolbar.
    expect(g.toolbarLines).toBe(lang === 'ru' ? 2 : 1);
  });
}

// CONTROL: a band that also squeezed narrow screens would pass everything
// above. Narrow, the sheet is the window less 24px each side, and the header's content with it.
test('at 790px the content runs 24px in from each side, on the sheet edges', async ({
  context,
  extensionId,
}) => {
  const page = await openExport(context, extensionId, POPUP);
  const g = await geometry(page);

  expect(g.toolbar.left).toBeCloseTo(g.header.left + 24, 0);
  expect(g.toolbar.right).toBeCloseTo(g.header.right - 24, 0);
  expect(g.back.left).toBeCloseTo(g.toolbar.left, 0);
  expect(g.sheet.left).toBeCloseTo(g.toolbar.left, 0);
  expect(g.sheet.right).toBeCloseTo(g.toolbar.right, 0);
});
