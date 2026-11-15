import { test, expect } from './fixtures/extension';
import {
  COMMIT,
  commitLanded,
  hasCloudConfig,
  openSecondDevice,
  seedOnce,
  storedDeviceId,
} from './fixtures/cloud';
import { buildContainer, buildSession } from './fixtures/seed';
import { stored } from './fixtures/savedWindows';
import { FIRESTORE_MAX_DOCUMENT_BYTES } from '../src/utils/functions/local';
import { syncBytes } from '../src/utils/functions/cloudDocument';

// Syncs with the dev cloud (KAN-383). Run once; repeats use up dev sign-ups.
test.use({ cloud: true });

// KAN-6 phase 2. An account over 1 MB as plain JSON used to stop syncing. It
// now writes its sessions gzipped as tabGroupsZ, and another device reads them.
// Needs a build with the Firebase config; it skips without one (CI, KAN-147).

const BIG_TITLE = 'Over a megabyte of tabs';

// 400 tabs with long, repetitive addresses: well over 1 MB plain, far under compressed.
function bigSession() {
  const base = buildSession({ tabGroupId: 'big', title: BIG_TITLE });
  const tab = base.windows[0].tabs[0];
  const tabs = Array.from({ length: 400 }, (_, i) => ({
    ...tab,
    tabId: `tab-${i}`,
    url: `https://example.com/${i}/${'a'.repeat(2800)}`,
  }));
  return {
    ...base,
    tabCount: tabs.length,
    windows: [{ ...base.windows[0], tabCount: tabs.length, tabs }],
  };
}

const lastSynced = (page: import('@playwright/test').Page) =>
  page.evaluate(
    () =>
      (
        JSON.parse(localStorage.getItem('settingsData') ?? '{}') as {
          lastSyncedTime?: unknown;
        }
      ).lastSyncedTime ?? ''
  );

test.describe('an account over 1 MB plain syncs compressed (KAN-6)', () => {
  test.skip(!hasCloudConfig(), 'this build has no cloud config (CI)');
  test.setTimeout(180_000);

  test('A writes tabGroupsZ and no tabGroups; B reads the sessions back', async ({
    context,
    extensionId,
    serviceWorker,
    headless,
  }) => {
    const session = bigSession();
    const plain = new TextEncoder().encode(
      JSON.stringify(buildContainer([session]))
    ).byteLength;
    // PREMISE: over the limit plain (refused before KAN-6), under it compressed.
    expect(plain).toBeGreaterThan(FIRESTORE_MAX_DOCUMENT_BYTES);
    expect(await syncBytes(buildContainer([session]))).toBeLessThan(
      FIRESTORE_MAX_DOCUMENT_BYTES
    );

    const bodies: string[] = [];
    await context.route(COMMIT, async (route) => {
      bodies.push(route.request().postData() ?? '');
      await route.continue();
    });
    await seedOnce(context, [session]);
    const page = await context.newPage();
    await page.setViewportSize({ width: 790, height: 550 });
    const landed = commitLanded(page);
    await page.goto(`chrome-extension://${extensionId}/index.html`);
    expect(await landed, "device A's startup sync never wrote").toBe(true);

    // The write as it went over the wire: sessions only as gzip Bytes.
    const write = JSON.parse(bodies[bodies.length - 1]) as {
      writes: { update?: { fields?: Record<string, unknown> } }[];
    };
    const fields = write.writes.find((w) => w.update)?.update?.fields ?? {};
    expect(Object.keys(fields)).toContain('tabGroupsZ');
    expect(fields.tabGroupsZ).toHaveProperty('bytesValue');
    expect(Object.keys(fields)).not.toContain('tabGroups');

    const token = await storedDeviceId(serviceWorker);
    if (token === null) throw new Error('device A has no tokenValue');
    const deviceB = await openSecondDevice(token, [], headless);
    try {
      await expect.poll(() => lastSynced(deviceB.page)).not.toBe('');
      const onB = await stored(deviceB.page);
      expect(onB.tabGroups.map((g) => g.title)).toEqual([BIG_TITLE]);
      expect(onB.tabGroups[0].windows[0].tabs).toHaveLength(400);
    } finally {
      await deviceB.close();
    }
  });
});
