import { test as base, chromium } from '@playwright/test';
import type { BrowserContext, Locator, Page, Worker } from '@playwright/test';

import { spawn } from 'node:child_process';
import { appendFileSync, cpSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { test, expect } from './fixtures/extension';
import { grantedTest } from './fixtures/grantedExtension';
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

// Chrome refuses to open this address from an extension, so its window fails.
const REFUSED = 'chrome://kill';
const sessionWindow = (n: number, title: string, url: string) => ({
  windowId: `w${n}`,
  windowHeight: 600,
  windowWidth: 800,
  windowOffsetTop: 0,
  windowOffsetLeft: 0,
  tabCount: 1,
  title: '',
  tabs: [{ tabId: `t${n}`, favicon: '', title, url }],
});
const FAILING = buildSession({
  tabGroupId: 's2',
  title: 'Half',
  windowCount: 3,
  tabCount: 3,
  windows: [
    sessionWindow(1, 'One', dataUrl('One')),
    sessionWindow(2, 'Two', dataUrl('Two')),
    sessionWindow(3, 'Refused', REFUSED),
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

// Playwright makes every page visible, so a stub reports hidden until shown; the no-CDP test is real Chrome.
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

const statusesIn = (worker: Worker, windowIds: number[]): Promise<string[]> =>
  worker.evaluate(
    async (ids) =>
      (await chrome.tabs.query({}))
        .filter((t) => ids.includes(t.windowId))
        .map((t) => t.status ?? ''),
    windowIds
  );

// Stubs come after their windows, so an absence is read once every tab loaded, the same twice.
async function settledTabs(
  worker: Worker,
  windowIds: number[]
): Promise<TabFact[][]> {
  await expect
    .poll(async () =>
      (await statusesIn(worker, windowIds)).every((s) => s === 'complete')
    )
    .toBe(true);
  const sample = () => Promise.all(windowIds.map((id) => tabsOf(worker, id)));
  const first = await sample();
  await new Promise((done) => setTimeout(done, 1000));
  expect(await sample()).toEqual(first);
  return first;
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
      if (!pin) {
        await expect.poll(async () => (await made()).length).toBe(2);
        const settled = await settledTabs(
          serviceWorker,
          (await made()).map((w) => w.id)
        );
        expect(
          settled
            .map((tabs) => withoutIds(tabs))
            .sort((a, b) => a[0].url.localeCompare(b[0].url))
        ).toEqual([
          [{ url: dataUrl('One'), pinned: false, active: true }],
          [{ url: dataUrl('Two'), pinned: false, active: true }],
        ]);
        return;
      }
      await expect
        .poll(async () => (await made()).map((w) => w.tabs.length))
        .toEqual([2, 2]);
      for (const win of await made()) {
        expect(withoutIds(win.tabs)[0]).toEqual({
          url: stubUrl(extensionId),
          pinned: true,
          active: false,
        });
        expect(win.tabs[1]).toMatchObject({ pinned: false, active: true });
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
    expect(carriedIn[0].tabs).toEqual([
      {
        id: fullTab.tabId,
        url: fullViewUrl(extensionId),
        pinned: true,
        active: false,
      },
      {
        id: expect.any(Number),
        url: dataUrl('One'),
        pinned: false,
        active: true,
      },
    ]);
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

  test('On, Tab Keeper pinned in two windows: the last-focused one is carried, the other closes, no window gets two', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    await setup(context, true);
    const popup = await openPage(context, extensionId, 'index.html', POPUP);
    const { windowId: home } = await tabOf(popup);
    const homeStub = await addStub(serviceWorker, extensionId, home);
    const other = await openWindow(serviceWorker, [dataUrl('Elsewhere')]);
    const otherStub = await addStub(serviceWorker, extensionId, other);
    await serviceWorker.evaluate(
      (id) => chrome.windows.update(id, { focused: true }),
      other
    );
    const before = await windowsNow(serviceWorker);
    // PREMISE: the other window is last focused and its stub listed second, so the carry follows focus, not order.
    expect(
      await serviceWorker.evaluate(
        async () => (await chrome.windows.getLastFocused()).id
      )
    ).toBe(other);
    expect(
      before
        .flatMap((w) => w.tabs)
        .filter((t) => t.pinned && isOwnPage(extensionId, t.url))
        .map((t) => t.id)
    ).toEqual([homeStub, otherStub]);

    await pressSwitch(popup);
    await expect
      .poll(async () =>
        (await windowsNow(serviceWorker)).every(
          (w) => !before.some((b) => b.id === w.id)
        )
      )
      .toBe(true);
    const made = await windowsNow(serviceWorker);
    expect(made).toHaveLength(2);
    const settled = await settledTabs(
      serviceWorker,
      made.map((w) => w.id)
    );
    const focused = settled.find((tabs) =>
      tabs.some((t) => t.url === dataUrl('One'))
    );
    const second = settled.find((tabs) =>
      tabs.some((t) => t.url === dataUrl('Two'))
    );
    expect(focused?.map((t) => [t.id, t.url, t.pinned, t.active])).toEqual([
      [otherStub, stubUrl(extensionId), true, false],
      [expect.any(Number), dataUrl('One'), false, true],
    ]);
    expect(second?.map((t) => t.url)).toEqual([
      stubUrl(extensionId),
      dataUrl('Two'),
    ]);
    expect(second?.[0]).toMatchObject({ pinned: true, active: false });
    expect([homeStub, otherStub]).not.toContain(second?.[0].id);
  });

  test('On, a window fails to open: nothing moves, nothing closes, and the stub made in a window that opened stays', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    await stubsStayHidden(context);
    await seedSessions(context, buildContainer([FAILING]));
    await seedSettings(context, { pinTabKeeperInNewWindows: true });
    const popup = await openPage(context, extensionId, 'index.html', POPUP);
    const { windowId: home } = await tabOf(popup);
    const homeStub = await addStub(serviceWorker, extensionId, home);
    // PREMISE: Chrome refuses the third window's address.
    expect(
      await serviceWorker.evaluate(
        (url) =>
          chrome.windows.create({ url, focused: false }).then(
            () => 'opened',
            (error: unknown) => String(error)
          ),
        REFUSED
      )
    ).not.toBe('opened');
    const before = await windowsNow(serviceWorker);

    await pressSwitch(popup);
    const made = async () =>
      (await windowsNow(serviceWorker)).filter(
        (w) => !before.some((b) => b.id === w.id)
      );
    await expect.poll(async () => (await made()).length).toBe(2);
    const madeIds = (await made()).map((w) => w.id);
    const [homeTabs, ...settled] = await settledTabs(serviceWorker, [
      home,
      ...madeIds,
    ]);
    // Nothing closed, and the pinned tab is still home's first tab.
    expect(await allWindowIds(serviceWorker)).toEqual(
      expect.arrayContaining(before.map((w) => w.id))
    );
    expect(homeTabs[0]).toEqual({
      id: homeStub,
      url: stubUrl(extensionId),
      pinned: true,
      active: false,
    });
    const second = settled.find((tabs) =>
      tabs.some((t) => t.url === dataUrl('Two'))
    );
    expect(second?.map((t) => [t.url, t.pinned])).toEqual([
      [stubUrl(extensionId), true],
      [dataUrl('Two'), false],
    ]);
    expect(settled.flat().map((t) => t.id)).not.toContain(homeStub);
  });

  test("Off, a hand-pinned full view into a session with a pinned tab: Tab Keeper stays first, before the session's pin (KAN-458)", async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    await stubsStayHidden(context);
    await seedSessions(
      context,
      buildContainer([
        buildSession({
          tabGroupId: 's3',
          title: 'Pins',
          windowCount: 1,
          tabCount: 2,
          windows: [
            {
              windowId: 'w1',
              windowHeight: 600,
              windowWidth: 800,
              windowOffsetTop: 0,
              windowOffsetLeft: 0,
              tabCount: 2,
              title: '',
              tabs: [
                {
                  tabId: 'tp',
                  favicon: '',
                  title: 'Pinned',
                  url: dataUrl('Pinned'),
                  pinned: true,
                },
                {
                  tabId: 'ts',
                  favicon: '',
                  title: 'Second',
                  url: dataUrl('Second'),
                },
              ],
            },
          ],
        }),
      ])
    );
    await seedSettings(context, {
      pinTabKeeperInNewWindows: false,
      theme: 'Darkenheimer',
    });
    const full = await openPage(context, extensionId, FULL_VIEW_PATH, FULL);
    await full.evaluate(async () => {
      const tab = await chrome.tabs.getCurrent();
      if (tab?.id !== undefined) {
        await chrome.tabs.update(tab.id, { pinned: true });
      }
    });
    const fullTab = await tabOf(full);
    const before = await windowsNow(serviceWorker);
    const popup = await openPage(context, extensionId, 'index.html', POPUP);
    await pressSwitch(popup);
    const made = async () =>
      (await windowsNow(serviceWorker)).filter(
        (w) => !before.some((b) => b.id === w.id)
      );
    await expect
      .poll(async () => (await windowsNow(serviceWorker)).length)
      .toBe(1);
    await expect.poll(async () => (await made())[0]?.tabs.length).toBe(3);
    const [tabs] = await settledTabs(serviceWorker, [(await made())[0].id]);
    // The session's pinned tab opens as a lazy placeholder: a base64 page titled after it.
    const placeholderOf = (url: string) =>
      url.startsWith('data:text/html;base64,')
        ? /<title>(.*?)<\/title>/.exec(
            Buffer.from(url.slice(22), 'base64').toString()
          )?.[1]
        : undefined;
    expect(
      tabs.map((t) => ({
        tab:
          t.id === fullTab.tabId
            ? 'full view'
            : (placeholderOf(t.url) ?? t.url),
        pinned: t.pinned,
        active: t.active,
      }))
    ).toEqual([
      { tab: 'full view', pinned: true, active: false },
      { tab: 'Pinned', pinned: true, active: false },
      { tab: dataUrl('Second'), pinned: false, active: true },
    ]);
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
      if (!pin) {
        await expect
          .poll(async () => (await tabsOf(serviceWorker, reopened)).length)
          .toBeGreaterThanOrEqual(2);
        const [settled] = await settledTabs(serviceWorker, [reopened]);
        expect(withoutIds(settled)).toEqual(back);
        return;
      }
      await expect
        .poll(async () => withoutIds(await tabsOf(serviceWorker, reopened)))
        .toEqual([
          { url: stubUrl(extensionId), pinned: true, active: false },
          ...back,
        ]);
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
    expect(
      (await tabsOf(serviceWorker, reopened)).find((t) => t.active)?.url
    ).toBe(dataUrl('Front'));
  });
});

// Chrome restores a window whose front tab was grouped with its first tab, here the stub, in front.
grantedTest(
  'On, with history and groups (KAN-469): the grouped front tab is in front again, its groups as they were',
  async ({ context, extensionId, serviceWorker }) => {
    const site = await servePages(context);
    await stubsStayHidden(context);
    await seedSettings(context, { pinTabKeeperInNewWindows: true });
    await turnHistoryOn(context, extensionId);
    const page = await openPage(context, extensionId, FULL_VIEW_PATH, FULL);
    const windowId = await openWindow(serviceWorker, [
      dataUrl('Front'),
      site(1),
      dataUrl('Next'),
    ]);
    const [front, historyTab, next] = await tabsOf(serviceWorker, windowId);
    await loadedAt(serviceWorker, historyTab.id, site(1));
    await navigate(serviceWorker, historyTab.id, site(2));
    await navigate(serviceWorker, historyTab.id, site(3));
    await serviceWorker.evaluate(
      async ({ windowId, front, next }) => {
        const trip = await chrome.tabs.group({
          tabIds: [front],
          createProperties: { windowId },
        });
        await chrome.tabGroups.update(trip, { title: 'Trip', color: 'blue' });
        const later = await chrome.tabs.group({
          tabIds: [next],
          createProperties: { windowId },
        });
        await chrome.tabGroups.update(later, { title: 'Later', color: 'red' });
        await chrome.tabs.update(front, { active: true });
      },
      { windowId, front: front.id, next: next.id }
    );
    await addStub(serviceWorker, extensionId, windowId);

    // PREMISE: a pinned stub at index 0, and Front, in Trip, in front.
    await expect
      .poll(async () => withoutIds(await tabsOf(serviceWorker, windowId)))
      .toEqual([
        { url: stubUrl(extensionId), pinned: true, active: false },
        { url: dataUrl('Front'), pinned: false, active: true },
        { url: site(3), pinned: false, active: false },
        { url: dataUrl('Next'), pinned: false, active: false },
      ]);
    await expect.poll(() => historyLengthsAt(context, site(3))).toEqual([3]);

    const reopened = await closeAndReopen(page, serviceWorker, windowId, 3);

    // PREMISE: it came back through Chrome's history, not a recreate.
    await expect.poll(() => historyLengthsAt(context, site(3))).toEqual([3]);
    await expect
      .poll(async () =>
        (await tabsOf(serviceWorker, reopened)).filter((t) =>
          isOwnPage(extensionId, t.url)
        )
      )
      .toHaveLength(1);
    expect(
      (await tabsOf(serviceWorker, reopened)).find((t) => t.active)?.url
    ).toBe(dataUrl('Front'));
    expect(await groupsIn(serviceWorker, reopened)).toEqual([
      {
        urls: [dataUrl('Front')],
        title: 'Trip',
        color: 'blue',
        collapsed: false,
      },
      {
        urls: [dataUrl('Next')],
        title: 'Later',
        color: 'red',
        collapsed: false,
      },
    ]);
  }
);

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

test('⤢ asking for the pin guide turns the asking window’s stub into the full view, with the guide open', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  await stubsStayHidden(context);
  await seedSessions(context);
  const popup = await openPage(context, extensionId, 'index.html', POPUP);
  const { windowId: asking } = await tabOf(popup);
  const other = await openWindow(serviceWorker, [fullViewUrl(extensionId)]);
  const stub = await addStub(serviceWorker, extensionId, asking);
  // PREMISE: a full view elsewhere, a pinned stub in the asking window.
  await expect
    .poll(async () => withoutIds(await tabsOf(serviceWorker, other)))
    .toEqual([{ url: fullViewUrl(extensionId), pinned: false, active: true }]);
  expect(
    (await tabsOf(serviceWorker, asking)).find((t) => t.id === stub)?.url
  ).toBe(stubUrl(extensionId));
  const ownBefore = (await windowsNow(serviceWorker))
    .flatMap((w) => w.tabs)
    .filter((t) => isOwnPage(extensionId, t.url)).length;

  // What requestTabView('pinGuide') sends from Help.
  await popup.evaluate(
    (windowId) =>
      chrome.runtime.sendMessage({
        type: 'openInTab',
        windowId,
        show: 'pinGuide',
      }),
    asking
  );

  await expect
    .poll(async () =>
      (await tabsOf(serviceWorker, asking)).find((t) => t.id === stub)
    )
    .toMatchObject({ pinned: true, active: true });
  await expect
    .poll(
      async () =>
        (await tabsOf(serviceWorker, asking))
          .find((t) => t.id === stub)
          ?.url.startsWith(fullViewUrl(extensionId)) ?? false
    )
    .toBe(true);
  let shown: Page | undefined;
  for (const page of context.pages()) {
    if (!page.url().startsWith(fullViewUrl(extensionId))) continue;
    if ((await tabOf(page)).tabId === stub) shown = page;
  }
  if (shown === undefined) throw new Error('no page in the stub’s tab');
  await expect(
    shown.getByRole('dialog', {
      name: 'Pin Tab Keeper to your toolbar',
      exact: true,
    })
  ).toBeVisible();
  // No second Tab Keeper tab, and the other window's full view stayed as it was.
  expect(
    (await windowsNow(serviceWorker))
      .flatMap((w) => w.tabs)
      .filter((t) => isOwnPage(extensionId, t.url))
  ).toHaveLength(ownBefore);
  expect(withoutIds(await tabsOf(serviceWorker, other))).toEqual([
    { url: fullViewUrl(extensionId), pinned: false, active: true },
  ]);
});

// pinned.js against the faked hidden state (stubsStayHidden); the no-CDP test below is the real-Chrome proof.
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

// No CDP, so visibility is real: a copy of the build's worker makes a background stub, reads, activates, reads.
const DIST = fileURLToPath(new URL('../dist', import.meta.url));
const PROBE = `
chrome.runtime.onInstalled.addListener(async () => {
  const read = async (id) => {
    const tab = await chrome.tabs.get(id);
    const url = (tab.url || tab.pendingUrl || '').replace(chrome.runtime.getURL(''), '');
    return { url, status: tab.status, pinned: tab.pinned, active: tab.active };
  };
  const until = async (id, done) => {
    for (let waited = 0; waited < 10000; waited += 100) {
      const tab = await read(id);
      if (done(tab)) return tab;
      await new Promise((next) => setTimeout(next, 100));
    }
    return read(id);
  };
  try {
    const win = await chrome.windows.create({ url: 'data:text/html,<title>Front</title>' });
    const stub = await chrome.tabs.create({
      windowId: win.id, url: chrome.runtime.getURL('pinned.html'), index: 0, pinned: true, active: false,
    });
    const background = await until(stub.id, (tab) => tab.status === 'complete');
    await chrome.tabs.update(stub.id, { active: true });
    const shown = await until(stub.id, (tab) => tab.url !== 'pinned.html' && tab.status === 'complete');
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
        background: {
          url: 'pinned.html',
          status: 'complete',
          pinned: true,
          active: false,
        },
        shown: {
          url: FULL_VIEW_PATH,
          status: 'complete',
          pinned: true,
          active: true,
        },
      });
    } finally {
      browser.kill();
      await exited;
      rmSync(copy, { recursive: true, force: true });
      rmSync(profile, { recursive: true, force: true, maxRetries: 3 });
    }
  }
);

// From open-now-history.spec.ts: a local page server (a data: URL holds no history) and the sessions switch.
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

// Each group in the window, with its tabs' addresses, in tab order.
const groupsIn = (worker: Worker, windowId: number) =>
  worker.evaluate(async (windowId: number) => {
    const tabs = (await chrome.tabs.query({ windowId })).sort(
      (a, b) => a.index - b.index
    );
    const groups = await chrome.tabGroups.query({ windowId });
    const firstAt = (id: number) => tabs.findIndex((t) => t.groupId === id);
    return groups
      .sort((a, b) => firstAt(a.id) - firstAt(b.id))
      .map((g) => ({
        urls: tabs.filter((t) => t.groupId === g.id).map((t) => t.url),
        title: g.title,
        color: g.color,
        collapsed: g.collapsed,
      }));
  }, windowId);

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
