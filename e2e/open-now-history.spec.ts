import type {
  BrowserContext,
  ConsoleMessage,
  Locator,
  Page,
  Worker,
} from '@playwright/test';

import { createServer } from 'node:http';

import { test, expect } from './fixtures/extension';
import { grantedTest } from './fixtures/grantedExtension';

// KAN-280 Part D on the real artifact: "Bring back tab history when
// reopening". The switch is Chrome's optional `sessions` permission; with it
// held, Open now's Reopen brings a closed tab or window back through Chrome's
// recently closed list (in the service worker), so its Back and Forward pages
// come back, and then undoes everything else the restore changed, so the end
// state is today's recreate's. Without it, or when Chrome no longer has the
// entry, Reopen recreates, as before.
//
// What the unit tests cannot show, because they run against a fake: that
// Chrome really grants and revokes `sessions` from the switch, that the help
// line is the switch's description in Chrome's own accessibility tree, that a
// restored tab really has its history, and the rules the fake only MODELS
// (tests 7b and 9 to 15 measure them and print the numbers).
//
// Pages come from a local http server, one per test (servePages). Not a
// data: URL, which cannot hold a history: Chrome takes a tabs.update from one
// data: URL to another as pending and never commits it (open-now.spec.ts test
// 2). And not context.route, which the other Open now specs use: measured
// 2026-09-27, a background tab the extension creates (chrome.tabs.create,
// active: false, which is how recreate reopens) sends its request before
// Playwright's interception is set up for it, goes to the real network, and
// lands on chrome-error://chromewebdata/.

const TAB_VIEWPORT = { width: 1280, height: 800 };
const POPUP_VIEWPORT = { width: 790, height: 550 };
const VIEW_TAB = 'index.html?view=tab';
const POPUP = 'index.html';
const OPEN_NOW = '[data-pane="open-now"]';

const HISTORY_ROW = 'Bring back tab history when reopening';
const HISTORY_HELP =
  'Reopening a closed tab or window from Open now also brings back its Back and Forward pages, except for grouped tabs in a reopened window. It uses Chrome’s list of recently closed tabs.';
const REOPEN_FAILED = "Couldn't reopen.";

// The address of page n of a test's pages under `key`: /pN?k=KEY on the
// test's own server, titled "pN KEY".
type Site = (key: string, n: number) => string;
const pageTitle = (key: string, n: number): string => `p${n} ${key}`;
const dataUrl = (title: string): string =>
  `data:text/html,<title>${title}</title>`;

// Starts this test's page server on a free port of 127.0.0.1, closed with
// the context. Every path answers a page titled by its path and key.
async function servePages(context: BrowserContext): Promise<Site> {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    const title = `${url.pathname.slice(1)} ${url.searchParams.get('k') ?? ''}`;
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
  const origin = `http://127.0.0.1:${address.port}`;
  return (key, n) => `${origin}/p${n}?k=${key}`;
}

async function openPage(
  context: BrowserContext,
  extensionId: string,
  path: string,
  viewport: { width: number; height: number }
): Promise<Page> {
  const page = await context.newPage();
  await page.setViewportSize(viewport);
  await page.goto(`chrome-extension://${extensionId}/${path}`);
  // Barrier: goto resolves before React mounts. "Sort sessions" is in the
  // header of both the popup and the tab view.
  await page
    .getByRole('button', { name: 'Sort sessions', exact: true })
    .waitFor();
  return page;
}

// Settings › Sessions, and the history switch in it.
async function openHistoryRow(page: Page): Promise<Locator> {
  await page.locator('[aria-label="Settings"]').click();
  await page.locator('button[aria-label="Sessions"]').click();
  const row = page.getByRole('group', { name: HISTORY_ROW, exact: true });
  await expect(row).toBeVisible();
  return row;
}

// Which side of the switch is pressed, by its buttons' aria-pressed.
async function expectPressed(row: Locator, side: 'On' | 'Off') {
  const other = side === 'On' ? 'Off' : 'On';
  await expect(
    row.getByRole('button', { name: side, exact: true })
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(
    row.getByRole('button', { name: other, exact: true })
  ).toHaveAttribute('aria-pressed', 'false');
}

const holdsSessions = (page: Page): Promise<boolean> =>
  page.evaluate(() =>
    chrome.permissions.contains({ permissions: ['sessions'] })
  );

// Turns the switch On from a page of its own, then closes that page, so the
// tab view opened after it is the front tab of its window again. Returns
// once Chrome holds the grant.
async function turnHistoryOn(
  context: BrowserContext,
  extensionId: string
): Promise<void> {
  const page = await openPage(context, extensionId, POPUP, POPUP_VIEWPORT);
  const row = await openHistoryRow(page);
  await row.getByRole('button', { name: 'On', exact: true }).click();
  await expectPressed(row, 'On');
  await expect.poll(() => holdsSessions(page)).toBe(true);
  await page.close();
}

// Time for a raw Chrome call to settle before it is read.
const settle = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

// One Chrome window's block in the Open now pane.
const windowBlock = (page: Page, windowId: number): Locator =>
  page.locator(`${OPEN_NOW} [data-open-window-id="${windowId}"]`);

const liveRowIn = (block: Locator, title: string): Locator =>
  block.getByRole('button', { name: `Switch to tab: ${title}`, exact: true });

const closeTabIn = (block: Locator, title: string): Locator =>
  block.getByRole('button', { name: `Close tab: ${title}`, exact: true });

const reopenButton = (page: Page): Locator =>
  page.getByRole('status').getByRole('button', { name: 'Reopen', exact: true });

// The tab view's own tab and window, as Chrome knows them.
async function tabViewIds(
  page: Page
): Promise<{ tabId: number; windowId: number }> {
  const ids = await page.evaluate(async () => {
    const tab = await chrome.tabs.getCurrent();
    return tab?.id === undefined
      ? null
      : { tabId: tab.id, windowId: tab.windowId };
  });
  if (ids === null) throw new Error('the tab view has no tab id');
  return ids;
}

// The last-focused window and its active tab: what the user is looking at.
const inFront = (
  worker: Worker
): Promise<{ windowId: number | undefined; activeTabId: number | undefined }> =>
  worker.evaluate(async () => {
    const win = await chrome.windows.getLastFocused({ populate: true });
    return {
      windowId: win.id,
      activeTabId: win.tabs?.find((tab) => tab.active)?.id,
    };
  });

const allWindowIds = (worker: Worker): Promise<number[]> =>
  worker.evaluate(async () =>
    (await chrome.windows.getAll()).flatMap((w) =>
      w.id === undefined ? [] : [w.id]
    )
  );

// Chrome's facts about every tab at `url`, in any window.
interface TabAt {
  id: number;
  windowId: number;
  index: number;
  active: boolean;
  groupId: number;
}
const tabsAt = (worker: Worker, url: string): Promise<TabAt[]> =>
  worker.evaluate(
    async (wanted: string) =>
      (await chrome.tabs.query({})).flatMap((tab) =>
        tab.id !== undefined && (tab.url || tab.pendingUrl) === wanted
          ? [
              {
                id: tab.id,
                windowId: tab.windowId,
                index: tab.index,
                active: tab.active,
                groupId: tab.groupId,
              },
            ]
          : []
      ),
    url
  );

const windowState = (worker: Worker, windowId: number): Promise<string> =>
  worker.evaluate(
    async (id: number) => (await chrome.windows.get(id)).state ?? '',
    windowId
  );

const activeTabOf = (
  worker: Worker,
  windowId: number
): Promise<number | undefined> =>
  worker.evaluate(
    async (id: number) =>
      (await chrome.tabs.query({ windowId: id, active: true }))[0]?.id,
    windowId
  );

// The Playwright page showing `url`, once Playwright has attached to it.
async function pagesAt(context: BrowserContext, url: string): Promise<Page[]> {
  return context.pages().filter((page) => page.url() === url);
}

// Each page at `url`: its history.length. Sorted, so two copies read the
// same whichever Playwright lists first.
async function historyLengthsAt(
  context: BrowserContext,
  url: string
): Promise<number[]> {
  const lengths: number[] = [];
  for (const page of await pagesAt(context, url)) {
    await page.waitForLoadState('load');
    lengths.push(await page.evaluate(() => history.length));
  }
  return lengths.sort((a, b) => a - b);
}

// Navigates a tab to `url` through Chrome, as a user's address bar would, and
// waits for Chrome to report it loaded there.
async function navigate(
  worker: Worker,
  tabId: number,
  url: string
): Promise<void> {
  await worker.evaluate(
    async ({ tabId, url }) => {
      await chrome.tabs.update(tabId, { url });
    },
    { tabId, url }
  );
  await expect
    .poll(() =>
      worker.evaluate(async (id: number) => {
        const tab = await chrome.tabs.get(id);
        return tab.status === 'complete' ? tab.url : null;
      }, tabId)
    )
    .toBe(url);
}

interface HistoryWindow {
  windowId: number;
  // Front, History, Next: Front is the window's front tab.
  frontId: number;
  historyId: number;
  nextId: number;
  // The History tab's last page, and its title.
  url: string;
  title: string;
}

// A window the browser opens unfocused, so the tab view stays in front:
// [Front, History, Next], Front in front. History went p1 → p2 → p3, so its
// history.length is 3 (checked). `group` puts History and Next in a group,
// so a closed History leaves its group behind.
async function openHistoryWindow(
  context: BrowserContext,
  worker: Worker,
  site: Site,
  key: string,
  group: 'none' | 'titled' | 'untitled'
): Promise<HistoryWindow & { groupId: number }> {
  const made = await worker.evaluate(
    async ({ urls }) => {
      const win = await chrome.windows.create({ focused: false, url: urls });
      const ids = (win?.tabs ?? []).flatMap((tab) =>
        tab.id === undefined ? [] : [tab.id]
      );
      if (win?.id === undefined || ids.length !== urls.length) return null;
      return { windowId: win.id, ids };
    },
    { urls: [dataUrl('Front'), site(key, 1), dataUrl('Next')] }
  );
  if (made === null) throw new Error('Chrome gave no window or tab ids');
  const [frontId, historyId, nextId] = made.ids;
  await navigate(worker, historyId, site(key, 2));
  await navigate(worker, historyId, site(key, 3));

  let groupId = -1;
  const grouped: [number, number] = [historyId, nextId];
  if (group !== 'none') {
    groupId = await worker.evaluate(
      async ({ windowId, tabIds, titled }) => {
        const id = await chrome.tabs.group({
          tabIds,
          createProperties: { windowId },
        });
        if (titled) {
          await chrome.tabGroups.update(id, { title: 'Trip', color: 'blue' });
        }
        return id;
      },
      {
        windowId: made.windowId,
        tabIds: grouped,
        titled: group === 'titled',
      }
    );
  }
  // Front back in front: a navigation does not activate, but be sure.
  await worker.evaluate(
    (id: number) => chrome.tabs.update(id, { active: true }),
    frontId
  );

  const url = site(key, 3);
  // PREMISE: the tab has three pages behind it before it closes.
  await expect.poll(() => historyLengthsAt(context, url)).toEqual([3]);
  return {
    windowId: made.windowId,
    frontId,
    historyId,
    nextId,
    url,
    title: pageTitle(key, 3),
    groupId,
  };
}

// Closes the History tab from Open now, once the pane lists it at its last
// page, and waits for Chrome to have closed it and the offer to show.
async function closeHistoryTab(
  page: Page,
  worker: Worker,
  made: HistoryWindow,
  inGroup?: string
): Promise<void> {
  const block = windowBlock(page, made.windowId);
  // Read barrier: the pane has read the tab at its last page, so the close
  // snapshot holds that address -- and, where named, in its group, which
  // formed after the pane first listed it.
  const row = inGroup
    ? block.getByRole('group', { name: inGroup }).getByRole('button', {
        name: `Switch to tab: ${made.title}`,
        exact: true,
      })
    : liveRowIn(block, made.title);
  await expect(row).toBeVisible();
  await closeTabIn(block, made.title).click();
  await expect
    .poll(async () => (await tabsAt(worker, made.url)).length)
    .toBe(0);
  await expect(page.getByRole('status')).toContainText('Tab closed');
}

// The ways this spec presses Reopen: the toast's button, or the key.
type Press = 'button' | 'key';

async function pressReopen(
  page: Page,
  worker: Worker,
  press: Press
): Promise<void> {
  await expect(reopenButton(page)).toBeVisible();
  if (press === 'button') {
    await reopenButton(page).click();
    return;
  }
  const os = await worker.evaluate(
    async () => (await chrome.runtime.getPlatformInfo()).os
  );
  await page.keyboard.press(`${os === 'mac' ? 'Meta' : 'Control'}+z`);
}

// Exactly `count` tabs at `url`, held for a second, so a second copy that
// arrives late is seen.
async function expectCopies(
  worker: Worker,
  url: string,
  count: number
): Promise<TabAt[]> {
  await expect.poll(async () => (await tabsAt(worker, url)).length).toBe(count);
  for (let sample = 0; sample < 10; sample += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(await tabsAt(worker, url)).toHaveLength(count);
  }
  return tabsAt(worker, url);
}

// Records the service worker's console warnings and errors from now on.
function recordWorkerWarnings(worker: Worker): string[] {
  const seen: string[] = [];
  worker.on('console', (message: ConsoleMessage) => {
    if (message.type() === 'warning' || message.type() === 'error') {
      seen.push(message.text());
    }
  });
  return seen;
}

// Headless Chromium cannot show a window getting the focus BACK. Measured
// 2026-09-27 (test 15): once windows.update({ focused: true }) has focused a
// window, getLastFocused keeps naming it, and it keeps reporting focused,
// after the same call focuses another window -- both then report focused.
// So after a restore has focused the History tab's window, whether the undo
// gave the focus back cannot be read from Chrome here (a headed probe did,
// 12/12, KAN-280 Part D pre-flight). What can be read is that the undo ASKED
// for it: every windows.update that focuses a window, recorded in the
// worker, in the real bundle. It wraps the worker's chrome.windows.update for
// the rest of the test; every call still goes to Chrome unchanged.
async function recordFocusRequests(worker: Worker): Promise<void> {
  await worker.evaluate(() => {
    const requested: number[] = [];
    Reflect.set(globalThis, 'focusRequests', requested);
    const update = chrome.windows.update.bind(chrome.windows);
    Reflect.set(
      chrome.windows,
      'update',
      (windowId: number, info: chrome.windows.UpdateInfo) => {
        if (info.focused === true) requested.push(windowId);
        return update(windowId, info);
      }
    );
  });
}

const lastFocusRequest = async (worker: Worker): Promise<number | null> => {
  const requested = await focusRequests(worker);
  return requested.length === 0 ? null : requested[requested.length - 1];
};

const focusRequests = async (worker: Worker): Promise<number[]> => {
  const requested: unknown = await worker.evaluate(() =>
    Reflect.get(globalThis, 'focusRequests')
  );
  return Array.isArray(requested)
    ? requested.filter((id): id is number => typeof id === 'number')
    : [];
};

test.describe('the switch, in the popup and the tab view (KAN-280 Part D)', () => {
  for (const { name, path, viewport } of [
    { name: 'the popup', path: POPUP, viewport: POPUP_VIEWPORT },
    { name: 'the tab view', path: VIEW_TAB, viewport: TAB_VIEWPORT },
  ]) {
    test(`1. ${name}: Settings › Sessions has the switch, Off in a fresh profile`, async ({
      context,
      extensionId,
    }) => {
      const page = await openPage(context, extensionId, path, viewport);
      const row = await openHistoryRow(page);
      await expectPressed(row, 'Off');
      // Off is the truth, not a default drawn over a grant.
      expect(await holdsSessions(page)).toBe(false);
      // Under Save Tab Groups, the pane's other switch.
      const saveGroups = page.getByRole('group', { name: 'Save Tab Groups' });
      const above = await saveGroups.boundingBox();
      const below = await row.boundingBox();
      if (above === null || below === null) {
        throw new Error('a switch has no box');
      }
      expect(below.y).toBeGreaterThan(above.y);
    });
  }

  test('2. On grants sessions with no prompt, and Off gives it back', async ({
    context,
    extensionId,
  }) => {
    const page = await openPage(context, extensionId, VIEW_TAB, TAB_VIEWPORT);
    const row = await openHistoryRow(page);
    // PREMISE: nothing is held yet.
    expect(await holdsSessions(page)).toBe(false);

    await row.getByRole('button', { name: 'On', exact: true }).click();
    // Nothing answered a prompt: had Chrome shown one, the request would
    // wait on it and the grant would never land (the control below).
    await expect.poll(() => holdsSessions(page)).toBe(true);
    await expectPressed(row, 'On');
    // Usable at once, in this page, with no reload (Task 1, Q4).
    expect(
      await page.evaluate(async () =>
        Array.isArray(await chrome.sessions.getRecentlyClosed())
      )
    ).toBe(true);

    await row.getByRole('button', { name: 'Off', exact: true }).click();
    await expect.poll(() => holdsSessions(page)).toBe(false);
    await expectPressed(row, 'Off');

    // CONTROL: Save Tab Groups asks for tabGroups, which Chrome DOES prompt
    // for. Here nothing answers it, and the grant never lands -- so the
    // sessions grant above landing is what "no prompt" looks like.
    await page
      .getByRole('group', { name: 'Save Tab Groups' })
      .getByRole('button', { name: 'On', exact: true })
      .click();
    await settle(2000);
    expect(
      await page.evaluate(() =>
        chrome.permissions.contains({ permissions: ['tabGroups'] })
      )
    ).toBe(false);
  });

  test('3. the help line is the switch’s description in the accessibility tree', async ({
    context,
    extensionId,
  }) => {
    const page = await openPage(context, extensionId, VIEW_TAB, TAB_VIEWPORT);
    const row = await openHistoryRow(page);
    await expect(row).toHaveAccessibleDescription(HISTORY_HELP);

    // And in Chrome's own tree, not only Playwright's computation.
    const cdp = await context.newCDPSession(page);
    const { nodes } = await cdp.send('Accessibility.getFullAXTree');
    const describedBy = (name: string) =>
      nodes
        .filter(
          (node) =>
            !node.ignored &&
            node.role?.value === 'group' &&
            node.name?.value === name
        )
        .map((node) => String(node.description?.value ?? ''));
    expect(describedBy(HISTORY_ROW)).toEqual([HISTORY_HELP]);
    // CONTROL: the same read of the other switch, which has no help line,
    // finds it with no description, so the read above can tell the two
    // apart.
    expect(describedBy('Save Tab Groups')).toEqual(['']);
  });
});

grantedTest.describe('Reopen with history (KAN-280 Part D)', () => {
  // Case 4 (with the toast's button, then with the key) and its control,
  // case 5. The window is [Front, History, Next], History and Next in the
  // group Trip, Front in front; History is closed from Open now.
  const runs: { name: string; history: boolean; press: Press }[] = [
    {
      name: '4. On: a tab closed from Open now and reopened with the toast’s Reopen comes back with its history, in its place, in its group, behind, and the undo gives the focus back',
      history: true,
      press: 'button',
    },
    {
      name: '4b. On: the same, reopened with ⌘Z / Ctrl+Z',
      history: true,
      press: 'key',
    },
    {
      name: '5. CONTROL, Off: the same steps recreate it, with no history',
      history: false,
      press: 'button',
    },
  ];
  for (const { name, history, press } of runs) {
    grantedTest(name, async ({ context, extensionId, serviceWorker }) => {
      const site = await servePages(context);
      if (history) await turnHistoryOn(context, extensionId);
      const page = await openPage(context, extensionId, VIEW_TAB, TAB_VIEWPORT);
      const tabView = await tabViewIds(page);
      const warnings = recordWorkerWarnings(serviceWorker);
      const made = await openHistoryWindow(
        context,
        serviceWorker,
        site,
        'four',
        'titled'
      );
      // PREMISE: History is at index 1, in Trip, behind Front; the tab view
      // is in front.
      expect(await tabsAt(serviceWorker, made.url)).toEqual([
        {
          id: made.historyId,
          windowId: made.windowId,
          index: 1,
          active: false,
          groupId: made.groupId,
        },
      ]);
      expect(await inFront(serviceWorker)).toEqual({
        windowId: tabView.windowId,
        activeTabId: tabView.tabId,
      });

      await recordFocusRequests(serviceWorker);
      await closeHistoryTab(page, serviceWorker, made, 'Trip');
      await pressReopen(page, serviceWorker, press);

      // One copy, where it was: index 1 of its window, in Trip, behind.
      const [back] = await expectCopies(serviceWorker, made.url, 1);
      expect(back).toMatchObject({
        windowId: made.windowId,
        index: 1,
        active: false,
        groupId: made.groupId,
      });
      expect(await activeTabOf(serviceWorker, made.windowId)).toBe(
        made.frontId
      );
      // Trip is still Trip, and open.
      expect(
        await serviceWorker.evaluate(async (id: number) => {
          const g = await chrome.tabGroups.get(id);
          return { title: g.title, collapsed: g.collapsed };
        }, made.groupId)
      ).toEqual({ title: 'Trip', collapsed: false });
      // The tab view is still its window's front tab.
      expect(await activeTabOf(serviceWorker, tabView.windowId)).toBe(
        tabView.tabId
      );
      if (history) {
        // The restore focused History's window; the undo then asked for the
        // tab view's back, last (see recordFocusRequests: headless cannot
        // show the focus returning).
        expect(await lastFocusRequest(serviceWorker)).toBe(tabView.windowId);
        console.log(
          `[${press}] getLastFocused after: ${JSON.stringify(
            await inFront(serviceWorker)
          )}, History's window ${made.windowId}`
        );
      } else {
        // CONTROL: recreate never moves the focus at all, so here headless
        // can show it stayed.
        expect(await focusRequests(serviceWorker)).toEqual([]);
        expect(await inFront(serviceWorker)).toEqual({
          windowId: tabView.windowId,
          activeTabId: tabView.tabId,
        });
      }

      // The history: three pages with the switch On, one without.
      await expect
        .poll(() => historyLengthsAt(context, made.url))
        .toEqual([history ? 3 : 1]);
      const [reopened] = await pagesAt(context, made.url);
      const backTo = await reopened.goBack();
      if (history) {
        expect(backTo).not.toBeNull();
        expect(reopened.url()).toBe(site('four', 2));
      } else {
        // Nowhere to go back to.
        expect(backTo).toBeNull();
        expect(reopened.url()).toBe(made.url);
      }

      await expect(page.getByRole('status')).not.toContainText(REOPEN_FAILED);
      expect(warnings).toEqual([]);
    });
  }

  grantedTest(
    '6. worst path: Chrome’s own restore (Ctrl+Shift+T) takes the entry first, and Reopen recreates exactly one copy, with no history and no error',
    async ({ context, extensionId, serviceWorker }) => {
      const site = await servePages(context);
      await turnHistoryOn(context, extensionId);
      const page = await openPage(context, extensionId, VIEW_TAB, TAB_VIEWPORT);
      const made = await openHistoryWindow(
        context,
        serviceWorker,
        site,
        'six',
        'none'
      );
      await closeHistoryTab(page, serviceWorker, made);

      // Ctrl+Shift+T's equivalent: restore the newest entry, no id.
      await serviceWorker.evaluate(async () => {
        await chrome.sessions.restore();
      });
      // PREMISE: that took the entry, and brought the tab back with its
      // history.
      await expectCopies(serviceWorker, made.url, 1);
      await expect.poll(() => historyLengthsAt(context, made.url)).toEqual([3]);

      await pressReopen(page, serviceWorker, 'button');
      // Exactly one more copy, the recreate's: a new history.
      await expectCopies(serviceWorker, made.url, 2);
      await expect
        .poll(() => historyLengthsAt(context, made.url))
        .toEqual([1, 3]);
      await expect(page.getByRole('status')).not.toContainText(REOPEN_FAILED);
    }
  );

  grantedTest(
    '7. On: a window closed from Open now comes back with its tabs and their history, and the undo gives the focus back',
    async ({ context, extensionId, serviceWorker }) => {
      const site = await servePages(context);
      await turnHistoryOn(context, extensionId);
      const page = await openPage(context, extensionId, VIEW_TAB, TAB_VIEWPORT);
      const tabView = await tabViewIds(page);
      // History ungrouped: a window restore brings a GROUPED tab back without
      // its history (test 7b), which is Chrome's, not this code's.
      const made = await openHistoryWindow(
        context,
        serviceWorker,
        site,
        'seven',
        'none'
      );
      const block = windowBlock(page, made.windowId);
      await expect(liveRowIn(block, made.title)).toBeVisible();
      await expect(
        block.getByRole('button', { name: /^Switch to tab: / })
      ).toHaveCount(3);
      await recordFocusRequests(serviceWorker);

      await block
        .getByRole('button', { name: /^Close window: Window \d+$/ })
        .click();
      await expect
        .poll(async () =>
          (await allWindowIds(serviceWorker)).includes(made.windowId)
        )
        .toBe(false);
      await expect(page.getByRole('status')).toContainText(
        'Window closed (3 tabs)'
      );

      const before = await allWindowIds(serviceWorker);
      const since = async () =>
        (await allWindowIds(serviceWorker)).filter(
          (id) => !before.includes(id)
        );
      await pressReopen(page, serviceWorker, 'button');
      await expect.poll(since).toHaveLength(1);
      const [reopenedId] = await since();

      // Its tabs, in order, Front in front.
      await expect
        .poll(() =>
          serviceWorker.evaluate(
            async (id: number) =>
              (await chrome.tabs.query({ windowId: id })).map(
                (tab) => `${tab.title}${tab.active ? '*' : ''}`
              ),
            reopenedId
          )
        )
        .toEqual(['Front*', made.title, 'Next']);
      await expect.poll(() => historyLengthsAt(context, made.url)).toEqual([3]);
      // The restore focused the new window; the undo then asked for the tab
      // view's back, last (headless cannot show it returning:
      // recordFocusRequests).
      expect(await lastFocusRequest(serviceWorker)).toBe(tabView.windowId);
      expect(await activeTabOf(serviceWorker, tabView.windowId)).toBe(
        tabView.tabId
      );
      // One window came back, not one per attempt.
      await page.waitForTimeout(1000);
      expect(await since()).toHaveLength(1);
      console.log(
        `[7] after: getLastFocused ${JSON.stringify(
          await inFront(serviceWorker)
        )}, reopened ${reopenedId} reports focused ${await serviceWorker.evaluate(
          async (id: number) => (await chrome.windows.get(id)).focused,
          reopenedId
        )}`
      );
    }
  );

  grantedTest(
    '7b. measured, raw: a window restore brings an ungrouped tab back with its history, and a grouped one without',
    async ({ context, extensionId, serviceWorker }) => {
      const site = await servePages(context);
      await turnHistoryOn(context, extensionId);
      await openPage(context, extensionId, VIEW_TAB, TAB_VIEWPORT);
      const made = await serviceWorker.evaluate(
        async ({ urls }) => {
          const win = await chrome.windows.create({
            focused: false,
            url: urls,
          });
          const ids = (win?.tabs ?? []).flatMap((tab) =>
            tab.id === undefined ? [] : [tab.id]
          );
          if (win?.id === undefined || ids.length !== urls.length) return null;
          return { windowId: win.id, ids };
        },
        {
          urls: [
            dataUrl('Front'),
            site('loose', 1),
            site('grouped', 1),
            dataUrl('Next'),
          ],
        }
      );
      if (made === null) throw new Error('Chrome gave no window or tab ids');
      const [, loose, grouped, next] = made.ids;
      const histories: [number, string][] = [
        [loose, 'loose'],
        [grouped, 'grouped'],
      ];
      for (const [tabId, key] of histories) {
        await navigate(serviceWorker, tabId, site(key, 2));
        await navigate(serviceWorker, tabId, site(key, 3));
      }
      const pair: [number, number] = [grouped, next];
      await serviceWorker.evaluate(
        async ({ windowId, tabIds }) => {
          const group = await chrome.tabs.group({
            tabIds,
            createProperties: { windowId },
          });
          await chrome.tabGroups.update(group, { title: 'Trip' });
        },
        { windowId: made.windowId, tabIds: pair }
      );
      // PREMISE: both have three pages behind them before the close.
      await expect
        .poll(async () => [
          ...(await historyLengthsAt(context, site('loose', 3))),
          ...(await historyLengthsAt(context, site('grouped', 3))),
        ])
        .toEqual([3, 3]);

      await serviceWorker.evaluate(
        (id: number) => chrome.windows.remove(id),
        made.windowId
      );
      await serviceWorker.evaluate(async () => {
        const [entry] = await chrome.sessions.getRecentlyClosed({
          maxResults: 1,
        });
        await chrome.sessions.restore(entry?.window?.sessionId);
      });
      await expect
        .poll(
          async () => (await tabsAt(serviceWorker, site('grouped', 3))).length
        )
        .toBe(1);
      await settle(2000);
      const loose3 = await historyLengthsAt(context, site('loose', 3));
      const grouped3 = await historyLengthsAt(context, site('grouped', 3));
      console.log(
        `[7b] history.length after a window restore: ungrouped ${JSON.stringify(
          loose3
        )}, grouped ${JSON.stringify(grouped3)}`
      );
      // CONTROL: the ungrouped tab kept its history, so the read can see it.
      expect(loose3).toEqual([3]);
    }
  );

  grantedTest(
    '8. revoked from another page while On: the switch shows Off, and Reopen recreates',
    async ({ context, extensionId, serviceWorker }) => {
      const site = await servePages(context);
      // The switch's page, and a page that revokes from outside it.
      const settings = await openPage(
        context,
        extensionId,
        POPUP,
        POPUP_VIEWPORT
      );
      const row = await openHistoryRow(settings);
      await row.getByRole('button', { name: 'On', exact: true }).click();
      await expectPressed(row, 'On');
      const outside = await openPage(
        context,
        extensionId,
        POPUP,
        POPUP_VIEWPORT
      );
      const page = await openPage(context, extensionId, VIEW_TAB, TAB_VIEWPORT);
      const made = await openHistoryWindow(
        context,
        serviceWorker,
        site,
        'eight',
        'none'
      );
      // The close records Chrome's entry, since the grant is held now.
      await closeHistoryTab(page, serviceWorker, made);

      await outside.evaluate(() =>
        chrome.permissions.remove({ permissions: ['sessions'] })
      );
      await expect.poll(() => holdsSessions(page)).toBe(false);
      await expectPressed(row, 'Off');

      await pressReopen(page, serviceWorker, 'button');
      await expectCopies(serviceWorker, made.url, 1);
      await expect.poll(() => historyLengthsAt(context, made.url)).toEqual([1]);
      await expect(page.getByRole('status')).not.toContainText(REOPEN_FAILED);
    }
  );
});

// The rules the chrome fake MODELS for Part D, measured in this Chromium.
// Each prints what it measured; each asserts only what the code relies on.
// A raw Chrome call in each is the control that shows what the undo is up
// against.

test.describe('measured: a minimized window (KAN-280 Part D)', () => {
  test('9. raw: focusing a minimized window, and a restore into one, un-minimize it', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    await turnHistoryOn(context, extensionId);
    await openPage(context, extensionId, VIEW_TAB, TAB_VIEWPORT);

    // Raw, no Tab Keeper code: windows.update({focused}) on a minimized
    // window, and a sessions.restore into one.
    const made = await serviceWorker.evaluate(async () => {
      const open = async (titles: string[]) => {
        const win = await chrome.windows.create({
          focused: false,
          url: titles.map((t) => `data:text/html,<title>${t}</title>`),
        });
        return {
          windowId: win?.id ?? -1,
          tabIds: (win?.tabs ?? []).map((tab) => tab.id ?? -1),
        };
      };
      return {
        focus: await open(['FocusMe']),
        restore: await open(['Stay', 'Gone']),
      };
    });
    // Minimized only once Playwright has attached to their tabs: a page it
    // attaches to later is resized to its viewport, which un-minimizes the
    // window (seen here: a window minimized straight after windows.create
    // read 'normal' 500ms later).
    await expect
      .poll(() =>
        ['FocusMe', 'Gone'].every((title) =>
          context.pages().some((p) => p.url() === dataUrl(title))
        )
      )
      .toBe(true);
    await settle(500);
    const windowIds = [made.focus.windowId, made.restore.windowId];
    await serviceWorker.evaluate(async (ids: number[]) => {
      for (const id of ids) {
        await chrome.windows.update(id, { state: 'minimized' });
      }
    }, windowIds);
    // PREMISE: both are minimized.
    for (const id of windowIds) {
      await expect.poll(() => windowState(serviceWorker, id)).toBe('minimized');
    }

    await serviceWorker.evaluate(
      (id: number) => chrome.windows.update(id, { focused: true }),
      made.focus.windowId
    );
    await settle(500);
    const afterFocus = await windowState(serviceWorker, made.focus.windowId);

    const sameWindow = await serviceWorker.evaluate(
      async ({ windowId, gone }) => {
        await chrome.tabs.remove(gone);
        const [entry] = await chrome.sessions.getRecentlyClosed({
          maxResults: 1,
        });
        const session = await chrome.sessions.restore(entry?.tab?.sessionId);
        return session.tab?.windowId === windowId;
      },
      { windowId: made.restore.windowId, gone: made.restore.tabIds[1] }
    );
    await settle(500);
    const afterRestore = await windowState(
      serviceWorker,
      made.restore.windowId
    );
    console.log(
      `[9] raw: ${JSON.stringify({ afterFocus, afterRestore, sameWindow })}`
    );
    // Reopen with history re-minimizes (9b) because the restore does this.
    expect(sameWindow).toBe(true);
  });

  test('9b. Reopen with history into a minimized window leaves it minimized', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const site = await servePages(context);
    await turnHistoryOn(context, extensionId);
    const page = await openPage(context, extensionId, VIEW_TAB, TAB_VIEWPORT);
    const tabView = await tabViewIds(page);

    // The History tab's window minimized, History closed from Open now and
    // reopened with history.
    const made = await openHistoryWindow(
      context,
      serviceWorker,
      site,
      'nine',
      'none'
    );
    await serviceWorker.evaluate(
      (id: number) => chrome.windows.update(id, { state: 'minimized' }),
      made.windowId
    );
    // PREMISE: headless Chromium minimizes it.
    await expect
      .poll(() => windowState(serviceWorker, made.windowId))
      .toBe('minimized');
    await closeHistoryTab(page, serviceWorker, made);
    await recordFocusRequests(serviceWorker);
    // Every state the window passes through during the Reopen, sampled
    // every 5ms in the worker.
    await serviceWorker.evaluate((id: number) => {
      const states: string[] = [];
      Reflect.set(globalThis, 'minimizedStates', states);
      const sample = async () => {
        const state = (await chrome.windows.get(id)).state ?? '';
        if (states[states.length - 1] !== state) states.push(state);
      };
      Reflect.set(globalThis, 'minimizedSampler', setInterval(sample, 5));
    }, made.windowId);
    await pressReopen(page, serviceWorker, 'button');

    const [back] = await expectCopies(serviceWorker, made.url, 1);
    expect(back).toMatchObject({ windowId: made.windowId, index: 1 });
    const states: unknown = await serviceWorker.evaluate(() => {
      clearInterval(Reflect.get(globalThis, 'minimizedSampler'));
      return Reflect.get(globalThis, 'minimizedStates');
    });
    console.log(
      `[9b] the window's states during Reopen: ${JSON.stringify(states)}`
    );
    await expect.poll(() => historyLengthsAt(context, made.url)).toEqual([3]);
    // Ends minimized, held for a second so a late un-minimize is seen.
    await expect
      .poll(() => windowState(serviceWorker, made.windowId))
      .toBe('minimized');
    for (let sample = 0; sample < 10; sample += 1) {
      await page.waitForTimeout(100);
      expect(await windowState(serviceWorker, made.windowId)).toBe('minimized');
    }
    // The undo asked for the tab view's window's focus back, last (headless
    // cannot show it returning: recordFocusRequests).
    expect(await lastFocusRequest(serviceWorker)).toBe(tabView.windowId);
    expect(await activeTabOf(serviceWorker, tabView.windowId)).toBe(
      tabView.tabId
    );
  });
});

grantedTest.describe('an ungrouped tab and a collapsed group (KAN-316)', () => {
  // Each tab as `title*` when in front, `[group,collapsed|open]` when grouped.
  const layoutOf = (worker: Worker, windowId: number): Promise<string[]> =>
    worker.evaluate(async (id: number) => {
      const out: string[] = [];
      for (const tab of await chrome.tabs.query({ windowId: id })) {
        const group =
          tab.groupId === -1 ? null : await chrome.tabGroups.get(tab.groupId);
        const title = (tab.title ?? '').replace(/^p3 .*/, 'X');
        out.push(
          `${title}${tab.active ? '*' : ''}${
            group
              ? `[${group.title},${group.collapsed ? 'collapsed' : 'open'}]`
              : ''
          }`
        );
      }
      return out;
    }, windowId);

  // [A, X, B, Z], Z in front; X went p1 → p2 → p3.
  async function openFourTabs(
    context: BrowserContext,
    worker: Worker,
    site: Site,
    key: string
  ) {
    const made = await worker.evaluate(
      async ({ urls }) => {
        const win = await chrome.windows.create({
          focused: false,
          url: urls,
        });
        const ids = (win?.tabs ?? []).flatMap((tab) =>
          tab.id === undefined ? [] : [tab.id]
        );
        if (win?.id === undefined || ids.length !== urls.length) return null;
        await chrome.tabs.update(ids[3], { active: true });
        return { windowId: win.id, ids };
      },
      {
        urls: [dataUrl('A'), site(key, 1), dataUrl('B'), dataUrl('Z')],
      }
    );
    if (made === null) throw new Error('Chrome gave no window or tab ids');
    const [a, x, b] = made.ids;
    await navigate(worker, x, site(key, 2));
    await navigate(worker, x, site(key, 3));
    await expect
      .poll(() => historyLengthsAt(context, site(key, 3)))
      .toEqual([3]);
    return { windowId: made.windowId, a, b, url: site(key, 3) };
  }

  // A and B grouped as H and collapsed, after X has closed: X's old index is
  // now inside a collapsed run.
  const collapseAroundTheGap = (
    worker: Worker,
    windowId: number,
    tabIds: [number, number]
  ) =>
    worker.evaluate(
      async ({ windowId, tabIds }) => {
        const group = await chrome.tabs.group({
          tabIds,
          createProperties: { windowId },
        });
        await chrome.tabGroups.update(group, { title: 'H', collapsed: true });
      },
      { windowId, tabIds }
    );

  // Every collapsed change Chrome reports for a group, as `title:open` or
  // `title:collapsed`, recorded in the worker from now on.
  const recordGroupChanges = (worker: Worker) =>
    worker.evaluate(() => {
      const changes: string[] = [];
      Reflect.set(globalThis, 'groupChanges', changes);
      chrome.tabGroups.onUpdated.addListener((group) => {
        changes.push(
          `${group.title}:${group.collapsed ? 'collapsed' : 'open'}`
        );
      });
    });
  const groupChanges = async (worker: Worker): Promise<string[]> => {
    const changes: unknown = await worker.evaluate(() =>
      Reflect.get(globalThis, 'groupChanges')
    );
    return Array.isArray(changes)
      ? changes.filter((c): c is string => typeof c === 'string')
      : [];
  };

  // Task 8, M2 raw. The chrome fake's restore follows this (KAN-316).
  grantedTest(
    '10. raw: Chrome restores an ungrouped tab just after a collapsed group, in front, and leaves the group collapsed',
    async ({ context, extensionId, serviceWorker }) => {
      const site = await servePages(context);
      await turnHistoryOn(context, extensionId);
      await openPage(context, extensionId, VIEW_TAB, TAB_VIEWPORT);
      const made = await openFourTabs(context, serviceWorker, site, 'tenraw');
      const x = (await tabsAt(serviceWorker, made.url))[0]?.id ?? -1;
      await serviceWorker.evaluate((id: number) => chrome.tabs.remove(id), x);
      const sessionId = await serviceWorker.evaluate(async () => {
        const [entry] = await chrome.sessions.getRecentlyClosed({
          maxResults: 1,
        });
        return entry?.tab?.sessionId ?? '';
      });
      await collapseAroundTheGap(serviceWorker, made.windowId, [
        made.a,
        made.b,
      ]);
      // PREMISE: the gap is inside a collapsed run.
      await expect
        .poll(() => layoutOf(serviceWorker, made.windowId))
        .toEqual(['A[H,collapsed]', 'B[H,collapsed]', 'Z*']);

      await serviceWorker.evaluate(
        (id: string) => chrome.sessions.restore(id),
        sessionId
      );
      await expect
        .poll(async () => (await tabsAt(serviceWorker, made.url)).length)
        .toBe(1);
      await settle(500);
      expect(await layoutOf(serviceWorker, made.windowId)).toEqual([
        'A[H,collapsed]',
        'B[H,collapsed]',
        'X*',
        'Z',
      ]);
    }
  );

  // KAN-316: On ends exactly where Off (recreate) does -- H collapsed, X
  // ungrouped just after it, Z still in front -- and H never opens on the
  // way. Only the history differs.
  for (const history of [true, false]) {
    grantedTest(
      `10b. ${
        history ? 'On' : 'CONTROL, Off'
      }: Reopen of that tab leaves the group collapsed, as recreate does (KAN-316)`,
      async ({ context, extensionId, serviceWorker }) => {
        const site = await servePages(context);
        if (history) await turnHistoryOn(context, extensionId);
        const page = await openPage(
          context,
          extensionId,
          VIEW_TAB,
          TAB_VIEWPORT
        );
        const made = await openFourTabs(
          context,
          serviceWorker,
          site,
          history ? 'tenon' : 'tenoff'
        );
        const block = windowBlock(page, made.windowId);
        const title = pageTitle(history ? 'tenon' : 'tenoff', 3);
        await expect(liveRowIn(block, title)).toBeVisible();
        await closeTabIn(block, title).click();
        await expect
          .poll(async () => (await tabsAt(serviceWorker, made.url)).length)
          .toBe(0);
        await collapseAroundTheGap(serviceWorker, made.windowId, [
          made.a,
          made.b,
        ]);
        await expect
          .poll(() => layoutOf(serviceWorker, made.windowId))
          .toEqual(['A[H,collapsed]', 'B[H,collapsed]', 'Z*']);
        await recordGroupChanges(serviceWorker);

        await pressReopen(page, serviceWorker, 'button');
        await expectCopies(serviceWorker, made.url, 1);
        await page.waitForTimeout(1000);

        expect(await layoutOf(serviceWorker, made.windowId)).toEqual([
          'A[H,collapsed]',
          'B[H,collapsed]',
          'X',
          'Z*',
        ]);
        expect(await groupChanges(serviceWorker)).not.toContain('H:open');
        // PREMISE: On came back through Chrome's restore, Off through a
        // recreate.
        expect(await historyLengthsAt(context, made.url)).toEqual([
          history ? 3 : 1,
        ]);
      }
    );
  }
});

test.describe('measured: what sendMessage says (KAN-280 Part D)', () => {
  test('11. the rejection with no receiving end is the text the page falls back on; what an unanswered message resolves with', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const page = await openPage(context, extensionId, VIEW_TAB, TAB_VIEWPORT);

    // Page → the worker, whose listener exists but answers nothing for a
    // message none of its branches take.
    const unanswered = await page.evaluate(async () => {
      try {
        const value: unknown = await chrome.runtime.sendMessage({
          type: 'nothing answers this',
        });
        return `resolved ${
          value === undefined ? 'undefined' : JSON.stringify(value)
        }`;
      } catch (error) {
        return `rejected ${
          error instanceof Error ? error.message : String(error)
        }`;
      }
    });

    // The worker → the extension's pages, none of which listen: no
    // receiving end.
    const noReceiver = await serviceWorker.evaluate(async () => {
      try {
        await chrome.runtime.sendMessage({ type: 'nobody listens' });
        return 'resolved';
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    });

    // The worker → a page whose listener keeps the channel open (returns
    // true) and never answers; then that page closes.
    const listener = await openPage(
      context,
      extensionId,
      POPUP,
      POPUP_VIEWPORT
    );
    await listener.evaluate(() => {
      chrome.runtime.onMessage.addListener(() => true);
    });
    await serviceWorker.evaluate(() => {
      const outcome: string[] = [];
      Reflect.set(globalThis, 'keptOpenOutcome', outcome);
      chrome.runtime.sendMessage({ type: 'kept open' }).then(
        (value: unknown) => outcome.push(`resolved ${JSON.stringify(value)}`),
        (error: unknown) =>
          outcome.push(
            `rejected ${error instanceof Error ? error.message : String(error)}`
          )
      );
    });
    const keptOpen = (): Promise<unknown> =>
      serviceWorker.evaluate(() => Reflect.get(globalThis, 'keptOpenOutcome'));
    await page.waitForTimeout(2000);
    const pendingAfter2s = await keptOpen();
    await listener.close();
    await expect.poll(keptOpen).toHaveLength(1);
    const afterClose = await keptOpen();

    console.log(
      `[11] ${JSON.stringify({
        unanswered,
        noReceiver,
        pendingAfter2s,
        afterClose,
      })}`
    );
    // The page's fallback (reopenClosed) recreates only on this text.
    expect(noReceiver).toBe(
      'Could not establish connection. Receiving end does not exist.'
    );
    // An unanswered message resolves, it does not reject: the page takes it
    // as an answer it did not expect, and reopens nothing more.
    expect(unanswered).toBe('resolved undefined');
  });
});

test.describe('measured: close latency (KAN-280 Part D)', () => {
  test('12. the time from the Close click to the tab being gone, Off and On', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    test.setTimeout(120_000);
    const CLOSES = 12;
    const median = (values: number[]): number => {
      const sorted = [...values].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      return sorted.length % 2 === 1
        ? sorted[mid]
        : (sorted[mid - 1] + sorted[mid]) / 2;
    };

    // Clicks the × of T1..T12 in a fresh window, one at a time, each once
    // the last is gone. Returns each close's time from the click (page clock)
    // to Chrome's onRemoved (the worker's clock: the same wall clock).
    const closeTwelve = async (page: Page): Promise<number[]> => {
      const titles = Array.from({ length: CLOSES }, (_, i) => `T${i + 1}`);
      const made = await serviceWorker.evaluate(
        async ({ urls }) => {
          const win = await chrome.windows.create({
            focused: false,
            url: urls,
          });
          return win?.id ?? null;
        },
        { urls: ['Keep', ...titles].map(dataUrl) }
      );
      if (made === null) throw new Error('no window id');
      const block = windowBlock(page, made);
      await expect(
        block.getByRole('button', { name: /^Switch to tab: / })
      ).toHaveCount(CLOSES + 1);

      await page.evaluate(() => {
        document.documentElement.dataset.clickedAt = '[]';
        window.addEventListener(
          'click',
          () => {
            const at: unknown = JSON.parse(
              document.documentElement.dataset.clickedAt ?? '[]'
            );
            document.documentElement.dataset.clickedAt = JSON.stringify([
              ...(Array.isArray(at) ? at : []),
              Date.now(),
            ]);
          },
          { capture: true }
        );
      });
      await serviceWorker.evaluate(() => {
        const removedAt: number[] = [];
        Reflect.set(globalThis, 'removedAt', removedAt);
        chrome.tabs.onRemoved.addListener(() => removedAt.push(Date.now()));
      });
      for (const [i, title] of titles.entries()) {
        await closeTabIn(block, title).click();
        await expect
          .poll(async () => {
            const removed: unknown = await serviceWorker.evaluate(() =>
              Reflect.get(globalThis, 'removedAt')
            );
            return Array.isArray(removed) ? removed.length : 0;
          })
          .toBe(i + 1);
        await expect(liveRowIn(block, title)).toHaveCount(0);
      }
      const clicked: unknown = JSON.parse(
        await page.evaluate(
          () => document.documentElement.dataset.clickedAt ?? '[]'
        )
      );
      const removed: unknown = await serviceWorker.evaluate(() =>
        Reflect.get(globalThis, 'removedAt')
      );
      if (!Array.isArray(clicked) || !Array.isArray(removed)) {
        throw new Error('no timings recorded');
      }
      expect(clicked).toHaveLength(CLOSES);
      expect(removed).toHaveLength(CLOSES);
      return removed.map((at: unknown, i: number) => {
        const click: unknown = clicked[i];
        if (typeof at !== 'number' || typeof click !== 'number') {
          throw new Error('a timing is not a number');
        }
        return at - click;
      });
    };

    const offPage = await openPage(
      context,
      extensionId,
      VIEW_TAB,
      TAB_VIEWPORT
    );
    const off = await closeTwelve(offPage);
    await offPage.close();

    await turnHistoryOn(context, extensionId);
    const onPage = await openPage(context, extensionId, VIEW_TAB, TAB_VIEWPORT);
    // PREMISE: the page closing below holds the grant.
    expect(await holdsSessions(onPage)).toBe(true);
    const on = await closeTwelve(onPage);
    // What On adds before and after each remove, timed on its own in the
    // same page: two permission checks and two list reads.
    const addedWork = await onPage.evaluate(async () => {
      const times: number[] = [];
      for (let i = 0; i < 12; i += 1) {
        const start = performance.now();
        for (let read = 0; read < 2; read += 1) {
          await chrome.permissions.contains({ permissions: ['sessions'] });
          await chrome.sessions.getRecentlyClosed();
        }
        times.push(Math.round((performance.now() - start) * 10) / 10);
      }
      return times;
    });

    console.log(
      `[12] ${JSON.stringify({
        offMs: off,
        onMs: on,
        offMedian: median(off),
        onMedian: median(on),
        addedWorkMs: addedWork,
        addedWorkMedian: median(addedWork),
      })}`
    );
  });
});

test.describe('measured: no tabGroups grant (KAN-280 Part D)', () => {
  test('13. a grouped tab reopened with history comes back in its Chrome group, and nothing throws', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const site = await servePages(context);
    await turnHistoryOn(context, extensionId);
    const page = await openPage(context, extensionId, VIEW_TAB, TAB_VIEWPORT);
    // PREMISE: this profile has no tabGroups grant.
    expect(
      await page.evaluate(() =>
        chrome.permissions.contains({ permissions: ['tabGroups'] })
      )
    ).toBe(false);
    const warnings = recordWorkerWarnings(serviceWorker);
    // CONTROL: the recorder hears the worker, so an empty list below is not
    // a deaf one.
    await serviceWorker.evaluate(() => console.warn('recorder check'));
    await expect.poll(() => warnings).toEqual(['recorder check']);
    warnings.length = 0;
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));

    const made = await openHistoryWindow(
      context,
      serviceWorker,
      site,
      'thirteen',
      'untitled'
    );
    // PREMISE: History is in a real Chrome group, at index 1.
    expect(made.groupId).toBeGreaterThan(-1);
    expect(await tabsAt(serviceWorker, made.url)).toEqual([
      expect.objectContaining({ index: 1, groupId: made.groupId }),
    ]);

    await closeHistoryTab(page, serviceWorker, made);
    await pressReopen(page, serviceWorker, 'button');

    const [back] = await expectCopies(serviceWorker, made.url, 1);
    expect(back).toMatchObject({
      windowId: made.windowId,
      index: 1,
      active: false,
      groupId: made.groupId,
    });
    await expect.poll(() => historyLengthsAt(context, made.url)).toEqual([3]);
    await expect(page.getByRole('status')).not.toContainText(REOPEN_FAILED);
    expect(warnings).toEqual([]);
    expect(errors).toEqual([]);
  });
});

test('14. the built worker starts with its message listener', async ({
  serviceWorker,
}) => {
  const errors: string[] = [];
  serviceWorker.on('console', (message: ConsoleMessage) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  expect(
    await serviceWorker.evaluate(() => chrome.runtime.onMessage.hasListeners())
  ).toBe(true);
  expect(errors).toEqual([]);
});

test('15. measured, harness: headless keeps naming a window focused after the focus moves back', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  const page = await openPage(context, extensionId, VIEW_TAB, TAB_VIEWPORT);
  const tabView = await tabViewIds(page);
  const other = await serviceWorker.evaluate(async () => {
    const win = await chrome.windows.create({
      focused: false,
      url: 'data:text/html,<title>Other</title>',
    });
    return win?.id ?? -1;
  });
  const lastFocused = async () => (await inFront(serviceWorker)).windowId;
  // PREMISE: an unfocused create leaves the tab view's window in front.
  expect(await lastFocused()).toBe(tabView.windowId);

  await serviceWorker.evaluate(
    (id: number) => chrome.windows.update(id, { focused: true }),
    other
  );
  // CONTROL: a focus change is visible here.
  await expect.poll(lastFocused).toBe(other);

  await serviceWorker.evaluate(
    (id: number) => chrome.windows.update(id, { focused: true }),
    tabView.windowId
  );
  await settle(1500);
  const focusedFlags = await serviceWorker.evaluate(async () =>
    (await chrome.windows.getAll()).map((w) => w.focused)
  );
  console.log(
    `[15] after focusing back: getLastFocused ${await lastFocused()} (tab view ${
      tabView.windowId
    }, other ${other}), focused flags ${JSON.stringify(focusedFlags)}`
  );
  // The focus going back is invisible: why recordFocusRequests exists.
  expect(await lastFocused()).toBe(other);
});
