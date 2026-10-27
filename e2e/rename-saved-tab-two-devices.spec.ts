import type { Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import {
  commitLanded,
  hasCloudConfig,
  openSecondDevice,
  seedOnce,
} from './fixtures/cloud';
import { buildSession } from './fixtures/seed';
import { stored } from './fixtures/sessionDrag';

// Syncs with the dev cloud (KAN-383).
test.use({ cloud: true });

// KAN-824 across two devices: device A renames a saved tab; device B, which adopts A's id, receives the name. After A's
// undo, B receives the page title again -- the undo changes only customTitle, so it reaches the cloud only if the
// content comparator sees that field. Run alone: each boot signs up an anonymous account (KAN-383). Needs a build with
// the Firebase config; it skips without one (CI, KAN-147).

const PAGE = 'Alex Jo on X: "Sync is hard" / X';
const S1 = buildSession({
  tabGroupId: 'S1',
  title: 'Trip',
  createdAt: Date.UTC(2026, 8, 1, 9, 0, 0),
  createdTime: '2026-09-01 09:00:00',
  windowCount: 1,
  tabCount: 1,
  windows: [
    {
      windowId: 'w1',
      windowHeight: 1080,
      windowWidth: 1920,
      windowOffsetTop: 0,
      windowOffsetLeft: 0,
      tabCount: 1,
      title: 'Reading',
      tabs: [
        { tabId: 't1', favicon: '', title: PAGE, url: 'https://x.com/a/1' },
      ],
    },
  ],
});

const nameOf = async (page: Page) =>
  (await stored(page)).tabGroups.find((g) => g.tabGroupId === 'S1')?.windows[0]
    .tabs[0].customTitle ?? null;

test.describe('a tab rename, on two devices (KAN-824)', () => {
  test.skip(!hasCloudConfig(), 'this build has no cloud config (CI)');
  test.setTimeout(180_000);

  test('device B receives the name, then the page title after the undo', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    await seedOnce(context, [S1]);
    const page = await context.newPage();
    await page.setViewportSize({ width: 1280, height: 800 });
    const started = commitLanded(page);
    await page.goto(`chrome-extension://${extensionId}/index.html?view=tab`);
    expect(await started, "device A's startup sync never wrote").toBe(true);

    const token = await serviceWorker.evaluate(async () => {
      const { tokenValue } = await chrome.storage.sync.get(['tokenValue']);
      return typeof tokenValue === 'string' ? tokenValue : null;
    });
    if (token === null) throw new Error('device A has no tokenValue');

    // A opens the session (the tab view starts folded), renames the tab, and the write lands.
    await page
      .locator('[data-pane="sessions"] [data-drag-row-id="S1"]')
      .click();
    await page
      .getByRole('button', { name: `Open in new tab: ${PAGE}`, exact: true })
      .click({ button: 'right' });
    await page
      .locator('[role="menu"][data-row-menu]')
      .getByRole('menuitem', { name: 'Rename tab', exact: true })
      .click();
    await page.keyboard.type('Sync notes');
    const renamed = commitLanded(page);
    await page.keyboard.press('Enter');
    await expect.poll(() => nameOf(page)).toBe('Sync notes');
    expect(await renamed, "device A's rename never reached the cloud").toBe(
      true
    );

    // B starts from the seed, which has no name: the name can only come from the cloud.
    const deviceB = await openSecondDevice(token, [S1]);
    try {
      await expect.poll(() => nameOf(deviceB.page)).toBe('Sync notes');
      await expect(
        deviceB.page.getByRole('button', {
          name: 'Open in new tab: Sync notes',
          exact: true,
        })
      ).toBeVisible();

      const undone = commitLanded(page);
      await page.keyboard.press('ControlOrMeta+z');
      await expect.poll(() => nameOf(page)).toBe(null);
      expect(await undone, "device A's undo never reached the cloud").toBe(
        true
      );

      await deviceB.reload();
      await expect.poll(() => nameOf(deviceB.page)).toBe(null);
    } finally {
      await deviceB.close();
    }
  });
});
