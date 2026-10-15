import type { BrowserContext, Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { buildContainer, buildSession, seedSessions } from './fixtures/seed';

// KAN-474. A seed is an init script, which re-runs in every document: a reload, a later page, a frame. Each seed runs once.

const seedTitled = (context: BrowserContext, title: string) =>
  seedSessions(
    context,
    buildContainer([buildSession({ tabGroupId: title, title })])
  );

async function openSessions(
  context: BrowserContext,
  extensionId: string,
  title: string
): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/index.html`);
  // Barrier: the app mounted on what storage held.
  await expect(page.getByText(title, { exact: true }).first()).toBeVisible();
  return page;
}

const storedTitles = (page: Page) =>
  page.evaluate(() =>
    (
      JSON.parse(localStorage.getItem('tabContainerData') ?? 'null') as {
        tabGroups: { title: string }[];
      } | null
    )?.tabGroups.map((s) => s.title)
  );

// What a page wrote after the seed: the store's own key, as the app saves it.
const write = (page: Page, title: string) =>
  page.evaluate(
    (data) => localStorage.setItem('tabContainerData', data),
    JSON.stringify(buildContainer([buildSession({ tabGroupId: title, title })]))
  );

test.describe('a seed runs once (KAN-474)', () => {
  test('a reload keeps what the page wrote', async ({
    context,
    extensionId,
  }) => {
    await seedTitled(context, 'Seeded');
    const page = await openSessions(context, extensionId, 'Seeded');
    await write(page, 'Written');

    await page.reload();

    await expect(
      page.getByText('Written', { exact: true }).first()
    ).toBeVisible();
    expect(await storedTitles(page)).toEqual(['Written']);
  });

  test('a page opened after the write keeps it', async ({
    context,
    extensionId,
  }) => {
    await seedTitled(context, 'Seeded');
    const first = await openSessions(context, extensionId, 'Seeded');
    await write(first, 'Written');

    const second = await openSessions(context, extensionId, 'Written');

    expect(await storedTitles(second)).toEqual(['Written']);
    expect(await storedTitles(first)).toEqual(['Written']);
  });

  test('a later seed replaces an earlier one', async ({
    context,
    extensionId,
  }) => {
    await seedTitled(context, 'First');
    await seedTitled(context, 'Second');

    const page = await openSessions(context, extensionId, 'Second');

    expect(await storedTitles(page)).toEqual(['Second']);
  });

  test('a seed added after a page loaded applies on the next page', async ({
    context,
    extensionId,
  }) => {
    await seedTitled(context, 'First');
    await openSessions(context, extensionId, 'First');
    await seedTitled(context, 'Second');

    const next = await openSessions(context, extensionId, 'Second');

    expect(await storedTitles(next)).toEqual(['Second']);
  });
});
