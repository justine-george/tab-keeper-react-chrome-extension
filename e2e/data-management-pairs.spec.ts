import type { Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { buildContainer, seedSessions } from './fixtures/seed';

// KAN-249 / KAN-250. Data Management had two Buttons whose whole text was
// their value ("On"), the shape KAN-248 replaced on the Sync pane. One of
// them -- "Optimize Memory Usage On Session Restore" -- is gone: restores
// always open later tabs as placeholders now, so there was nothing to choose.
// The other, Save Tab Groups, is a pair.
//
// The pair is not pressed here. On asks Chrome for an optional permission,
// which no e2e profile can pre-grant and which may close the popup before
// it settles (KAN-226); what Chrome is asked is covered in jsdom against the
// fake. This pins the pane's shape in a real browser: one pair, named for
// its setting, Off pressed in a fresh profile, on the popup scale, and no
// memory row above it.

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
    page.getByRole('group', { name: 'Save Tab Groups' })
  ).toBeVisible();
  return page;
}

test.describe('the Data Management pane (KAN-249, KAN-250)', () => {
  test('one pair, Save Tab Groups, Off pressed, on the popup scale; no memory setting', async ({
    context,
    extensionId,
  }) => {
    const page = await openDataManagement(context, extensionId);

    const groups = page.getByRole('group');
    await expect(groups).toHaveCount(1);
    const pair = page.getByRole('group', { name: 'Save Tab Groups' });
    await expect(pair.getByRole('button', { name: 'Off' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    await expect(pair.getByRole('button', { name: 'On' })).toHaveAttribute(
      'aria-pressed',
      'false'
    );
    expect((await pair.boundingBox())!.height).toBe(32);

    await expect(
      page.getByText('Optimize Memory Usage On Session Restore')
    ).toHaveCount(0);
    // The heading that remains, and the two actions under it.
    await expect(page.getByText('Backup', { exact: true })).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Save sessions to a file' })
    ).toBeVisible();
  });
});
