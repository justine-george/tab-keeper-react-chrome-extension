import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  chromium,
  expect,
  test,
  type BrowserContext,
  type Worker,
} from '@playwright/test';

import { DIST } from './fixtures/cloud';
import { allowInIncognito } from './fixtures/incognito';
import {
  ReusedBrowser,
  removeDirs,
  type LaunchedBrowser,
} from './fixtures/reusedBrowser';

// KAN-766. Drives a ReusedBrowser as the fixtures do between two tests: take,
// leave state behind, give back, take again. Each test has its own, so none
// depends on another's order (the shard reporter deals tests one by one).

const DIRT_URL = 'https://dirt.invalid/';

async function launch(): Promise<LaunchedBrowser> {
  const userDataDir = mkdtempSync(join(tmpdir(), 'tabkeeper-e2e-'));
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: true,
    channel: 'chromium',
    args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`],
  });
  return { context, removeFiles: removeDirs(userDataDir) };
}

async function workerOf(context: BrowserContext): Promise<Worker> {
  return (
    context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'))
  );
}

async function extensionPage(context: BrowserContext, worker: Worker) {
  const page = await context.newPage();
  await page.goto(
    `chrome-extension://${new URL(worker.url()).host}/pinned.html`
  );
  return page;
}

const bounds = (w: chrome.windows.Window | undefined) => ({
  left: w?.left,
  top: w?.top,
  width: w?.width,
  height: w?.height,
  state: w?.state,
});

test('a reset leaves what a fresh profile has, in the same browser', async () => {
  const reused = new ReusedBrowser();
  try {
    const first = await reused.take('k', launch);
    const before = await workerOf(first);
    const [launchWindow] = await before.evaluate(() => chrome.windows.getAll());

    await before.evaluate(async () => {
      Object.assign(globalThis, { dirt: 1 });
      await chrome.storage.local.set({ dirt: 1 });
      await chrome.storage.sync.set({ dirt: 1 });
      await chrome.storage.session.set({ dirt: 1 });
      await chrome.windows.create({ url: 'about:blank#second-window' });
      const [win] = await chrome.windows.getAll();
      if (win?.id !== undefined) {
        // Headless Chromium's screen is 800x600: only a smaller window may move.
        await chrome.windows.update(win.id, {
          left: 60,
          top: 40,
          width: 700,
          height: 500,
        });
      }
    });
    const page = await extensionPage(first, before);
    expect(
      await page.evaluate(async () => {
        localStorage.setItem('dirt', '1');
        await new Promise((resolve) => {
          indexedDB.open('dirt').onsuccess = resolve;
        });
        return chrome.permissions.request({ permissions: ['sessions'] });
      })
    ).toBe(true);
    await first.addInitScript(() => Object.assign(window, { dirt: 1 }));
    await first.route(DIRT_URL, (route) => route.fulfill({ body: 'dirt' }));
    let pagesSeenByListener = 0;
    first.on('page', () => {
      pagesSeenByListener += 1;
    });
    await page.goto('about:blank#second-tab');

    await reused.giveBack(true);
    const second = await reused.take('k', launch);
    expect(second).toBe(first);
    const seenBefore = pagesSeenByListener;
    const after = await workerOf(second);
    expect(after).not.toBe(before);

    expect(
      await after.evaluate(async () => ({
        dirt: Reflect.get(globalThis, 'dirt'),
        local: await chrome.storage.local.get('dirt'),
        sync: await chrome.storage.sync.get(null),
        session: await chrome.storage.session.get(null),
        sessions: await chrome.permissions.contains({
          permissions: ['sessions'],
        }),
      }))
    ).toEqual({
      dirt: undefined,
      local: {},
      sync: {},
      session: {},
      sessions: false,
    });

    const windows = await after.evaluate(() =>
      chrome.windows.getAll({ populate: true })
    );
    expect(windows).toHaveLength(1);
    const [win] = windows;
    expect(win?.tabs?.map((t) => t.url)).toEqual(['about:blank']);
    expect(bounds(win)).toEqual(bounds(launchWindow));

    const next = await extensionPage(second, after);
    expect(
      await next.evaluate(async () => ({
        localStorage: localStorage.getItem('dirt'),
        indexedDB: (await indexedDB.databases()).some((d) => d.name === 'dirt'),
        initScript: Reflect.get(window, 'dirt'),
      }))
    ).toEqual({ localStorage: null, indexedDB: false, initScript: undefined });
    expect(
      await next.evaluate(
        (url) =>
          fetch(url).then(
            () => 'fulfilled',
            () => 'failed'
          ),
        DIRT_URL
      )
    ).toBe('failed');
    expect(pagesSeenByListener).toBe(seenBefore);
  } finally {
    await reused.close();
  }
});

test('a failed test gets its browser closed, and the next a new one', async () => {
  const reused = new ReusedBrowser();
  try {
    const first = await reused.take('k', launch);
    await reused.giveBack(false);
    expect(await reused.take('k', launch)).not.toBe(first);
  } finally {
    await reused.close();
  }
});

test('other launch options get another browser', async () => {
  const reused = new ReusedBrowser();
  try {
    const first = await reused.take('a', launch);
    await reused.giveBack(true);
    expect(await reused.take('b', launch)).not.toBe(first);
  } finally {
    await reused.close();
  }
});

test('a paused clock cannot be undone: the next test gets a new browser, with real timers', async () => {
  const reused = new ReusedBrowser();
  try {
    const first = await reused.take('k', launch);
    const page = await first.newPage();
    const later = Date.now() + 60_000;
    await page.clock.pauseAt(later);
    expect(await page.evaluate(() => Date.now())).toBeGreaterThanOrEqual(later);

    await reused.giveBack(true);
    const second = await reused.take('k', launch);
    expect(second).not.toBe(first);
    const fresh = await second.newPage();
    expect(
      await fresh.evaluate(
        () => new Promise((resolve) => setTimeout(() => resolve('fired'), 50))
      )
    ).toBe('fired');
  } finally {
    await reused.close();
  }
});

test('incognito access cannot be undone: the next test gets a new browser without it', async () => {
  const reused = new ReusedBrowser();
  try {
    const first = await reused.take('k', launch);
    const worker = await workerOf(first);
    const allowed = await allowInIncognito(first, new URL(worker.url()).host);
    expect(
      await allowed.evaluate(() => chrome.extension.isAllowedIncognitoAccess())
    ).toBe(true);

    await reused.giveBack(true);
    const second = await reused.take('k', launch);
    expect(second).not.toBe(first);
    expect(
      await (
        await workerOf(second)
      ).evaluate(() => chrome.extension.isAllowedIncognitoAccess())
    ).toBe(false);
  } finally {
    await reused.close();
  }
});
