import type { Locator, Page, Worker } from '@playwright/test';

import { expect, grantedTest as test } from './fixtures/grantedExtension';
import { openTabView, session, tab, win } from './fixtures/betweenSessions';
import { standIn } from './fixtures/standInPages';
import {
  carryTo,
  dataUrl,
  liveRow,
  openLiveWindow,
  strip,
  topOf,
} from './fixtures/liveWindows';
import {
  boxOf,
  groupHandle,
  pickUp,
  tabHandle,
  windowHandle,
} from './fixtures/sessionDrag';
import type {
  tabContainerData,
  tabData,
} from '../src/redux/slices/tabContainerDataStateSlice';

// KAN-893 on the real artifact: ⌘Z in Tab Keeper takes back a saved tab, pair,
// group or window dropped into Currently open (the tabs it opened close), and
// ⌘⇧Z opens it again. A step whose tabs changed refuses with a toast and
// leaves the history. Live tabs are data: pages in a window the worker opens
// unfocused; the tab view is side by side (1280x800).

const OPEN_NOW = '[data-pane="open-now"]';
const LAST_BOX = '[data-new-window-target="open-now-last"]';
const PLACEHOLDER = 'data:text/html;base64,';
const SETTLE = { timeout: 15_000 };
const REFUSED = "Couldn't undo the drop. Those tabs changed or closed since.";

// S1 w1: s0 (pinned), s1, s2, then group "Day trips" (g0, g1), then the pair h1|h2.
const PINNED: tabData = { ...tab('s0'), pinned: true };
const half = (id: string): tabData => ({ ...tab(id), splitId: 'sp' });
const SAVED = (): tabContainerData =>
  session('S1', 'Trip', [
    win(
      'w1',
      [
        PINNED,
        tab('s1'),
        tab('s2'),
        tab('g0', 'day'),
        tab('g1', 'day'),
        half('h1'),
        half('h2'),
      ],
      [{ groupId: 'day', title: 'Day trips', color: 'green' }]
    ),
  ]);

const toasts = (page: Page): Locator =>
  page.locator('[role="status"] > [data-toast]:not([aria-hidden="true"])');

const undoKey = (page: Page) => page.keyboard.press('ControlOrMeta+z');
const redoKey = (page: Page) => page.keyboard.press('ControlOrMeta+Shift+z');

async function middleOf(el: Locator) {
  const b = await boxOf(el);
  return { x: b.x + Math.min(80, b.width / 2), y: b.y + b.height / 2 };
}

async function setUp(
  context: Parameters<typeof openTabView>[0],
  extensionId: string,
  settings: Record<string, unknown> = {}
) {
  const view = await openTabView(
    context,
    extensionId,
    false,
    [SAVED()],
    undefined,
    settings
  );
  await expect(tabHandle(view, 's2')).toBeVisible();
  return view;
}

// A strip's addresses, a placeholder named as one.
const addresses = async (worker: Worker, windowId: number) =>
  (await strip(worker, windowId)).map((t) =>
    t.url.startsWith(PLACEHOLDER) ? 'placeholder' : t.url
  );

const windowIds = (worker: Worker) =>
  worker.evaluate(async () =>
    (await chrome.windows.getAll({ windowTypes: ['normal'] })).map(
      (w) => w.id ?? -1
    )
  );

// Lets s2 go at the top of live row `title`; waits for it there.
async function dropS2(
  page: Page,
  worker: Worker,
  windowId: number,
  rowId: number
) {
  await pickUp(page, tabHandle(page, 's2'));
  await carryTo(page, await topOf(liveRow(page, rowId)));
  await page.mouse.up();
  await landed(page, worker, windowId, 'https://s2.test/');
}

// Polled: a tab's address is briefly "" as its first load commits, so one read can miss it.
const idOfUrl = async (worker: Worker, windowId: number, url: string) => {
  let id: number | undefined;
  await expect
    .poll(async () => {
      id = (await strip(worker, windowId)).find((t) => t.url === url)?.id;
      return id;
    }, SETTLE)
    .toBeDefined();
  if (id === undefined) throw new Error(`no tab at ${url}`);
  return id;
};

// The drop's step is kept once its moves end, and Open now draws the copy only
// then: the copy's row on screen is the barrier before a ⌘Z.
async function landed(
  page: Page,
  worker: Worker,
  windowId: number,
  url: string
) {
  await expect.poll(() => addresses(worker, windowId), SETTLE).toContain(url);
  const id = await idOfUrl(worker, windowId, url);
  await expect(liveRow(page, id)).toBeVisible(SETTLE);
  return id;
}

// A New window drop's step waits on the worker's answer; the header's Undo lights with it.
const undoLit = (page: Page) =>
  expect(
    page.locator('[role="button"][aria-label="Undo"]')
  ).not.toHaveAttribute('aria-disabled', 'true', SETTLE);

test.describe('undo and redo of a drop into Currently open', () => {
  test('a tab at a slot: ⌘Z closes it, the other tabs as they were; ⌘⇧Z opens it there again', async ({
    context,
    extensionId,
    serviceWorker: worker,
  }) => {
    const live = await openLiveWindow(worker, ['A', 'B', 'C']);
    const page = await setUp(context, extensionId);
    await expect(liveRow(page, live.idOf('C'))).toBeVisible();
    await dropS2(page, worker, live.windowId, live.idOf('B'));
    const dropped = await idOfUrl(worker, live.windowId, 'https://s2.test/');

    await undoKey(page);
    await expect
      .poll(() => addresses(worker, live.windowId), SETTLE)
      .toEqual([dataUrl('A'), dataUrl('B'), dataUrl('C')]);

    await redoKey(page);
    await expect
      .poll(() => addresses(worker, live.windowId), SETTLE)
      .toEqual([dataUrl('A'), 'https://s2.test/', dataUrl('B'), dataUrl('C')]);
    expect(await idOfUrl(worker, live.windowId, 'https://s2.test/')).not.toBe(
      dropped
    );
    // No toast when it works.
    await expect(toasts(page)).toHaveCount(0);
  });

  test('a group: ⌘Z closes all its tabs; ⌘⇧Z opens it again as a group with its title and color', async ({
    context,
    extensionId,
    serviceWorker: worker,
  }) => {
    const live = await openLiveWindow(worker, ['A', 'B']);
    const page = await setUp(context, extensionId);
    await expect(liveRow(page, live.idOf('B'))).toBeVisible();

    await pickUp(page, groupHandle(page, 'day'));
    await carryTo(page, await topOf(liveRow(page, live.idOf('B'))));
    await page.mouse.up();
    await expect
      .poll(() => addresses(worker, live.windowId), SETTLE)
      .toEqual([dataUrl('A'), 'https://g0.test/', 'placeholder', dataUrl('B')]);
    await landed(page, worker, live.windowId, 'https://g0.test/');

    await undoKey(page);
    await expect
      .poll(() => addresses(worker, live.windowId), SETTLE)
      .toEqual([dataUrl('A'), dataUrl('B')]);

    await redoKey(page);
    await expect
      .poll(() => addresses(worker, live.windowId), SETTLE)
      .toEqual([dataUrl('A'), 'https://g0.test/', 'placeholder', dataUrl('B')]);
    const tabs = await strip(worker, live.windowId);
    expect(tabs[1].groupId).not.toBe(-1);
    expect(tabs[2].groupId).toBe(tabs[1].groupId);
    // The look lands in its own call after the group forms (KAN-931).
    await expect
      .poll(
        () =>
          worker.evaluate(
            (id: number) => chrome.tabGroups.get(id),
            tabs[1].groupId
          ),
        SETTLE
      )
      .toMatchObject({ title: 'Day trips', color: 'green' });
  });

  test('a pair: ⌘Z closes both halves; ⌘⇧Z opens them split again', async ({
    context,
    extensionId,
    serviceWorker: worker,
  }) => {
    const live = await openLiveWindow(worker, ['A', 'B']);
    const page = await setUp(context, extensionId);
    await expect(liveRow(page, live.idOf('B'))).toBeVisible();
    const halves = ['https://h1.test/', 'https://h2.test/'];
    const split = () =>
      worker.evaluate(async (id: number) => {
        const tabs = (await chrome.tabs.query({ windowId: id })).sort(
          (a, b) => a.index - b.index
        );
        return tabs.map((t) => Reflect.get(t, 'splitViewId') as number);
      }, live.windowId);

    await pickUp(page, page.locator('[data-saved-tab-row="h1"]'));
    await carryTo(page, await topOf(liveRow(page, live.idOf('B'))));
    await page.mouse.up();
    await expect
      .poll(() => addresses(worker, live.windowId), SETTLE)
      .toEqual([dataUrl('A'), ...halves, dataUrl('B')]);
    await landed(page, worker, live.windowId, 'https://h1.test/');

    await undoKey(page);
    await expect
      .poll(() => addresses(worker, live.windowId), SETTLE)
      .toEqual([dataUrl('A'), dataUrl('B')]);

    await redoKey(page);
    await expect
      .poll(() => addresses(worker, live.windowId), SETTLE)
      .toEqual([dataUrl('A'), ...halves, dataUrl('B')]);
    await expect
      .poll(async () => {
        const ids = await split();
        return ids[1] === ids[2] && (ids[1] ?? -1) > 0;
      }, SETTLE)
      .toBe(true);
  });

  test('a window on an open window: ⌘Z closes only the tabs it added', async ({
    context,
    extensionId,
    serviceWorker: worker,
  }) => {
    const live = await openLiveWindow(worker, ['A', 'B']);
    const page = await setUp(context, extensionId);
    await expect(liveRow(page, live.idOf('B'))).toBeVisible();

    await pickUp(page, windowHandle(page, 'w1'));
    await carryTo(page, await middleOf(liveRow(page, live.idOf('A'))));
    await page.mouse.up();
    await expect
      .poll(async () => (await addresses(worker, live.windowId)).length, SETTLE)
      .toBe(9);
    await landed(page, worker, live.windowId, 'https://s1.test/');

    await undoKey(page);
    await expect
      .poll(() => addresses(worker, live.windowId), SETTLE)
      .toEqual([dataUrl('A'), dataUrl('B')]);

    await redoKey(page);
    await expect
      .poll(async () => (await addresses(worker, live.windowId)).length, SETTLE)
      .toBe(9);
  });

  test.describe('a New window drop, Pin Tab Keeper on', () => {
    for (const userTab of [false, true]) {
      test(
        userTab
          ? 'with a tab the user opened there: only the dropped tab closes, the window stays'
          : '⌘Z in the tab view closes the new window',
        async ({ context, extensionId, serviceWorker: worker }) => {
          const live = await openLiveWindow(worker, ['A', 'B']);
          const page = await setUp(context, extensionId, {
            pinTabKeeperInNewWindows: true,
          });
          await expect(liveRow(page, live.idOf('B'))).toBeVisible();
          const before = await windowIds(worker);

          await pickUp(page, tabHandle(page, 's2'));
          await carryTo(page, await middleOf(liveRow(page, live.idOf('A'))));
          await carryTo(page, await middleOf(page.locator(LAST_BOX)));
          await expect(page.locator(LAST_BOX)).toHaveAttribute(
            'data-landing',
            ''
          );
          await page.mouse.up();
          await expect
            .poll(async () => (await windowIds(worker)).length, SETTLE)
            .toBe(before.length + 1);
          const made = (await windowIds(worker)).find(
            (id) => !before.includes(id)
          );
          if (made === undefined) throw new Error('no new window');
          // The stub, then the tab.
          await expect
            .poll(async () => (await strip(worker, made)).length, SETTLE)
            .toBe(2);
          await undoLit(page);
          if (userTab) {
            await worker.evaluate(
              (windowId: number) =>
                chrome.tabs.create({
                  windowId,
                  url: 'data:text/html,mine',
                  active: false,
                }),
              made
            );
          }

          await undoKey(page);
          if (!userTab) {
            await expect
              .poll(async () => (await windowIds(worker)).sort(), SETTLE)
              .toEqual([...before].sort());
            return;
          }
          await expect
            .poll(
              async () => (await strip(worker, made)).map((t) => t.url),
              SETTLE
            )
            .toEqual([
              expect.stringContaining('chrome-extension://'),
              'data:text/html,mine',
            ]);
          expect(await windowIds(worker)).toContain(made);
        }
      );
    }
  });

  test.describe('refused: closes nothing, says why, and the next ⌘Z reaches the step before', () => {
    const changes: [
      string,
      (worker: Worker, id: number, other: number) => Promise<unknown>,
    ][] = [
      [
        'dragged to another window',
        (worker, id, other) =>
          worker.evaluate(
            ([tabId, windowId]) =>
              chrome.tabs.move(tabId, { windowId, index: -1 }),
            [id, other] as const
          ),
      ],
      [
        'navigated to another page',
        // After its first load: a change during it counts as a redirect (spec Goal 6).
        async (worker, id) => {
          await expect
            .poll(() =>
              worker.evaluate(
                async (tabId: number) => (await chrome.tabs.get(tabId)).status,
                id
              )
            )
            .toBe('complete');
          return worker
            .evaluate(([tabId, url]) => chrome.tabs.update(tabId, { url }), [
              id,
              standIn('elsewhere'),
            ] as const)
            .then(() =>
              expect
                .poll(() =>
                  worker.evaluate(
                    async (tabId: number) => (await chrome.tabs.get(tabId)).url,
                    id
                  )
                )
                .toBe(standIn('elsewhere'))
            );
        },
      ],
      [
        'closed',
        (worker, id) =>
          worker.evaluate((tabId: number) => chrome.tabs.remove(tabId), id),
      ],
    ];
    for (const [what, change] of changes) {
      test(`after it was ${what}`, async ({
        context,
        extensionId,
        serviceWorker: worker,
      }) => {
        const other = await openLiveWindow(worker, ['X']);
        const live = await openLiveWindow(worker, ['A', 'B']);
        const page = await setUp(context, extensionId);
        await expect(liveRow(page, live.idOf('B'))).toBeVisible();
        // The step before: s2 dropped, then the one under test.
        await dropS2(page, worker, other.windowId, other.idOf('X'));
        await pickUp(page, tabHandle(page, 's1'));
        await carryTo(page, await topOf(liveRow(page, live.idOf('B'))));
        await page.mouse.up();
        const dropped = await landed(
          page,
          worker,
          live.windowId,
          'https://s1.test/'
        );
        await change(worker, dropped, other.windowId);
        const total = async () =>
          (await worker.evaluate(() => chrome.tabs.query({}))).length;
        const count = await total();

        await undoKey(page);
        await expect(toasts(page)).toContainText(REFUSED);
        expect(await total()).toBe(count);

        await undoKey(page);
        await expect
          .poll(() => addresses(worker, other.windowId), SETTLE)
          .not.toContain('https://s2.test/');
      });
    }
  });

  test('a tab opened to the left of the dropped one does not stop the undo', async ({
    context,
    extensionId,
    serviceWorker: worker,
  }) => {
    const live = await openLiveWindow(worker, ['A', 'B', 'C']);
    const page = await setUp(context, extensionId);
    await expect(liveRow(page, live.idOf('C'))).toBeVisible();
    await dropS2(page, worker, live.windowId, live.idOf('C'));
    await worker.evaluate(
      (windowId: number) =>
        chrome.tabs.create({
          windowId,
          index: 1,
          url: 'data:text/html,left',
          active: false,
        }),
      live.windowId
    );

    await undoKey(page);
    await expect
      .poll(() => addresses(worker, live.windowId), SETTLE)
      .toEqual([
        dataUrl('A'),
        'data:text/html,left',
        dataUrl('B'),
        dataUrl('C'),
      ]);
    await expect(toasts(page)).toHaveCount(0);
  });

  test('Skip tabs already open: a group with one page there; ⌘Z closes only the tab it opened', async ({
    context,
    extensionId,
    serviceWorker: worker,
  }) => {
    const live = await openLiveWindow(worker, ['A', 'B']);
    await worker.evaluate(
      (windowId: number) =>
        chrome.tabs.create({
          windowId,
          url: 'https://g0.test/',
          active: false,
        }),
      live.windowId
    );
    const page = await setUp(context, extensionId, {
      skipTabsAlreadyOpen: true,
    });
    await expect(liveRow(page, live.idOf('B'))).toBeVisible();
    const before = await addresses(worker, live.windowId);

    await pickUp(page, groupHandle(page, 'day'));
    await carryTo(page, await topOf(liveRow(page, live.idOf('B'))));
    await page.mouse.up();
    await expect
      .poll(async () => (await addresses(worker, live.windowId)).length, SETTLE)
      .toBe(before.length + 1);
    await landed(page, worker, live.windowId, 'https://g1.test/');

    await undoKey(page);
    await expect
      .poll(() => addresses(worker, live.windowId), SETTLE)
      .toEqual(before);
  });

  test('a drop, then a sort of that window: ⌘Z ⌘Z ⌘⇧Z ⌘⇧Z ends sorted with the dropped tab back', async ({
    context,
    extensionId,
    serviceWorker: worker,
  }) => {
    const live = await openLiveWindow(worker, ['C', 'B', 'A']);
    const page = await setUp(context, extensionId);
    await expect(liveRow(page, live.idOf('A'))).toBeVisible();
    await dropS2(page, worker, live.windowId, live.idOf('B'));
    const row = page.locator(`${OPEN_NOW} [data-window-row]`).last();
    await row.hover();
    await row
      .locator('[data-row-actions]')
      .getByRole('button', { name: /^More actions: / })
      .click();
    await page
      .getByRole('menuitem', { name: 'Sort tabs by site', exact: true })
      .click();
    await expect
      .poll(() => addresses(worker, live.windowId), SETTLE)
      .not.toEqual([
        dataUrl('C'),
        'https://s2.test/',
        dataUrl('B'),
        dataUrl('A'),
      ]);
    const sorted = await addresses(worker, live.windowId);

    await undoKey(page);
    await expect
      .poll(() => addresses(worker, live.windowId), SETTLE)
      .toEqual([dataUrl('C'), 'https://s2.test/', dataUrl('B'), dataUrl('A')]);
    await undoKey(page);
    await expect
      .poll(() => addresses(worker, live.windowId), SETTLE)
      .toEqual([dataUrl('C'), dataUrl('B'), dataUrl('A')]);
    await redoKey(page);
    await expect
      .poll(() => addresses(worker, live.windowId), SETTLE)
      .toEqual([dataUrl('C'), 'https://s2.test/', dataUrl('B'), dataUrl('A')]);
    await redoKey(page);
    await expect
      .poll(() => addresses(worker, live.windowId), SETTLE)
      .toEqual(sorted);
    await expect(toasts(page)).toHaveCount(0);
  });

  test('two drops: ⌘Z ⌘Z ⌘⇧Z ⌘⇧Z brings both back', async ({
    context,
    extensionId,
    serviceWorker: worker,
  }) => {
    const live = await openLiveWindow(worker, ['A', 'B']);
    const page = await setUp(context, extensionId);
    await expect(liveRow(page, live.idOf('B'))).toBeVisible();
    await dropS2(page, worker, live.windowId, live.idOf('B'));
    await pickUp(page, tabHandle(page, 's1'));
    await carryTo(page, await topOf(liveRow(page, live.idOf('B'))));
    await page.mouse.up();
    const both = [
      dataUrl('A'),
      'https://s2.test/',
      'https://s1.test/',
      dataUrl('B'),
    ];
    await expect
      .poll(() => addresses(worker, live.windowId), SETTLE)
      .toEqual(both);
    await landed(page, worker, live.windowId, 'https://s1.test/');

    await undoKey(page);
    await undoKey(page);
    await expect
      .poll(() => addresses(worker, live.windowId), SETTLE)
      .toEqual([dataUrl('A'), dataUrl('B')]);
    await redoKey(page);
    await redoKey(page);
    await expect
      .poll(() => addresses(worker, live.windowId), SETTLE)
      .toEqual(both);
  });
});
