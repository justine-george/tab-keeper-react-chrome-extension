import type { BrowserContext, Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { localeStrings } from './fixtures/locales';
import { buildContainer, buildSession } from './fixtures/seed';

// KAN-279 D9, in a real browser. Two open pages of the extension (the popup
// and the pop-out tab, here two tabs of index.html) share one localStorage.
// When one writes, the browser fires `storage` in the other, and the other
// takes the change in without a reload: the sessions (keeping its own
// selection, and dropping its own undo history, D12) and the settings (the
// language included).
//
// jsdom fires no cross-document storage event, so only a real browser can say
// the listener is wired: that the event arrives, at the root, and reaches the
// screen.
//
// Needs no cloud config: storage events are local. Auto Sync is off (see
// seedOnce), and each test checks that no page reached the cloud, so a sync
// cannot be what carried a change across. The last describe is the exception:
// it turns Auto Sync on to check that a sync keeps each page's own selection
// (KAN-294), and needs a build with the cloud config.

const A = buildSession({ tabGroupId: 'alpha', title: 'Alpha session' });
const B = buildSession({ tabGroupId: 'bravo', title: 'Bravo session' });
const C = buildSession({ tabGroupId: 'charlie', title: 'Charlie session' });

// Once per profile: init scripts re-run on every navigation, and in every
// page of the context -- page 2 would otherwise re-seed over page 1's edits.
//
// Auto Sync is off by default (with the cloud question answered, so no
// modal). A sync is a second route from localStorage into a page: its
// local-only and merge branches load the container from localStorage.
// Measured against a build with the listener removed: page 1's startup sync
// landed after page 2's rename and brought it in, so with sync on "page 1
// shows page 2's change" passes without the listener. With it off the storage
// event is the only way a change can cross. (That sync also brought page 2's
// selection with it: KAN-294, checked with Auto Sync on at the end.)
async function seedOnce(
  context: BrowserContext,
  settings: { cloudConsent: 'granted'; isAutoSync: boolean } = {
    cloudConsent: 'granted',
    isAutoSync: false,
  }
): Promise<void> {
  await context.addInitScript(
    (seed: { sessions: string; settings: string }) => {
      try {
        if (window.localStorage.getItem('e2e-seeded') !== null) return;
        window.localStorage.setItem('e2e-seeded', '1');
        window.localStorage.setItem('tabContainerData', seed.sessions);
        window.localStorage.setItem('settingsData', seed.settings);
      } catch {
        // Storage blocked; the assertions below say so more clearly.
      }
    },
    {
      sessions: JSON.stringify(buildContainer([A, B, C])),
      settings: JSON.stringify(settings),
    }
  );
}

const softly = expect.configure({ soft: true });

const row = (page: Page, title: string) =>
  page.getByRole('button', { name: title, exact: true });

// The selected session's header carries its rename control, and only the
// selected session has a header: this is what says which session a page has
// selected (TabGroupEntry marks the row with a colour, not an attribute).
const renameControl = (page: Page, title: string) =>
  page.getByRole('button', { name: `Rename session: ${title}`, exact: true });

// Undo and redo are div[role=button]; "disabled" is opacity 0.3, not an
// attribute (e2e-testing-recipes).
const opacityOf = (page: Page, name: string) =>
  page
    .getByRole('button', { name, exact: true })
    .evaluate((el) => getComputedStyle(el).opacity);

const CLOUD = /firestore\.googleapis\.com|identitytoolkit\.googleapis\.com/;

async function openPage(
  context: BrowserContext,
  extensionId: string,
  cloudRequests: string[]
): Promise<Page> {
  const page = await context.newPage();
  await page.setViewportSize({ width: 790, height: 550 });
  page.on('request', (r) => {
    if (CLOUD.test(r.url())) cloudRequests.push(r.url());
  });
  await page.goto(`chrome-extension://${extensionId}/index.html`);
  // goto resolves before React mounts and the store hydrates.
  await expect(row(page, A.title)).toBeVisible();
  return page;
}

async function select(page: Page, title: string): Promise<void> {
  // Near the left edge: the row's Open/Switch/Delete overlay its right half.
  await row(page, title).click({ position: { x: 20, y: 20 } });
  await expect(renameControl(page, title)).toBeVisible();
}

async function rename(page: Page, from: string, to: string): Promise<void> {
  await renameControl(page, from).click();
  const input = page.locator('input:focus');
  await expect(input).toBeVisible();
  await input.fill(to);
  await input.press('Enter');
  await expect(renameControl(page, to)).toBeVisible();
}

// What a page would lose if it navigated: a reload or a re-open gives it a
// new time origin and a fresh window without the marker.
const pageIdentity = (page: Page) =>
  page.evaluate(() => ({
    timeOrigin: performance.timeOrigin,
    marker: Reflect.get(window, '__liveReloadMarker'),
  }));

const storedSelection = (page: Page) =>
  page.evaluate(() => {
    const raw = window.localStorage.getItem('tabContainerData');
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const id: unknown = Reflect.get(parsed, 'selectedTabGroupId');
    return typeof id === 'string' ? id : null;
  });

// Two pages, each with its own session selected: page 1 on B, page 2 on C.
async function openTwo(context: BrowserContext, extensionId: string) {
  await seedOnce(context);
  const cloudRequests: string[] = [];
  const page1 = await openPage(context, extensionId, cloudRequests);
  const page2 = await openPage(context, extensionId, cloudRequests);
  await select(page1, B.title);
  await select(page2, C.title);
  return { page1, page2, cloudRequests };
}

test.describe('open pages reload what another page changed (KAN-279 D9)', () => {
  test("a rename in page 1 appears in page 2 without a reload, and resets page 2's undo", async ({
    context,
    extensionId,
  }, testInfo) => {
    const { page1, page2, cloudRequests } = await openTwo(context, extensionId);

    // Page 2 makes an edit of its own, so it has something to undo.
    await rename(page2, C.title, 'Renamed in page 2');
    await expect.poll(() => opacityOf(page2, 'Undo')).toBe('1');
    // Page 1 took page 2's rename in, too: the listener runs both ways.
    await softly(row(page1, 'Renamed in page 2')).toBeVisible();

    await page2.evaluate(() =>
      Reflect.set(window, '__liveReloadMarker', 'before')
    );
    const before = await pageIdentity(page2);
    expect(before.marker).toBe('before');

    // Still something to undo in page 2, now that page 1's own hydrate has
    // had its turn: the reset below is page 1's doing.
    expect(await opacityOf(page2, 'Undo')).toBe('1');

    await rename(page1, B.title, 'Renamed in page 1');

    // Soft, so that a page 2 that never hears of the change reports both
    // halves -- the row and the undo -- rather than stopping at the first.
    await softly
      .poll(() => row(page2, 'Renamed in page 1').count(), {
        message: "page 2 never showed page 1's rename",
        timeout: 5_000,
      })
      .toBe(1);
    await softly(row(page2, B.title)).toHaveCount(0);
    // D12: a change page 2 did not make leaves it nothing to undo.
    await softly
      .poll(() => opacityOf(page2, 'Undo'), {
        message: "page 2's undo survived another page's change",
        timeout: 5_000,
      })
      .toBe('0.3');
    // A reload would show the row and reset the undo too; this is what tells
    // a live take-in from one.
    softly(await pageIdentity(page2), 'page 2 navigated').toEqual(before);
    // Page 2 kept its own selection through the hydrate.
    await expect(renameControl(page2, 'Renamed in page 2')).toBeVisible();

    await page2.screenshot({ path: testInfo.outputPath('page2-after.png') });
    expect(cloudRequests, 'a page reached the cloud').toEqual([]);
  });

  test("selecting in page 1 does not move page 2's selection", async ({
    context,
    extensionId,
  }, testInfo) => {
    const { page1, page2, cloudRequests } = await openTwo(context, extensionId);

    await select(page1, A.title);
    // CONTROL: the selection reached the shared storage, so page 2 was told.
    await expect.poll(() => storedSelection(page1)).toBe(A.tabGroupId);

    // Then a data change from page 1 that page 2 must take in: the hydrate is
    // where page 2's selection could be replaced by the one in storage.
    await rename(page1, A.title, 'Alpha renamed in page 1');
    await expect(row(page2, 'Alpha renamed in page 1')).toBeVisible();

    await expect(renameControl(page2, C.title)).toBeVisible();
    await expect(renameControl(page2, 'Alpha renamed in page 1')).toHaveCount(
      0
    );
    // And the rows agree: the painted highlight is on C, not on A.
    const background = (title: string) =>
      row(page2, title)
        .locator('..')
        .evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(await background('Alpha renamed in page 1')).toBe(
      'rgba(0, 0, 0, 0)'
    );
    expect(await background(C.title)).not.toBe('rgba(0, 0, 0, 0)');
    await page2.screenshot({ path: testInfo.outputPath('page2-after.png') });
    expect(cloudRequests, 'a page reached the cloud').toEqual([]);
  });

  test('a language change in page 1 reaches page 2', async ({
    context,
    extensionId,
  }, testInfo) => {
    const { page1, page2, cloudRequests } = await openTwo(context, extensionId);
    const de = localeStrings('de');

    // CONTROL: page 2 starts in English.
    await expect(page2.locator('html')).toHaveAttribute('lang', 'en');
    await expect(
      page2.getByRole('button', { name: 'Undo', exact: true })
    ).toBeVisible();

    await page1.getByRole('button', { name: 'Settings', exact: true }).click();
    await page1.locator('button[aria-label="Language"]').click();
    await page1.getByRole('button', { name: 'Deutsch', exact: true }).click();
    await expect(page1.locator('html')).toHaveAttribute('lang', 'de');

    // Soft: the html lang (documentLanguage.ts, on i18n's languageChanged)
    // and the rendered labels are two outputs, and a failure should name both.
    await softly
      .poll(() => page2.evaluate(() => document.documentElement.lang), {
        message: 'page 2 did not follow the language',
        timeout: 5_000,
      })
      .toBe('de');
    await softly(
      page2.getByRole('button', { name: de['Undo'], exact: true })
    ).toBeVisible();
    await softly(
      page2.getByRole('button', { name: 'Undo', exact: true })
    ).toHaveCount(0);
    await page2.screenshot({ path: testInfo.outputPath('page2-after.png') });
    expect(cloudRequests, 'a page reached the cloud').toEqual([]);
  });
});

// KAN-294. A sync loads the container from localStorage, which holds the
// selection of whichever page wrote LAST. Selection is per page, so a sync
// must keep this page's own. Auto Sync is on here, so every storage event
// flows while the syncs run; each page is synced by its Sync now control
// while the OTHER page's selection is the one in localStorage.
//
// Needs a build that carries the Firebase config (a local build with a
// .env). PR CI builds without one (KAN-147) and makes no cloud request at
// all, so the test skips there rather than passing on nothing.
test.describe('a sync keeps each page its own selection (KAN-294)', () => {
  const READ = /firestore\.googleapis\.com\/.*documents:batchGet/;

  // The header's sync control shows the sync's state as its glyph: the icon
  // font's ligature is the element's text (MenuContainer).
  const syncControl = (page: Page) =>
    page.getByRole('button', { name: 'Sync now', exact: true });

  // Sync now, and wait for that sync to read the cloud and settle.
  async function syncNow(page: Page): Promise<void> {
    await expect(syncControl(page)).toHaveText('cloud_done');
    const read = page.waitForResponse((r) => READ.test(r.url()));
    await syncControl(page).click();
    await read;
    await expect(syncControl(page)).toHaveText('cloud_done', {
      timeout: 15_000,
    });
  }

  test("a sync in either page keeps that page's selection, not the last writer's", async ({
    context,
    extensionId,
  }, testInfo) => {
    await seedOnce(context, { cloudConsent: 'granted', isAutoSync: true });
    const cloudRequests: string[] = [];
    const page1 = await openPage(context, extensionId, cloudRequests);

    // Page 1's startup sync: a fresh anonymous user, so it finds no document
    // and writes the local copy.
    const synced = await expect(syncControl(page1))
      .toHaveText('cloud_done', { timeout: 20_000 })
      .then(() => true)
      .catch(() => false);
    test.skip(
      !synced && cloudRequests.length === 0,
      'this build has no cloud config (CI); nothing to sync'
    );
    expect(synced, "page 1's startup sync never completed").toBe(true);

    const page2 = await openPage(context, extensionId, cloudRequests);
    await expect(syncControl(page2)).toHaveText('cloud_done', {
      timeout: 20_000,
    });

    await select(page1, B.title);
    await select(page2, C.title);
    // CONTROL: page 2 wrote last, so localStorage holds ITS selection -- the
    // one page 1's sync is about to read.
    await expect.poll(() => storedSelection(page1)).toBe(C.tabGroupId);

    await syncNow(page1);

    await softly(
      renameControl(page1, B.title),
      "page 1's sync took page 2's selection"
    ).toBeVisible();
    await softly(renameControl(page1, C.title)).toHaveCount(0);
    // The sync's load wrote page 1's selection back, and page 2 was told of
    // it: same data, so page 2 took nothing in and kept its own.
    await expect.poll(() => storedSelection(page1)).toBe(B.tabGroupId);
    await expect(renameControl(page2, C.title)).toBeVisible();
    await page1.screenshot({ path: testInfo.outputPath('page1-after.png') });

    // And the other way round: page 1 wrote last, page 2 syncs.
    await syncNow(page2);

    await softly(
      renameControl(page2, C.title),
      "page 2's sync took page 1's selection"
    ).toBeVisible();
    await softly(renameControl(page2, B.title)).toHaveCount(0);
    await expect(renameControl(page1, B.title)).toBeVisible();
    await page2.screenshot({ path: testInfo.outputPath('page2-after.png') });
  });
});
