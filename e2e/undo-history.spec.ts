import type { BrowserContext, Locator, Page, Worker } from '@playwright/test';

import { grantedTest as test, expect } from './fixtures/grantedExtension';
import { standIn } from './fixtures/standInPages';
import {
  boxOf,
  openSaved,
  savedWindow,
  session,
  stored,
} from './fixtures/savedWindows';

// KAN-744 on the real artifact: Open now's sorts and drags share one undo
// history with saved-session edits. ⌘Z, ⌘⇧Z, the menu's Undo and Redo and the
// toast chips walk it; a step whose tabs changed since is refused with a toast,
// and the next press reaches the step before it. Every press is checked against
// Chrome's own strips, read in the worker, and the saved title in storage.
//
// A live step is async and a press during one is ignored (R19), so every drop,
// sort and press waits until the tab view has no Chrome call in flight: a drop
// or an undo awaits nothing else, and starts its first call in the event's own
// handler, so none in flight means it has finished and its step is recorded.

const TITLE = 'Launch week';
const RENAMED = 'Launch day';
const RENAMED_AGAIN = 'Launch night';

const UNDO_SORT = "Couldn't undo the sort. That window's tabs changed since.";
const UNDO_MOVE = "Couldn't undo the move. Those tabs moved or closed since.";
const REDO_SORT = "Couldn't redo the sort. That window's tabs changed since.";
const REDO_MOVE = "Couldn't redo the move. Those tabs moved or closed since.";
const UNDO_WINDOW_CLOSED =
  "Couldn't undo the move. The window they came from is closed.";
const REDO_WINDOW_CLOSED =
  "Couldn't redo the move. The window they went to is closed.";

// ---- Chrome ---------------------------------------------------------------------

interface LiveTab {
  n: string;
  // The host's first label; *.localhost is loopback. The sort orders by it.
  site?: string;
}

// A window the spec made, and its tabs' ids by label.
interface Live {
  windowId: number;
  tab: (label: string) => number;
}

function pageOn({ n, site = 'page' }: LiveTab): string {
  const url = new URL(standIn(n));
  url.hostname = `${site}.localhost`;
  return url.href;
}

// Each window's strip as Chrome has it, in one read: a tab's label, with
// '@' and its group's title when it is in one. 'TK' is a Tab Keeper page.
const strips = (worker: Worker, windowIds: number[]): Promise<string[][]> =>
  worker.evaluate(
    (ids) =>
      Promise.all(
        ids.map(async (windowId) => {
          const tabs = await chrome.tabs.query({ windowId });
          tabs.sort((a, b) => a.index - b.index);
          return Promise.all(
            tabs.map(async (t) => {
              const url = t.url || t.pendingUrl || '';
              const label = url.startsWith('chrome-extension://')
                ? 'TK'
                : url === ''
                  ? ''
                  : decodeURIComponent(new URL(url).pathname.slice(1));
              if (t.groupId === -1) return label;
              const group = await chrome.tabGroups
                .get(t.groupId)
                .catch(() => null);
              return `${label}@${group?.title ?? '?'}`;
            })
          );
        })
      ),
    windowIds
  );

// Polls until every window's strip is `want`, in the order of `windows`.
const expectStrips = (worker: Worker, windows: Live[], want: string[][]) =>
  expect
    .poll(() =>
      strips(
        worker,
        windows.map((w) => w.windowId)
      )
    )
    .toEqual(want);

// A window the browser opens unfocused, so the tab view stays in front, with
// one tab per label, in order; returns once every tab has its address.
async function openLive(worker: Worker, tabs: LiveTab[]): Promise<Live> {
  const opened = await worker.evaluate(async (urls) => {
    const win = await chrome.windows.create({ focused: false, url: urls });
    const ids = (win?.tabs ?? []).flatMap((t) =>
      t.id === undefined ? [] : [t.id]
    );
    if (win?.id === undefined || ids.length !== urls.length) return null;
    return { windowId: win.id, ids };
  }, tabs.map(pageOn));
  if (opened === null) throw new Error('Chrome gave no window or tab ids');
  const byLabel = new Map(tabs.map((t, i) => [t.n, opened.ids[i]]));
  const live: Live = {
    windowId: opened.windowId,
    tab: (label) => {
      const id = byLabel.get(label);
      if (id === undefined) throw new Error(`no tab labelled ${label}`);
      return id;
    },
  };
  await expectStrips(worker, [live], [tabs.map((t) => t.n)]);
  return live;
}

const makeGroup = (
  worker: Worker,
  windowId: number,
  tabIds: [number, ...number[]],
  title: string
): Promise<number> =>
  worker.evaluate(
    async ({ windowId, tabIds, title }) => {
      const groupId = await chrome.tabs.group({
        tabIds,
        createProperties: { windowId },
      });
      await chrome.tabGroups.update(groupId, { title, color: 'red' });
      return groupId;
    },
    { windowId, tabIds, title }
  );

const groupOf = (worker: Worker, tabId: number) =>
  worker.evaluate(async (id) => (await chrome.tabs.get(id)).groupId, tabId);

const groupLook = (worker: Worker, groupId: number) =>
  worker.evaluate(async (id) => {
    const group = await chrome.tabGroups.get(id);
    return { title: group.title ?? '', color: group.color };
  }, groupId);

// Whether any tab in Chrome is still in the group.
const groupExists = (worker: Worker, groupId: number) =>
  worker.evaluate(
    async (id) => (await chrome.tabs.query({})).some((t) => t.groupId === id),
    groupId
  );

const activate = (worker: Worker, tabId: number) =>
  worker.evaluate(async (id) => {
    await chrome.tabs.update(id, { active: true });
  }, tabId);

// A tab moved outside Tab Keeper, as a user dragging Chrome's own strip.
const moveByHand = (worker: Worker, tabId: number, index: number) =>
  worker.evaluate(
    async ({ tabId, index }) => {
      await chrome.tabs.move(tabId, { index });
    },
    { tabId, index }
  );

// A tab opened outside Tab Keeper, at the end of the window, in the background.
const openTabIn = (worker: Worker, windowId: number, url: string) =>
  worker.evaluate(
    async ({ windowId, url }) => {
      await chrome.tabs.create({ windowId, url, active: false });
    },
    { windowId, url }
  );

// ---- The page -------------------------------------------------------------------

interface ChromeCalls {
  inFlight: number;
  made: number;
}

// Counts the extension page's tabs, tabGroups and windows calls, in flight and in all.
async function countChromeCalls(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    if (window.top !== window || typeof chrome === 'undefined') return;
    if (!chrome.tabs) return;
    const calls: ChromeCalls = { inFlight: 0, made: 0 };
    Object.defineProperty(window, '__kan744Calls', { value: calls });
    const methods: [string, string[]][] = [
      ['tabs', ['get', 'query', 'move', 'group', 'ungroup', 'update']],
      ['tabs', ['create', 'remove']],
      ['tabGroups', ['get', 'query', 'move', 'update']],
      ['windows', ['get', 'getAll', 'getCurrent', 'getLastFocused']],
      ['windows', ['create', 'update', 'remove']],
    ];
    for (const [space, names] of methods) {
      const ns: unknown = Reflect.get(chrome, space);
      if (typeof ns !== 'object' || ns === null) continue;
      for (const name of names) {
        const original: unknown = Reflect.get(ns, name);
        if (typeof original !== 'function') continue;
        Reflect.set(ns, name, (...args: unknown[]) => {
          const result: unknown = Reflect.apply(original, ns, args);
          if (result instanceof Promise) {
            calls.inFlight += 1;
            calls.made += 1;
            const done = () => {
              calls.inFlight -= 1;
            };
            result.then(done, done);
          }
          return result;
        });
      }
    }
  });
}

const chromeCalls = (page: Page): Promise<ChromeCalls | null> =>
  page.evaluate(() => {
    const calls: unknown = Reflect.get(window, '__kan744Calls');
    if (typeof calls !== 'object' || calls === null) return null;
    const inFlight: unknown = Reflect.get(calls, 'inFlight');
    const made: unknown = Reflect.get(calls, 'made');
    return typeof inFlight === 'number' && typeof made === 'number'
      ? { inFlight, made }
      : null;
  });

// Resolves once the tab view has no Chrome call in flight.
const settled = (page: Page) =>
  expect
    .poll(async () => (await chromeCalls(page))?.inFlight, {
      message: 'the tab view never finished its Chrome calls',
    })
    .toBe(0);

const OPEN_NOW = '[data-pane="open-now"]';

const savedTitle = async (page: Page) =>
  (await stored(page)).tabGroups.find((g) => g.tabGroupId === 'S1')?.title;

const expectTitle = (page: Page, title: string) =>
  expect.poll(() => savedTitle(page)).toBe(title);

const toasts = (page: Page): Locator =>
  page.locator('[role="status"] > [data-toast]:not([aria-hidden="true"])');

// The header's Undo and Redo: div[role=button], unlike a toast's <button> chips.
const menuButton = (page: Page, name: 'Undo' | 'Redo'): Locator =>
  page.locator(`[role="button"][aria-label="${name}"]`);

// The menu's Undo and Redo as on (true) or dimmed (false). Also the barrier
// after a live step: they change in the dispatch that ends it.
async function expectHistory(
  page: Page,
  { undo, redo }: { undo: boolean; redo: boolean }
): Promise<void> {
  for (const [name, on] of [
    ['Undo', undo],
    ['Redo', redo],
  ] as const) {
    const button = menuButton(page, name);
    if (on) await expect(button).not.toHaveAttribute('aria-disabled');
    else await expect(button).toHaveAttribute('aria-disabled', 'true');
  }
}

// The one toast on screen is the refused text, with no button (R10, R11).
async function expectRefusedToast(page: Page, text: string): Promise<void> {
  await expect(toasts(page)).toHaveCount(1);
  await expect(toasts(page)).toContainText(text);
  await expect(toasts(page).getByRole('button')).toHaveCount(0);
}

async function undoKey(page: Page) {
  await page.keyboard.press('ControlOrMeta+z');
  await settled(page);
}
async function redoKey(page: Page) {
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await settled(page);
}
async function clickMenu(page: Page, name: 'Undo' | 'Redo') {
  await menuButton(page, name).click();
  await settled(page);
}

const tabRow = (page: Page, tabId: number): Locator =>
  page.locator(`${OPEN_NOW} [data-open-tab-id="${tabId}"]`);

const liveBlock = (page: Page, windowId: number): Locator =>
  page.locator(`${OPEN_NOW} [data-open-window-id="${windowId}"]`);

// Opens the tab view with session S1 shown, the saved detail beside Open now.
async function openView(
  context: Parameters<typeof openSaved>[0],
  extensionId: string,
  extra: ReturnType<typeof session>[] = []
): Promise<Page> {
  await countChromeCalls(context);
  const page = await openSaved(context, extensionId, 'tab view', {
    sessions: [session('S1', TITLE, [savedWindow('w1', 'Saved')]), ...extra],
  });
  // PREMISE: an empty history; Undo and Redo dimmed.
  await expectHistory(page, { undo: false, redo: false });
  // PREMISE: the count sees the page's own calls (Open now's first read).
  await expect
    .poll(async () => (await chromeCalls(page))?.made ?? 0)
    .toBeGreaterThan(0);
  return page;
}

// Waits until Open now draws every window, and checks nothing scrolls, so no
// drag here auto-scrolls.
async function shown(page: Page, windows: Live[], lastLabels: string[]) {
  for (const [i, w] of windows.entries()) {
    await expect(tabRow(page, w.tab(lastLabels[i]))).toBeVisible();
  }
  const fits = await page.evaluate(() => {
    let el =
      document.querySelector('[data-open-window-id]')?.parentElement ?? null;
    while (el && !['auto', 'scroll'].includes(getComputedStyle(el).overflowY))
      el = el.parentElement;
    return el === null ? null : el.scrollHeight <= el.clientHeight;
  });
  expect(fits).toBe(true);
}

async function renameShown(page: Page, from: string, to: string) {
  await page
    .locator('[data-pane="detail"]')
    .getByRole('button', { name: `Rename session: ${from}`, exact: true })
    .click();
  const input = page.locator('input:focus');
  await input.fill(to);
  await input.press('Enter');
  await expectTitle(page, to);
}

async function sortInOpenNow(page: Page, windowId: number) {
  await liveBlock(page, windowId).locator('[data-window-row]').hover();
  await liveBlock(page, windowId)
    .locator('[data-window-row] [data-row-actions]')
    .getByRole('button', { name: /^More actions: Window \d+$/ })
    .click();
  await page
    .getByRole('menuitem', { name: 'Sort tabs by site', exact: true })
    .click();
  // The toast follows the step being recorded.
  await expect(toasts(page).first()).toContainText('Sorted the tabs by site.');
  await settled(page);
}

// Presses on `target`, moves past the activation distance and requires a held
// row, then goes to just inside the top of `before` (read once the drag is
// live: rows are measured at pick-up), rests while the rows ease, and lets go.
async function drag(
  page: Page,
  target: Locator,
  before: Locator,
  foldsOnPickUp = false
) {
  const box = await boxOf(target);
  const x = box.x + 60;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + 10, { steps: 3 });
  await expect
    .poll(
      () =>
        page.evaluate(
          () => document.querySelector('[data-drag-held]') !== null
        ),
      { message: 'the row was never picked up', timeout: 3000 }
    )
    .toBe(true);
  // A held group folds to its title row (KAN-160) before the aim is read.
  if (foldsOnPickUp) await page.waitForTimeout(350);
  await page.mouse.move(x, (await boxOf(before)).y + 6, { steps: 10 });
  await page.waitForTimeout(350);
  await page.mouse.up();
  await settled(page);
}

const dragTab = (page: Page, tabId: number, beforeTabId: number) =>
  drag(page, tabRow(page, tabId), tabRow(page, beforeTabId));

const dragGroup = (
  page: Page,
  windowId: number,
  title: string,
  beforeTabId: number
) =>
  drag(
    page,
    liveBlock(page, windowId).getByText(title, { exact: true }),
    tabRow(page, beforeTabId),
    true
  );

// ---- The windows ------------------------------------------------------------------

// Sorted by first-seen site: the betas, then the alphas.
const SORT_TABS: LiveTab[] = [
  { n: 'sb1', site: 'beta' },
  { n: 'sa1', site: 'alpha' },
  { n: 'sb2', site: 'beta' },
  { n: 'sa2', site: 'alpha' },
];
const UNSORTED = ['sb1', 'sa1', 'sb2', 'sa2'];
const SORTED = ['sb1', 'sb2', 'sa1', 'sa2'];

const FROM_TABS: LiveTab[] = [{ n: 'b0' }, { n: 'b1' }, { n: 'b2' }];
const TO_TABS: LiveTab[] = [{ n: 'c0' }, { n: 'c1' }];
// b1 dragged in above c1.
const FROM_BEFORE = ['b0', 'b1', 'b2'];
const TO_BEFORE = ['c0', 'c1'];
const FROM_AFTER = ['b0', 'b2'];
const TO_AFTER = ['c0', 'b1', 'c1'];

interface Example {
  page: Page;
  a: Live;
  b: Live;
  c: Live;
}

// The tab view, then the sort window A and the drag windows B and C.
async function exampleWindows(
  context: Parameters<typeof openSaved>[0],
  extensionId: string,
  worker: Worker
): Promise<Example> {
  const page = await openView(context, extensionId);
  const a = await openLive(worker, SORT_TABS);
  const b = await openLive(worker, FROM_TABS);
  const c = await openLive(worker, TO_TABS);
  await shown(page, [a, b, c], ['sa2', 'b2', 'c1']);
  return { page, a, b, c };
}

// ---- The ticket's example (R5) and the menu (R15) ---------------------------------

// Sort A, rename the session, drag b1 into C; then three undos and three redos.
// `press` is ⌘Z / ⌘⇧Z or the menu's Undo / Redo.
async function expectTheExampleWalks(
  { page, a, b, c }: Example,
  worker: Worker,
  press: { undo: () => Promise<void>; redo: () => Promise<void> }
) {
  const windows = [a, b, c];
  const state = (sorted: boolean, renamed: boolean, dragged: boolean) =>
    Promise.all([
      expectStrips(worker, windows, [
        sorted ? SORTED : UNSORTED,
        dragged ? FROM_AFTER : FROM_BEFORE,
        dragged ? TO_AFTER : TO_BEFORE,
      ]),
      expectTitle(page, renamed ? RENAMED : TITLE),
    ]);

  await sortInOpenNow(page, a.windowId);
  await state(true, false, false);
  await renameShown(page, TITLE, RENAMED);
  await dragTab(page, b.tab('b1'), c.tab('c1'));
  await state(true, true, true);
  await expectHistory(page, { undo: true, redo: false });

  // Undo: the drag, the rename, the sort.
  await press.undo();
  await state(true, true, false);
  await expectHistory(page, { undo: true, redo: true });
  await press.undo();
  await state(true, false, false);
  await expectHistory(page, { undo: true, redo: true });
  await press.undo();
  await state(false, false, false);
  await expectHistory(page, { undo: false, redo: true });

  // Redo: the sort, the rename, the drag.
  await press.redo();
  await state(true, false, false);
  await expectHistory(page, { undo: true, redo: true });
  await press.redo();
  await state(true, true, false);
  await expectHistory(page, { undo: true, redo: true });
  await press.redo();
  await state(true, true, true);
  await expectHistory(page, { undo: true, redo: false });
}

test('the ticket example: ⌘Z ×3 then ⌘⇧Z ×3', async ({
  context,
  extensionId,
  serviceWorker: worker,
}) => {
  const example = await exampleWindows(context, extensionId, worker);
  await expectTheExampleWalks(example, worker, {
    undo: () => undoKey(example.page),
    redo: () => redoKey(example.page),
  });
});

test('the menu Undo and Redo walk the same example', async ({
  context,
  extensionId,
  serviceWorker: worker,
}) => {
  const example = await exampleWindows(context, extensionId, worker);
  // PREMISE: one of each, apart from any toast chip.
  await expect(menuButton(example.page, 'Undo')).toHaveCount(1);
  await expect(menuButton(example.page, 'Redo')).toHaveCount(1);
  await expectTheExampleWalks(example, worker, {
    undo: () => clickMenu(example.page, 'Undo'),
    redo: () => clickMenu(example.page, 'Redo'),
  });
});

// ---- Redo of each kind (R7, R8) ------------------------------------------------------

test.describe('redo of a tab drag, a group drag, and a sort', () => {
  test('a tab drag', async ({
    context,
    extensionId,
    serviceWorker: worker,
  }) => {
    const { page, b, c } = await exampleWindows(context, extensionId, worker);
    await dragTab(page, b.tab('b1'), c.tab('c1'));
    await expectStrips(worker, [b, c], [FROM_AFTER, TO_AFTER]);

    await undoKey(page);
    await expectStrips(worker, [b, c], [FROM_BEFORE, TO_BEFORE]);
    await expectHistory(page, { undo: false, redo: true });

    await redoKey(page);
    await expectStrips(worker, [b, c], [FROM_AFTER, TO_AFTER]);
    await expectHistory(page, { undo: true, redo: false });

    // The redone step undoes again: its record was read after the redo.
    await undoKey(page);
    await expectStrips(worker, [b, c], [FROM_BEFORE, TO_BEFORE]);
    await expectHistory(page, { undo: false, redo: true });
    await expectTitle(page, TITLE);
  });

  test('a sort', async ({ context, extensionId, serviceWorker: worker }) => {
    const { page, a } = await exampleWindows(context, extensionId, worker);
    await sortInOpenNow(page, a.windowId);
    await expectStrips(worker, [a], [SORTED]);

    await undoKey(page);
    await expectStrips(worker, [a], [UNSORTED]);
    await expectHistory(page, { undo: false, redo: true });

    // Redo replays the recorded order; it does not sort again.
    await redoKey(page);
    await expectStrips(worker, [a], [SORTED]);
    await expectHistory(page, { undo: true, redo: false });

    await undoKey(page);
    await expectStrips(worker, [a], [UNSORTED]);
    await expectHistory(page, { undo: false, redo: true });
    await expectTitle(page, TITLE);
  });

  test('a group drag', async ({
    context,
    extensionId,
    serviceWorker: worker,
  }) => {
    const page = await openView(context, extensionId);
    const b = await openLive(worker, [
      { n: 'b0' },
      { n: 'g1' },
      { n: 'g2' },
      { n: 'b3' },
    ]);
    const c = await openLive(worker, TO_TABS);
    const g = await makeGroup(
      worker,
      b.windowId,
      [b.tab('g1'), b.tab('g2')],
      'Grp'
    );
    await activate(worker, b.tab('b0'));
    await shown(page, [b, c], ['b3', 'c1']);
    const home = ['b0', 'g1@Grp', 'g2@Grp', 'b3'];
    const away = ['c0', 'g1@Grp', 'g2@Grp', 'c1'];

    await dragGroup(page, b.windowId, 'Grp', c.tab('c1'));
    await expectStrips(worker, [b, c], [['b0', 'b3'], away]);

    await undoKey(page);
    await expectStrips(worker, [b, c], [home, TO_BEFORE]);
    await expectHistory(page, { undo: false, redo: true });

    await redoKey(page);
    await expectStrips(worker, [b, c], [['b0', 'b3'], away]);
    await expectHistory(page, { undo: true, redo: false });
    // By tabGroups.move both ways: the same group, with its look.
    expect(await groupOf(worker, b.tab('g1'))).toBe(g);
    expect(await groupLook(worker, g)).toEqual({ title: 'Grp', color: 'red' });
    await expectTitle(page, TITLE);
  });
});

// R8. A redo of a group holding its window's front tab rebuilds it (G1): Chrome
// removes the old group and the new one has a new id, which the next undo must
// know to move it back.
test('a group Chrome removed comes back on redo', async ({
  context,
  extensionId,
  serviceWorker: worker,
}) => {
  const page = await openView(context, extensionId);
  const b = await openLive(worker, [
    { n: 'b0' },
    { n: 'g1' },
    { n: 'g2' },
    { n: 'b3' },
  ]);
  const c = await openLive(worker, TO_TABS);
  const g = await makeGroup(
    worker,
    b.windowId,
    [b.tab('g1'), b.tab('g2')],
    'Grp'
  );
  await activate(worker, b.tab('b0'));
  await shown(page, [b, c], ['b3', 'c1']);
  const home = ['b0', 'g1@Grp', 'g2@Grp', 'b3'];
  const away = ['c0', 'g1@Grp', 'g2@Grp', 'c1'];

  await dragGroup(page, b.windowId, 'Grp', c.tab('c1'));
  await expectStrips(worker, [b, c], [['b0', 'b3'], away]);
  await undoKey(page);
  await expectStrips(worker, [b, c], [home, TO_BEFORE]);
  await expectHistory(page, { undo: false, redo: true });
  // PREMISE: the same group is back, and now holds B's front tab.
  expect(await groupOf(worker, b.tab('g1'))).toBe(g);
  await activate(worker, b.tab('g1'));

  await redoKey(page);
  await expectStrips(worker, [b, c], [['b0', 'b3'], away]);
  await expectHistory(page, { undo: true, redo: false });
  const rebuilt = await groupOf(worker, b.tab('g1'));
  expect(rebuilt).not.toBe(g);
  expect(await groupExists(worker, g)).toBe(false);
  expect(await groupOf(worker, b.tab('g2'))).toBe(rebuilt);
  expect(await groupLook(worker, rebuilt)).toEqual({
    title: 'Grp',
    color: 'red',
  });

  // The record was read after the redo, so ⌘Z finds the rebuilt group.
  await undoKey(page);
  await expectStrips(worker, [b, c], [home, TO_BEFORE]);
  await expectHistory(page, { undo: false, redo: true });
  expect(await groupOf(worker, b.tab('g1'))).toBe(rebuilt);
});

// ---- Refused steps (R9-R11) ---------------------------------------------------------

// Two saved steps on the near side of the refused one: a press that refused and
// also took a saved step would leave the next press on the far rename.
async function renameTwice(page: Page) {
  await renameShown(page, TITLE, RENAMED);
  await renameShown(page, RENAMED, RENAMED_AGAIN);
}

test.describe('refused steps', () => {
  test('refused: undo a sort after a new tab opens', async ({
    context,
    extensionId,
    serviceWorker: worker,
  }) => {
    const { page, a } = await exampleWindows(context, extensionId, worker);
    await renameTwice(page);
    await sortInOpenNow(page, a.windowId);
    await expectStrips(worker, [a], [SORTED]);
    await openTabIn(worker, a.windowId, pageOn({ n: 'extra', site: 'beta' }));
    const changed = [...SORTED, 'extra'];
    await expectStrips(worker, [a], [changed]);

    await undoKey(page);
    await expectRefusedToast(page, UNDO_SORT);
    await expectStrips(worker, [a], [changed]);
    await expectTitle(page, RENAMED_AGAIN);

    // The next press reaches the newer rename only.
    await undoKey(page);
    await expectTitle(page, RENAMED);
    await expectHistory(page, { undo: true, redo: true });
    await expectStrips(worker, [a], [changed]);
  });

  test('refused: undo a drag after the tab is moved by hand', async ({
    context,
    extensionId,
    serviceWorker: worker,
  }) => {
    const { page, b, c } = await exampleWindows(context, extensionId, worker);
    await renameTwice(page);
    await dragTab(page, b.tab('b1'), c.tab('c1'));
    await expectStrips(worker, [b, c], [FROM_AFTER, TO_AFTER]);
    await moveByHand(worker, b.tab('b1'), 0);
    const byHand = ['b1', 'c0', 'c1'];
    await expectStrips(worker, [b, c], [FROM_AFTER, byHand]);

    await undoKey(page);
    await expectRefusedToast(page, UNDO_MOVE);
    await expectStrips(worker, [b, c], [FROM_AFTER, byHand]);
    await expectTitle(page, RENAMED_AGAIN);

    await undoKey(page);
    await expectTitle(page, RENAMED);
    await expectHistory(page, { undo: true, redo: true });
    await expectStrips(worker, [b, c], [FROM_AFTER, byHand]);
  });

  test('refused: redo a sort after a new tab opens', async ({
    context,
    extensionId,
    serviceWorker: worker,
  }) => {
    const { page, a } = await exampleWindows(context, extensionId, worker);
    await sortInOpenNow(page, a.windowId);
    await expectStrips(worker, [a], [SORTED]);
    await renameTwice(page);
    await undoKey(page);
    await expectTitle(page, RENAMED);
    await undoKey(page);
    await expectTitle(page, TITLE);
    await undoKey(page);
    await expectStrips(worker, [a], [UNSORTED]);
    await expectHistory(page, { undo: false, redo: true });
    await openTabIn(worker, a.windowId, pageOn({ n: 'extra', site: 'beta' }));
    const changed = [...UNSORTED, 'extra'];
    await expectStrips(worker, [a], [changed]);

    await redoKey(page);
    await expectRefusedToast(page, REDO_SORT);
    await expectStrips(worker, [a], [changed]);
    await expectTitle(page, TITLE);

    // The next press reaches the older rename only.
    await redoKey(page);
    await expectTitle(page, RENAMED);
    await expectHistory(page, { undo: true, redo: true });
    await expectStrips(worker, [a], [changed]);
  });

  test('refused: redo a drag after the tab is moved by hand', async ({
    context,
    extensionId,
    serviceWorker: worker,
  }) => {
    const { page, b, c } = await exampleWindows(context, extensionId, worker);
    await dragTab(page, b.tab('b1'), c.tab('c1'));
    await expectStrips(worker, [b, c], [FROM_AFTER, TO_AFTER]);
    await renameTwice(page);
    await undoKey(page);
    await expectTitle(page, RENAMED);
    await undoKey(page);
    await expectTitle(page, TITLE);
    await undoKey(page);
    await expectStrips(worker, [b, c], [FROM_BEFORE, TO_BEFORE]);
    await expectHistory(page, { undo: false, redo: true });
    await moveByHand(worker, b.tab('b1'), 0);
    const byHand = ['b1', 'b0', 'b2'];
    await expectStrips(worker, [b, c], [byHand, TO_BEFORE]);

    await redoKey(page);
    await expectRefusedToast(page, REDO_MOVE);
    await expectStrips(worker, [b, c], [byHand, TO_BEFORE]);
    await expectTitle(page, TITLE);

    await redoKey(page);
    await expectTitle(page, RENAMED);
    await expectHistory(page, { undo: true, redo: true });
    await expectStrips(worker, [b, c], [byHand, TO_BEFORE]);
  });

  test('refused: undo a drag after the window it came from closed', async ({
    context,
    extensionId,
    serviceWorker: worker,
  }) => {
    const { page, b, c } = await exampleWindows(context, extensionId, worker);
    await renameTwice(page);
    await dragTab(page, b.tab('b1'), c.tab('c1'));
    await expectStrips(worker, [b, c], [FROM_AFTER, TO_AFTER]);
    await worker.evaluate(async (id) => {
      await chrome.windows.remove(id);
    }, b.windowId);
    await expectStrips(worker, [b, c], [[], TO_AFTER]);

    await undoKey(page);
    await expectRefusedToast(page, UNDO_WINDOW_CLOSED);
    await expectStrips(worker, [c], [TO_AFTER]);
    await expectTitle(page, RENAMED_AGAIN);

    await undoKey(page);
    await expectTitle(page, RENAMED);
    await expectHistory(page, { undo: true, redo: true });
    await expectStrips(worker, [c], [TO_AFTER]);
  });

  // The renames come after the drag, so they wait behind it on the redo list.
  test('refused: redo a drag after the window it went to closed', async ({
    context,
    extensionId,
    serviceWorker: worker,
  }) => {
    const { page, b, c } = await exampleWindows(context, extensionId, worker);
    await dragTab(page, b.tab('b1'), c.tab('c1'));
    await expectStrips(worker, [b, c], [FROM_AFTER, TO_AFTER]);
    await renameTwice(page);
    await undoKey(page);
    await expectTitle(page, RENAMED);
    await undoKey(page);
    await expectTitle(page, TITLE);
    await undoKey(page);
    await expectStrips(worker, [b, c], [FROM_BEFORE, TO_BEFORE]);
    await expectHistory(page, { undo: false, redo: true });
    await worker.evaluate(async (id) => {
      await chrome.windows.remove(id);
    }, c.windowId);
    await expectStrips(worker, [b, c], [FROM_BEFORE, []]);

    await redoKey(page);
    await expectRefusedToast(page, REDO_WINDOW_CLOSED);
    await expectStrips(worker, [b], [FROM_BEFORE]);
    await expectTitle(page, TITLE);

    // The next press reaches the older rename only.
    await redoKey(page);
    await expectTitle(page, RENAMED);
    await expectHistory(page, { undo: true, redo: true });
    await expectStrips(worker, [b], [FROM_BEFORE]);
  });
});

// ---- Toasts and the held key (R16, R20) ---------------------------------------------

test('a saved toast loses its Undo after a drag', async ({
  context,
  extensionId,
  serviceWorker: worker,
}) => {
  const page = await openView(context, extensionId, [
    session('S2', 'Other', [savedWindow('w2', 'Other')]),
  ]);
  const b = await openLive(worker, FROM_TABS);
  const c = await openLive(worker, TO_TABS);
  await shown(page, [b, c], ['b2', 'c1']);
  const ids = async () =>
    (await stored(page)).tabGroups.map((g) => g.tabGroupId);

  await page
    .locator('[data-pane="detail"] [data-tour-anchor="session-menu"]')
    .locator('[aria-haspopup="menu"]')
    .click();
  await page.getByRole('menuitem', { name: 'Delete session' }).click();
  await expect.poll(ids).toEqual(['S2']);
  await expect(toasts(page)).toContainText('Session deleted.');
  const chip = page
    .getByRole('status')
    .getByRole('button', { name: 'Undo', exact: true });
  // PREMISE: the delete's toast offers Undo.
  await expect(chip).toHaveCount(1);

  await dragTab(page, b.tab('b1'), c.tab('c1'));
  await expectStrips(worker, [b, c], [FROM_AFTER, TO_AFTER]);

  // The drag is the newest step: the chip goes, the text stays.
  await expect(chip).toHaveCount(0);
  await expect(toasts(page)).toContainText('Session deleted.');

  // ⌘Z undoes the drag first, then the delete.
  await undoKey(page);
  await expectStrips(worker, [b, c], [FROM_BEFORE, TO_BEFORE]);
  await expectHistory(page, { undo: true, redo: true });
  expect(await ids()).toEqual(['S2']);
  await undoKey(page);
  await expect.poll(ids).toContain('S1');
  await expectStrips(worker, [b, c], [FROM_BEFORE, TO_BEFORE]);
});

test('a held ⌘Z after a live step undoes nothing more', async ({
  context,
  extensionId,
  serviceWorker: worker,
}) => {
  const { page, b, c } = await exampleWindows(context, extensionId, worker);
  await renameShown(page, TITLE, RENAMED);
  await dragTab(page, b.tab('b1'), c.tab('c1'));
  await expectStrips(worker, [b, c], [FROM_AFTER, TO_AFTER]);
  const keys: { key: string; repeat: boolean }[] = [];
  await page.exposeFunction(
    'kan744Key',
    (key: string, repeat: boolean) => void keys.push({ key, repeat })
  );
  await page.evaluate(() => {
    window.addEventListener(
      'keydown',
      (e) => {
        const record: unknown = Reflect.get(window, 'kan744Key');
        if (typeof record === 'function') record(e.key, e.repeat);
      },
      true
    );
  });

  // The first down undoes the drag; the later downs are the key's auto-repeats.
  await page.keyboard.down('ControlOrMeta');
  await page.keyboard.down('z');
  await settled(page);
  await expectStrips(worker, [b, c], [FROM_BEFORE, TO_BEFORE]);
  await expectHistory(page, { undo: true, redo: true });
  await page.keyboard.down('z');
  await page.keyboard.down('z');
  // CONTROL: both reached the page as repeats.
  await expect
    .poll(() => keys.filter((k) => k.key === 'z').map((k) => k.repeat))
    .toEqual([false, true, true]);
  // A dropped repeat does nothing; a taken one would undo the rename at once.
  for (let sample = 0; sample < 10; sample++) {
    expect(await savedTitle(page)).toBe(RENAMED);
    await page.waitForTimeout(100);
  }
  await page.keyboard.up('z');
  await page.keyboard.up('ControlOrMeta');

  // Let go, a fresh press reaches the rename.
  await undoKey(page);
  await expectTitle(page, TITLE);
  await expectStrips(worker, [b, c], [FROM_BEFORE, TO_BEFORE]);
});
