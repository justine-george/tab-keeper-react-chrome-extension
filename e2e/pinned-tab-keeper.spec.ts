import { test as base, chromium } from '@playwright/test';
import type { BrowserContext, Locator, Page, Worker } from '@playwright/test';

import { spawn } from 'node:child_process';
import { appendFileSync, cpSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { test, expect } from './fixtures/extension';
import {
  buildContainer,
  buildSession,
  seedSessions,
  seedSettings,
} from './fixtures/seed';
import { FULL, FULL_VIEW_PATH, openPage, POPUP } from './fixtures/onboarding';
import { rgbToHex } from './fixtures/pixels';
import { DARKENHEIMER_THEME } from '../src/hooks/useThemeColors';

// KAN-459. The spec's "Through Save / Open / Switch" table, in the real browser.
const dataUrl = (title: string) => `data:text/html,<title>${title}</title>`;
const SESSION = buildSession({
  tabGroupId: 's1',
  title: 'Trip',
  windowCount: 2,
  tabCount: 2,
  windows: [
    {
      windowId: 'w1',
      windowHeight: 600,
      windowWidth: 800,
      windowOffsetTop: 0,
      windowOffsetLeft: 0,
      tabCount: 1,
      title: '',
      tabs: [{ tabId: 't1', favicon: '', title: 'One', url: dataUrl('One') }],
    },
    {
      windowId: 'w2',
      windowHeight: 600,
      windowWidth: 800,
      windowOffsetTop: 0,
      windowOffsetLeft: 0,
      tabCount: 1,
      title: '',
      tabs: [{ tabId: 't2', favicon: '', title: 'Two', url: dataUrl('Two') }],
    },
  ],
});

type TabFact = { id: number; url: string; pinned: boolean; active: boolean };
type Facts = { id: number; tabs: TabFact[] }[];
const windowsNow = (worker: Worker): Promise<Facts> =>
  worker.evaluate(async () =>
    (
      await chrome.windows.getAll({ populate: true, windowTypes: ['normal'] })
    ).map((w) => ({
      id: w.id ?? -1,
      tabs: (w.tabs ?? [])
        .slice()
        .sort((a, b) => a.index - b.index)
        .map((t) => ({
          id: t.id ?? -1,
          url: t.url || t.pendingUrl || '',
          pinned: t.pinned,
          active: t.active,
        })),
    }))
  );
const has = (facts: Facts, url: string) =>
  facts.filter((w) => w.tabs.some((t) => t.url.startsWith(url)));
const tabsOf = async (worker: Worker, windowId: number) =>
  (await windowsNow(worker)).find((w) => w.id === windowId)?.tabs ?? [];
const withoutIds = (tabs: TabFact[]) =>
  tabs.map(({ url, pinned, active }) => ({ url, pinned, active }));
const stubUrl = (extensionId: string) =>
  `chrome-extension://${extensionId}/pinned.html`;
const fullViewUrl = (extensionId: string) =>
  `chrome-extension://${extensionId}/${FULL_VIEW_PATH}`;
const isOwnPage = (extensionId: string, url: string) =>
  url.startsWith(`chrome-extension://${extensionId}/`);

// Playwright reports every page it attaches to as visible, so a stub born in the background
// becomes the full view at once (measured: 'visible' for an active:false stub). Here a stub
// reports hidden until a test shows it; real Chrome's hidden-then-shown is the no-CDP test below.
async function stubsStayHidden(context: BrowserContext) {
  await context.addInitScript(() => {
    if (!location.pathname.endsWith('/pinned.html')) return;
    const hidden = () => Reflect.get(window, '__shown') !== true;
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => (hidden() ? 'hidden' : 'visible'),
    });
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: hidden,
    });
  });
}

async function setup(context: BrowserContext, pin: boolean) {
  await stubsStayHidden(context);
  await seedSessions(context, buildContainer([SESSION]));
  await seedSettings(context, {
    pinTabKeeperInNewWindows: pin,
    theme: 'Darkenheimer',
  });
}

const sessionsRow = (page: Page): Locator =>
  page.locator('[data-pane="sessions"]');

async function pressSwitch(popup: Page) {
  await sessionsRow(popup)
    .getByRole('button', { name: 'Switch', exact: true })
    .click();
  await popup
    .locator('dialog[open][aria-labelledby="focus-confirm-title"]')
    .getByRole('button', { name: 'Switch', exact: true })
    .click();
}

async function addStub(
  worker: Worker,
  extensionId: string,
  windowId: number
): Promise<number> {
  const id = await worker.evaluate(
    async ({ windowId, url }) =>
      (
        await chrome.tabs.create({
          windowId,
          url,
          index: 0,
          pinned: true,
          active: false,
        })
      ).id,
    { windowId, url: stubUrl(extensionId) }
  );
  if (id === undefined) throw new Error('the stub has no tab id');
  return id;
}

async function tabOf(page: Page): Promise<{ tabId: number; windowId: number }> {
  const ids = await page.evaluate(async () => {
    const tab = await chrome.tabs.getCurrent();
    return tab?.id === undefined
      ? null
      : { tabId: tab.id, windowId: tab.windowId };
  });
  if (ids === null) throw new Error('the page has no tab id');
  return ids;
}

// Open now's pieces, as in open-now-close.spec.ts.
const OPEN_NOW = '[data-pane="open-now"]';
const windowBlock = (page: Page, windowId: number): Locator =>
  page.locator(`${OPEN_NOW} [data-open-window-id="${windowId}"]`);
const rowsIn = (block: Locator): Locator =>
  block.getByRole('button', { name: /^Switch to tab: / });
const reopenButton = (page: Page): Locator =>
  page.getByRole('status').getByRole('button', { name: 'Reopen', exact: true });
const allWindowIds = (worker: Worker): Promise<number[]> =>
  worker.evaluate(async () =>
    (await chrome.windows.getAll()).flatMap((w) =>
      w.id === undefined ? [] : [w.id]
    )
  );

async function openWindow(worker: Worker, urls: string[]): Promise<number> {
  const id = await worker.evaluate(
    async (urls) =>
      (await chrome.windows.create({ focused: false, url: urls }))?.id,
    urls
  );
  if (id === undefined) throw new Error('Chrome gave no window id');
  return id;
}

// Closes a window from Open now, presses the toast's Reopen, and returns the window that came back.
async function closeAndReopen(
  page: Page,
  worker: Worker,
  windowId: number,
  tabCount: number
): Promise<number> {
  const block = windowBlock(page, windowId);
  await expect(rowsIn(block)).toHaveCount(tabCount);
  await block
    .getByRole('button', { name: /^Close window: Window \d+$/ })
    .click();
  await expect
    .poll(async () => (await allWindowIds(worker)).includes(windowId))
    .toBe(false);
  await expect(page.getByRole('status')).toContainText(
    `Window closed (${tabCount} tabs)`
  );
  const before = await allWindowIds(worker);
  await reopenButton(page).click();
  const since = async () =>
    (await allWindowIds(worker)).filter((id) => !before.includes(id));
  await expect.poll(since).toHaveLength(1);
  const [reopened] = await since();
  return reopened;
}

test.describe('Open session', () => {
  for (const pin of [false, true]) {
    test(`${pin ? 'On' : 'Off'}: each new window ${
      pin ? 'starts with a pinned stub' : 'has no Tab Keeper tab'
    }`, async ({ context, extensionId, serviceWorker }) => {
      await setup(context, pin);
      const page = await openPage(context, extensionId, 'index.html', POPUP);
      const before = (await windowsNow(serviceWorker)).map((w) => w.id);
      await sessionsRow(page)
        .getByRole('button', { name: 'Open', exact: true })
        .click();
      const made = async () =>
        (await windowsNow(serviceWorker)).filter((w) => !before.includes(w.id));
      // Each window holds its session tab, so a stub, when made, was made first.
      await expect
        .poll(async () => (await made()).map((w) => w.tabs.length))
        .toEqual(pin ? [2, 2] : [1, 1]);
      for (const win of await made()) {
        if (pin) {
          expect(withoutIds(win.tabs)[0]).toEqual({
            url: stubUrl(extensionId),
            pinned: true,
            active: false,
          });
          expect(win.tabs[1]).toMatchObject({ pinned: false, active: true });
        } else {
          expect(win.tabs.some((t) => isOwnPage(extensionId, t.url))).toBe(
            false
          );
        }
      }
    });
  }
});

test.describe('Switch', () => {
  test('Off, a hand-pinned full view: it survives the switch, pinned at index 0 of the focused new window', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    await setup(context, false);
    const full = await openPage(context, extensionId, FULL_VIEW_PATH, FULL);
    await full.evaluate(async () => {
      const tab = await chrome.tabs.getCurrent();
      if (tab?.id !== undefined) {
        await chrome.tabs.update(tab.id, { pinned: true });
      }
      Object.assign(window, { __survivor: 'kan-459' });
    });
    const fullTab = await tabOf(full);
    const before = await windowsNow(serviceWorker);
    // PREMISE: the full view is the one Tab Keeper tab, pinned, in a window the switch closes.
    expect(has(before, fullViewUrl(extensionId))).toHaveLength(1);
    expect(
      before.flatMap((w) => w.tabs).find((t) => t.id === fullTab.tabId)
    ).toMatchObject({ pinned: true });
    // The full view hides the row's Switch (KAN-279); the popup page sends it.
    const popup = await openPage(context, extensionId, 'index.html', POPUP);
    await pressSwitch(popup);
    await expect
      .poll(async () =>
        (await windowsNow(serviceWorker)).every(
          (w) => !before.some((b) => b.id === w.id)
        )
      )
      .toBe(true);
    const after = await windowsNow(serviceWorker);
    expect(after).toHaveLength(2);
    const carriedIn = has(after, fullViewUrl(extensionId));
    expect(carriedIn).toHaveLength(1);
    expect(carriedIn[0].tabs[0]).toMatchObject({
      id: fullTab.tabId,
      url: fullViewUrl(extensionId),
      pinned: true,
    });
    // The same page, not a reload: the marker set before is still on its window.
    expect(await full.evaluate(() => Reflect.get(window, '__survivor'))).toBe(
      'kan-459'
    );
    expect(has(after, stubUrl(extensionId))).toHaveLength(0);
  });

  test('On, nothing pinned: every new window starts with a pinned stub, the old ones close', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    await setup(context, true);
    const popup = await openPage(context, extensionId, 'index.html', POPUP);
    const before = await windowsNow(serviceWorker);
    // PREMISE: nothing is pinned anywhere before the switch.
    expect(before.flatMap((w) => w.tabs).some((t) => t.pinned)).toBe(false);
    await pressSwitch(popup);
    await expect
      .poll(async () =>
        (await windowsNow(serviceWorker)).every(
          (w) => !before.some((b) => b.id === w.id)
        )
      )
      .toBe(true);
    await expect
      .poll(async () =>
        (await windowsNow(serviceWorker)).map((w) => w.tabs.length)
      )
      .toEqual([2, 2]);
    for (const win of await windowsNow(serviceWorker)) {
      expect(withoutIds(win.tabs)[0]).toEqual({
        url: stubUrl(extensionId),
        pinned: true,
        active: false,
      });
    }
  });
});

test.describe('Open now: Reopen a window', () => {
  for (const pin of [false, true]) {
    test(`${pin ? 'On' : 'Off'}: a window closed from Open now comes back ${
      pin ? 'with a pinned stub at index 0' : 'with no Tab Keeper tab'
    }`, async ({ context, extensionId, serviceWorker }) => {
      await stubsStayHidden(context);
      await seedSettings(context, { pinTabKeeperInNewWindows: pin });
      const page = await openPage(context, extensionId, FULL_VIEW_PATH, FULL);
      const windowId = await openWindow(serviceWorker, [
        dataUrl('Alpha'),
        dataUrl('Beta'),
      ]);
      // PREMISE: the window holds only its two tabs, no Tab Keeper tab.
      await expect
        .poll(async () => withoutIds(await tabsOf(serviceWorker, windowId)))
        .toEqual([
          { url: dataUrl('Alpha'), pinned: false, active: true },
          { url: dataUrl('Beta'), pinned: false, active: false },
        ]);

      const reopened = await closeAndReopen(page, serviceWorker, windowId, 2);

      const back = [
        { url: dataUrl('Alpha'), pinned: false, active: true },
        { url: dataUrl('Beta'), pinned: false, active: false },
      ];
      await expect
        .poll(async () => withoutIds(await tabsOf(serviceWorker, reopened)))
        .toEqual(
          pin
            ? [
                { url: stubUrl(extensionId), pinned: true, active: false },
                ...back,
              ]
            : back
        );
    });
  }

  test('On, with history (KAN-467): a window holding a pinned stub comes back with its tab history and one stub', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const site = await servePages(context);
    await stubsStayHidden(context);
    await seedSettings(context, { pinTabKeeperInNewWindows: true });
    await turnHistoryOn(context, extensionId);
    const page = await openPage(context, extensionId, FULL_VIEW_PATH, FULL);
    const windowId = await openWindow(serviceWorker, [
      dataUrl('Front'),
      site(1),
    ]);
    const historyTab = (await tabsOf(serviceWorker, windowId))[1].id;
    // p1 must finish first: a navigation that starts mid-load replaces its entry.
    await loadedAt(serviceWorker, historyTab, site(1));
    await navigate(serviceWorker, historyTab, site(2));
    await navigate(serviceWorker, historyTab, site(3));
    await addStub(serviceWorker, extensionId, windowId);

    // PREMISE: a pinned stub at index 0, Front in front, and three pages behind the History tab.
    await expect
      .poll(async () => withoutIds(await tabsOf(serviceWorker, windowId)))
      .toEqual([
        { url: stubUrl(extensionId), pinned: true, active: false },
        { url: dataUrl('Front'), pinned: false, active: true },
        { url: site(3), pinned: false, active: false },
      ]);
    await expect.poll(() => historyLengthsAt(context, site(3))).toEqual([3]);

    // Open now leaves the stub out, so it lists two tabs.
    const reopened = await closeAndReopen(page, serviceWorker, windowId, 2);

    await expect.poll(() => historyLengthsAt(context, site(3))).toEqual([3]);
    const [restored] = context.pages().filter((p) => p.url() === site(3));
    expect(await restored.goBack()).not.toBeNull();
    expect(restored.url()).toBe(site(2));
    await expect
      .poll(async () =>
        (await tabsOf(serviceWorker, reopened)).filter((t) =>
          isOwnPage(extensionId, t.url)
        )
      )
      .toHaveLength(1);
    expect(withoutIds(await tabsOf(serviceWorker, reopened))[0]).toEqual({
      url: stubUrl(extensionId),
      pinned: true,
      active: false,
    });
  });
});

test('⤢ with Tab Keeper tabs in two windows lands on the asking window’s stub', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  await stubsStayHidden(context);
  await seedSessions(context);
  const popup = await openPage(context, extensionId, 'index.html', POPUP);
  const { windowId: asking, tabId: popupTab } = await tabOf(popup);
  // A loaded full view in another window, made first so it is the first match.
  const other = await openWindow(serviceWorker, [fullViewUrl(extensionId)]);
  const stub = await addStub(serviceWorker, extensionId, asking);

  // PREMISE: a full view elsewhere, a pinned stub behind the popup here.
  await expect
    .poll(async () => withoutIds(await tabsOf(serviceWorker, other)))
    .toEqual([{ url: fullViewUrl(extensionId), pinned: false, active: true }]);
  const here = await tabsOf(serviceWorker, asking);
  expect(here.find((t) => t.id === stub)).toEqual({
    id: stub,
    url: stubUrl(extensionId),
    pinned: true,
    active: false,
  });
  expect(here.find((t) => t.active)?.id).toBe(popupTab);

  await popup
    .getByRole('button', { name: 'Open full view', exact: true })
    .click();

  await expect
    .poll(
      async () =>
        (await tabsOf(serviceWorker, asking)).find((t) => t.active)?.id
    )
    .toBe(stub);
  // Nothing new opened, and the other window's full view stayed where it was.
  const own = (await windowsNow(serviceWorker))
    .flatMap((w) => w.tabs)
    .filter((t) => isOwnPage(extensionId, t.url) && t.id !== popupTab);
  expect(own).toHaveLength(2);
  expect(withoutIds(await tabsOf(serviceWorker, other))).toEqual([
    { url: fullViewUrl(extensionId), pinned: false, active: true },
  ]);
});

test('the stub paints its theme’s ground while hidden, and becomes the full view when shown', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  await stubsStayHidden(context);
  await seedSettings(context, { theme: 'Darkenheimer' });
  const popup = await openPage(context, extensionId, 'index.html', POPUP);
  await addStub(serviceWorker, extensionId, (await tabOf(popup)).windowId);
  let found: Page | undefined;
  await expect
    .poll(() => {
      found = context.pages().find((p) => p.url().endsWith('/pinned.html'));
      return found !== undefined;
    })
    .toBe(true);
  if (found === undefined) throw new Error('no stub page');
  const stub = found;
  await stub.waitForLoadState('load');
  expect(await stub.title()).toBe('Tab Keeper');
  expect(
    rgbToHex(
      await stub.evaluate(() => getComputedStyle(document.body).backgroundColor)
    )
  ).toBe(DARKENHEIMER_THEME.PRIMARY_COLOR.toUpperCase());
  await stub.waitForTimeout(500);
  expect(stub.url()).toBe(stubUrl(extensionId));

  // Shown after the evaluate returns: the swap destroys its context.
  await stub.evaluate(() => {
    setTimeout(() => {
      Reflect.set(window, '__shown', true);
      document.dispatchEvent(new Event('visibilitychange'));
    });
  });
  await expect.poll(() => stub.url()).toBe(fullViewUrl(extensionId));
  await stub.locator('[aria-label="Sort sessions"]').first().waitFor();
});

// No CDP attached, so Chrome reports visibility as it does for a user. The worker of a copy of the
// built extension makes a stub in the background, reads it, activates it, and reads it again.
const DIST = fileURLToPath(new URL('../dist', import.meta.url));
const PROBE = `
chrome.runtime.onInstalled.addListener(async () => {
  const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
  const read = async (id) => {
    const tab = await chrome.tabs.get(id);
    const url = (tab.url || tab.pendingUrl || '').replace(chrome.runtime.getURL(''), '');
    return { url, pinned: tab.pinned, active: tab.active };
  };
  try {
    const win = await chrome.windows.create({ url: 'data:text/html,<title>Front</title>' });
    const stub = await chrome.tabs.create({
      windowId: win.id, url: chrome.runtime.getURL('pinned.html'), index: 0, pinned: true, active: false,
    });
    await sleep(2000);
    const background = await read(stub.id);
    await chrome.tabs.update(stub.id, { active: true });
    await sleep(2000);
    const shown = await read(stub.id);
    console.log('KAN459PROBE ' + JSON.stringify({ background, shown }) + ' KAN459END');
  } catch (error) {
    console.log('KAN459PROBE ' + JSON.stringify({ error: String(error) }) + ' KAN459END');
  }
});
`;

base(
  'no CDP: a stub made in the background stays a stub, and activating its tab makes it the full view',
  async () => {
    base.setTimeout(60_000);
    const copy = mkdtempSync(join(tmpdir(), 'tabkeeper-nocdp-'));
    const profile = mkdtempSync(join(tmpdir(), 'tabkeeper-nocdp-profile-'));
    cpSync(DIST, copy, { recursive: true });
    appendFileSync(join(copy, 'background.js'), PROBE);
    const browser = spawn(chromium.executablePath(), [
      '--headless=new',
      // As Playwright launches every other spec's browser (chromiumSandbox: false).
      '--no-sandbox',
      `--user-data-dir=${profile}`,
      `--disable-extensions-except=${copy}`,
      `--load-extension=${copy}`,
      '--enable-logging=stderr',
      '--no-first-run',
      '--no-default-browser-check',
      'about:blank',
    ]);
    // A browser that never started ends the wait with its error, not the timeout.
    const exited = new Promise((done) => {
      browser.on('exit', done);
      browser.on('error', done);
    });
    try {
      const line = await new Promise<string>((resolve, reject) => {
        let log = '';
        const timer = setTimeout(
          () => reject(new Error(`no probe line in 30s:\n${log.slice(-3000)}`)),
          30_000
        );
        browser.on('error', reject);
        browser.stderr.on('data', (chunk: Buffer) => {
          log += chunk.toString();
          const match = log.match(/KAN459PROBE (.*?) KAN459END/);
          if (match !== null) {
            clearTimeout(timer);
            resolve(match[1]);
          }
        });
      });
      const facts: unknown = JSON.parse(line);
      expect(facts).toEqual({
        background: { url: 'pinned.html', pinned: true, active: false },
        shown: { url: FULL_VIEW_PATH, pinned: true, active: true },
      });
    } finally {
      browser.kill();
      await exited;
      rmSync(copy, { recursive: true, force: true });
      rmSync(profile, { recursive: true, force: true, maxRetries: 3 });
    }
  }
);

// The history pieces, as in open-now-history.spec.ts: pages from a local server, since a data:
// URL cannot hold a history, and the switch that grants `sessions`.
type Site = (n: number) => string;

async function servePages(context: BrowserContext): Promise<Site> {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    const title = url.pathname.slice(1);
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end(`<!doctype html><title>${title}</title><p>${title}</p>`);
  });
  await new Promise<void>((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve())
  );
  context.on('close', () => {
    server.closeAllConnections();
    server.close();
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('the page server has no port');
  }
  return (n) => `http://127.0.0.1:${address.port}/p${n}`;
}

async function turnHistoryOn(context: BrowserContext, extensionId: string) {
  const page = await openPage(context, extensionId, 'index.html', POPUP);
  await page.locator('[aria-label="Settings"]').click();
  await page.locator('button[aria-label="Sessions"]').click();
  const row = page.getByRole('group', {
    name: 'Bring back tab history when reopening',
    exact: true,
  });
  await row.getByRole('button', { name: 'On', exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        chrome.permissions.contains({ permissions: ['sessions'] })
      )
    )
    .toBe(true);
  await page.close();
}

async function loadedAt(worker: Worker, tabId: number, url: string) {
  await expect
    .poll(() =>
      worker.evaluate(async (id: number) => {
        const tab = await chrome.tabs.get(id);
        return tab.status === 'complete' ? tab.url : null;
      }, tabId)
    )
    .toBe(url);
}

async function navigate(worker: Worker, tabId: number, url: string) {
  await worker.evaluate(
    async ({ tabId, url }) => {
      await chrome.tabs.update(tabId, { url });
    },
    { tabId, url }
  );
  await loadedAt(worker, tabId, url);
}

async function historyLengthsAt(
  context: BrowserContext,
  url: string
): Promise<number[]> {
  const lengths: number[] = [];
  for (const page of context.pages().filter((p) => p.url() === url)) {
    await page.waitForLoadState('load');
    lengths.push(await page.evaluate(() => history.length));
  }
  return lengths.sort((a, b) => a - b);
}
