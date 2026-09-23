import { chromium, type BrowserContext, type Page } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { test, expect } from './fixtures/extension';
import {
  buildContainer,
  buildSession,
  seedCloudConsentIfSettingsAbsent,
} from './fixtures/seed';

// KAN-292, in a real browser against the real cloud. Ctrl+Z is not gated on
// "is there anything to undo"; with an empty history the middleware still
// applied the stale undo snapshot and started a sync. After a later sync had
// merged another device's session, that snapshot did not have it, so the
// session vanished until the next read brought it back.
//
// Nothing is staged but a second device: another throwaway profile adopts
// this device's id (it is only a uuid in chrome.storage.sync) and adds a
// session through the real dev cloud.
//
// Needs a build that carries the Firebase config (a local build with a .env).
// PR CI builds without one (KAN-147) and makes no cloud request at all, so
// the tests skip there rather than passing on nothing.

const DIST = fileURLToPath(new URL('../dist', import.meta.url));
const CLOUD = /firestore\.googleapis\.com|identitytoolkit\.googleapis\.com/;
const COMMIT = /firestore\.googleapis\.com\/.*documents:commit/;

const LOCAL = buildSession({
  tabGroupId: 'kept',
  title: 'Kept on this device',
  isSelected: true,
});
const REMOTE = buildSession({
  tabGroupId: 'arrived',
  title: 'Added on the laptop',
});

// Once per profile: init scripts re-run on every navigation.
async function seedOnce(
  context: BrowserContext,
  sessions = [LOCAL]
): Promise<void> {
  const container = buildContainer(sessions);
  container.selectedTabGroupId = LOCAL.tabGroupId;
  await context.addInitScript((value: string) => {
    try {
      if (window.localStorage.getItem('e2e-seeded') !== null) return;
      window.localStorage.setItem('e2e-seeded', '1');
      window.localStorage.setItem('tabContainerData', value);
    } catch {
      // Storage blocked; the assertions below say so more clearly.
    }
  }, JSON.stringify(container));
}

async function openPopup(context: BrowserContext, extensionId: string) {
  const page = await context.newPage();
  await page.setViewportSize({ width: 790, height: 550 });
  const cloudRequests: string[] = [];
  page.on('request', (r) => {
    if (CLOUD.test(r.url())) cloudRequests.push(r.url());
  });
  const commit = page.waitForRequest(COMMIT, { timeout: 20_000 }).then(
    () => true,
    () => false
  );
  await page.goto(`chrome-extension://${extensionId}/index.html`);
  return { page, cloudRequests, commit };
}

const storedIds = (page: Page) =>
  page.evaluate(
    () =>
      (
        JSON.parse(window.localStorage.getItem('tabContainerData') ?? 'null')
          ?.tabGroups ?? []
      ).map((g: { tabGroupId: string }) => g.tabGroupId) as string[]
  );

const row = (page: Page, title: string) =>
  page.getByRole('button', { name: title, exact: true });

// Undo and redo are div[role=button]; "disabled" is opacity 0.3, not an
// attribute (e2e-testing-recipes).
const opacityOf = (page: Page, name: string) =>
  page
    .getByRole('button', { name, exact: true })
    .evaluate((el) => getComputedStyle(el).opacity);

async function pressUndo(page: Page): Promise<void> {
  // A real keystroke, aimed at the page rather than an input (the handler
  // ignores keys typed into fields, KAN-52).
  await page.locator('body').click({ position: { x: 5, y: 540 } });
  await page.keyboard.press('Control+z');
}

// Samples for `ms`: was the row ever missing, and did localStorage ever lack
// the id? A vanish that the next read undoes lasts ~a second, so a single
// read afterwards could miss it.
async function watchFor(page: Page, title: string, id: string, ms: number) {
  let rowMissing = 0;
  let storageMissing = 0;
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if ((await row(page, title).count()) === 0) rowMissing += 1;
    if (!(await storedIds(page)).includes(id)) storageMissing += 1;
    await page.waitForTimeout(50);
  }
  return { rowMissing, storageMissing };
}

test.describe('Ctrl+Z with nothing to undo (KAN-292)', () => {
  test('sends nothing to the cloud and leaves the saved sessions alone', async ({
    context,
    extensionId,
  }, testInfo) => {
    await seedOnce(context);
    const { page, cloudRequests, commit } = await openPopup(
      context,
      extensionId
    );
    const synced = await commit;
    test.skip(
      !synced && cloudRequests.length === 0,
      'this build has no cloud config (CI)'
    );
    expect(synced, 'the startup sync never wrote').toBe(true);
    await page.waitForTimeout(3_000); // let the startup sync settle

    expect(await opacityOf(page, 'Undo'), 'Undo shows nothing to undo').toBe(
      '0.3'
    );
    const before = await page.evaluate(() =>
      window.localStorage.getItem('tabContainerData')
    );
    const requestsBefore = cloudRequests.length;

    await pressUndo(page);
    await page.waitForTimeout(3_000); // well past the 500ms sync debounce
    await page.screenshot({
      path: testInfo.outputPath('after-empty-ctrl-z.png'),
    });

    expect
      .soft(
        cloudRequests.slice(requestsBefore),
        'cloud requests after an empty-history Ctrl+Z'
      )
      .toEqual([]);
    expect
      .soft(
        await page.evaluate(() =>
          window.localStorage.getItem('tabContainerData')
        ),
        'localStorage after an empty-history Ctrl+Z'
      )
      .toBe(before);
  });

  // CONTROL: with a real step to undo, the same keystroke does undo and does
  // sync. Without it, "no requests" could mean the key never reached the app.
  test('CONTROL: with a rename to undo, Ctrl+Z undoes it and syncs', async ({
    context,
    extensionId,
  }) => {
    await seedOnce(context);
    const { page, cloudRequests, commit } = await openPopup(
      context,
      extensionId
    );
    const synced = await commit;
    test.skip(
      !synced && cloudRequests.length === 0,
      'this build has no cloud config (CI)'
    );
    await page.waitForTimeout(3_000);

    await page
      .getByRole('button', { name: `Rename session: ${LOCAL.title}` })
      .click();
    const input = page.locator('input:focus');
    await input.fill('Renamed');
    await input.press('Enter');
    await expect(row(page, 'Renamed')).toBeVisible();
    await page.waitForTimeout(3_000); // the rename's own sync
    const requestsBefore = cloudRequests.length;

    await pressUndo(page);
    await expect(row(page, LOCAL.title)).toBeVisible();
    await page.waitForTimeout(3_000);
    expect(cloudRequests.length).toBeGreaterThan(requestsBefore);
  });

  test("after a later sync brings in another device's session, Ctrl+Z keeps it", async ({
    context,
    extensionId,
    serviceWorker,
  }, testInfo) => {
    // Device A (this one): one session, synced up.
    await seedOnce(context);
    const a = await openPopup(context, extensionId);
    const synced = await a.commit;
    test.skip(
      !synced && a.cloudRequests.length === 0,
      'this build has no cloud config (CI)'
    );
    expect(synced, 'the startup sync never wrote').toBe(true);
    await a.page.waitForTimeout(3_000);
    const token = await serviceWorker.evaluate(
      async () =>
        (await chrome.storage.sync.get(['tokenValue'])).tokenValue as string
    );

    // Device B: a second profile that adopts A's id before it first opens,
    // and holds A's session plus one of its own. Its startup sync merges and
    // writes both to the cloud.
    const dirB = mkdtempSync(join(tmpdir(), 'tabkeeper-e2e-b-'));
    const b = await chromium.launchPersistentContext(dirB, {
      headless: true,
      channel: 'chromium',
      args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`],
    });
    try {
      await seedCloudConsentIfSettingsAbsent(b);
      await seedOnce(b, [LOCAL, REMOTE]);
      const workerB =
        b.serviceWorkers()[0] ?? (await b.waitForEvent('serviceworker'));
      await workerB.evaluate(
        (t: string) => chrome.storage.sync.set({ tokenValue: t }),
        token
      );
      const idB = new URL(workerB.url()).host;
      const pageB = await openPopup(b, idB);
      expect(await pageB.commit, 'device B never wrote to the cloud').toBe(
        true
      );
      await pageB.page.waitForTimeout(3_000);
    } finally {
      await b.close();
      rmSync(dirB, { recursive: true, force: true });
    }

    // Back on A: a LATER sync (not the startup one) brings the session in.
    await a.page.getByRole('button', { name: 'Sync now' }).click();
    await expect(row(a.page, REMOTE.title)).toBeVisible({ timeout: 15_000 });
    await a.page.waitForTimeout(2_000);
    await a.page.screenshot({
      path: testInfo.outputPath('1-after-later-sync.png'),
    });
    // The premise: the session is here, and there is nothing to undo.
    expect(await storedIds(a.page)).toContain(REMOTE.tabGroupId);
    expect(await opacityOf(a.page, 'Undo')).toBe('0.3');

    await pressUndo(a.page);
    await a.page.waitForTimeout(100);
    await a.page.screenshot({
      path: testInfo.outputPath('2-just-after-ctrl-z.png'),
    });
    const seen = await watchFor(a.page, REMOTE.title, REMOTE.tabGroupId, 4_000);
    console.log(
      `[KAN-292] samples missing after Ctrl+Z: ${JSON.stringify(seen)}`
    );

    expect.soft(seen.rowMissing, 'row samples missing the session').toBe(0);
    expect
      .soft(seen.storageMissing, 'localStorage samples missing the session')
      .toBe(0);
  });
});
