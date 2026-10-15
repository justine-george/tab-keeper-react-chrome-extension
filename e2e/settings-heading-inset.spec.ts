import type { Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { buildSession, seedSessions } from './fixtures/seed';
import { POPUP } from './fixtures/savedWindows';

// KAN-606. Every Settings panel puts its first heading 20px below the details
// pane's content top, except Recently deleted, whose title sat 23.28px down:
// its header row centred the title block in a 48px row, and the title used
// line-height 1.45 where the others use normal. About is left out: its first
// line is the product name beside the logo, not a heading.

const PANELS = [
  'Display',
  'Sync & Backup',
  'Sessions',
  'Recently deleted',
  'Language',
  'Help',
];

const SIZES = [
  { name: 'popup', query: '', size: POPUP },
  {
    name: 'full view 1600x900',
    query: '?view=tab',
    size: { width: 1600, height: 900 },
  },
  {
    name: 'full view 1024x768',
    query: '?view=tab',
    size: { width: 1024, height: 768 },
  },
];

/**
 * The pane's first text and its top, from the details pane's content top, read
 * with a DOM range. Null until the settings pane has mounted.
 */
function firstLine(
  page: Page
): Promise<{ text: string; inset: number } | null> {
  return page.evaluate(() => {
    let pane = document.querySelector<HTMLElement>('[data-settings-section]');
    while (pane && getComputedStyle(pane).borderTopWidth === '0px') {
      pane = pane.parentElement;
    }
    if (!pane) return null;
    const style = getComputedStyle(pane);
    const contentTop =
      pane.getBoundingClientRect().top +
      pane.clientTop +
      parseFloat(style.paddingTop);
    const walker = document.createTreeWalker(pane, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) =>
        n.textContent?.trim()
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_SKIP,
    });
    const text = walker.nextNode();
    if (!text) return null;
    const range = document.createRange();
    range.selectNodeContents(text);
    return {
      text: (text.textContent ?? '').trim(),
      inset: range.getBoundingClientRect().top - contentTop,
    };
  });
}

async function insets(page: Page): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  let shown = '';
  for (const panel of PANELS) {
    await page.getByRole('button', { name: panel, exact: true }).click();
    // Barrier: the rail marks no selection, so wait for the panel's first line to change.
    await expect
      .poll(async () => (await firstLine(page))?.text ?? shown)
      .not.toBe(shown);
    const line = await firstLine(page);
    if (!line) throw new Error(`${panel}: the pane went away`);
    shown = line.text;
    out[panel] = round(line.inset);
  }
  return out;
}

const round = (n: number) => Math.round(n * 100) / 100;

const allAt20 = Object.fromEntries(PANELS.map((p) => [p, 20]));

for (const { name, query, size } of SIZES) {
  test(`${name}: every panel's first heading sits 20px below the pane top`, async ({
    context,
    extensionId,
  }) => {
    await seedSessions(context);
    const page = await context.newPage();
    await page.setViewportSize(size);
    await page.goto(`chrome-extension://${extensionId}/index.html${query}`);
    await page.getByRole('button', { name: 'Settings' }).click();

    expect(await insets(page)).toEqual(allAt20);
  });
}

test('with a deleted session listed, the Empty button does not push the title down', async ({
  context,
  extensionId,
}) => {
  await seedSessions(context);
  const page = await context.newPage();
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(`chrome-extension://${extensionId}/index.html?view=tab`);
  await page.getByRole('button', { name: 'Settings' }).click();
  await page
    .getByRole('button', { name: 'Recently deleted', exact: true })
    .click();
  await page.evaluate(
    async (session) => {
      await chrome.storage.local.set({
        recentlyDeleted: [{ session, deletedAt: Date.now() }],
      });
    },
    buildSession({ tabGroupId: 'gone', title: 'Lisbon trip' })
  );
  await expect(page.getByTestId('recently-deleted-row')).toHaveCount(1);
  await expect(
    page.getByRole('button', { name: 'Empty', exact: true })
  ).toBeVisible();

  const line = await firstLine(page);
  expect(line?.text).toBe('Recently deleted');
  expect(round(line?.inset ?? NaN)).toBe(20);
});
