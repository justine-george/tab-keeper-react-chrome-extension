import type { Page } from '@playwright/test';

import { putDeviceId } from './fixtures/cloud';
import { test, expect } from './fixtures/extension';
import { FULL, FULL_VIEW_PATH, openPage, POPUP } from './fixtures/onboarding';
import { buildContainer, seedSessions, seedSettings } from './fixtures/seed';

// KAN-921. Every dialog title is regular weight, larger in the full view, and
// a title icon starts where the body text does.

const title = (page: Page) =>
  page.evaluate(() => {
    const style = getComputedStyle(document.querySelector('dialog[open] h2')!);
    return { size: style.fontSize, weight: style.fontWeight };
  });

const openSyncPane = async (page: Page) => {
  await page.locator('[aria-label="Settings"]').click();
  await page.locator('button[aria-label="Sync & backup"]').click();
};

const askToSync = async (page: Page) => {
  await page
    .getByRole('group', { name: 'Auto sync' })
    .getByRole('button', { name: 'On', exact: true })
    .click();
  const ask = page.getByRole('dialog', {
    name: 'Sync your sessions across devices?',
    exact: true,
  });
  await expect(ask).toBeVisible();
  return ask;
};

test.beforeEach(async ({ context, serviceWorker }) => {
  await seedSettings(context, { cloudConsent: 'declined', isAutoSync: false });
  await seedSessions(context, buildContainer());
  await putDeviceId(serviceWorker);
});

for (const [view, path, size, px] of [
  ['popup', 'index.html', POPUP, '17.6px'],
  ['full view', FULL_VIEW_PATH, FULL, '20px'],
] as const) {
  test(`${view}: the sync question and a confirm dialog share a title style`, async ({
    context,
    extensionId,
  }) => {
    const page = await openPage(context, extensionId, path, size);
    await openSyncPane(page);

    const ask = await askToSync(page);
    expect(await title(page)).toEqual({ size: px, weight: '400' });
    await ask.getByRole('button', { name: 'Not now', exact: true }).click();

    await page.getByRole('button', { name: 'Delete cloud data' }).click();
    await expect(
      page.getByRole('dialog', { name: 'Delete your cloud data?' })
    ).toBeVisible();
    expect(await title(page)).toEqual({ size: px, weight: '400' });
  });
}

test('the title icon starts where the body text starts', async ({
  context,
  extensionId,
}) => {
  const page = await openPage(context, extensionId, 'index.html', POPUP);
  await openSyncPane(page);
  await askToSync(page);
  const edges = await page.evaluate(() => {
    const dialog = document.querySelector('dialog[open]')!;
    const glyph = dialog.querySelector('h2')!.firstElementChild!;
    const icon = glyph.querySelector('*') ?? glyph;
    const text = document.createRange();
    text.selectNodeContents(dialog.querySelector('p')!);
    return {
      icon: icon.getBoundingClientRect().left,
      text: text.getBoundingClientRect().left,
    };
  });
  expect(edges.icon).toBe(edges.text);
});
