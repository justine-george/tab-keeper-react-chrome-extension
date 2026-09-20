import type { Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { buildContainer, seedSessions, seedSettings } from './fixtures/seed';

// KAN-248. The sync status card used to say "Cloud Sync Active" whenever a
// token existed -- under an Auto Sync button reading Off. It now derives from
// the same facts as the header's cloud icon, and Auto Sync is a SlidingPair.
//
// Deterministic with or without a cloud, on purpose: PR CI builds without
// Firebase (KAN-147), where "on" resolves to "Sync unavailable", while a local
// build with a .env resolves it to "Cloud sync on". What is asserted is the
// RELATIONSHIP the defect broke -- the toggle and the card agree -- not which
// of the two "on" titles this build shows.

async function openSyncPane(
  context: Parameters<typeof seedSessions>[0],
  extensionId: string,
  isAutoSync: boolean
): Promise<Page> {
  await seedSessions(context, buildContainer());
  await seedSettings(context, { isAutoSync });
  const page = await context.newPage();
  await page.setViewportSize({ width: 790, height: 550 });
  await page.goto(`chrome-extension://${extensionId}/index.html`);
  await page.locator('[aria-label="Settings"]').click();
  await page.locator('button[aria-label="Sync & Backup"]').click();
  await expect(page.getByTestId('sync-status-card')).toBeVisible();
  return page;
}

const pair = (page: Page) => page.getByRole('group', { name: 'Auto Sync' });
const side = (page: Page, word: 'On' | 'Off') =>
  pair(page).getByRole('button', { name: word });
const card = (page: Page) => page.getByTestId('sync-status-card');

test.describe('the sync status card agrees with the Auto Sync pair (KAN-248)', () => {
  test('booted with auto sync off, the card says manual and Off is pressed', async ({
    context,
    extensionId,
  }) => {
    const page = await openSyncPane(context, extensionId, false);
    await expect(side(page, 'Off')).toHaveAttribute('aria-pressed', 'true');
    await expect(card(page)).toHaveAttribute('data-sync-state', 'manual');
    await expect(card(page)).toContainText('Manual sync');
  });

  test('pressing On moves the card off manual; pressing Off brings it back', async ({
    context,
    extensionId,
  }) => {
    const page = await openSyncPane(context, extensionId, false);

    await side(page, 'On').click();
    await expect(side(page, 'On')).toHaveAttribute('aria-pressed', 'true');
    await expect(card(page)).not.toHaveAttribute('data-sync-state', 'manual');
    await expect(card(page)).not.toContainText('Manual sync');
    // Whichever "on" this build resolves to, it is one of the two honest ones.
    await expect(card(page)).toHaveAttribute(
      'data-sync-state',
      /^(on|unavailable)$/
    );

    await side(page, 'Off').click();
    await expect(card(page)).toHaveAttribute('data-sync-state', 'manual');
  });

  test('the pair sits on the popup scale: the row unit, square corners', async ({
    context,
    extensionId,
  }) => {
    const page = await openSyncPane(context, extensionId, true);
    const box = (await pair(page).boundingBox())!;
    expect(box.height).toBe(32);
    expect(
      await pair(page).evaluate((el) => getComputedStyle(el).borderRadius)
    ).toBe('0px');
  });

  test('the body line wraps rather than truncating', async ({
    context,
    extensionId,
  }) => {
    const page = await openSyncPane(context, extensionId, false);
    const line = card(page).locator('[data-sync-line]');
    const { scrollWidth, clientWidth, lines } = await line.evaluate((el) => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      lines: Math.round(
        el.getBoundingClientRect().height /
          parseFloat(getComputedStyle(el).lineHeight)
      ),
    }));
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
    expect(lines).toBeGreaterThanOrEqual(1);
  });
});
