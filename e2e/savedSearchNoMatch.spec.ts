import type { BrowserContext, Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import {
  buildContainer,
  buildSession,
  seedSessions,
  seedSettings,
} from './fixtures/seed';
import { waitForFontsLoaded } from './fixtures/fonts';

// KAN-385 R4. A search that matches nothing draws one block, centred both ways
// in the pane that would have held the saved session: the detail pane, or the
// list's scroller when the tab view has folded the detail away.

const POPUP = { width: 790, height: 550 };
const TAB = { width: 1280, height: 800 };

async function openSearched(
  context: BrowserContext,
  extensionId: string,
  view: 'popup' | 'tab',
  rootPx: 16 | 20,
  query: string
): Promise<Page> {
  await seedSessions(
    context,
    buildContainer(
      ['Alpha session', 'Beta session'].map((title, i) =>
        buildSession({ tabGroupId: `s${i}`, title })
      )
    )
  );
  if (view === 'tab') {
    await seedSettings(context, { foldSavedSessionInTabView: true });
  }
  const page = await context.newPage();
  await page.setViewportSize(view === 'popup' ? POPUP : TAB);
  await page.goto(
    `chrome-extension://${extensionId}/index.html${
      view === 'tab' ? '?view=tab' : ''
    }`
  );
  const field = page.locator('[data-saved-search] input');
  await field.waitFor();
  await waitForFontsLoaded(page);
  await page.evaluate((px) => {
    document.documentElement.style.fontSize = `${px}px`;
  }, rootPx);
  await field.fill(query);
  await page.locator('[data-no-match]').waitFor();
  return page;
}

// The block's content (drawing, message, hint) as one box, and the box of the
// pane it should be centred in, both from the viewport.
async function geometry(page: Page, holder: 'detail' | 'list') {
  return page.evaluate((which) => {
    const block = document.querySelector('[data-no-match]');
    if (block === null) throw new Error('no block');
    const kids = [...block.children].map((c) => c.getBoundingClientRect());
    const content = {
      left: Math.min(...kids.map((r) => r.left)),
      right: Math.max(...kids.map((r) => r.right)),
      top: Math.min(...kids.map((r) => r.top)),
      bottom: Math.max(...kids.map((r) => r.bottom)),
    };
    const holderEl =
      which === 'detail'
        ? document.querySelector('[data-pane="detail"]')
        : document.querySelector('[data-saved-search]')?.nextElementSibling;
    if (!holderEl) throw new Error('no holder');
    if (!holderEl.contains(block))
      throw new Error('block is not in the holder');
    const pane = holderEl.getBoundingClientRect();
    return {
      content,
      pane: {
        left: pane.left,
        right: pane.right,
        top: pane.top,
        bottom: pane.bottom,
      },
      overflowsX: block.scrollWidth > block.clientWidth,
      overflowsY: block.scrollHeight > block.clientHeight,
      blocks: document.querySelectorAll('[data-no-match]').length,
      message: block.children[1]?.textContent ?? null,
    };
  }, holder);
}

for (const rootPx of [16, 20] as const) {
  test(`popup at a ${rootPx}px root: the block is centred in the detail pane`, async ({
    context,
    extensionId,
  }) => {
    const page = await openSearched(
      context,
      extensionId,
      'popup',
      rootPx,
      '  zzz '
    );
    const g = await geometry(page, 'detail');

    expect(g.blocks).toBe(1);
    expect(g.message).toBe('No saved tab matches "zzz"');
    const cx = (g.content.left + g.content.right) / 2;
    const cy = (g.content.top + g.content.bottom) / 2;
    expect(Math.abs(cx - (g.pane.left + g.pane.right) / 2)).toBeLessThanOrEqual(
      1
    );
    expect(Math.abs(cy - (g.pane.top + g.pane.bottom) / 2)).toBeLessThanOrEqual(
      1
    );
    expect(g.overflowsX).toBe(false);
    expect(g.overflowsY).toBe(false);
    expect(g.content.left).toBeGreaterThanOrEqual(g.pane.left);
    expect(g.content.right).toBeLessThanOrEqual(g.pane.right);
  });
}

test('tab view folded: the block is centred in the list below the search row', async ({
  context,
  extensionId,
}) => {
  const page = await openSearched(context, extensionId, 'tab', 16, 'zzz');
  await expect(page.locator('[data-pane="detail"]')).toHaveCount(0);
  const g = await geometry(page, 'list');

  expect(g.blocks).toBe(1);
  const cx = (g.content.left + g.content.right) / 2;
  const cy = (g.content.top + g.content.bottom) / 2;
  expect(Math.abs(cx - (g.pane.left + g.pane.right) / 2)).toBeLessThanOrEqual(
    1
  );
  expect(Math.abs(cy - (g.pane.top + g.pane.bottom) / 2)).toBeLessThanOrEqual(
    1
  );
  const searchRow = await page
    .locator('[data-saved-search]')
    .evaluate((el) => el.getBoundingClientRect().bottom);
  expect(g.pane.top).toBeGreaterThanOrEqual(searchRow - 1);
  expect(g.overflowsX).toBe(false);
});
