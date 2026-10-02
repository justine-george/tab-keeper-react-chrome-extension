import type { BrowserContext, Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import {
  buildContainer,
  buildSession,
  seedSessions,
  seedSettings,
} from './fixtures/seed';

// KAN-235. The header's content sits in a centred band near the 720px document.
// 1100px is the one-line floor: ru, the widest locale, needs 1061px, so it is
// the locale measured here.

const HEADER_CONTENT_MAX_PX = 1100;
const WIDE = { width: 2000, height: 420 };
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

/** The header, its two content blocks, and how many lines the toolbar takes. */
const geometry = (page: Page) =>
  page.evaluate(() => {
    const row = document.querySelector<HTMLElement>('[data-toolbar-row]')!;
    const header = row.parentElement!;
    const title = row.previousElementSibling as HTMLElement;
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
      viewport: window.innerWidth,
      header: r(header),
      headerPadding: parseFloat(getComputedStyle(header).paddingLeft),
      title: r(title),
      toolbar: r(row),
      toolbarLines,
    };
  });

for (const lang of ['en', 'ru']) {
  test(`at 2000px the header content sits in a centred ${HEADER_CONTENT_MAX_PX}px band, on one line (${lang})`, async ({
    context,
    extensionId,
  }) => {
    const page = await openExport(context, extensionId, WIDE, lang);
    const g = await geometry(page);

    // Only the content is constrained; the band is full bleed.
    expect(g.header.left).toBe(0);
    expect(g.header.right).toBe(WIDE.width);

    const expectedLeft = (WIDE.width - HEADER_CONTENT_MAX_PX) / 2;
    expect(g.toolbar.width).toBeCloseTo(HEADER_CONTENT_MAX_PX, 0);
    expect(g.toolbar.left).toBeCloseTo(expectedLeft, 0);
    expect(g.toolbar.right).toBeCloseTo(
      expectedLeft + HEADER_CONTENT_MAX_PX,
      0
    );
    expect(g.title.left).toBeCloseTo(g.toolbar.left, 0);
    expect(g.title.right).toBeCloseTo(g.toolbar.right, 0);

    expect(g.toolbarLines).toBe(1);
  });
}

// CONTROL: a band that also squeezed narrow screens would pass everything
// above.
test('at 790px the layout is what it was: content runs gutter to gutter', async ({
  context,
  extensionId,
}) => {
  const page = await openExport(context, extensionId, POPUP);
  const g = await geometry(page);

  expect(g.headerPadding).toBe(16);
  expect(g.toolbar.left).toBeCloseTo(g.header.left + 16, 0);
  expect(g.toolbar.right).toBeCloseTo(g.header.right - 16, 0);
  expect(g.title.left).toBeCloseTo(g.header.left + 16, 0);
});
