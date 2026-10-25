import type { BrowserContext, Worker } from '@playwright/test';

import { expect, test } from './fixtures/extension';
import { allowInIncognito } from './fixtures/incognito';
import { REUSE_BROWSER } from './fixtures/reusedBrowser';

// KAN-766. Each pair runs in order on one worker: the first test leaves state
// behind, the second checks it is gone. On a fresh profile per test that holds
// trivially; under E2E_REUSE_BROWSER=1 it holds only if the reset works.
test.describe.configure({ mode: 'serial' });

const DIRT_URL = 'https://dirt.invalid/';

let dirtiedContext: BrowserContext | undefined;
let firstWindowBounds: chrome.windows.Window | undefined;
let pagesSeenByListener = 0;

async function extensionPage(context: BrowserContext, extensionId: string) {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/pinned.html`);
  return page;
}

async function windowsNow(worker: Worker) {
  return worker.evaluate(() => chrome.windows.getAll({ populate: true }));
}

test.describe('a reused browser', () => {
  test('a test leaves state everywhere a fresh profile has none', async ({
    context,
    serviceWorker,
    extensionId,
  }) => {
    dirtiedContext = context;
    [firstWindowBounds] = await windowsNow(serviceWorker);

    await serviceWorker.evaluate(async () => {
      Object.assign(globalThis, { dirt: 1 });
      await chrome.storage.local.set({ dirt: 1 });
      await chrome.storage.sync.set({ dirt: 1 });
      await chrome.storage.session.set({ dirt: 1 });
      await chrome.windows.create({ url: 'about:blank#second-window' });
      const [win] = await chrome.windows.getAll();
      if (win?.id !== undefined) {
        await chrome.windows.update(win.id, {
          left: 60,
          top: 40,
          width: 700,
          height: 500,
        });
      }
    });

    const page = await extensionPage(context, extensionId);
    expect(
      await page.evaluate(async () => {
        localStorage.setItem('dirt', '1');
        await new Promise((resolve) => {
          indexedDB.open('dirt').onsuccess = resolve;
        });
        return chrome.permissions.request({ permissions: ['sessions'] });
      })
    ).toBe(true);

    await context.addInitScript(() => Object.assign(window, { dirt: 1 }));
    await context.route(DIRT_URL, (route) => route.fulfill({ body: 'dirt' }));
    context.on('page', () => {
      pagesSeenByListener += 1;
    });
    await page.goto('about:blank#second-tab');
  });

  test('the next test finds a fresh profile', async ({
    context,
    serviceWorker,
    extensionId,
  }) => {
    if (REUSE_BROWSER) expect(context).toBe(dirtiedContext);
    const seenBefore = pagesSeenByListener;

    const worker = await serviceWorker.evaluate(async () => ({
      dirt: Reflect.get(globalThis, 'dirt'),
      local: await chrome.storage.local.get('dirt'),
      sync: await chrome.storage.sync.get(null),
      session: await chrome.storage.session.get(null),
      sessions: await chrome.permissions.contains({
        permissions: ['sessions'],
      }),
    }));
    expect(worker).toEqual({
      dirt: undefined,
      local: {},
      sync: {},
      session: {},
      sessions: false,
    });

    const windows = await windowsNow(serviceWorker);
    expect(windows).toHaveLength(1);
    const [win] = windows;
    expect(win?.tabs?.map((t) => t.url)).toEqual(['about:blank']);
    const bounds = (w: chrome.windows.Window | undefined) => ({
      left: w?.left,
      top: w?.top,
      width: w?.width,
      height: w?.height,
      state: w?.state,
    });
    expect(bounds(win)).toEqual(bounds(firstWindowBounds));

    const page = await extensionPage(context, extensionId);
    expect(
      await page.evaluate(async () => ({
        localStorage: localStorage.getItem('dirt'),
        indexedDB: (await indexedDB.databases()).some((d) => d.name === 'dirt'),
        initScript: Reflect.get(window, 'dirt'),
      }))
    ).toEqual({ localStorage: null, indexedDB: false, initScript: undefined });
    expect(
      await page.evaluate(
        (url) =>
          fetch(url).then(
            () => 'fulfilled',
            () => 'failed'
          ),
        DIRT_URL
      )
    ).toBe('failed');
    expect(pagesSeenByListener).toBe(seenBefore);
  });

  test('a test leaves state a reset cannot undo', async ({
    context,
    extensionId,
  }) => {
    dirtiedContext = context;
    const worker = await allowInIncognito(context, extensionId);
    expect(
      await worker.evaluate(() => chrome.extension.isAllowedIncognitoAccess())
    ).toBe(true);
  });

  test('the next test gets a new browser', async ({
    context,
    serviceWorker,
  }) => {
    expect(context).not.toBe(dirtiedContext);
    expect(
      await serviceWorker.evaluate(() =>
        chrome.extension.isAllowedIncognitoAccess()
      )
    ).toBe(false);
  });
});
