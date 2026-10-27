import type { Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import {
  FULL_RUN,
  cardAt,
  centreOf,
  nextTo,
  openRunFromHelp,
  replayNote,
} from './fixtures/run';
import { seedSettings } from './fixtures/seed';

// KAN-813. During the tour, Esc closes the innermost overlay first: the open
// Currently open drawer, then a field's text inside it, before the card skips.

const NARROW = { width: 1000, height: 800 };
const rail = (page: Page) =>
  page.getByRole('button', { name: /^Currently open/ });
const drawer = (page: Page) =>
  page.getByRole('dialog', { name: 'Currently open', exact: true });

async function drawerOpenAtStep2(
  context: Parameters<typeof openRunFromHelp>[0],
  extensionId: string
): Promise<Page> {
  // The saved session shown leaves Currently open the narrow rail.
  await seedSettings(context, { foldSavedSessionInTabView: false });
  const page = await openRunFromHelp(context, extensionId, {
    ...FULL_RUN,
    viewport: NARROW,
  });
  await nextTo(page, 2);
  const [x, y] = await centreOf(rail(page));
  await page.mouse.click(x, y);
  await expect(drawer(page)).toBeVisible();
  return page;
}

test('Esc with the drawer open closes the drawer and keeps the tour at step 2', async ({
  context,
  extensionId,
}) => {
  const page = await drawerOpenAtStep2(context, extensionId);

  await page.keyboard.press('Escape');

  await expect(drawer(page)).toHaveCount(0);
  await expect(rail(page)).toBeFocused();
  await expect(cardAt(page, 2)).toBeVisible();

  // CONTROL: with the drawer closed, Esc is the card's Skip tutorial again.
  await page.keyboard.press('Escape');
  await expect(replayNote(page)).toBeVisible();
  await expect(page.locator('[data-coach-step]')).toHaveCount(0);
});

test('Esc in the drawer’s search clears the text first; the drawer and the tour stay', async ({
  context,
  extensionId,
}) => {
  const page = await drawerOpenAtStep2(context, extensionId);
  const search = drawer(page).getByRole('textbox', {
    name: 'Search open tabs',
  });
  await search.fill('zzz');

  await page.keyboard.press('Escape');

  await expect(search).toHaveValue('');
  await expect(drawer(page)).toBeVisible();
  await expect(cardAt(page, 2)).toBeVisible();

  // Empty, the field passes Esc on: the drawer closes, the tour stays.
  await page.keyboard.press('Escape');
  await expect(drawer(page)).toHaveCount(0);
  await expect(cardAt(page, 2)).toBeVisible();
});
