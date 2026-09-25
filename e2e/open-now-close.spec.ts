import type { BrowserContext, Locator, Page, Worker } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { grantedTest } from './fixtures/grantedExtension';
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

// Where tests 1, 2 and 4 put the window they close and reopen.
const BOUNDS = { left: 140, top: 90, width: 900, height: 640 };
// Where test 2 moves it after Open now has read it (KAN-308).
const MOVED = { left: 300, top: 200, width: 700, height: 500 };

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
async function openKyotoWindow(worker: Worker): Promise<MadeWindow> {
  const made = await openWindow(
    worker,
    ['Pin', 'Temple', 'Garden', 'Receipt'],
    BOUNDS
  );
  await worker.evaluate(async ({ windowId, tabIds }) => {
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
    await chrome.tabs.update(garden, { active: true });
    await chrome.tabGroups.update(later, { collapsed: true });
  }, made);
  return made;
}

// PREMISE: the pane lists the Kyoto window with all four tabs and both
// groups, and Garden as the tab in front, so it has read the arranged window.
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
      await expectPaneListsKyoto(page, made);
      // Lets the re-read of the last arranging event land, so the move
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

grantedTest.describe(
  'Reopen and a group formed since the close (KAN-309)',
  () => {
    grantedTest(
      '9. an ungrouped tab reopened inside a group that formed over its spot comes back ungrouped',
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
        await serviceWorker.evaluate(
          async ({ windowId, a, b }) => {
            const here = await chrome.tabs.group({
              tabIds: [a, b],
              createProperties: { windowId },
            });
            await chrome.tabGroups.update(here, { title: 'Here' });
          },
          { windowId: made.windowId, a, b }
        );
        await expect.poll(layout).toEqual(['A:Here', 'B:Here']);

        await reopenButton(page).click();
        await expect.poll(layout).toEqual(['A:Here', 'B:Here', 'X:-']);
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
    // Two waits of up to 9s each, measured at 18.2s in all: past the 30s
    // default on a slow runner.
    test.setTimeout(60_000);
    const page = await openPage(context, extensionId, VIEW_TAB, TAB_VIEWPORT);
    const made = await openWindow(serviceWorker, ['Keep', 'Drop']);
    const block = windowBlock(page, made.windowId);
    await expect(rowsIn(block)).toHaveCount(2);

    await closeTabIn(block, 'Drop').click();
    const status = page.getByRole('status');
    await expect(status).toContainText('Tab closed');

    await status.getByText('Tab closed').hover();
    // The duration under test: past the toast's 8s.
    await page.waitForTimeout(9000);
    await expect(status).toContainText('Tab closed');
    await expect(reopenButton(page)).toBeVisible();

    // Away, it resumes with the time it had left, under 8s.
    await page.mouse.move(TAB_VIEWPORT.width - 10, 10);
    await expect(status).not.toContainText('Tab closed', { timeout: 8500 });
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
