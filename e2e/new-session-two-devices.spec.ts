import type { Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import {
  CLOUD,
  commitLanded,
  openSecondDevice,
  seedOnce,
} from './fixtures/cloud';
import { buildSession } from './fixtures/seed';
import { pickUp, saveRowAim, stored, tabHandle } from './fixtures/sessionDrag';

// Syncs with the dev cloud (KAN-383); skips without a cloud config (CI, KAN-147).
test.use({ cloud: true });

// KAN-394 P3 across two devices: a tab let go on the save row's New session
// target becomes a session on device A, and device B, which adopts A's id,
// receives it. After A's undo, B receives its tombstone, not just its absence.
// Run alone: each boot signs up an anonymous account (KAN-383).

const tab = (id: string) => ({
  tabId: id,
  favicon: '',
  title: `Tab ${id}`,
  url: `https://${id}.test/`,
});
const tabs = (...ids: string[]) => ids.map(tab);
const windowOf = (id: string, ids: string[]) => ({
  windowId: id,
  windowHeight: 1080,
  windowWidth: 1920,
  windowOffsetTop: 0,
  windowOffsetLeft: 0,
  tabCount: ids.length,
  title: id,
  tabs: tabs(...ids),
});

const S1 = buildSession({
  tabGroupId: 'S1',
  title: 'Source',
  createdAt: Date.UTC(2026, 8, 1, 9, 0, 0),
  createdTime: '2026-09-01 09:00:00',
  windowCount: 1,
  tabCount: 3,
  windows: [windowOf('w1', ['a0', 'a1', 'a2'])],
});
const S2 = buildSession({
  tabGroupId: 'S2',
  title: 'Other',
  createdAt: Date.UTC(2026, 8, 1, 8, 0, 0),
  createdTime: '2026-09-01 08:00:00',
  windowCount: 1,
  tabCount: 1,
  windows: [windowOf('w9', ['z0'])],
});

const tabIdsOf = (c: Awaited<ReturnType<typeof stored>>, sessionId: string) =>
  c.tabGroups
    .find((g) => g.tabGroupId === sessionId)
    ?.windows.map((w) => w.tabs.map((t) => t.tabId)) ?? [];

// The session a1 alone was moved into: any stored session but the seeded two.
const madeSession = (c: Awaited<ReturnType<typeof stored>>) =>
  c.tabGroups.find((g) => !['S1', 'S2'].includes(g.tabGroupId));

const hasA1Session = (c: Awaited<ReturnType<typeof stored>>) => {
  const made = madeSession(c);
  return made === undefined
    ? null
    : {
        id: made.tabGroupId,
        tabs: made.windows.map((w) => w.tabs.map((t) => t.tabId)),
      };
};

const gesture = async (page: Page) => {
  const aim = await saveRowAim(page);
  await pickUp(page, tabHandle(page, 'a1'));
  await page.mouse.move(aim.x, aim.y);
  return aim;
};

test.describe('a new session made by a drop on the save row, on two devices (KAN-394 P3)', () => {
  test.setTimeout(180_000);

  test('device B receives the session, then its tombstone after the undo', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    // Device A: a fresh id, so its startup sync writes its local copy.
    await seedOnce(context, [S1, S2]);
    const page = await context.newPage();
    await page.setViewportSize({ width: 790, height: 550 });
    const started = commitLanded(page);
    const cloudRequests: string[] = [];
    page.on('request', (r) => {
      if (CLOUD.test(r.url())) cloudRequests.push(r.url());
    });
    await page.goto(`chrome-extension://${extensionId}/index.html`);
    const startedOk = await started;
    test.skip(
      !startedOk && cloudRequests.length === 0,
      'this build has no cloud config (CI)'
    );
    expect(startedOk, "device A's startup sync never wrote").toBe(true);
    await expect(tabHandle(page, 'a1')).toBeVisible();

    const token = await serviceWorker.evaluate(async () => {
      const { tokenValue } = await chrome.storage.sync.get(['tokenValue']);
      return typeof tokenValue === 'string' ? tokenValue : null;
    });
    if (token === null) throw new Error('device A has no tokenValue');

    // A drops a1 on New session, and the write lands.
    await gesture(page);
    const dropped = commitLanded(page);
    await page.mouse.up();
    await expect
      .poll(async () => hasA1Session(await stored(page))?.tabs)
      .toEqual([['a1']]);
    expect(await dropped, "device A's drop never reached the cloud").toBe(true);
    const made = hasA1Session(await stored(page));
    if (made === null) throw new Error('no new session on A');
    expect(tabIdsOf(await stored(page), 'S1')).toEqual([['a0', 'a2']]);

    // B, with the old copy, receives the new session through the cloud.
    const deviceB = await openSecondDevice(token, [S1, S2]);
    try {
      await deviceB.committed;
      await expect
        .poll(async () => hasA1Session(await stored(deviceB.page))?.id)
        .toBe(made.id);
      const b = await stored(deviceB.page);
      expect(hasA1Session(b)?.tabs).toEqual([['a1']]);
      expect(tabIdsOf(b, 'S1')).toEqual([['a0', 'a2']]);
      await expect(
        deviceB.page.locator(`[data-drag-row-id="${made.id}"]`)
      ).toBeVisible();

      // A undoes, and the undo syncs.
      const undone = commitLanded(page);
      await page.keyboard.press('ControlOrMeta+z');
      await expect
        .poll(async () => madeSession(await stored(page)))
        .toBeUndefined();
      expect(await undone, "device A's undo never reached the cloud").toBe(
        true
      );
      expect(tabIdsOf(await stored(page), 'S1')).toEqual([['a0', 'a1', 'a2']]);

      // B reloads: the session is gone, tombstoned, and a1 is back in w1.
      await deviceB.reload();
      await expect
        .poll(async () => madeSession(await stored(deviceB.page)))
        .toBeUndefined();
      const after = await stored(deviceB.page);
      expect(tabIdsOf(after, 'S1')).toEqual([['a0', 'a1', 'a2']]);
      expect((after.deletedTabGroups ?? []).map((d) => d.tabGroupId)).toContain(
        made.id
      );
    } finally {
      await deviceB.close();
    }
  });
});
