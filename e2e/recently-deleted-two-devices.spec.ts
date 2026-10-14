import type { Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import {
  commitLanded,
  hasCloudConfig,
  openSecondDevice,
  seedOnce,
} from './fixtures/cloud';
import { buildSession } from './fixtures/seed';
import { stored } from './fixtures/savedWindows';

// Syncs with the dev cloud (KAN-383).
test.use({ cloud: true });

// KAN-595 across two devices: A deletes a session and B loses it; A restores
// it from Recently deleted and B gets it back; A syncs again and still has
// it. The restore is stamped after its grave, or the cloud's grave wins the
// merge and the session vanishes again. Needs a build with the Firebase
// config; it skips without one (CI, KAN-147).

// Each carries its own lastModified, as every saved session does: without one
// the merge falls back to the container's, which a restore has just moved.
const S1 = buildSession({
  tabGroupId: 'S1',
  title: 'Keep',
  createdAt: Date.UTC(2026, 8, 1, 9, 0, 0),
  createdTime: '2026-09-01 09:00:00',
  lastModified: Date.UTC(2026, 8, 1, 9, 0, 0),
});
const S2 = buildSession({
  tabGroupId: 'S2',
  title: 'Lisbon trip',
  createdAt: Date.UTC(2026, 8, 1, 8, 0, 0),
  createdTime: '2026-09-01 08:00:00',
  lastModified: Date.UTC(2026, 8, 1, 8, 0, 0),
});

const ids = async (page: Page) =>
  (await stored(page)).tabGroups.map((g) => g.tabGroupId);

const FIRESTORE = /firestore\.googleapis\.com/;

test.describe('Restore from Recently deleted, on two devices (KAN-595)', () => {
  test.skip(!hasCloudConfig(), 'this build has no cloud config (CI)');
  test.setTimeout(180_000);

  test('a restored session comes back on both devices and stays', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    await seedOnce(context, [S1, S2]);
    const page = await context.newPage();
    await page.setViewportSize({ width: 790, height: 550 });
    const started = commitLanded(page);
    await page.goto(`chrome-extension://${extensionId}/index.html`);
    expect(await started, "device A's startup sync never wrote").toBe(true);

    const token = await serviceWorker.evaluate(async () => {
      const { tokenValue } = await chrome.storage.sync.get(['tokenValue']);
      return typeof tokenValue === 'string' ? tokenValue : null;
    });
    if (token === null) throw new Error('device A has no tokenValue');

    const deviceB = await openSecondDevice(token, [S1, S2]);
    try {
      await expect.poll(() => ids(deviceB.page)).toEqual(['S1', 'S2']);

      // A deletes S2; the delete lands; B loses it.
      const deleted = commitLanded(page);
      await page
        .locator('[data-pane="sessions"]')
        .getByRole('button', { name: 'Lisbon trip', exact: true })
        .click();
      await page.keyboard.press('Delete');
      await expect.poll(() => ids(page)).toEqual(['S1']);
      expect(await deleted, "device A's delete never reached the cloud").toBe(
        true
      );
      await deviceB.reload();
      await expect.poll(() => ids(deviceB.page)).toEqual(['S1']);

      // A restores it from Settings → Recently deleted; the restore lands.
      await page.getByRole('button', { name: 'Settings' }).click();
      await page
        .getByRole('button', { name: 'Recently deleted', exact: true })
        .click();
      const restored = commitLanded(page);
      await page.getByRole('button', { name: 'Restore Lisbon trip' }).click();
      expect(await restored, "device A's restore never reached the cloud").toBe(
        true
      );
      expect(await ids(page)).toEqual(['S2', 'S1']);

      // B gets it back.
      await deviceB.reload();
      await expect.poll(() => ids(deviceB.page)).toEqual(['S2', 'S1']);
      const b = await stored(deviceB.page);
      expect((b.deletedTabGroups ?? []).map((g) => g.tabGroupId)).not.toContain(
        'S2'
      );

      // A syncs again from the cloud, and the restore does not reverse.
      const read = page.waitForResponse(FIRESTORE, { timeout: 20_000 });
      await page.reload();
      await read;
      await page.locator('[data-tour-anchor="save"]').waitFor();
      await expect.poll(() => ids(page)).toEqual(['S2', 'S1']);
    } finally {
      await deviceB.close();
    }
  });
});
