import type { Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { buildContainer, seedSessions } from './fixtures/seed';

// KAN-249 / KAN-250 / KAN-253. The pane was "Data Management", with two
// Buttons whose whole text was their value ("On"), the shape KAN-248 replaced
// on the Sync pane, and the backup buttons under them. One toggle --
// "Optimize Memory Usage On Session Restore" -- is gone: restores always open
// later tabs as placeholders now, so there was nothing to choose. The other,
// Save Tab Groups, is a pair. Backup moved to Sync & Backup, and what is left
// is what a save captures, so the pane is "Sessions".
//
// The pair is not pressed here. On asks Chrome for an optional permission,
// which no e2e profile can pre-grant and which may close the popup before
// it settles (KAN-226); what Chrome is asked is covered in jsdom against the
// fake. This pins the pane's shape in a real browser: one pair, named for
// its setting, Off pressed in a fresh profile, on the popup scale, and no
// memory row above it.

async function openSessions(
  context: Parameters<typeof seedSessions>[0],
  extensionId: string
): Promise<Page> {
  await seedSessions(context, buildContainer());
  const page = await context.newPage();
  await page.setViewportSize({ width: 790, height: 550 });
  await page.goto(`chrome-extension://${extensionId}/index.html`);
  await page.locator('[aria-label="Settings"]').click();
  await page.locator('button[aria-label="Sessions"]').click();
  await expect(
    page.getByRole('group', { name: 'Save Tab Groups' })
  ).toBeVisible();
  return page;
}

test.describe('the Sessions pane (KAN-249, KAN-250, KAN-253)', () => {
  test('one pair, Save Tab Groups, Off pressed, on the popup scale; no memory setting, no backup', async ({
    context,
    extensionId,
  }) => {
    const page = await openSessions(context, extensionId);

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
    // Backup lives under Sync & Backup now (KAN-253).
    await expect(page.getByText('Backup', { exact: true })).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: 'Save sessions to a file' })
    ).toHaveCount(0);
  });
});
