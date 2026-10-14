import type { BrowserContext, Page, Response } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import {
  COMMIT,
  hasCloudConfig,
  openSecondDevice,
  seedOnce,
} from './fixtures/cloud';
import { buildSession } from './fixtures/seed';
import {
  POPUP_RUN,
  cardAt,
  cardButton,
  closeReplayNote,
  openRunFromHelp,
} from './fixtures/run';
import { isValidTabMasterContainer } from '../src/utils/functions/local';
import { SAMPLE_ID_PREFIX } from '../src/utils/functions/sampleSession';

// Syncs with the dev cloud (KAN-383).
test.use({ cloud: true });

// KAN-600. With sync on, a run replayed from Help made its example a synced
// session: device B showed "Sample: Weekend trip" while A's run was on, and
// only the example's grave took it off B again. The example now stays on A,
// and so does its grave. Needs a build with the Firebase config; it skips
// without one (CI, KAN-147).

const S1 = buildSession({
  tabGroupId: 'S1',
  title: 'Work',
  createdAt: Date.UTC(2026, 8, 1, 9),
  createdTime: '2026-09-01 09:00:00',
  lastModified: Date.UTC(2026, 8, 1, 9),
});
const READ = /firestore\.googleapis\.com\/.*documents:batchGet/;

interface Ids {
  sessions: string[];
  graves: string[];
}

async function ids(page: Page): Promise<Ids> {
  const parsed: unknown = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('tabContainerData') ?? 'null')
  );
  if (!isValidTabMasterContainer(parsed)) return { sessions: [], graves: [] };
  return {
    sessions: parsed.tabGroups.map((g) => g.tabGroupId),
    graves: (parsed.deletedTabGroups ?? []).map((g) => g.tabGroupId),
  };
}

// Stamped once a sync has merged and loaded (recordSyncedNow): the barrier for reading what it brought.
const lastSynced = (page: Page) =>
  page.evaluate(
    () =>
      (
        JSON.parse(localStorage.getItem('settingsData') ?? '{}') as {
          lastSyncedTime?: unknown;
        }
      ).lastSyncedTime ?? ''
  );

const samples = (list: string[]) =>
  list.filter((id) => id.startsWith(SAMPLE_ID_PREFIX));

// The next response from the cloud matching `url`, from any page of the profile.
const nextResponse = (context: BrowserContext, url: RegExp) =>
  context.waitForEvent('response', {
    predicate: (r: Response) => url.test(r.url()),
    timeout: 20_000,
  });

test.describe('a run replayed with sync on keeps its example on this device (KAN-600)', () => {
  test.skip(!hasCloudConfig(), 'this build has no cloud config (CI)');
  test.setTimeout(180_000);

  test('device B never receives the example or its grave', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    await seedOnce(context, [S1]);
    const started = nextResponse(context, COMMIT);
    const page = await openRunFromHelp(context, extensionId, POPUP_RUN);
    await started;
    const token = await serviceWorker.evaluate(async () => {
      const { tokenValue } = await chrome.storage.sync.get(['tokenValue']);
      return typeof tokenValue === 'string' ? tokenValue : null;
    });
    if (token === null) throw new Error('device A has no tokenValue');

    // A takes the example; the sync that follows reads the cloud, so it has run.
    const synced = nextResponse(context, READ);
    await cardButton(page, 'Use an example').click();
    await expect(cardAt(page, 2)).toBeVisible();
    await synced;
    const sample = samples((await ids(page)).sessions);
    expect(sample).toHaveLength(1);

    const deviceB = await openSecondDevice(token, [S1]);
    try {
      await expect.poll(() => lastSynced(deviceB.page)).not.toBe('');
      expect((await ids(deviceB.page)).sessions).toEqual(['S1']);

      // A's run ends, which deletes the example; that sync runs too.
      const ended = nextResponse(context, READ);
      await cardButton(page, 'Skip tutorial').click();
      await closeReplayNote(page);
      await ended;
      expect((await ids(page)).sessions).toEqual(['S1']);

      const before = await lastSynced(deviceB.page);
      await deviceB.reload();
      await expect.poll(() => lastSynced(deviceB.page)).not.toBe(before);
      const b = await ids(deviceB.page);
      expect(b.sessions).toEqual(['S1']);
      expect(samples(b.graves)).toEqual([]);
    } finally {
      await deviceB.close();
    }
  });
});
