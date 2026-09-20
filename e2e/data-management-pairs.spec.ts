import type { Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { buildContainer, seedSessions } from './fixtures/seed';

// KAN-249. The Data Management toggles were the two Buttons whose whole text
// was their value ("On"), the shape KAN-248 replaced on the Sync pane; the
// pane next door showed a pair and this one the ambiguous button. Both are
// pairs now. The memory toggle is a store setting and round-trips through
// storage; Save Tab Groups asks Chrome for a permission, and no e2e profile
// can pre-grant an optional one, so what is asserted there is the pair's
// shape and that Off is the pressed side in a fresh profile.

// No seedSettings here on purpose. It is an addInitScript, so it re-runs on
// every page the context opens -- including the reopen below -- and would
// write the seeded settings back over what the app saved, making "the choice
// survives a reopen" pass or fail on the fixture rather than the app. The
// memory toggle defaults to On, which is the state the test starts from.
async function openDataManagement(
  context: Parameters<typeof seedSessions>[0],
  extensionId: string
): Promise<Page> {
  await seedSessions(context, buildContainer());
  const page = await context.newPage();
  await page.setViewportSize({ width: 790, height: 550 });
  await page.goto(`chrome-extension://${extensionId}/index.html`);
  await page.locator('[aria-label="Settings"]').click();
  await page.locator('button[aria-label="Data Management"]').click();
  await expect(
    page.getByRole('group', {
      name: 'Optimize Memory Usage On Session Restore',
    })
  ).toBeVisible();
  return page;
}

const pair = (page: Page, name: string) => page.getByRole('group', { name });
const side = (page: Page, name: string, word: 'On' | 'Off') =>
  pair(page, name).getByRole('button', { name: word });

const MEMORY = 'Optimize Memory Usage On Session Restore';
const GROUPS = 'Save Tab Groups';

test.describe('the Data Management toggles are pairs (KAN-249)', () => {
  test('both are groups named for their setting, on the popup scale', async ({
    context,
    extensionId,
  }) => {
    const page = await openDataManagement(context, extensionId);
    for (const name of [MEMORY, GROUPS]) {
      const box = (await pair(page, name).boundingBox())!;
      expect(box.height, name).toBe(32);
      await expect(side(page, name, 'On')).toBeVisible();
      await expect(side(page, name, 'Off')).toBeVisible();
    }
    // A fresh profile holds no optional permission: Off is pressed.
    await expect(side(page, GROUPS, 'Off')).toHaveAttribute(
      'aria-pressed',
      'true'
    );
  });

  test('the memory pair flips, and the choice survives a reopen', async ({
    context,
    extensionId,
  }) => {
    const page = await openDataManagement(context, extensionId);
    await expect(side(page, MEMORY, 'On')).toHaveAttribute(
      'aria-pressed',
      'true'
    );

    await side(page, MEMORY, 'Off').click();
    await expect(side(page, MEMORY, 'Off')).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    await expect(side(page, MEMORY, 'On')).toHaveAttribute(
      'aria-pressed',
      'false'
    );

    // Persisted, not just rendered: a new popup reads it back from storage.
    const again = await context.newPage();
    await again.setViewportSize({ width: 790, height: 550 });
    await again.goto(`chrome-extension://${extensionId}/index.html`);
    await again.locator('[aria-label="Settings"]').click();
    await again.locator('button[aria-label="Data Management"]').click();
    await expect(side(again, MEMORY, 'Off')).toHaveAttribute(
      'aria-pressed',
      'true'
    );
  });
});
