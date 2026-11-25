import type { BrowserContext, Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import {
  buildContainer,
  buildSession,
  seedSessions,
  seedSettings,
} from './fixtures/seed';

// KAN-1003 (his pick B). The top row sits on one line, the pane title's: the
// app header's title and icons, each pane's title and its » « button, and
// each rail's glyph share one centre. Measured on the real artifact: jsdom
// has no layout.

const WIDE = { width: 1280, height: 800 };
const POPUP = { width: 790, height: 550 };

async function open(
  context: BrowserContext,
  extensionId: string,
  folds: { saved: boolean; openNow: boolean },
  viewport = WIDE,
  path = 'index.html?view=tab'
): Promise<Page> {
  await seedSessions(context, {
    ...buildContainer([
      {
        ...buildSession({ tabGroupId: 'S1', title: 'Kyoto plans' }),
        isSelected: true,
      },
    ]),
    selectedTabGroupId: 'S1',
  });
  await seedSettings(context, {
    foldSavedSessionInTabView: folds.saved,
    foldOpenNowInTabView: folds.openNow,
  });
  const page = await context.newPage();
  await page.setViewportSize(viewport);
  await page.goto(`chrome-extension://${extensionId}/${path}`);
  await page.locator('[data-drag-row-id]').first().waitFor();
  return page;
}

// Each drawn part's vertical centre: a text by its line box, a glyph by its
// icon box (the icon font centres its ink there).
async function centres(page: Page): Promise<Record<string, number>> {
  return page.evaluate(() => {
    const out: Record<string, number> = {};
    const mid = (r: DOMRect) => (r.top + r.bottom) / 2;
    const text = (name: string, el: Element | null | undefined) => {
      if (!el) return;
      const range = document.createRange();
      range.selectNodeContents(el);
      out[name] = mid(range.getBoundingClientRect());
    };
    const glyph = (name: string, el: Element | null | undefined) => {
      const icon = el?.matches('[data-icon]')
        ? el
        : el?.querySelector('[data-icon]');
      if (icon) out[name] = mid(icon.getBoundingClientRect());
    };
    const sessions = document.querySelector('[data-pane="sessions"]');
    const title = [...(sessions?.querySelectorAll('*') ?? [])].find(
      (e) => e.childElementCount === 0 && e.textContent === 'Tab Keeper'
    );
    text('app title', title);
    // The header row: the title's nearest ancestor that holds the icons too.
    let row = title?.parentElement ?? null;
    while (row !== null && row.querySelectorAll('[data-icon]').length < 3)
      row = row.parentElement;
    row?.querySelectorAll('[data-icon]').forEach((icon, i) => {
      const label =
        icon.closest('[aria-label]')?.getAttribute('aria-label') ?? `#${i}`;
      glyph(`app icon: ${label}`, icon);
    });
    const savedAction = document.querySelector(
      '[data-pane="detail"] [data-pane-layer="saved-title-action"]'
    );
    text(
      'saved title',
      savedAction?.parentElement?.querySelector(
        '[role="button"] span, button span'
      )
    );
    glyph('saved title button', savedAction);
    text(
      'Currently open title',
      document.querySelector('[data-pane="open-now"] h2 span')
    );
    glyph(
      'Currently open fold',
      document.querySelector('[data-pane="open-now"] [data-tour-anchor="fold"]')
    );
    glyph(
      'Currently open rail',
      document.querySelector('[data-open-now-rail] > button')
    );
    glyph(
      'saved session card',
      document.querySelector('[data-saved-session-card]')
    );
    return out;
  });
}

function expectOneLine(
  found: Record<string, number>,
  line: number,
  parts: string[]
) {
  for (const part of parts) expect(Object.keys(found)).toContain(part);
  const off = Object.entries(found).filter(([, y]) => Math.abs(y - line) > 0.5);
  expect(off, `centres off the ${line}px line`).toEqual([]);
}

test('Currently open folded: the app header, the saved title and the rail share one line', async ({
  context,
  extensionId,
}) => {
  const page = await open(context, extensionId, {
    saved: false,
    openNow: true,
  });
  const found = await centres(page);
  expectOneLine(found, found['saved title'], [
    'app title',
    'app icon: Settings',
    'saved title button',
    'Currently open rail',
  ]);
});

test('the saved session folded: the app header, the card and the Currently open title share one line', async ({
  context,
  extensionId,
}) => {
  const page = await open(context, extensionId, {
    saved: true,
    openNow: false,
  });
  const found = await centres(page);
  expectOneLine(found, found['Currently open title'], [
    'app title',
    'app icon: Settings',
    'Currently open fold',
    'saved session card',
  ]);
});

test('both shown: the app header and both titles share one line', async ({
  context,
  extensionId,
}) => {
  const page = await open(context, extensionId, {
    saved: false,
    openNow: false,
  });
  const found = await centres(page);
  expectOneLine(found, found['saved title'], [
    'app title',
    'app icon: Settings',
    'saved title button',
    'Currently open title',
    'Currently open fold',
  ]);
});

test('the popup: the app header and the saved title share one line', async ({
  context,
  extensionId,
}) => {
  const page = await open(
    context,
    extensionId,
    { saved: false, openNow: false },
    POPUP,
    'index.html'
  );
  const found = await centres(page);
  expectOneLine(found, found['saved title'], [
    'app title',
    'app icon: Settings',
  ]);
});
