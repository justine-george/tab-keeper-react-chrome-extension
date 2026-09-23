import type { BrowserContext, Page, Route } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { buildContainer, buildSession } from './fixtures/seed';

// KAN-291, in a real browser against the real cloud. The sync's write used to
// put the copy it read BEFORE the Firestore write back into localStorage
// AFTER it, over any edit made meanwhile; the follow-up sync then merged that
// old copy and the edit vanished on screen and never reached the cloud.
//
// The only thing staged is timing: Tab Keeper's Firestore client sends each
// write as one `documents:commit` request, and this holds the first one until
// the edit is in. Everything else -- the app, the sign-in, the read, the
// merge, the server -- is real.
//
// Needs a build that carries the Firebase config (a local build with a .env).
// PR CI builds without one (KAN-147) and makes no cloud request at all, so
// the test skips there rather than passing on nothing.

const COMMIT = /firestore\.googleapis\.com\/.*documents:commit/;
const CLOUD = /firestore\.googleapis\.com|identitytoolkit\.googleapis\.com/;

// Seeds once per profile rather than on every navigation (seedSessions'
// init script re-runs on reload): the cloud read-back below clears the local
// copy and reloads, and a re-seed would put "Before" back and hide the cloud.
async function seedOnce(context: BrowserContext): Promise<void> {
  const container = buildContainer([
    buildSession({ tabGroupId: 's1', title: 'Before', isSelected: true }),
  ]);
  container.selectedTabGroupId = 's1';
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

// Holds the first commit until `release` is called; later ones pass straight
// through. `held` resolves once the first one has arrived and is waiting.
function holdFirstCommit(context: BrowserContext) {
  let commits = 0;
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  let arrived!: () => void;
  const held = new Promise<void>((r) => (arrived = r));
  const ready = context.route(COMMIT, async (route: Route) => {
    commits += 1;
    if (commits === 1) {
      arrived();
      await gate;
    }
    await route.continue();
  });
  return { ready, held, release, commits: () => commits };
}

const storedTitle = (page: Page) =>
  page.evaluate(
    () =>
      JSON.parse(window.localStorage.getItem('tabContainerData') ?? 'null')
        ?.tabGroups?.[0]?.title ?? null
  );

async function openPopup(context: BrowserContext, extensionId: string) {
  const page = await context.newPage();
  await page.setViewportSize({ width: 790, height: 550 });
  const cloudRequests: string[] = [];
  page.on('request', (r) => {
    if (CLOUD.test(r.url())) cloudRequests.push(r.url());
  });
  await page.goto(`chrome-extension://${extensionId}/index.html`);
  return { page, cloudRequests };
}

async function rename(page: Page, from: string, to: string) {
  await page.getByRole('button', { name: `Rename session: ${from}` }).click();
  const input = page.locator('input:focus');
  await expect(input).toBeVisible();
  await input.fill(to);
  await input.press('Enter');
}

// The cloud's copy, read by the app itself: drop the local copy and reload,
// so the startup sync can only take the title from Firestore.
async function cloudTitle(page: Page): Promise<string | null> {
  await page.evaluate(() => window.localStorage.removeItem('tabContainerData'));
  await page.reload();
  await expect
    .poll(() => storedTitle(page), { timeout: 15_000 })
    .not.toBeNull();
  return storedTitle(page);
}

test.describe('a sync write keeps an edit made while it was in flight (KAN-291)', () => {
  test('an edit made while the write is held survives, on screen and in the cloud', async ({
    context,
    extensionId,
  }) => {
    await seedOnce(context);
    const hold = holdFirstCommit(context);
    await hold.ready;
    const { page, cloudRequests } = await openPopup(context, extensionId);

    // The startup sync finds no cloud document for this fresh device and
    // writes the local copy ("Before"). That write is the one held.
    const reached = await Promise.race([
      hold.held.then(() => true),
      page.waitForTimeout(20_000).then(() => false),
    ]);
    test.skip(
      !reached && cloudRequests.length === 0,
      'this build has no cloud config (CI); nothing to hold'
    );
    expect(reached, 'the startup write never reached the cloud').toBe(true);

    await rename(page, 'Before', 'After');
    await expect(
      page.getByRole('button', { name: 'Rename session: After' })
    ).toBeVisible();
    expect(await storedTitle(page)).toBe('After');
    // Still held: the edit landed inside the write, which is the whole case.
    expect(hold.commits()).toBe(1);

    // Past the 500ms debounce, so the edit's own sync is queued behind the
    // held write (KAN-269) -- the path a real user takes.
    await page.waitForTimeout(1_500);
    hold.release();

    // Let the write land and the follow-up sync read, merge and (if it saw
    // the edit) write.
    await page.waitForTimeout(5_000);

    expect
      .soft(await storedTitle(page), 'localStorage after the write lands')
      .toBe('After');
    await expect
      .soft(
        page.getByRole('button', { name: 'Rename session: After' }),
        'the screen after the follow-up sync'
      )
      .toBeVisible({ timeout: 1_000 });
    expect.soft(await cloudTitle(page), 'the cloud copy').toBe('After');
  });

  // CONTROL: the same steps with the rename made after the write lands. It
  // must pass on the broken build too, or the test above could be failing
  // for a reason that has nothing to do with the timing.
  test('CONTROL: an edit made after the write lands survives', async ({
    context,
    extensionId,
  }) => {
    await seedOnce(context);
    const hold = holdFirstCommit(context);
    await hold.ready;
    const { page, cloudRequests } = await openPopup(context, extensionId);

    const reached = await Promise.race([
      hold.held.then(() => true),
      page.waitForTimeout(20_000).then(() => false),
    ]);
    test.skip(
      !reached && cloudRequests.length === 0,
      'this build has no cloud config (CI); nothing to hold'
    );
    expect(reached, 'the startup write never reached the cloud').toBe(true);

    hold.release();
    await page.waitForTimeout(3_000);
    await rename(page, 'Before', 'After');
    await page.waitForTimeout(5_000);

    expect.soft(await storedTitle(page)).toBe('After');
    await expect
      .soft(page.getByRole('button', { name: 'Rename session: After' }))
      .toBeVisible({ timeout: 1_000 });
    expect.soft(await cloudTitle(page), 'the cloud copy').toBe('After');
  });
});
