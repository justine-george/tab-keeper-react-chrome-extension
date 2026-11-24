import type { Page, Worker } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { elementLanded } from './fixtures/landed';
import { standIn } from './fixtures/standInPages';
import {
  between,
  samples,
  startSampling,
  topOf,
} from './fixtures/glideSamples';

// KAN-997 (his pick B). In Currently open a close offers Reopen on its toast,
// and ⌘Z takes it. The header Undo now does what ⌘Z does: while the offer
// holds the key it is lit, named Reopen, and reopens, the gap opening as the
// toast's Reopen opens it. Once the toast leaves, it is the history's again.

const OPEN_NOW = '[data-pane="open-now"]';
// The header's Undo, named Reopen while it reopens; never a toast's chip.
const headerUndo = (page: Page, name: 'Undo' | 'Reopen') =>
  page.locator(`[role="button"][aria-label="${name}"]:not([role="status"] *)`);

async function liveWindow(worker: Worker, titles: string[]) {
  return worker.evaluate(async (urls) => {
    const w = await chrome.windows.create({ url: urls, focused: false });
    return {
      windowId: w?.id ?? -1,
      tabIds: (w?.tabs ?? []).map((t) => t.id ?? -1),
    };
  }, titles.map(standIn));
}

test('after a close, the header Undo reopens it with the gap opening; once the toast leaves it is dim again', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  const page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`chrome-extension://${extensionId}/index.html?view=tab`);
  await page.locator('[data-tour-anchor="save"]').waitFor();
  const w = await liveWindow(serviceWorker, ['One', 'Two', 'Three', 'Four']);
  const block = page.locator(
    `${OPEN_NOW} [data-open-window-id="${w.windowId}"]`
  );
  await expect(block.locator('[data-open-tab-id]')).toHaveCount(4);
  const three = `${OPEN_NOW} [data-open-tab-id="${w.tabIds[2]}"]`;
  await elementLanded(page.locator(three), 'ancestors');
  const from = await topOf(page.locator(three));
  // PREMISE: nothing to undo yet.
  await expect(headerUndo(page, 'Undo')).toHaveAttribute(
    'aria-disabled',
    'true'
  );

  await page.locator(`${OPEN_NOW} [data-open-tab-id="${w.tabIds[1]}"]`).hover();
  await block
    .getByRole('button', { name: 'Close tab: Two', exact: true })
    .click();
  await expect(block.locator('[data-open-tab-id]')).toHaveCount(3);
  await elementLanded(page.locator(three), 'ancestors');
  const to = await topOf(page.locator(three));
  expect(from - to).toBeGreaterThan(20);

  const button = headerUndo(page, 'Reopen');
  await expect(button).not.toHaveAttribute('aria-disabled', 'true');
  await startSampling(page, { three }, 1500);
  await button.click();
  await page.mouse.move(700, 790);
  const s = await samples(page);
  await expect(block.locator('[data-open-tab-id]')).toHaveCount(4);
  await expect.poll(() => topOf(page.locator(three))).toBeCloseTo(from, 0);
  expect(between(s.three, to, from).length).toBeGreaterThanOrEqual(3);
  await expect(page.getByRole('status')).not.toContainText('Tab closed');
  await expect(headerUndo(page, 'Undo')).toHaveAttribute(
    'aria-disabled',
    'true'
  );

  // Closed again, and the toast closed: the offer goes with it, and the button with the offer.
  await page
    .locator(`${OPEN_NOW} [data-open-tab-id]`)
    .filter({ hasText: 'Two' })
    .hover();
  await block
    .getByRole('button', { name: 'Close tab: Two', exact: true })
    .click();
  await expect(headerUndo(page, 'Reopen')).toHaveCount(1);
  await page
    .getByRole('status')
    .getByRole('button', { name: /^Close/ })
    .first()
    .click();
  await expect(headerUndo(page, 'Reopen')).toHaveCount(0);
  await expect(headerUndo(page, 'Undo')).toHaveAttribute(
    'aria-disabled',
    'true'
  );
});
