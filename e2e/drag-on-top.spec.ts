import {
  chromium,
  type BrowserContext,
  type Locator,
  type Page,
  type Route,
  type Worker,
} from '@playwright/test';
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

// KAN-279 D12, in a real browser against the real cloud. While a row is held,
// a sync that brings in another device's change does not apply it: the list
// would move under the pointer, and the drag engine measured its rects once.
// At the drop the change goes in FIRST and the move lands on top of it,
// re-aimed by neighbour -- so the row ends up beside the row it was aimed at,
// not at the old index in a list that has grown.
//
// Nothing is faked but timing. A second profile adopts this device's id (only
// a uuid in chrome.storage.sync) and adds a session through the real dev
// cloud; this device's next read is held until a drag has started.
//
// Needs a build that carries the Firebase config (a local build with a .env).
// PR CI builds without one (KAN-147) and makes no cloud request at all, so
// the tests skip there rather than passing on nothing.

const DIST = fileURLToPath(new URL('../dist', import.meta.url));
const CLOUD = /firestore\.googleapis\.com|identitytoolkit\.googleapis\.com/;
const COMMIT = /firestore\.googleapis\.com\/.*documents:commit/;
// firebase/firestore/lite reads a document with one REST batchGet.
const READ = /firestore\.googleapis\.com\/.*documents:batchGet/;

// How long a negative is watched for. The CONTROL test asserts the arrival
// lands inside this same window, so an absence across it is the hold.
const WATCH_MS = 2_000;

const HOUR = 60 * 60 * 1000;
const BASE = Date.UTC(2026, 8, 1, 9, 0, 0);
const at = (hours: number) => ({
  createdAt: BASE + hours * HOUR,
  createdTime: `2026-09-01 ${String(9 + hours).padStart(2, '0')}:00:00`,
});

// Newest first, no rank: the list sorts on createdAt alone.
const A = buildSession({ tabGroupId: 'a', title: 'Session A', ...at(4) });
const B = buildSession({ tabGroupId: 'b', title: 'Session B', ...at(3) });
const C = buildSession({ tabGroupId: 'c', title: 'Session C', ...at(2) });
const D = buildSession({ tabGroupId: 'd', title: 'Session D', ...at(1) });
// Saved on the other device, newer than A, so it sorts to the top.
const N = buildSession({ tabGroupId: 'n', title: 'Session N', ...at(5) });

const TITLES = new Map(
  [A, B, C, D, N].map((s) => [s.tabGroupId, s.title] as const)
);

// Once per profile: init scripts re-run on every navigation, and this spec
// reloads.
async function seedOnce(
  context: BrowserContext,
  sessions: ReturnType<typeof buildSession>[]
): Promise<void> {
  await context.addInitScript(
    (value: string) => {
      try {
        if (window.localStorage.getItem('e2e-seeded') !== null) return;
        window.localStorage.setItem('e2e-seeded', '1');
        window.localStorage.setItem('tabContainerData', value);
      } catch {
        // Storage blocked; the assertions below say so more clearly.
      }
    },
    JSON.stringify(buildContainer(sessions))
  );
}

async function openPopup(context: BrowserContext, extensionId: string) {
  const page = await context.newPage();
  await page.setViewportSize({ width: 790, height: 550 });
  const cloudRequests: string[] = [];
  page.on('request', (r) => {
    if (CLOUD.test(r.url())) cloudRequests.push(r.url());
  });
  // The RESPONSE, not the request: the write has landed in the cloud.
  const committed = page.waitForResponse(COMMIT, { timeout: 20_000 }).then(
    () => true,
    () => false
  );
  await page.goto(`chrome-extension://${extensionId}/index.html`);
  return { page, cloudRequests, committed };
}

const row = (page: Page, title: string) =>
  page.getByRole('button', { name: title, exact: true });

// Session titles in DOM order. Every drag list marks its rows with
// data-drag-row-id; only the session list uses these ids.
const shownTitles = (page: Page) =>
  page
    .locator('[data-drag-row-id]')
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-drag-row-id')))
    .then((ids) =>
      ids.flatMap((id) => {
        const title = id === null ? undefined : TITLES.get(id);
        return title === undefined ? [] : [title];
      })
    );

// Session titles top to bottom as painted, transforms included: where the
// rows are on screen once any slide has finished, not just their DOM order.
const paintedTitles = (page: Page) =>
  page
    .locator('[data-drag-row-id]')
    .evaluateAll((els) =>
      els
        .map((el) => ({
          id: el.getAttribute('data-drag-row-id'),
          top: el.getBoundingClientRect().top,
        }))
        .sort((p, q) => p.top - q.top)
        .map((r) => r.id)
    )
    .then((ids) =>
      ids.flatMap((id) => {
        const title = id === null ? undefined : TITLES.get(id);
        return title === undefined ? [] : [title];
      })
    );

const storedTitles = (page: Page) =>
  page
    .evaluate(() => window.localStorage.getItem('tabContainerData'))
    .then((raw) => {
      const parsed: unknown = raw === null ? null : JSON.parse(raw);
      const groups =
        typeof parsed === 'object' &&
        parsed !== null &&
        'tabGroups' in parsed &&
        Array.isArray(parsed.tabGroups)
          ? parsed.tabGroups
          : [];
      return groups.flatMap((g: unknown) => {
        const id =
          typeof g === 'object' && g !== null && 'tabGroupId' in g
            ? g.tabGroupId
            : undefined;
        const title = typeof id === 'string' ? TITLES.get(id) : undefined;
        return title === undefined ? [] : [title];
      });
    });

const draggingKind = (page: Page) =>
  page.evaluate(() => document.documentElement.getAttribute('data-dragging'));

async function boxOf(locator: Locator) {
  const box = await locator.boundingBox();
  if (box === null) throw new Error(`no box for ${locator}`);
  return box;
}

// Holds the first read after `ready` until `release` is called; later reads
// (the re-sync after the drop) pass straight through. `held` resolves once
// that read has arrived and is waiting.
function holdNextRead(context: BrowserContext) {
  let reads = 0;
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => (release = r));
  let arrived: (url: string) => void = () => {};
  const held = new Promise<string>((r) => (arrived = r));
  const ready = context.route(READ, async (route: Route) => {
    reads += 1;
    if (reads === 1) {
      arrived(route.request().url());
      await gate;
    }
    await route.continue();
  });
  return { ready, held, release: () => release() };
}

// Steps 1-4: device A writes a, b, c, d; device B adds n through the cloud;
// A reloads and its startup read is held. Returns with the read waiting.
async function stage(
  context: BrowserContext,
  extensionId: string,
  serviceWorker: Worker
) {
  // 1. Device A: a fresh id, so its startup sync writes its local copy.
  await seedOnce(context, [A, B, C, D]);
  const a = await openPopup(context, extensionId);
  const synced = await a.committed;
  test.skip(
    !synced && a.cloudRequests.length === 0,
    'this build has no cloud config (CI)'
  );
  expect(synced, "device A's startup sync never wrote").toBe(true);
  const reads = a.cloudRequests.filter((u) => READ.test(u));
  console.log(`[D12] device A's reads: ${JSON.stringify(reads)}`);
  expect(reads.length, 'the READ pattern matches no request').toBeGreaterThan(
    0
  );

  // 2. A's id.
  const token = await serviceWorker.evaluate(async () => {
    const { tokenValue } = await chrome.storage.sync.get(['tokenValue']);
    return typeof tokenValue === 'string' ? tokenValue : null;
  });
  if (token === null) throw new Error('device A has no tokenValue');

  // 3. Device B: adopts A's id before it first opens, holds a-d plus n, and
  //    its startup sync merges and writes the union.
  const dirB = mkdtempSync(join(tmpdir(), 'tabkeeper-e2e-b-'));
  const b = await chromium.launchPersistentContext(dirB, {
    headless: true,
    channel: 'chromium',
    args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`],
  });
  try {
    await seedCloudConsentIfSettingsAbsent(b);
    await seedOnce(b, [N, A, B, C, D]);
    const workerB =
      b.serviceWorkers()[0] ?? (await b.waitForEvent('serviceworker'));
    await workerB.evaluate(
      (t: string) => chrome.storage.sync.set({ tokenValue: t }),
      token
    );
    const pageB = await openPopup(b, new URL(workerB.url()).host);
    expect(await pageB.committed, 'device B never wrote to the cloud').toBe(
      true
    );
  } finally {
    await b.close();
    rmSync(dirB, { recursive: true, force: true });
  }

  // 4. Back on A: hold the next read, and reload so the startup sync makes
  //    it. The list renders from localStorage meanwhile.
  const hold = holdNextRead(context);
  await hold.ready;
  await a.page.reload();
  await expect(row(a.page, D.title)).toBeVisible();
  const heldUrl = await Promise.race([
    hold.held,
    a.page.waitForTimeout(20_000).then(() => null),
  ]);
  expect(heldUrl, "device A's startup read never arrived").not.toBeNull();
  console.log(`[D12] held read: ${heldUrl}`);
  expect(await shownTitles(a.page)).toEqual([
    A.title,
    B.title,
    C.title,
    D.title,
  ]);
  return { page: a.page, hold };
}

// Samples for `ms`: how often was n on screen or in localStorage, and how
// often was the order not a, b, c, d?
async function watchMidDrag(page: Page, ms: number) {
  const unmoved = [A.title, B.title, C.title, D.title].join(',');
  let nShown = 0;
  let nStored = 0;
  let reordered = 0;
  let samples = 0;
  const end = Date.now() + ms;
  while (Date.now() < end) {
    samples += 1;
    const shown = await shownTitles(page);
    if (shown.includes(N.title)) nShown += 1;
    if (shown.join(',') !== unmoved) reordered += 1;
    if ((await storedTitles(page)).includes(N.title)) nStored += 1;
    await page.waitForTimeout(50);
  }
  return { samples, nShown, nStored, reordered };
}

test.describe('a drag acts on top of a change arriving mid-drag (KAN-279 D12)', () => {
  test.setTimeout(120_000);

  test('the change waits while the row is held, and the drop lands beside its aim', async ({
    context,
    extensionId,
    serviceWorker,
  }, testInfo) => {
    const { page, hold } = await stage(context, extensionId, serviceWorker);

    // 5. Pick up d and aim it between a and b, with the read still held.
    //    Pressed at d's centre, so the pointer and the row's centre agree;
    //    aimed at b's top edge, below a's midpoint and above b's.
    const d = await boxOf(page.locator('[data-drag-row-id="d"]'));
    const b = await boxOf(page.locator('[data-drag-row-id="b"]'));
    const x = d.x + d.width / 2;
    const startY = d.y + d.height / 2;
    await page.mouse.move(x, startY);
    await page.mouse.down();
    await page.mouse.move(x, startY - 8, { steps: 4 });
    await page.mouse.move(x, b.y, { steps: 10 });
    expect(await draggingKind(page), 'the drag never started').toBe('session');

    // 6. Release the read. The merge brings n in and, with the row held,
    //    waits instead of applying.
    const landed = page.waitForResponse(READ);
    hold.release();
    await landed;
    const seen = await watchMidDrag(page, WATCH_MS);
    const step6 = {
      ...seen,
      dragging: await draggingKind(page),
      shown: await shownTitles(page),
      stored: await storedTitles(page),
    };
    console.log(`[D12] step 6, mouse still down: ${JSON.stringify(step6)}`);
    await page.screenshot({
      path: testInfo.outputPath('6-read-landed-mouse-down.png'),
    });
    expect(step6.dragging, 'the drag ended before the drop').toBe('session');
    expect(step6.nShown, 'samples with n on screen mid-drag').toBe(0);
    expect(step6.reordered, 'samples with the list reordered mid-drag').toBe(0);
    expect(step6.nStored, 'samples with n in localStorage mid-drag').toBe(0);
    expect(step6.shown).toEqual([A.title, B.title, C.title, D.title]);

    // 7. Drop. The held change goes in first, then d lands beside a -- where
    //    it was aimed -- not at the old index (which gives n, d, a, b, c).
    await page.mouse.up();
    const expected = [N.title, A.title, D.title, B.title, C.title];
    await expect
      .poll(() => shownTitles(page), { timeout: 5_000 })
      .toEqual(expected);
    await expect(row(page, N.title)).toBeVisible();
    await expect(
      page.getByText('Synced changes from another device.')
    ).toBeVisible();
    await expect
      .poll(() => paintedTitles(page), { timeout: 5_000 })
      .toEqual(expected);
    await expect
      .poll(() => storedTitles(page), { timeout: 5_000 })
      .toEqual(expected);
    console.log(
      `[D12] step 7, after the drop: ${JSON.stringify({
        shown: await shownTitles(page),
        painted: await paintedTitles(page),
        stored: await storedTitles(page),
      })}`
    );
    // The rows slide into place; let d come to rest before the picture.
    const dRow = page.locator('[data-drag-row-id="d"]');
    await expect
      .poll(async () => {
        const before = (await boxOf(dRow)).y;
        await page.waitForTimeout(100);
        return (await boxOf(dRow)).y === before;
      })
      .toBe(true);
    await page.screenshot({ path: testInfo.outputPath('7-after-drop.png') });
  });

  // CONTROL: the same staging with no drag. The released read must bring n on
  // screen inside the window the test above watches, or its absence there
  // could be a staging failure rather than the hold.
  test('CONTROL: with no row held, the released read brings n in at once', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const { page, hold } = await stage(context, extensionId, serviceWorker);

    const landed = page.waitForResponse(READ);
    hold.release();
    await landed;
    const t0 = Date.now();
    await expect
      .poll(() => shownTitles(page), { timeout: WATCH_MS })
      .toEqual([N.title, A.title, B.title, C.title, D.title]);
    console.log(
      `[D12] CONTROL: n on screen ${Date.now() - t0}ms after the read landed`
    );
    await expect
      .poll(() => storedTitles(page), { timeout: WATCH_MS })
      .toContain(N.title);
  });
});
