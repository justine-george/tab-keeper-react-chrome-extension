import type { BrowserContext, Page, Worker } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { grantedTest } from './fixtures/grantedExtension';
import { saveRowMenu } from './fixtures/menus';
import { buildContainer, buildSession, seedSessions } from './fixtures/seed';

// KAN-279 Part D on the real artifact: Tab Keeper in its own tab
// (`index.html?view=tab`) beside the popup page (`index.html`, driven as a
// tab -- the real action popup closes on focus loss and cannot be automated).
// popout-tab.spec.ts holds the tab view's layout; this file holds what it
// DOES: the worker opening or focusing it (D4/D5), the controls it hides
// (D7/D13), saves leaving it out (D6), and live reload plus the drag hold
// between it and the popup page (D8/D9/D12).
//
// Visibility-driven cloud reads (D11) are not here: Playwright pins every
// page visible (devtools-harnesses-pin-visibility), so they are unit-tested
// and checked by hand in a no-CDP launch.

const TAB_VIEWPORT = { width: 1280, height: 800 };
const POPUP_VIEWPORT = { width: 790, height: 550 };

const VIEW_TAB = 'index.html?view=tab';

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
  await page.getByRole('button', { name: 'Sort sessions' }).waitFor();
  return page;
}

interface TabFacts {
  url: string;
  index: number;
  pinned: boolean;
  active: boolean;
  windowId: number;
}

// Every tab, read by the worker. Filtered here rather than by a tabs.query
// url pattern: the worker's own lookup (openOrFocusTabView) queries by
// pattern, and a spec that asked the same way could not see that lookup
// failing.
const allTabs = (worker: Worker): Promise<TabFacts[]> =>
  worker.evaluate(() =>
    chrome.tabs.query({}).then((tabs) =>
      tabs.map((t) => ({
        url: t.url ?? t.pendingUrl ?? '',
        index: t.index,
        pinned: t.pinned,
        active: t.active,
        windowId: t.windowId,
      }))
    )
  );

const viewTabs = async (worker: Worker) =>
  (await allTabs(worker)).filter((t) => t.url.includes(VIEW_TAB));

// The tab a page is, found by its exact URL among the worker's tabs.
async function tabOf(worker: Worker, page: Page): Promise<TabFacts> {
  const url = page.url();
  const matches = (await allTabs(worker)).filter((t) => t.url === url);
  if (matches.length !== 1) {
    throw new Error(`expected one tab at ${url}, found ${matches.length}`);
  }
  return matches[0];
}

test.describe('Open in a tab (KAN-279 D4, D5)', () => {
  test('the first click opens one tab view, first unpinned in the window; a second click from a fresh popup focuses it', async ({
    context,
    extensionId,
    serviceWorker,
  }, testInfo) => {
    await seedSessions(context);
    const popup = await openPage(
      context,
      extensionId,
      'index.html',
      POPUP_VIEWPORT
    );
    const popupTab = await tabOf(serviceWorker, popup);

    // A pinned tab at the front of the window, so "first unpinned" is a
    // different index from "first": Chrome keeps unpinned tabs after pinned
    // ones, and the worker asks for index 0.
    const pinned = await serviceWorker.evaluate(
      (windowId: number) =>
        chrome.tabs
          .create({ windowId, url: 'about:blank', pinned: true, active: false })
          .then((t) => ({ index: t.index, pinned: t.pinned })),
      popupTab.windowId
    );
    expect(pinned).toEqual({ index: 0, pinned: true });

    await popup
      .getByRole('button', { name: 'Open in a tab', exact: true })
      .click();
    // The worker creates the tab. Found by URL among the context's pages
    // rather than by the next 'page' event, which the pinned tab above can
    // still be the one to fire.
    let found: Page | undefined;
    await expect
      .poll(() => {
        found = context.pages().find((p) => p.url().endsWith(VIEW_TAB));
        return found !== undefined;
      })
      .toBe(true);
    if (found === undefined) throw new Error('no tab view page');
    const tabPage = found;
    await tabPage.getByRole('button', { name: 'Sort sessions' }).waitFor();

    // One tab view, in the popup's window, right after the pinned tab, and
    // the one the user is now looking at.
    await expect
      .poll(async () =>
        (await viewTabs(serviceWorker)).map((t) => ({
          index: t.index,
          pinned: t.pinned,
          active: t.active,
          windowId: t.windowId,
        }))
      )
      .toEqual([
        { index: 1, pinned: false, active: true, windowId: popupTab.windowId },
      ]);

    // KAN-279 D4: the user can pin the tab view tab itself, once it exists.
    // Pinning changes a tab's index and pinned state, never its URL, so the
    // worker's lookup -- a URL glob query, not an index -- must still find
    // it below.
    const tabPageId = await serviceWorker.evaluate(
      (url: string) => chrome.tabs.query({ url }).then((tabs) => tabs[0]?.id),
      tabPage.url()
    );
    if (tabPageId === undefined) throw new Error('no tab view tab to pin');
    await serviceWorker.evaluate(
      (id: number) => chrome.tabs.update(id, { pinned: true }),
      tabPageId
    );
    // PREMISE: the pin took effect.
    await expect
      .poll(async () => (await viewTabs(serviceWorker)).map((t) => t.pinned))
      .toEqual([true]);

    // A fresh popup page, so the tab view is NOT the active tab when the
    // second click arrives. newPage already activates it (measured: the
    // premise holds with bringToFront removed); bringToFront says so.
    const again = await openPage(
      context,
      extensionId,
      'index.html',
      POPUP_VIEWPORT
    );
    await again.bringToFront();
    // PREMISE: the second click has something to activate.
    await expect
      .poll(async () => (await viewTabs(serviceWorker)).map((t) => t.active))
      .toEqual([false]);

    await again
      .getByRole('button', { name: 'Open in a tab', exact: true })
      .click();

    // Wait for the second click to have DONE something: the window's active
    // tab is a tab view. Correct code activates the existing one; a lookup
    // that misses creates a second, active one -- which the count below then
    // catches.
    await expect
      .poll(
        () =>
          serviceWorker.evaluate(
            (windowId: number) =>
              chrome.tabs
                .query({ active: true, windowId })
                .then((tabs) => tabs.map((t) => t.url ?? t.pendingUrl ?? '')),
            popupTab.windowId
          ),
        { message: 'the second click activated no tab view' }
      )
      .toEqual([expect.stringContaining(VIEW_TAB)]);
    const after = await viewTabs(serviceWorker);
    expect(after.length, 'the second click opened another tab view').toBe(1);

    await tabPage.screenshot({ path: testInfo.outputPath('tab-view.png') });
  });
});

// A session with one window holding one Chrome group, selected, so every
// control the tab view hides is on screen in the popup: the right pane's
// Switch to session, the row's Switch, the window's Add current tab and the
// group's Add current tab to group.
const GROUPED = buildSession({
  tabGroupId: 'grouped',
  title: 'Grouped session',
  isSelected: true,
  windowCount: 1,
  tabCount: 2,
  windows: [
    {
      windowId: 'w1',
      windowHeight: 1080,
      windowWidth: 1920,
      windowOffsetTop: 0,
      windowOffsetLeft: 0,
      tabCount: 2,
      title: 'w1',
      tabs: [
        {
          tabId: 't1',
          favicon: '',
          title: 'Tab one',
          url: 'https://one.test/',
          chromeGroupId: 'g1',
        },
        {
          tabId: 't2',
          favicon: '',
          title: 'Tab two',
          url: 'https://two.test/',
        },
      ],
      chromeTabGroups: [{ groupId: 'g1', title: 'Group', color: 'blue' }],
    },
  ],
});

// Accessible names as they render in English. "Switch to session" and "Open
// session" are the i18n KEYS; en maps them to these.
const HIDDEN_IN_TAB = [
  'Close current windows and open this session',
  'Switch',
  'Add current tab',
  'Add current tab to group',
  'Open in a tab',
];
const KEPT_IN_TAB = 'Open session, keeping current windows';

grantedTest.describe('controls the tab view hides (KAN-279 D7, D13)', () => {
  // The group row only renders with tabGroups granted, hence grantedTest.
  grantedTest(
    'Switch and Add current tab are absent in the tab view and present in the popup; Open session is in both',
    async ({ context, extensionId }, testInfo) => {
      await seedSessions(context, {
        ...buildContainer([GROUPED]),
        selectedTabGroupId: GROUPED.tabGroupId,
      });
      const popup = await openPage(
        context,
        extensionId,
        'index.html',
        POPUP_VIEWPORT
      );
      const tab = await openPage(context, extensionId, VIEW_TAB, TAB_VIEWPORT);
      // Barrier: the selected session's detail, group band included, has
      // rendered in both pages.
      for (const page of [popup, tab]) {
        await page.locator('[data-band-id="g1"]').waitFor();
      }

      const softly = expect.configure({ soft: true });
      const named = (page: Page, name: string) =>
        page.getByRole('button', { name, exact: true });

      // CONTROL: the same locators find every control in the popup, so an
      // absence in the tab is the tab view's doing, not a name that never
      // renders.
      for (const name of HIDDEN_IN_TAB) {
        await softly(named(popup, name), `popup: ${name}`).toHaveCount(1);
      }
      await softly(
        named(popup, KEPT_IN_TAB),
        `popup: ${KEPT_IN_TAB}`
      ).toHaveCount(1);

      for (const name of HIDDEN_IN_TAB) {
        await softly(named(tab, name), `tab view: ${name}`).toHaveCount(0);
      }
      await softly(
        named(tab, KEPT_IN_TAB),
        `tab view: ${KEPT_IN_TAB}`
      ).toHaveCount(1);

      await tab.screenshot({ path: testInfo.outputPath('tab-view.png') });
    }
  );
});

// The URLs of every stored session's tabs, by session title.
const storedUrls = (page: Page) =>
  page.evaluate(() => {
    const raw = window.localStorage.getItem('tabContainerData');
    const parsed: unknown = raw === null ? null : JSON.parse(raw);
    const out: Record<string, string[]> = {};
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !('tabGroups' in parsed) ||
      !Array.isArray(parsed.tabGroups)
    ) {
      return out;
    }
    for (const g of parsed.tabGroups) {
      if (typeof g !== 'object' || g === null) continue;
      const title = 'title' in g && typeof g.title === 'string' ? g.title : '';
      const windows: unknown[] =
        'windows' in g && Array.isArray(g.windows) ? g.windows : [];
      out[title] = windows.flatMap((w) => {
        if (typeof w !== 'object' || w === null || !('tabs' in w)) return [];
        const tabs: unknown[] = Array.isArray(w.tabs) ? w.tabs : [];
        return tabs.flatMap((t) =>
          typeof t === 'object' &&
          t !== null &&
          'url' in t &&
          typeof t.url === 'string'
            ? [t.url]
            : []
        );
      });
    }
    return out;
  });

test.describe('saves in the tab view leave out its own tab (KAN-279 D6)', () => {
  test('Save current window from the tab view saves the other tabs and not the tab view', async ({
    context,
    extensionId,
  }, testInfo) => {
    await seedSessions(context);
    // A real page in the same window, answered locally: the tab the save
    // must keep.
    await context.route('https://kept.test/**', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<title>Kept page</title><p>kept</p>',
      })
    );
    const other = await context.newPage();
    await other.goto('https://kept.test/');
    const tab = await openPage(context, extensionId, VIEW_TAB, TAB_VIEWPORT);

    await tab.locator('input#name').fill('Saved from the tab view');
    await saveRowMenu(tab).click();
    await tab
      .getByRole('menuitem', { name: 'Save current window as a session' })
      .click();
    await expect(
      tab.getByRole('button', { name: 'Saved from the tab view', exact: true })
    ).toBeVisible();

    const urls = (await storedUrls(tab))['Saved from the tab view'] ?? [];
    console.log(`[D6] saved URLs: ${JSON.stringify(urls)}`);
    // CONTROL: the save captured this window's other tabs.
    expect(urls, 'the other tab in the window was not saved').toContain(
      'https://kept.test/'
    );
    expect(
      urls.filter((u) => u.includes(VIEW_TAB)),
      'the tab view saved itself'
    ).toEqual([]);

    await tab.screenshot({ path: testInfo.outputPath('tab-view.png') });
  });
});

// ---- (4) the popup page and the tab view together (D8, D9, D12) ----

const HOUR = 60 * 60 * 1000;
const BASE = Date.UTC(2026, 8, 1, 9, 0, 0);
const at = (hours: number) => ({
  createdAt: BASE + hours * HOUR,
  createdTime: `2026-09-01 ${String(9 + hours).padStart(2, '0')}:00:00`,
});

// Stored newest first. The stored array IS the display order -- nothing sorts
// at render (measured: seeding A with the oldest createdAt still shows it
// first) -- and a save goes on top of it.
const A = buildSession({ tabGroupId: 'a', title: 'Session A', ...at(4) });
const B = buildSession({ tabGroupId: 'b', title: 'Session B', ...at(3) });
const C = buildSession({ tabGroupId: 'c', title: 'Session C', ...at(2) });
const D = buildSession({ tabGroupId: 'd', title: 'Session D', ...at(1) });

// How long a negative is watched for. The save-round-trip test asserts a
// save crosses between the pages inside this same window, so an absence
// across it while a row is held is the hold, not a slow event.
const WATCH_MS = 2_000;

const CLOUD = /firestore\.googleapis\.com|identitytoolkit\.googleapis\.com/;

// Once per profile: seedSessions is an init script that re-runs on every
// navigation in the context, so the second page to open would re-seed over
// the first page's save. The marker makes every later page read what the
// earlier ones wrote.
//
// Auto Sync off: a sync is a second route from localStorage into a page
// (live-reload.spec.ts), and the storage event must be the only one here.
// Measured with it on (2026-09-23): the tab view's startup sync found no
// cloud document and took the local-only branch, which loads localStorage
// with no drag-hold check, so the popup's save went in under the held row
// and D landed beside it. That is a gap in the hold, reported separately,
// not something this spec covers.
async function seedOnce(context: BrowserContext): Promise<void> {
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
      sessions: JSON.stringify(buildContainer([A, B, C, D])),
      settings: JSON.stringify({ cloudConsent: 'granted', isAutoSync: false }),
    }
  );
}

async function openBoth(context: BrowserContext, extensionId: string) {
  await seedOnce(context);
  const cloudRequests: string[] = [];
  const popup = await openPage(
    context,
    extensionId,
    'index.html',
    POPUP_VIEWPORT
  );
  const tab = await openPage(context, extensionId, VIEW_TAB, TAB_VIEWPORT);
  for (const page of [popup, tab]) {
    page.on('request', (r) => {
      if (CLOUD.test(r.url())) cloudRequests.push(r.url());
    });
    await expect(row(page, D.title)).toBeVisible();
  }
  return { popup, tab, cloudRequests };
}

const row = (page: Page, title: string) =>
  page.getByRole('button', { name: title, exact: true });

// Saves every open window under `title`, from the save row's name box.
async function saveAs(page: Page, title: string): Promise<void> {
  const input = page.locator('input#name');
  await input.fill(title);
  await input.press('Enter');
  await expect(row(page, title)).toBeVisible();
}

// The session list's rows only. Every drag list marks its rows with
// data-drag-row-id, and a page with a session selected also shows that
// session's windows and tabs in the detail pane.
const SESSION_ROWS = '[data-pane="sessions"] [data-drag-row-id]';

// Session titles top to bottom as painted, transforms included. Read from
// each drag row's title, a native <button> (ClickableRow); its Open/Switch/
// Delete are div[role=button], so they never match.
const paintedTitles = (page: Page) =>
  page.locator(SESSION_ROWS).evaluateAll((els) =>
    els
      .map((el) => ({
        title:
          el.querySelector('button[aria-label]')?.getAttribute('aria-label') ??
          '',
        top: el.getBoundingClientRect().top,
      }))
      .sort((p, q) => p.top - q.top)
      .map((r) => r.title)
  );

// Session titles in DOM order: what the store holds, whatever is painted.
const shownTitles = (page: Page) =>
  page
    .locator(SESSION_ROWS)
    .evaluateAll((els) =>
      els.map(
        (el) =>
          el.querySelector('button[aria-label]')?.getAttribute('aria-label') ??
          ''
      )
    );

const draggingKind = (page: Page) =>
  page.evaluate(() => document.documentElement.getAttribute('data-dragging'));

// The title just above `title`, or null.
const above = (titles: string[], title: string): string | null => {
  const i = titles.indexOf(title);
  return i > 0 ? titles[i - 1] : null;
};

test.describe('the popup page and the tab view together (KAN-279 D8, D9, D12)', () => {
  test('a save in either page appears in the other', async ({
    context,
    extensionId,
  }, testInfo) => {
    const { popup, tab, cloudRequests } = await openBoth(context, extensionId);

    // Soft, so a page that hears nothing reports both directions.
    const softly = expect.configure({ soft: true });
    await saveAs(popup, 'Saved in the popup');
    await softly(
      row(tab, 'Saved in the popup'),
      "the tab view never showed the popup's save"
    ).toBeVisible({ timeout: WATCH_MS });

    await saveAs(tab, 'Saved in the tab view');
    await softly(
      row(popup, 'Saved in the tab view'),
      "the popup never showed the tab view's save"
    ).toBeVisible({ timeout: WATCH_MS });

    await tab.screenshot({ path: testInfo.outputPath('tab-view.png') });
    expect(cloudRequests, 'a page reached the cloud').toEqual([]);
  });

  test('a save in the popup while a row is held in the tab view lands after the drop, and the row sits by its aimed neighbour', async ({
    context,
    extensionId,
  }, testInfo) => {
    const { popup, tab, cloudRequests } = await openBoth(context, extensionId);
    const unmoved = [A.title, B.title, C.title, D.title];
    expect(await shownTitles(tab)).toEqual(unmoved);

    // Pick up D and aim it between A and B: pressed at D's centre, moved to
    // B's top edge -- below A's midpoint and above B's.
    const box = async (id: string) => {
      const b = await tab.locator(`[data-drag-row-id="${id}"]`).boundingBox();
      if (b === null) throw new Error(`no box for row ${id}`);
      return b;
    };
    const d = await box(D.tabGroupId);
    const b = await box(B.tabGroupId);
    const x = d.x + d.width / 2;
    const startY = d.y + d.height / 2;
    await tab.mouse.move(x, startY);
    await tab.mouse.down();
    await tab.mouse.move(x, startY - 8, { steps: 4 });
    await tab.mouse.move(x, b.y, { steps: 10 });
    expect(await draggingKind(tab), 'the drag never started').toBe('session');

    // The popup saves while the row is held.
    await saveAs(popup, 'Session N');
    // PREMISE: the save reached the storage the tab view shares.
    await expect
      .poll(() =>
        tab.evaluate(() =>
          (window.localStorage.getItem('tabContainerData') ?? '').includes(
            'Session N'
          )
        )
      )
      .toBe(true);

    // Watched for as long as the round-trip test gives a save to cross: the
    // held row keeps the list still.
    const softly = expect.configure({ soft: true });
    let nShown = 0;
    let reordered = 0;
    let samples = 0;
    const end = Date.now() + WATCH_MS;
    while (Date.now() < end) {
      samples += 1;
      const shown = await shownTitles(tab);
      if (shown.includes('Session N')) nShown += 1;
      if (shown.join(',') !== unmoved.join(',')) reordered += 1;
      await tab.waitForTimeout(50);
    }
    // A floor: a loop that took no samples leaves both counts at 0, and the
    // two checks below would pass having seen nothing.
    expect(samples, 'the mid-drag poll took no samples').toBeGreaterThan(0);
    console.log(
      `[D12] mid-drag: ${JSON.stringify({ samples, nShown, reordered })}`
    );
    await tab.screenshot({ path: testInfo.outputPath('mid-drag.png') });
    expect(await draggingKind(tab), 'the drag ended before the drop').toBe(
      'session'
    );
    softly(nShown, "samples with the popup's save on screen mid-drag").toBe(0);
    softly(reordered, 'samples with the list reordered mid-drag').toBe(0);

    await tab.mouse.up();

    // The save appears after the drop...
    await softly(
      row(tab, 'Session N'),
      'the save never appeared'
    ).toBeVisible();
    // ...and D lands beside A, where it was aimed, in the list that now holds
    // N -- not at its old index, which in the grown list is beside N. Soft,
    // so a wrong landing reports the DOM order and the painted order both.
    await softly
      .poll(async () => above(await shownTitles(tab), D.title), {
        message: 'D is not beside the row it was aimed at',
        timeout: 5_000,
      })
      .toBe(A.title);
    await softly
      .poll(async () => above(await paintedTitles(tab), D.title), {
        message: 'D is not painted beside the row it was aimed at',
        timeout: 5_000,
      })
      .toBe(A.title);
    // The popup page takes the drop in too, save included.
    await softly
      .poll(async () => shownTitles(popup), { timeout: 5_000 })
      .toEqual(['Session N', A.title, D.title, B.title, C.title]);

    console.log(
      `[D12] after the drop: ${JSON.stringify({
        tab: await shownTitles(tab),
        popup: await shownTitles(popup),
      })}`
    );
    await tab.screenshot({ path: testInfo.outputPath('after-drop.png') });
    expect(cloudRequests, 'a page reached the cloud').toEqual([]);
  });
});
