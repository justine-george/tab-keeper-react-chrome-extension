import type { BrowserContext, Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { buildContainer, seedSessions, seedSettings } from './fixtures/seed';
import { localeStrings } from './fixtures/locales';

// KAN-494. A placeholder too long for the save field ends in an ellipsis.
const CLIPPED = '[data-save-row] input { text-overflow: clip !important; }';

async function openAt(
  context: BrowserContext,
  extensionId: string,
  language: string,
  rootPx: number
): Promise<Page> {
  await seedSessions(context, buildContainer());
  await seedSettings(context, { foldSavedSessionInTabView: false, language });
  const page = await context.newPage();
  await page.setViewportSize({ width: 1180, height: 800 });
  await page.goto(`chrome-extension://${extensionId}/index.html?view=tab`);
  await page.locator('[data-save-row] input').waitFor();
  await page.evaluate(
    (px) => (document.documentElement.style.fontSize = `${px}px`),
    rootPx
  );
  return page;
}

const field = (page: Page) => page.locator('[data-save-row] input');

// The drawn field, then the same field with the browser's plain cut-off.
async function drawnBothWays(page: Page) {
  const drawn = await field(page).screenshot();
  await page.addStyleTag({ content: CLIPPED });
  return { drawn, clipped: await field(page).screenshot() };
}

test('a placeholder that does not fit ends in an ellipsis', async ({
  context,
  extensionId,
}) => {
  const page = await openAt(context, extensionId, 'fr', 24);

  const { drawn, clipped } = await drawnBothWays(page);

  expect(drawn.equals(clipped)).toBe(false);
});

test('CONTROL: a placeholder that fits is drawn as it always was', async ({
  context,
  extensionId,
}) => {
  const page = await openAt(context, extensionId, 'en', 16);

  const { drawn, clipped } = await drawnBothWays(page);

  expect(drawn.equals(clipped)).toBe(true);
});

test('a typed name keeps the plain field, and the ellipsis comes back when emptied', async ({
  context,
  extensionId,
}) => {
  const page = await openAt(context, extensionId, 'fr', 24);
  const overflow = () =>
    field(page).evaluate((el) => getComputedStyle(el).textOverflow);
  await expect.poll(overflow).toBe('ellipsis');

  await field(page).fill('A session name far too long for this narrow field');

  await expect.poll(overflow).toBe('clip');

  await field(page).fill('');

  await expect.poll(overflow).toBe('ellipsis');
  await expect(field(page)).toHaveAttribute(
    'placeholder',
    localeStrings('fr')['Name the new session']
  );
});
