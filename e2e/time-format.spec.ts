import type { BrowserContext, Locator, Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { buildSession, seedSettings } from './fixtures/seed';
import { seedOnce } from './fixtures/cloud';
import { POPUP, TAB_VIEW } from './fixtures/savedWindows';

// KAN-587 on the real artifact: 12-hour unless picked; Settings › Display ›
// 24-hour redraws the rows, survives a reload, and reaches another open page
// through the storage event. Nothing here differs by OS.

// Built here, in the runner's clock; the browser shares the machine's zone.
const todayAt = (h: number, m: number): number => {
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.getTime();
};

const EDITED = todayAt(15, 9);
const SESSIONS = [
  {
    ...buildSession({ tabGroupId: 's-alpha', title: 'Alpha' }),
    createdAt: todayAt(9, 0),
    contentModified: EDITED,
  },
];

async function openPage(
  context: BrowserContext,
  extensionId: string,
  query = '',
  size = POPUP
): Promise<Page> {
  const page = await context.newPage();
  await page.setViewportSize(size);
  await page.goto(`chrome-extension://${extensionId}/index.html${query}`);
  // Barrier: goto resolves before React mounts. Locale-free.
  await page.locator('[data-tour-anchor="save"]').waitFor();
  return page;
}

const sessions = (page: Page): Locator =>
  page.locator('[data-pane="sessions"]');

async function pick(page: Page, side: '12-hour' | '24-hour'): Promise<void> {
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Display', exact: true }).click();
  await page
    .getByRole('group', { name: 'Time format' })
    .getByRole('button', { name: side, exact: true })
    .click();
  await page.getByText('Back', { exact: true }).click();
}

test.beforeEach(async ({ context }) => {
  await seedOnce(context, SESSIONS);
});

test('12-hour by default; 24-hour redraws the row and its hover, and survives a reload', async ({
  context,
  extensionId,
}) => {
  const page = await openPage(context, extensionId);
  await expect(sessions(page)).toContainText(/Edited today, 3:09\sPM/);

  await pick(page, '24-hour');
  await expect(sessions(page)).toContainText('Edited today, 15:09');
  await expect(
    sessions(page).locator('[title]', { hasText: 'Edited today, 15:09' })
  ).toHaveAttribute('title', /15:09:00/);

  await page.reload();
  await page.locator('[data-tour-anchor="save"]').waitFor();
  await expect(sessions(page)).toContainText('Edited today, 15:09');
});

test('another open page redraws without a reload', async ({
  context,
  extensionId,
}) => {
  const tab = await openPage(context, extensionId, '?view=tab', TAB_VIEW);
  await expect(sessions(tab)).toContainText(/Edited today, 3:09\sPM/);

  const popup = await openPage(context, extensionId);
  await pick(popup, '24-hour');

  await expect(sessions(tab)).toContainText('Edited today, 15:09');
});

// The hover is the one place Chromium would also change the DATE: zh 12-hour
// draws 2026/10/14 where Chinese reads 2026年10月14日 (review, measured in
// Chromium 156). Only a real browser's ICU shows it.
test('Chinese, 12-hour by default: the hover keeps the date as Chinese writes it', async ({
  context,
  extensionId,
}) => {
  await seedSettings(context, { language: 'zh' });
  const page = await openPage(context, extensionId);
  const d = new Date(EDITED);
  await expect(
    sessions(page).locator('[title]', { hasText: '下午3:09' })
  ).toHaveAttribute(
    'title',
    `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 下午3:09:00`
  );
});
