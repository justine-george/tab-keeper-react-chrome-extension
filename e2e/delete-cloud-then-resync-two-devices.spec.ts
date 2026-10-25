import type { BrowserContext, Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import {
  COMMIT,
  commitLanded,
  hasCloudConfig,
  openSecondDevice,
  seedOnce,
  storedDeviceId,
} from './fixtures/cloud';
import { buildSession } from './fixtures/seed';
import { ON_TITLE } from './fixtures/savedRow';
import { stored } from './fixtures/savedWindows';
import { saveRowSaveAll } from './fixtures/sessionActions';
import { standIn } from './fixtures/standInPages';

// Syncs with the dev cloud (KAN-383).
test.use({ cloud: true });

// Delete cloud data on A, then sync back on. Both machines share the one
// document (the id rides chrome.storage.sync); the delete turns sync off on A.
// B, finding the document gone on its next sync, turns sync off too and says
// so rather than uploading over the delete (KAN-759). What each machine did
// meanwhile must survive the way back: A's delete stays deleted, and the
// sessions saved on either side reach both.
// Needs a build with the Firebase config; it skips without one (CI, KAN-147).

const S1 = buildSession({
  tabGroupId: 'S1',
  title: 'Deleted on A while off',
  createdAt: Date.UTC(2026, 8, 1, 9, 0, 0),
  createdTime: '2026-09-01 09:00:00',
  lastModified: Date.UTC(2026, 8, 1, 9, 0, 0),
});
const S2 = buildSession({
  tabGroupId: 'S2',
  title: 'Kept everywhere',
  createdAt: Date.UTC(2026, 8, 1, 8, 0, 0),
  createdTime: '2026-09-01 08:00:00',
  lastModified: Date.UTC(2026, 8, 1, 8, 0, 0),
});

const SAVED_ON_A = 'Saved on A while off';
const SAVED_ON_B = 'Saved on B';

const titles = async (page: Page) =>
  (await stored(page)).tabGroups.map((g) => g.title).sort();

const graves = async (page: Page) =>
  ((await stored(page)).deletedTabGroups ?? []).map((g) => g.tabGroupId);

// Stamped once a sync has merged and loaded (recordSyncedNow).
const lastSynced = (page: Page) =>
  page.evaluate(
    () =>
      (
        JSON.parse(localStorage.getItem('settingsData') ?? '{}') as {
          lastSyncedTime?: unknown;
        }
      ).lastSyncedTime ?? ''
  );

async function openSyncPane(page: Page): Promise<void> {
  await page.locator('[aria-label="Settings"]').click();
  await page.locator('button[aria-label="Sync & backup"]').click();
}

async function goHome(page: Page): Promise<void> {
  await page.reload();
  await page.locator('[data-tour-anchor="save"]').waitFor();
}

// Saves the profile's open windows as `title`, from the real save row.
async function saveAs(
  context: BrowserContext,
  page: Page,
  title: string
): Promise<void> {
  const tab = await context.newPage();
  await tab.goto(standIn(title));
  await page.bringToFront();
  await page.locator('[data-tour-anchor="save"] input').fill(title);
  await saveRowSaveAll(page).click();
  await expect.poll(() => titles(page)).toContain(title);
  await tab.close();
}

async function deleteCloudData(page: Page): Promise<void> {
  await openSyncPane(page);
  await page.getByRole('button', { name: 'Delete cloud data' }).click();
  await page
    .getByRole('dialog', { name: 'Delete your cloud data?' })
    .getByRole('button', { name: 'Delete', exact: true })
    .click();
  await expect(
    page.getByText('Cloud data deleted. Sync is off on this device.')
  ).toBeVisible({ timeout: 20_000 });
}

// Settings › Sync & backup › Auto sync On, then the cloud question's Sync.
async function turnAutoSyncOn(page: Page): Promise<boolean> {
  await openSyncPane(page);
  await page
    .getByRole('group', { name: 'Auto sync' })
    .getByRole('button', { name: 'On' })
    .click();
  const ask = page.getByRole('dialog', {
    name: 'Sync your sessions across devices?',
  });
  await expect(ask).toBeVisible();
  const landed = commitLanded(page);
  await ask.getByRole('button', { name: 'Sync', exact: true }).click();
  return landed;
}

async function deleteSession(page: Page, title: string): Promise<void> {
  await page
    .locator('[data-pane="sessions"]')
    .getByRole('button', { name: title, exact: true })
    .click(ON_TITLE);
  await page.keyboard.press('Delete');
  await expect.poll(() => titles(page)).not.toContain(title);
}

// A device's first sync with S1 and S2, and its id for the second device.
async function startDeviceA(
  context: BrowserContext,
  extensionId: string,
  serviceWorker: Parameters<typeof storedDeviceId>[0]
): Promise<{ page: Page; token: string; commits: string[] }> {
  const commits: string[] = [];
  await context.route(COMMIT, async (route) => {
    commits.push(route.request().url());
    await route.continue();
  });
  await seedOnce(context, [S1, S2]);
  const page = await context.newPage();
  await page.setViewportSize({ width: 790, height: 550 });
  const started = commitLanded(page);
  await page.goto(`chrome-extension://${extensionId}/index.html`);
  expect(await started, "device A's startup sync never wrote").toBe(true);
  const token = await storedDeviceId(serviceWorker);
  if (token === null) throw new Error('device A has no tokenValue');
  return { page, token, commits };
}

const EVERYTHING = [SAVED_ON_A, SAVED_ON_B, S2.title].sort();

test.describe('Delete cloud data, then sync on again, on two devices', () => {
  test.skip(!hasCloudConfig(), 'this build has no cloud config (CI)');
  test.setTimeout(180_000);

  test('B syncs first: it stops instead of uploading, then both turn sync back on and end with every save and without A’s delete', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const { page, token, commits } = await startDeviceA(
      context,
      extensionId,
      serviceWorker
    );
    const deviceB = await openSecondDevice(token, [S1, S2]);
    try {
      // B's startup sync has finished: the seed alone already shows these titles.
      await expect.poll(() => lastSynced(deviceB.page)).not.toBe('');
      expect(await titles(deviceB.page)).toEqual([S1.title, S2.title].sort());

      await deleteCloudData(page);

      // A, sync off: a delete and a save, and nothing reaches the cloud.
      await goHome(page);
      const before = commits.length;
      await deleteSession(page, S1.title);
      await saveAs(context, page, SAVED_ON_A);
      await page.waitForTimeout(2000);
      expect(commits.length, 'A wrote while its sync was off').toBe(before);

      // B, sync still on: a save. Its sync finds the document gone after B
      // had synced, so another device deleted it: B stops and says so.
      const bCommits: string[] = [];
      await deviceB.page.context().route(COMMIT, async (route) => {
        bCommits.push(route.request().url());
        await route.continue();
      });
      await saveAs(deviceB.page.context(), deviceB.page, SAVED_ON_B);
      const notice = deviceB.page.getByRole('dialog', {
        name: 'Your cloud copy was deleted',
      });
      await expect(notice).toBeVisible({ timeout: 20_000 });
      await deviceB.page.waitForTimeout(2000);
      expect(bCommits, 'B uploaded over the delete').toEqual([]);
      expect(await titles(deviceB.page)).toEqual(
        [S1.title, S2.title, SAVED_ON_B].sort()
      );
      // Keep it off for now: the card keeps the reason.
      await notice.getByRole('button', { name: 'Keep sync off' }).click();
      await openSyncPane(deviceB.page);
      const status = deviceB.page.getByTestId('sync-status');
      await expect(status).toHaveAttribute(
        'data-sync-state',
        'deletedElsewhere'
      );
      // Then on again from Auto sync (KAN-772): B's copy becomes the new cloud copy.
      await expect(status.getByRole('button')).toHaveCount(0);
      await goHome(deviceB.page);
      expect(
        await turnAutoSyncOn(deviceB.page),
        "device B's turn-on never wrote"
      ).toBe(true);
      await expect(status).not.toHaveAttribute(
        'data-sync-state',
        'deletedElsewhere'
      );

      // A turns Auto sync back on: its copy and B's upload merge.
      await goHome(page);
      expect(await turnAutoSyncOn(page), "A's sync never wrote").toBe(true);
      await expect.poll(() => titles(page)).toEqual(EVERYTHING);
      expect(await graves(page)).toContain('S1');

      // B reads the merge.
      await goHome(deviceB.page);
      await expect.poll(() => titles(deviceB.page)).toEqual(EVERYTHING);
      expect(await graves(deviceB.page)).toContain('S1');
    } finally {
      await deviceB.close();
    }
  });

  test('A turns sync back on first: B then merges in A’s changes, and later saves still reach A', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const { page, token } = await startDeviceA(
      context,
      extensionId,
      serviceWorker
    );
    const deviceB = await openSecondDevice(token, [S1, S2]);
    try {
      // B's startup sync has finished: the seed alone already shows these titles.
      await expect.poll(() => lastSynced(deviceB.page)).not.toBe('');
      expect(await titles(deviceB.page)).toEqual([S1.title, S2.title].sort());

      await deleteCloudData(page);
      await goHome(page);
      await deleteSession(page, S1.title);
      await saveAs(context, page, SAVED_ON_A);

      // A first: the document is gone, so A uploads its own copy.
      await goHome(page);
      expect(await turnAutoSyncOn(page), "A's sync never wrote").toBe(true);
      await expect
        .poll(() => titles(page))
        .toEqual([S2.title, SAVED_ON_A].sort());

      // B, which never noticed the delete, picks up A's delete and save.
      await goHome(deviceB.page);
      await expect
        .poll(() => titles(deviceB.page))
        .toEqual([S2.title, SAVED_ON_A].sort());
      expect(await graves(deviceB.page)).toContain('S1');

      // And B's next save reaches A.
      const bWrote = commitLanded(deviceB.page);
      await saveAs(deviceB.page.context(), deviceB.page, SAVED_ON_B);
      expect(await bWrote, "device B's save never reached the cloud").toBe(
        true
      );
      await goHome(page);
      await expect.poll(() => titles(page)).toEqual(EVERYTHING);
    } finally {
      await deviceB.close();
    }
  });
});
