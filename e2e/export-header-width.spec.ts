import type { BrowserContext, Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import {
  buildContainer,
  buildSession,
  seedSessions,
  seedSettings,
} from './fixtures/seed';

// KAN-235. On a wide screen the export page's header content stays near the
// document instead of running to the monitor's edges.
//
// The document sits in a centred 720px column. The header -- title block and
// toolbar -- ran edge to edge, so at 2000px wide Edit sat at x=16 and PDF /
// Print at x=1984 while the thing they act on sat in the middle. The header's
// CONTENT now lives in a centred 1100px band; its full-bleed background and
// 16px gutter are unchanged, and below 1100px so is everything else.
//
// 1100 is the one-line floor: the toolbar wraps its right-hand group onto its
// own line when it cannot fit, and the widest locale's one-line width is
// Russian at 1061px. So the second theme measured here is ru, not de: it is
// the one that would wrap under a tighter band.

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
    // Lines from the ROW'S HEIGHT, not from the buttons' tops: the sliding
    // pairs' buttons are 28px inside 34px neighbours and sit 3px lower when
    // centred, so a set of rounded tops reads 2 on a single row. Measured.
    // One row is the tallest control (34px); a wrapped row is at least two
    // of those plus the 10px gap.
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

    // The band itself is full bleed: only its CONTENT is constrained.
    expect(g.header.left).toBe(0);
    expect(g.header.right).toBe(WIDE.width);

    const expectedLeft = (WIDE.width - HEADER_CONTENT_MAX_PX) / 2;
    expect(g.toolbar.width).toBeCloseTo(HEADER_CONTENT_MAX_PX, 0);
    expect(g.toolbar.left).toBeCloseTo(expectedLeft, 0);
    expect(g.toolbar.right).toBeCloseTo(
      expectedLeft + HEADER_CONTENT_MAX_PX,
      0
    );
    // The title block shares the band, so the two read as one header.
    expect(g.title.left).toBeCloseTo(g.toolbar.left, 0);
    expect(g.title.right).toBeCloseTo(g.toolbar.right, 0);

    // What the number was chosen for.
    expect(g.toolbarLines).toBe(1);
  });
}

// CONTROL: at the popup's width the constraint is inert -- the content edges
// are the header's own padding edges, exactly as before this change. Without
// this, a band that also squeezed narrow screens would pass everything above.
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
