import type { Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { openPage, POPUP } from './fixtures/onboarding';
import { buildContainer, seedSessions, seedSettings } from './fixtures/seed';

// KAN-716. The popup's Settings content starts under the title's text; the full
// view keeps its width-based indent. Pixels, so a browser has to measure them.

const SECTIONS = [
  'Display',
  'Language',
  'Quick access',
  'Sync & backup',
  'Sessions',
  'Recently deleted',
  'Help',
];

async function openSettings(page: Page, rootPx: number) {
  await page.addStyleTag({
    content: `html{font-size:${rootPx}px !important}`,
  });
  await page.locator('[aria-label="Settings"]').click();
  await page.getByRole('button', { name: 'Go back' }).waitFor();
}

const titleLeft = (page: Page) =>
  page
    .locator('[data-panel="settings-header"] > :last-child')
    .evaluate((el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      return range.getBoundingClientRect().left;
    });

const contentLeft = (page: Page) =>
  page
    .locator('[data-settings-section]')
    .first()
    .evaluate((section) => {
      const { left } = section.getBoundingClientRect();
      return left + parseFloat(getComputedStyle(section).paddingLeft);
    });

for (const rootPx of [16, 20, 24]) {
  test(`popup at a ${rootPx}px root: every section starts under the title`, async ({
    context,
    extensionId,
  }) => {
    await seedSessions(context, buildContainer());
    await seedSettings(context, {});
    const page = await openPage(context, extensionId, 'index.html', POPUP);
    await openSettings(page, rootPx);
    for (const name of SECTIONS) {
      await page.locator(`button[aria-label="${name}"]`).click();
      await expect
        .poll(async () => (await contentLeft(page)) - (await titleLeft(page)), {
          message: name,
        })
        .toBeCloseTo(0, 0);
    }
  });
}

test('full view: the indent stays, on both sides', async ({
  context,
  extensionId,
}) => {
  await seedSessions(context, buildContainer());
  await seedSettings(context, {});
  const page = await openPage(context, extensionId, 'index.html?view=tab', {
    width: 1280,
    height: 800,
  });
  await openSettings(page, 16);
  const section = page.locator('[data-settings-section]').first();
  const padding = await section.evaluate((el) => {
    const style = getComputedStyle(el);
    return [style.paddingLeft, style.paddingRight];
  });
  expect(padding[0]).toBe(padding[1]);
  expect((await contentLeft(page)) - (await titleLeft(page))).toBeGreaterThan(
    30
  );
});
