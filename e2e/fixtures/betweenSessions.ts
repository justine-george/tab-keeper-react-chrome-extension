import {
  type tabContainerData,
  type TabMasterContainer,
} from '../../src/redux/slices/tabContainerDataStateSlice';
import {
  buildSession,
  seedSessions,
  buildContainer,
  seedSettings,
} from './seed';
import {
  type BrowserContext,
  type Page,
  type Worker,
  type Locator,
} from '@playwright/test';
import { expect } from './grantedExtension';
import { stored, type Point, boxOf } from './sessionDrag';

// Shared by drag-between-sessions, new-session-drop (KAN-480) and spring-open-windows (KAN-481).

export const POPUP = { width: 790, height: 550 };
export const TAB_VIEW = { width: 1280, height: 800 };

// ---- fixtures ---------------------------------------------------------------

export interface SeedTab {
  tabId: string;
  favicon: string;
  title: string;
  url: string;
  chromeGroupId?: string;
}

export const tab = (id: string, g?: string): SeedTab => ({
  tabId: id,
  favicon: '',
  title: `Tab ${id}`,
  url: `https://${id}.test/`,
  ...(g ? { chromeGroupId: g } : {}),
});

export const win = (
  id: string,
  tabs: SeedTab[],
  groups: { groupId: string; title: string; color: string }[] = []
) => ({
  windowId: id,
  windowHeight: 1080,
  windowWidth: 1920,
  windowOffsetTop: 0,
  windowOffsetLeft: 0,
  tabCount: tabs.length,
  title: id,
  tabs,
  chromeTabGroups: groups,
});

export type SeedWindow = ReturnType<typeof win>;

export const session = (
  id: string,
  title: string,
  windows: SeedWindow[]
): tabContainerData =>
  buildSession({
    tabGroupId: id,
    title,
    windowCount: windows.length,
    tabCount: windows.reduce((n, w) => n + w.tabs.length, 0),
    windows,
  });

// S1 (on screen): w1 = three loose tabs + group alpha, w2 = two tabs. S2: d1 = two tabs, gamma, one tab; d2 = two tabs. No popup pane scrolls.
export const S1 = () =>
  session('S1', 'Source', [
    win(
      'w1',
      [
        tab('a0'),
        tab('a1'),
        tab('a2'),
        tab('al0', 'alpha'),
        tab('al1', 'alpha'),
      ],
      [{ groupId: 'alpha', title: 'Alpha', color: 'blue' }]
    ),
    win('w2', [tab('b0'), tab('b1')]),
  ]);
export const S2 = (title = 'Target') =>
  session('S2', title, [
    win(
      'd1',
      [
        tab('c0'),
        tab('c1'),
        tab('ga0', 'gamma'),
        tab('ga1', 'gamma'),
        tab('c2'),
      ],
      [{ groupId: 'gamma', title: 'Gamma', color: 'green' }]
    ),
    win('d2', [tab('e0'), tab('e1')]),
  ]);
export const S3 = () => session('S3', 'Third', [win('f1', [tab('f0')])]);
export const S4 = () => session('S4', 'Fourth', [win('h1', [tab('h0')])]);

export const W1_START = 'a0 a1 a2 al0* al1*';

export async function seed(
  context: BrowserContext,
  sessions: tabContainerData[],
  selected: string
): Promise<void> {
  await seedSessions(context, {
    ...buildContainer(
      sessions.map((s) => ({ ...s, isSelected: s.tabGroupId === selected }))
    ),
    selectedTabGroupId: selected,
  });
}

export async function openPopup(
  context: BrowserContext,
  extensionId: string,
  sessions: tabContainerData[] = [S1(), S2(), S3(), S4()],
  selected = 'S1'
): Promise<Page> {
  await seed(context, sessions, selected);
  const page = await context.newPage();
  await page.setViewportSize(POPUP);
  await page.goto(`chrome-extension://${extensionId}/index.html`);
  // goto resolves before React mounts (KAN-105). Every test crosses this
  // barrier before its first raw evaluate: the selected session's first
  // window drawn in the detail.
  const first = sessions.find((s) => s.tabGroupId === selected)?.windows[0];
  if (first === undefined) throw new Error('no selected session to show');
  await expect(
    page.locator(`[data-drag-row-id="${first.windowId}"]`)
  ).toBeVisible();
  return page;
}

export async function openTabView(
  context: BrowserContext,
  extensionId: string,
  folded: boolean,
  sessions: tabContainerData[] = [S1(), S2(), S3(), S4()],
  viewport = TAB_VIEW
): Promise<Page> {
  await seed(context, sessions, 'S1');
  await seedSettings(context, { foldSavedSessionInTabView: folded });
  const page = await context.newPage();
  await page.setViewportSize(viewport);
  await page.goto(`chrome-extension://${extensionId}/index.html?view=tab`);
  // Barrier: the session list's first row. Then the detail, which the tab
  // view draws once a row is clicked -- a peek when folded (O5).
  const row = sessionRow(page, 'S1');
  await expect(row).toBeVisible();
  // PREMISE: folded, the detail is not drawn at all until the peek (O4).
  await expect(page.locator('[data-pane="detail"]')).toHaveCount(
    folded ? 0 : 1
  );
  await row.click();
  await expect(page.locator('[data-drag-row-id="w1"]')).toBeVisible();
  return page;
}

// ---- reading the store ------------------------------------------------------

export function sessionOf(c: TabMasterContainer, id: string): tabContainerData {
  const s = c.tabGroups.find((g) => g.tabGroupId === id);
  if (s === undefined) throw new Error(`no session ${id} stored`);
  return s;
}

// A session as its windows' tab orders, a star on every grouped tab.
export const layoutOf = (s: tabContainerData): string[] =>
  s.windows.map((w) =>
    w.tabs.map((t) => t.tabId + (t.chromeGroupId ? '*' : '')).join(' ')
  );

export const layout = async (page: Page, id: string): Promise<string[]> =>
  layoutOf(sessionOf(await stored(page), id));

// A session's window ids, with a window this test did not seed (one a move
// made) named `new`.
export const SEEDED_WINDOWS = new Set(
  [S1(), S2(), S3(), S4()].flatMap((s) => s.windows.map((w) => w.windowId))
);

export const selected = async (page: Page): Promise<string | null> =>
  (await stored(page)).selectedTabGroupId;

export const sessionIds = async (page: Page): Promise<string[]> =>
  (await stored(page)).tabGroups.map((g) => g.tabGroupId);

// ---- Chrome is never touched ------------------------------------------------

export async function chromeNow(worker: Worker): Promise<string> {
  return worker.evaluate(async () => {
    const tabs = await chrome.tabs.query({});
    const windows = await chrome.windows.getAll();
    return JSON.stringify({
      windows: windows.map((w) => w.id).sort(),
      tabs: tabs
        .map((t) => [t.id, t.windowId, t.index, t.url ?? t.pendingUrl])
        .sort(),
    });
  });
}

// ---- the page ---------------------------------------------------------------

export const CARD = '[data-carry-card]';

export const sessionRow = (page: Page, id: string): Locator =>
  page.locator(`[data-pane="sessions"] [data-drag-row-id="${id}"]`);

export interface PaneBox {
  left: number;
  right: number;
  top: number;
  bottom: number;
  scrollTop: number;
}

// The saved detail's scrolling box -- what the engine's paneOf finds from a
// window row: its nearest overflow-auto ancestor.
export const detailPane = (page: Page): Promise<PaneBox> =>
  page.evaluate(() => {
    let el = document.querySelector(
      '[data-pane="detail"] [data-drop-window-id]'
    )?.parentElement;
    while (el && !['auto', 'scroll'].includes(getComputedStyle(el).overflowY))
      el = el.parentElement;
    if (!el) throw new Error('no detail pane');
    const b = el.getBoundingClientRect();
    return {
      left: b.left,
      right: b.right,
      top: b.top,
      bottom: b.bottom,
      scrollTop: el.scrollTop,
    };
  });

export const setDetailScroll = (page: Page, top: number) =>
  page.evaluate((top) => {
    let el = document.querySelector(
      '[data-pane="detail"] [data-drop-window-id]'
    )?.parentElement;
    while (el && !['auto', 'scroll'].includes(getComputedStyle(el).overflowY))
      el = el.parentElement;
    if (!el) throw new Error('no detail pane');
    el.scrollTop = top;
    return el.scrollTop;
  }, top);

// The session rows the carry targets (D2 A), by session id.
export const carryTargets = (page: Page): Promise<string[]> =>
  page.evaluate(() =>
    [...document.querySelectorAll('[data-carry-target]')].map(
      (el) =>
        el.closest<HTMLElement>('[data-drag-row-id]')?.dataset.dragRowId ?? '?'
    )
  );

// The toasts on screen, oldest first: each one's message, and whether it
// carries Show.
export const toasts = (page: Page) =>
  page.evaluate(() =>
    [
      ...document.querySelectorAll<HTMLElement>(
        '[role="status"] [data-toast]:not([aria-hidden="true"])'
      ),
    ].map((t) => ({
      // The message: a toast with a chip holds it in its own span; a plain
      // toast is the message alone.
      text: (t.querySelector(':scope > span') ?? t).textContent ?? '',
      show: [...t.querySelectorAll('button')].some(
        (b) => b.textContent?.trim() === 'Show'
      ),
    }))
  );

// ---- the gesture ------------------------------------------------------------

// Out of the detail to the left, at the same height, onto the session list
// -- the only place a saved drag is handed to the carry (KAN-352) -- until
// the card shows.
export async function carryOutLeft(page: Page, from: Point): Promise<void> {
  const pane = await detailPane(page);
  const list = await boxOf(page.locator('[data-pane="sessions"]'));
  // PREMISE: the point is on the session list's pane.
  expect(pane.left - 40).toBeGreaterThan(list.x);
  expect(pane.left - 40).toBeLessThan(list.x + list.width);
  await page.mouse.move(pane.left - 40, from.y, { steps: 6 });
  await expect(page.locator(CARD)).toHaveCount(1);
}

// Until every row the preview moved has arrived: two frames, then each running transition's end.
export async function settled(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const frame = () =>
      new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await frame();
    await frame();
    for (;;) {
      const running = document
        .getAnimations()
        .filter((a) => a instanceof CSSTransition && a.playState === 'running');
      if (running.length === 0) return;
      await Promise.all(running.map((a) => a.finished.catch(() => undefined)));
      await frame();
    }
  });
}

// The slot takes the box of the row the item lands as (KAN-364), not the phantom's, which has no window indent.
export const box = (page: Page, selector: string) =>
  page.evaluate((selector) => {
    const el = document.querySelector(selector);
    if (el === null) return null;
    const b = el.getBoundingClientRect();
    return { left: b.left, right: b.right };
  }, selector);

// One ⌘Z puts `session` back exactly: every field as it was, but the
// session's own timestamp, which the undo moves past the move's -- undoing
// is an edit the sync must rank above the move (KAN-55).
export async function expectOneUndoRestores(
  page: Page,
  session: tabContainerData
): Promise<void> {
  const unstamped = (s: tabContainerData) => ({
    ...s,
    lastModified: undefined,
  });
  const movedAt = sessionOf(
    await stored(page),
    session.tabGroupId
  ).lastModified;
  if (movedAt === undefined) throw new Error('the move stamped nothing');
  await page.keyboard.press('Control+z');
  await expect
    .poll(async () =>
      unstamped(sessionOf(await stored(page), session.tabGroupId))
    )
    .toEqual(unstamped(session));
  const backAt = sessionOf(await stored(page), session.tabGroupId).lastModified;
  expect(backAt).toBeGreaterThan(movedAt);
}

// Six windows of four tabs: scrolled to its end, 9px is left below its last
// window (measured on main), and the pane has a long way to scroll back up.
export const sixByFour = (id: string, title: string, prefix: string) =>
  session(
    id,
    title,
    Array.from({ length: 6 }, (_, w) =>
      win(
        `${prefix}w${w}`,
        Array.from({ length: 4 }, (_, t) => tab(`${prefix}${w}-${t}`))
      )
    )
  );

// One frame of the detail pane: row tops (held row and phantoms left out), card, adoption, trailing block height, scroll range.
// KAN-379: window title tops and heights, slot, source room, held row, band title tops. KAN-394: the save row and data-carrying.
export interface PaneFrame {
  rows: Record<string, number>;
  bands: Record<string, number>;
  card: boolean;
  adopted: boolean;
  held: boolean;
  trailing: number;
  range: number;
  titles: Record<string, number>;
  heights: Record<string, number>;
  slot: number | null;
  room: number | null;
  heldTop: number | null;
  saveRow: SaveRowShows;
  carrying: boolean;
}
// Its controls; the New session target in their place, unlit or lit; or a
// frame drawing both or neither.
export type SaveRowShows = 'controls' | 'target' | 'lit' | 'mixed';
export const SAVE_ROW_SHOWS: readonly unknown[] = [
  'controls',
  'target',
  'lit',
  'mixed',
];
export const isTopOrNull = (x: unknown) => x === null || typeof x === 'number';
export const isNumberRecord = (x: unknown): x is Record<string, number> =>
  typeof x === 'object' &&
  x !== null &&
  !Array.isArray(x) &&
  Object.values(x).every((v) => typeof v === 'number');
export const isPaneLog = (x: unknown): x is PaneFrame[] => {
  if (!Array.isArray(x)) return false;
  const items: readonly unknown[] = x;
  return items.every(
    (f) =>
      typeof f === 'object' &&
      f !== null &&
      'rows' in f &&
      isNumberRecord(f.rows) &&
      'bands' in f &&
      isNumberRecord(f.bands) &&
      'card' in f &&
      typeof f.card === 'boolean' &&
      'adopted' in f &&
      typeof f.adopted === 'boolean' &&
      'held' in f &&
      typeof f.held === 'boolean' &&
      'trailing' in f &&
      typeof f.trailing === 'number' &&
      'range' in f &&
      typeof f.range === 'number' &&
      'titles' in f &&
      isNumberRecord(f.titles) &&
      'heights' in f &&
      isNumberRecord(f.heights) &&
      'slot' in f &&
      isTopOrNull(f.slot) &&
      'room' in f &&
      isTopOrNull(f.room) &&
      'heldTop' in f &&
      isTopOrNull(f.heldTop) &&
      'saveRow' in f &&
      SAVE_ROW_SHOWS.includes(f.saveRow) &&
      'carrying' in f &&
      typeof f.carrying === 'boolean'
  );
};

// Logs a PaneFrame every animation frame from now until paneLog is read.
// `leaveOut` names rows not to log: the one about to be picked up.
export async function logPane(page: Page, leaveOut: string[]): Promise<void> {
  await page.evaluate((leaveOut) => {
    const frames: unknown[] = [];
    delete document.body.dataset.paneFrames;
    document.body.dataset.paneLog = 'on';
    const scroller = () => {
      let el = document.querySelector(
        '[data-pane="detail"] [data-drop-window-id]'
      )?.parentElement;
      while (el && !['auto', 'scroll'].includes(getComputedStyle(el).overflowY))
        el = el.parentElement;
      return el ?? null;
    };
    const frame = () => {
      const rows: Record<string, number> = {};
      for (const el of document.querySelectorAll<HTMLElement>(
        '[data-pane="detail"] [data-drag-row-id]'
      )) {
        const id = el.dataset.dragRowId ?? '';
        if (
          leaveOut.includes(id) ||
          el.hasAttribute('data-carry-phantom') ||
          el.hasAttribute('data-drag-held')
        )
          continue;
        rows[id] = el.getBoundingClientRect().top;
      }
      const bands: Record<string, number> = {};
      for (const el of document.querySelectorAll<HTMLElement>(
        '[data-pane="detail"] [data-group-drag-handle][data-fixed-row-id]'
      ))
        bands[el.dataset.fixedRowId ?? ''] = el.getBoundingClientRect().top;
      const sc = scroller();
      const titles: Record<string, number> = {};
      const heights: Record<string, number> = {};
      for (const b of document.querySelectorAll<HTMLElement>(
        '[data-pane="detail"] [data-drop-window-id]'
      )) {
        const id = b.dataset.dropWindowId ?? '';
        heights[id] = b.getBoundingClientRect().height;
        const title = b.querySelector(':scope > [data-window-drag-handle]');
        if (title !== null) titles[id] = title.getBoundingClientRect().top;
      }
      const topOf = (selector: string) =>
        document.querySelector(selector)?.getBoundingClientRect().top ?? null;
      // The save row: the name field's nearest ancestor that also holds a
      // button, so a build with no data-save-row is read the same way.
      let saveRow = document.getElementById('name');
      while (saveRow !== null && saveRow.querySelector('button') === null)
        saveRow = saveRow.parentElement;
      const target =
        saveRow?.querySelector('[data-new-session-target]') ?? null;
      const targetShown =
        target !== null && getComputedStyle(target).visibility === 'visible';
      const controls = [
        ...(saveRow?.querySelectorAll('input, button, [role="button"]') ?? []),
      ]
        .filter((el) => target === null || !target.contains(el))
        .map((el) => getComputedStyle(el).visibility === 'visible');
      const controlsShown = controls.length > 0 && controls.every((c) => c);
      const controlsHidden = controls.length > 0 && controls.every((c) => !c);
      frames.push({
        rows,
        bands,
        card: document.querySelector('[data-carry-card]') !== null,
        adopted:
          document.querySelector('[data-carry-phantom][data-drag-held]') !==
          null,
        held: document.querySelector('[data-drag-held]') !== null,
        trailing:
          document
            .querySelector('[data-new-window-target="last"]')
            ?.getBoundingClientRect().height ?? -1,
        range: sc === null ? -1 : sc.scrollHeight - sc.clientHeight,
        titles,
        heights,
        slot: topOf('[data-drag-landing-slot]'),
        room: topOf('[data-drag-source-room]'),
        heldTop: topOf('[data-drag-held]'),
        saveRow:
          controlsShown && !targetShown
            ? 'controls'
            : controlsHidden && targetShown
              ? target?.hasAttribute('data-landing')
                ? 'lit'
                : 'target'
              : 'mixed',
        carrying: document.documentElement.hasAttribute('data-carrying'),
      });
      document.body.dataset.paneFrames = JSON.stringify(frames);
      if (document.body.dataset.paneLog === 'on') requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }, leaveOut);
  // Until the first frame is in.
  await expect
    .poll(() => page.evaluate(() => document.body.dataset.paneFrames ?? ''))
    .not.toBe('');
}

export async function paneLog(page: Page): Promise<PaneFrame[]> {
  const raw = await page.evaluate(() => {
    document.body.dataset.paneLog = 'off';
    return document.body.dataset.paneFrames ?? '[]';
  });
  const frames: unknown = JSON.parse(raw);
  if (!isPaneLog(frames)) throw new Error(`not a pane log: ${raw}`);
  return frames;
}

export const blockOf = (id: string) => `[data-drop-window-id="${id}"]`;
export const titleOf = (id: string) =>
  `[data-drop-window-id="${id}"] > [data-window-drag-handle]`;

// Folds a saved window shut with its own chevron, then takes the pointer
// off the rows so no hover is painted.
export async function collapseWindow(
  page: Page,
  windowId: string
): Promise<void> {
  await page
    .locator(blockOf(windowId))
    .getByRole('button', { name: /^Collapse(: |$)/ })
    .click();
  await expect(
    page.locator(`${blockOf(windowId)} [data-window-tabs]`)
  ).toHaveCount(0);
  await page.mouse.move(1, 1);
}

// The pointer onto a window's title row, at `x`, level with its middle.
export async function ontoTitle(page: Page, windowId: string, x: number) {
  const t = await boxOf(page.locator(titleOf(windowId)));
  await page.mouse.move(x, t.y + t.height / 2, { steps: 8 });
  return t;
}
// Drawn folded: no rows.
export const isFolded = async (page: Page, windowId: string) =>
  (await page.locator(`${blockOf(windowId)} [data-window-tabs]`).count()) === 0;

export const THEMES = ['Light', 'WarmLight', 'BBPink', 'Darkenheimer', 'Blue'];

// A window's stored Chrome-group entries, by group id.
export const groupEntries = async (
  page: Page,
  id: string,
  windowIndex: number
): Promise<string[]> =>
  (
    sessionOf(await stored(page), id).windows[windowIndex]?.chromeTabGroups ??
    []
  ).map((g) => g.groupId);

// Onto a session row's centre. Leaves the pointer resting there.
export async function onto(page: Page, sessionId: string): Promise<void> {
  const b = await boxOf(sessionRow(page, sessionId));
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 5 });
  await expect.poll(() => carryTargets(page)).toEqual([sessionId]);
}

// Onto the phantom's own place, where nothing is shifted, so rows read as the drag measured them. Read after adoption: it compresses a group (KAN-160).
// A tab's or group's phantom rests in the trailing block (KAN-361/366), so the pane is scrolled to its end first.
export async function adoptPhantom(
  page: Page,
  phantomId: string
): Promise<void> {
  const phantom = page.locator(`[data-drag-row-id="${phantomId}"]`);
  await expect(phantom).toBeAttached();
  // PREMISE: where the phantom rests. A window's is a window row of its
  // own, in no window block; a tab's or group's, in the trailing block.
  const home = await phantom.evaluate((el) => ({
    isWindow: el.querySelector('[data-drop-window-id]') !== null,
    block:
      el
        .closest('[data-drop-window-id]')
        ?.getAttribute('data-new-window-target') ?? null,
  }));
  expect(home.block).toBe(home.isWindow ? null : 'last');
  if (!home.isWindow) await setDetailScroll(page, 1e6);
  const b = await boxOf(phantom);
  const x = b.x + Math.min(60, b.width / 2);
  await page.mouse.move(x, b.y + b.height / 2, { steps: 8 });
  await expect(phantom).toHaveAttribute('data-drag-held', '');
  const ownCentre = () =>
    phantom.evaluate((el: HTMLElement) => {
      const shift = Number(
        /translateY\((-?[\d.]+)px\)/.exec(el.style.transform)?.[1] ?? 0
      );
      const r = el.getBoundingClientRect();
      return { y: r.top - shift + r.height / 2, shift };
    });
  for (let i = 0; i < 3; i++) {
    const own = await ownCentre();
    if (Math.abs(own.shift) < 1) break;
    await page.mouse.move(x, own.y, { steps: 4 });
  }
  await expect
    .poll(async () => Math.abs((await ownCentre()).shift))
    .toBeLessThan(1);
  // The rows ease into place (KAN-165): until they have.
  await settled(page);
}

// The pointer to `frac` of the way down `rowId`'s box, as it is now.
export async function aimAt(
  page: Page,
  rowId: string,
  frac: number
): Promise<void> {
  const b = await boxOf(page.locator(`[data-drag-row-id="${rowId}"]`));
  await page.mouse.move(
    b.x + Math.min(60, b.width / 2),
    b.y + b.height * frac,
    {
      steps: 8,
    }
  );
  await settled(page);
}

// Two LayoutUnits (1/64px each): rows easing back under a transform snap their subpixel offset by up to one each (measured 451.5 -> 451.484375).
export const SLOT_EDGE_TOLERANCE = 2 / 64;

export async function expectSlotAsWideAs(
  page: Page,
  ref: { left: number; right: number }
): Promise<void> {
  // PREMISE: the landing is out of the target, where the slot is drawn (a
  // landing inside it lights the box and hides the slot, V2 A).
  expect(
    await page.locator('[data-new-window-target][data-landing]').count()
  ).toBe(0);
  // PREMISE: the reference row is indented, so a layout with no indent
  // cannot match it.
  expect(ref.left - (await detailPane(page)).left).toBeGreaterThan(60);
  const slot = await box(page, '[data-drag-landing-slot]');
  if (slot === null) throw new Error('no landing slot drawn');
  // Raw boxes, unrounded: the rows sit on half pixels (435.5).
  expect(
    Math.abs(slot.left - ref.left),
    `slot left ${slot.left} vs ${ref.left}`
  ).toBeLessThanOrEqual(SLOT_EDGE_TOLERANCE);
  expect(
    Math.abs(slot.right - ref.right),
    `slot right ${slot.right} vs ${ref.right}`
  ).toBeLessThanOrEqual(SLOT_EDGE_TOLERANCE);
}

export const rowBox = async (page: Page, rowId: string) => {
  const b = await box(page, `[data-drag-row-id="${rowId}"]`);
  if (b === null) throw new Error(`no row ${rowId}`);
  return b;
};

export const dragRow = (id: string) => `[data-drag-row-id="${id}"]`;
// An element's own box: where it is drawn, less the translate a drag gives it.
export const ownBox = (page: Page, selector: string) =>
  page.locator(selector).evaluate((el) => {
    if (!(el instanceof HTMLElement)) throw new Error('not an HTMLElement');
    const shift = Number(
      /translateY\((-?[\d.]+)px\)/.exec(el.style.transform)?.[1] ?? 0
    );
    const r = el.getBoundingClientRect();
    return { top: r.top - shift, bottom: r.bottom - shift };
  });

// "Below the list", as the plan measured it on main: midway between the
// last window's bottom and the pane's bottom. Read at rest.
export async function belowTheList(
  page: Page,
  lastWindowId: string
): Promise<number> {
  const last = await boxOf(
    page.locator(`[data-drop-window-id="${lastWindowId}"]`)
  );
  const pane = await detailPane(page);
  return (last.y + last.height + pane.bottom) / 2;
}

// The detail pane's scroll range: how far it can scroll, 0 for a list that
// fits.
export const scrollRange = (page: Page) =>
  page.evaluate(() => {
    let el = document.querySelector(
      '[data-pane="detail"] [data-drop-window-id]'
    )?.parentElement;
    while (el && !['auto', 'scroll'].includes(getComputedStyle(el).overflowY))
      el = el.parentElement;
    if (!el) throw new Error('no detail pane');
    return el.scrollHeight - el.clientHeight;
  });
