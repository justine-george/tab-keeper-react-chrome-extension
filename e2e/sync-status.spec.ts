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
  await expect(page.getByTestId('sync-status')).toBeVisible();
  return page;
}

const pair = (page: Page) => page.getByRole('group', { name: 'Auto Sync' });
const side = (page: Page, word: 'On' | 'Off') =>
  pair(page).getByRole('button', { name: word });
const card = (page: Page) => page.getByTestId('sync-status');

test.describe('the sync status line agrees with the Auto Sync pair (KAN-248)', () => {
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
    // KAN-268. Pressing On starts a real sign-in and read in a local build
    // (it carries the project's config; CI's does not). A full local run
    // signs up ~400 fresh profiles and Firebase then refuses the IP (signUp
    // 400 too-many-requests), and the card rightly says "failed"
    // (KAN-264/289). That is honest, so it is allowed -- but only when this
    // test SAW cloud trouble: a request the cloud refused, or one that never
    // reached it. A "failed" with neither is a bug, and still fails here.
    const cloudTrouble: string[] = [];
    const isCloud = (url: string) =>
      /identitytoolkit\.googleapis\.com|firestore\.googleapis\.com/.test(url);
    page.on('response', (r) => {
      if (isCloud(r.url()) && r.status() >= 400) {
        cloudTrouble.push(`${r.status()} ${new URL(r.url()).pathname}`);
      }
    });
    page.on('requestfailed', (r) => {
      if (isCloud(r.url())) {
        cloudTrouble.push(
          `${r.failure()?.errorText} ${new URL(r.url()).pathname}`
        );
      }
    });

    await side(page, 'On').click();
    await expect(side(page, 'On')).toHaveAttribute('aria-pressed', 'true');
    await expect(card(page)).not.toHaveAttribute('data-sync-state', 'manual');
    await expect(card(page)).not.toContainText('Manual sync');
    // One of the honest states: on (a cloud that answered), unavailable (a
    // build without one, as in CI), or failed (a cloud that did not).
    await expect(card(page)).toHaveAttribute(
      'data-sync-state',
      /^(on|unavailable|failed)$/
    );
    if ((await card(page).getAttribute('data-sync-state')) === 'failed') {
      expect(
        cloudTrouble,
        'the card says failed, but every cloud request succeeded'
      ).not.toHaveLength(0);
    }

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

// KAN-255. The last-synced time, seeded rather than earned: CI has no cloud
// to sync with, and a local run would sync with the real project. Manual is
// the state that shows it in every build (on resolves to unavailable without
// a cloud), and it is the state where the time matters most.
test.describe('the status line shows when it last synced (KAN-255)', () => {
  test('manual sync with a recorded time shows it, formatted like the session cards', async ({
    context,
    extensionId,
  }) => {
    const at = Date.UTC(2026, 8, 18, 16, 2, 41);
    await seedSessions(context, buildContainer());
    await seedSettings(context, { isAutoSync: false, lastSyncedTime: at });
    const page = await context.newPage();
    await page.setViewportSize({ width: 790, height: 550 });
    await page.goto(`chrome-extension://${extensionId}/index.html`);
    await page.locator('[aria-label="Settings"]').click();
    await page.locator('button[aria-label="Sync & Backup"]').click();

    const status = page.getByTestId('sync-status');
    await expect(status).toHaveAttribute('data-sync-state', 'manual');
    const synced = status.locator('[data-sync-synced]');
    await expect(synced).toBeVisible();
    const expected = await page.evaluate(
      (ms) =>
        new Intl.DateTimeFormat('en', {
          dateStyle: 'medium',
          timeStyle: 'medium',
        }).format(new Date(ms)),
      at
    );
    await expect(synced).toHaveText(`Last synced ${expected}`);
    // Manual keeps its instruction under the time.
    await expect(status.locator('[data-sync-line]')).toContainText(
      'cloud button'
    );
  });
});
