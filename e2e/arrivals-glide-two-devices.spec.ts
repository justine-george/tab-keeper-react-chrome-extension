import { test, expect } from './fixtures/extension';
import {
  commitLanded,
  hasCloudConfig,
  openSecondDevice,
  seedOnce,
} from './fixtures/cloud';
import { buildSession } from './fixtures/seed';
import { documentLanded } from './fixtures/landed';
import {
  between,
  samples,
  startSampling,
  topOf,
} from './fixtures/glideSamples';

// Syncs with the dev cloud (KAN-383).
test.use({ cloud: true });

// KAN-991 by sync: a session saved on another device comes into this one's
// list as one saved here does, sliding in from the top with the rows below.
// Run alone: each boot signs up an anonymous account (KAN-383). Needs a build
// with the Firebase config; it skips without one (CI, KAN-147).

const at = (hour: number) => Date.UTC(2026, 8, 1, hour, 0, 0);
const S1 = buildSession({
  tabGroupId: 'S1',
  title: 'Source',
  createdAt: at(9),
  createdTime: '2026-09-01 09:00:00',
});
const S2 = buildSession({
  tabGroupId: 'S2',
  title: 'Other',
  createdAt: at(8),
  createdTime: '2026-09-01 08:00:00',
});
// Newer than both, so it lands at the top of the list.
const FROM_B = buildSession({
  tabGroupId: 'FROM-B',
  title: 'Saved on device B',
  createdAt: at(10),
  createdTime: '2026-09-01 10:00:00',
});
const rowOf = (id: string) =>
  `[data-pane="sessions"] [data-drag-row-id="${id}"]`;

test.describe('a session saved on another device (KAN-991)', () => {
  test.skip(!hasCloudConfig(), 'this build has no cloud config (CI)');
  test.setTimeout(180_000);

  test('slides in from the top when the sync brings it', async ({
    context,
    extensionId,
    serviceWorker,
    headless,
  }) => {
    // Device A: a fresh id, so its startup sync writes its local copy.
    await seedOnce(context, [S1, S2]);
    const page = await context.newPage();
    await page.setViewportSize({ width: 790, height: 550 });
    const started = commitLanded(page);
    await page.goto(`chrome-extension://${extensionId}/index.html`);
    expect(await started, "device A's startup sync never wrote").toBe(true);
    await expect(page.locator(rowOf('S1'))).toBeVisible();
    const token = await serviceWorker.evaluate(async () => {
      const { tokenValue } = await chrome.storage.sync.get(['tokenValue']);
      return typeof tokenValue === 'string' ? tokenValue : null;
    });
    if (token === null) throw new Error('device A has no tokenValue');

    // Device B holds one more session; its startup sync writes it to the cloud.
    const deviceB = await openSecondDevice(token, [FROM_B, S1, S2], headless);
    try {
      expect(await deviceB.committed, "device B's sync never wrote").toBe(true);
      await documentLanded(page);
      const from = await topOf(page.locator(rowOf('S1')));

      await startSampling(
        page,
        { next: rowOf('S1'), new: rowOf('FROM-B'), 'new:op': rowOf('FROM-B') },
        4000
      );
      await page.getByRole('button', { name: 'Sync now', exact: true }).click();
      await expect(page.locator(rowOf('FROM-B'))).toBeAttached({
        timeout: 15_000,
      });
      const s = await samples(page);
      const to = await topOf(page.locator(rowOf('S1')));
      const pitch = to - from;

      expect(pitch).toBeGreaterThan(40);
      expect(between(s.next, from, to).length).toBeGreaterThanOrEqual(3);
      expect(between(s.new, from - pitch, from).length).toBeGreaterThanOrEqual(
        3
      );
      expect(s['new:op'].some((v) => v > 0.05 && v < 0.95)).toBe(false);
    } finally {
      await deviceB.close();
    }
  });
});
