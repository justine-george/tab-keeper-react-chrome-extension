// KAN-350 on the real artifact: a saved tab, group or window dragged out of
// the session on screen and into another saved session -- a MOVE, saved to
// saved, that never touches Chrome.
//
// What jsdom could not show, and so what this file is for: real geometry (the
// pane's box, a sideways exit, the session list's rows and its auto-scroll),
// real timing (the 0.6s dwell, the frame the KAN-157 scroll comes back on, the
// frame KAN-155 follows the dropped row on), and real paint (the target's
// outline and fill line against the row's actual fill, the card over the
// list, the toast at a 20px root).
//
// Driven as the popup (790x550) and as the tab view, side by side and folded
// with a peek. Every move is read back from localStorage, where the app keeps
// it. The New window target's height, the lit target's slot, what shows where
// a carried window will land, and the target appearing in the source are
// awaiting Justine's pick (V1-V4): this file asserts only that the target is
// there and takes a drop, never how it looks.
//
// Pointer paths are aimed in the layout the drag measures: an adopted drag
// measures every row once, at adoption, with the held phantom at its own
// place. So each exact-spot drop first brings the pointer to the phantom's own
// centre (where nothing is shifted), reads the rows there, and only then aims.

import type { BrowserContext, Locator, Page, Worker } from '@playwright/test';

import { grantedTest as test, expect } from './fixtures/grantedExtension';
import {
  buildContainer,
  buildSession,
  seedSessions,
  seedSettings,
} from './fixtures/seed';
import { contrast, pixelsAt, rgbToHex } from './fixtures/pixels';
import type {
  TabMasterContainer,
  tabContainerData,
} from '../src/redux/slices/tabContainerDataStateSlice';
import { isValidTabMasterContainer } from '../src/utils/functions/local';

const POPUP = { width: 790, height: 550 };
const TAB_VIEW = { width: 1280, height: 800 };
// Wide enough for Open now's resize grip (KAN-321: above 1316px).
const TAB_VIEW_WIDE = { width: 1600, height: 900 };
const THEMES = ['Light', 'WarmLight', 'BBPink', 'Darkenheimer', 'Blue'];

// ---- fixtures ---------------------------------------------------------------

interface SeedTab {
  tabId: string;
  favicon: string;
  title: string;
  url: string;
  chromeGroupId?: string;
}

const tab = (id: string, g?: string): SeedTab => ({
  tabId: id,
  favicon: '',
  title: `Tab ${id}`,
  url: `https://${id}.test/`,
  ...(g ? { chromeGroupId: g } : {}),
});

const win = (
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

type SeedWindow = ReturnType<typeof win>;

const session = (
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

// S1, the session on screen: w1 holds three loose tabs and the group alpha,
// w2 two loose tabs. S2, the usual target: d1 holds two loose tabs, the group
// gamma, then one more loose tab; d2 two loose tabs. Small enough that no
// pane scrolls in the popup, so no drag here auto-scrolls by accident.
const S1 = () =>
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
const S2 = (title = 'Target') =>
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
const S3 = () => session('S3', 'Third', [win('f1', [tab('f0')])]);
const S4 = () => session('S4', 'Fourth', [win('h1', [tab('h0')])]);

const W1_START = 'a0 a1 a2 al0* al1*';
const D1_START = 'c0 c1 ga0* ga1* c2';

async function seed(
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

async function openPopup(
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

async function openTabView(
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

async function stored(page: Page): Promise<TabMasterContainer> {
  const raw = await page.evaluate(() =>
    localStorage.getItem('tabContainerData')
  );
  const parsed: unknown = JSON.parse(raw ?? 'null');
  if (!isValidTabMasterContainer(parsed)) {
    throw new Error(`tabContainerData is not a container: ${raw}`);
  }
  return parsed;
}

function sessionOf(c: TabMasterContainer, id: string): tabContainerData {
  const s = c.tabGroups.find((g) => g.tabGroupId === id);
  if (s === undefined) throw new Error(`no session ${id} stored`);
  return s;
}

// A session as its windows' tab orders, a star on every grouped tab.
const layoutOf = (s: tabContainerData): string[] =>
  s.windows.map((w) =>
    w.tabs.map((t) => t.tabId + (t.chromeGroupId ? '*' : '')).join(' ')
  );

const layout = async (page: Page, id: string): Promise<string[]> =>
  layoutOf(sessionOf(await stored(page), id));

// A session's window ids, with a window this test did not seed (one a move
// made) named `new`.
const SEEDED_WINDOWS = new Set(
  [S1(), S2(), S3(), S4()].flatMap((s) => s.windows.map((w) => w.windowId))
);
const windowIdsOf = async (page: Page, id: string): Promise<string[]> =>
  sessionOf(await stored(page), id).windows.map((w) =>
    SEEDED_WINDOWS.has(w.windowId) ? w.windowId : 'new'
  );

// A window's stored Chrome-group entries, by group id.
const groupEntries = async (
  page: Page,
  id: string,
  windowIndex: number
): Promise<string[]> =>
  (
    sessionOf(await stored(page), id).windows[windowIndex]?.chromeTabGroups ??
    []
  ).map((g) => g.groupId);

const selected = async (page: Page): Promise<string | null> =>
  (await stored(page)).selectedTabGroupId;

const sessionIds = async (page: Page): Promise<string[]> =>
  (await stored(page)).tabGroups.map((g) => g.tabGroupId);

// ---- Chrome is never touched ------------------------------------------------

async function chromeNow(worker: Worker): Promise<string> {
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

const CARD = '[data-carry-card]';

const sessionRow = (page: Page, id: string): Locator =>
  page.locator(`[data-pane="sessions"] [data-drag-row-id="${id}"]`);

async function boxOf(loc: Locator) {
  const b = await loc.boundingBox();
  if (b === null) throw new Error(`no box for ${loc.toString()}`);
  return b;
}

interface PaneBox {
  left: number;
  right: number;
  top: number;
  bottom: number;
  scrollTop: number;
}

// The saved detail's scrolling box -- what the engine's paneOf finds from a
// window row: its nearest overflow-auto ancestor.
const detailPane = (page: Page): Promise<PaneBox> =>
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

const setDetailScroll = (page: Page, top: number) =>
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
const carryTargets = (page: Page): Promise<string[]> =>
  page.evaluate(() =>
    [...document.querySelectorAll('[data-carry-target]')].map(
      (el) =>
        el.closest<HTMLElement>('[data-drag-row-id]')?.dataset.dragRowId ?? '?'
    )
  );

// The toasts on screen, oldest first: each one's message, and whether it
// carries Show.
const toasts = (page: Page) =>
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

// Counts every click that reaches the document. The click suppressor eats a
// drag's own click at the window, in the capture phase, before it can get
// here -- so a count above zero is a click that reached the page.
async function countClicks(page: Page): Promise<void> {
  await page.evaluate(() => {
    document.body.dataset.clicks = '0';
    // Capture, so a handler that stops the click's propagation further down
    // cannot hide it from the count.
    document.addEventListener(
      'click',
      () => {
        document.body.dataset.clicks = String(
          Number(document.body.dataset.clicks ?? '0') + 1
        );
      },
      true
    );
  });
}
const clicks = (page: Page): Promise<number> =>
  page.evaluate(() => Number(document.body.dataset.clicks ?? '-1'));

// ---- the gesture ------------------------------------------------------------

interface Point {
  x: number;
  y: number;
}

// Presses `handle` and drags it past the activation distance, inside the pane.
async function pickUp(page: Page, handle: Locator): Promise<Point> {
  const b = await boxOf(handle);
  const x = b.x + Math.min(60, b.width / 2);
  const y = b.y + b.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + 8, { steps: 2 });
  return { x, y: y + 8 };
}

const tabHandle = (page: Page, tabId: string) =>
  page.locator(`[data-drag-row-id="${tabId}"]`);
const groupHandle = (page: Page, groupId: string) =>
  page.locator(
    `[data-drag-row-id="group:${groupId}"] [data-group-drag-handle]`
  );
const windowHandle = (page: Page, windowId: string) =>
  page.locator(`[data-drag-row-id="${windowId}"] [data-window-drag-handle]`);

// Out of the detail to the left, at the same height, onto the session list
// -- the only place a saved drag is handed to the carry (KAN-352) -- until
// the card shows.
async function carryOutLeft(page: Page, from: Point): Promise<void> {
  const pane = await detailPane(page);
  const list = await boxOf(page.locator('[data-pane="sessions"]'));
  // PREMISE: the point is on the session list's pane.
  expect(pane.left - 40).toBeGreaterThan(list.x);
  expect(pane.left - 40).toBeLessThan(list.x + list.width);
  await page.mouse.move(pane.left - 40, from.y, { steps: 6 });
  await expect(page.locator(CARD)).toHaveCount(1);
}

// Records, from now on, whether a carry's card or a New window target was
// ever drawn -- even for one frame -- so a test can say none ever was.
async function watchForCarry(page: Page): Promise<void> {
  await page.evaluate(() => {
    // Each flag is written once: the observer hears attribute writes, its
    // own included, so a rewrite would call it again forever.
    const flag = () => {
      const b = document.body.dataset;
      if (b.sawCard !== '1' && document.querySelector('[data-carry-card]'))
        b.sawCard = '1';
      if (
        b.sawTarget !== '1' &&
        document.querySelector('[data-new-window-target]')
      )
        b.sawTarget = '1';
    };
    document.body.dataset.sawCard = '0';
    document.body.dataset.sawTarget = '0';
    new MutationObserver(flag).observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
    });
    flag();
  });
}
const sawCarry = (page: Page) =>
  page.evaluate(() => ({
    card: document.body.dataset.sawCard,
    target: document.body.dataset.sawTarget,
  }));

// Onto a session row's centre. Leaves the pointer resting there.
async function onto(page: Page, sessionId: string): Promise<void> {
  const b = await boxOf(sessionRow(page, sessionId));
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 5 });
  await expect.poll(() => carryTargets(page)).toEqual([sessionId]);
}

// Rests on a session's row until it opens (S1 A).
async function springOpen(page: Page, sessionId: string): Promise<void> {
  await onto(page, sessionId);
  await expect.poll(() => selected(page), { timeout: 3000 }).toBe(sessionId);
}

// Into the opened session, onto the phantom's own place: the list adopts the
// carried item, and with the held row at its own place nothing is shifted, so
// the rows can be read where the drag measured them.
//
// The own place is read AFTER the adoption, untransformed: adopting a group
// compresses it (KAN-160), which moves its own centre up from where the
// phantom was drawn before.
async function adoptPhantom(page: Page, phantomId: string): Promise<void> {
  const phantom = page.locator(`[data-drag-row-id="${phantomId}"]`);
  await expect(phantom).toBeAttached();
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
  // The rows ease into place over 0.18s (KAN-165).
  await page.waitForTimeout(300);
}

// The pointer to `frac` of the way down `rowId`'s box, as it is now.
async function aimAt(page: Page, rowId: string, frac: number): Promise<void> {
  const b = await boxOf(page.locator(`[data-drag-row-id="${rowId}"]`));
  await page.mouse.move(
    b.x + Math.min(60, b.width / 2),
    b.y + b.height * frac,
    {
      steps: 8,
    }
  );
  await page.waitForTimeout(250);
}

// ============================================================================

test.describe('a quick drop on a session row (S2 A)', () => {
  test('a tab becomes the new first window there, with a Moved toast that has Show', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const page = await openPopup(context, extensionId);
    const chromeBefore = await chromeNow(serviceWorker);

    const at = await pickUp(page, tabHandle(page, 'a1'));
    await carryOutLeft(page, at);
    await onto(page, 'S2');
    await page.mouse.up();

    await expect
      .poll(() => layout(page, 'S2'))
      .toEqual(['a1', D1_START, 'e0 e1']);
    expect(await windowIdsOf(page, 'S2')).toEqual(['new', 'd1', 'd2']);
    expect(await layout(page, 'S1')).toEqual(['a0 a2 al0* al1*', 'b0 b1']);
    // A new window is named after its first tab, as a captured one is.
    expect(sessionOf(await stored(page), 'S2').windows[0]?.title).toBe(
      'Tab a1'
    );
    // Quick: the drop came before the dwell, so the source stays on screen.
    expect(await selected(page)).toBe('S1');
    await expect
      .poll(() => toasts(page))
      .toEqual([{ text: 'Moved to “Target”', show: true }]);
    await expect(page.locator(CARD)).toHaveCount(0);
    expect(await chromeNow(serviceWorker)).toBe(chromeBefore);
  });

  test('a group becomes the new first window there, its entry with it', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const page = await openPopup(context, extensionId);
    const chromeBefore = await chromeNow(serviceWorker);

    const at = await pickUp(page, groupHandle(page, 'alpha'));
    await carryOutLeft(page, at);
    await onto(page, 'S2');
    await page.mouse.up();

    await expect
      .poll(() => layout(page, 'S2'))
      .toEqual(['al0* al1*', D1_START, 'e0 e1']);
    expect(await groupEntries(page, 'S2', 0)).toEqual(['alpha']);
    expect(await layout(page, 'S1')).toEqual(['a0 a1 a2', 'b0 b1']);
    expect(await groupEntries(page, 'S1', 0)).toEqual([]);
    expect(await selected(page)).toBe('S1');
    await expect
      .poll(() => toasts(page))
      .toEqual([{ text: 'Moved to “Target”', show: true }]);
    expect(await chromeNow(serviceWorker)).toBe(chromeBefore);
  });

  test('a window becomes the first window there, whole', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const page = await openPopup(context, extensionId);
    const chromeBefore = await chromeNow(serviceWorker);

    const at = await pickUp(page, windowHandle(page, 'w2'));
    await carryOutLeft(page, at);
    await onto(page, 'S2');
    await page.mouse.up();

    await expect
      .poll(() => windowIdsOf(page, 'S2'))
      .toEqual(['w2', 'd1', 'd2']);
    expect(await layout(page, 'S2')).toEqual(['b0 b1', D1_START, 'e0 e1']);
    expect(await layout(page, 'S1')).toEqual([W1_START]);
    expect(await selected(page)).toBe('S1');
    await expect
      .poll(() => toasts(page))
      .toEqual([{ text: 'Moved to “Target”', show: true }]);
    expect(await chromeNow(serviceWorker)).toBe(chromeBefore);
  });

  test('Show puts the target on screen and closes its toast', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId);
    const at = await pickUp(page, tabHandle(page, 'a1'));
    await carryOutLeft(page, at);
    await onto(page, 'S2');
    await page.mouse.up();
    await expect.poll(() => toasts(page)).toHaveLength(1);

    await page
      .getByRole('status')
      .getByRole('button', { name: 'Show', exact: true })
      .click();
    await expect.poll(() => selected(page)).toBe('S2');
    await expect(page.locator('[data-drag-row-id="d1"]')).toBeVisible();
    await expect.poll(() => toasts(page)).toEqual([]);
  });
});

test.describe('the source emptied (S4 B, Q4 A)', () => {
  test('two toasts in order, the Moved one without Show; the source tombstoned, the target on screen; ⌘Z brings both back', async ({
    context,
    extensionId,
  }) => {
    const lonely = session('S5', 'Lonely', [win('z1', [tab('z0')])]);
    const page = await openPopup(
      context,
      extensionId,
      [lonely, S2(), S3()],
      'S5'
    );

    const at = await pickUp(page, tabHandle(page, 'z0'));
    await carryOutLeft(page, at);
    await onto(page, 'S2');
    await page.mouse.up();

    await expect.poll(() => sessionIds(page)).not.toContain('S5');
    const after = await stored(page);
    expect(layoutOf(sessionOf(after, 'S2'))).toEqual(['z0', D1_START, 'e0 e1']);
    expect((after.deletedTabGroups ?? []).map((d) => d.tabGroupId)).toContain(
      'S5'
    );
    // Q4 A: the target is selected, so the detail is not left blank.
    expect(after.selectedTabGroupId).toBe('S2');
    await expect(page.locator('[data-drag-row-id="d1"]')).toBeVisible();
    // The Show rule: the target is on screen after the drop, so no Show.
    await expect
      .poll(() => toasts(page))
      .toEqual([
        { text: 'Moved to “Target”', show: false },
        { text: '“Lonely” was empty and was removed.', show: false },
      ]);

    await page.keyboard.press('Control+z');
    await expect.poll(() => sessionIds(page)).toContain('S5');
    const back = await stored(page);
    expect(layoutOf(sessionOf(back, 'S5'))).toEqual(['z0']);
    expect(layoutOf(sessionOf(back, 'S2'))).toEqual([D1_START, 'e0 e1']);
    expect(
      (back.deletedTabGroups ?? []).map((d) => d.tabGroupId)
    ).not.toContain('S5');
  });
});

test.describe('a spring-open, then an exact spot (S1 A, S5 A)', () => {
  // Each: carry out, rest on S2 until it opens, adopt the phantom, aim, let
  // go. A drop into the opened session gets no Moved toast (S5 A).
  async function intoS2(
    page: Page,
    handle: Locator,
    phantomId: string
  ): Promise<void> {
    const at = await pickUp(page, handle);
    await carryOutLeft(page, at);
    await springOpen(page, 'S2');
    await adoptPhantom(page, phantomId);
  }

  const tabSpots: [string, string, number, string[]][] = [
    ['the start of a window', 'c0', 0.25, ['a1 c0 c1 ga0* ga1* c2', 'e0 e1']],
    ['the middle of a window', 'c1', 0.25, ['c0 a1 c1 ga0* ga1* c2', 'e0 e1']],
    ['the end of a window', 'e1', 0.75, [D1_START, 'e0 e1 a1']],
    ['into a band', 'ga1', 0.25, ['c0 c1 ga0* a1* ga1* c2', 'e0 e1']],
  ];
  for (const [name, rowId, frac, want] of tabSpots) {
    test(`a tab, to ${name}`, async ({
      context,
      extensionId,
      serviceWorker,
    }) => {
      const page = await openPopup(context, extensionId);
      const chromeBefore = await chromeNow(serviceWorker);
      await intoS2(page, tabHandle(page, 'a1'), 'carried:a1');
      await aimAt(page, rowId, frac);
      await page.mouse.up();

      await expect.poll(() => layout(page, 'S2')).toEqual(want);
      expect(await layout(page, 'S1')).toEqual(['a0 a2 al0* al1*', 'b0 b1']);
      expect(await selected(page)).toBe('S2');
      expect(await toasts(page)).toEqual([]);
      await expect(page.locator(CARD)).toHaveCount(0);
      expect(await chromeNow(serviceWorker)).toBe(chromeBefore);
    });
  }

  const groupSpots: [string, string, number, string[]][] = [
    [
      'the start of a window',
      'tab:c0',
      0.25,
      ['al0* al1* c0 c1 ga0* ga1* c2', 'e0 e1'],
    ],
    [
      'beside a group',
      'tab:c2',
      0.25,
      ['c0 c1 ga0* ga1* al0* al1* c2', 'e0 e1'],
    ],
    ['the end of a window', 'tab:e1', 0.75, [D1_START, 'e0 e1 al0* al1*']],
  ];
  for (const [name, rowId, frac, want] of groupSpots) {
    test(`a group, to ${name}`, async ({
      context,
      extensionId,
      serviceWorker,
    }) => {
      const page = await openPopup(context, extensionId);
      const chromeBefore = await chromeNow(serviceWorker);
      await intoS2(page, groupHandle(page, 'alpha'), 'group:carried:alpha');
      await aimAt(page, rowId, frac);
      await page.mouse.up();

      await expect.poll(() => layout(page, 'S2')).toEqual(want);
      const landedIn = want.findIndex((w) => w.includes('al0'));
      expect((await groupEntries(page, 'S2', landedIn)).sort()).toEqual(
        landedIn === 0 ? ['alpha', 'gamma'] : ['alpha']
      );
      expect(await layout(page, 'S1')).toEqual(['a0 a1 a2', 'b0 b1']);
      expect(await toasts(page)).toEqual([]);
      expect(await chromeNow(serviceWorker)).toBe(chromeBefore);
    });
  }

  const windowSpots: [string, string, number, string[]][] = [
    ['the start', 'd1', 0.25, ['w2', 'd1', 'd2']],
    ['the middle', 'd2', 0.25, ['d1', 'w2', 'd2']],
    ['the end', 'd2', 0.75, ['d1', 'd2', 'w2']],
  ];
  for (const [name, rowId, frac, want] of windowSpots) {
    test(`a window, to ${name} of the session`, async ({
      context,
      extensionId,
      serviceWorker,
    }) => {
      const page = await openPopup(context, extensionId);
      const chromeBefore = await chromeNow(serviceWorker);
      await intoS2(page, windowHandle(page, 'w2'), 'carried:w2');
      await aimAt(page, rowId, frac);
      await page.mouse.up();

      await expect.poll(() => windowIdsOf(page, 'S2')).toEqual(want);
      expect(await layout(page, 'S1')).toEqual([W1_START]);
      expect(await toasts(page)).toEqual([]);
      expect(await chromeNow(serviceWorker)).toBe(chromeBefore);
    });
  }
});

test.describe('the New window target (S3 A, Q2 A)', () => {
  test('in the opened session it is there for a tab, and a drop on it makes a new first window', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId);
    const at = await pickUp(page, tabHandle(page, 'a1'));
    await carryOutLeft(page, at);
    await springOpen(page, 'S2');
    await expect(page.locator('[data-new-window-target]')).toHaveCount(1);
    await adoptPhantom(page, 'carried:a1');
    await expect(page.locator('[data-new-window-target]')).toHaveAttribute(
      'data-landing',
      ''
    );
    await page.mouse.up();

    await expect
      .poll(() => layout(page, 'S2'))
      .toEqual(['a1', D1_START, 'e0 e1']);
    expect(await windowIdsOf(page, 'S2')).toEqual(['new', 'd1', 'd2']);
    expect(await toasts(page)).toEqual([]);
    await expect(page.locator('[data-new-window-target]')).toHaveCount(0);
  });

  test('a group dropped on it makes a new first window holding the group', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId);
    const at = await pickUp(page, groupHandle(page, 'alpha'));
    await carryOutLeft(page, at);
    await springOpen(page, 'S2');
    await adoptPhantom(page, 'group:carried:alpha');
    await page.mouse.up();

    await expect
      .poll(() => layout(page, 'S2'))
      .toEqual(['al0* al1*', D1_START, 'e0 e1']);
    expect(await groupEntries(page, 'S2', 0)).toEqual(['alpha']);
  });

  test('Q2 A: back in the source after reaching the list, it is there too, and a drop on it makes a new window in the same session', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId);
    const at = await pickUp(page, tabHandle(page, 'a1'));
    await carryOutLeft(page, at);
    // Shown in the source while carried (Q2 A), and the tab gone from w1.
    await expect(page.locator('[data-new-window-target]')).toHaveCount(1);
    await adoptPhantom(page, 'carried:a1');
    await page.mouse.up();

    await expect
      .poll(() => layout(page, 'S1'))
      .toEqual(['a1', 'a0 a2 al0* al1*', 'b0 b1']);
    expect(await windowIdsOf(page, 'S1')).toEqual(['new', 'w1', 'w2']);
    expect(await layout(page, 'S2')).toEqual([D1_START, 'e0 e1']);
    expect(await selected(page)).toBe('S1');
    expect(await toasts(page)).toEqual([]);
  });

  test('a carried window has no target: a window lands between windows', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId);
    const at = await pickUp(page, windowHandle(page, 'w2'));
    await carryOutLeft(page, at);
    await springOpen(page, 'S2');
    await expect(
      page.locator('[data-drag-row-id="carried:w2"]')
    ).toBeAttached();
    await expect(page.locator('[data-new-window-target]')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await page.mouse.up();
  });
});

test.describe('nothing moves (Q5 A)', () => {
  test('Esc after a spring-open leaves the opened session on screen, and moves nothing', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId);
    const at = await pickUp(page, tabHandle(page, 'a1'));
    await carryOutLeft(page, at);
    await springOpen(page, 'S2');
    await page.keyboard.press('Escape');
    await expect(page.locator(CARD)).toHaveCount(0);
    await page.mouse.up();

    expect(await selected(page)).toBe('S2');
    await expect(page.locator('[data-drag-row-id="d1"]')).toBeVisible();
    expect(await layout(page, 'S1')).toEqual([W1_START, 'b0 b1']);
    expect(await layout(page, 'S2')).toEqual([D1_START, 'e0 e1']);
    expect(await toasts(page)).toEqual([]);
  });

  test('a release over nothing after a spring-open leaves the opened session on screen, and moves nothing', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId);
    const at = await pickUp(page, tabHandle(page, 'a1'));
    await carryOutLeft(page, at);
    await springOpen(page, 'S2');
    // Below the last session row, in the list's empty space.
    const list = await boxOf(sessionRow(page, 'S4'));
    await page.mouse.move(list.x + 100, list.y + list.height + 60, {
      steps: 4,
    });
    await expect.poll(() => carryTargets(page)).toEqual([]);
    await page.mouse.up();

    await expect(page.locator(CARD)).toHaveCount(0);
    expect(await selected(page)).toBe('S2');
    expect(await layout(page, 'S1')).toEqual([W1_START, 'b0 b1']);
    expect(await layout(page, 'S2')).toEqual([D1_START, 'e0 e1']);
  });
});

test.describe('only the session list carries (hand-off, KAN-352)', () => {
  test('CONTROL: out of the pane below or above, no carry: the drag stays a drag in the list', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId);
    const pane = await detailPane(page);
    const at = await pickUp(page, tabHandle(page, 'a1'));
    // PREMISE: there is room below and above the pane inside the page.
    expect(pane.bottom).toBeLessThan(POPUP.height - 2);
    expect(pane.top).toBeGreaterThan(2);

    await page.mouse.move(at.x, POPUP.height - 1, { steps: 6 });
    await page.waitForTimeout(200);
    await expect(page.locator(CARD)).toHaveCount(0);
    await expect(tabHandle(page, 'a1')).toHaveAttribute('data-drag-held', '');

    await page.mouse.move(at.x, 1, { steps: 10 });
    await page.waitForTimeout(200);
    await expect(page.locator(CARD)).toHaveCount(0);
    await expect(tabHandle(page, 'a1')).toHaveAttribute('data-drag-held', '');
    await page.keyboard.press('Escape');
    await page.mouse.up();
    expect(await layout(page, 'S1')).toEqual([W1_START, 'b0 b1']);
  });

  // KAN-352. Right of the pane is no receiver: the drag stays the list's
  // own, and lets go as any drag beside its pane does -- in the held row's
  // own window, at the pointer's height.
  test('out to the right in the popup is no carry: the drag stays a drag, and lands', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId);
    const pane = await detailPane(page);
    // PREMISE, measured: the pane stops short of the popup's right edge, so a
    // pointer can be right of it and still inside the page.
    expect(pane.right).toBeLessThan(POPUP.width - 1);
    await watchForCarry(page);
    await pickUp(page, tabHandle(page, 'a1'));
    // At a2's lower half: past its midpoint, so the preview puts a1 after it.
    const a2 = await boxOf(tabHandle(page, 'a2'));
    await page.mouse.move(POPUP.width - 1, a2.y + a2.height * 0.75, {
      steps: 6,
    });
    await page.waitForTimeout(200);
    await expect(tabHandle(page, 'a1')).toHaveAttribute('data-drag-held', '');
    await page.mouse.up();

    await expect
      .poll(() => layout(page, 'S1'))
      .toEqual(['a0 a2 a1 al0* al1*', 'b0 b1']);
    expect(await sawCarry(page)).toEqual({ card: '0', target: '0' });
    expect(await toasts(page)).toEqual([]);
  });

  // KAN-352, the same rule for an adopted drag: out of the opened session to
  // the right it stays adopted (the old rule handed it back there); only on
  // the session list is it carried again, and then a row drop takes it.
  test('an adopted drag is carried again only on the list, never beside the pane', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId);
    const at = await pickUp(page, tabHandle(page, 'a1'));
    await carryOutLeft(page, at);
    await springOpen(page, 'S2');
    await adoptPhantom(page, 'carried:a1');
    const phantom = page.locator('[data-drag-row-id="carried:a1"]');

    const c1 = await boxOf(tabHandle(page, 'c1'));
    await page.mouse.move(POPUP.width - 1, c1.y + c1.height / 2, {
      steps: 6,
    });
    await page.waitForTimeout(200);
    // Still this list's drag: the phantom held, nothing on the list aimed.
    await expect(phantom).toHaveAttribute('data-drag-held', '');
    expect(await carryTargets(page)).toEqual([]);

    await onto(page, 'S3');
    await expect(phantom).not.toHaveAttribute('data-drag-held', '');
    await page.mouse.up();

    await expect.poll(() => layout(page, 'S3')).toEqual(['a1', 'f0']);
    expect(await layout(page, 'S2')).toEqual([D1_START, 'e0 e1']);
    expect(await layout(page, 'S1')).toEqual(['a0 a2 al0* al1*', 'b0 b1']);
  });

  // KAN-352, aimed where the old rule fired: Open now's resize grip sits just
  // right of the detail pane. A saved drag drifting onto it, and let go
  // there, is an ordinary move -- no card, no New window target, ever.
  test('a drag let go on the Open now resize grip is an ordinary move, never a carry', async ({
    context,
    extensionId,
  }) => {
    const page = await openTabView(
      context,
      extensionId,
      false,
      undefined,
      TAB_VIEW_WIDE
    );
    const gripLoc = page.locator('[data-resize-grip]');
    await expect(gripLoc).toHaveCount(1);
    const grip = await boxOf(gripLoc);
    const pane = await detailPane(page);
    // PREMISE: the grip is right of the pane, outside its box -- a sideways
    // exit, which the old rule handed off.
    expect(grip.x).toBeGreaterThanOrEqual(pane.right);
    await watchForCarry(page);

    await pickUp(page, tabHandle(page, 'a1'));
    const a2 = await boxOf(tabHandle(page, 'a2'));
    const onGrip = { x: grip.x + grip.width / 2, y: a2.y + a2.height * 0.75 };
    await page.mouse.move(onGrip.x, onGrip.y, { steps: 8 });
    // PREMISE: the pointer is over the grip, with the row still held.
    expect(await gripLoc.evaluate((el) => el.matches(':hover'))).toBe(true);
    await page.waitForTimeout(200);
    await expect(tabHandle(page, 'a1')).toHaveAttribute('data-drag-held', '');
    expect(await page.locator(CARD).count()).toBe(0);
    await page.mouse.up();

    await expect
      .poll(() => layout(page, 'S1'))
      .toEqual(['a0 a2 a1 al0* al1*', 'b0 b1']);
    expect(await sawCarry(page)).toEqual({ card: '0', target: '0' });
    expect(await toasts(page)).toEqual([]);
  });
});

test.describe('Review Focus 2: cancels, quick passes, the shown row', () => {
  test('a release over the header cancels, with no stray click', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId);
    await countClicks(page);
    const sort = page.getByRole('button', { name: 'Sort sessions' });
    const at = await pickUp(page, tabHandle(page, 'a1'));
    await carryOutLeft(page, at);
    const b = await boxOf(sort);
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, {
      steps: 6,
    });
    await expect.poll(() => carryTargets(page)).toEqual([]);
    await page.mouse.up();

    await expect(page.locator(CARD)).toHaveCount(0);
    await page.waitForTimeout(300);
    expect(await clicks(page)).toBe(0);
    await expect(page.getByRole('menu')).toHaveCount(0);
    expect(await layout(page, 'S1')).toEqual([W1_START, 'b0 b1']);
    // The tab is back in its source on screen.
    await expect(tabHandle(page, 'a1')).toBeVisible();

    // CONTROL: a real click at the same place reaches the page, so the zero
    // above is the suppressor's, not a listener that never hears clicks.
    await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
    await expect.poll(() => clicks(page)).toBe(1);
  });

  // KAN-352: over Open now is no receiver, so the saved drag never becomes a
  // carry there. Let go over a live row, it is refused as any saved drag
  // there is: nothing moves, and the live row hears no click.
  test('a release over Open now moves nothing, with no stray click, and Chrome is untouched', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const page = await openTabView(context, extensionId, false);
    const chromeBefore = await chromeNow(serviceWorker);
    await countClicks(page);
    await watchForCarry(page);
    const openNow = page.locator('[data-pane="open-now"]');
    const liveRow = openNow.getByRole('button', { name: /^Switch to tab: / });
    await expect(liveRow.first()).toBeVisible();
    const target = await boxOf(liveRow.first());

    const at = await pickUp(page, tabHandle(page, 'a1'));
    await page.mouse.move(target.x + target.width / 2, at.y, { steps: 8 });
    await expect(tabHandle(page, 'a1')).toHaveAttribute('data-drag-held', '');
    await page.mouse.move(
      target.x + target.width / 2,
      target.y + target.height / 2,
      { steps: 4 }
    );
    await page.mouse.up();

    await page.waitForTimeout(300);
    expect(await sawCarry(page)).toEqual({ card: '0', target: '0' });
    expect(await clicks(page)).toBe(0);
    expect(await layout(page, 'S1')).toEqual([W1_START, 'b0 b1']);
    expect(await chromeNow(serviceWorker)).toBe(chromeBefore);

    // CONTROL: the same place clicked for real is heard.
    await page.mouse.click(
      target.x + target.width / 2,
      target.y + target.height / 2
    );
    await expect.poll(() => clicks(page)).toBe(1);
  });

  test('rows only passed over open nothing', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId);
    const at = await pickUp(page, tabHandle(page, 'a1'));
    await carryOutLeft(page, at);
    // Each row is the target for well under the dwell.
    for (const id of ['S2', 'S3', 'S4', 'S3', 'S2']) {
      await onto(page, id);
      await page.waitForTimeout(150);
    }
    // Off the list, over the header: no target, no timer left running.
    const sort = await boxOf(
      page.getByRole('button', { name: 'Sort sessions' })
    );
    await page.mouse.move(sort.x + sort.width / 2, sort.y + sort.height / 2, {
      steps: 4,
    });
    await page.waitForTimeout(900);
    expect(await selected(page)).toBe('S1');
    await page.keyboard.press('Escape');
    await page.mouse.up();
    expect(await layout(page, 'S1')).toEqual([W1_START, 'b0 b1']);
  });

  test('the shown row: an outline but no line and no opening, and a drop there is a row drop with no Moved toast (Q3 A)', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId);
    const at = await pickUp(page, tabHandle(page, 'a1'));
    await carryOutLeft(page, at);
    await onto(page, 'S1');
    await expect(page.locator('[data-carry-dwell-line]')).toHaveCount(0);
    await page.waitForTimeout(900);
    expect(await selected(page)).toBe('S1');
    expect(await carryTargets(page)).toEqual(['S1']);
    await page.mouse.up();

    await expect
      .poll(() => layout(page, 'S1'))
      .toEqual(['a1', 'a0 a2 al0* al1*', 'b0 b1']);
    expect(await toasts(page)).toEqual([]);
  });
});

test.describe('the looks (D1 A, D2 A, S1 A)', () => {
  // The outline and the line as painted, against the row's painted fill.
  // CONTROL in each: the fill pixel is the hover colour the row's box-shadow
  // declares, so the decode is faithful before a ratio is built on it.
  for (const theme of THEMES) {
    test(`the target outline and the fill line clear 3:1 against the row's fill (${theme})`, async ({
      context,
      extensionId,
    }) => {
      await seedSettings(context, { theme });
      const page = await openPopup(context, extensionId);
      // The selected row at rest, pointer elsewhere: the selection fill.
      const s1 = await boxOf(sessionRow(page, 'S1'));
      const [restingSelected] = await pixelsAt(page, [
        [s1.x + s1.width / 2, s1.y + 5],
      ]);
      const at = await pickUp(page, tabHandle(page, 'a1'));
      await carryOutLeft(page, at);
      await onto(page, 'S2');
      const line = page.locator('[data-carry-dwell-line]');
      await expect(line).toHaveCount(1);
      const measure = (rowId: string) =>
        page.evaluate((rowId) => {
          const row = document
            .querySelector(
              `[data-pane="sessions"] [data-drag-row-id="${rowId}"]`
            )
            ?.querySelector<HTMLElement>('[data-carry-target]');
          if (!row) throw new Error(`${rowId} is not the target`);
          const cs = getComputedStyle(row);
          const b = row.getBoundingClientRect();
          const l = row.querySelector<HTMLElement>('[data-carry-dwell-line]');
          const lb = l?.getBoundingClientRect();
          return {
            outline: cs.outlineColor,
            outlineWidth: cs.outlineWidth,
            fillDeclared:
              /rgba?\([^)]*\)|#[0-9a-f]{3,8}/i.exec(cs.boxShadow)?.[0] ?? '',
            line: l ? getComputedStyle(l).backgroundColor : null,
            lineAt: lb ? [lb.left + 2, lb.top + lb.height / 2] : null,
            outlineAt: [b.left + b.width / 2, b.top + 1],
            fillAt: [b.left + b.width / 2, b.top + 5],
          };
        }, rowId);

      const m = await measure('S2');
      if (m.lineAt === null || m.line === null) throw new Error('no line');
      const [outlinePx, fillPx, linePx] = await pixelsAt(page, [
        [m.outlineAt[0], m.outlineAt[1]],
        [m.fillAt[0], m.fillAt[1]],
        [m.lineAt[0], m.lineAt[1]],
      ]);
      // CONTROLS: what is painted is what is declared.
      expect(fillPx).toBe(rgbToHex(m.fillDeclared));
      expect(outlinePx).toBe(rgbToHex(m.outline));
      expect(linePx).toBe(rgbToHex(m.line));
      expect(m.outlineWidth).toBe('2px');
      const outlineRatio = contrast(outlinePx, fillPx);
      const lineRatio = contrast(linePx, fillPx);

      // The selected row as the target: the hover fill, not the selection
      // fill (D2 A), and no line (it is the session on screen).
      await onto(page, 'S1');
      const s = await measure('S1');
      const [selOutlinePx, selFillPx] = await pixelsAt(page, [
        [s.outlineAt[0], s.outlineAt[1]],
        [s.fillAt[0], s.fillAt[1]],
      ]);
      expect(s.line).toBe(null);
      // PREMISE: the selection fill is not the hover fill, so the next line
      // can tell them apart.
      expect(restingSelected).not.toBe(fillPx);
      expect(selFillPx).toBe(fillPx);
      const selectedRatio = contrast(selOutlinePx, selFillPx);
      console.log(
        `[${theme}] outline ${outlinePx} line ${linePx} on ${fillPx}: ${outlineRatio.toFixed(
          2
        )} / ${lineRatio.toFixed(
          2
        )}; selected ${selOutlinePx} on ${selFillPx}: ${selectedRatio.toFixed(
          2
        )}`
      );
      expect(outlineRatio).toBeGreaterThanOrEqual(3);
      expect(lineRatio).toBeGreaterThanOrEqual(3);
      expect(selectedRatio).toBeGreaterThanOrEqual(3);
      await page.keyboard.press('Escape');
      await page.mouse.up();
    });
  }

  test('the fill line runs exactly as long as the dwell', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId);
    const at = await pickUp(page, tabHandle(page, 'a1'));
    await carryOutLeft(page, at);
    await onto(page, 'S2');
    const duration = await page
      .locator('[data-carry-dwell-line]')
      .evaluate((el) =>
        el.getAnimations().map((a) => a.effect?.getTiming().duration)
      );
    expect(duration).toEqual([600]);
    await page.keyboard.press('Escape');
    await page.mouse.up();
  });

  test('reduced motion: no line, and the session still opens after the wait', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const at = await pickUp(page, tabHandle(page, 'a1'));
    await carryOutLeft(page, at);
    await onto(page, 'S2');
    const started = Date.now();
    await expect(page.locator('[data-carry-dwell-line]')).toHaveCount(0);
    await expect.poll(() => selected(page), { timeout: 3000 }).toBe('S2');
    // Not at once: it waited for the dwell.
    expect(Date.now() - started).toBeGreaterThanOrEqual(400);
    await page.keyboard.press('Escape');
    await page.mouse.up();
  });

  test('the card follows the pointer outside the detail, painted whole', async ({
    context,
    extensionId,
  }) => {
    await seedSettings(context, { theme: 'Darkenheimer' });
    const page = await openPopup(context, extensionId);
    const pane = await detailPane(page);
    const s3 = await boxOf(sessionRow(page, 'S3'));
    const probe: [number, number] = [s3.x + 40, s3.y + s3.height / 2 + 12];
    const [before] = await pixelsAt(page, [probe]);

    const at = await pickUp(page, tabHandle(page, 'a1'));
    await carryOutLeft(page, at);
    await page.mouse.move(probe[0] - 20, probe[1] - 10, { steps: 4 });
    const card = page.locator(CARD);
    await expect(card).toHaveText('Tab a1');
    const b = await boxOf(card);
    // Outside the detail's box, inside the page, and a child of body: no
    // pane's overflow can clip it.
    expect(b.x + b.width).toBeLessThan(pane.left);
    expect(b.x).toBeGreaterThanOrEqual(0);
    expect(
      await card.evaluate((el) => el.parentElement === document.body)
    ).toBe(true);
    const bg = await card.evaluate(
      (el) => getComputedStyle(el).backgroundColor
    );
    const [during] = await pixelsAt(page, [probe]);
    // PREMISE: the card's fill differs from what is under it.
    expect(before).not.toBe(rgbToHex(bg));
    expect(during).toBe(rgbToHex(bg));
    await page.keyboard.press('Escape');
    await page.mouse.up();
  });

  test('the Moved toast with a long title at a 20px root keeps Show whole', async ({
    context,
    extensionId,
  }) => {
    const long =
      'A very long session title that goes on and on, far past what any toast could hold';
    const page = await openPopup(context, extensionId, [S1(), S2(long), S3()]);
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '20px';
    });
    expect(
      await page.evaluate(
        () => getComputedStyle(document.documentElement).fontSize
      )
    ).toBe('20px');

    const at = await pickUp(page, tabHandle(page, 'a1'));
    await carryOutLeft(page, at);
    await onto(page, 'S2');
    await page.mouse.up();

    const toast = page.locator('[role="status"] [data-toast]');
    await expect(toast).toHaveCount(1);
    const show = toast.getByRole('button', { name: 'Show', exact: true });
    await expect(show).toBeVisible();
    const m = await toast.evaluate((t) => {
      const span = t.querySelector('span');
      const chip = [...t.querySelectorAll('button')].find(
        (b) => b.textContent?.trim() === 'Show'
      );
      if (!span || !chip) throw new Error('no message or no Show');
      const tb = t.getBoundingClientRect();
      const cb = chip.getBoundingClientRect();
      return {
        text: span.textContent,
        cut: span.scrollWidth > span.clientWidth,
        spanRight: span.getBoundingClientRect().right,
        chipLeft: cb.left,
        chipRight: cb.right,
        chipWhole: chip.scrollWidth <= chip.clientWidth,
        toastRight: tb.right,
        toastWidth: tb.width,
      };
    });
    // PREMISE: the title really is too long, so the line is cut.
    expect(m.text).toBe(`Moved to “${long}”`);
    expect(m.cut).toBe(true);
    // Show is whole, inside the toast, and the message stops before it.
    expect(m.chipWhole).toBe(true);
    expect(m.chipRight).toBeLessThanOrEqual(m.toastRight);
    expect(m.spanRight).toBeLessThanOrEqual(m.chipLeft);
    expect(m.toastWidth).toBeLessThanOrEqual(30 * 20);
  });
});

test.describe('Review Focus 3: a long list, a long session', () => {
  test('a 30-session list: the list auto-scrolls under a carry, and a drop on a row below the fold moves there', async ({
    context,
    extensionId,
  }) => {
    const many = Array.from({ length: 30 }, (_, i) =>
      session(`L${i}`, `List ${i}`, [win(`lw${i}`, [tab(`l${i}`)])])
    );
    const page = await openPopup(context, extensionId, [S1(), ...many]);
    const at = await pickUp(page, tabHandle(page, 'a1'));
    await carryOutLeft(page, at);
    // Rest in the list's bottom edge zone until the last row is the target.
    const list = await page.evaluate(() => {
      let s = document.querySelector(
        '[data-pane="sessions"] [data-drag-row-id="S1"]'
      )?.parentElement;
      while (s && !['auto', 'scroll'].includes(getComputedStyle(s).overflowY))
        s = s.parentElement;
      if (!s) throw new Error('no list');
      const b = s.getBoundingClientRect();
      return { left: b.left, bottom: b.bottom, scrollTop: s.scrollTop };
    });
    // PREMISE: the last row starts below the fold, and the list at its top.
    expect((await boxOf(sessionRow(page, 'L29'))).y).toBeGreaterThan(
      list.bottom
    );
    expect(list.scrollTop).toBe(0);
    await page.mouse.move(list.left + 100, list.bottom - 10, { steps: 6 });
    await expect
      .poll(() => carryTargets(page), { timeout: 10000 })
      .toEqual(['L29']);
    await page.mouse.up();

    await expect.poll(() => layout(page, 'L29')).toEqual(['a1', 'l29']);
    expect(await layout(page, 'S1')).toEqual(['a0 a2 al0* al1*', 'b0 b1']);
    await expect
      .poll(() => toasts(page))
      .toEqual([{ text: 'Moved to “List 29”', show: true }]);
  });

  // Five windows of six tabs: far taller than the popup's pane.
  const longSession = (id: string, title: string, prefix: string) =>
    session(
      id,
      title,
      Array.from({ length: 5 }, (_, w) =>
        win(
          `${prefix}w${w}`,
          Array.from({ length: 6 }, (_, t) => tab(`${prefix}${w}-${t}`))
        )
      )
    );

  test('a long session: a window carried out of it and cancelled comes back to the scroll it had (KAN-157)', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(
      context,
      extensionId,
      [longSession('S1', 'Long', 'x'), S2()],
      'S1'
    );
    expect(await setDetailScroll(page, 300)).toBe(300);
    const pane = await detailPane(page);
    // A window whose header sits in the middle of the pane, clear of both
    // auto-scroll zones.
    const handleId = await page.evaluate(
      ({ top, bottom }) => {
        for (const h of document.querySelectorAll<HTMLElement>(
          '[data-window-drag-handle]'
        )) {
          const b = h.getBoundingClientRect();
          if (b.top > top + 80 && b.bottom < bottom - 80)
            return h.closest<HTMLElement>('[data-drag-row-id]')?.dataset
              .dragRowId;
        }
        return undefined;
      },
      { top: pane.top, bottom: pane.bottom }
    );
    if (handleId === undefined) throw new Error('no window header mid-pane');

    const at = await pickUp(page, windowHandle(page, handleId));
    await carryOutLeft(page, at);
    // PREMISE: the carry keeps the windows folded, which clamped the scroll:
    // the 300 has to be put back, not merely left alone.
    await expect
      .poll(async () => (await detailPane(page)).scrollTop)
      .toBeLessThan(300);
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await expect(page.locator(CARD)).toHaveCount(0);
    await expect.poll(async () => (await detailPane(page)).scrollTop).toBe(300);
    // Nothing moved.
    expect((await windowIdsOf(page, 'S1')).length).toBe(5);
  });

  test('a long session: a window let go at the end of the opened one is followed into view (KAN-155)', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId, [
      S1(),
      longSession('S2', 'Long target', 'y'),
    ]);
    const at = await pickUp(page, windowHandle(page, 'w2'));
    await carryOutLeft(page, at);
    await springOpen(page, 'S2');
    await adoptPhantom(page, 'carried:w2');
    // Every window is folded while a window is dragged: the last one's lower
    // half is the end of the session.
    await aimAt(page, 'yw4', 0.75);
    await page.mouse.up();

    await expect
      .poll(async () =>
        sessionOf(await stored(page), 'S2').windows.map((w) => w.windowId)
      )
      .toEqual(['yw0', 'yw1', 'yw2', 'yw3', 'yw4', 'w2']);
    // The window lands last, unfolded far below the fold -- and is followed.
    const pane = await detailPane(page);
    await expect
      .poll(async () => {
        const b = await boxOf(page.locator('[data-drag-row-id="w2"]'));
        return b.y < pane.bottom && b.y + b.height > pane.top;
      })
      .toBe(true);
    expect((await detailPane(page)).scrollTop).toBeGreaterThan(0);
  });
});

test.describe('the tab view', () => {
  test('side by side: a quick drop on a session row moves the tab there', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const page = await openTabView(context, extensionId, false);
    const chromeBefore = await chromeNow(serviceWorker);
    const at = await pickUp(page, tabHandle(page, 'a1'));
    await carryOutLeft(page, at);
    await onto(page, 'S2');
    await page.mouse.up();
    await expect
      .poll(() => layout(page, 'S2'))
      .toEqual(['a1', D1_START, 'e0 e1']);
    expect(await chromeNow(serviceWorker)).toBe(chromeBefore);
  });

  test('folded, with a peek: a spring-open shows the target in the peek, and an exact spot there takes the tab', async ({
    context,
    extensionId,
  }) => {
    const page = await openTabView(context, extensionId, true);
    const at = await pickUp(page, tabHandle(page, 'a1'));
    await carryOutLeft(page, at);
    await springOpen(page, 'S2');
    await expect(page.locator('[data-drag-row-id="d1"]')).toBeVisible();
    await adoptPhantom(page, 'carried:a1');
    await aimAt(page, 'c1', 0.25);
    await page.mouse.up();
    await expect
      .poll(() => layout(page, 'S2'))
      .toEqual(['c0 a1 c1 ga0* ga1* c2', 'e0 e1']);
    // Still peeking: the detail is on screen.
    await expect(page.locator('[data-drag-row-id="d1"]')).toBeVisible();
  });
});
