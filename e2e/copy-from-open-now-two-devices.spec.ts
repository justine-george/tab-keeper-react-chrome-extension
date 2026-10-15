import type { Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import {
  commitLanded,
  hasCloudConfig,
  openSecondDevice,
  seedOnce,
} from './fixtures/cloud';
import { buildSession } from './fixtures/seed';
import { boxOf, stored } from './fixtures/sessionDrag';

// Syncs with the dev cloud (KAN-383).
test.use({ cloud: true });

// KAN-280 Part F (spec O12c "Two devices") across two devices: device A copies a live tab from Open now into S2;
// device B, which adopts A's id, receives it. After A's undo, B receives S2 without it. A copy changes ONE session, so
// the move's settled loss (Q1 A, KAN-350) cannot happen; B keeping the copy through its own next edit is pinned in the
// unit suite (copyToSessionTwoDevices.test.ts). Run alone: each boot signs up an anonymous account (KAN-383). Needs a
// build with the Firebase config; it skips without one (CI, KAN-147).

const dataUrl = (title: string) =>
  `data:text/html,${encodeURIComponent(`<title>${title}</title>`)}`;

const windowOf = (id: string, ids: string[]) => ({
  windowId: id,
  windowHeight: 1080,
  windowWidth: 1920,
  windowOffsetTop: 0,
  windowOffsetLeft: 0,
  tabCount: ids.length,
  title: id,
  tabs: ids.map((t) => ({
    tabId: t,
    favicon: '',
    title: `Tab ${t}`,
    url: `https://${t}.test/`,
  })),
});

const S1 = buildSession({
  tabGroupId: 'S1',
  title: 'Source',
  createdAt: Date.UTC(2026, 8, 1, 9, 0, 0),
  createdTime: '2026-09-01 09:00:00',
  windowCount: 1,
  tabCount: 2,
  windows: [windowOf('w1', ['a0', 'a1'])],
});
const S2 = buildSession({
  tabGroupId: 'S2',
  title: 'Target',
  createdAt: Date.UTC(2026, 8, 1, 8, 0, 0),
  createdTime: '2026-09-01 08:00:00',
  windowCount: 1,
  tabCount: 1,
  windows: [windowOf('d1', ['c0'])],
});

const urlsOfS2 = async (page: Page) =>
  (await stored(page)).tabGroups
    .find((g) => g.tabGroupId === 'S2')
    ?.windows.map((w) => w.tabs.map((t) => t.url)) ?? [];

test.describe('a copy from Open now, on two devices (KAN-280 Part F)', () => {
  test.skip(!hasCloudConfig(), 'this build has no cloud config (CI)');
  test.setTimeout(180_000);

  test('device B receives the copy, then S2 without it after the undo', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    // Device A: a fresh id, so its startup sync writes its local copy.
    await seedOnce(context, [S1, S2]);
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

    const liveTabId = await serviceWorker.evaluate(async (url: string) => {
      const w = await chrome.windows.create({ focused: false, url });
      return w?.tabs?.[0]?.id ?? null;
    }, dataUrl('Shared copy'));
    if (liveTabId === null) throw new Error('no live tab');
    const row = page.locator(`[data-open-tab-id="${liveTabId}"]`);
    await expect(row).toBeVisible();

    // A carries the live tab out of Open now onto S2's row, and the write lands.
    const b = await boxOf(row);
    await page.mouse.move(b.x + 40, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + 40, b.y + b.height / 2 + 10, { steps: 3 });
    const openNow = await boxOf(page.locator('[data-pane="open-now"]'));
    await page.mouse.move(openNow.x - 40, b.y + b.height / 2, { steps: 6 });
    await expect(page.locator('[data-carry-card]')).toHaveCount(1);
    const target = await boxOf(page.locator('[data-drag-row-id="S2"]'));
    await page.mouse.move(
      target.x + target.width / 2,
      target.y + target.height / 2,
      { steps: 5 }
    );
    const copied = commitLanded(page);
    await page.mouse.up();
    await expect
      .poll(() => urlsOfS2(page))
      .toEqual([[dataUrl('Shared copy')], ['https://c0.test/']]);
    expect(await copied, "device A's copy never reached the cloud").toBe(true);

    const deviceB = await openSecondDevice(token, [S1, S2]);
    try {
      await expect
        .poll(() => urlsOfS2(deviceB.page))
        .toEqual([[dataUrl('Shared copy')], ['https://c0.test/']]);

      // A undoes, and the undo syncs.
      const undone = commitLanded(page);
      await page.keyboard.press('ControlOrMeta+z');
      await expect.poll(() => urlsOfS2(page)).toEqual([['https://c0.test/']]);
      expect(await undone, "device A's undo never reached the cloud").toBe(
        true
      );

      await deviceB.reload();
      await expect
        .poll(() => urlsOfS2(deviceB.page))
        .toEqual([['https://c0.test/']]);
    } finally {
      await deviceB.close();
    }
  });
});
