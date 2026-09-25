import type { BrowserContext, Locator, Page, Worker } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { grantedTest } from './fixtures/grantedExtension';
import { localeStrings } from './fixtures/locales';
import {
  buildContainer,
  buildSession,
  seedSessions,
  seedSettings,
} from './fixtures/seed';
import { isValidTabMasterContainer } from '../src/utils/functions/local';

// KAN-280 Part B on the real artifact: Open now's close controls, the Reopen
// toast and Save window / Save all. What jsdom cannot show: Chrome's own
// recreate (bounds, state, pins, groups, focus), the real toast under the
// pointer, the keyboard after a real close, and the accessibility tree.
//
// Not here: a tab Chrome refuses to create. Measured 2026-09-24 in this
// harness's Chromium with file access off, chrome.tabs.create({ url:
// 'file:///etc/hosts' }) resolves (pendingUrl set, url ''), and so does a
// windows.create holding that url, so there is no refusal to provoke. The
// unit tests in reopen.test.ts carry rule 10.

const TAB_VIEWPORT = { width: 1280, height: 800 };
const VIEW_TAB = 'index.html?view=tab';
const OPEN_NOW = '[data-pane="open-now"]';
const SESSIONS = '[data-pane="sessions"]';

// The Reopen toast's time on screen, REOPEN_TOAST_MS in
// src/redux/reopenOffer.ts. Not imported: that module pulls in the store,
// which Node cannot load (manifest.json needs an import attribute).
const REOPEN_TOAST_MS = 8000;

// Where tests 1, 2 and 4 put the window they close and reopen.
const BOUNDS = { left: 140, top: 90, width: 900, height: 640 };
// Where test 2 moves it after Open now has read it (KAN-308).
const MOVED = { left: 300, top: 200, width: 700, height: 500 };

async function openPage(
  context: BrowserContext,
  extensionId: string,
  path: string,
  viewport: { width: number; height: number },
  strings: Record<string, string> = localeStrings('en')
): Promise<Page> {
  const page = await context.newPage();
  await page.setViewportSize(viewport);
  await page.goto(`chrome-extension://${extensionId}/${path}`);
  // Barrier: goto resolves before React mounts. "Sort sessions" is in the
  // header of both the popup and the tab view.
  await page
    .getByRole('button', { name: strings['Sort sessions'], exact: true })
    .waitFor();
  return page;
}

const dataUrl = (title: string) => `data:text/html,<title>${title}</title>`;

// One Chrome window's block in the Open now pane.
const windowBlock = (page: Page, windowId: number): Locator =>
  page.locator(`${OPEN_NOW} [data-open-window-id="${windowId}"]`);

// A live tab row in a window's block, by the title Chrome reports.
const liveRowIn = (block: Locator, title: string): Locator =>
  block.getByRole('button', { name: `Switch to tab: ${title}`, exact: true });

const closeTabIn = (block: Locator, title: string): Locator =>
  block.getByRole('button', { name: `Close tab: ${title}`, exact: true });

const rowsIn = (block: Locator): Locator =>
  block.getByRole('button', { name: /^Switch to tab: / });

const reopenButton = (page: Page): Locator =>
  page.getByRole('status').getByRole('button', { name: 'Reopen', exact: true });

interface MadeWindow {
  windowId: number;
  tabIds: number[];
}

// A window the browser opens, unfocused so the tab view stays in front, with
// one data: tab per title, in order. Bounds only where given.
async function openWindow(
  worker: Worker,
  titles: string[],
  bounds?: typeof BOUNDS
): Promise<MadeWindow> {
  const made = await worker.evaluate(
    async ({ urls, bounds }) => {
      const win = await chrome.windows.create({
        focused: false,
        url: urls,
        ...(bounds ?? {}),
      });
      const tabIds = (win?.tabs ?? []).flatMap((tab) =>
        tab.id === undefined ? [] : [tab.id]
      );
      if (win?.id === undefined || tabIds.length !== urls.length) return null;
      return { windowId: win.id, tabIds };
    },
    { urls: titles.map(dataUrl), bounds }
  );
  if (made === null) throw new Error('Chrome gave no window or tab ids');
  return made;
}

interface GroupFacts {
  title: string;
  color: string;
  collapsed: boolean;
}

interface TabFacts {
  title: string;
  url: string;
  pinned: boolean;
  active: boolean;
  group: GroupFacts | null;
}

interface WindowFacts {
  bounds: { left?: number; top?: number; width?: number; height?: number };
  state: string;
  focused: boolean;
  tabs: TabFacts[];
}

// What Chrome says about a window, from the worker; null once it has gone.
// Groups are read only where the tabGroups permission is held.
const windowFacts = (
  worker: Worker,
  windowId: number,
  withGroups: boolean
): Promise<WindowFacts | null> =>
  worker.evaluate(
    async ({ id, withGroups }) => {
      const win = await chrome.windows
        .get(id, { populate: true })
        .catch(() => null);
      if (win === null) return null;
      const tabs: TabFacts[] = [];
      for (const tab of win.tabs ?? []) {
        const group =
          withGroups && tab.groupId !== -1
            ? await chrome.tabGroups.get(tab.groupId)
            : null;
        tabs.push({
          title: tab.title ?? '',
          url: tab.url || tab.pendingUrl || '',
          pinned: tab.pinned,
          active: tab.active,
          group: group && {
            title: group.title ?? '',
            color: group.color,
            collapsed: group.collapsed,
          },
        });
      }
      return {
        bounds: {
          left: win.left,
          top: win.top,
          width: win.width,
          height: win.height,
        },
        state: win.state ?? '',
        focused: win.focused,
        tabs,
      };
    },
    { id: windowId, withGroups }
  );

const allWindowIds = (worker: Worker): Promise<number[]> =>
  worker.evaluate(async () =>
    (await chrome.windows.getAll()).flatMap((w) =>
      w.id === undefined ? [] : [w.id]
    )
  );

// The windows open now that were not open in `before`.
async function windowsSince(
  worker: Worker,
  before: number[]
): Promise<number[]> {
  return (await allWindowIds(worker)).filter((id) => !before.includes(id));
}

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

const titlesIn = async (worker: Worker, windowId: number): Promise<string[]> =>
  (await windowFacts(worker, windowId, false))?.tabs.map((t) => t.title) ?? [];

// The four-tab window of tests 1 and 2: Pin pinned; Temple and Garden in
// "Kyoto"/blue; Receipt in "Later"/red, collapsed; Garden active.
//
// Garden's activation is the LAST arranging event, and the one change the
// pane renders (aria-current), so a pane showing Garden in front has read the
// window after every arranging event. Collapsing Later last instead left the
// final event invisible to the pane (it does not render collapse).
async function openKyotoWindow(worker: Worker): Promise<MadeWindow> {
  const made = await openWindow(
    worker,
    ['Pin', 'Temple', 'Garden', 'Receipt'],
    BOUNDS
  );
  const gardenWasActive = await worker.evaluate(
    async ({ windowId, tabIds }) => {
      const [pin, temple, garden, receipt] = tabIds;
      await chrome.tabs.update(pin, { pinned: true });
      const kyoto = await chrome.tabs.group({
        tabIds: [temple, garden],
        createProperties: { windowId },
      });
      await chrome.tabGroups.update(kyoto, { title: 'Kyoto', color: 'blue' });
      const later = await chrome.tabs.group({
        tabIds: [receipt],
        createProperties: { windowId },
      });
      await chrome.tabGroups.update(later, { title: 'Later', color: 'red' });
      await chrome.tabGroups.update(later, { collapsed: true });
      const wasActive = (await chrome.tabs.get(garden)).active;
      await chrome.tabs.update(garden, { active: true });
      return wasActive;
    },
    made
  );
  // PREMISE: the activation is a change, so the pane cannot have shown
  // Garden in front before it.
  if (gardenWasActive) throw new Error('Garden was already the active tab');
  return made;
}

// PREMISE: the pane lists the Kyoto window with all four tabs and both
// groups, and Garden as the tab in front, so it has read the arranged window
// (Garden's activation is the last arranging event, see openKyotoWindow).
async function expectPaneListsKyoto(page: Page, made: MadeWindow) {
  const block = windowBlock(page, made.windowId);
  await expect(rowsIn(block)).toHaveCount(4);
  await expect(block.getByRole('group', { name: 'Kyoto' })).toBeVisible();
  await expect(block.getByRole('group', { name: 'Later' })).toBeVisible();
  await expect(liveRowIn(block, 'Garden')).toHaveAttribute(
    'aria-current',
    'true'
  );
}

const KYOTO_TABS: TabFacts[] = [
  {
    title: 'Pin',
    url: dataUrl('Pin'),
    pinned: true,
    active: false,
    group: null,
  },
  {
    title: 'Temple',
    url: dataUrl('Temple'),
    pinned: false,
    active: false,
    group: { title: 'Kyoto', color: 'blue', collapsed: false },
  },
  {
    title: 'Garden',
    url: dataUrl('Garden'),
    pinned: false,
    active: true,
    group: { title: 'Kyoto', color: 'blue', collapsed: false },
  },
  {
    title: 'Receipt',
    url: dataUrl('Receipt'),
    pinned: false,
    active: false,
    group: { title: 'Later', color: 'red', collapsed: true },
  },
];

// Closes the Kyoto window from Open now, presses Reopen, and returns the id
// of the one window that came back. Shared by tests 1 and 2.
async function closeAndReopenKyoto(
  page: Page,
  worker: Worker,
  made: MadeWindow
): Promise<number> {
  const block = windowBlock(page, made.windowId);
  await expectPaneListsKyoto(page, made);

  await block
    .getByRole('button', { name: /^Close window: Window \d+$/ })
    .click();
  await expect
    .poll(async () => (await allWindowIds(worker)).includes(made.windowId))
    .toBe(false);
  await expect(page.getByRole('status')).toContainText(
    'Window closed (4 tabs)'
  );

  const before = await allWindowIds(worker);
  await reopenButton(page).click();
  await expect.poll(() => windowsSince(worker, before)).toHaveLength(1);
  const [reopenedId] = await windowsSince(worker, before);
  return reopenedId;
}

grantedTest.describe('Close and Reopen a window (KAN-280 O8)', () => {
  grantedTest.use({ keepWindowBounds: true });

  grantedTest(
    '1. a closed window comes back exactly, and Tab Keeper stays in front',
    async ({ context, extensionId, serviceWorker }) => {
      const page = await openPage(context, extensionId, VIEW_TAB, TAB_VIEWPORT);
      const tabView = await tabViewIds(page);
      const made = await openKyotoWindow(serviceWorker);

      // PREMISE: Chrome made the window as asked, so a match after Reopen
      // is the recreate's doing and not the window's defaults.
      await expect
        .poll(() => windowFacts(serviceWorker, made.windowId, true))
        .toEqual({
          bounds: BOUNDS,
          state: 'normal',
          focused: false,
          tabs: KYOTO_TABS,
        });
      // PREMISE: the tab view's window is the one in front.
      expect((await inFront(serviceWorker)).windowId).toBe(tabView.windowId);

      const reopenedId = await closeAndReopenKyoto(page, serviceWorker, made);
      // Same bounds, titles in order, pins, groups, active tab, and no
      // new-tab page (the list holds exactly the four). Polled: Chrome
      // settles the recreate a call at a time.
      await expect
        .poll(() => windowFacts(serviceWorker, reopenedId, true))
        .toEqual({
          bounds: BOUNDS,
          state: 'normal',
          focused: false,
          tabs: KYOTO_TABS,
        });
      // Rule 5: Tab Keeper's window stays in front.
      expect(await inFront(serviceWorker)).toEqual({
        windowId: tabView.windowId,
        activeTabId: tabView.tabId,
      });
    }
  );

  grantedTest(
    '2. a window moved (and, headed, maximized) after the pane read comes back where it was when it closed (KAN-308)',
    async ({ context, extensionId, serviceWorker, headless }) => {
      const page = await openPage(context, extensionId, VIEW_TAB, TAB_VIEWPORT);
      const tabView = await tabViewIds(page);
      const made = await openKyotoWindow(serviceWorker);
      // Read barrier: Garden in front is the last arranging event, so the
      // pane has read the window after it.
      await expectPaneListsKyoto(page, made);
      // And lets any re-read still coalescing behind it land, so the move
      // below comes after the pane's last read of this window.
      await page.waitForTimeout(500);

      // KAN-308: a move and a maximize fire no event Open now re-reads on,
      // so the snapshot the close is handed still holds BOUNDS, 'normal'.
      //
      // Maximize is headed only. Measured 2026-09-24: headless Chromium
      // maximizes a 900x640 window (it reads back 'maximized', 0,0
      // 1920x1080), but a window CREATED at those bounds reads 'normal', and
      // windows.update({ state: 'maximized' }) leaves it 'normal'. The
      // recreate creates the window at the bounds it closed with, which for
      // a maximized window are the whole screen, so headless can never show
      // the state coming back. Headed Chrome (macOS) reads such a window as
      // 'maximized'. Run headed:
      // npx playwright test e2e/open-now-close.spec.ts -g KAN-308 --headed
      await serviceWorker.evaluate(
        async ({ windowId, moved, maximize }) => {
          await chrome.windows.update(windowId, moved);
          if (maximize) {
            await chrome.windows.update(windowId, { state: 'maximized' });
          }
        },
        { windowId: made.windowId, moved: MOVED, maximize: !headless }
      );
      const placeOf = async (windowId: number) => {
        const facts = await windowFacts(serviceWorker, windowId, true);
        return (
          facts && {
            bounds: facts.bounds,
            state: facts.state,
            focused: facts.focused,
          }
        );
      };
      // PREMISE: Chrome moved (and, headed, maximized) the window, and it
      // is not in front.
      const expectedState = headless ? 'normal' : 'maximized';
      await expect
        .poll(async () => (await placeOf(made.windowId))?.state)
        .toBe(expectedState);
      const placeAtClose = await placeOf(made.windowId);
      expect(placeAtClose).toMatchObject({ focused: false });
      if (headless) expect(placeAtClose?.bounds).toEqual(MOVED);
      expect((await inFront(serviceWorker)).windowId).toBe(tabView.windowId);

      const reopenedId = await closeAndReopenKyoto(page, serviceWorker, made);
      // Where it was when it closed, not where the pane last read it.
      // windows.update({ state }) runs last, on a window created unfocused.
      await expect
        .poll(async () => {
          const facts = await windowFacts(serviceWorker, reopenedId, true);
          return (
            facts && {
              bounds: facts.bounds,
              state: facts.state,
              focused: facts.focused,
              tabs: facts.tabs,
            }
          );
        })
        .toEqual({ ...placeAtClose, tabs: KYOTO_TABS });
      // Rule 5: the recreate did not bring the window forward.
      expect(await inFront(serviceWorker)).toEqual({
        windowId: tabView.windowId,
        activeTabId: tabView.tabId,
      });
    }
  );

  grantedTest(
    "4. a window's last tab: the window comes back around it",
    async ({ context, extensionId, serviceWorker }) => {
      const page = await openPage(context, extensionId, VIEW_TAB, TAB_VIEWPORT);
      const made = await openWindow(serviceWorker, ['Solo'], BOUNDS);
      // PREMISE: the window is where it was asked to be, and holds one tab.
      await expect
        .poll(async () => {
          const facts = await windowFacts(serviceWorker, made.windowId, false);
          return (
            facts && {
              bounds: facts.bounds,
              titles: facts.tabs.map((t) => t.title),
            }
          );
        })
        .toEqual({ bounds: BOUNDS, titles: ['Solo'] });
      const block = windowBlock(page, made.windowId);
      await expect(rowsIn(block)).toHaveCount(1);

      await closeTabIn(block, 'Solo').click();
      // Chrome closes a window with its last tab.
      await expect
        .poll(async () =>
          (await allWindowIds(serviceWorker)).includes(made.windowId)
        )
        .toBe(false);
      await expect(page.getByRole('status')).toContainText('Tab closed');

      const before = await allWindowIds(serviceWorker);
      await reopenButton(page).click();
      await expect
        .poll(() => windowsSince(serviceWorker, before))
        .toHaveLength(1);
      const [reopenedId] = await windowsSince(serviceWorker, before);
      await expect
        .poll(async () => {
          const facts = await windowFacts(serviceWorker, reopenedId, false);
          return (
            facts && {
              bounds: facts.bounds,
              titles: facts.tabs.map((t) => t.title),
            }
          );
        })
        .toEqual({ bounds: BOUNDS, titles: ['Solo'] });
      // One window, not one per attempt.
      expect(await windowsSince(serviceWorker, before)).toHaveLength(1);
    }
  );
});

// What Chrome reported about a tab's group while a Reopen ran: the group a
// created tab was put in, then each change of it. Test 10's recorder keeps
// these on the service worker's global, under this name.
const GROUP_STEPS = 'kan309GroupSteps';

interface GroupStep {
  tabId: number;
  event: 'created' | 'updated';
  groupId: number;
}

const isGroupSteps = (value: unknown): value is GroupStep[] =>
  Array.isArray(value) &&
  value.every(
    (step: unknown) =>
      typeof step === 'object' &&
      step !== null &&
      'tabId' in step &&
      typeof step.tabId === 'number' &&
      'event' in step &&
      (step.event === 'created' || step.event === 'updated') &&
      'groupId' in step &&
      typeof step.groupId === 'number'
  );

grantedTest.describe(
  'Reopen and a group formed since the close (KAN-309)',
  () => {
    grantedTest(
      '10. an ungrouped tab reopened inside a group that formed over its spot comes back ungrouped',
      async ({ context, extensionId, serviceWorker }) => {
        const page = await openPage(
          context,
          extensionId,
          VIEW_TAB,
          TAB_VIEWPORT
        );
        const made = await openWindow(serviceWorker, ['A', 'X', 'B']);
        const [a, , b] = made.tabIds;
        const block = windowBlock(page, made.windowId);
        await expect(rowsIn(block)).toHaveCount(3);
        const layout = async () =>
          (await windowFacts(serviceWorker, made.windowId, true))?.tabs.map(
            (t) => `${t.title}:${t.group?.title ?? '-'}`
          );
        // PREMISE: X is ungrouped, at index 1.
        await expect.poll(layout).toEqual(['A:-', 'X:-', 'B:-']);

        await closeTabIn(block, 'X').click();
        await expect.poll(layout).toEqual(['A:-', 'B:-']);
        await expect(page.getByRole('status')).toContainText('Tab closed');
        // A and B grouped after the close: X's old index is now inside the
        // group's run, where Chrome puts a created tab into the group.
        const here = await serviceWorker.evaluate(
          async ({ windowId, a, b }) => {
            const group = await chrome.tabs.group({
              tabIds: [a, b],
              createProperties: { windowId },
            });
            await chrome.tabGroups.update(group, { title: 'Here' });
            return group;
          },
          { windowId: made.windowId, a, b }
        );
        await expect.poll(layout).toEqual(['A:Here', 'B:Here']);

        // Records every tab's group from here on, so the pass below can show
        // X was created inside the run and taken out, not created at the end
        // (where it would never have joined Here, and would pass as well).
        await serviceWorker.evaluate((key: string) => {
          const steps: {
            tabId: number;
            event: 'created' | 'updated';
            groupId: number;
          }[] = [];
          Reflect.set(globalThis, key, steps);
          chrome.tabs.onCreated.addListener((tab) => {
            steps.push({
              tabId: tab.id ?? -1,
              event: 'created',
              groupId: tab.groupId,
            });
          });
          chrome.tabs.onUpdated.addListener((tabId, change) => {
            if (change.groupId === undefined) return;
            steps.push({ tabId, event: 'updated', groupId: change.groupId });
          });
        }, GROUP_STEPS);

        await reopenButton(page).click();
        await expect.poll(layout).toEqual(['A:Here', 'B:Here', 'X:-']);

        const x = await serviceWorker.evaluate(
          async ({ windowId }) =>
            (await chrome.tabs.query({ windowId })).find((t) => t.title === 'X')
              ?.id,
          { windowId: made.windowId }
        );
        const recorded: unknown = await serviceWorker.evaluate(
          (key: string): unknown => Reflect.get(globalThis, key),
          GROUP_STEPS
        );
        if (!isGroupSteps(recorded)) throw new Error('no group steps recorded');
        // X was created inside Here, then taken out of it.
        expect(
          recorded
            .filter((step) => step.tabId === x)
            .map(({ event, groupId }) => ({ event, groupId }))
        ).toEqual([
          { event: 'created', groupId: here },
          { event: 'updated', groupId: -1 },
        ]);
      }
    );
  }
);

test.describe('Open now close controls in a real browser (KAN-280)', () => {
  test('3. a closed tab comes back in place', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const page = await openPage(context, extensionId, VIEW_TAB, TAB_VIEWPORT);
    const made = await openWindow(serviceWorker, ['Alpha', 'Beta', 'Gamma']);
    const block = windowBlock(page, made.windowId);
    await expect(rowsIn(block)).toHaveCount(3);
    const facts = () => windowFacts(serviceWorker, made.windowId, false);
    const shape = async () =>
      (await facts())?.tabs.map((t) => ({ title: t.title, active: t.active }));
    const ARRANGED = [
      { title: 'Alpha', active: true },
      { title: 'Beta', active: false },
      { title: 'Gamma', active: false },
    ];
    // PREMISE: Beta is at index 1, and Alpha is the active tab.
    await expect.poll(shape).toEqual(ARRANGED);

    await closeTabIn(block, 'Beta').click();
    await expect.poll(shape).toEqual([
      { title: 'Alpha', active: true },
      { title: 'Gamma', active: false },
    ]);
    await expect(liveRowIn(block, 'Beta')).toHaveCount(0);
    await expect(page.getByRole('status')).toContainText('Tab closed');

    await reopenButton(page).click();
    // Back at index 1, in the same window, and Alpha is still active.
    await expect.poll(shape).toEqual(ARRANGED);
    await expect(liveRowIn(block, 'Beta')).toBeVisible();
  });

  test('5. This window has no Close window, in the real accessibility tree', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const page = await openPage(context, extensionId, VIEW_TAB, TAB_VIEWPORT);
    const tabView = await tabViewIds(page);
    const other = await openWindow(serviceWorker, ['Elsewhere']);
    const thisBlock = windowBlock(page, tabView.windowId);
    const otherBlock = windowBlock(page, other.windowId);
    // PREMISE: This window is listed (the profile's first tab shares it
    // with the tab view), and marked as such.
    await expect(
      thisBlock.getByText('This window', { exact: true })
    ).toBeVisible();
    await expect(rowsIn(otherBlock)).toHaveCount(1);

    const windowName = async (block: Locator): Promise<string> => {
      const label = await block
        .getByRole('button', { name: /^Save window as a session: / })
        .getAttribute('aria-label');
      const name = label?.replace('Save window as a session: ', '');
      if (!name) throw new Error('the block has no Save window control');
      return name;
    };
    const thisName = await windowName(thisBlock);
    const otherName = await windowName(otherBlock);
    expect(thisName).not.toBe(otherName);

    // Chrome's own tree, not Playwright's role engine.
    const cdp = await context.newCDPSession(page);
    const { nodes } = await cdp.send('Accessibility.getFullAXTree');
    const buttons = nodes
      .filter((node) => !node.ignored && node.role?.value === 'button')
      .map((node) => String(node.name?.value ?? ''));
    // CONTROL: the same query finds the other window's Close window, and
    // This window's Save window, so an absence below is not a blind query.
    expect(buttons).toContain(`Close window: ${otherName}`);
    expect(buttons).toContain(`Save window as a session: ${thisName}`);
    expect(buttons).not.toContain(`Close window: ${thisName}`);

    // And by the locator shape a user's tool would use.
    await expect(
      otherBlock.getByRole('button', { name: /^Close window: / })
    ).toHaveCount(1);
    await expect(
      thisBlock.getByRole('button', { name: /^Close window: / })
    ).toHaveCount(0);
  });

  test('6. the toast is a status region, and waits while hovered', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    // Waits of 4s, 9s and up to 5s, about 18s in all: past the 30s default
    // on a slow runner.
    test.setTimeout(60_000);
    const page = await openPage(context, extensionId, VIEW_TAB, TAB_VIEWPORT);
    const made = await openWindow(serviceWorker, ['Keep', 'Drop']);
    const block = windowBlock(page, made.windowId);
    await expect(rowsIn(block)).toHaveCount(2);

    await closeTabIn(block, 'Drop').click();
    const status = page.getByRole('status');
    await expect(status).toContainText('Tab closed');
    // The toast was up by now, so at least this much of its 8s has gone by
    // the time the pointer arrives.
    const seenAt = Date.now();

    // Half its time spent before the hover, so a timer that restarted the
    // full 8s on leaving would show as twice the time left.
    await page.waitForTimeout(4000);
    const spent = Date.now() - seenAt;
    await status.getByText('Tab closed').hover();
    // The duration under test: past the toast's 8s.
    await page.waitForTimeout(9000);
    await expect(status).toContainText('Tab closed');
    await expect(reopenButton(page)).toBeVisible();

    // Away, it resumes with the time it had left: at most 8s less what was
    // spent before the hover (about 4s), where a restart would take 8s. The
    // 1s on top is for the poll and the pointer's own travel.
    await page.mouse.move(TAB_VIEWPORT.width - 10, 10);
    const timeLeft = REOPEN_TOAST_MS - spent;
    await expect(status).not.toContainText('Tab closed', {
      timeout: timeLeft + 1000,
    });
    await expect(reopenButton(page)).toHaveCount(0);
  });

  test('7. keyboard: a close lands focus on the next ×, and a held Enter closes one tab', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const page = await openPage(context, extensionId, VIEW_TAB, TAB_VIEWPORT);
    const tabView = await tabViewIds(page);
    const first = await openWindow(serviceWorker, ['A', 'B', 'C']);
    const block = windowBlock(page, first.windowId);
    await expect(rowsIn(block)).toHaveCount(3);

    // How visible the focused element is: its own opacity times every
    // ancestor's, so a hidden strip counts.
    const focusedOpacity = () =>
      page.evaluate(() => {
        let opacity = 1;
        for (
          let node: Element | null = document.activeElement;
          node !== null;
          node = node.parentElement
        ) {
          opacity *= parseFloat(getComputedStyle(node).opacity);
        }
        return opacity;
      });
    const opacityOf = (locator: Locator) =>
      locator.evaluate((el: Element) => {
        let opacity = 1;
        for (
          let node: Element | null = el;
          node !== null;
          node = node.parentElement
        ) {
          opacity *= parseFloat(getComputedStyle(node).opacity);
        }
        return opacity;
      });

    // CONTROL: at rest, with the pointer away, B's × is hidden, so the
    // opacity reads below can see a hidden control.
    await page.mouse.move(0, 0);
    await expect.poll(() => opacityOf(closeTabIn(block, 'B'))).toBe(0);

    await liveRowIn(block, 'B').focus();
    await page.keyboard.press('Tab');
    await expect(closeTabIn(block, 'B')).toBeFocused();
    await expect.poll(focusedOpacity).toBe(1);

    await page.keyboard.press('Enter');
    await expect
      .poll(() => titlesIn(serviceWorker, first.windowId))
      .toEqual(['A', 'C']);
    await expect(closeTabIn(block, 'C')).toBeFocused();
    await expect.poll(focusedOpacity).toBe(1);

    await page.keyboard.press('Enter');
    await expect
      .poll(() => titlesIn(serviceWorker, first.windowId))
      .toEqual(['A']);
    // Nothing switched away: the tab view is still the tab in front.
    expect(await inFront(serviceWorker)).toEqual({
      windowId: tabView.windowId,
      activeTabId: tabView.tabId,
    });

    // A held Enter. Playwright does not auto-repeat, but a second down
    // before the up is sent with repeat: true.
    const second = await openWindow(serviceWorker, ['A', 'B', 'C']);
    const heldBlock = windowBlock(page, second.windowId);
    await expect(rowsIn(heldBlock)).toHaveCount(3);
    await page.evaluate(() => {
      const seen: { key: string; repeat: boolean }[] = [];
      document.documentElement.dataset.keysSeen = '[]';
      window.addEventListener(
        'keydown',
        (event) => {
          seen.push({ key: event.key, repeat: event.repeat });
          document.documentElement.dataset.keysSeen = JSON.stringify(seen);
        },
        { capture: true }
      );
    });
    const keysSeen = () =>
      page.evaluate(() => document.documentElement.dataset.keysSeen ?? '');

    await closeTabIn(heldBlock, 'A').focus();
    await page.keyboard.down('Enter');
    await expect(liveRowIn(heldBlock, 'A')).toHaveCount(0);
    await expect(closeTabIn(heldBlock, 'B')).toBeFocused();
    await page.keyboard.down('Enter');
    await page.keyboard.up('Enter');
    // CONTROL: the second down reached the page as a repeat.
    expect(JSON.parse(await keysSeen())).toEqual([
      { key: 'Enter', repeat: false },
      { key: 'Enter', repeat: true },
    ]);
    // Give a wrongly-handled repeat time to close B, then: only A closed.
    await page.waitForTimeout(500);
    expect(await titlesIn(serviceWorker, second.windowId)).toEqual(['B', 'C']);
    await expect(liveRowIn(heldBlock, 'B')).toBeVisible();
  });

  test('8. Save window and Save all save what Open now lists, named as the name box would', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const page = await openPage(context, extensionId, VIEW_TAB, TAB_VIEWPORT);
    const tabView = await tabViewIds(page);
    // This window holds the tab view and Notes alone, so Save all's name
    // comes from Notes.
    await serviceWorker.evaluate(
      async ({ windowId, keep, url }) => {
        const tabs = await chrome.tabs.query({ windowId });
        const others = tabs.flatMap((t) =>
          t.id === undefined || t.id === keep ? [] : [t.id]
        );
        await chrome.tabs.create({ windowId, url, active: false });
        if (others.length > 0) await chrome.tabs.remove(others);
      },
      { windowId: tabView.windowId, keep: tabView.tabId, url: dataUrl('Notes') }
    );
    // The other window's most recently used tab carries an unread count,
    // which the name drops (rule 1).
    const other = await openWindow(serviceWorker, ['Drafts', '(3) Inbox']);
    // As Chrome reports them: it may encode the space in the address.
    const otherUrls = async () =>
      (await windowFacts(serviceWorker, other.windowId, false))?.tabs.map(
        (t) => t.url
      ) ?? [];
    await serviceWorker.evaluate(
      (id: number) => chrome.tabs.update(id, { active: true }),
      other.tabIds[1]
    );
    const thisBlock = windowBlock(page, tabView.windowId);
    const otherBlock = windowBlock(page, other.windowId);
    await expect(rowsIn(thisBlock)).toHaveCount(1);
    await expect(liveRowIn(thisBlock, 'Notes')).toBeVisible();
    await expect(rowsIn(otherBlock)).toHaveCount(2);

    const sessionRow = (name: string) =>
      page.locator(SESSIONS).getByRole('button', { name, exact: true });
    const stored = async () => {
      const raw = await page.evaluate(() =>
        localStorage.getItem('tabContainerData')
      );
      const parsed: unknown = JSON.parse(raw ?? 'null');
      if (!isValidTabMasterContainer(parsed)) return [];
      return parsed.tabGroups.map((session) => ({
        title: session.title,
        windowCount: session.windowCount,
        tabCount: session.tabCount,
        urls: session.windows.flatMap((w) => w.tabs.map((t) => t.url)),
      }));
    };

    await otherBlock
      .getByRole('button', { name: /^Save window as a session: / })
      .click();
    await expect(page.getByRole('status')).toContainText(
      'Window saved as a session.'
    );
    await expect(sessionRow('Inbox')).toContainText('1 Window · 2 Tabs');

    await page
      .locator(OPEN_NOW)
      .getByRole('button', { name: 'Save all open windows as a session' })
      .click();
    await expect(page.getByRole('status')).toContainText(
      'All open windows saved as a session.'
    );
    await expect(sessionRow('Notes')).toContainText('2 Windows · 3 Tabs');

    const [drafts, inbox] = await otherUrls();
    const notes = (
      await windowFacts(serviceWorker, tabView.windowId, false)
    )?.tabs
      .map((t) => t.url)
      .find((u) => u.startsWith('data:'));
    await expect
      .poll(async () =>
        (await stored()).filter((s) => ['Inbox', 'Notes'].includes(s.title))
      )
      .toEqual(
        expect.arrayContaining([
          {
            title: 'Inbox',
            windowCount: 1,
            tabCount: 2,
            urls: [drafts, inbox],
          },
          {
            title: 'Notes',
            windowCount: 2,
            tabCount: 3,
            // This window first; the tab view itself is not saved.
            urls: [notes, drafts, inbox],
          },
        ])
      );
    const everyUrl = (await stored()).flatMap((s) => s.urls);
    // CONTROL: the tab view really was in This window when it was saved.
    expect(
      await serviceWorker.evaluate(
        async (windowId: number) =>
          (await chrome.tabs.query({ windowId })).map((t) => t.url ?? ''),
        tabView.windowId
      )
    ).toContainEqual(expect.stringMatching(/^chrome-extension:\/\//));
    expect(everyUrl.filter((u) => u.startsWith('chrome-extension://'))).toEqual(
      []
    );
  });
});

// KAN-280 O8b. At a fixed 300px, "Window closed (5 tabs)" lost its count
// behind the longer translations of "Reopen" in 8 of 13 locales. A toast
// offering Reopen is as wide as its one line, from 300 to 460px; a plain toast
// stays 300px. ru, de and ja have the widest lines.
test.describe('The Reopen toast is as wide as its line (KAN-280 O8b)', () => {
  const toastIn = (page: Page): Locator =>
    page.getByRole('status').locator('> div');

  // The width a toast would have if it were sized to its whole line, however
  // it is actually sized: a hidden copy on one line, beside it so it takes
  // the same font.
  const oneLineWidth = async (toast: Locator): Promise<number> => {
    const width = await toast.evaluate((el: Element) => {
      const copy = el.cloneNode(true);
      if (!(copy instanceof HTMLElement) || el.parentElement === null) {
        return null;
      }
      copy.style.cssText =
        'width: max-content; min-width: 0; max-width: none; white-space: nowrap; visibility: hidden';
      el.parentElement.append(copy);
      const oneLine = copy.getBoundingClientRect().width;
      copy.remove();
      return oneLine;
    });
    if (width === null) throw new Error('the toast could not be copied');
    return width;
  };

  for (const lang of ['ru', 'de', 'ja']) {
    test(`11. ${lang}: "Window closed (5 tabs)" shows whole, in a toast 300 to 460px wide`, async ({
      context,
      extensionId,
      serviceWorker,
    }) => {
      const strings = localeStrings(lang);
      await seedSettings(context, { language: lang });
      const page = await openPage(
        context,
        extensionId,
        VIEW_TAB,
        TAB_VIEWPORT,
        strings
      );
      // CONTROL: the page is in the seeded language, so the line measured
      // below is its translation and not en's.
      await expect(page.locator('html')).toHaveAttribute('lang', lang);

      const made = await openWindow(serviceWorker, [
        'One',
        'Two',
        'Three',
        'Four',
        'Five',
      ]);
      const block = windowBlock(page, made.windowId);
      await expect(
        block.getByRole('button', { name: `${strings['Switch to tab']}: ` })
      ).toHaveCount(5);
      await block
        .getByRole('button', { name: `${strings['Close window']}: ` })
        .click();

      const plural = new Intl.PluralRules(lang).select(5);
      const message = strings[`WindowClosed_${plural}`].replace(
        '{{count}}',
        '5'
      );
      const toast = toastIn(page);
      await expect(toast).toContainText(message);
      const reopen = toast.getByRole('button', {
        name: strings.Reopen,
        exact: true,
      });
      await expect(reopen).toBeVisible();

      const line = toast.locator('> span');
      const measured = await line.evaluate((span: HTMLElement) => ({
        text: span.innerText,
        scrollWidth: span.scrollWidth,
        clientWidth: span.clientWidth,
        right: span.getBoundingClientRect().right,
      }));
      const toastBox = await toast.boundingBox();
      const reopenBox = await reopen.boundingBox();
      if (toastBox === null || reopenBox === null) {
        throw new Error('the toast or its Reopen button has no box');
      }
      // The whole line, count included, and none of it cut off: an ellipsis
      // leaves innerText whole, so the widths are what show a cut.
      expect(measured.text).toBe(message);
      expect(measured.text).toContain('5');
      expect(measured.scrollWidth).toBeLessThanOrEqual(measured.clientWidth);
      // Nor hidden under the button.
      expect(measured.right).toBeLessThanOrEqual(reopenBox.x);
      expect(toastBox.width).toBeGreaterThanOrEqual(300);
      expect(toastBox.width).toBeLessThanOrEqual(460);
    });
  }

  test('12. CONTROL: a plain toast stays 300px, even when its message wraps', async ({
    context,
    extensionId,
  }) => {
    // Out of name order, so sorting by name moves them and says so.
    await seedSessions(
      context,
      buildContainer([
        buildSession({ tabGroupId: 'zeta', title: 'Zeta' }),
        buildSession({ tabGroupId: 'alpha', title: 'Alpha' }),
      ])
    );
    const page = await openPage(context, extensionId, VIEW_TAB, TAB_VIEWPORT);
    await page
      .getByRole('button', { name: 'Sort sessions', exact: true })
      .click();
    await page.getByRole('menuitemradio', { name: 'Name' }).click();

    const toast = toastIn(page);
    await expect(toast).toHaveText(
      'Sessions reordered. Undo to restore the previous order.'
    );
    // PREMISE: the message is longer than a 300px line, so a toast sized to
    // its content would be wider than 300px.
    expect(await oneLineWidth(toast)).toBeGreaterThan(300);
    const box = await toast.boundingBox();
    expect(box?.width).toBe(300);
  });

  // Off the happy path: a window narrower than the line. The cap is the
  // window less the toast's 20px each side, so the toast stays inside it,
  // Reopen stays whole, and the message ellipses as a last resort.
  test('13. ja in a 400px window: the toast stays inside it, Reopen whole, and the line ellipses', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const strings = localeStrings('ja');
    // Side by side, so Open now is the rail's drawer rather than a folded
    // column squeezed to the right of the sessions.
    await seedSettings(context, {
      language: 'ja',
      foldSavedSessionInTabView: false,
    });
    const viewport = { width: 400, height: 700 };
    const page = await openPage(
      context,
      extensionId,
      VIEW_TAB,
      viewport,
      strings
    );
    await expect(page.locator('html')).toHaveAttribute('lang', 'ja');
    const made = await openWindow(serviceWorker, [
      'One',
      'Two',
      'Three',
      'Four',
      'Five',
    ]);
    // Below 1100px Open now is a drawer behind a rail button.
    await page
      .getByRole('button', { name: new RegExp(`^${strings['Open now']}`) })
      .click();
    const block = windowBlock(page, made.windowId);
    await expect(
      block.getByRole('button', { name: `${strings['Switch to tab']}: ` })
    ).toHaveCount(5);
    await block
      .getByRole('button', { name: `${strings['Close window']}: ` })
      .click();

    const toast = toastIn(page);
    const reopen = toast.getByRole('button', {
      name: strings.Reopen,
      exact: true,
    });
    await expect(reopen).toBeVisible();
    const toastBox = await toast.boundingBox();
    const reopenBox = await reopen.boundingBox();
    if (toastBox === null || reopenBox === null) {
      throw new Error('the toast or its Reopen button has no box');
    }
    // PREMISE: the whole line is wider than the window less 20px each side,
    // so this is the last resort and not the 300-460px case above.
    expect(await oneLineWidth(toast)).toBeGreaterThan(viewport.width - 40);
    expect(toastBox.x).toBe(20);
    expect(toastBox.x + toastBox.width).toBeLessThanOrEqual(
      viewport.width - 20
    );
    expect(reopenBox.x).toBeGreaterThanOrEqual(toastBox.x);
    expect(reopenBox.x + reopenBox.width).toBeLessThanOrEqual(
      toastBox.x + toastBox.width
    );
    // The message gives way, not the button.
    const line = await toast
      .locator('> span')
      .evaluate((span: HTMLElement) => ({
        scrollWidth: span.scrollWidth,
        clientWidth: span.clientWidth,
      }));
    expect(line.scrollWidth).toBeGreaterThan(line.clientWidth);
  });
});
