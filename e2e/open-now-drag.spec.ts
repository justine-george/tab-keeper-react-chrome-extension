import type { BrowserContext, Locator, Page, Worker } from '@playwright/test';

import { test as ungrantedTest } from './fixtures/extension';
import { grantedTest as test, expect } from './fixtures/grantedExtension';
import { seedSettings } from './fixtures/seed';

// KAN-280 Part E (spec O11-O11h) on the real artifact: a drag in Open now
// moves the real Chrome tabs. What jsdom and the chrome fake cannot show:
// Chrome's own answer to each call, the engine's geometry in a real layout,
// the live re-read after the drop, and which tab is each window's front tab
// afterwards.
//
// "Where the user pointed" is the drag PREVIEW at the instant of release (a
// capture-phase pointerup, before the engine's own handler): the landing
// slot's window and its place among that window's rows, and the band lit
// for a join. Every drop asserts that Chrome, and the re-read list, put the
// row exactly there. Predicting from rects misread two KAN-129 probes.
//
// On main's build Open now has no drag at all, so every case below first
// requires that the row was PICKED UP. That is also what keeps the refusal
// cases honest: "no slot in the other window" holds trivially for a row that
// was never held.
//
// Every tab here is a data: page in a window the worker opens unfocused, so
// the tab view stays the page under the pointer. Tab Keeper's own page is in
// the launch window ("This window"), and Open now never lists it.

const TAB_VIEWPORT = { width: 1280, height: 800 };
const NARROW_VIEWPORT = { width: 1024, height: 768 };
const VIEW_TAB = 'index.html?view=tab';

// The engine auto-scrolls while the pointer is this close to the pane's top
// or bottom (RowDragArea's EDGE_ZONE_PX).
const EDGE_ZONE_PX = 48;

const dataUrl = (title: string) =>
  `data:text/html,${encodeURIComponent(`<title>${title}</title>`)}`;

// ---- What the page shows ----------------------------------------------------

type Scope = 'tabs' | 'items';

// The drag as the user sees it at one instant.
interface Preview {
  // The held row's drag id: a tab id, or "group:ID" / "tab:ID" for items.
  held: string | null;
  // The window the landing slot is drawn in, null when no slot is drawn.
  windowId: number | null;
  // How many of that window's other rows (tab rows, or items) are above the
  // slot once every row has reached its commanded place.
  index: number | null;
  // The group bands lit as the drop's target (KAN-164).
  lit: string[];
}

declare global {
  interface Window {
    __openNowPreview?: (scope: Scope) => Preview;
    __openNowAtRelease?: Preview | null;
    // The pane's scrollTop at the release and on each frame after it, up to
    // the frame the re-read reorders the rows (rereadAt, null if none did).
    __openNowScrollLog?: { beforeReread: number[]; rereadAt: number | null };
  }
}

// Installs, in the page, the one reading of the preview that every assertion
// uses, during a hold and at release alike. Positions are COMMANDED ones: a
// row's current box, minus the part of its transform still easing, plus the
// transform it was told to take (rows ease over DURATION.MOVE).
async function installPreviewReader(page: Page): Promise<void> {
  await page.evaluate(() => {
    const commanded = (el: HTMLElement) =>
      Number(/translateY\((-?[\d.]+)px\)/.exec(el.style.transform)?.[1] ?? 0);
    const current = (el: HTMLElement) =>
      new DOMMatrixReadOnly(getComputedStyle(el).transform).m42;
    const centreOf = (el: HTMLElement) => {
      const r = el.getBoundingClientRect();
      return r.top - current(el) + commanded(el) + r.height / 2;
    };
    window.__openNowPreview = (scope) => {
      const heldEl = document.querySelector('[data-drag-held]');
      const held = heldEl?.getAttribute('data-drag-row-id') ?? null;
      const lit = [...document.querySelectorAll('[data-drop-target]')].map(
        (band) => band.getAttribute('data-band-id') ?? ''
      );
      const slot = document.querySelector('[data-drag-landing-slot]');
      if (slot === null) return { held, windowId: null, index: null, lit };
      const box = slot.getBoundingClientRect();
      const c = (box.top + box.bottom) / 2;
      // The slot's window: the last block starting above its centre. A slot
      // at a window's end can sit past that block's own bottom.
      const blocks = [
        ...document.querySelectorAll<HTMLElement>('[data-open-window-id]'),
      ];
      const block = blocks
        .filter((b) => b.getBoundingClientRect().top <= c)
        .pop();
      if (block === undefined)
        return { held, windowId: null, index: null, lit };
      const rows =
        scope === 'tabs'
          ? [...block.querySelectorAll('[data-open-tab-id]')].flatMap((row) => {
              const wrapper = row.closest<HTMLElement>('[data-drag-row-id]');
              return wrapper === null ? [] : [wrapper];
            })
          : [
              ...block.querySelectorAll<HTMLElement>(
                '[data-drag-row-id^="tab:"], [data-drag-row-id^="group:"]'
              ),
            ];
      const index = rows.filter(
        (row) => !row.hasAttribute('data-drag-held') && centreOf(row) < c
      ).length;
      return {
        held,
        windowId: Number(block.getAttribute('data-open-window-id')),
        index,
        lit,
      };
    };
  });
}

const previewNow = (page: Page, scope: Scope): Promise<Preview | null> =>
  page.evaluate((scope) => window.__openNowPreview?.(scope) ?? null, scope);

// The preview at the instant of release, recorded before the engine's own
// pointerup handler runs.
async function armReleaseRecorder(page: Page, scope: Scope): Promise<void> {
  await page.evaluate((scope) => {
    window.__openNowAtRelease = null;
    window.addEventListener(
      'pointerup',
      () => {
        window.__openNowAtRelease = window.__openNowPreview?.(scope) ?? null;
      },
      { capture: true, once: true }
    );
  }, scope);
}

const previewAtRelease = (page: Page): Promise<Preview | null> =>
  page.evaluate(() => window.__openNowAtRelease ?? null);

// A window's tab rows in the order the list shows them.
const shownOrder = (page: Page, windowId: number): Promise<number[]> =>
  page.evaluate(
    (windowId) =>
      [
        ...document.querySelectorAll(
          `[data-open-window-id="${windowId}"] [data-open-tab-id]`
        ),
      ].map((row) => Number(row.getAttribute('data-open-tab-id'))),
    windowId
  );

// Where the list shows a tab: its window, its place among that window's tab
// rows, the band it is drawn in, and its item's place among the window's
// items (a group counts once).
interface Shown {
  windowId: number;
  index: number;
  band: string | null;
  item: number;
}
const shownPlace = (page: Page, tabId: number): Promise<Shown | null> =>
  page.evaluate((tabId) => {
    const row = document.querySelector(`[data-open-tab-id="${tabId}"]`);
    const block = row?.closest('[data-open-window-id]');
    if (!row || !block) return null;
    const rows = [...block.querySelectorAll('[data-open-tab-id]')];
    const items = [
      ...block.querySelectorAll(
        '[data-drag-row-id^="tab:"], [data-drag-row-id^="group:"]'
      ),
    ];
    return {
      windowId: Number(block.getAttribute('data-open-window-id')),
      index: rows.indexOf(row),
      band: row.closest('[data-band-id]')?.getAttribute('data-band-id') ?? null,
      item: items.findIndex((item) => item.contains(row)),
    };
  }, tabId);

// ---- What Chrome has ---------------------------------------------------------

// Where chrome.* calls run: the worker, or any extension page (after the
// incognito staging reloads the extension, its worker is gone).
type ChromeContext = Pick<Worker, 'evaluate'>;

interface ChromeTab {
  id: number;
  windowId: number;
  index: number;
  groupId: number;
  pinned: boolean;
  active: boolean;
}

// Every tab of a window, in Chrome's order, Tab Keeper pages included.
const chromeWindow = (
  worker: ChromeContext,
  windowId: number
): Promise<ChromeTab[]> =>
  worker.evaluate(async (windowId) => {
    const tabs = await chrome.tabs.query({ windowId });
    return tabs.flatMap((tab) =>
      tab.id === undefined
        ? []
        : [
            {
              id: tab.id,
              windowId: tab.windowId,
              index: tab.index,
              groupId: tab.groupId,
              pinned: tab.pinned,
              active: tab.active,
            },
          ]
    );
  }, windowId);

const chromeOrder = async (worker: ChromeContext, windowId: number) =>
  (await chromeWindow(worker, windowId)).map((tab) => tab.id);

const frontTab = async (worker: ChromeContext, windowId: number) =>
  (await chromeWindow(worker, windowId)).find((tab) => tab.active)?.id ?? null;

const chromeTab = (
  worker: ChromeContext,
  tabId: number
): Promise<ChromeTab | null> =>
  worker.evaluate(async (tabId) => {
    try {
      const tab = await chrome.tabs.get(tabId);
      return {
        id: tabId,
        windowId: tab.windowId,
        index: tab.index,
        groupId: tab.groupId,
        pinned: tab.pinned,
        active: tab.active,
      };
    } catch {
      return null;
    }
  }, tabId);

const groupLook = (worker: ChromeContext, groupId: number) =>
  worker.evaluate(async (groupId) => {
    const group = await chrome.tabGroups.get(groupId);
    return { title: group.title ?? '', color: group.color };
  }, groupId);

// A window's order and the one group `tabIds` share, with that group's look,
// read in ONE call: a G1 move is three Chrome calls (tabs.move, tabs.group,
// tabGroups.update; openNowMoves' moveAsNewGroup), and separate reads taken
// between them can each see a different step. `group` is null unless every
// one of `tabIds` is in the same group.
const groupedEndState = (
  worker: ChromeContext,
  windowId: number,
  tabIds: number[]
) =>
  worker.evaluate(
    async ({ windowId, tabIds }) => {
      const tabs = await chrome.tabs.query({ windowId });
      const ids = new Set(
        tabIds.map((id) => tabs.find((tab) => tab.id === id)?.groupId ?? -1)
      );
      const [only] = [...ids];
      const group =
        ids.size === 1 && only !== undefined && only !== -1 ? only : null;
      const look = group === null ? null : await chrome.tabGroups.get(group);
      return {
        order: tabs.flatMap((tab) => (tab.id === undefined ? [] : [tab.id])),
        group,
        title: look?.title ?? null,
        color: look?.color ?? null,
      };
    },
    { windowId, tabIds }
  );

// ---- Staging -----------------------------------------------------------------

// A window the spec made, and its tabs' ids by the titles it was made
// with: `tab` answers only for those titles, so a typo does not compile.
interface Made<T extends string> {
  windowId: number;
  tab: (title: T) => number;
}

function made<T extends string>(
  windowId: number,
  titles: readonly T[],
  tabIds: readonly number[]
): Made<T> {
  const ids = new Map<T, number>();
  titles.forEach((title, i) => {
    const id = tabIds[i];
    if (id === undefined) throw new Error(`Chrome gave no id for ${title}`);
    ids.set(title, id);
  });
  return {
    windowId,
    tab: (title) => {
      const id = ids.get(title);
      if (id === undefined) throw new Error(`no tab titled ${title}`);
      return id;
    },
  };
}

// A window the browser opens, unfocused so the tab view stays in front, with
// one tab per title, in order.
async function openWindow<T extends string>(
  worker: ChromeContext,
  titles: readonly T[]
): Promise<Made<T>> {
  const opened = await worker.evaluate(async (urls: string[]) => {
    const win = await chrome.windows.create({ focused: false, url: urls });
    const tabIds = (win?.tabs ?? []).flatMap((tab) =>
      tab.id === undefined ? [] : [tab.id]
    );
    if (win?.id === undefined || tabIds.length !== urls.length) return null;
    return { windowId: win.id, tabIds };
  }, titles.map(dataUrl));
  if (opened === null) throw new Error('Chrome gave no window or tab ids');
  return made(opened.windowId, titles, opened.tabIds);
}

const makeGroup = (
  worker: ChromeContext,
  windowId: number,
  tabIds: [number, ...number[]],
  title: string,
  color: `${chrome.tabGroups.Color}`
): Promise<number> =>
  worker.evaluate(
    async ({ windowId, tabIds, title, color }) => {
      const groupId = await chrome.tabs.group({
        tabIds,
        createProperties: { windowId },
      });
      await chrome.tabGroups.update(groupId, { title, color });
      return groupId;
    },
    { windowId, tabIds, title, color }
  );

const activate = (worker: ChromeContext, tabId: number) =>
  worker.evaluate(async (id) => {
    await chrome.tabs.update(id, { active: true });
  }, tabId);

const pin = (worker: ChromeContext, tabIds: number[]) =>
  worker.evaluate(async (ids: number[]) => {
    for (const id of ids) await chrome.tabs.update(id, { pinned: true });
  }, tabIds);

async function openTabView(
  context: BrowserContext,
  extensionId: string,
  viewport = TAB_VIEWPORT
): Promise<Page> {
  const page = await context.newPage();
  await page.setViewportSize(viewport);
  await page.goto(`chrome-extension://${extensionId}/${VIEW_TAB}`);
  // Barrier: goto resolves before React mounts.
  await page.getByRole('button', { name: 'Sort sessions' }).waitFor();
  await installPreviewReader(page);
  return page;
}

// Waits until the list shows every given window as Chrome has it, less Tab
// Keeper's own pages.
async function listMatchesChrome(
  page: Page,
  worker: ChromeContext,
  windowIds: number[],
  extensionId: string
): Promise<void> {
  const chromeShown = async (windowId: number) => {
    const tabs = await worker.evaluate(
      async ({ windowId, prefix }) =>
        (await chrome.tabs.query({ windowId })).flatMap((tab) =>
          tab.id === undefined || (tab.url ?? '').startsWith(prefix)
            ? []
            : [tab.id]
        ),
      { windowId, prefix: `chrome-extension://${extensionId}/` }
    );
    return tabs;
  };
  await expect
    .poll(
      async () => {
        const out: string[] = [];
        for (const id of windowIds) {
          const [shown, chromeHas] = await Promise.all([
            shownOrder(page, id),
            chromeShown(id),
          ]);
          out.push(
            JSON.stringify(shown) === JSON.stringify(chromeHas)
              ? 'ok'
              : `${id}: shown ${shown} chrome ${chromeHas}`
          );
        }
        return out.join(' | ');
      },
      { message: 'the list never showed what Chrome has' }
    )
    .toBe(windowIds.map(() => 'ok').join(' | '));
}

// ---- Dragging ----------------------------------------------------------------

const tabRow = (page: Page, tabId: number): Locator =>
  page.locator(`[data-open-tab-id="${tabId}"]`);

// A group's title row, found by its title so the same locator works on a
// build whose rows carry no drag markers.
const groupTitle = (page: Page, windowId: number, title: string): Locator =>
  page
    .locator(`[data-open-window-id="${windowId}"]`)
    .getByText(title, { exact: true });

async function boxOf(target: Locator) {
  const box = await target.boundingBox();
  if (box === null) throw new Error('the target has no box');
  return box;
}

// Presses on `target` and moves past the activation distance, then requires
// that a row is held. On a build where Open now has no drag this is where
// every case fails.
async function pickUp(page: Page, target: Locator) {
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
  return { x, y: y + 10 };
}

// Moves the held row, then rests past DURATION.MOVE (200ms) so the rows have
// eased to their commanded places, as a user pausing to aim sees them. The
// preview reader reads commanded places either way.
async function moveTo(page: Page, x: number, y: number) {
  await page.mouse.move(x, y, { steps: 10 });
  await page.waitForTimeout(350);
}

async function release(page: Page, scope: Scope): Promise<Preview> {
  await armReleaseRecorder(page, scope);
  await page.mouse.up();
  const preview = await previewAtRelease(page);
  if (preview === null) throw new Error('nothing recorded at release');
  return preview;
}

// The whole gesture for a tab row: pick it up, go to the point `aim` names
// once the drag is live (rows are measured at pick-up), release.
async function dragTab(
  page: Page,
  tabId: number,
  aim: () => Promise<number>
): Promise<Preview> {
  const { x } = await pickUp(page, tabRow(page, tabId));
  await moveTo(page, x, await aim());
  return release(page, 'tabs');
}

// A point just inside a row's top edge: above its midpoint, so the slot
// opens before it (and inside its band, when it is a group member).
const justInside = async (page: Page, tabId: number) =>
  (await boxOf(tabRow(page, tabId))).y + 6;

// A point just below a row: past its midpoint, so the slot opens after it.
const justBelow = async (page: Page, tabId: number) => {
  const box = await boxOf(tabRow(page, tabId));
  return box.y + box.height - 6;
};

// The pane Open now scrolls in.
const paneOf = (page: Page) =>
  page.evaluate(() => {
    let el =
      document.querySelector('[data-open-window-id]')?.parentElement ?? null;
    while (el && !['auto', 'scroll'].includes(getComputedStyle(el).overflowY))
      el = el.parentElement;
    if (el === null) return null;
    const r = el.getBoundingClientRect();
    return {
      top: r.top,
      bottom: r.bottom,
      scrollTop: el.scrollTop,
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
    };
  });

async function paneFits(page: Page) {
  const pane = await paneOf(page);
  if (pane === null) throw new Error('no scrolling pane');
  // PREMISE: nothing scrolls, so no drag here auto-scrolls.
  expect(pane.scrollHeight).toBeLessThanOrEqual(pane.clientHeight);
}

// Whether Chrome and the list agree that a drop landed where the preview
// showed: the same window, the same place among that window's shown rows,
// and the lit band's group (or none).
async function expectLandedAsPreviewed(
  page: Page,
  tabId: number,
  preview: Preview
) {
  expect(preview.windowId, 'the preview showed no slot').not.toBeNull();
  const shown = await shownPlace(page, tabId);
  expect(shown).not.toBeNull();
  expect({
    windowId: shown?.windowId,
    index: shown?.index,
    band: shown?.band ?? null,
  }).toEqual({
    windowId: preview.windowId,
    index: preview.index,
    band: preview.lit[0] ?? null,
  });
}

// The refused preview, exactly: where a release would be refused, the
// engine draws the row going back where it came from -- its own slot open in
// its own window, no row stepping aside, no band lit (RowDragArea, KAN-172).
// So every refusal is held to that at each point AND at the release, and the
// release must then leave the row there, as that preview promised.
const refusedPreview = (held: string, home: Shown, scope: Scope): Preview => ({
  held,
  windowId: home.windowId,
  index: scope === 'tabs' ? home.index : home.item,
  lit: [],
});

// Holds a tab over each point `aims` names, in windows that refuse it, then
// releases on the last. The tab must be back at `home` in Chrome and in the
// list, as the preview at release showed.
async function expectTabRefused(
  page: Page,
  chromeContext: ChromeContext,
  tabId: number,
  aims: (() => Promise<number>)[],
  windowIds: number[],
  extensionId: string
) {
  const home = await shownPlace(page, tabId);
  if (home === null) throw new Error('the tab is not listed');
  const expected = refusedPreview(String(tabId), home, 'tabs');
  const { x } = await pickUp(page, tabRow(page, tabId));
  for (const aim of aims) {
    await moveTo(page, x, await aim());
    expect(await previewNow(page, 'tabs')).toEqual(expected);
  }
  const preview = await release(page, 'tabs');
  expect(preview).toEqual(expected);
  // A move lands within ~15ms of its call (Task 1 Q6); a refused release
  // makes none, so after this the list has nothing left to catch up on.
  await page.waitForTimeout(500);
  expect(await chromeTab(chromeContext, tabId)).toMatchObject({
    windowId: home.windowId,
  });
  await listMatchesChrome(page, chromeContext, windowIds, extensionId);
  await expectLandedAsPreviewed(page, tabId, preview);
}

// ---- 1-4: moves ---------------------------------------------------------------

test.describe('a drop moves the real tabs where the preview showed (KAN-280 O11, O11b)', () => {
  test('1. a tab reordered within its window', async ({
    context,
    extensionId,
    serviceWorker: worker,
  }) => {
    const page = await openTabView(context, extensionId);
    const a = await openWindow(worker, ['a0', 'a1', 'a2', 'a3']);
    await expect(tabRow(page, a.tab('a3'))).toBeVisible();
    await paneFits(page);

    const preview = await dragTab(page, a.tab('a3'), () =>
      justInside(page, a.tab('a1'))
    );
    expect(preview).toMatchObject({ windowId: a.windowId, index: 1 });

    await expect
      .poll(() => chromeOrder(worker, a.windowId))
      .toEqual([a.tab('a0'), a.tab('a3'), a.tab('a1'), a.tab('a2')]);
    await listMatchesChrome(page, worker, [a.windowId], extensionId);
    await expectLandedAsPreviewed(page, a.tab('a3'), preview);
  });

  test('2. a tab moved into another window', async ({
    context,
    extensionId,
    serviceWorker: worker,
  }) => {
    const page = await openTabView(context, extensionId);
    const a = await openWindow(worker, ['a0', 'a1', 'a2']);
    const b = await openWindow(worker, ['b0', 'b1', 'b2']);
    await expect(tabRow(page, b.tab('b2'))).toBeVisible();
    await paneFits(page);
    const fronts = [
      await frontTab(worker, a.windowId),
      await frontTab(worker, b.windowId),
    ];

    const preview = await dragTab(page, a.tab('a1'), () =>
      justInside(page, b.tab('b1'))
    );
    expect(preview).toMatchObject({ windowId: b.windowId, index: 1 });

    await expect
      .poll(() => chromeOrder(worker, b.windowId))
      .toEqual([b.tab('b0'), a.tab('a1'), b.tab('b1'), b.tab('b2')]);
    expect(await chromeOrder(worker, a.windowId)).toEqual([
      a.tab('a0'),
      a.tab('a2'),
    ]);
    await listMatchesChrome(
      page,
      worker,
      [a.windowId, b.windowId],
      extensionId
    );
    await expectLandedAsPreviewed(page, a.tab('a1'), preview);
    // An inactive tab: neither window's front tab changes (Task 1 Q5).
    expect([
      await frontTab(worker, a.windowId),
      await frontTab(worker, b.windowId),
    ]).toEqual(fronts);
  });

  test('3. a tab moved into a group, and out of it', async ({
    context,
    extensionId,
    serviceWorker: worker,
  }) => {
    const page = await openTabView(context, extensionId);
    const a = await openWindow(worker, ['a0', 'g1', 'g2', 'a3']);
    const g = await makeGroup(
      worker,
      a.windowId,
      [a.tab('g1'), a.tab('g2')],
      'Grp',
      'blue'
    );
    await expect(tabRow(page, a.tab('a3'))).toBeVisible();
    await expect(groupTitle(page, a.windowId, 'Grp')).toBeVisible();
    await paneFits(page);

    // Into: a3 between g1 and g2, inside the band.
    const into = await dragTab(page, a.tab('a3'), () =>
      justInside(page, a.tab('g2'))
    );
    expect(into).toMatchObject({
      windowId: a.windowId,
      index: 2,
      lit: [String(g)],
    });
    await expect
      .poll(async () => (await chromeTab(worker, a.tab('a3')))?.groupId)
      .toBe(g);
    expect(await chromeOrder(worker, a.windowId)).toEqual([
      a.tab('a0'),
      a.tab('g1'),
      a.tab('a3'),
      a.tab('g2'),
    ]);
    await listMatchesChrome(page, worker, [a.windowId], extensionId);
    await expectLandedAsPreviewed(page, a.tab('a3'), into);

    // Out: g1 above a0, outside every band.
    const out = await dragTab(page, a.tab('g1'), () =>
      justInside(page, a.tab('a0'))
    );
    expect(out).toMatchObject({ windowId: a.windowId, index: 0, lit: [] });
    await expect
      .poll(async () => (await chromeTab(worker, a.tab('g1')))?.groupId)
      .toBe(-1);
    expect(await chromeOrder(worker, a.windowId)).toEqual([
      a.tab('g1'),
      a.tab('a0'),
      a.tab('a3'),
      a.tab('g2'),
    ]);
    await listMatchesChrome(page, worker, [a.windowId], extensionId);
    await expectLandedAsPreviewed(page, a.tab('g1'), out);
  });
});

// A group is held by its title row, and the held group folds to that row
// (App.css, KAN-160), so every aim is read AFTER the pick-up.
async function dragGroup(
  page: Page,
  windowId: number,
  title: string,
  aim: () => Promise<number>
): Promise<Preview> {
  const { x } = await pickUp(page, groupTitle(page, windowId, title));
  await page.waitForTimeout(350);
  await moveTo(page, x, await aim());
  return release(page, 'items');
}

// A PROBE, not an assertion: samples the windows' rows and bands on every
// frame from now until stopped, keeping each distinct picture once, and the
// test attaches them. Whether a multi-call move shows an intermediate state
// after the hold ends (ledger, Task 6c) is recorded for review; headless
// runs so far show none (Task 8 report), but CI timing is not promised.
async function startSampling(page: Page, windowIds: number[]) {
  await page.evaluate((windowIds) => {
    const seen: string[] = [];
    const sample = () => {
      const picture = windowIds
        .map((id) =>
          [
            ...document.querySelectorAll(
              `[data-open-window-id="${id}"] [data-open-tab-id]`
            ),
          ]
            .map((row) => {
              const band = row.closest('[data-band-id]');
              return `${row.getAttribute('data-open-tab-id')}${
                band ? '@' + band.getAttribute('data-band-id') : ''
              }`;
            })
            .join(',')
        )
        .join(' | ');
      if (seen[seen.length - 1] !== picture) seen.push(picture);
      if (!document.documentElement.hasAttribute('data-stop-sampling'))
        requestAnimationFrame(sample);
    };
    document.documentElement.removeAttribute('data-stop-sampling');
    document.documentElement.setAttribute('data-samples', '[]');
    const keep = () => {
      document.documentElement.setAttribute(
        'data-samples',
        JSON.stringify(seen)
      );
      if (!document.documentElement.hasAttribute('data-stop-sampling'))
        setTimeout(keep, 50);
    };
    requestAnimationFrame(sample);
    keep();
  }, windowIds);
}

async function stopSampling(page: Page): Promise<string[]> {
  await page.waitForTimeout(120);
  return page.evaluate(() => {
    document.documentElement.setAttribute('data-stop-sampling', '');
    const raw = document.documentElement.getAttribute('data-samples') ?? '[]';
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((s): s is string => typeof s === 'string')
      : [];
  });
}

test.describe('a whole group (KAN-280 O11a Q1, O11g G1)', () => {
  test('4a. within its window, by tabGroups.move: same id, same look', async ({
    context,
    extensionId,
    serviceWorker: worker,
  }) => {
    const page = await openTabView(context, extensionId);
    const a = await openWindow(worker, ['a0', 'g1', 'g2', 'a3', 'a4']);
    const g = await makeGroup(
      worker,
      a.windowId,
      [a.tab('g1'), a.tab('g2')],
      'Grp',
      'blue'
    );
    await activate(worker, a.tab('a0'));
    await expect(groupTitle(page, a.windowId, 'Grp')).toBeVisible();
    await paneFits(page);

    // Below a3, above a4: items [a0, a3, G, a4] with the group lifted out.
    const preview = await dragGroup(page, a.windowId, 'Grp', () =>
      justInside(page, a.tab('a4'))
    );
    expect(preview).toMatchObject({ windowId: a.windowId, index: 2 });

    await expect
      .poll(() => chromeOrder(worker, a.windowId))
      .toEqual([
        a.tab('a0'),
        a.tab('a3'),
        a.tab('g1'),
        a.tab('g2'),
        a.tab('a4'),
      ]);
    expect((await chromeTab(worker, a.tab('g1')))?.groupId).toBe(g);
    expect(await groupLook(worker, g)).toEqual({ title: 'Grp', color: 'blue' });
    await listMatchesChrome(page, worker, [a.windowId], extensionId);
    expect((await shownPlace(page, a.tab('g1')))?.item).toBe(preview.index);
    expect(await frontTab(worker, a.windowId)).toBe(a.tab('a0'));
  });

  test('4b. into another window, by tabGroups.move: same id, same look, no front tab changes', async ({
    context,
    extensionId,
    serviceWorker: worker,
  }) => {
    const page = await openTabView(context, extensionId);
    const a = await openWindow(worker, ['a0', 'g1', 'g2', 'a3']);
    const b = await openWindow(worker, ['b0', 'b1', 'b2']);
    const g = await makeGroup(
      worker,
      a.windowId,
      [a.tab('g1'), a.tab('g2')],
      'Grp',
      'red'
    );
    await activate(worker, a.tab('a0'));
    await expect(groupTitle(page, a.windowId, 'Grp')).toBeVisible();
    await expect(tabRow(page, b.tab('b2'))).toBeVisible();
    await paneFits(page);

    const preview = await dragGroup(page, a.windowId, 'Grp', () =>
      justInside(page, b.tab('b1'))
    );
    expect(preview).toMatchObject({ windowId: b.windowId, index: 1 });

    await expect
      .poll(() => chromeOrder(worker, b.windowId))
      .toEqual([
        b.tab('b0'),
        a.tab('g1'),
        a.tab('g2'),
        b.tab('b1'),
        b.tab('b2'),
      ]);
    expect(await chromeOrder(worker, a.windowId)).toEqual([
      a.tab('a0'),
      a.tab('a3'),
    ]);
    expect((await chromeTab(worker, a.tab('g1')))?.groupId).toBe(g);
    expect(await groupLook(worker, g)).toEqual({ title: 'Grp', color: 'red' });
    await listMatchesChrome(
      page,
      worker,
      [a.windowId, b.windowId],
      extensionId
    );
    expect((await shownPlace(page, a.tab('g1')))?.item).toBe(preview.index);
    expect(await frontTab(worker, a.windowId)).toBe(a.tab('a0'));
    expect(await frontTab(worker, b.windowId)).toBe(b.tab('b0'));
  });

  // G1: tabGroups.move would make g1 the destination's front tab (Task 1
  // Q5), so the tabs move with tabs.move and are grouped again. Chrome's
  // neighbour rule in the source: g1 leaving hands the front to its group
  // mate g2, and g2 leaving hands it to the tab after the run, a3 (Task 6a
  // Q1: W1 [a, b*]).
  test("4c. G1: a group holding its window's front tab arrives behind, with its look, and the source shows its neighbour", async ({
    context,
    extensionId,
    serviceWorker: worker,
  }) => {
    const page = await openTabView(context, extensionId);
    const self = await page.evaluate(() => chrome.tabs.getCurrent());
    if (self?.id === undefined) throw new Error('the tab view is not a tab');
    const a = await openWindow(worker, ['a0', 'g1', 'g2', 'a3']);
    const b = await openWindow(worker, ['b0', 'b1', 'b2']);
    const g = await makeGroup(
      worker,
      a.windowId,
      [a.tab('g1'), a.tab('g2')],
      'Front',
      'green'
    );
    await activate(worker, a.tab('g1'));
    // PREMISE: g1 is A's front tab, b0 is B's.
    expect(await frontTab(worker, a.windowId)).toBe(a.tab('g1'));
    expect(await frontTab(worker, b.windowId)).toBe(b.tab('b0'));
    await expect(groupTitle(page, a.windowId, 'Front')).toBeVisible();
    await expect(tabRow(page, b.tab('b2'))).toBeVisible();
    await paneFits(page);

    const { x } = await pickUp(page, groupTitle(page, a.windowId, 'Front'));
    await page.waitForTimeout(350);
    await moveTo(page, x, await justInside(page, b.tab('b1')));
    await startSampling(page, [a.windowId, b.windowId]);
    const preview = await release(page, 'items');
    expect(preview).toMatchObject({ windowId: b.windowId, index: 1 });

    // The whole end state in one poll: B's order, g1 and g2 in one group
    // other than g, and that group's look.
    const moved = [a.tab('g1'), a.tab('g2')];
    await expect
      .poll(async () => {
        const end = await groupedEndState(worker, b.windowId, moved);
        return { ...end, group: end.group !== null && end.group !== g };
      })
      .toEqual({
        order: [
          b.tab('b0'),
          a.tab('g1'),
          a.tab('g2'),
          b.tab('b1'),
          b.tab('b2'),
        ],
        group: true,
        title: 'Front',
        color: 'green',
      });
    await listMatchesChrome(
      page,
      worker,
      [a.windowId, b.windowId],
      extensionId
    );
    const pictures = await stopSampling(page);
    await test.info().attach('4c-flicker-samples', {
      body: JSON.stringify(pictures, null, 2),
      contentType: 'application/json',
    });
    expect((await shownPlace(page, a.tab('g1')))?.item).toBe(preview.index);
    // Every window's front tab, as Chrome's neighbour rule says: B keeps b0,
    // and A shows the tab after the group's run.
    expect(await frontTab(worker, b.windowId)).toBe(b.tab('b0'));
    expect(await frontTab(worker, a.windowId)).toBe(a.tab('a3'));
    expect(await frontTab(worker, self.windowId)).toBe(self.id);
  });
});

// ---- 5: pinned -----------------------------------------------------------------

test.describe('the pinned boundary (KAN-280 O11c, K1)', () => {
  test('5a. an unpinned tab held over the pinned run is never shown a slot in it, and lands just below it', async ({
    context,
    extensionId,
    serviceWorker: worker,
  }) => {
    // Pinned before the tab view opens, so its first read has them: a
    // premise that holds on any build (main's rows have no pin mark).
    const a = await openWindow(worker, ['p0', 'p1', 'a2', 'a3', 'a4']);
    await pin(worker, [a.tab('p0'), a.tab('p1')]);
    const page = await openTabView(context, extensionId);
    await expect(tabRow(page, a.tab('a4'))).toBeVisible();
    await paneFits(page);

    const { x } = await pickUp(page, tabRow(page, a.tab('a4')));
    // Over every point of the pinned run, the slot is below it.
    const top = (await boxOf(tabRow(page, a.tab('p0')))).y;
    const seen: (number | null)[] = [];
    for (const y of [top + 4, top + 16, top + 28, top + 36, top + 50]) {
      await moveTo(page, x, y);
      const preview = await previewNow(page, 'tabs');
      seen.push(preview?.index ?? null);
    }
    expect(seen).toEqual([2, 2, 2, 2, 2]);
    await moveTo(page, x, top + 4);
    const preview = await release(page, 'tabs');
    expect(preview).toMatchObject({ windowId: a.windowId, index: 2 });

    await expect
      .poll(() => chromeOrder(worker, a.windowId))
      .toEqual([
        a.tab('p0'),
        a.tab('p1'),
        a.tab('a4'),
        a.tab('a2'),
        a.tab('a3'),
      ]);
    expect((await chromeTab(worker, a.tab('a4')))?.pinned).toBe(false);
    await listMatchesChrome(page, worker, [a.windowId], extensionId);
    await expectLandedAsPreviewed(page, a.tab('a4'), preview);
  });

  test('5b. a pinned tab held below the run is only shown slots inside it, and stays pinned', async ({
    context,
    extensionId,
    serviceWorker: worker,
  }) => {
    // Pinned before the tab view opens, so its first read has them: a
    // premise that holds on any build (main's rows have no pin mark).
    const a = await openWindow(worker, ['p0', 'p1', 'a2', 'a3', 'a4']);
    await pin(worker, [a.tab('p0'), a.tab('p1')]);
    const page = await openTabView(context, extensionId);
    await expect(tabRow(page, a.tab('a4'))).toBeVisible();
    await paneFits(page);

    const { x } = await pickUp(page, tabRow(page, a.tab('p0')));
    const seen: (number | null)[] = [];
    for (const id of [a.tab('a2'), a.tab('a3'), a.tab('a4')]) {
      await moveTo(page, x, await justBelow(page, id));
      seen.push((await previewNow(page, 'tabs'))?.index ?? null);
    }
    // One other pinned tab: the run's slots are 0 and 1.
    expect(seen).toEqual([1, 1, 1]);
    const preview = await release(page, 'tabs');
    expect(preview).toMatchObject({ windowId: a.windowId, index: 1 });

    await expect
      .poll(() => chromeOrder(worker, a.windowId))
      .toEqual([
        a.tab('p1'),
        a.tab('p0'),
        a.tab('a2'),
        a.tab('a3'),
        a.tab('a4'),
      ]);
    expect((await chromeTab(worker, a.tab('p0')))?.pinned).toBe(true);
    await listMatchesChrome(page, worker, [a.windowId], extensionId);
    await expectLandedAsPreviewed(page, a.tab('p0'), preview);
  });

  test('5c. K1: a pinned tab held over another window is shown no slot there, and a release puts it back, pinned', async ({
    context,
    extensionId,
    serviceWorker: worker,
  }) => {
    // Pinned before the tab view opens, so its first read has them: a
    // premise that holds on any build (main's rows have no pin mark).
    const a = await openWindow(worker, ['p0', 'a1', 'a2']);
    const b = await openWindow(worker, ['b0', 'b1', 'b2']);
    await pin(worker, [a.tab('p0')]);
    const page = await openTabView(context, extensionId);
    await expect(tabRow(page, a.tab('a2'))).toBeVisible();
    await expect(tabRow(page, b.tab('b2'))).toBeVisible();
    await paneFits(page);

    // CONTROL: an unpinned tab held at the same point IS shown a slot in B.
    const control = await pickUp(page, tabRow(page, a.tab('a1')));
    await moveTo(page, control.x, await justInside(page, b.tab('b1')));
    expect(await previewNow(page, 'tabs')).toMatchObject({
      windowId: b.windowId,
      index: 1,
    });
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await page.waitForTimeout(300);
    // PREMISE: Escape cancelled the control; nothing moved.
    expect(await chromeOrder(worker, a.windowId)).toEqual([
      a.tab('p0'),
      a.tab('a1'),
      a.tab('a2'),
    ]);

    // Over each row of B, and released there: the refused preview (p0's
    // own slot, index 0 in A), and p0 back there.
    await expectTabRefused(
      page,
      worker,
      a.tab('p0'),
      [b.tab('b0'), b.tab('b1'), b.tab('b2')].map(
        (id) => () => justInside(page, id)
      ),
      [a.windowId, b.windowId],
      extensionId
    );
    expect(await chromeOrder(worker, b.windowId)).toEqual([
      b.tab('b0'),
      b.tab('b1'),
      b.tab('b2'),
    ]);
    expect(await chromeTab(worker, a.tab('p0'))).toMatchObject({
      windowId: a.windowId,
      index: 0,
      pinned: true,
    });
    await listMatchesChrome(
      page,
      worker,
      [a.windowId, b.windowId],
      extensionId
    );
  });
});

// ---- 6: incognito --------------------------------------------------------------

// What chrome://extensions offers its own page, as much of it as this spec
// uses. Not in @types/chrome: developerPrivate is Chrome's private API behind
// the extensions page.
interface DeveloperPrivate {
  updateProfileConfiguration(update: {
    inDeveloperMode: boolean;
  }): Promise<void>;
  updateExtensionConfiguration(update: {
    extensionId: string;
    incognitoAccess: boolean;
  }): Promise<void>;
  getExtensionInfo(id: string): Promise<{ state: string }>;
}

// Task 1 Q4's recipe: "Allow in Incognito" set from chrome://extensions,
// with developer mode on first (without it the unpacked copy reloads
// DISABLED). The extension reloads, which closes its pages and stops its
// worker for good, so everything after this runs from an extension page.
async function allowInIncognito(context: BrowserContext, extensionId: string) {
  const settings = await context.newPage();
  await settings.goto('chrome://extensions');
  const state = await settings.evaluate(async (id) => {
    const found: unknown = Reflect.get(chrome, 'developerPrivate');
    const isDeveloperPrivate = (x: unknown): x is DeveloperPrivate =>
      typeof x === 'object' &&
      x !== null &&
      typeof Reflect.get(x, 'updateProfileConfiguration') === 'function' &&
      typeof Reflect.get(x, 'updateExtensionConfiguration') === 'function' &&
      typeof Reflect.get(x, 'getExtensionInfo') === 'function';
    if (!isDeveloperPrivate(found)) return 'no developerPrivate';
    await found.updateProfileConfiguration({ inDeveloperMode: true });
    await new Promise((r) => setTimeout(r, 300));
    await found.updateExtensionConfiguration({
      extensionId: id,
      incognitoAccess: true,
    });
    for (let i = 0; i < 50; i++) {
      const info = await found.getExtensionInfo(id);
      if (info.state === 'ENABLED') return info.state;
      await new Promise((r) => setTimeout(r, 100));
    }
    return 'never re-enabled';
  }, extensionId);
  expect(state).toBe('ENABLED');
  await settings.close();
}

test("6. incognito and normal windows refuse each other's rows: no slot, and a release puts it back (O11d)", async ({
  context,
  extensionId,
}) => {
  await allowInIncognito(context, extensionId);
  const page = await openTabView(context, extensionId);
  // PREMISE: the staging took.
  expect(
    await page.evaluate(() => chrome.extension.isAllowedIncognitoAccess())
  ).toBe(true);

  const incognitoWindow = async <T extends string>(
    titles: readonly T[]
  ): Promise<Made<T>> => {
    const opened = await page.evaluate(async (urls: string[]) => {
      const win = await chrome.windows.create({
        focused: false,
        incognito: true,
        url: urls,
      });
      const tabIds = (win?.tabs ?? []).flatMap((tab) =>
        tab.id === undefined ? [] : [tab.id]
      );
      if (win?.id === undefined || win.incognito !== true) return null;
      return { windowId: win.id, tabIds };
    }, titles.map(dataUrl));
    if (opened === null) throw new Error('Chrome gave no incognito window');
    return made(opened.windowId, titles, opened.tabIds);
  };
  const n = await openWindow(page, ['n0', 'n1', 'n2']);
  const m = await openWindow(page, ['m0', 'm1', 'm2']);
  const i = await incognitoWindow(['i0', 'i1', 'i2']);
  const j = await incognitoWindow(['j0', 'j1']);
  const all = [n.windowId, m.windowId, i.windowId, j.windowId];
  await expect(tabRow(page, j.tab('j1'))).toBeVisible();
  await paneFits(page);

  // Held over each row of a window of the other profile, and released
  // there: the refused preview (its own slot), and back in its own place.
  const over = (ids: number[]) => ids.map((id) => () => justInside(page, id));
  await expectTabRefused(
    page,
    page,
    n.tab('n0'),
    over([i.tab('i0'), i.tab('i1'), i.tab('i2')]),
    all,
    extensionId
  );
  await expectTabRefused(
    page,
    page,
    i.tab('i0'),
    over([m.tab('m0'), m.tab('m1'), m.tab('m2')]),
    all,
    extensionId
  );
  expect(await chromeOrder(page, n.windowId)).toEqual([
    n.tab('n0'),
    n.tab('n1'),
    n.tab('n2'),
  ]);
  expect(await chromeOrder(page, i.windowId)).toEqual([
    i.tab('i0'),
    i.tab('i1'),
    i.tab('i2'),
  ]);
  await listMatchesChrome(page, page, all, extensionId);

  // CONTROLS: within a profile, the same gesture moves the tab.
  const normal = await dragTab(page, n.tab('n1'), () =>
    justInside(page, m.tab('m1'))
  );
  expect(normal).toMatchObject({ windowId: m.windowId, index: 1 });
  await expect
    .poll(() => chromeOrder(page, m.windowId))
    .toEqual([m.tab('m0'), n.tab('n1'), m.tab('m1'), m.tab('m2')]);
  const incognito = await dragTab(page, i.tab('i1'), () =>
    justInside(page, j.tab('j1'))
  );
  expect(incognito).toMatchObject({ windowId: j.windowId, index: 1 });
  await expect
    .poll(() => chromeOrder(page, j.windowId))
    .toEqual([j.tab('j0'), i.tab('i1'), j.tab('j1')]);
  await listMatchesChrome(page, page, all, extensionId);
  await expectLandedAsPreviewed(page, n.tab('n1'), normal);
  await expectLandedAsPreviewed(page, i.tab('i1'), incognito);
});

// ---- 7: undo -------------------------------------------------------------------

const undoKey = (page: Page) => page.keyboard.press('ControlOrMeta+z');

// Saved sessions, as the store holds them.
const savedCount = (page: Page) =>
  page.evaluate(() => {
    const raw = localStorage.getItem('tabContainerData');
    if (raw === null) return 0;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return 0;
    const groups: unknown = Reflect.get(parsed, 'tabGroups');
    return Array.isArray(groups) ? groups.length : 0;
  });

// A saved-session change: Save all makes a session, and ⌘Z can take it back.
async function saveAll(page: Page): Promise<number> {
  const before = await savedCount(page);
  // Open now's own, not the saved pane's control of the same name.
  await page
    .locator('[data-pane="open-now"]')
    .getByRole('button', { name: 'Save all open windows as a session' })
    .click();
  await expect.poll(() => savedCount(page)).toBe(before + 1);
  return before + 1;
}

test.describe('⌘Z undoes an Open now drag (KAN-280 O11f, U1)', () => {
  test('7a. after a reorder within a window', async ({
    context,
    extensionId,
    serviceWorker: worker,
  }) => {
    const page = await openTabView(context, extensionId);
    const a = await openWindow(worker, ['a0', 'a1', 'a2', 'a3']);
    await expect(tabRow(page, a.tab('a3'))).toBeVisible();
    const start = [a.tab('a0'), a.tab('a1'), a.tab('a2'), a.tab('a3')];

    await dragTab(page, a.tab('a3'), () => justInside(page, a.tab('a1')));
    await expect
      .poll(() => chromeOrder(worker, a.windowId))
      .toEqual([a.tab('a0'), a.tab('a3'), a.tab('a1'), a.tab('a2')]);
    await listMatchesChrome(page, worker, [a.windowId], extensionId);

    await undoKey(page);
    await expect.poll(() => chromeOrder(worker, a.windowId)).toEqual(start);
    await listMatchesChrome(page, worker, [a.windowId], extensionId);
  });

  test('7b. after a move into another window', async ({
    context,
    extensionId,
    serviceWorker: worker,
  }) => {
    const page = await openTabView(context, extensionId);
    const a = await openWindow(worker, ['a0', 'a1', 'a2']);
    const b = await openWindow(worker, ['b0', 'b1', 'b2']);
    await expect(tabRow(page, b.tab('b2'))).toBeVisible();

    await dragTab(page, a.tab('a1'), () => justInside(page, b.tab('b1')));
    await expect
      .poll(() => chromeOrder(worker, b.windowId))
      .toEqual([b.tab('b0'), a.tab('a1'), b.tab('b1'), b.tab('b2')]);
    await listMatchesChrome(
      page,
      worker,
      [a.windowId, b.windowId],
      extensionId
    );

    await undoKey(page);
    await expect
      .poll(() => chromeOrder(worker, a.windowId))
      .toEqual([a.tab('a0'), a.tab('a1'), a.tab('a2')]);
    expect(await chromeOrder(worker, b.windowId)).toEqual([
      b.tab('b0'),
      b.tab('b1'),
      b.tab('b2'),
    ]);
    await listMatchesChrome(
      page,
      worker,
      [a.windowId, b.windowId],
      extensionId
    );
  });

  test('7c. after a whole group moved into another window, and after a G1 move', async ({
    context,
    extensionId,
    serviceWorker: worker,
  }) => {
    const page = await openTabView(context, extensionId);
    const a = await openWindow(worker, ['a0', 'g1', 'g2', 'a3']);
    const b = await openWindow(worker, ['b0', 'b1']);
    const g = await makeGroup(
      worker,
      a.windowId,
      [a.tab('g1'), a.tab('g2')],
      'Grp',
      'red'
    );
    await activate(worker, a.tab('a0'));
    await expect(groupTitle(page, a.windowId, 'Grp')).toBeVisible();
    await expect(tabRow(page, b.tab('b1'))).toBeVisible();
    const startA = [a.tab('a0'), a.tab('g1'), a.tab('g2'), a.tab('a3')];

    // tabGroups.move, then ⌘Z: the same group back where it was.
    await dragGroup(page, a.windowId, 'Grp', () =>
      justInside(page, b.tab('b1'))
    );
    await expect
      .poll(() => chromeOrder(worker, b.windowId))
      .toEqual([b.tab('b0'), a.tab('g1'), a.tab('g2'), b.tab('b1')]);
    await listMatchesChrome(
      page,
      worker,
      [a.windowId, b.windowId],
      extensionId
    );
    await undoKey(page);
    await expect.poll(() => chromeOrder(worker, a.windowId)).toEqual(startA);
    expect((await chromeTab(worker, a.tab('g1')))?.groupId).toBe(g);
    expect(await chromeOrder(worker, b.windowId)).toEqual([
      b.tab('b0'),
      b.tab('b1'),
    ]);
    await listMatchesChrome(
      page,
      worker,
      [a.windowId, b.windowId],
      extensionId
    );

    // G1 (g1 is A's front tab), then ⌘Z: back in A with the look, as a group.
    await activate(worker, a.tab('g1'));
    await listMatchesChrome(
      page,
      worker,
      [a.windowId, b.windowId],
      extensionId
    );
    await dragGroup(page, a.windowId, 'Grp', () =>
      justInside(page, b.tab('b1'))
    );
    // The whole G1 end state at once, so the drop's record is kept before
    // the key is pressed.
    const members = [a.tab('g1'), a.tab('g2')];
    await expect
      .poll(async () => {
        const end = await groupedEndState(worker, b.windowId, members);
        return { ...end, group: end.group !== null && end.group !== g };
      })
      .toEqual({
        order: [b.tab('b0'), a.tab('g1'), a.tab('g2'), b.tab('b1')],
        group: true,
        title: 'Grp',
        color: 'red',
      });
    await listMatchesChrome(
      page,
      worker,
      [a.windowId, b.windowId],
      extensionId
    );
    await undoKey(page);
    await expect
      .poll(async () => {
        const end = await groupedEndState(worker, a.windowId, members);
        return { ...end, group: end.group !== null };
      })
      .toEqual({ order: startA, group: true, title: 'Grp', color: 'red' });
    expect(await chromeOrder(worker, b.windowId)).toEqual([
      b.tab('b0'),
      b.tab('b1'),
    ]);
    expect(await frontTab(worker, b.windowId)).toBe(b.tab('b0'));
    await listMatchesChrome(
      page,
      worker,
      [a.windowId, b.windowId],
      extensionId
    );
  });

  // O11f: a drag whose tabs Chrome no longer has where it left them is not
  // undone, and ⌘Z does not fall through to the saved change before it. The
  // second ⌘Z is the control: that saved change WAS there to undo.
  const staleCases: readonly ('moved by hand' | 'closed')[] = [
    'moved by hand',
    'closed',
  ];
  for (const stale of staleCases) {
    test(`7d. stale (${stale}): ⌘Z does nothing, and does not fall through to the saved change before it`, async ({
      context,
      extensionId,
      serviceWorker: worker,
    }) => {
      const page = await openTabView(context, extensionId);
      const a = await openWindow(worker, ['a0', 'a1', 'a2', 'a3']);
      await expect(tabRow(page, a.tab('a3'))).toBeVisible();
      const saved = await saveAll(page);

      await dragTab(page, a.tab('a3'), () => justInside(page, a.tab('a1')));
      await expect
        .poll(() => chromeOrder(worker, a.windowId))
        .toEqual([a.tab('a0'), a.tab('a3'), a.tab('a1'), a.tab('a2')]);

      const expected =
        stale === 'moved by hand'
          ? [a.tab('a3'), a.tab('a0'), a.tab('a1'), a.tab('a2')]
          : [a.tab('a0'), a.tab('a1'), a.tab('a2')];
      await worker.evaluate(
        async ({ id, move }) => {
          if (move) await chrome.tabs.move(id, { index: 0 });
          else await chrome.tabs.remove(id);
        },
        { id: a.tab('a3'), move: stale === 'moved by hand' }
      );
      await expect
        .poll(() => chromeOrder(worker, a.windowId))
        .toEqual(expected);
      await listMatchesChrome(page, worker, [a.windowId], extensionId);

      await undoKey(page);
      await page.waitForTimeout(800);
      expect(await chromeOrder(worker, a.windowId)).toEqual(expected);
      expect(await savedCount(page)).toBe(saved);

      // CONTROL: the saved change was undoable all along.
      await undoKey(page);
      await expect.poll(() => savedCount(page)).toBe(saved - 1);
      expect(await chromeOrder(worker, a.windowId)).toEqual(expected);
    });
  }

  // R23: a drop that changes nothing is not a Tab Keeper action, so ⌘Z after
  // it undoes the action before it.
  test('7e. a drop in place is not undoable: ⌘Z undoes the saved change before it', async ({
    context,
    extensionId,
    serviceWorker: worker,
  }) => {
    const page = await openTabView(context, extensionId);
    const a = await openWindow(worker, ['a0', 'a1', 'a2']);
    await expect(tabRow(page, a.tab('a2'))).toBeVisible();
    const start = [a.tab('a0'), a.tab('a1'), a.tab('a2')];
    const fronts = await frontTab(worker, a.windowId);
    const saved = await saveAll(page);

    // Held, moved within its own slot, released: a drop in place.
    const { x, y } = await pickUp(page, tabRow(page, a.tab('a1')));
    await moveTo(page, x + 40, y - 4);
    const preview = await release(page, 'tabs');
    expect(preview).toMatchObject({
      held: String(a.tab('a1')),
      windowId: a.windowId,
      index: 1,
    });
    await page.waitForTimeout(500);
    expect(await chromeOrder(worker, a.windowId)).toEqual(start);
    // The post-drag click is swallowed: the drop did not switch tabs.
    expect(await frontTab(worker, a.windowId)).toBe(fronts);

    await undoKey(page);
    await expect.poll(() => savedCount(page)).toBe(saved - 1);
    expect(await chromeOrder(worker, a.windowId)).toEqual(start);
  });
});

// ---- 8: the page you're using (T1, R26) -----------------------------------------

test.describe("the tab view's own page (KAN-280 O11h T1, Review Focus 2)", () => {
  // Open now never lists Tab Keeper's page (KAN-300), so it only moves as a
  // member of a group. Such a group may move within its window, never out.
  test('8a. a group holding this page is shown no slot in another window, a release puts it back, and it moves within its own window', async ({
    context,
    extensionId,
    serviceWorker: worker,
  }) => {
    const page = await openTabView(context, extensionId);
    const self = await page.evaluate(() => chrome.tabs.getCurrent());
    if (self?.id === undefined) throw new Error('the tab view is not a tab');
    const home = self.windowId;
    const pageTab = self.id;
    // This window: [blank, page] from launch; add c0 after them, then group
    // the blank tab with the page.
    const blank = (await chromeWindow(worker, home)).find(
      (t) => t.id !== pageTab
    );
    if (blank === undefined) throw new Error('no launch tab beside the page');
    const c0 = await worker.evaluate(
      async ({ windowId, url }) =>
        (await chrome.tabs.create({ windowId, url, active: false })).id ?? -1,
      { windowId: home, url: dataUrl('c0') }
    );
    const g = await makeGroup(
      worker,
      home,
      [blank.id, pageTab],
      'Home',
      'purple'
    );
    const b = await openWindow(worker, ['b0', 'b1', 'b2']);
    await expect(groupTitle(page, home, 'Home')).toBeVisible();
    await expect(tabRow(page, b.tab('b2'))).toBeVisible();
    await expect(tabRow(page, c0)).toBeVisible();
    await paneFits(page);
    const homeStart = await chromeOrder(worker, home);

    // CONTROL: a group NOT holding this page is shown a slot in B.
    const other = await openWindow(worker, ['o0', 'o1']);
    await makeGroup(worker, other.windowId, [other.tab('o0')], 'Other', 'cyan');
    await expect(groupTitle(page, other.windowId, 'Other')).toBeVisible();
    const control = await pickUp(
      page,
      groupTitle(page, other.windowId, 'Other')
    );
    await page.waitForTimeout(350);
    await moveTo(page, control.x, await justInside(page, b.tab('b1')));
    expect(await previewNow(page, 'items')).toMatchObject({
      windowId: b.windowId,
    });
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await page.waitForTimeout(300);
    // PREMISE: Escape cancelled the control; nothing moved.
    expect(await chromeOrder(worker, other.windowId)).toEqual([
      other.tab('o0'),
      other.tab('o1'),
    ]);
    expect(await chromeOrder(worker, b.windowId)).toEqual([
      b.tab('b0'),
      b.tab('b1'),
      b.tab('b2'),
    ]);

    // Held over each row of B, and released there: the refused preview (the
    // group's own slot in This window), and the group back there.
    const before = await shownPlace(page, blank.id);
    if (before === null) throw new Error('the Home group is not listed');
    const expected = refusedPreview(`group:${g}`, before, 'items');
    const { x } = await pickUp(page, groupTitle(page, home, 'Home'));
    await page.waitForTimeout(350);
    for (const id of [b.tab('b0'), b.tab('b1'), b.tab('b2')]) {
      await moveTo(page, x, await justInside(page, id));
      expect(await previewNow(page, 'items')).toEqual(expected);
    }
    const refused = await release(page, 'items');
    expect(refused).toEqual(expected);
    await page.waitForTimeout(500);
    expect(await chromeOrder(worker, home)).toEqual(homeStart);
    expect(await chromeOrder(worker, b.windowId)).toEqual([
      b.tab('b0'),
      b.tab('b1'),
      b.tab('b2'),
    ]);
    expect((await chromeTab(worker, pageTab))?.groupId).toBe(g);
    await listMatchesChrome(page, worker, [home, b.windowId], extensionId);
    const back = await shownPlace(page, blank.id);
    expect({ windowId: back?.windowId, item: back?.item }).toEqual({
      windowId: refused.windowId,
      item: refused.index,
    });

    // Within its own window: below c0.
    const moved = await dragGroup(page, home, 'Home', () =>
      justBelow(page, c0)
    );
    expect(moved).toMatchObject({ windowId: home, index: 1 });
    await expect
      .poll(() => chromeOrder(worker, home))
      .toEqual([c0, blank.id, pageTab]);
    expect(await chromeTab(worker, pageTab)).toMatchObject({
      groupId: g,
      active: true,
    });
    await listMatchesChrome(page, worker, [home, b.windowId], extensionId);
    expect((await shownPlace(page, blank.id))?.item).toBe(moved.index);
    // The page is alive and still says so.
    await expect(
      page.getByRole('button', { name: 'Sort sessions' })
    ).toBeVisible();
  });

  // R26(b): a window's FRONT tab joining another window's group goes by
  // tabs.group then a same-window tabs.move (Task 1 Q3: one tabs.move into a
  // run is refused). Measured here, not assumed: where Chrome puts it, and
  // both windows' front tabs.
  test("8b. a window's front tab dragged into another window's group joins it where previewed; it arrives behind, and its old window shows a neighbour", async ({
    context,
    extensionId,
    serviceWorker: worker,
  }) => {
    const page = await openTabView(context, extensionId);
    const a = await openWindow(worker, ['a0', 'a1']);
    const b = await openWindow(worker, ['b0', 'g1', 'g2', 'b3']);
    const g = await makeGroup(
      worker,
      b.windowId,
      [b.tab('g1'), b.tab('g2')],
      'Join',
      'yellow'
    );
    await activate(worker, a.tab('a0'));
    await activate(worker, b.tab('b0'));
    // PREMISE: a0 is A's front tab, b0 is B's.
    expect(await frontTab(worker, a.windowId)).toBe(a.tab('a0'));
    expect(await frontTab(worker, b.windowId)).toBe(b.tab('b0'));
    await expect(groupTitle(page, b.windowId, 'Join')).toBeVisible();
    await paneFits(page);

    const { x } = await pickUp(page, tabRow(page, a.tab('a0')));
    await moveTo(page, x, await justInside(page, b.tab('g2')));
    await startSampling(page, [a.windowId, b.windowId]);
    const preview = await release(page, 'tabs');
    expect(preview).toMatchObject({
      windowId: b.windowId,
      index: 2,
      lit: [String(g)],
    });

    await expect
      .poll(() => chromeOrder(worker, b.windowId))
      .toEqual([
        b.tab('b0'),
        b.tab('g1'),
        a.tab('a0'),
        b.tab('g2'),
        b.tab('b3'),
      ]);
    expect((await chromeTab(worker, a.tab('a0')))?.groupId).toBe(g);
    await listMatchesChrome(
      page,
      worker,
      [a.windowId, b.windowId],
      extensionId
    );
    const pictures = await stopSampling(page);
    await test.info().attach('8b-flicker-samples', {
      body: JSON.stringify(pictures, null, 2),
      contentType: 'application/json',
    });
    await expectLandedAsPreviewed(page, a.tab('a0'), preview);
    // It arrives behind; B keeps b0; A shows its neighbour a1.
    expect((await chromeTab(worker, a.tab('a0')))?.active).toBe(false);
    expect(await frontTab(worker, b.windowId)).toBe(b.tab('b0'));
    expect(await frontTab(worker, a.windowId)).toBe(a.tab('a1'));
  });
});

// ---- 12: without the tabGroups grant ------------------------------------------

// KAN-322 (spec O11e). Without the grant Open now shows no groups, so a
// Chrome group's tabs are loose rows and the engine offers the slot between
// two of them. One tabs.move from another window into a group's run is
// refused (Task 1 Q3), so the drop joins the group with tabs.group (which
// works without the grant, Task 6a Q3) and lands where the preview showed.
// On 0a1489f's build the release was refused and the tab went back.
ungrantedTest(
  '12. without the grant, a tab from another window dropped between two grouped tabs joins that group where the preview showed (KAN-322)',
  async ({ context, extensionId, serviceWorker: worker }) => {
    // PREMISE: the ungranted fixture, where chrome.tabGroups does not exist.
    expect(await worker.evaluate(() => typeof chrome.tabGroups)).toBe(
      'undefined'
    );
    const page = await openTabView(context, extensionId);
    const a = await openWindow(worker, ['a0', 'a1']);
    const b = await openWindow(worker, ['b0', 'g1', 'g2', 'b3']);
    const grouping: { windowId: number; tabIds: [number, ...number[]] } = {
      windowId: b.windowId,
      tabIds: [b.tab('g1'), b.tab('g2')],
    };
    const g = await worker.evaluate(
      ({ windowId, tabIds }) =>
        chrome.tabs.group({ tabIds, createProperties: { windowId } }),
      grouping
    );
    // PREMISE: Chrome has the group, and the list draws its tabs as loose rows.
    expect((await chromeTab(worker, b.tab('g1')))?.groupId).toBe(g);
    expect((await chromeTab(worker, b.tab('g2')))?.groupId).toBe(g);
    await expect(tabRow(page, b.tab('b3'))).toBeVisible();
    expect(await shownPlace(page, b.tab('g2'))).toMatchObject({ band: null });
    await paneFits(page);

    // a1 between g1 and g2.
    const preview = await dragTab(page, a.tab('a1'), () =>
      justInside(page, b.tab('g2'))
    );
    expect(preview).toMatchObject({ windowId: b.windowId, index: 2, lit: [] });

    await expect
      .poll(() => chromeOrder(worker, b.windowId))
      .toEqual([
        b.tab('b0'),
        b.tab('g1'),
        a.tab('a1'),
        b.tab('g2'),
        b.tab('b3'),
      ]);
    expect((await chromeTab(worker, a.tab('a1')))?.groupId).toBe(g);
    expect(await chromeOrder(worker, a.windowId)).toEqual([a.tab('a0')]);
    await listMatchesChrome(
      page,
      worker,
      [a.windowId, b.windowId],
      extensionId
    );
    await expectLandedAsPreviewed(page, a.tab('a1'), preview);
  }
);

// ---- 9: the drawer ---------------------------------------------------------------

// The popup has no Open now (spec, Shared rules; open-now.spec.ts test 8), so
// "the popup does the same" has nothing to drag. The other place Open now is
// drawn is the narrow tab view's drawer (O2), a second mount of the same pane.
test("9. in the narrow tab view's drawer, a drop moves the real tab as in the pane", async ({
  context,
  extensionId,
  serviceWorker: worker,
}) => {
  await seedSettings(context, { foldSavedSessionInTabView: false });
  const page = await openTabView(context, extensionId, NARROW_VIEWPORT);
  const a = await openWindow(worker, ['a0', 'a1', 'a2']);
  const b = await openWindow(worker, ['b0', 'b1']);
  await page.getByRole('button', { name: /^Open now/ }).click();
  const drawer = page.getByRole('dialog', { name: 'Open now' });
  await expect(drawer).toBeVisible();
  await expect(tabRow(page, b.tab('b1'))).toBeVisible();

  const preview = await dragTab(page, a.tab('a2'), () =>
    justInside(page, b.tab('b1'))
  );
  expect(preview).toMatchObject({ windowId: b.windowId, index: 1 });
  await expect
    .poll(() => chromeOrder(worker, b.windowId))
    .toEqual([b.tab('b0'), a.tab('a2'), b.tab('b1')]);
  await listMatchesChrome(page, worker, [a.windowId, b.windowId], extensionId);
  await expectLandedAsPreviewed(page, a.tab('a2'), preview);
  await expect(drawer).toBeVisible();
});

// ---- 11: the scroll after a drop (ledger R22) -------------------------------

// The guard that a drop does not throw the view back. Open now does not
// reorder until the re-read, so the engine's follow-the-drop (a
// scrollIntoView on the next frame, KAN-155) could aim at the row's OLD
// place. The case most likely to show it: from a scrolled position, grab a
// row near the top, auto-scroll DOWN until its old place is off screen
// above, and release far below it, in another window.
//
// Measured (Task 8, ledger R22): the follow's one scrollIntoView lands on the
// row already re-read into its NEW place (top 687 in a 123-791 pane), so
// `nearest` scrolls nothing, and Open now keeps the saved lists' follow
// (R28 removed the opt-out Task 6c had added). This pins what the user sees:
// if the follow ever outran the re-read, the view would jump back.
//
// The frames are read only until the re-read reorders the rows: the re-read
// itself moves scrollTop (scroll anchoring, below), and on CI it landed
// inside a fixed six-frame window (KAN-372). `frameGapMs` spaces the reads
// out so that it lands among them every time.
async function expectDropKeepsScroll(
  {
    context,
    extensionId,
    worker,
  }: { context: BrowserContext; extensionId: string; worker: Worker },
  frameGapMs: number
) {
  const page = await openTabView(context, extensionId);
  const titles = (p: string) =>
    Array.from({ length: 12 }, (_, k) => `${p}${k}`);
  const a = await openWindow(worker, titles('a'));
  const b = await openWindow(worker, titles('b'));
  const c = await openWindow(worker, titles('c'));
  const windows = [a.windowId, b.windowId, c.windowId];
  await expect(tabRow(page, c.tab('c11'))).toBeAttached();

  const startTop = 300;
  await page.evaluate((top) => {
    let el =
      document.querySelector('[data-open-window-id]')?.parentElement ?? null;
    while (el && !['auto', 'scroll'].includes(getComputedStyle(el).overflowY))
      el = el.parentElement;
    if (el) el.scrollTop = top;
  }, startTop);
  const pane = await paneOf(page);
  if (pane === null) throw new Error('no scrolling pane');
  // PREMISE: the list scrolls, and sits where it was put.
  expect(pane.scrollTop).toBe(startTop);

  // The first tab row wholly on screen below the top auto-scroll zone.
  const grab = await page.evaluate(
    ({ top, bottom }) => {
      for (const row of document.querySelectorAll('[data-open-tab-id]')) {
        const r = row.getBoundingClientRect();
        if (r.top >= top && r.bottom <= bottom)
          return {
            id: Number(row.getAttribute('data-open-tab-id')),
            top: r.top,
            height: r.height,
          };
      }
      return null;
    },
    { top: pane.top + EDGE_ZONE_PX + 4, bottom: pane.bottom - EDGE_ZONE_PX }
  );
  if (grab === null) throw new Error('no row to grab');
  // The row's old place in content space: off screen once scrollTop passes
  // its bottom.
  const oldBottom = grab.top - pane.top + startTop + grab.height;
  const grabbedFrom = (await shownPlace(page, grab.id))?.windowId;

  const { x } = await pickUp(page, tabRow(page, grab.id));
  // PREMISE: the pick-up did not scroll (it is clear of the edge zones).
  expect((await paneOf(page))?.scrollTop).toBe(startTop);
  await page.mouse.move(x, pane.bottom - 10, { steps: 10 });
  await expect
    .poll(async () => (await paneOf(page))?.scrollTop ?? 0, { timeout: 10000 })
    .toBeGreaterThan(oldBottom + grab.height);
  // Out of the zone, so the scroll rests before the release.
  await moveTo(page, x, pane.bottom - EDGE_ZONE_PX - 40);
  const atRest = (await paneOf(page))?.scrollTop ?? 0;
  expect(atRest).toBeGreaterThan(oldBottom);

  await page.evaluate((gapMs) => {
    let el =
      document.querySelector('[data-open-window-id]')?.parentElement ?? null;
    while (el && !['auto', 'scroll'].includes(getComputedStyle(el).overflowY))
      el = el.parentElement;
    const scroller = el;
    const order = () =>
      Array.from(document.querySelectorAll('[data-open-tab-id]'), (row) =>
        row.getAttribute('data-open-tab-id')
      ).join();
    delete window.__openNowScrollLog;
    window.addEventListener(
      'pointerup',
      () => {
        const atRelease = order();
        const beforeReread = [scroller?.scrollTop ?? -1];
        // A task first, so each read runs after the frame callbacks the drop
        // queued (the follow's scrollIntoView, KAN-155).
        const next = () =>
          setTimeout(() => requestAnimationFrame(frame), gapMs);
        const frame = () => {
          const reread = order() !== atRelease;
          if (reread || beforeReread.length === 60) {
            window.__openNowScrollLog = {
              beforeReread,
              rereadAt: reread ? beforeReread.length : null,
            };
            return;
          }
          beforeReread.push(scroller?.scrollTop ?? -1);
          next();
        };
        next();
      },
      { capture: true, once: true }
    );
  }, frameGapMs);
  const preview = await release(page, 'tabs');
  await expect
    .poll(() => page.evaluate(() => window.__openNowScrollLog !== undefined))
    .toBe(true);
  const log = await page.evaluate(() => window.__openNowScrollLog);
  if (log === undefined) throw new Error('no scroll log');

  // PREMISE: the drop crossed windows, so a change of window in Chrome is
  // the move having happened.
  expect(preview.windowId).not.toBe(grabbedFrom);
  await expect
    .poll(async () => (await chromeTab(worker, grab.id))?.windowId)
    .toBe(preview.windowId);
  await listMatchesChrome(page, worker, windows, extensionId);
  const after = await paneOf(page);
  const rowBox = await boxOf(tabRow(page, grab.id));
  await test.info().attach('scroll-after-drop', {
    body: JSON.stringify(
      {
        before: startTop,
        atRest,
        releaseAndFramesBeforeReread: log.beforeReread,
        rereadAt: log.rereadAt,
        afterReread: after?.scrollTop,
        oldBottom,
        rowNow: [rowBox.y, rowBox.y + rowBox.height],
        pane: [pane.top, pane.bottom],
      },
      null,
      2
    ),
    contentType: 'application/json',
  });

  await expectLandedAsPreviewed(page, grab.id, preview);
  // PREMISE: a frame after the drop's own was read before the re-read.
  expect(log.beforeReread.length).toBeGreaterThanOrEqual(2);
  // PREMISE: spaced reads do catch the re-read among them.
  if (frameGapMs > 0) expect(log.rereadAt).not.toBeNull();
  // The scroll never followed the row back to its old place: from the
  // release to the re-read it stays where the release left it...
  for (const top of log.beforeReread)
    expect(Math.abs(top - atRest)).toBeLessThanOrEqual(1);
  // ...and after the re-read the old place is still off screen above. (The
  // re-read itself may move scrollTop by the row's height: the row left from
  // above the view, and Chrome's scroll anchoring holds the visible rows
  // still. Measured 476 -> 444.)
  expect(after?.scrollTop ?? -1).toBeGreaterThan(oldBottom);
  // ...and the row, re-read into its new place, is on screen.
  expect(rowBox.y).toBeGreaterThanOrEqual(pane.top);
  expect(rowBox.y + rowBox.height).toBeLessThanOrEqual(pane.bottom);
}

test('11. after an auto-scrolled drop, the pane stays where the drop left it, and the moved row is on screen', ({
  context,
  extensionId,
  serviceWorker: worker,
}) => expectDropKeepsScroll({ context, extensionId, worker }, 0));

test('11b. as 11, with the re-read landing among the frames read (KAN-372)', ({
  context,
  extensionId,
  serviceWorker: worker,
}) => expectDropKeepsScroll({ context, extensionId, worker }, 25));
