// KAN-350 on the real artifact: a saved tab, group or window dragged out of
// the session on screen and into another saved session -- a MOVE, saved to
// saved, that never touches Chrome.
//
// What jsdom could not show, and so what this file is for: real geometry
// (the pane's box, the hand-off where the pointer reaches the session list
// (KAN-352), the list's rows and its auto-scroll), real timing (the 0.6s
// dwell, the frame the KAN-157 scroll comes back on, the frame KAN-155
// follows the dropped row on), and real paint (the target's outline and dwell
// sweep against the row's actual fill, the card over the list, the toast at a
// 20px root).
//
// Driven as the popup (790x550) and as the tab view, side by side and folded
// with a peek. Every move is read back from localStorage, where the app keeps
// it. The New window target's height, the lit target's slot, what shows where
// a carried window will land, and the target appearing in the source are
// Justine's picks V1-V4 (all A), pinned in "the target visuals" below.
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
import { holdSweepAt } from './fixtures/dwell';
import {
  boxOf,
  groupHandle,
  pickUp,
  stored,
  tabHandle,
  windowHandle,
  type Point,
} from './fixtures/sessionDrag';
import type {
  TabMasterContainer,
  tabContainerData,
} from '../src/redux/slices/tabContainerDataStateSlice';
import {
  BB_PINK_THEME,
  BLUE_THEME,
  DARKENHEIMER_THEME,
  LIGHT_THEME,
  WARM_LIGHT_THEME,
} from '../src/hooks/useThemeColors';
import { SPRING_OPEN_MS } from '../src/components/common/springOpen';

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

// The session list's scrolling box.
const listBox = (page: Page): Promise<PaneBox> =>
  page.evaluate(() => {
    let el = document.querySelector('[data-pane="sessions"] [data-drag-row-id]')
      ?.parentElement;
    while (el && !['auto', 'scroll'].includes(getComputedStyle(el).overflowY))
      el = el.parentElement;
    if (!el) throw new Error('no session list');
    const b = el.getBoundingClientRect();
    return {
      left: b.left,
      right: b.right,
      top: b.top,
      bottom: b.bottom,
      scrollTop: el.scrollTop,
    };
  });

const setListScroll = (page: Page, top: number) =>
  page.evaluate((top) => {
    let el = document.querySelector('[data-pane="sessions"] [data-drag-row-id]')
      ?.parentElement;
    while (el && !['auto', 'scroll'].includes(getComputedStyle(el).overflowY))
      el = el.parentElement;
    if (!el) throw new Error('no session list');
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

// Records, from now on, whether a carry's card or its phantom was ever drawn
// -- even for one frame -- so a test can say neither ever was.
//
// The phantom read here is a carried tab's or group's, resting in the list's
// New window block (`[data-new-window-target] [data-carry-phantom]`), which
// only a carry draws: the toolbar row's target (KAN-361) is shown for every
// ordinary tab drag, so it is no sign of a carry.
async function watchForCarry(page: Page): Promise<void> {
  await page.evaluate(() => {
    // Each flag is written once: the observer hears attribute writes, its
    // own included, so a rewrite would call it again forever.
    const flag = () => {
      const b = document.body.dataset;
      if (b.sawCard !== '1' && document.querySelector('[data-carry-card]'))
        b.sawCard = '1';
      if (
        b.sawPhantom !== '1' &&
        document.querySelector('[data-new-window-target] [data-carry-phantom]')
      )
        b.sawPhantom = '1';
    };
    document.body.dataset.sawCard = '0';
    document.body.dataset.sawPhantom = '0';
    new MutationObserver(flag).observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
    });
    flag();
  });
}
// What the card says is carried: a group's card has its colour dot.
const currentCarriedKind = (page: Page) =>
  page.evaluate(() => {
    const card = document.querySelector('[data-carry-card]');
    if (card === null) return null;
    return card.querySelector('[data-carry-card-dot]') !== null
      ? 'group'
      : 'other';
  });

const sawCarry = (page: Page) =>
  page.evaluate(() => ({
    card: document.body.dataset.sawCard,
    phantom: document.body.dataset.sawPhantom,
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
//
// A tab's or group's phantom rests in the list's trailing block, after the
// last window (KAN-361/366), so in a session longer than the pane it is
// below the fold. For one, the pane is scrolled to its end first, as the
// wheel would -- the layer drives the carry until the adoption, so nothing
// is measured yet. A no-op for a pane with nothing to scroll; for one that
// scrolls, the end is where the bottom edge's auto-scroll has nothing left
// to do.
async function adoptPhantom(page: Page, phantomId: string): Promise<void> {
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
async function aimAt(page: Page, rowId: string, frac: number): Promise<void> {
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

// Until every row the preview moved has arrived: two frames for the move
// to render and its transitions to start, then each running transition's
// own end, until none is left. The state a measurement waits for, not a
// guess at how long it takes.
async function settled(page: Page): Promise<void> {
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
    // A new window is unnamed, as a captured one is (KAN-394 L4).
    expect(sessionOf(await stored(page), 'S2').windows[0]?.title).toBe('');
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

// The target is the session header's (KAN-361 N1 B): shown for the carry,
// in the opened session and in the source, and let go on, a new first window.
test.describe('the New window target (S3 A, Q2 A)', () => {
  test('in the opened session it is there for a tab, and a drop on it makes a new first window', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId);
    const aim = await headerAim(page);
    const at = await pickUp(page, tabHandle(page, 'a1'));
    await carryOutLeft(page, at);
    await springOpen(page, 'S2');
    await expect(headerTarget(page)).toBeVisible();
    await adoptPhantom(page, 'carried:a1');
    await ontoHeaderTarget(page, aim);
    await expect(headerTarget(page)).toHaveAttribute('data-landing', '');
    await page.mouse.up();

    await expect
      .poll(() => layout(page, 'S2'))
      .toEqual(['a1', D1_START, 'e0 e1']);
    expect(await windowIdsOf(page, 'S2')).toEqual(['new', 'd1', 'd2']);
    expect(await toasts(page)).toEqual([]);
    // The carry over, the target is no longer shown.
    await expect(headerTarget(page)).toBeHidden();
  });

  test('a group dropped on it makes a new first window holding the group', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId);
    const aim = await headerAim(page);
    const at = await pickUp(page, groupHandle(page, 'alpha'));
    await carryOutLeft(page, at);
    await springOpen(page, 'S2');
    await adoptPhantom(page, 'group:carried:alpha');
    await ontoHeaderTarget(page, aim);
    await expect(headerTarget(page)).toHaveAttribute('data-landing', '');
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
    const aim = await headerAim(page);
    const at = await pickUp(page, tabHandle(page, 'a1'));
    await carryOutLeft(page, at);
    // Shown in the source while carried (Q2 A), and the tab gone from w1.
    await expect(headerTarget(page)).toBeVisible();
    await expect(tabHandle(page, 'a1')).toHaveCount(0);
    await adoptPhantom(page, 'carried:a1');
    await ontoHeaderTarget(page, aim);
    await expect(headerTarget(page)).toHaveAttribute('data-landing', '');
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
    // PREMISE: the toolbar row is drawn, and its controls are what show.
    await expect(
      page.getByRole('button', { name: 'Open session' })
    ).toBeVisible();
    await expect(headerTarget(page)).toBeAttached();
    await expect(headerTarget(page)).toBeHidden();
    // No row of a carry rests in a New window target: the window's phantom
    // is a window row of its own.
    await expect(
      page.locator('[data-new-window-target] [data-drag-row-id]')
    ).toHaveCount(0);
    await page.keyboard.press('Escape');
    await page.mouse.up();
  });
});

// KAN-406 (reverses KAN-350 Q5 A): a cancel shows the source again, at the
// scroll it had at pick-up, and moves nothing.
test.describe('a cancel returns to the source (KAN-406)', () => {
  test('Esc after a spring-open shows the source again, and moves nothing', async ({
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

    await expect.poll(() => selected(page)).toBe('S1');
    await expect(tabHandle(page, 'a1')).toBeVisible();
    expect(await layout(page, 'S1')).toEqual([W1_START, 'b0 b1']);
    expect(await layout(page, 'S2')).toEqual([D1_START, 'e0 e1']);
    expect(await toasts(page)).toEqual([]);
  });

  test('a release over nothing after a spring-open shows the source again, and moves nothing', async ({
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
    await expect.poll(() => selected(page)).toBe('S1');
    await expect(tabHandle(page, 'a1')).toBeVisible();
    expect(await layout(page, 'S1')).toEqual([W1_START, 'b0 b1']);
    expect(await layout(page, 'S2')).toEqual([D1_START, 'e0 e1']);
  });

  test('Esc on the drag the opened session adopted shows the source again', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId);
    const at = await pickUp(page, tabHandle(page, 'a1'));
    await carryOutLeft(page, at);
    await springOpen(page, 'S2');
    await adoptPhantom(page, 'carried:a1');
    await page.keyboard.press('Escape');
    await page.mouse.up();

    await expect(page.locator(CARD)).toHaveCount(0);
    await expect.poll(() => selected(page)).toBe('S1');
    expect(await layout(page, 'S1')).toEqual([W1_START, 'b0 b1']);
    expect(await layout(page, 'S2')).toEqual([D1_START, 'e0 e1']);
  });

  test('a long session: a tab carried out, a spring-open, then Esc: the source at the scroll it had', async ({
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
    // A tab in the middle of the pane, clear of both auto-scroll zones.
    const tabId = await page.evaluate(
      ({ top, bottom }) => {
        for (const r of document.querySelectorAll<HTMLElement>(
          '[data-pane="detail"] [data-drag-row-id^="x"]'
        )) {
          const b = r.getBoundingClientRect();
          if (
            r.dataset.dragRowId?.includes('-') &&
            b.top > top + 80 &&
            b.bottom < bottom - 80
          )
            return r.dataset.dragRowId;
        }
        return undefined;
      },
      { top: pane.top, bottom: pane.bottom }
    );
    if (tabId === undefined) throw new Error('no tab mid-pane');

    const at = await pickUp(page, tabHandle(page, tabId));
    await carryOutLeft(page, at);
    await springOpen(page, 'S2');
    // PREMISE: S2 is short, so the pane no longer holds the 300.
    expect((await detailPane(page)).scrollTop).toBe(0);
    await page.keyboard.press('Escape');
    await page.mouse.up();

    await expect.poll(() => selected(page)).toBe('S1');
    await expect.poll(async () => (await detailPane(page)).scrollTop).toBe(300);
    expect((await windowIdsOf(page, 'S1')).length).toBe(5);
  });

  test('a scrolled list, auto-scrolled under the carry, a spring-open, then Esc: the list at the scroll it had', async ({
    context,
    extensionId,
  }) => {
    const many = Array.from({ length: 30 }, (_, i) =>
      session(`L${i}`, `List ${i}`, [win(`lw${i}`, [tab(`l${i}`)])])
    );
    const page = await openPopup(context, extensionId, [S1(), ...many]);
    // Scrolled a little: S1's row partly above the fold.
    expect(await setListScroll(page, 40)).toBe(40);
    const at = await pickUp(page, tabHandle(page, 'a1'));
    await carryOutLeft(page, at);
    const list = await listBox(page);
    await page.mouse.move(list.left + 100, list.bottom - 10, { steps: 6 });
    await expect
      .poll(() => carryTargets(page), { timeout: 10000 })
      .toEqual(['L29']);
    // PREMISE: the carry scrolled the list, and opened the session there.
    expect((await listBox(page)).scrollTop).toBeGreaterThan(300);
    await expect.poll(() => selected(page), { timeout: 3000 }).toBe('L29');

    await page.keyboard.press('Escape');
    await page.mouse.up();

    await expect.poll(() => selected(page)).toBe('S1');
    await expect.poll(async () => (await listBox(page)).scrollTop).toBe(40);
    expect(await layout(page, 'S1')).toEqual([W1_START, 'b0 b1']);
    expect(await layout(page, 'L29')).toEqual(['l29']);
  });
});

test.describe('only the session list carries (hand-off, KAN-352)', () => {
  // PREMISE for every `sawCarry` negative below: a real carry is seen, its
  // card and its phantom both.
  test('CONTROL: a carry is seen by watchForCarry, its card and its phantom', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId);
    await watchForCarry(page);
    const at = await pickUp(page, tabHandle(page, 'a1'));
    await carryOutLeft(page, at);
    await expect
      .poll(() => sawCarry(page))
      .toEqual({ card: '1', phantom: '1' });
    await page.keyboard.press('Escape');
    await page.mouse.up();
  });

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
    // NEGATIVE, so a fixed wait: a hand-off draws the card on the render
    // after the move, and 200ms is many frames past that.
    await page.waitForTimeout(200);
    await expect(page.locator(CARD)).toHaveCount(0);
    await expect(tabHandle(page, 'a1')).toHaveAttribute('data-drag-held', '');

    await page.mouse.move(at.x, 1, { steps: 10 });
    // NEGATIVE, as above.
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
    // NEGATIVE, so a fixed wait: a hand-off here would have drawn the card,
    // and lifted a1, on the render after the move; 200ms is many frames on.
    await page.waitForTimeout(200);
    await expect(tabHandle(page, 'a1')).toHaveAttribute('data-drag-held', '');
    await page.mouse.up();

    await expect
      .poll(() => layout(page, 'S1'))
      .toEqual(['a0 a2 a1 al0* al1*', 'b0 b1']);
    expect(await sawCarry(page)).toEqual({ card: '0', phantom: '0' });
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
    // NEGATIVE, so a fixed wait: a hand-back here would have unheld the
    // phantom on the render after the move; 200ms is many frames on.
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
    // NEGATIVE, so a fixed wait: no carry may start here, and one would
    // have shown on the render after the move; 200ms is many frames on.
    await page.waitForTimeout(200);
    await expect(tabHandle(page, 'a1')).toHaveAttribute('data-drag-held', '');
    expect(await page.locator(CARD).count()).toBe(0);
    await page.mouse.up();

    await expect
      .poll(() => layout(page, 'S1'))
      .toEqual(['a0 a2 a1 al0* al1*', 'b0 b1']);
    expect(await sawCarry(page)).toEqual({ card: '0', phantom: '0' });
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
    // NEGATIVE, so a fixed wait: a stray click follows the release at once,
    // and the suppressor's own window is 400ms from it -- 300ms covers the
    // click without outliving what eats it.
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

    // NEGATIVE, so a fixed wait: no card, and no stray click, which would
    // follow the release at once.
    await page.waitForTimeout(300);
    expect(await sawCarry(page)).toEqual({ card: '0', phantom: '0' });
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
      // The PATH, not a settle: resting this long, well under the 600ms
      // dwell, is the quick pass being tested.
      await page.waitForTimeout(150);
    }
    // Off the list, over the header: no target, no timer left running.
    const sort = await boxOf(
      page.getByRole('button', { name: 'Sort sessions' })
    );
    await page.mouse.move(sort.x + sort.width / 2, sort.y + sort.height / 2, {
      steps: 4,
    });
    // NEGATIVE, so a fixed wait: past the 600ms dwell, nothing opened.
    await page.waitForTimeout(900);
    expect(await selected(page)).toBe('S1');
    await page.keyboard.press('Escape');
    await page.mouse.up();
    expect(await layout(page, 'S1')).toEqual([W1_START, 'b0 b1']);
  });

  test('the shown row: an outline but no sweep and no opening, and a drop there is a row drop with no Moved toast (Q3 A)', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId);
    const at = await pickUp(page, tabHandle(page, 'a1'));
    await carryOutLeft(page, at);
    await onto(page, 'S1');
    await expect(page.locator('[data-carry-dwell]')).toHaveCount(0);
    // NEGATIVE, so a fixed wait: past the 600ms dwell, nothing opened.
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
  // The outline as painted, against the row's painted fill (a sweep is held
  // at its end). CONTROL in each: the fill pixel is the hover colour the row
  // declares, so the decode is faithful before a ratio is built on it.
  for (const theme of THEMES) {
    test(`the target outline clears 3:1 against the row's fill (${theme})`, async ({
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
      await holdSweepAt(page, '[data-carry-dwell]', SPRING_OPEN_MS);
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
          // A dwelling row's fill is the sweep; a shown row's, the shadow.
          const fill = row.hasAttribute('data-carry-dwell')
            ? cs.backgroundImage
            : cs.boxShadow;
          return {
            outline: cs.outlineColor,
            outlineWidth: cs.outlineWidth,
            fillDeclared:
              /rgba?\([^)]*\)|#[0-9a-f]{3,8}/i.exec(fill)?.[0] ?? '',
            dwelling: row.hasAttribute('data-carry-dwell'),
            outlineAt: [b.left + b.width / 2, b.top + 1],
            fillAt: [b.left + b.width / 2, b.top + 5],
          };
        }, rowId);

      const m = await measure('S2');
      expect(m.dwelling).toBe(true);
      const [outlinePx, fillPx] = await pixelsAt(page, [
        [m.outlineAt[0], m.outlineAt[1]],
        [m.fillAt[0], m.fillAt[1]],
      ]);
      // CONTROLS: what is painted is what is declared.
      expect(fillPx).toBe(rgbToHex(m.fillDeclared));
      expect(outlinePx).toBe(rgbToHex(m.outline));
      expect(m.outlineWidth).toBe('2px');
      const outlineRatio = contrast(outlinePx, fillPx);

      // The selected row as the target: the hover fill, not the selection
      // fill (D2 A), and no sweep (it is the session on screen).
      await onto(page, 'S1');
      const s = await measure('S1');
      const [selOutlinePx, selFillPx] = await pixelsAt(page, [
        [s.outlineAt[0], s.outlineAt[1]],
        [s.fillAt[0], s.fillAt[1]],
      ]);
      expect(s.dwelling).toBe(false);
      // PREMISE: the selection fill is not the hover fill, so the next line
      // can tell them apart.
      expect(restingSelected).not.toBe(fillPx);
      expect(selFillPx).toBe(fillPx);
      const selectedRatio = contrast(selOutlinePx, selFillPx);
      console.log(
        `[${theme}] outline ${outlinePx} on ${fillPx}: ${outlineRatio.toFixed(
          2
        )}; selected ${selOutlinePx} on ${selFillPx}: ${selectedRatio.toFixed(
          2
        )}`
      );
      expect(outlineRatio).toBeGreaterThanOrEqual(3);
      expect(selectedRatio).toBeGreaterThanOrEqual(3);
      await page.keyboard.press('Escape');
      await page.mouse.up();
    });
  }

  test('the sweep runs exactly as long as the dwell', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId);
    const at = await pickUp(page, tabHandle(page, 'a1'));
    await carryOutLeft(page, at);
    await onto(page, 'S2');
    const duration = await page
      .locator('[data-carry-dwell]')
      .evaluate((el) =>
        el.getAnimations().map((a) => a.effect?.getTiming().duration)
      );
    expect(duration).toEqual([SPRING_OPEN_MS]);
    await page.keyboard.press('Escape');
    await page.mouse.up();
  });

  // CONTROL: the ground is the row's own pixel at rest, read before the carry.
  for (const theme of THEMES) {
    test(`the sweep fills from the left in step with the dwell, inside an outline that clears 3:1 on the ground (${theme})`, async ({
      context,
      extensionId,
    }) => {
      await seedSettings(context, { theme });
      const page = await openPopup(context, extensionId);
      const r = await boxOf(sessionRow(page, 'S2'));
      // The row's top strip: the card hangs over its lower half.
      const y = r.y + 6;
      const xAt = (f: number) => r.x + r.width * f;
      const [ground] = await pixelsAt(page, [[xAt(0.75), y]]);
      const at = await pickUp(page, tabHandle(page, 'a1'));
      await carryOutLeft(page, at);
      await onto(page, 'S2');
      // PREMISE: the probes are clear of the card and its shadow.
      expect((await boxOf(page.locator(CARD))).y - 8).toBeGreaterThan(y);

      const half = await holdSweepAt(
        page,
        '[data-carry-dwell]',
        SPRING_OPEN_MS / 2
      );
      const fillHex = rgbToHex(half.color);
      // PREMISE: the two can be told apart.
      expect(fillHex).not.toBe(ground);
      // One screenshot: the outline is read over the part not yet swept.
      const [left, right, outlinePx] = await pixelsAt(page, [
        [xAt(0.25), y],
        [xAt(0.75), y],
        [xAt(0.9), r.y + 1],
      ]);
      expect([left, right]).toEqual([fillHex, ground]);
      expect(
        (
          await holdSweepAt(
            page,
            '[data-carry-dwell]',
            (SPRING_OPEN_MS * 3) / 4
          )
        ).size
      ).toBe('75% 100%');
      // PREMISE: every read came before the spring-open.
      expect(await selected(page)).toBe('S1');
      console.log(
        `[${theme}] outline ${outlinePx} on ground ${ground}: ${contrast(
          outlinePx,
          ground
        ).toFixed(2)}`
      );
      expect(contrast(outlinePx, ground)).toBeGreaterThanOrEqual(3);
      await page.keyboard.press('Escape');
      await page.mouse.up();
    });
  }

  // KAN-382. CONTROL: S4, never the origin or the target, is ground all along.
  for (const theme of ['Light', 'Darkenheimer']) {
    test(`the origin row keeps a dashed outline after another session opens (${theme})`, async ({
      context,
      extensionId,
    }) => {
      await seedSettings(context, { theme });
      const page = await openPopup(context, extensionId);
      const at = await pickUp(page, tabHandle(page, 'a1'));
      await carryOutLeft(page, at);
      await springOpen(page, 'S3');
      // Off the rows, so no hover touches S1 or S4.
      await page.mouse.move(at.x - 40, (await boxOf(sessionRow(page, 'S3'))).y);
      const edge = async (id: string) => {
        const r = await boxOf(sessionRow(page, id));
        const xs = Array.from({ length: 60 }, (_, i) => r.x + 8 + i * 2);
        return pixelsAt(page, [
          ...xs.map((x): [number, number] => [x, r.y + 1]),
          [r.x + r.width / 2, r.y + 8],
        ]);
      };
      const s1 = await edge('S1');
      const s4 = await edge('S4');
      const ground = s1[s1.length - 1];
      // PREMISE: S1 is no longer shown, so its ground is S4's.
      expect(s4[s4.length - 1]).toBe(ground);
      expect(s4.slice(0, -1).every((px) => px === ground)).toBe(true);
      const dashes = s1.slice(0, -1).filter((px) => contrast(px, ground) >= 3);
      const gaps = s1.slice(0, -1).filter((px) => px === ground);
      console.log(
        `[${theme}] origin edge: ${dashes.length} dash px, ${gaps.length} gap px of 60`
      );
      expect(dashes.length).toBeGreaterThan(10);
      expect(gaps.length).toBeGreaterThan(10);
      await page.keyboard.press('Escape');
      await page.mouse.up();
    });
  }

  test('reduced motion: the row lights in full at once', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const r = await boxOf(sessionRow(page, 'S2'));
    const at = await pickUp(page, tabHandle(page, 'a1'));
    await carryOutLeft(page, at);
    await onto(page, 'S2');
    // The row's top strip, clear of the card.
    expect((await boxOf(page.locator(CARD))).y - 8).toBeGreaterThan(r.y + 6);
    const [right] = await pixelsAt(page, [[r.x + r.width * 0.97, r.y + 6]]);
    expect(right).toBe(LIGHT_THEME.HOVER_COLOR.toUpperCase());
    // PREMISE: read before the spring-open.
    expect(await selected(page)).toBe('S1');
    await page.keyboard.press('Escape');
    await page.mouse.up();
  });

  test('reduced motion: no sweep, and the session still opens after the wait', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const at = await pickUp(page, tabHandle(page, 'a1'));
    await carryOutLeft(page, at);
    await onto(page, 'S2');
    const started = Date.now();
    // Once, not retried: the spring-open clears it anyway (KAN-381).
    expect(await page.locator('[data-carry-dwell]').count()).toBe(0);
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

// Five windows of six tabs: taller than the popup's pane, so it scrolls.
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

  // The same for a GROUP: its tabs leave the source while carried, so a
  // session scrolled to show a long group's header mid-pane gets shorter
  // than its scroll, and the scroll clamps. A cancel puts it back.
  test('a long session: a group carried out of it and cancelled comes back to the scroll it had (KAN-157)', async ({
    context,
    extensionId,
  }) => {
    const big = Array.from({ length: 12 }, (_, i) => tab(`bg${i}`, 'big'));
    const longGroup = session('S1', 'Long group', [
      win(
        'gw0',
        Array.from({ length: 8 }, (_, i) => tab(`gl${i}`))
      ),
      win(
        'gw1',
        [tab('gy0'), tab('gy1'), ...big, tab('gy2')],
        [{ groupId: 'big', title: 'Big', color: 'red' }]
      ),
    ]);
    const page = await openPopup(context, extensionId, [longGroup, S2()], 'S1');
    const handle = groupHandle(page, 'big');
    // The group's header in the middle of the pane, clear of both auto-scroll
    // zones.
    const pane = await detailPane(page);
    const headerTop = (await boxOf(handle)).y;
    const scrollTo = Math.round(
      headerTop - pane.top + pane.scrollTop - (pane.bottom - pane.top) / 2
    );
    // PREMISE: the session scrolls that far.
    expect(scrollTo).toBeGreaterThan(50);
    expect(await setDetailScroll(page, scrollTo)).toBe(scrollTo);

    const at = await pickUp(page, handle);
    // PREMISE: folding the held group (KAN-160) clamped the scroll.
    expect((await detailPane(page)).scrollTop).toBeLessThan(scrollTo);
    await carryOutLeft(page, at);
    expect(await currentCarriedKind(page)).toBe('group');
    // PREMISE: carried, the scroll is still not the press's -- the group's
    // rows left the source, which got shorter than the press's scroll, so
    // the browser clamped it to the new end (measured: scrollTop 51 of a
    // 467px list in a 416px pane, pressed at 186). The New window target
    // moves nothing: it is in the header's toolbar row, and the carried
    // phantom rests in the trailing block after the last window. So the
    // scroll has to be put back, not merely left alone.
    expect((await detailPane(page)).scrollTop).not.toBe(scrollTo);
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await expect(page.locator(CARD)).toHaveCount(0);
    await expect
      .poll(async () => (await detailPane(page)).scrollTop)
      .toBe(scrollTo);
    // Nothing moved.
    expect(await layout(page, 'S1')).toEqual([
      'gl0 gl1 gl2 gl3 gl4 gl5 gl6 gl7',
      ['gy0 gy1', ...big.map((t) => `${t.tabId}*`), 'gy2'].join(' '),
    ]);
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

  // A row drop on the session on screen makes its new first window at the
  // TOP of the detail (Q3 A, no Moved toast). Carried out of the lower part
  // of a long session, the tab must not just vanish: the new window is
  // followed into view.
  test('a long session scrolled down: a tab let go on its own row is followed into view as its new first window', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(
      context,
      extensionId,
      [longSession('S1', 'Long', 'x'), S2()],
      'S1'
    );
    const pane = await detailPane(page);
    expect(await setDetailScroll(page, 400)).toBe(400);
    // A tab in the middle of the pane, clear of both auto-scroll zones.
    const tabId = await page.evaluate(
      ({ top, bottom }) => {
        for (const row of document.querySelectorAll<HTMLElement>(
          '[data-pane="detail"] [data-drag-row-id^="x"]'
        )) {
          const id = row.dataset.dragRowId ?? '';
          const b = row.getBoundingClientRect();
          if (id.includes('-') && b.top > top + 80 && b.bottom < bottom - 80)
            return id;
        }
        return undefined;
      },
      { top: pane.top, bottom: pane.bottom }
    );
    if (tabId === undefined) throw new Error('no tab mid-pane');
    const at = await pickUp(page, tabHandle(page, tabId));
    await carryOutLeft(page, at);
    await onto(page, 'S1');
    await page.mouse.up();

    await expect
      .poll(
        async () =>
          sessionOf(await stored(page), 'S1').windows[0]?.tabs.map(
            (t) => t.tabId
          )
      )
      .toEqual([tabId]);
    // No Moved toast (Q3 A): the drop has to be seen where it lands.
    expect(await toasts(page)).toEqual([]);
    const landed = sessionOf(await stored(page), 'S1').windows[0]?.windowId;
    const row = page.locator(`[data-drag-row-id="${landed}"]`);
    await expect
      .poll(async () => {
        const b = await boxOf(row);
        const p = await detailPane(page);
        return b.y >= p.top - 1 && b.y + b.height <= p.bottom + 1;
      })
      .toBe(true);
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

// ---- V1-V4 (Justine, 2026-09-30 evening: all A) -----------------------------

// A New window box's height inside its borders, and its look: the header's
// target (`first`) or the list's trailing block (`last`, KAN-361/366).
const newWindowBox = (page: Page, which: 'first' | 'last') =>
  page.evaluate((which) => {
    const el = document.querySelector<HTMLElement>(
      `[data-new-window-target="${which}"]`
    );
    if (el === null) return null;
    const style = getComputedStyle(el);
    const name = el.querySelector('[data-drop-label]');
    return {
      inner: el.clientHeight,
      fill: style.backgroundColor,
      border: style.borderTopStyle,
      borderColour: style.borderTopColor,
      borderWidth: parseFloat(style.borderTopWidth),
      named:
        name !== null &&
        name.checkVisibility({ checkVisibilityCSS: true, checkOpacity: true }),
      landing: el.hasAttribute('data-landing'),
      transition: style.transitionDuration,
      animations: el.getAnimations().length,
    };
  }, which);

const heightOf = async (loc: Locator) => (await boxOf(loc)).height;

test.describe('the target visuals (V1-V4)', () => {
  // V1 A. One row tall whatever is carried, before the pointer comes in and
  // after: a carried group's phantom is held folded to its header. The box
  // is the trailing block the phantom rests in (KAN-361/366); the header's
  // target is the toolbar row's height (its own describe).
  for (const kind of ['tab', 'group'] as const) {
    test(`V1: the trailing block is one tab row tall for a ${kind}, before and after entry`, async ({
      context,
      extensionId,
    }) => {
      const page = await openPopup(context, extensionId);
      const rowH = await heightOf(tabHandle(page, 'a0'));
      // PREMISE: a tab row is a row's height, not a zero box.
      expect(rowH).toBeGreaterThan(20);
      const handle =
        kind === 'tab' ? tabHandle(page, 'a1') : groupHandle(page, 'alpha');
      const at = await pickUp(page, handle);
      await carryOutLeft(page, at);

      // Over the list, carried: the phantom rests in the source (Q2 A).
      await expect(page.locator(CARD)).toHaveCount(1);
      const before = await newWindowBox(page, 'last');
      expect(before?.inner).toBe(rowH);

      await adoptPhantom(
        page,
        kind === 'tab' ? 'carried:a1' : 'group:carried:alpha'
      );
      const after = await newWindowBox(page, 'last');
      expect(after?.inner).toBe(rowH);
      await page.keyboard.press('Escape');
      await page.mouse.up();
    });
  }

  // V2 A, already built: the box lights up -- the hover fill and a solid
  // border -- and no landing slot is seen. The box a carry lights is the
  // header's (KAN-361 N1 B); the trailing block's look, blank and lit, is
  // read where it has its room (the Q4 test).
  test('V2: a landing in the target lights the box, with no dashed slot seen', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId);
    const aim = await headerAim(page);
    const at = await pickUp(page, tabHandle(page, 'a1'));
    await carryOutLeft(page, at);
    // CONTROL: unlit, it is dashed and unfilled.
    const unlit = await newWindowBox(page, 'first');
    expect(unlit?.border).toBe('dashed');
    expect(rgbToHex(unlit?.fill ?? '')).not.toBe(LIGHT_THEME.HOVER_COLOR);

    await adoptPhantom(page, 'carried:a1');
    await ontoHeaderTarget(page, aim);
    const lit = await newWindowBox(page, 'first');
    expect(lit?.landing).toBe(true);
    expect(rgbToHex(lit?.fill ?? '')).toBe(LIGHT_THEME.HOVER_COLOR);
    expect(lit?.border).toBe('solid');
    expect(lit?.named).toBe(true);
    // The drag is live, and no landing slot is drawn: the lit box is what
    // says where the row goes (a landing on the header names no slot).
    await expect(tabHandle(page, 'carried:a1')).toHaveAttribute(
      'data-drag-held',
      ''
    );
    await expect(page.locator('[data-drag-landing-slot]')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await page.mouse.up();
  });

  // V3 A. A carried window: a dashed slot at the top of the opened session
  // while the pointer is over the list, the landing slot's look, as tall as
  // the window row it stands for. On entry at the top, no window row moves.
  test('V3: a carried window shows a dashed slot at the top, and nothing moves on entry', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId);
    const at = await pickUp(page, windowHandle(page, 'w2'));
    await carryOutLeft(page, at);
    await springOpen(page, 'S2');
    const phantom = page.locator('[data-drag-row-id="carried:w2"]');
    await expect(phantom).toBeAttached();
    // PREMISE: the pointer is over the list, and the phantom is not held.
    expect(await carryTargets(page)).toEqual(['S2']);
    await expect(phantom).not.toHaveAttribute('data-drag-held', '');

    const slotNow = () =>
      page.evaluate(() => {
        const ph = document.querySelector('[data-drag-row-id="carried:w2"]');
        const shown = [
          ...(ph?.querySelectorAll<HTMLElement>(
            ':scope > [data-phantom-resting-slot], :scope > [data-drag-landing-slot]'
          ) ?? []),
        ].filter((el) =>
          el.checkVisibility({ checkVisibilityCSS: true, checkOpacity: true })
        );
        return shown.map((el) => {
          const r = el.getBoundingClientRect();
          const st = getComputedStyle(el);
          return {
            kind: el.hasAttribute('data-drag-landing-slot')
              ? 'landing'
              : 'resting',
            top: r.top,
            left: r.left,
            width: r.width,
            height: r.height,
            border: `${st.borderTopWidth} ${st.borderTopStyle}`,
            colour: st.borderTopColor,
            radius: st.borderTopLeftRadius,
            opacity: st.opacity,
          };
        });
      });
    const slotColour = await page.evaluate(() =>
      getComputedStyle(document.documentElement)
        .getPropertyValue('--drag-landing-slot')
        .trim()
        .toUpperCase()
    );
    const resting = await slotNow();
    expect(resting).toHaveLength(1);
    // Dashed; its width is checked against the landing slot's below (both
    // declare 1.5px, which Chrome draws at its device-pixel width).
    expect(resting[0]).toMatchObject({ kind: 'resting', opacity: '1' });
    expect(resting[0]?.border).toMatch(/ dashed$/);
    expect(rgbToHex(resting[0]?.colour ?? '')).toBe(slotColour);
    // At the top of the session, as tall as the window row it stands for.
    const own = await boxOf(phantom);
    expect(resting[0]?.top).toBeCloseTo(own.y, 0);
    expect(resting[0]?.height).toBeCloseTo(own.height, 0);
    expect(own.height).toBeCloseTo(await heightOf(windowHandle(page, 'd1')), 0);
    const pane = await detailPane(page);
    expect(own.y - pane.top).toBeLessThan(own.height);

    // In at the phantom's own height: straight across from the list.
    const rows = () =>
      page.evaluate(() =>
        ['d1', 'd2'].map((id) => {
          const r = document
            .querySelector(`[data-drag-row-id="${id}"]`)
            ?.getBoundingClientRect();
          return r === undefined ? null : Math.round(r.top * 10) / 10;
        })
      );
    const rowsBefore = await rows();
    const y = own.y + own.height / 2;
    const list = await boxOf(page.locator('[data-pane="sessions"]'));
    await page.mouse.move(list.x + list.width - 30, y, { steps: 3 });
    await page.mouse.move(pane.left + 60, y, { steps: 6 });
    await expect(phantom).toHaveAttribute('data-drag-held', '');
    // Whatever the entry moved has arrived: none of it is still easing.
    await settled(page);

    expect(await rows()).toEqual(rowsBefore);
    // The slot is where it was, the landing slot's now, as strong.
    const entered = await slotNow();
    expect(entered).toHaveLength(1);
    expect(entered[0]?.kind).toBe('landing');
    expect(entered[0]?.opacity).toBe('1');
    // The same look as the slot it took over from.
    expect(entered[0]?.border).toBe(resting[0]?.border);
    expect(entered[0]?.colour).toBe(resting[0]?.colour);
    // The same corners: one constant draws both (final review, finding 3).
    expect(entered[0]?.radius).toBe(resting[0]?.radius);
    expect(entered[0]?.top).toBeCloseTo(resting[0]?.top ?? NaN, 0);
    expect(entered[0]?.height).toBeCloseTo(resting[0]?.height ?? NaN, 0);
    await page.keyboard.press('Escape');
    await page.mouse.up();
  });

  // V4 A, already built: what a carry draws in the list appears at once --
  // no transition, no animation. S1 fits its pane, so a pick-up gives the
  // trailing block no room (Q4 is for a list that scrolls): it is a row tall
  // from the frame the carry starts, when the phantom comes to rest in it --
  // one step, no slide, never back.
  test('V4: the trailing block takes the phantom at once as the carry starts, with no slide', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId);
    // Every frame's height of the block, and whether a carry is on, from
    // before the pick-up.
    await page.evaluate(() => {
      const frames: [number, boolean][] = [];
      const tick = () => {
        const el = document.querySelector('[data-new-window-target="last"]');
        if (el !== null) {
          frames.push([
            el.getBoundingClientRect().height,
            document.querySelector('[data-carry-card]') !== null,
          ]);
          document.body.dataset.trailingFrames = JSON.stringify(frames);
        }
        if (document.body.dataset.trailingLog !== 'off')
          requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    await expect
      .poll(() =>
        page.evaluate(() => document.body.dataset.trailingFrames ?? '')
      )
      .not.toBe('');
    const at = await pickUp(page, tabHandle(page, 'a1'));
    await carryOutLeft(page, at);
    await settled(page);
    const raw = await page.evaluate(() => {
      document.body.dataset.trailingLog = 'off';
      return document.body.dataset.trailingFrames ?? '[]';
    });
    const parsed: unknown = JSON.parse(raw);
    if (!isHeightLog(parsed)) throw new Error(`not a height log: ${raw}`);
    const heights = parsed.map(([h]) => h);
    const room = heights[heights.length - 1] ?? 0;
    // PREMISE: sampled at rest, and through the hand-off.
    expect(heights[0]).toBe(0);
    expect(parsed.some(([, carried]) => carried)).toBe(true);
    expect(room).toBeGreaterThan(20);
    // Two heights only, and one step between them: never in between, and
    // never back.
    expect(new Set(heights)).toEqual(new Set([0, room]));
    const step = heights.indexOf(room);
    expect(heights.slice(step).every((h) => h === room)).toBe(true);
    // The step is the carry's: no room came at the pick-up.
    expect(parsed[step]?.[1]).toBe(true);
    const now = await newWindowBox(page, 'last');
    expect(now?.transition).toBe('0s');
    expect(now?.animations).toBe(0);
    await page.keyboard.press('Escape');
    await page.mouse.up();
  });
});

// A frame log of [height, carried] pairs.
const isHeightLog = (x: unknown): x is [number, boolean][] => {
  if (!Array.isArray(x)) return false;
  const items: readonly unknown[] = x;
  return items.every((f) => {
    if (!Array.isArray(f)) return false;
    const pair: readonly unknown[] = f;
    return (
      pair.length === 2 &&
      typeof pair[0] === 'number' &&
      typeof pair[1] === 'boolean'
    );
  });
};

// ---- the carried group's preview is the engine's (derive the box) ----------

// A carried group let go at an exact spot opens the gap the engine opens for
// ANY group dragged to that spot: the band's real footprint, its margin
// included, measured from the band as drawn (footprintOf). The New window
// target used to zero the band's margin to stay one row tall (V1 A), which
// opened a gap 2px short of every other group drag's.
//
// Measured locally, between the rows either side of the spot: first the
// engine's own drag of a same-size group there, on a page of its own, then
// the carried group, which must open the same gap, and land there.
test.describe('a carried group opens the gap any group drag opens', () => {
  // The distance from `above`'s bottom to `below`'s top, as drawn.
  const gapBetween = (page: Page, above: string, below: string) =>
    page.evaluate(
      ([a, b]) => {
        const box = (id: string) => {
          const el = document.querySelector(
            `[data-pane="detail"] [data-drag-row-id="${id}"]`
          );
          if (el === null) throw new Error(`no row ${id}`);
          return el.getBoundingClientRect();
        };
        return box(b).top - box(a).bottom;
      },
      [above, below]
    );

  // S2 with a second two-tab group, delta, after c2: the same size as the
  // carried alpha, for the engine's own drag to the same spot.
  const S2_TWO_BANDS = () =>
    session('S2', 'Target', [
      win(
        'd1',
        [
          tab('c0'),
          tab('c1'),
          tab('ga0', 'gamma'),
          tab('ga1', 'gamma'),
          tab('c2'),
          tab('de0', 'delta'),
          tab('de1', 'delta'),
        ],
        [
          { groupId: 'gamma', title: 'Gamma', color: 'green' },
          { groupId: 'delta', title: 'Delta', color: 'red' },
        ]
      ),
      win('d2', [tab('e0'), tab('e1')]),
    ]);
  const START = ['c0 c1 ga0* ga1* c2 de0* de1*', 'e0 e1'];

  const spots: [string, string, string, string[]][] = [
    [
      'beside a loose tab',
      'tab:c0',
      'tab:c1',
      ['c0 al0* al1* c1 ga0* ga1* c2 de0* de1*', 'e0 e1'],
    ],
    [
      'beside another band',
      'group:gamma',
      'tab:c2',
      ['c0 c1 ga0* ga1* al0* al1* c2 de0* de1*', 'e0 e1'],
    ],
  ];
  // In the tab view, side by side, where S2 fits its pane: the carried
  // group's phantom rests after S2's last window (KAN-361/366), and adopting
  // it there in the popup, whose pane scrolls for S2, left the spots in the
  // top auto-scroll band.
  for (const [name, above, below, want] of spots) {
    test(`${name}`, async ({ context, extensionId }) => {
      const sessions = () => [S1(), S2_TWO_BANDS(), S3()];
      // The engine's own group drag to the spot, then cancelled.
      const control = await openTabView(
        context,
        extensionId,
        false,
        sessions()
      );
      await sessionRow(control, 'S2').click();
      await expect(control.locator('[data-drag-row-id="d1"]')).toBeVisible();
      await pickUp(control, groupHandle(control, 'delta'));
      await aimAt(control, below, 0.25);
      await settled(control);
      const engine = await gapBetween(control, above, below);
      // PREMISE: a gap opened there at all.
      expect(engine).toBeGreaterThan(20);
      await control.keyboard.press('Escape');
      await control.mouse.up();
      expect(await layout(control, 'S2')).toEqual(START);
      await control.close();

      const page = await openTabView(context, extensionId, false, sessions());
      const at = await pickUp(page, groupHandle(page, 'alpha'));
      await carryOutLeft(page, at);
      await springOpen(page, 'S2');
      await adoptPhantom(page, 'group:carried:alpha');
      // PREMISE: the session fits its pane, so nothing scrolled.
      expect((await detailPane(page)).scrollTop).toBe(0);
      await aimAt(page, below, 0.25);
      await settled(page);
      expect(await gapBetween(page, above, below)).toBeCloseTo(engine, 0);
      await page.mouse.up();

      await expect.poll(() => layout(page, 'S2')).toEqual(want);
    });
  }
});

// ---- KAN-362 ------------------------------------------------------------------

// The landing slot is drawn inside the held row. An adopted carry's held row
// is the phantom in the trailing block, which takes no window's indent, so
// the slot is only as wide as a landing row because it takes the box of the
// row the item lands as (KAN-364), not the phantom's.
const box = (page: Page, selector: string) =>
  page.evaluate((selector) => {
    const el = document.querySelector(selector);
    if (el === null) return null;
    const b = el.getBoundingClientRect();
    return { left: b.left, right: b.right };
  }, selector);

// How far a measured slot edge may sit from the row it matches: two
// LayoutUnits (1/64px each, Chromium's layout precision). The slot's edge is
// the held row's box plus (landing box - held box), and the two boxes are
// read at the adoption, while the rows the carry let go of ease back under a
// transform -- whose subpixel offset Chromium snaps, by up to one LayoutUnit
// each (measured: a member at rest at 451.5 read 451.484375). Nothing is
// moving at an ordinary drag's activation, so there the error is 0.
const SLOT_EDGE_TOLERANCE = 2 / 64;

async function expectSlotAsWideAs(
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

const rowBox = async (page: Page, rowId: string) => {
  const b = await box(page, `[data-drag-row-id="${rowId}"]`);
  if (b === null) throw new Error(`no row ${rowId}`);
  return b;
};

test.describe('a carried tab or group lands in a slot as wide as the row it becomes (KAN-362)', () => {
  const kinds = [
    { kind: 'tab', rowId: 'a0', phantom: 'carried:a0', inS2: 'c1', aim: 'c1' },
    {
      kind: 'group',
      rowId: 'group:alpha',
      phantom: 'group:carried:alpha',
      inS2: 'group:gamma',
      // c2 at a quarter: just past gamma, so the landing is beside the band.
      aim: 'c2',
    },
  ] as const;

  for (const k of kinds) {
    test(`a ${k.kind} brought back into its own session: the slot is the row's own box`, async ({
      context,
      extensionId,
    }) => {
      const page = await openPopup(context, extensionId);
      // Read before the pick-up: the box the row has as an ordinary row.
      const own = await rowBox(page, k.rowId);
      const handle =
        k.kind === 'tab' ? tabHandle(page, 'a0') : groupHandle(page, 'alpha');
      const at = await pickUp(page, handle);
      await carryOutLeft(page, at);
      await adoptPhantom(page, k.phantom);
      await aimAt(page, 'a2', 0.5);
      await expectSlotAsWideAs(page, own);
      await page.keyboard.press('Escape');
      await page.mouse.up();
    });

    test(`a ${k.kind} carried into a spring-opened session: the slot is the box of a ${k.kind} there`, async ({
      context,
      extensionId,
    }) => {
      const page = await openPopup(context, extensionId);
      const handle =
        k.kind === 'tab' ? tabHandle(page, 'a0') : groupHandle(page, 'alpha');
      const at = await pickUp(page, handle);
      await carryOutLeft(page, at);
      await springOpen(page, 'S2');
      await adoptPhantom(page, k.phantom);
      await aimAt(page, k.aim, 0.25);
      await expectSlotAsWideAs(page, await rowBox(page, k.inS2));
      await page.keyboard.press('Escape');
      await page.mouse.up();
    });
  }

  test("a tab carried into the folded tab view's peek: the slot is a tab row's box", async ({
    context,
    extensionId,
  }) => {
    const page = await openTabView(context, extensionId, true);
    const at = await pickUp(page, tabHandle(page, 'a0'));
    await carryOutLeft(page, at);
    await springOpen(page, 'S2');
    await expect(page.locator('[data-drag-row-id="d1"]')).toBeVisible();
    await adoptPhantom(page, 'carried:a0');
    await aimAt(page, 'c1', 0.25);
    await expectSlotAsWideAs(page, await rowBox(page, 'c1'));
    await page.keyboard.press('Escape');
    await page.mouse.up();
  });

  // A Retina screen, where a half pixel is a whole device pixel.
  test.describe('at DPR 2', () => {
    test.use({ deviceScaleFactor: 2 });
    test("a tab brought back, the slot is the row's own box", async ({
      context,
      extensionId,
    }) => {
      const page = await openPopup(context, extensionId);
      // PREMISE: the scale reached the page.
      expect(await page.evaluate(() => devicePixelRatio)).toBe(2);
      const own = await rowBox(page, 'a0');
      const at = await pickUp(page, tabHandle(page, 'a0'));
      await carryOutLeft(page, at);
      await adoptPhantom(page, 'carried:a0');
      await aimAt(page, 'a2', 0.5);
      await expectSlotAsWideAs(page, own);
      await page.keyboard.press('Escape');
      await page.mouse.up();
    });
  });

  // Chrome's "Large" font size sets a 20px root: the rows are rem, the
  // indent and the border px.
  test("at a 20px root: a tab brought back, the slot is the row's own box", async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId);
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '20px';
    });
    expect(
      await page.evaluate(
        () => getComputedStyle(document.documentElement).fontSize
      )
    ).toBe('20px');
    await settled(page);
    const own = await rowBox(page, 'a0');
    const at = await pickUp(page, tabHandle(page, 'a0'));
    await carryOutLeft(page, at);
    await adoptPhantom(page, 'carried:a0');
    await aimAt(page, 'a2', 0.5);
    await expectSlotAsWideAs(page, own);
    await page.keyboard.press('Escape');
    await page.mouse.up();
  });
});

// ---- KAN-363 ------------------------------------------------------------------

// The rows under the pointer that PAINT their hover fill: a `:hover` element
// inside a row that is not the held one, whose background is the theme's
// hover colour. Compared with the colour itself, not "any background": a band
// lit as a drop target is another colour, and meant. Also any group's action
// strip revealed (KAN-100).
const paintedHover = (page: Page, hoverHex: string) =>
  page.evaluate((hoverHex) => {
    const probe = document.createElement('div');
    probe.style.backgroundColor = hoverHex;
    document.body.append(probe);
    const want = getComputedStyle(probe).backgroundColor;
    probe.remove();
    const filled = [...document.querySelectorAll<HTMLElement>(':hover')]
      .filter((e) => e.closest('[data-drag-held]') === null)
      .filter((e) => getComputedStyle(e).backgroundColor === want)
      .map(
        (e) =>
          e.closest<HTMLElement>('[data-drag-row-id]')?.dataset.dragRowId ?? ''
      )
      .filter((id) => id !== '');
    const revealed = [
      ...document.querySelectorAll<HTMLElement>('.group-actions'),
    ]
      .filter(
        (e) =>
          getComputedStyle(e).opacity === '1' &&
          [...e.children].some((c) => getComputedStyle(c).opacity === '1')
      )
      .map(
        (e) =>
          `reveal:${
            e.closest<HTMLElement>('[data-drag-row-id]')?.dataset.dragRowId ??
            '?'
          }`
      );
    return [...filled, ...revealed];
  }, hoverHex);

// The row a click at the point would reach, unless it is the held one.
const rowHitAt = (page: Page, x: number, y: number) =>
  page.evaluate(
    ([x, y]) =>
      document
        .elementFromPoint(x, y)
        ?.closest<HTMLElement>('[data-drag-row-id]:not([data-drag-held])')
        ?.dataset.dragRowId ?? null,
    [x, y] as const
  );

// Steps the pointer down the detail pane, then says what it met: at every
// step no row paints its hover fill (asserted first: that is the bug), and
// no row is what the pointer would hit. Returns how many steps had a non-held
// row's box under the pointer -- a sweep that missed every row could pass for
// nothing.
async function sweepRows(page: Page, x: number): Promise<number> {
  const pane = await detailPane(page);
  let overRows = 0;
  const filled: string[] = [];
  const hit: string[] = [];
  for (let y = pane.top + 8; y < pane.bottom - 8; y += 16) {
    await page.mouse.move(x, y, { steps: 2 });
    await settled(page);
    for (const row of await paintedHover(page, LIGHT_THEME.HOVER_COLOR))
      filled.push(`${Math.round(y)}:${row}`);
    const rowHit = await rowHitAt(page, x, y);
    if (rowHit !== null) hit.push(`${Math.round(y)}:${rowHit}`);
    // Real rows only: not the held phantom, not the wrapper around it, and
    // nothing inside the trailing block it rests in.
    const under = await page.evaluate(
      ([x, y]) =>
        [
          ...document.querySelectorAll(
            '[data-drag-row-id]:not([data-drag-held])'
          ),
        ]
          .filter(
            (r) =>
              r.querySelector('[data-drag-held]') === null &&
              r.closest('[data-new-window-target]') === null
          )
          .some((r) => {
            const b = r.getBoundingClientRect();
            return x >= b.left && x <= b.right && y >= b.top && y <= b.bottom;
          }),
      [x, y] as const
    );
    if (under) overRows++;
  }
  expect(filled, 'rows painting their hover fill').toEqual([]);
  expect(hit, 'rows the pointer would hit').toEqual([]);
  return overRows;
}

interface HoverFrame {
  held: boolean;
  filled: string[];
}
// Narrowed through `readonly unknown[]` at once, so nothing reads Array.isArray's
// `any[]`.
const isStringList = (x: unknown): x is string[] => {
  if (!Array.isArray(x)) return false;
  const items: readonly unknown[] = x;
  return items.every((s) => typeof s === 'string');
};
const isHoverFrame = (f: unknown): f is HoverFrame =>
  typeof f === 'object' &&
  f !== null &&
  'held' in f &&
  typeof f.held === 'boolean' &&
  'filled' in f &&
  isStringList(f.filled);
const isFrameLog = (x: unknown): x is HoverFrame[] => {
  if (!Array.isArray(x)) return false;
  const items: readonly unknown[] = x;
  return items.every(isHoverFrame);
};

test.describe('no row under a held carry shows its hover (KAN-363)', () => {
  // PREMISE for every negative below: with nothing dragged, the pointer on a
  // window's header paints the colour they look for, at that header.
  test('CONTROL: with no drag, a window header under the pointer paints its hover fill', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId);
    const w2 = await boxOf(windowHandle(page, 'w2'));
    await page.mouse.move(w2.x + 200, w2.y + w2.height / 2, { steps: 3 });
    await expect
      .poll(() => paintedHover(page, LIGHT_THEME.HOVER_COLOR))
      .toEqual(['w2']);
  });

  const kinds = [
    // How many sweep steps must cross a row: a window carry folds every
    // window to its header (KAN-153), so Source then holds w1's header
    // alone, and the preview moves it aside as the pointer passes -- one
    // step. (Main painted it at two: :hover is worked out at the mouse
    // event, before the preview moves the row.)
    { kind: 'tab', phantom: 'carried:a0', overRows: 5 },
    { kind: 'group', phantom: 'group:carried:alpha', overRows: 5 },
    { kind: 'window', phantom: 'carried:w2', overRows: 1 },
  ] as const;

  for (const k of kinds) {
    test(`a ${k.kind} carried out and back: no row under the pointer paints hover, and none takes the hit`, async ({
      context,
      extensionId,
    }) => {
      const page = await openPopup(context, extensionId);
      const handle =
        k.kind === 'tab'
          ? tabHandle(page, 'a0')
          : k.kind === 'group'
            ? groupHandle(page, 'alpha')
            : windowHandle(page, 'w2');
      const at = await pickUp(page, handle);
      await carryOutLeft(page, at);
      await adoptPhantom(page, k.phantom);
      expect(await sweepRows(page, at.x)).toBeGreaterThanOrEqual(k.overRows);
      await page.keyboard.press('Escape');
      await page.mouse.up();
    });
  }

  test('a tab carried into a spring-opened session: no row there paints hover', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId);
    const at = await pickUp(page, tabHandle(page, 'a0'));
    await carryOutLeft(page, at);
    await springOpen(page, 'S2');
    await adoptPhantom(page, 'carried:a0');
    expect(await sweepRows(page, at.x)).toBeGreaterThan(4);
    await page.keyboard.press('Escape');
    await page.mouse.up();
  });

  test("a tab carried into the folded tab view's peek: no row there paints hover", async ({
    context,
    extensionId,
  }) => {
    const page = await openTabView(context, extensionId, true);
    const at = await pickUp(page, tabHandle(page, 'a0'));
    await carryOutLeft(page, at);
    await springOpen(page, 'S2');
    await expect(page.locator('[data-drag-row-id="d1"]')).toBeVisible();
    await adoptPhantom(page, 'carried:a0');
    expect(await sweepRows(page, at.x)).toBeGreaterThan(4);
    await page.keyboard.press('Escape');
    await page.mouse.up();
  });

  // Frame by frame, from the list into the pane and over the rows main lit
  // up (w1's header, a1, a2, the group's header, w2's header): not one frame
  // paints a fill, the frame of the adoption included.
  test('frame by frame, from outside the pane through the adoption and over the rows: no frame paints a fill', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId);
    const at = await pickUp(page, tabHandle(page, 'a0'));
    await carryOutLeft(page, at);
    await page.evaluate((hoverHex) => {
      const probe = document.createElement('div');
      probe.style.backgroundColor = hoverHex;
      document.body.append(probe);
      const want = getComputedStyle(probe).backgroundColor;
      probe.remove();
      // The log and its off switch live on the body as text, so the test reads
      // a string back, not an untyped window property.
      const log: { held: boolean; filled: string[] }[] = [];
      document.body.dataset.hoverLog = 'on';
      const frame = () => {
        log.push({
          held:
            document.querySelector('[data-carry-phantom][data-drag-held]') !==
            null,
          filled: [...document.querySelectorAll<HTMLElement>(':hover')]
            .filter((e) => e.closest('[data-drag-held]') === null)
            .filter((e) => getComputedStyle(e).backgroundColor === want)
            .map(
              (e) =>
                e.closest<HTMLElement>('[data-drag-row-id]')?.dataset
                  .dragRowId ?? ''
            )
            .filter((id) => id !== ''),
        });
        document.body.dataset.hoverFrames = JSON.stringify(log);
        if (document.body.dataset.hoverLog === 'on')
          requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    }, LIGHT_THEME.HOVER_COLOR);
    // Straight in at w1's header height, then down over the rows.
    const w1 = await boxOf(windowHandle(page, 'w1'));
    await page.mouse.move(at.x, w1.y + w1.height / 2, { steps: 10 });
    for (const rowId of ['tab:a1', 'tab:a2', 'group:alpha', 'w2']) {
      const b = await boxOf(page.locator(`[data-drag-row-id="${rowId}"]`));
      await page.mouse.move(at.x, b.y + Math.min(12, b.height / 2), {
        steps: 6,
      });
    }
    await settled(page);
    const raw = await page.evaluate(() => {
      document.body.dataset.hoverLog = 'off';
      return document.body.dataset.hoverFrames ?? '[]';
    });
    const frames: unknown = JSON.parse(raw);
    if (!isFrameLog(frames)) throw new Error(`not a frame log: ${raw}`);
    // PREMISE: the log saw the pointer outside the pane AND the adoption.
    expect(frames.filter((f) => !f.held).length).toBeGreaterThan(0);
    expect(frames.filter((f) => f.held).length).toBeGreaterThan(10);
    expect(frames.filter((f) => f.filled.length > 0)).toEqual([]);
    await page.keyboard.press('Escape');
    await page.mouse.up();
  });

  // The rule is on the rows, not the pane: the wheel still scrolls it.
  test('the wheel over the rows scrolls the pane while a carry is held there', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(
      context,
      extensionId,
      [longSession('S1', 'Long', 'x'), S2()],
      'S1'
    );
    const at = await pickUp(page, tabHandle(page, 'x0-1'));
    await carryOutLeft(page, at);
    await adoptPhantom(page, 'carried:x0-1');
    // Mid-pane, clear of both auto-scroll zones.
    const pane = await detailPane(page);
    await page.mouse.move(at.x, (pane.top + pane.bottom) / 2, { steps: 4 });
    await settled(page);
    const before = (await detailPane(page)).scrollTop;
    // PREMISE: scrolled down to where the phantom rests, at the session's
    // end (KAN-361/366), with room to scroll back up.
    expect(before).toBeGreaterThan(200);
    await page.mouse.wheel(0, -200);
    await expect
      .poll(async () => (await detailPane(page)).scrollTop)
      .toBeLessThan(before);
    await page.keyboard.press('Escape');
    await page.mouse.up();
  });

  // The rule must not outlive the carry: however it ends, the rows hover
  // again at once.
  const endings = [
    'a drop',
    'Esc, then the release',
    'a release over the header',
  ] as const;
  for (const ending of endings) {
    test(`after ${ending}, a row under the pointer hovers again`, async ({
      context,
      extensionId,
    }) => {
      const page = await openPopup(context, extensionId);
      const at = await pickUp(page, tabHandle(page, 'a0'));
      await carryOutLeft(page, at);
      await adoptPhantom(page, 'carried:a0');
      if (ending === 'a drop') {
        await aimAt(page, 'a2', 0.5);
      } else if (ending === 'Esc, then the release') {
        await page.keyboard.press('Escape');
      } else {
        const header = await boxOf(page.locator('[data-pane="detail"]'));
        await page.mouse.move(at.x, header.y + 12, { steps: 6 });
      }
      await page.mouse.up();
      await expect(page.locator(CARD)).toHaveCount(0);
      await expect(page.locator('[data-carry-phantom]')).toHaveCount(0);
      const w2 = await boxOf(windowHandle(page, 'w2'));
      await page.mouse.move(w2.x + 200, w2.y + w2.height / 2, { steps: 3 });
      await expect
        .poll(() => paintedHover(page, LIGHT_THEME.HOVER_COLOR))
        .toEqual(['w2']);
    });
  }
});

// ---- KAN-364 ------------------------------------------------------------------

// A tab that lands inside a group's band becomes a member, whose row starts
// past the band's colour bar; one that lands outside every band is a loose
// row. The slot has the box of the row the tab becomes, whatever box the
// held row has: in an ordinary drag the held row is the tab's OLD row, and in
// a carry it is the phantom.
test.describe('the slot is the box of the row the tab becomes, across a band edge (KAN-364)', () => {
  const cases = [
    {
      name: 'a loose tab into a band, at its head',
      held: 'a0',
      carried: false,
      aim: 'al0',
      frac: 0.25,
      becomes: 'member',
    },
    {
      name: 'a loose tab into a band, between members',
      held: 'a0',
      carried: false,
      aim: 'al1',
      frac: 0.4,
      becomes: 'member',
    },
    {
      name: 'a member out of its band, to a loose spot',
      held: 'al0',
      carried: false,
      aim: 'a1',
      frac: 0.4,
      becomes: 'loose',
    },
    {
      name: 'CONTROL: a member within its band',
      held: 'al0',
      carried: false,
      aim: 'al1',
      frac: 0.6,
      becomes: 'member',
    },
    {
      name: 'a carried member back into its band',
      held: 'al0',
      carried: true,
      aim: 'al1',
      frac: 0.4,
      becomes: 'member',
    },
    {
      name: 'a carried loose tab into a band',
      held: 'a0',
      carried: true,
      aim: 'al1',
      frac: 0.4,
      becomes: 'member',
    },
  ] as const;
  for (const c of cases) {
    test(c.name, async ({ context, extensionId }) => {
      const page = await openPopup(context, extensionId);
      // Read at rest: a member's box and a loose row's.
      const member = await rowBox(page, 'al1');
      const loose = await rowBox(page, 'a2');
      // PREMISE: the two boxes differ, so the slot can only match one.
      expect(member.left - loose.left).toBeGreaterThan(8);
      const at = await pickUp(page, tabHandle(page, c.held));
      if (c.carried) {
        await carryOutLeft(page, at);
        await adoptPhantom(page, `carried:${c.held}`);
      }
      await aimAt(page, c.aim, c.frac);
      await expectSlotAsWideAs(page, c.becomes === 'member' ? member : loose);
      await page.keyboard.press('Escape');
      await page.mouse.up();
    });
  }

  // A refused release goes back where it came from: the slot is drawn at the
  // held row's own place, with its own box. For a member that is a member's
  // box, not the loose one a refused pointer, over no band, would pick.
  //
  // Refused beside the pane, below the list: below the last window inside
  // the pane makes a new last window (KAN-366 B).
  test('a member refused beside the pane keeps its own box, at its own place', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId);
    const own = await rowBox(page, 'al0');
    const ownTop = (await boxOf(page.locator('[data-drag-row-id="al0"]'))).y;
    await pickUp(page, tabHandle(page, 'al0'));
    const pane = await detailPane(page);
    // PREMISE: beside the pane, still in the popup.
    expect(pane.right + 4).toBeLessThan(POPUP.width);
    await page.mouse.move(pane.right + 4, pane.bottom - 30, { steps: 8 });
    await settled(page);
    // PREMISE: refused -- the slot is back at the member's own place.
    const slotTop = (await boxOf(page.locator('[data-drag-landing-slot]'))).y;
    expect(Math.abs(slotTop - ownTop)).toBeLessThanOrEqual(1);
    await expectSlotAsWideAs(page, own);
    await page.keyboard.press('Escape');
    await page.mouse.up();
  });

  // A session whose only window holds nothing but a group draws no loose row
  // to measure. A loose landing there (at the window's head, before the band)
  // takes the band's own box, which sits where a loose row would.
  test("into a window that is all one group, a loose landing takes the band's box", async ({
    context,
    extensionId,
  }) => {
    const grouped = session('S5', 'Grouped', [
      win(
        'g1',
        [tab('gx0', 'gg'), tab('gx1', 'gg')],
        [{ groupId: 'gg', title: 'GG', color: 'red' }]
      ),
    ]);
    const page = await openPopup(context, extensionId, [S1(), grouped]);
    const at = await pickUp(page, tabHandle(page, 'a0'));
    await carryOutLeft(page, at);
    await springOpen(page, 'S5');
    await adoptPhantom(page, 'carried:a0');
    // PREMISE: no loose row is drawn besides the carried phantom.
    expect(
      await page.evaluate(
        () =>
          [
            ...document.querySelectorAll<HTMLElement>(
              '[data-pane="detail"] [data-drag-row-id]'
            ),
          ].filter(
            (r) =>
              r.querySelector('[data-drag-row-id]') === null &&
              r.closest('[data-band-id]') === null &&
              r.closest('[data-new-window-target]') === null &&
              !(r.dataset.dragRowId ?? '').startsWith('g1')
          ).length
      )
    ).toBe(0);
    await aimAt(page, 'g1', 0.1);
    // PREMISE: the band is not the landing's group (no band is lit).
    expect(
      await page.locator('[data-band-id="gg"][data-drop-target]').count()
    ).toBe(0);
    const band = await box(page, '[data-band-id="gg"]');
    if (band === null) throw new Error('the band is not drawn');
    await expectSlotAsWideAs(page, band);
    await page.keyboard.press('Escape');
    await page.mouse.up();
  });
});

// ---- KAN-365 ------------------------------------------------------------------

// Where an adopted carry's release is refused it moves nothing: the item
// goes back to its source, which is not a place in this list. So nothing is
// drawn as a landing -- on main the slot sat at the phantom's own place,
// inside the unlit New window target, 1px inside its border, and the
// target's indent on the KAN-362 branch made it show. Refused beside the
// pane: below the last window inside it is a new last window (KAN-366 B).
const slotsDrawn = (page: Page) =>
  page.evaluate(
    () =>
      [...document.querySelectorAll('[data-drag-landing-slot]')].filter(
        (s) =>
          getComputedStyle(s).visibility !== 'hidden' &&
          s.getBoundingClientRect().width > 0
      ).length
  );

interface SlotFrame {
  slot: boolean;
  inTarget: boolean;
  homeFound: boolean;
}
const isSlotLog = (x: unknown): x is SlotFrame[] => {
  if (!Array.isArray(x)) return false;
  const items: readonly unknown[] = x;
  return items.every(
    (f) =>
      typeof f === 'object' &&
      f !== null &&
      'slot' in f &&
      typeof f.slot === 'boolean' &&
      'inTarget' in f &&
      typeof f.inTarget === 'boolean' &&
      'homeFound' in f &&
      typeof f.homeFound === 'boolean'
  );
};

test.describe('refused, or lit below the list, a carried item draws no slot (KAN-365)', () => {
  const kinds = [
    { kind: 'tab', handle: 'a0', phantom: 'carried:a0' },
    { kind: 'group', handle: 'alpha', phantom: 'group:carried:alpha' },
  ] as const;
  for (const k of kinds) {
    test(`a carried ${k.kind} refused beside the pane: no slot, the target unlit, and a release moves nothing`, async ({
      context,
      extensionId,
    }) => {
      const page = await openPopup(context, extensionId);
      const handle =
        k.kind === 'tab'
          ? tabHandle(page, k.handle)
          : groupHandle(page, k.handle);
      const at = await pickUp(page, handle);
      await carryOutLeft(page, at);
      await adoptPhantom(page, k.phantom);
      // PREMISE: held over a row, the slot is drawn.
      await aimAt(page, 'b0', 0.5);
      expect(await slotsDrawn(page)).toBe(1);
      const last = await boxOf(page.locator('[data-drag-row-id="w2"]'));
      const pane = await detailPane(page);
      // PREMISE: there is room below the last row inside the pane.
      expect(pane.bottom - (last.y + last.height)).toBeGreaterThan(60);
      // Beside the pane, below the list: refused. Below the last window
      // inside the pane is a new last window (KAN-366 B).
      expect(pane.right + 4).toBeLessThan(POPUP.width);
      await page.mouse.move(pane.right + 4, pane.bottom - 30, { steps: 8 });
      await settled(page);
      expect(await slotsDrawn(page)).toBe(0);
      await expect(
        page.locator('[data-new-window-target][data-landing]')
      ).toHaveCount(0);
      await page.mouse.up();
      await expect(page.locator(CARD)).toHaveCount(0);
      expect(await layout(page, 'S1')).toEqual([W1_START, 'b0 b1']);
      expect(await windowIdsOf(page, 'S1')).toEqual(['w1', 'w2']);
    });
  }

  // Frame by frame, from over the last window down past the list: no frame
  // draws a slot inside the block the phantom rests in -- the trailing block
  // (KAN-361/366), where main's in-list target was -- the frames it is the
  // landing in included, lit (KAN-366 B).
  test('frame by frame on the way down, no frame draws a slot inside the target', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId);
    const at = await pickUp(page, tabHandle(page, 'a0'));
    await carryOutLeft(page, at);
    await adoptPhantom(page, 'carried:a0');
    await aimAt(page, 'b0', 0.5);
    await page.evaluate(() => {
      const log: { slot: boolean; inTarget: boolean; homeFound: boolean }[] =
        [];
      document.body.dataset.slotLog = 'on';
      const frame = () => {
        const home = document.querySelector('[data-new-window-target="last"]');
        const target =
          home?.querySelector('[data-carry-phantom]') === null
            ? undefined
            : home?.getBoundingClientRect();
        const slots = [
          ...document.querySelectorAll('[data-drag-landing-slot]'),
        ].filter((el) => getComputedStyle(el).visibility !== 'hidden');
        log.push({
          slot: slots.length > 0,
          homeFound: target !== undefined,
          inTarget: slots.some((el) => {
            const b = el.getBoundingClientRect();
            return (
              target !== undefined &&
              b.top >= target.top - 1 &&
              b.bottom <= target.bottom + 1
            );
          }),
        });
        document.body.dataset.slotFrames = JSON.stringify(log);
        if (document.body.dataset.slotLog === 'on')
          requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });
    const pane = await detailPane(page);
    await page.mouse.move(at.x, pane.bottom - 30, { steps: 12 });
    await settled(page);
    const raw = await page.evaluate(() => {
      document.body.dataset.slotLog = 'off';
      return document.body.dataset.slotFrames ?? '[]';
    });
    const frames: unknown = JSON.parse(raw);
    if (!isSlotLog(frames)) throw new Error(`not a slot log: ${raw}`);
    // PREMISE: the log saw the slot drawn, over the rows, and the block the
    // phantom rests in, holding it, in every frame.
    expect(frames.some((f) => f.slot)).toBe(true);
    expect(frames.every((f) => f.homeFound)).toBe(true);
    expect(
      frames.filter((f) => f.inTarget).length,
      'frames with a slot inside the target'
    ).toBe(0);
    // And it ended with none at all.
    expect(frames[frames.length - 1]?.slot).toBe(false);
    await page.keyboard.press('Escape');
    await page.mouse.up();
  });

  test('CONTROL: an ordinary drag refused beside the pane keeps its slot at its own place', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId);
    const own = await boxOf(page.locator('[data-drag-row-id="a0"]'));
    await pickUp(page, tabHandle(page, 'a0'));
    const pane = await detailPane(page);
    expect(pane.right + 4).toBeLessThan(POPUP.width);
    await page.mouse.move(pane.right + 4, pane.bottom - 30, { steps: 8 });
    await settled(page);
    expect(await slotsDrawn(page)).toBe(1);
    const slot = await boxOf(page.locator('[data-drag-landing-slot]'));
    expect(Math.abs(slot.y - own.y)).toBeLessThanOrEqual(1);
    await page.keyboard.press('Escape');
    await page.mouse.up();
  });
});

// ---- the toolbar row's New window target (KAN-361 N1 B) --------------------

// The session header's toolbar row as drawn in one frame: whether its New
// window target is shown, whether its own controls are, and the boxes a swap
// must not move.
interface ToolbarFrame {
  // A drag is published on the document (data-dragging).
  dragging: boolean;
  // The document's New window marker (data-drag-new-window).
  marker: boolean;
  // The toolbar row's New window target computes `visibility: visible`.
  target: boolean;
  // Every one of the toolbar row's own controls: 'shown', 'hidden', or
  // 'mixed'.
  controls: string;
  // The header's box, the target's box, and every row's box in the detail
  // pane but the held row's (and what it holds), as text.
  header: string;
  targetBox: string;
  rows: string;
  // The target is lit (data-landing): a release would land in it.
  lit: boolean;
  // A row in the detail is held by the drag engine (data-drag-held): the
  // drag is the list's own, not handed to the carry.
  held: boolean;
  // The detail pane's scroll.
  scrollTop: number;
}
const isToolbarLog = (x: unknown): x is ToolbarFrame[] => {
  if (!Array.isArray(x)) return false;
  const items: readonly unknown[] = x;
  return items.every(
    (f) =>
      typeof f === 'object' &&
      f !== null &&
      'dragging' in f &&
      typeof f.dragging === 'boolean' &&
      'marker' in f &&
      typeof f.marker === 'boolean' &&
      'target' in f &&
      typeof f.target === 'boolean' &&
      'controls' in f &&
      typeof f.controls === 'string' &&
      'header' in f &&
      typeof f.header === 'string' &&
      'targetBox' in f &&
      typeof f.targetBox === 'string' &&
      'rows' in f &&
      typeof f.rows === 'string' &&
      'lit' in f &&
      typeof f.lit === 'boolean' &&
      'held' in f &&
      typeof f.held === 'boolean' &&
      'scrollTop' in f &&
      typeof f.scrollTop === 'number'
  );
};

// What one frame shows in the toolbar row: its controls at rest, the target
// swapped in for them, or a frame that shows both or neither.
const toolbarShows = (f: ToolbarFrame): string =>
  !f.target && f.controls === 'shown'
    ? 'controls'
    : f.target && f.controls === 'hidden'
      ? 'target'
      : `target ${f.target}, controls ${f.controls}`;

// Logs the toolbar row every frame from now until toolbarLog. `held` is the
// row a drag will hold, left out of the rows: it tracks the pointer.
//
// Each log is a numbered run, and a frame from any other run writes nothing
// and stops: a stopped log's last frame is still queued when the next log
// starts, and it must neither overwrite the new log nor run on beside it.
async function logToolbar(page: Page, held: string | null): Promise<void> {
  await page.evaluate((held) => {
    const run = String(Number(document.body.dataset.toolbarRun ?? '0') + 1);
    document.body.dataset.toolbarRun = run;
    document.body.dataset.toolbarFrames = '[]';
    const box = (el: Element | null | undefined) => {
      const b = el?.getBoundingClientRect();
      return b === undefined
        ? 'none'
        : `${b.top} ${b.bottom} ${b.left} ${b.right}`;
    };
    const log: unknown[] = [];
    const frame = () => {
      if (document.body.dataset.toolbarRun !== run) return;
      const toolbar = document.querySelector('[data-session-toolbar]');
      const target = document.querySelector('[data-new-window-target="first"]');
      // Its controls: an Icon draws a role="button" div, a Button a <button>.
      const controls = [
        ...(toolbar?.querySelectorAll('button, [role="button"]') ?? []),
      ].map((b) => getComputedStyle(b).visibility === 'visible');
      // The detail's scroller: the nearest overflow-auto box above its
      // first window, as detailPane finds it.
      let scroller = document.querySelector(
        '[data-pane="detail"] [data-drop-window-id]'
      )?.parentElement;
      while (
        scroller &&
        !['auto', 'scroll'].includes(getComputedStyle(scroller).overflowY)
      )
        scroller = scroller.parentElement;
      log.push({
        dragging: document.documentElement.hasAttribute('data-dragging'),
        marker: document.documentElement.hasAttribute('data-drag-new-window'),
        target:
          target !== null && getComputedStyle(target).visibility === 'visible',
        controls:
          controls.length > 0 && controls.every((c) => c)
            ? 'shown'
            : controls.length > 0 && controls.every((c) => !c)
              ? 'hidden'
              : 'mixed',
        header: box(toolbar?.parentElement),
        targetBox: box(target),
        rows: [
          ...document.querySelectorAll<HTMLElement>(
            '[data-pane="detail"] [data-drag-row-id]'
          ),
        ]
          .filter(
            (el) =>
              held === null ||
              el.closest(`[data-drag-row-id="${held}"]`) === null
          )
          .map((el) => `${el.dataset.dragRowId}: ${box(el)}`)
          .join(', '),
        lit: target?.hasAttribute('data-landing') ?? false,
        held:
          document.querySelector('[data-pane="detail"] [data-drag-held]') !==
          null,
        scrollTop: scroller?.scrollTop ?? -1,
      });
      document.body.dataset.toolbarFrames = JSON.stringify(log);
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }, held);
}

async function toolbarLog(page: Page): Promise<ToolbarFrame[]> {
  const raw = await page.evaluate(() => {
    // Stops the log: its run is no longer the current one.
    document.body.dataset.toolbarRun = String(
      Number(document.body.dataset.toolbarRun ?? '0') + 1
    );
    return document.body.dataset.toolbarFrames ?? '[]';
  });
  const frames: unknown = JSON.parse(raw);
  if (!isToolbarLog(frames)) throw new Error(`not a toolbar log: ${raw}`);
  return frames;
}

// Until the log holds `n` frames, or `n` frames of a published drag.
const loggedFrames = (page: Page, n: number, of = '"dragging":') =>
  expect
    .poll(() =>
      page.evaluate(
        (of) =>
          (document.body.dataset.toolbarFrames ?? '').split(of).length - 1,
        of
      )
    )
    .toBeGreaterThanOrEqual(n);
const loggedDragFrames = (page: Page, n: number) =>
  loggedFrames(page, n, '"dragging":true');

// The toolbar row as it is drawn now: one frame's log.
async function toolbarNow(page: Page): Promise<ToolbarFrame> {
  await logToolbar(page, null);
  await loggedFrames(page, 1);
  const frames = await toolbarLog(page);
  const last = frames[frames.length - 1];
  if (last === undefined) throw new Error('no frame logged');
  return last;
}

// At rest: the controls drawn, the target hidden, no marker.
const AT_REST = { marker: false, target: false, controls: 'shown' };
// Swapped: the target drawn in the controls' place.
const SWAPPED = { marker: true, target: true, controls: 'hidden' };

// The CONTROL every negative below runs first, on its own page: a saved tab
// drag there swaps the target in, so the reader can see it, and Esc puts the
// controls back.
async function tabDragShowsTarget(page: Page): Promise<void> {
  await pickUp(page, tabHandle(page, 'a1'));
  expect(await toolbarNow(page)).toMatchObject(SWAPPED);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  expect(await toolbarNow(page)).toMatchObject(AT_REST);
}

test.describe('the New window target is in the toolbar row from pick-up (KAN-361)', () => {
  const views = [
    {
      name: 'the popup',
      open: (context: BrowserContext, extensionId: string) =>
        openPopup(context, extensionId),
    },
    {
      name: 'the tab view',
      open: (context: BrowserContext, extensionId: string) =>
        openTabView(context, extensionId, false),
    },
  ];
  const kinds = [
    { kind: 'tab', held: 'a1', handle: tabHandle },
    { kind: 'group', held: 'group:alpha', handle: groupHandle },
  ] as const;
  for (const view of views) {
    for (const k of kinds) {
      test(`a ${k.kind} drag in ${view.name}: from the first frame, the target stands in the toolbar row's box and nothing moves`, async ({
        context,
        extensionId,
      }) => {
        const page = await view.open(context, extensionId);
        const rest = await toolbarNow(page);
        expect(rest).toMatchObject(AT_REST);

        // Where it stands: the controls' strip and the 2px of the row's
        // padding above it (34px tall, as the trailing box is, Justine's R5
        // pick 2026-10-01), inset 8px from the row's sides, and it takes no
        // pointer and no screen reader's notice.
        const target = page.locator('[data-new-window-target="first"]');
        await expect(target).toHaveAttribute('aria-hidden', 'true');
        expect(
          await target.evaluate((el) => getComputedStyle(el).pointerEvents)
        ).toBe('none');
        const strip = await boxOf(
          page.getByRole('button', { name: 'Open session' })
        );
        const row = await boxOf(page.locator('[data-session-toolbar]'));
        const box = await boxOf(target);
        expect(box.y).toBe(strip.y - 2);
        expect(box.y + box.height).toBe(strip.y + strip.height);
        expect(box.height).toBe(34);
        expect(box.x).toBe(row.x + 8);
        expect(box.x + box.width).toBe(row.x + row.width - 8);
        if (view.name === 'the popup') {
          // The controls' strip measured on main is 82-114; the target
          // reaches 2px above it.
          expect([box.y, box.y + box.height]).toEqual([80, 114]);
        }

        await logToolbar(page, k.held);
        await pickUp(page, k.handle(page, k.kind === 'tab' ? 'a1' : 'alpha'));
        await loggedDragFrames(page, 10);
        const frames = await toolbarLog(page);
        // PREMISE: the log spans the activation.
        const first = frames.findIndex((f) => f.dragging);
        expect(first).toBeGreaterThan(0);
        expect(frames.slice(first).every((f) => f.dragging)).toBe(true);

        // Every frame shows exactly one of the two: the controls until the
        // drag is published, the target from that very frame on.
        expect(frames.map(toolbarShows)).toEqual(
          frames.map((f) => (f.dragging ? 'target' : 'controls'))
        );
        // Same box: the header and the target never move, in any frame.
        expect(new Set(frames.map((f) => f.header)).size).toBe(1);
        expect(new Set(frames.map((f) => f.targetBox)).size).toBe(1);
        expect(frames[0]?.targetBox).toBe(
          `${box.y} ${box.y + box.height} ${box.x} ${box.x + box.width}`
        );
        // PREMISE: every frame recorded at least one row, so "no row moves"
        // below compares real boxes and not a log of empty strings.
        expect(frames.filter((f) => f.rows === '')).toEqual([]);
        // And no row moves. A held GROUP folds to its title row as it is
        // picked up (KAN-160), in the activation frame, on main as here: the
        // rows are compared from that frame on. A tab moves nothing at all.
        const rowsFrom = k.kind === 'tab' ? 0 : first;
        expect(new Set(frames.slice(rowsFrom).map((f) => f.rows)).size).toBe(1);
        await page.keyboard.press('Escape');
        await page.mouse.up();
      });
    }
  }

  // NEGATIVES, each aimed where the target would fire, after its CONTROL.

  test('a window drag never shows it', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId);
    await tabDragShowsTarget(page);

    await logToolbar(page, 'w1');
    await pickUp(page, windowHandle(page, 'w1'));
    await loggedDragFrames(page, 10);
    const frames = await toolbarLog(page);
    // PREMISE: the window drag was published, and logged.
    expect(frames.filter((f) => f.dragging).length).toBeGreaterThanOrEqual(10);
    expect(frames.filter((f) => toolbarShows(f) !== 'controls')).toEqual([]);
    expect(frames.filter((f) => f.marker)).toEqual([]);
    await page.keyboard.press('Escape');
    await page.mouse.up();
  });

  test('an Open now tab drag never shows it', async ({
    context,
    extensionId,
  }) => {
    const page = await openTabView(context, extensionId, false);
    await tabDragShowsTarget(page);

    const live = page.locator('[data-pane="open-now"] [data-open-tab-id]');
    await expect(live.first()).toBeVisible();
    await logToolbar(page, null);
    await pickUp(page, live.first());
    // PREMISE: an Open now row is held.
    await expect(
      page.locator('[data-pane="open-now"] [data-drag-held]')
    ).toHaveCount(1);
    await loggedDragFrames(page, 10);
    const frames = await toolbarLog(page);
    expect(frames.filter((f) => f.dragging).length).toBeGreaterThanOrEqual(10);
    expect(frames.filter((f) => toolbarShows(f) !== 'controls')).toEqual([]);
    expect(frames.filter((f) => f.marker)).toEqual([]);
    await page.keyboard.press('Escape');
    await page.mouse.up();
  });

  test('a press that never passes the activation distance never shows it', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId);
    await tabDragShowsTarget(page);

    const b = await boxOf(tabHandle(page, 'a1'));
    const x = b.x + 60;
    const y = b.y + b.height / 2;
    await logToolbar(page, 'a1');
    await page.mouse.move(x, y);
    await page.mouse.down();
    // 4px: short of the 5px a drag starts at.
    await page.mouse.move(x, y + 4, { steps: 4 });
    await loggedFrames(page, 20);
    const frames = await toolbarLog(page);
    // PREMISE: the press is down and no drag started.
    expect(frames.filter((f) => f.dragging)).toEqual([]);
    expect(frames.filter((f) => toolbarShows(f) !== 'controls')).toEqual([]);
    expect(frames.filter((f) => f.marker)).toEqual([]);
    // On past the distance, so the release is a drag's, cancelled -- not a
    // click that opens the tab.
    await page.mouse.move(x, y + 12, { steps: 2 });
    expect(await toolbarNow(page)).toMatchObject(SWAPPED);
    await page.keyboard.press('Escape');
    await page.mouse.up();
  });

  // A carry keeps it for its whole life (the carry's own marker).
  for (const k of kinds) {
    test(`a carried ${k.kind} shows it from the carry's start, and in the session it spring-opens`, async ({
      context,
      extensionId,
    }) => {
      const page = await openPopup(context, extensionId);
      await logToolbar(page, k.held);
      const at = await pickUp(
        page,
        k.handle(page, k.kind === 'tab' ? 'a1' : 'alpha')
      );
      await carryOutLeft(page, at);
      const frames = await toolbarLog(page);
      // PREMISE: the log spans the pick-up and the hand-off.
      const first = frames.findIndex((f) => f.dragging);
      expect(first).toBeGreaterThan(0);
      expect(frames.map(toolbarShows)).toEqual(
        frames.map((f) => (f.dragging ? 'target' : 'controls'))
      );
      // On the session list, carried.
      await expect(page.locator(CARD)).toHaveCount(1);
      expect(await toolbarNow(page)).toMatchObject(SWAPPED);

      await springOpen(page, 'S2');
      // PREMISE: the header is Target's.
      await expect(
        page.locator('[data-session-toolbar]').locator('..')
      ).toContainText('Target');
      expect(await toolbarNow(page)).toMatchObject(SWAPPED);
      await page.keyboard.press('Escape');
      await page.mouse.up();
    });
  }

  test('a carried window never shows it', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId);
    await tabDragShowsTarget(page);

    await logToolbar(page, 'w2');
    const at = await pickUp(page, windowHandle(page, 'w2'));
    await carryOutLeft(page, at);
    await springOpen(page, 'S2');
    await expect(
      page.locator('[data-session-toolbar]').locator('..')
    ).toContainText('Target');
    const frames = await toolbarLog(page);
    // PREMISE: the carry was logged, through the spring-open.
    expect(frames.filter((f) => f.dragging).length).toBeGreaterThanOrEqual(10);
    expect(frames.filter((f) => toolbarShows(f) !== 'controls')).toEqual([]);
    expect(frames.filter((f) => f.marker)).toEqual([]);
    await page.keyboard.press('Escape');
    await page.mouse.up();
  });

  // Every way a drag ends puts the toolbar row back.
  const ends: {
    name: string;
    run: (page: Page) => Promise<void>;
    // What the release left in the store, to say it ended the way named.
    after: { session: string; layout: string[] };
  }[] = [
    {
      name: 'a tab drag committed',
      run: async (page) => {
        await pickUp(page, tabHandle(page, 'a1'));
        await aimAt(page, 'a2', 0.75);
        await page.mouse.up();
      },
      after: { session: 'S1', layout: ['a0 a2 a1 al0* al1*', 'b0 b1'] },
    },
    {
      name: 'a tab drag cancelled with Esc',
      run: async (page) => {
        await pickUp(page, tabHandle(page, 'a1'));
        await page.keyboard.press('Escape');
        await page.mouse.up();
      },
      after: { session: 'S1', layout: [W1_START, 'b0 b1'] },
    },
    {
      name: 'a tab drag refused (let go over the session title)',
      run: async (page) => {
        const at = await pickUp(page, tabHandle(page, 'a1'));
        const title = await boxOf(
          page.getByRole('button', { name: /^Rename session: / })
        );
        await page.mouse.move(at.x, title.y + title.height / 2, {
          steps: 6,
        });
        await page.mouse.up();
      },
      after: { session: 'S1', layout: [W1_START, 'b0 b1'] },
    },
    {
      name: 'a group drag committed',
      run: async (page) => {
        await pickUp(page, groupHandle(page, 'alpha'));
        await aimAt(page, 'b0', 0.25);
        await page.mouse.up();
      },
      after: { session: 'S1', layout: ['a0 a1 a2', 'al0* al1* b0 b1'] },
    },
    {
      name: 'a carried tab dropped on a session row',
      run: async (page) => {
        const at = await pickUp(page, tabHandle(page, 'a1'));
        await carryOutLeft(page, at);
        await onto(page, 'S3');
        await page.mouse.up();
      },
      after: { session: 'S3', layout: ['a1', 'f0'] },
    },
    {
      name: 'a carried tab cancelled with Esc',
      run: async (page) => {
        const at = await pickUp(page, tabHandle(page, 'a1'));
        await carryOutLeft(page, at);
        await page.keyboard.press('Escape');
        await page.mouse.up();
      },
      after: { session: 'S1', layout: [W1_START, 'b0 b1'] },
    },
    {
      name: 'a carried tab adopted in Target and let go on its New window target',
      run: async (page) => {
        const aim = await headerAim(page);
        const at = await pickUp(page, tabHandle(page, 'a1'));
        await carryOutLeft(page, at);
        await springOpen(page, 'S2');
        await adoptPhantom(page, 'carried:a1');
        await ontoHeaderTarget(page, aim);
        await page.mouse.up();
      },
      after: { session: 'S2', layout: ['a1', D1_START, 'e0 e1'] },
    },
    {
      name: 'a carried tab adopted in Target and cancelled with Esc',
      run: async (page) => {
        const at = await pickUp(page, tabHandle(page, 'a1'));
        await carryOutLeft(page, at);
        await springOpen(page, 'S2');
        await adoptPhantom(page, 'carried:a1');
        await page.keyboard.press('Escape');
        await page.mouse.up();
      },
      after: { session: 'S1', layout: [W1_START, 'b0 b1'] },
    },
  ];
  for (const end of ends) {
    test(`after ${end.name}, the marker is gone and the toolbar row is back`, async ({
      context,
      extensionId,
    }) => {
      const page = await openPopup(context, extensionId);
      await end.run(page);
      await expect
        .poll(() => layout(page, end.after.session))
        .toEqual(end.after.layout);
      await expect(page.locator(CARD)).toHaveCount(0);
      expect(await toolbarNow(page)).toMatchObject(AT_REST);
    });
  }
});

// ---- the toolbar row's New window target lands (KAN-361 N1 B) ---------------

const headerTarget = (page: Page) =>
  page.locator('[data-new-window-target="first"]');

// Where the toolbar row's New window target stands (KAN-361): the controls'
// strip it covers, read at rest from the "Open session" control there --
// which main draws in the same place, so either build is aimed at the same
// point. Read before a drag, which hides the controls.
async function headerAim(page: Page): Promise<Point & { bottom: number }> {
  const b = await boxOf(page.getByRole('button', { name: 'Open session' }));
  return {
    x: b.x + b.width / 2,
    y: b.y + b.height / 2,
    bottom: b.y + b.height,
  };
}

const ontoHeaderTarget = (page: Page, aim: Point) =>
  page.mouse.move(aim.x, aim.y, { steps: 8 });

// A row's box as drawn now, transform included.
const drawnBox = (page: Page, rowId: string) =>
  page.locator(`[data-drag-row-id="${rowId}"]`).evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom };
  });

const dragRow = (id: string) => `[data-drag-row-id="${id}"]`;
// An element's own box: where it is drawn, less the translate a drag gives it.
const ownBox = (page: Page, selector: string) =>
  page.locator(selector).evaluate((el) => {
    if (!(el instanceof HTMLElement)) throw new Error('not an HTMLElement');
    const shift = Number(
      /translateY\((-?[\d.]+)px\)/.exec(el.style.transform)?.[1] ?? 0
    );
    const r = el.getBoundingClientRect();
    return { top: r.top - shift, bottom: r.bottom - shift };
  });

// One ⌘Z puts `session` back exactly: every field as it was, but the
// session's own timestamp, which the undo moves past the move's -- undoing
// is an edit the sync must rank above the move (KAN-55).
async function expectOneUndoRestores(
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
const sixByFour = (id: string, title: string, prefix: string) =>
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

test.describe('the toolbar target makes a new first window (KAN-361)', () => {
  test('an ordinary tab a1 held on it: lit, no slot, w1 closes up with no outline (KAN-378), w2 still; let go, a new first window holds it, and one ⌘Z undoes it', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId);
    const before = await stored(page);
    const aim = await headerAim(page);
    await pickUp(page, tabHandle(page, 'a1'));
    await settled(page);
    // At its own place: the rows as the drag measured them.
    const own = await ownBox(page, dragRow('a1'));
    const was = {
      a0: await drawnBox(page, 'a0'),
      a2: await drawnBox(page, 'a2'),
      al0: await drawnBox(page, 'al0'),
      al1: await drawnBox(page, 'al1'),
      w2: await drawnBox(page, 'w2'),
      b0: await drawnBox(page, 'b0'),
      b1: await drawnBox(page, 'b1'),
    };
    // PREMISE: loose tabs sit flush, so a1's room is its own height.
    const room = was.a2.top - own.top;
    expect(room).toBeCloseTo(own.bottom - own.top, 0);

    await ontoHeaderTarget(page, aim);
    await settled(page);
    await expect(page.locator('[data-drag-landing-slot]')).toHaveCount(0);
    await expect(headerTarget(page)).toHaveAttribute('data-landing', '');
    // w1 closes up behind a1: every row below it, a row up.
    for (const id of ['a2', 'al0', 'al1'] as const) {
      const now = await drawnBox(page, id);
      expect(now.top).toBeCloseTo(was[id].top - room, 0);
    }
    // Nothing else moves: a0 above it, and the whole of w2.
    for (const id of ['a0', 'w2', 'b0', 'b1'] as const) {
      expect(await drawnBox(page, id)).toEqual(was[id]);
    }
    // No outline while the target is lit (KAN-378 C).
    await expect(page.locator('[data-drag-source-room]')).toHaveCount(0);
    await page.mouse.up();

    await expect
      .poll(() => layout(page, 'S1'))
      .toEqual(['a1', 'a0 a2 al0* al1*', 'b0 b1']);
    expect(await windowIdsOf(page, 'S1')).toEqual(['new', 'w1', 'w2']);
    const after = await stored(page);
    for (const id of ['S2', 'S3', 'S4']) {
      expect(sessionOf(after, id)).toEqual(sessionOf(before, id));
    }
    expect(await toasts(page)).toEqual([]);
    await expect(headerTarget(page)).not.toHaveAttribute('data-landing', '');

    await expectOneUndoRestores(page, sessionOf(before, 'S1'));
  });

  test('an ordinary group Alpha held on it: lit, no slot, no outline (KAN-378), w2 still; let go, a new first window holds it with its entry, and one ⌘Z undoes it', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId);
    const before = await stored(page);
    const aim = await headerAim(page);
    await pickUp(page, groupHandle(page, 'alpha'));
    await settled(page);
    const was = {
      a0: await drawnBox(page, 'a0'),
      a1: await drawnBox(page, 'a1'),
      a2: await drawnBox(page, 'a2'),
      w2: await drawnBox(page, 'w2'),
      b0: await drawnBox(page, 'b0'),
      b1: await drawnBox(page, 'b1'),
    };

    await ontoHeaderTarget(page, aim);
    await settled(page);
    await expect(page.locator('[data-drag-landing-slot]')).toHaveCount(0);
    await expect(headerTarget(page)).toHaveAttribute('data-landing', '');
    // Alpha is w1's last item: nothing below it closes up, and nothing
    // else moves.
    for (const id of ['a0', 'a1', 'a2', 'w2', 'b0', 'b1'] as const) {
      expect(await drawnBox(page, id)).toEqual(was[id]);
    }
    // No outline while the target is lit (KAN-378 C).
    await expect(page.locator('[data-drag-source-room]')).toHaveCount(0);
    await page.mouse.up();

    await expect
      .poll(() => layout(page, 'S1'))
      .toEqual(['al0* al1*', 'a0 a1 a2', 'b0 b1']);
    expect(await windowIdsOf(page, 'S1')).toEqual(['new', 'w1', 'w2']);
    expect(await groupEntries(page, 'S1', 0)).toEqual(['alpha']);
    expect(await groupEntries(page, 'S1', 1)).toEqual([]);
    const after = await stored(page);
    for (const id of ['S2', 'S3', 'S4']) {
      expect(sessionOf(after, id)).toEqual(sessionOf(before, id));
    }
    expect(await toasts(page)).toEqual([]);

    await expectOneUndoRestores(page, sessionOf(before, 'S1'));
  });

  test('a carry from the session list straight onto it, never entering the list: Target gains a new first window holding a1', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId);
    const aim = await headerAim(page);
    const at = await pickUp(page, tabHandle(page, 'a1'));
    await carryOutLeft(page, at);
    await springOpen(page, 'S2');
    const pane = await detailPane(page);
    // PREMISE: the target is above the detail pane, so a path along its
    // height never enters the list.
    expect(aim.bottom).toBeLessThan(pane.top);
    // Up the session list to the target's height, then across to it.
    await page.mouse.move(pane.left - 40, aim.y, { steps: 6 });
    await page.mouse.move(aim.x, aim.y, { steps: 6 });
    // Read now and asserted after the release, so the release's outcome is
    // the first thing checked. The receiver lights the target in the very
    // pointermove that reaches it.
    const there = await page.evaluate(() => ({
      lit:
        document.querySelector(
          '[data-new-window-target="first"][data-landing]'
        ) !== null,
      // Never adopted: no row in the list is held.
      held: document.querySelector('[data-drag-held]') !== null,
    }));
    await page.mouse.up();

    await expect
      .poll(() => layout(page, 'S2'))
      .toEqual(['a1', D1_START, 'e0 e1']);
    expect(await windowIdsOf(page, 'S2')).toEqual(['new', 'd1', 'd2']);
    expect(await layout(page, 'S1')).toEqual(['a0 a2 al0* al1*', 'b0 b1']);
    expect(await toasts(page)).toEqual([]);
    expect(there).toEqual({ lit: true, held: false });
    await expect(headerTarget(page)).not.toHaveAttribute('data-landing', '');
  });

  // Q3 i. The toolbar row sits above the list, where a held pointer scrolls
  // it up at full speed (edgeScroll.ts): on the target the list keeps
  // scrolling, the drag stays the list's, and the target is lit.
  const scrolls = [
    {
      name: 'an ordinary tab',
      sessions: () => [sixByFour('S1', 'Six', 'y'), S2()],
      shown: 'S1',
      start: async (page: Page) => {
        await setDetailScroll(page, 100000);
        const pane = await detailPane(page);
        // A tab in the middle of the pane, clear of both auto-scroll zones.
        const tabId = await page.evaluate(
          ({ top, bottom }) => {
            for (const row of document.querySelectorAll<HTMLElement>(
              '[data-pane="detail"] [data-drag-row-id^="y"]'
            )) {
              const id = row.dataset.dragRowId ?? '';
              const b = row.getBoundingClientRect();
              if (
                id.includes('-') &&
                b.top > top + 80 &&
                b.bottom < bottom - 80
              )
                return id;
            }
            return undefined;
          },
          { top: pane.top, bottom: pane.bottom }
        );
        if (tabId === undefined) throw new Error('no tab mid-pane');
        await pickUp(page, tabHandle(page, tabId));
        return tabId;
      },
    },
    {
      name: 'a carried tab the list adopted',
      sessions: () => [S1(), sixByFour('S6', 'Six', 'y')],
      shown: 'S6',
      start: async (page: Page) => {
        const at = await pickUp(page, tabHandle(page, 'a1'));
        await carryOutLeft(page, at);
        await springOpen(page, 'S6');
        await setDetailScroll(page, 100000);
        // Into the pane's middle: the list adopts the carry.
        const pane = await detailPane(page);
        await page.mouse.move(pane.left + 100, (pane.top + pane.bottom) / 2, {
          steps: 6,
        });
        await expect(
          page.locator('[data-drag-row-id="carried:a1"]')
        ).toHaveAttribute('data-drag-held', '');
        return 'a1';
      },
    },
  ];
  for (const sc of scrolls) {
    test(`Q3 i: ${sc.name}, held on it with the list scrolled to its end: the list scrolls up frame by frame, and the target is lit`, async ({
      context,
      extensionId,
    }) => {
      // Each opens on Source, S1.
      const page = await openPopup(context, extensionId, sc.sessions());
      const aim = await headerAim(page);
      const tabId = await sc.start(page);
      // PREMISE: the list is scrolled far enough down to travel for the
      // whole log at full speed (14px a frame).
      const end = (await detailPane(page)).scrollTop;
      expect(end).toBeGreaterThan(400);

      await ontoHeaderTarget(page, aim);
      await logToolbar(page, null);
      await loggedFrames(page, 12);
      const frames = (await toolbarLog(page)).map(
        ({ dragging, held, lit, scrollTop }) => ({
          dragging,
          held,
          lit,
          scrollTop,
        })
      );
      expect(frames.length).toBeGreaterThanOrEqual(12);
      // Every frame: the list's own drag, the target lit.
      expect(frames.filter((f) => !f.dragging || !f.held || !f.lit)).toEqual(
        []
      );
      // And the list scrolling up in every one of them.
      const tops = frames.map((f) => f.scrollTop);
      expect(tops[0]).toBeGreaterThan(14 * frames.length);
      for (let i = 1; i < tops.length; i++) {
        expect(tops[i], tops.join(' ')).toBeLessThan(tops[i - 1] ?? 0);
      }
      await page.mouse.up();

      // Let go there: a new first window of the session on screen.
      await expect
        .poll(
          async () =>
            sessionOf(await stored(page), sc.shown).windows[0]?.tabs.map(
              (t) => t.tabId
            )
        )
        .toEqual([tabId]);
    });
  }

  // NEGATIVES, each after its CONTROL on the same page.

  test('a window drag over the toolbar row moves nothing and lights nothing', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId);
    const aim = await headerAim(page);
    // CONTROL: a tab held there lands there: no slot in the list, and the
    // target lit.
    await pickUp(page, tabHandle(page, 'a1'));
    await ontoHeaderTarget(page, aim);
    await expect(page.locator('[data-drag-landing-slot]')).toHaveCount(0);
    await expect(headerTarget(page)).toHaveAttribute('data-landing', '');
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await expect(headerTarget(page)).not.toHaveAttribute('data-landing', '');

    await logToolbar(page, 'w1');
    await pickUp(page, windowHandle(page, 'w1'));
    await ontoHeaderTarget(page, aim);
    await settled(page);
    const frames = await toolbarLog(page);
    // PREMISE: the window drag was logged, held, over the toolbar row.
    expect(frames.filter((f) => f.dragging && f.held).length).toBeGreaterThan(
      10
    );
    expect(frames.filter((f) => f.lit || f.marker)).toEqual([]);
    await page.mouse.up();
    // NEGATIVE, so a fixed wait: a move is written on the release.
    await page.waitForTimeout(200);
    expect(await layout(page, 'S1')).toEqual([W1_START, 'b0 b1']);
    expect(await windowIdsOf(page, 'S1')).toEqual(['w1', 'w2']);
  });

  test('an ordinary tab let go just below it, in the list’s first row, lands there as it always has', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId);
    const aim = await headerAim(page);
    const at = await pickUp(page, tabHandle(page, 'a1'));
    // CONTROL: held on the target, it lands there: no slot in the list, and
    // the target lit.
    await ontoHeaderTarget(page, aim);
    await expect(page.locator('[data-drag-landing-slot]')).toHaveCount(0);
    await expect(headerTarget(page)).toHaveAttribute('data-landing', '');

    // Just below: the top of w1's own row, the list's first.
    const w1 = await boxOf(page.locator('[data-drag-row-id="w1"]'));
    const y = w1.y + 2;
    // PREMISE: below the target, inside the pane.
    expect(y).toBeGreaterThan(aim.bottom);
    expect(y).toBeGreaterThan((await detailPane(page)).top);
    await page.mouse.move(at.x, y, { steps: 4 });
    await settled(page);
    await expect(headerTarget(page)).not.toHaveAttribute('data-landing', '');
    await expect(page.locator('[data-drag-landing-slot]')).toHaveCount(1);
    await page.mouse.up();

    await expect
      .poll(() => layout(page, 'S1'))
      .toEqual(['a1 a0 a2 al0* al1*', 'b0 b1']);
    expect(await windowIdsOf(page, 'S1')).toEqual(['w1', 'w2']);
  });
});

// ---- the trailing block: the phantom's home (KAN-361/366) -------------------

// The list's trailing block, after its last window.
const trailingBlock = (page: Page) =>
  page.locator('[data-new-window-target="last"]');

// One frame of the detail pane: every row's top (the held row and any
// phantom left out, which a drag moves on purpose), whether a carry's card
// is up, whether a carried phantom is held (adopted), the trailing block's
// height, and how far the pane can scroll. KAN-379: also each window's
// title row top and block height, and the tops of the landing slot, the
// source room and the held row (null where not drawn), and each band's
// title row top.
interface PaneFrame {
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
}
const isTopOrNull = (x: unknown) => x === null || typeof x === 'number';
const isNumberRecord = (x: unknown): x is Record<string, number> =>
  typeof x === 'object' &&
  x !== null &&
  !Array.isArray(x) &&
  Object.values(x).every((v) => typeof v === 'number');
const isPaneLog = (x: unknown): x is PaneFrame[] => {
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
      isTopOrNull(f.heldTop)
  );
};

// Logs a PaneFrame every animation frame from now until paneLog is read.
// `leaveOut` names rows not to log: the one about to be picked up.
async function logPane(page: Page, leaveOut: string[]): Promise<void> {
  await page.evaluate((leaveOut) => {
    const frames: unknown[] = [];
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

async function paneLog(page: Page): Promise<PaneFrame[]> {
  const raw = await page.evaluate(() => {
    document.body.dataset.paneLog = 'off';
    return document.body.dataset.paneFrames ?? '[]';
  });
  const frames: unknown = JSON.parse(raw);
  if (!isPaneLog(frames)) throw new Error(`not a pane log: ${raw}`);
  return frames;
}

// The frames in which the rows moved, against the frame before: each with
// the one amount every row drawn in both moved by, or NaN where they moved
// by different amounts.
const settleSteps = (frames: PaneFrame[]): { frame: number; shift: number }[] =>
  frames.flatMap((f, i) => {
    const before = frames[i - 1];
    if (before === undefined) return [];
    const shifts = Object.entries(f.rows)
      .filter(([id]) => id in before.rows)
      .map(([id, top]) => top - before.rows[id]);
    if (shifts.every((d) => Math.abs(d) <= 0.5)) return [];
    const first = shifts[0] ?? NaN;
    return [
      {
        frame: i,
        shift: shifts.every((d) => Math.abs(d - first) <= 0.5) ? first : NaN,
      },
    ];
  });

// A held row brought to the pane's bottom edge until the list has scrolled
// all the way into the trailing block's room (Q4): the room's 34px past the
// scroll it had at rest, which `pane` was read at.
async function intoTheRoom(
  page: Page,
  x: number,
  pane: PaneBox
): Promise<void> {
  await page.mouse.move(x, pane.bottom - 4, { steps: 4 });
  await expect
    .poll(async () => (await detailPane(page)).scrollTop)
    .toBe(pane.scrollTop + 34);
  await settled(page);
}

// Straight onto a phantom's own place, and adopted there. Unlike
// adoptPhantom, asserts nothing about where the phantom rests, and scrolls
// nothing: a test that reads where it rested reads it itself.
async function ontoOwnPhantom(page: Page, phantomId: string): Promise<void> {
  const phantom = page.locator(`[data-drag-row-id="${phantomId}"]`);
  const b = await boxOf(phantom);
  await page.mouse.move(b.x + Math.min(60, b.width / 2), b.y + b.height / 2, {
    steps: 8,
  });
  await expect(phantom).toHaveAttribute('data-drag-held', '');
}

// Every row of every frame where it is drawn, against where the first frame
// drew it: the rows that moved, with the frame they moved in.
const rowsThatMoved = (frames: PaneFrame[]): string[] => {
  const first = frames[0]?.rows ?? {};
  return frames.flatMap((f, i) =>
    Object.entries(f.rows)
      .filter(([id, top]) => id in first && Math.abs(top - first[id]) > 0.5)
      .map(([id, top]) => `frame ${i}: ${id} ${first[id]} -> ${top}`)
  );
};

test.describe('the phantom rests in a trailing block after the last window (KAN-361/366)', () => {
  test('a carry from the session on screen, out to the list and back in to its phantom: no row of the session moves in any frame', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId);
    // b1 is the session's last row, so the room it leaves moves nothing.
    await logPane(page, ['b1', 'tab:b1']);
    const at = await pickUp(page, tabHandle(page, 'b1'));
    await carryOutLeft(page, at);
    // Back in, onto the phantom: adopted at its own place.
    await ontoOwnPhantom(page, 'carried:b1');
    await settled(page);
    const frames = await paneLog(page);

    // PREMISE: logged at rest, with the layer driving the carry, and
    // adopted; every row of the session drawn in the first frame.
    expect(frames.length).toBeGreaterThan(20);
    expect(frames[0]?.held).toBe(false);
    expect(frames.some((f) => f.card && !f.adopted)).toBe(true);
    expect(frames.some((f) => f.adopted)).toBe(true);
    expect(Object.keys(frames[0]?.rows ?? {}).sort()).toEqual(
      [
        'w1',
        'w2',
        'a0',
        'a1',
        'a2',
        'al0',
        'al1',
        'b0',
        'tab:a0',
        'tab:a1',
        'tab:a2',
        'group:alpha',
        'tab:b0',
      ].sort()
    );
    expect(rowsThatMoved(frames)).toEqual([]);
    // The phantom rests in the trailing block, after w2.
    const phantom = await boxOf(tabHandle(page, 'carried:b1'));
    const w2 = await boxOf(page.locator('[data-drag-row-id="w2"]'));
    expect(phantom.y).toBeGreaterThan(w2.y + w2.height);
    await page.keyboard.press('Escape');
    await page.mouse.up();
  });

  test('Q4: a 6×4 session scrolled to its end gains one row of scroll range when a tab is picked up, in the frame it is picked up, and no row moves', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(
      context,
      extensionId,
      [sixByFour('S6', 'Six', 's'), S2()],
      'S6'
    );
    const rowH = await heightOf(tabHandle(page, 's0-0'));
    await setDetailScroll(page, 1e6);
    await settled(page);
    const pane = await detailPane(page);
    const lastWindow = await boxOf(page.locator('[data-drag-row-id="sw5"]'));
    // At rest the trailing block adds nothing: at its end, the list leaves
    // what main leaves below its last window (9px, measured on main), less
    // than a row.
    expect(pane.bottom - (lastWindow.y + lastWindow.height)).toBeCloseTo(9, 0);
    expect(rowH).toBeGreaterThan(9);
    // A tab mid-pane, clear of both auto-scroll zones.
    const mid = (pane.top + pane.bottom) / 2;
    const pick = await page.evaluate((mid) => {
      const el = [
        ...document.querySelectorAll<HTMLElement>(
          '[data-pane="detail"] [data-drag-row-id^="s"]'
        ),
      ].find((r) => {
        const b = r.getBoundingClientRect();
        return (
          /^s\d-\d$/.test(r.dataset.dragRowId ?? '') &&
          b.top <= mid &&
          b.bottom > mid
        );
      });
      return el?.dataset.dragRowId ?? null;
    }, mid);
    if (pick === null) throw new Error('no tab mid-pane');

    await logPane(page, [pick, `tab:${pick}`]);
    await pickUp(page, tabHandle(page, pick));
    await settled(page);
    const frames = await paneLog(page);
    const atRest = frames[0];
    const held = frames.filter((f) => f.held);
    // PREMISE: logged at rest and held.
    expect(atRest?.held).toBe(false);
    expect(held.length).toBeGreaterThan(5);
    // One row of room, 34px (a 32px row and the box's borders), from the
    // first frame the row is held in.
    const room = 34;
    expect(held.map((f) => f.range - (atRest?.range ?? NaN))).toEqual(
      held.map(() => room)
    );
    // It is the trailing block's: zero at rest, a row tall while held.
    expect(atRest?.trailing).toBe(0);
    expect(held.map((f) => f.trailing)).toEqual(held.map(() => room));
    // The room is added below: no row moves, the last window's included.
    expect(Object.keys(atRest?.rows ?? {}).length).toBeGreaterThan(20);
    expect(rowsThatMoved(frames)).toEqual([]);

    // And it can be reached: held at the bottom edge, the list scrolls into
    // it, and the room shows below the last window.
    await page.mouse.move(pane.left + 100, pane.bottom - 4, { steps: 4 });
    await expect
      .poll(async () => (await detailPane(page)).scrollTop)
      .toBe(pane.scrollTop + room);
    // Read with the pointer off the block, mid-pane, where no auto-scroll
    // moves the list: a release in the block lands there (KAN-366 B), and
    // lights it.
    await page.mouse.move(pane.left + 100, mid, { steps: 4 });
    await settled(page);
    const below = await boxOf(trailingBlock(page));
    const last = await boxOf(page.locator('[data-drag-row-id="sw5"]'));
    expect(below.y).toBeGreaterThan(last.y + last.height);
    expect(below.y + below.height).toBeLessThanOrEqual(pane.bottom);

    // Drawn blank: a border with no colour, and no name.
    const blank = await newWindowBox(page, 'last');
    expect(blank?.borderWidth).toBeGreaterThan(0);
    expect(blank?.borderColour).toBe('rgba(0, 0, 0, 0)');
    expect(blank?.named).toBe(false);
    expect(rgbToHex(blank?.fill ?? '')).not.toBe(LIGHT_THEME.HOVER_COLOR);
    // Lit, as a landing in it would light it: the header target's look.
    const header = await newWindowBox(page, 'first');
    await page.evaluate(
      () =>
        document
          .querySelector('[data-new-window-target="last"]')
          ?.setAttribute('data-landing', '')
    );
    const lit = await newWindowBox(page, 'last');
    expect(rgbToHex(lit?.fill ?? '')).toBe(LIGHT_THEME.HOVER_COLOR);
    expect(lit?.border).toBe('solid');
    expect(lit?.borderColour).toBe(header?.borderColour);
    expect(lit?.named).toBe(true);
    await page.keyboard.press('Escape');
    await page.mouse.up();
  });

  test('a window drag leaves the trailing block at zero height', async ({
    context,
    extensionId,
  }) => {
    // A list that scrolls, where a tab drag does give the block its room.
    const page = await openPopup(
      context,
      extensionId,
      [sixByFour('S6', 'Six', 's'), S2()],
      'S6'
    );
    // CONTROL: a tab drag gives it its row.
    await pickUp(page, tabHandle(page, 's0-1'));
    await settled(page);
    expect((await boxOf(trailingBlock(page))).height).toBeGreaterThan(20);
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await settled(page);
    expect((await boxOf(trailingBlock(page))).height).toBe(0);

    await logPane(page, ['sw0']);
    await pickUp(page, windowHandle(page, 'sw0'));
    await settled(page);
    const frames = await paneLog(page);
    // PREMISE: the window drag was logged, held.
    expect(frames.filter((f) => f.held).length).toBeGreaterThan(5);
    expect(frames.filter((f) => f.trailing !== 0)).toEqual([]);
    await page.keyboard.press('Escape');
    await page.mouse.up();
  });

  // "Drag it to the end" keeps its slack (half the held row) past the last
  // window's last row, though that point is inside the trailing block, where
  // a release from any other window makes a new last window (KAN-132,
  // KAN-366 B). In a list that scrolls, where the block has its room,
  // scrolled into it.
  test('a tab let go just past the last window’s last row, inside the trailing block, still lands last there', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(
      context,
      extensionId,
      [sixByFour('S6', 'Six', 's'), S2()],
      'S6'
    );
    await setDetailScroll(page, 1e6);
    await settled(page);
    const pane = await detailPane(page);
    const at = await pickUp(page, tabHandle(page, 's5-1'));
    await intoTheRoom(page, at.x, pane);
    // s5-3's own box, not where the preview draws it: with the pointer in
    // the room, the drag can be landing in the trailing block (KAN-366 B),
    // and s5-1's window closes up under it (Q2 ii).
    const last = await ownBox(page, dragRow('s5-3'));
    const y = last.bottom + 12;
    const block = await boxOf(trailingBlock(page));
    // PREMISE: the point is in the trailing block, within half a row of the
    // last row.
    expect(y).toBeGreaterThan(block.y);
    expect(y).toBeLessThan(block.y + block.height);
    await page.mouse.move(at.x, y, { steps: 6 });
    await settled(page);
    await page.mouse.up();

    await expect
      .poll(async () => (await layout(page, 'S6'))[5])
      .toBe('s5-0 s5-2 s5-3 s5-1');
  });

  // KAN-366 Q4 never makes a list scroll: the room is for a list that
  // already does. One that fits with less than the room to spare would
  // otherwise begin to scroll at the pick-up, and the scrollbar that
  // appears (headed Chrome draws a 10px one) would narrow every row in the
  // frame the drag starts. Headless runs with --hide-scrollbars, so no row
  // can be seen to narrow here: the scroll range staying at 0 is what says
  // no scrollbar could appear.
  test('a list that fits with less than a row to spare gains no scroll range at the pick-up, and no row moves', async ({
    context,
    extensionId,
  }) => {
    // The pane's height and the rows', from the usual session.
    const probe = await openPopup(context, extensionId);
    const sizes = await probe.evaluate(() => {
      let el = document.querySelector(
        '[data-pane="detail"] [data-drop-window-id]'
      )?.parentElement;
      while (el && !['auto', 'scroll'].includes(getComputedStyle(el).overflowY))
        el = el.parentElement;
      const row = document
        .querySelector('[data-drag-row-id="a0"]')
        ?.getBoundingClientRect().height;
      return { pane: el?.clientHeight ?? 0, row: row ?? 0 };
    });
    await probe.close();
    // One window: its header, k tabs, and its 8px margin, all rows.
    const k = Math.floor((sizes.pane - 8) / sizes.row) - 1;
    const fits = session('S8', 'Fits', [
      win(
        'fw',
        Array.from({ length: k }, (_, i) => tab(`f${i}`))
      ),
    ]);
    const page = await openPopup(context, extensionId, [fits, S2()], 'S8');
    // The room left in the pane below the content: its inner height, less
    // what the content takes -- from the pane's content top to the last
    // window's bottom, its margin included. Not from scrollHeight, which is
    // never less than clientHeight and so reads 0 for any list that fits.
    const spare = await page.evaluate(() => {
      let el = document.querySelector(
        '[data-pane="detail"] [data-drop-window-id]'
      )?.parentElement;
      while (el && !['auto', 'scroll'].includes(getComputedStyle(el).overflowY))
        el = el.parentElement;
      const last = document.querySelector('[data-drop-window-id="fw"]');
      if (!el || !last) return NaN;
      const contentTop = el.getBoundingClientRect().top + el.clientTop;
      const used =
        last.getBoundingClientRect().bottom +
        parseFloat(getComputedStyle(last).marginBottom) -
        contentTop +
        el.scrollTop;
      return el.clientHeight - used;
    });
    // PREMISE: it fits, with less than the room (34px) to spare.
    expect(spare).toBeGreaterThanOrEqual(0);
    expect(spare).toBeLessThan(34);

    await logPane(page, ['f1', 'tab:f1']);
    await pickUp(page, tabHandle(page, 'f1'));
    await settled(page);
    const frames = await paneLog(page);
    const held = frames.filter((f) => f.held);
    // PREMISE: logged at rest and held, the rows of the session in each.
    expect(frames[0]?.held).toBe(false);
    expect(held.length).toBeGreaterThan(5);
    expect(Object.keys(frames[0]?.rows ?? {}).length).toBe(2 * k - 1);
    // No frame scrolls: the scroll range never rises above 0.
    expect(frames.filter((f) => f.range > 0)).toEqual([]);
    // No row moves.
    expect(rowsThatMoved(frames)).toEqual([]);
    await page.keyboard.press('Escape');
    await page.mouse.up();
  });

  // The end of a drag that scrolled into the room: the block goes back to
  // zero, the browser clamps the scroll, and the list settles by up to the
  // room -- the ordinary end-of-drag settle, like the window fold's
  // (KAN-153) and KAN-157's scroll put back. Pinned as measured: every row
  // moves together, downward, in consecutive frames -- one for a drop, a
  // few for Esc, where the held row eases home -- by at most the room, and
  // the rows are drawn in the stored order.
  for (const ending of [
    'Esc',
    'a release at the end of the last window',
  ] as const) {
    test(`after the list scrolled into the room, ${ending}: the list settles in consecutive frames, by at most the room, in the stored order`, async ({
      context,
      extensionId,
    }) => {
      const page = await openPopup(
        context,
        extensionId,
        [sixByFour('S6', 'Six', 's'), S2()],
        'S6'
      );
      await setDetailScroll(page, 1e6);
      await settled(page);
      const pane = await detailPane(page);
      const at = await pickUp(page, tabHandle(page, 's5-1'));
      await intoTheRoom(page, at.x, pane);
      if (ending !== 'Esc') {
        // Within the slack below the last row: lands last. s5-3's own box,
        // not where the preview draws it: with the pointer in the room the
        // drag can be landing in the trailing block (KAN-366 B), and s5-1's
        // window closes up under it (Q2 ii).
        const last = await ownBox(page, dragRow('s5-3'));
        await page.mouse.move(at.x, last.bottom + 6, { steps: 4 });
        await settled(page);
      }

      // Every row outside the last window: the settle is all that moves
      // them. The last window's rows also move for the drop itself.
      const lastWindowRows = ['sw5', 's5-0', 's5-1', 's5-2', 's5-3'].flatMap(
        (id) => [id, `tab:${id}`]
      );
      await logPane(page, lastWindowRows);
      if (ending === 'Esc') await page.keyboard.press('Escape');
      await page.mouse.up();
      await settled(page);
      const frames = await paneLog(page);
      // PREMISE: logged held and after the end, the rows in every frame.
      expect(frames[0]?.held).toBe(true);
      expect(frames[frames.length - 1]?.held).toBe(false);
      expect(Object.keys(frames[0]?.rows ?? {}).length).toBeGreaterThan(20);

      const steps = settleSteps(frames);
      const total = steps.reduce((sum, st) => sum + st.shift, 0);
      test.info().annotations.push({
        type: 'settle',
        description: `${ending}: ${steps
          .map((st) => `${st.shift}px@${st.frame}`)
          .join(', ')} = ${total}px`,
      });
      console.log(`SETTLE ${ending}: ${JSON.stringify(steps)} = ${total}px`);
      // Every row moves together, every step down, and the whole settle is
      // at most the room.
      expect(steps.length).toBeGreaterThan(0);
      expect(steps.every((st) => st.shift > 0)).toBe(true);
      expect(total).toBeLessThanOrEqual(34);
      if (ending === 'Esc') {
        // Measured: Esc eases the held row home under its own transition,
        // and its transform's overflow shrinks with it, so the clamp follows
        // it over a few consecutive frames rather than one.
        expect(
          steps.every((st, n) => n === 0 || st.frame === steps[n - 1].frame + 1)
        ).toBe(true);
        expect(steps.length).toBeLessThanOrEqual(10);
      } else {
        // A drop draws the moved row at once: the clamp is one frame.
        expect(steps).toHaveLength(1);
      }

      const want =
        ending === 'Esc' ? 's5-0 s5-1 s5-2 s5-3' : 's5-0 s5-2 s5-3 s5-1';
      await expect.poll(async () => (await layout(page, 'S6'))[5]).toBe(want);
      // Drawn in the stored order.
      const drawn = await page.evaluate(() =>
        [
          ...document.querySelectorAll<HTMLElement>(
            '[data-drop-window-id="sw5"] [data-drag-row-id]'
          ),
        ]
          .map((r) => r.dataset.dragRowId ?? '')
          .filter((id) => /^s5-\d$/.test(id))
          .join(' ')
      );
      expect(drawn).toBe(want);
    });
  }
});

// ---- below the last window makes a new last window (KAN-366 B) -------------

// Whether the trailing block is lit: a release here would make a new last
// window. False where the list draws no trailing block.
const trailingLit = (page: Page) =>
  page.evaluate(
    () =>
      document
        .querySelector('[data-new-window-target="last"]')
        ?.hasAttribute('data-landing') ?? false
  );

// "Below the list", as the plan measured it on main: midway between the
// last window's bottom and the pane's bottom. Read at rest.
async function belowTheList(page: Page, lastWindowId: string): Promise<number> {
  const last = await boxOf(
    page.locator(`[data-drop-window-id="${lastWindowId}"]`)
  );
  const pane = await detailPane(page);
  return (last.y + last.height + pane.bottom) / 2;
}

// The detail pane's scroll range: how far it can scroll, 0 for a list that
// fits.
const scrollRange = (page: Page) =>
  page.evaluate(() => {
    let el = document.querySelector(
      '[data-pane="detail"] [data-drop-window-id]'
    )?.parentElement;
    while (el && !['auto', 'scroll'].includes(getComputedStyle(el).overflowY))
      el = el.parentElement;
    if (!el) throw new Error('no detail pane');
    return el.scrollHeight - el.clientHeight;
  });

// The document's New window marker: '' for a drag or carry that offers a
// new window, 'room' when the trailing block also has its row of room (Q4),
// null with neither.
const newWindowMarker = (page: Page) =>
  page.evaluate(() =>
    document.documentElement.getAttribute('data-drag-new-window')
  );

// The trailing block as drawn now, beside the header target's border colour
// and the last window's bottom: what expectLitBox judges. Read while the
// drag is live; judged when the test is ready to. Null where the list draws
// no trailing block.
async function litBoxOf(page: Page, lastWindowId: string) {
  if ((await trailingBlock(page).count()) === 0) return null;
  const look = await newWindowBox(page, 'last');
  const box = await boxOf(trailingBlock(page));
  const last = await boxOf(
    page.locator(`[data-drop-window-id="${lastWindowId}"]`)
  );
  return {
    look,
    headerBorderColour: (await newWindowBox(page, 'first'))?.borderColour,
    top: box.y,
    height: box.height,
    lastBottom: last.y + last.height,
    // From the block's top to the bottom of the pane's content box.
    free: (await paneInnerBottom(page)) - box.y,
  };
}

// The bottom of the detail pane's content box, viewport space.
const paneInnerBottom = (page: Page) =>
  page.evaluate(() => {
    let el = document.querySelector(
      '[data-pane="detail"] [data-drop-window-id]'
    )?.parentElement;
    while (el && !['auto', 'scroll'].includes(getComputedStyle(el).overflowY))
      el = el.parentElement;
    if (!el) throw new Error('no detail pane');
    return el.getBoundingClientRect().top + el.clientTop + el.clientHeight;
  });

// Lit, the trailing block has the header target's look -- the hover fill,
// a solid border of its colour, its name -- and a box of its own: one row
// and its borders, whatever room the list gave it (V1 A, V2 A, ruling 2),
// below the last window. Always a full row, even where the list fits with
// less than a row free (Justine's R2 pick, 2026-10-01).
function expectLitBox(
  m: Awaited<ReturnType<typeof litBoxOf>>,
  rowH: number
): void {
  expect(m).not.toBeNull();
  if (m === null) return;
  expect(m.look?.landing).toBe(true);
  expect(rgbToHex(m.look?.fill ?? '')).toBe(LIGHT_THEME.HOVER_COLOR);
  expect(m.look?.border).toBe('solid');
  expect(m.look?.borderColour).toBe(m.headerBorderColour);
  expect(m.look?.named).toBe(true);
  const width = m.look?.borderWidth ?? NaN;
  expect(width).toBeGreaterThan(0);
  expect(m.height).toBeCloseTo(rowH + 2 * width, 0);
  expect(m.top).toBeGreaterThan(m.lastBottom);
}

// A frame log of the trailing block: lit, the pane's scroll range, and the
// block's height.
const isLitLog = (
  x: unknown
): x is {
  lit: boolean;
  range: number;
  scrollTop: number;
  height: number;
  cols: string;
  tops: string;
  afterSettled: boolean;
}[] => {
  if (!Array.isArray(x)) return false;
  const items: readonly unknown[] = x;
  return items.every(
    (f) =>
      typeof f === 'object' &&
      f !== null &&
      'lit' in f &&
      typeof f.lit === 'boolean' &&
      'range' in f &&
      typeof f.range === 'number' &&
      'height' in f &&
      typeof f.height === 'number' &&
      'scrollTop' in f &&
      typeof f.scrollTop === 'number' &&
      'cols' in f &&
      typeof f.cols === 'string' &&
      'tops' in f &&
      typeof f.tops === 'string' &&
      'afterSettled' in f &&
      typeof f.afterSettled === 'boolean'
  );
};

// Starts logging, every animation frame, the trailing block's lit state and
// height, the detail pane's scroll range and position, and every row but the
// held one and a carried phantom: its id, left, width and top. Stopped and read by stopLitLog.
const startLitLog = (page: Page) =>
  page.evaluate(() => {
    const log: {
      lit: boolean;
      range: number;
      scrollTop: number;
      height: number;
      cols: string;
      tops: string;
      afterSettled: boolean;
    }[] = [];
    document.body.dataset.litLog = 'on';
    const frame = () => {
      let el = document.querySelector(
        '[data-pane="detail"] [data-drop-window-id]'
      )?.parentElement;
      while (el && !['auto', 'scroll'].includes(getComputedStyle(el).overflowY))
        el = el.parentElement;
      const block = document.querySelector('[data-new-window-target="last"]');
      const rows = [
        ...document.querySelectorAll(
          '[data-pane="detail"] [data-drag-row-id]:not([data-drag-held])'
        ),
      ]
        .filter(
          (r) => !r.getAttribute('data-drag-row-id')?.includes('carried:')
        )
        .map((r) => ({
          id: r.getAttribute('data-drag-row-id'),
          box: r.getBoundingClientRect(),
        }));
      log.push({
        lit: block?.hasAttribute('data-landing') ?? false,
        range: el ? el.scrollHeight - el.clientHeight : NaN,
        height: block?.getBoundingClientRect().height ?? NaN,
        scrollTop: el?.scrollTop ?? NaN,
        cols: rows.map((r) => `${r.id}:${r.box.left}:${r.box.width}`).join(' '),
        tops: rows.map((r) => `${r.id}:${r.box.top}`).join(' '),
        afterSettled: document.body.dataset.settledMark === '1',
      });
      document.body.dataset.litFrames = JSON.stringify(log);
      if (document.body.dataset.litLog === 'on') requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });

// Marks the frame log: every frame logged from now on is `afterSettled`. Call
// it right after `settled(page)`, then it keeps logging for 10 more frames so
// the check has frames to look at.
async function markLitLogSettled(page: Page) {
  await page.evaluate(async () => {
    document.body.dataset.settledMark = '1';
    for (let i = 0; i < 10; i++)
      await new Promise((r) => requestAnimationFrame(r));
  });
}

async function stopLitLog(page: Page) {
  const raw = await page.evaluate(() => {
    document.body.dataset.litLog = 'off';
    return document.body.dataset.litFrames ?? '[]';
  });
  const parsed: unknown = JSON.parse(raw);
  if (!isLitLog(parsed)) throw new Error(`not a lit log: ${raw}`);
  return parsed;
}

// What a tight-fit frame log must show once the cap is gone (Justine's R2
// pick): the box a full row (`rowBox`: the row and its borders) in every lit
// frame; the scroll range 0 until it lights and no more than the row's
// overflow of the space free at rest while lit; and no row moved by it --
// the scroll range grows, the scroll position does not.
function expectFullRowLog(
  log: Awaited<ReturnType<typeof stopLitLog>>,
  rowBox: number,
  freeAtRest: number
): void {
  const lit = log.filter((f) => f.lit);
  // PREMISE: logged, lit for several frames, and a row recorded in each.
  expect(log.length).toBeGreaterThan(10);
  expect(lit.length).toBeGreaterThan(3);
  expect(lit.filter((f) => f.cols === '')).toEqual([]);
  // The lit box is a full row in every lit frame, though the space is less.
  expect(freeAtRest).toBeLessThan(rowBox);
  for (const f of lit) expect(f.height).toBeCloseTo(rowBox, 0);
  // Before it lights, no scroll range; lit, no more than the box's overflow.
  const firstLit = log.findIndex((f) => f.lit);
  expect(log.slice(0, firstLit).filter((f) => !(f.range <= 0))).toEqual([]);
  for (const f of lit)
    expect(f.range).toBeLessThanOrEqual(rowBox - freeAtRest + 1);
  expect(lit.filter((f) => f.range > 0).length).toBeGreaterThan(0);
  // Nothing is drawn elsewhere for it. The pane never scrolls, and in every
  // lit frame each row has its first lit frame's left and width. The held
  // row and the carried phantom are not rows of the list (excluded by the
  // log). Tops are compared once they have settled: before that, the rows
  // below the source window slide as it closes up, which has begun before
  // the box lights (its own motion, not the box's).
  expect(log.filter((f) => f.scrollTop !== 0)).toEqual([]);
  expect(new Set(lit.map((f) => f.cols)).size).toBe(1);
  // Tops are compared only in lit frames after `settled()` returned. PREMISE:
  // there are at least 8 of them. A failure names each distinct tops string
  // and the log frame indexes it appeared in, so a CI log shows which row
  // moved and by how much.
  const after = log.flatMap((f, index) =>
    f.lit && f.afterSettled ? [{ index, tops: f.tops }] : []
  );
  expect(after.length, 'lit frames after settled()').toBeGreaterThanOrEqual(8);
  const framesByTops = new Map<string, number[]>();
  for (const f of after)
    framesByTops.set(f.tops, [...(framesByTops.get(f.tops) ?? []), f.index]);
  const distinct = [...framesByTops].map(
    ([tops, indexes]) => `  frames [${indexes.join(',')}]: ${tops}`
  );
  expect(
    framesByTops.size,
    `rows moved after settled() (${
      framesByTops.size
    } distinct tops):\n${distinct.join('\n')}`
  ).toBe(1);
}

// One ⌘Z puts every session in `ids` back as `before` held it: every field
// but the session's own timestamp, which the undo moves past the move's
// (KAN-55), and whether it is selected, which a spring-open changed and no
// undo puts back.
async function expectOneUndoRestoresAll(
  page: Page,
  before: TabMasterContainer,
  ids: string[]
): Promise<void> {
  const plain = (s: tabContainerData) => ({
    ...s,
    lastModified: undefined,
    isSelected: undefined,
  });
  await page.keyboard.press('Control+z');
  await expect
    .poll(async () => {
      const now = await stored(page);
      return ids.map((id) => plain(sessionOf(now, id)));
    })
    .toEqual(ids.map((id) => plain(sessionOf(before, id))));
}

// The free space below the last window, from the trailing block's top to the
// bottom of the pane's content box.
const freeBelowLastWindow = async (page: Page) =>
  (await paneInnerBottom(page)) - (await boxOf(trailingBlock(page))).y;

// S8, a two-window session that fits the tab view's detail pane (side by
// side) with the free space `free(row)` below its last window: fa holding f0
// -- not the last window, so a drag of f0 has no overshoot slack below it --
// and fb as many tabs as leave less than a row free; then the viewport's
// height is set so the free space is what was asked for. The tab view, not
// the popup: its pane follows the viewport, the popup's does not. Returns
// the page, showing S8, and a tab row's height.
async function openTightFit(
  context: BrowserContext,
  extensionId: string,
  free: (row: number) => number,
  others: tabContainerData[] = [S2()]
): Promise<{ page: Page; row: number }> {
  // The pane's inner height and a row's, from the usual session.
  const probe = await openTabView(context, extensionId, false);
  const sizes = await probe.evaluate(() => {
    let el = document.querySelector(
      '[data-pane="detail"] [data-drop-window-id]'
    )?.parentElement;
    while (el && !['auto', 'scroll'].includes(getComputedStyle(el).overflowY))
      el = el.parentElement;
    const row = document
      .querySelector('[data-drag-row-id="a0"]')
      ?.getBoundingClientRect().height;
    return { pane: el?.clientHeight ?? 0, row: row ?? 0 };
  });
  await probe.close();
  // Each window: its header, its tabs and its 8px margin, all rows.
  const m = Math.floor((sizes.pane - 16) / sizes.row) - 3;
  const fits = session('S8', 'Fits', [
    win('fa', [tab('f0')]),
    win(
      'fb',
      Array.from({ length: m }, (_, i) => tab(`g${i}`))
    ),
  ]);
  const page = await openTabView(context, extensionId, false, [
    S1(),
    fits,
    ...others,
  ]);
  await sessionRow(page, 'S8').click();
  await expect(page.locator('[data-drag-row-id="fa"]')).toBeVisible();
  const want = free(sizes.row);
  const now = await freeBelowLastWindow(page);
  await page.setViewportSize({
    width: TAB_VIEW.width,
    height: TAB_VIEW.height + Math.round(want - now),
  });
  await settled(page);
  // PREMISE: the free space asked for, and the list fits.
  expect(await freeBelowLastWindow(page)).toBeCloseTo(want, 0);
  expect(await scrollRange(page)).toBeLessThanOrEqual(0);
  return { page, row: sizes.row };
}

test.describe('below the last window makes a new last window (KAN-366)', () => {
  // An ordinary drag in S1, let go below w2 (the last window), past every
  // row's slack: lit, no slot, its own window closes up with no outline
  // (KAN-378 C), and the release makes a new LAST window -- one move, one
  // ⌘Z.
  const ordinary = [
    {
      name: 'loose tab a1',
      rowId: 'a1',
      kind: 'tab',
      closesUp: ['a2', 'al0', 'al1'],
      still: ['a0', 'w2', 'b0', 'b1'],
      sourceLast: 'al1',
      after: ['a0 a2 al0* al1*', 'b0 b1', 'a1'],
      newEntries: [],
    },
    {
      name: 'group member al0',
      rowId: 'al0',
      kind: 'tab',
      closesUp: ['al1'],
      still: ['a0', 'a1', 'a2', 'w2', 'b0', 'b1'],
      sourceLast: 'al1',
      after: ['a0 a1 a2 al1*', 'b0 b1', 'al0'],
      newEntries: [],
    },
    {
      name: 'b1, the last window’s loose tab, past its slack',
      rowId: 'b1',
      kind: 'tab',
      closesUp: [],
      still: ['a0', 'a1', 'a2', 'al0', 'al1', 'w2', 'b0'],
      sourceLast: 'b1',
      after: [W1_START, 'b0', 'b1'],
      newEntries: [],
    },
    {
      name: 'group Alpha',
      rowId: 'group:alpha',
      kind: 'group',
      closesUp: [],
      still: ['a0', 'a1', 'a2', 'w2', 'b0', 'b1'],
      sourceLast: 'group:alpha',
      after: ['a0 a1 a2', 'b0 b1', 'al0* al1*'],
      newEntries: ['alpha'],
    },
  ] as const;
  for (const view of ['popup', 'tab view'] as const) {
    for (const c of ordinary) {
      test(`${view}: an ordinary drag of ${c.name}, held below the list: lit, no slot, its window closes up with no outline; let go, a new last window holds it, and one ⌘Z undoes it`, async ({
        context,
        extensionId,
      }) => {
        const page =
          view === 'popup'
            ? await openPopup(context, extensionId)
            : await openTabView(context, extensionId, false);
        const before = await stored(page);
        const rowH = await heightOf(tabHandle(page, 'a0'));
        const y = await belowTheList(page, 'w2');
        const at = await pickUp(
          page,
          c.kind === 'tab'
            ? tabHandle(page, c.rowId)
            : groupHandle(page, 'alpha')
        );
        await settled(page);
        // At its own place: the rows as the drag measured them.
        const own = await ownBox(page, dragRow(c.rowId));
        const was: Record<string, { top: number; bottom: number }> = {};
        for (const id of [...c.closesUp, ...c.still, c.sourceLast]) {
          was[id] = id === c.rowId ? own : await drawnBox(page, id);
        }
        // PREMISE: below the held row's own slack -- half its height past
        // the last row of its window -- so no overshoot can answer for it.
        const lastOfOwn = was[c.sourceLast]?.bottom ?? NaN;
        expect(y).toBeGreaterThan(lastOfOwn + (own.bottom - own.top) / 2);

        await page.mouse.move(at.x, y, { steps: 8 });
        await settled(page);
        await expect(page.locator('[data-drag-landing-slot]')).toHaveCount(0);
        expect(await trailingLit(page)).toBe(true);
        expectLitBox(await litBoxOf(page, 'w2'), rowH);
        // Its window closes up behind it: every row below it, by its room.
        const room = (was[c.closesUp[0] ?? ''] ?? own).top - own.top;
        for (const id of c.closesUp) {
          const now = await drawnBox(page, id);
          expect(now.top).toBeCloseTo((was[id]?.top ?? NaN) - room, 0);
        }
        // Nothing else moves.
        for (const id of c.still) {
          expect(await drawnBox(page, id)).toEqual(was[id]);
        }
        // No outline while the target is lit (KAN-378 C).
        await expect(page.locator('[data-drag-source-room]')).toHaveCount(0);
        await page.mouse.up();

        await expect.poll(() => layout(page, 'S1')).toEqual([...c.after]);
        expect(await windowIdsOf(page, 'S1')).toEqual(['w1', 'w2', 'new']);
        expect(await groupEntries(page, 'S1', 2)).toEqual([...c.newEntries]);
        const after = await stored(page);
        for (const id of ['S2', 'S3', 'S4']) {
          expect(sessionOf(after, id)).toEqual(sessionOf(before, id));
        }
        expect(await toasts(page)).toEqual([]);
        await settled(page);
        expect(await trailingLit(page)).toBe(false);

        await expectOneUndoRestores(page, sessionOf(before, 'S1'));
      });
    }
  }

  // A carried tab or group, let go below the last window of the session on
  // screen: its own (Q2 A), or Target after a spring-open. Lit, no slot;
  // let go, a new last window there holds it, and one ⌘Z undoes the move.
  const carried = [
    {
      kind: 'tab',
      phantom: 'carried:a1',
      moved: 'a1',
      sourceAfter: ['a0 a2 al0* al1*', 'b0 b1'],
    },
    {
      kind: 'group',
      phantom: 'group:carried:alpha',
      moved: 'al0* al1*',
      sourceAfter: ['a0 a1 a2', 'b0 b1'],
    },
  ] as const;
  for (const k of carried) {
    for (const into of ['its own session', 'Target'] as const) {
      test(`a carried ${k.kind} let go below the last window of ${into}: lit, no slot; a new last window there holds it, and one ⌘Z undoes it`, async ({
        context,
        extensionId,
      }) => {
        const page = await openPopup(context, extensionId);
        const before = await stored(page);
        const rowH = await heightOf(tabHandle(page, 'a0'));
        const at = await pickUp(
          page,
          k.kind === 'tab' ? tabHandle(page, 'a1') : groupHandle(page, 'alpha')
        );
        await carryOutLeft(page, at);
        if (into === 'Target') await springOpen(page, 'S2');
        const last = into === 'Target' ? 'd2' : 'w2';
        const pane = await detailPane(page);
        // Low in the pane, past the phantom's own slack -- half its height
        // below it, where its own window (the trailing block) would answer
        // anyway -- so it is the rule below the last window that answers.
        const y = pane.bottom - 10;
        const phantom = await boxOf(
          page.locator(`[data-drag-row-id="${k.phantom}"]`)
        );
        expect(y).toBeGreaterThan(
          phantom.y + phantom.height + phantom.height / 2
        );
        // Straight into the pane below the list: adopted there.
        await page.mouse.move(pane.left + 100, y, { steps: 8 });
        await expect(
          page.locator(`[data-drag-row-id="${k.phantom}"]`)
        ).toHaveAttribute('data-drag-held', '');
        await settled(page);
        // Read here and asserted after the release, so what the release did
        // is the first thing checked.
        const there = {
          lit: await trailingLit(page),
          slots: await page.locator('[data-drag-landing-slot]').count(),
        };
        const box = await litBoxOf(page, last);
        await page.mouse.up();

        const sourceAfter = [...k.sourceAfter];
        if (into === 'Target') {
          await expect
            .poll(() => layout(page, 'S2'))
            .toEqual([D1_START, 'e0 e1', k.moved]);
          expect(await windowIdsOf(page, 'S2')).toEqual(['d1', 'd2', 'new']);
          expect(await layout(page, 'S1')).toEqual(sourceAfter);
        } else {
          await expect
            .poll(() => layout(page, 'S1'))
            .toEqual([...sourceAfter, k.moved]);
          expect(await windowIdsOf(page, 'S1')).toEqual(['w1', 'w2', 'new']);
        }
        expect(there).toEqual({ lit: true, slots: 0 });
        expectLitBox(box, rowH);
        // Every other session as it was, but which one is selected: the
        // spring-open selected Target.
        const after = await stored(page);
        const others = into === 'Target' ? ['S3', 'S4'] : ['S2', 'S3', 'S4'];
        for (const id of others) {
          expect({ ...sessionOf(after, id), isSelected: undefined }).toEqual({
            ...sessionOf(before, id),
            isSelected: undefined,
          });
        }
        expect(await toasts(page)).toEqual([]);
        await expect(page.locator(CARD)).toHaveCount(0);

        await expectOneUndoRestoresAll(
          page,
          before,
          into === 'Target' ? ['S1', 'S2'] : ['S1']
        );
      });
    }
  }

  // An adopted carry let go at its phantom's own place: the trailing block
  // is the phantom's window, so that is a new last window too -- of Target,
  // or of the item's own session, where it is a move to the end.
  for (const k of carried) {
    for (const into of ['its own session', 'Target'] as const) {
      test(`a carried ${k.kind} let go at its phantom's own place in ${into}: lit, no slot, a new last window there`, async ({
        context,
        extensionId,
      }) => {
        const page = await openPopup(context, extensionId);
        const before = await stored(page);
        const at = await pickUp(
          page,
          k.kind === 'tab' ? tabHandle(page, 'a1') : groupHandle(page, 'alpha')
        );
        await carryOutLeft(page, at);
        if (into === 'Target') await springOpen(page, 'S2');
        await ontoOwnPhantom(page, k.phantom);
        await settled(page);
        // Read here, asserted after the release, so what the release did is
        // the first thing checked: where it was let go, and what was shown.
        const there = await page.evaluate((id) => {
          const ph = document.querySelector(`[data-drag-row-id="${id}"]`);
          const home = document.querySelector(
            '[data-new-window-target="last"]'
          );
          return {
            held: ph?.hasAttribute('data-drag-held') ?? false,
            inTrailingBlock: home !== null && ph !== null && home.contains(ph),
            lit: home?.hasAttribute('data-landing') ?? false,
            slots: [...document.querySelectorAll('[data-drag-landing-slot]')]
              .length,
          };
        }, k.phantom);
        await page.mouse.up();

        if (into === 'Target') {
          await expect
            .poll(() => layout(page, 'S2'))
            .toEqual([D1_START, 'e0 e1', k.moved]);
          expect(await windowIdsOf(page, 'S2')).toEqual(['d1', 'd2', 'new']);
          expect(await layout(page, 'S1')).toEqual([...k.sourceAfter]);
        } else {
          await expect
            .poll(() => layout(page, 'S1'))
            .toEqual([...k.sourceAfter, k.moved]);
          expect(await windowIdsOf(page, 'S1')).toEqual(['w1', 'w2', 'new']);
        }
        await expect(page.locator(CARD)).toHaveCount(0);
        expect(await toasts(page)).toEqual([]);
        expect(there).toEqual({
          held: true,
          inTrailingBlock: true,
          lit: true,
          slots: 0,
        });
        await expectOneUndoRestoresAll(
          page,
          before,
          into === 'Target' ? ['S1', 'S2'] : ['S1']
        );
      });
    }
  }

  // The worst path for the move: the sole tab of the session's last window.
  // A new last window holding it would stand where that window stands,
  // holding exactly what it holds: no move, and nothing is written. The
  // session has a window before it, so the last window is not also the
  // first: a drop routed as a new FIRST window would be a move, and this
  // test would see it.
  test('the sole tab of the last window, let go below the list: lit, and no move', async ({
    context,
    extensionId,
  }) => {
    const soleTab = session('S6', 'Sole tab', [
      win('s0', [tab('st0'), tab('st1')]),
      win('s1', [tab('st2')]),
    ]);
    const page = await openPopup(context, extensionId, [S1(), soleTab], 'S6');
    const before = await stored(page);
    const y = await belowTheList(page, 's1');
    const at = await pickUp(page, tabHandle(page, 'st2'));
    await page.mouse.move(at.x, y, { steps: 8 });
    await settled(page);
    // PREMISE: it would land in the trailing block.
    expect(await trailingLit(page)).toBe(true);
    await page.mouse.up();
    // NEGATIVE, so a fixed wait: a move is written on the release.
    await page.waitForTimeout(200);
    expect(sessionOf(await stored(page), 'S6')).toEqual(
      sessionOf(before, 'S6')
    );
    expect(await toasts(page)).toEqual([]);
    await settled(page);
    expect(await trailingLit(page)).toBe(false);
  });

  // The same for a GROUP that is all of the session's LAST window, after
  // another: the new last window would stand where it stands, holding
  // exactly its tabs and entry. Placed first, it would be a move.
  test('the sole group of the last window, let go below the list: lit, and no move', async ({
    context,
    extensionId,
  }) => {
    const grouped = session('S5', 'Grouped', [
      win('g0', [tab('gt0')]),
      win(
        'g1',
        [tab('gx0', 'gg'), tab('gx1', 'gg')],
        [{ groupId: 'gg', title: 'GG', color: 'red' }]
      ),
    ]);
    const page = await openPopup(context, extensionId, [S1(), grouped], 'S5');
    const before = await stored(page);
    const y = await belowTheList(page, 'g1');
    const at = await pickUp(page, groupHandle(page, 'gg'));
    await page.mouse.move(at.x, y, { steps: 8 });
    await settled(page);
    // PREMISE: it would land in the trailing block.
    expect(await trailingLit(page)).toBe(true);
    await page.mouse.up();
    // NEGATIVE, so a fixed wait: a move is written on the release.
    await page.waitForTimeout(200);
    expect(sessionOf(await stored(page), 'S5')).toEqual(
      sessionOf(before, 'S5')
    );
    expect(await toasts(page)).toEqual([]);
    await settled(page);
    expect(await trailingLit(page)).toBe(false);
  });

  // The whole empty space counts, not only the lit box's row: let go near
  // the pane's bottom, far below the box.
  test('a release near the pane’s bottom is a new last window too', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId);
    const pane = await detailPane(page);
    const at = await pickUp(page, tabHandle(page, 'a1'));
    const y = pane.bottom - 6;
    await page.mouse.move(at.x, y, { steps: 8 });
    await settled(page);
    expect(await trailingLit(page)).toBe(true);
    // PREMISE: far below the lit box.
    const box = await boxOf(trailingBlock(page));
    expect(y).toBeGreaterThan(box.y + box.height + 20);
    await page.mouse.up();

    await expect
      .poll(() => layout(page, 'S1'))
      .toEqual(['a0 a2 al0* al1*', 'b0 b1', 'a1']);
    expect(await windowIdsOf(page, 'S1')).toEqual(['w1', 'w2', 'new']);
  });

  // Q4. A full list scrolled to its end: held at the bottom edge, the list
  // scrolls into the trailing block's row of room, and let go there the
  // tab is a new last window.
  test('a 6×4 list scrolled to its end: the room row is reached, lit, and makes a new last window', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(
      context,
      extensionId,
      [sixByFour('S6', 'Six', 's'), S2()],
      'S6'
    );
    const before = await stored(page);
    const rowH = await heightOf(tabHandle(page, 's0-0'));
    await setDetailScroll(page, 1e6);
    await settled(page);
    const pane = await detailPane(page);
    // A tab of a window that is not the last: no overshoot slack applies.
    const at = await pickUp(page, tabHandle(page, 's4-1'));
    await intoTheRoom(page, at.x, pane);
    expect(await trailingLit(page)).toBe(true);
    await expect(page.locator('[data-drag-landing-slot]')).toHaveCount(0);
    expectLitBox(await litBoxOf(page, 'sw5'), rowH);
    await page.mouse.up();

    await expect.poll(async () => (await layout(page, 'S6')).length).toBe(7);
    const s6 = await layout(page, 'S6');
    expect(s6[4]).toBe('s4-0 s4-2 s4-3');
    expect(s6[6]).toBe('s4-1');
    await expectOneUndoRestores(page, sessionOf(before, 'S6'));
  });

  // The space begins at the last window's bottom, not the block's top: the
  // 8px between them is no band where a row of another window is refused
  // and its slot snaps home (KAN-185's defect, one gap further down).
  test('a1, from w1, let go between the last window and the trailing block: lit, no slot, a new last window', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId);
    const w2 = await boxOf(page.locator('[data-drop-window-id="w2"]'));
    const top =
      (await trailingBlock(page).count()) === 0
        ? NaN
        : (await boxOf(trailingBlock(page))).y;
    const y = w2.y + w2.height + 4;
    const at = await pickUp(page, tabHandle(page, 'a1'));
    await page.mouse.move(at.x, y, { steps: 8 });
    await settled(page);
    expect(await trailingLit(page)).toBe(true);
    // No slot at home, nor anywhere.
    await expect(page.locator('[data-drag-landing-slot]')).toHaveCount(0);
    await page.mouse.up();

    await expect
      .poll(() => layout(page, 'S1'))
      .toEqual(['a0 a2 al0* al1*', 'b0 b1', 'a1']);
    expect(await windowIdsOf(page, 'S1')).toEqual(['w1', 'w2', 'new']);
    // PREMISE: between the last window's bottom and the trailing block's
    // top.
    expect(y).toBeLessThan(top);
  });

  // CONTROL for the one above: a row of the last window at that same point
  // is within its overshoot slack, and lands last in its own window.
  test('b0, of w2, let go at the same point: lands last in w2 through its slack', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId);
    const w2 = await boxOf(page.locator('[data-drop-window-id="w2"]'));
    const y = w2.y + w2.height + 4;
    const at = await pickUp(page, tabHandle(page, 'b0'));
    await page.mouse.move(at.x, y, { steps: 8 });
    await settled(page);
    expect(await trailingLit(page)).toBe(false);
    await expect(page.locator('[data-drag-landing-slot]')).toHaveCount(1);
    await page.mouse.up();

    await expect.poll(() => layout(page, 'S1')).toEqual([W1_START, 'b1 b0']);
    expect(await windowIdsOf(page, 'S1')).toEqual(['w1', 'w2']);
  });

  // R2 (Justine's alternative pick, 2026-10-01). In a list that fits with
  // less than a row free below its last window, the lit box is still a full
  // row: the list scrolls a little while it is lit, and no row moves. Frame
  // by frame, from the pick-up into the space.
  test('a list that fits with less than a row free: lit, the box is a full row, the list scrolls a little, and no row moves', async ({
    context,
    extensionId,
  }) => {
    // Free: a row less 4px -- under a row, over the half row a new window
    // needs (KAN-366 ruling).
    const { page, row } = await openTightFit(
      context,
      extensionId,
      (r) => r - 4
    );
    const top = (await boxOf(trailingBlock(page))).y;
    const inner = await paneInnerBottom(page);
    const free = inner - top;
    const fb = await boxOf(page.locator('[data-drop-window-id="fb"]'));
    // PREMISE: it fits, with less than a row free.
    expect(await scrollRange(page)).toBeLessThanOrEqual(0);
    expect(free).toBeGreaterThan(0);
    expect(free).toBeLessThan(row);
    // As low as the held row -- drawn at the pointer, its box carried by a
    // transform -- still ends inside the pane: then the only thing that
    // could reach past it is the lit box. PREMISE: below the last window.
    const y = inner - row / 2 - 1;
    expect(y).toBeGreaterThan(fb.y + fb.height);

    await startLitLog(page);
    const at = await pickUp(page, tabHandle(page, 'f0'));
    await page.mouse.move(at.x, y, { steps: 8 });
    await settled(page);
    await markLitLogSettled(page);
    const log = await stopLitLog(page);
    // A row and its borders: 1.5px draws as 1px at DPR 1, so 34 for a 32 row.
    expectFullRowLog(log, row + 2, free);
    await page.keyboard.press('Escape');
    await page.mouse.up();
  });

  // The space ends at the pane's bottom: below it, where nothing of the list
  // is drawn, a release is refused as it always was.
  test('a release below the pane, though below the last window, is refused', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId);
    const pane = await detailPane(page);
    const home = await boxOf(tabHandle(page, 'a1'));
    const at = await pickUp(page, tabHandle(page, 'a1'));
    // CONTROL: just inside the pane's bottom, lit.
    await page.mouse.move(at.x, pane.bottom - 4, { steps: 8 });
    await settled(page);
    expect(await trailingLit(page)).toBe(true);

    const y = pane.bottom + 4;
    // PREMISE: below the pane, still in the popup.
    expect(y).toBeLessThan(POPUP.height);
    await page.mouse.move(at.x, y, { steps: 4 });
    await settled(page);
    expect(await trailingLit(page)).toBe(false);
    // Refused: the slot is back at a1's own place.
    await expect(page.locator('[data-drag-landing-slot]')).toHaveCount(1);
    const slot = await boxOf(page.locator('[data-drag-landing-slot]'));
    expect(Math.abs(slot.y - home.y)).toBeLessThanOrEqual(1);
    await page.mouse.up();
    // NEGATIVE, so a fixed wait: a move is written on the release.
    await page.waitForTimeout(200);
    expect(await layout(page, 'S1')).toEqual([W1_START, 'b0 b1']);
    expect(await windowIdsOf(page, 'S1')).toEqual(['w1', 'w2']);
  });

  // KAN-366 ruling: in a list that fits, the space below the last window is
  // a new window only with at least half a row free below it -- the held
  // row's half, the overshoot slack's own measure. With less, the lit box
  // would be a sliver nobody sees, so the release is refused as on main.
  // Both sides set from the real free space: the threshold, derived from
  // f0's height, less or plus 2px.
  for (const side of ['under', 'over'] as const) {
    test(
      side === 'under'
        ? 'a list that fits with half a row free less 2px: refused, nothing lit, nothing moves'
        : 'a list that fits with half a row free plus 2px: lit, a new last window',
      async ({ context, extensionId }) => {
        const { page, row } = await openTightFit(context, extensionId, (r) =>
          side === 'under' ? r / 2 - 2 : r / 2 + 2
        );
        const half = (await boxOf(tabHandle(page, 'f0'))).height / 2;
        // PREMISE: the threshold is the held row's half, and the free space
        // is 2px to its side.
        expect(half).toBeCloseTo(row / 2, 0);
        const free = await freeBelowLastWindow(page);
        expect(free).toBeCloseTo(side === 'under' ? half - 2 : half + 2, 0);
        const before = await stored(page);
        const home = await boxOf(tabHandle(page, 'f0'));
        const fb = await boxOf(page.locator('[data-drop-window-id="fb"]'));
        // Below the last window, inside the pane.
        const y = fb.y + fb.height + 4;
        expect(y).toBeLessThan(await paneInnerBottom(page));
        const at = await pickUp(page, tabHandle(page, 'f0'));
        await page.mouse.move(at.x, y, { steps: 8 });
        await settled(page);
        expect(await trailingLit(page)).toBe(side === 'over');
        await expect(page.locator('[data-drag-landing-slot]')).toHaveCount(
          side === 'over' ? 0 : 1
        );
        if (side === 'under') {
          // Refused: the slot is back at f0's own place.
          const slot = await boxOf(page.locator('[data-drag-landing-slot]'));
          expect(Math.abs(slot.y - home.y)).toBeLessThanOrEqual(1);
        }
        await page.mouse.up();

        if (side === 'under') {
          // NEGATIVE, so a fixed wait: a move is written on the release.
          await page.waitForTimeout(200);
          expect(sessionOf(await stored(page), 'S8')).toEqual(
            sessionOf(before, 'S8')
          );
        } else {
          await expect
            .poll(async () => (await layout(page, 'S8')).slice(-1))
            .toEqual(['f0']);
          expect(
            (await layout(page, 'S8')).filter((w) =>
              w.split(' ').includes('f0')
            )
          ).toHaveLength(1);
        }
      }
    );
  }

  // R2 for an adopted carry: a fitting session whose free space below its
  // last window is the phantom's row and a pixel, so lit, its borders reach
  // past the pane. Lit, the box is a full row, the list scrolls a little,
  // and no row moves.
  test('a carry adopted in a session that fits with a row and a pixel free: lit, the box is a full row, the list scrolls a little, and no row moves', async ({
    context,
    extensionId,
  }) => {
    const { page, row } = await openTightFit(
      context,
      extensionId,
      (r) => r + 1
    );
    const free = await freeBelowLastWindow(page);
    // Back to S1, and carry a1 from there into S8.
    await sessionRow(page, 'S1').click();
    await expect(page.locator('[data-drag-row-id="w1"]')).toBeVisible();
    const at = await pickUp(page, tabHandle(page, 'a1'));
    await carryOutLeft(page, at);
    await springOpen(page, 'S8');
    await expect(tabHandle(page, 'carried:a1')).toBeAttached();
    await settled(page);
    // PREMISE: the phantom rests in the free space, and the list still fits.
    expect(await scrollRange(page)).toBeLessThanOrEqual(0);
    expect(free).toBeGreaterThan(row);

    await startLitLog(page);
    // In at the phantom's own height, straight across from the session list.
    const own = await boxOf(tabHandle(page, 'carried:a1'));
    const y = own.y + own.height / 2;
    const list = await boxOf(page.locator('[data-pane="sessions"]'));
    const pane = await detailPane(page);
    await page.mouse.move(list.x + list.width - 30, y, { steps: 3 });
    await page.mouse.move(pane.left + 60, y, { steps: 6 });
    await expect(tabHandle(page, 'carried:a1')).toHaveAttribute(
      'data-drag-held',
      ''
    );
    await settled(page);
    await markLitLogSettled(page);
    const log = await stopLitLog(page);
    // A row and its borders: 1.5px draws as 1px at DPR 1, so 34 for a 32 row.
    expectFullRowLog(log, row + 2, free);
    await page.keyboard.press('Escape');
    await page.mouse.up();
  });

  // NEGATIVES, aimed where the trailing block's rule would fire.

  // "Drag it to the end" keeps priority (KAN-132's slack): a row of the LAST
  // window let go within half its height past that window's last row lands
  // last in its own window, though the point is inside the trailing block's
  // space. Just past the slack it is a new window. Both sides measured from
  // the slack, read at rest.
  const slack = [
    { held: 'b1', inside: [W1_START, 'b0 b1'], past: [W1_START, 'b0', 'b1'] },
    { held: 'b0', inside: [W1_START, 'b1 b0'], past: [W1_START, 'b1', 'b0'] },
  ] as const;
  for (const s of slack) {
    for (const side of ['inside', 'past'] as const) {
      test(`${s.held}, the last window’s, let go ${
        side === 'inside' ? '6px inside' : '2px past'
      } its overshoot slack: ${
        side === 'inside' ? 'lands last in w2' : 'a new last window'
      }`, async ({ context, extensionId }) => {
        const page = await openPopup(context, extensionId);
        const b1 = await boxOf(tabHandle(page, 'b1'));
        const held = await boxOf(tabHandle(page, s.held));
        const w2 = await boxOf(page.locator('[data-drop-window-id="w2"]'));
        // The slack's edge: half the held row past w2's last row, b1.
        const edge = b1.y + b1.height + held.height / 2;
        const y = side === 'inside' ? edge - 6 : edge + 2;
        const at = await pickUp(page, tabHandle(page, s.held));
        await page.mouse.move(at.x, y, { steps: 8 });
        await settled(page);
        expect(await trailingLit(page)).toBe(side === 'past');
        await expect(page.locator('[data-drag-landing-slot]')).toHaveCount(
          side === 'past' ? 0 : 1
        );
        await page.mouse.up();

        const want = side === 'inside' ? s.inside : s.past;
        await expect.poll(() => layout(page, 'S1')).toEqual([...want]);
        expect(await windowIdsOf(page, 'S1')).toEqual(
          side === 'inside' ? ['w1', 'w2'] : ['w1', 'w2', 'new']
        );
        // PREMISE: below the last window, w2, where the new last window's
        // space begins and a release from any other window makes one.
        expect(y).toBeGreaterThan(w2.y + w2.height);
      });
    }
  }

  // A row of ANOTHER window has no slack there: the same point inside b1's
  // slack is a new window for a1.
  test('a1, from w1, let go at the same point inside w2’s slack: a new last window', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId);
    const b1 = await boxOf(tabHandle(page, 'b1'));
    const y = b1.y + b1.height + b1.height / 2 - 6;
    const at = await pickUp(page, tabHandle(page, 'a1'));
    await page.mouse.move(at.x, y, { steps: 8 });
    await settled(page);
    expect(await trailingLit(page)).toBe(true);
    await page.mouse.up();

    await expect
      .poll(() => layout(page, 'S1'))
      .toEqual(['a0 a2 al0* al1*', 'b0 b1', 'a1']);
  });

  // KAN-185: the gap BETWEEN two windows goes to the nearer one. Only below
  // the last window is the trailing block's.
  test('b0 let go in the gap between w1 and w2, nearer w1, lands at w1’s end as it always has', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId);
    const w1 = await boxOf(page.locator('[data-drop-window-id="w1"]'));
    const w2 = await boxOf(page.locator('[data-drop-window-id="w2"]'));
    const y = w1.y + w1.height + 2;
    // PREMISE: in the gap, nearer w1.
    expect(y).toBeLessThan(w2.y);
    expect(y - (w1.y + w1.height)).toBeLessThan(w2.y - y);
    const at = await pickUp(page, tabHandle(page, 'b0'));
    await page.mouse.move(at.x, y, { steps: 8 });
    await settled(page);
    expect(await trailingLit(page)).toBe(false);
    await page.mouse.up();

    await expect
      .poll(() => layout(page, 'S1'))
      .toEqual([`${W1_START} b0`, 'b1']);
    expect(await windowIdsOf(page, 'S1')).toEqual(['w1', 'w2']);
  });

  test('a release beside the pane, below the list, is refused', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId);
    const y = await belowTheList(page, 'w2');
    const pane = await detailPane(page);
    const at = await pickUp(page, tabHandle(page, 'a1'));
    // CONTROL: inside the pane at that height, lit.
    await page.mouse.move(at.x, y, { steps: 8 });
    await settled(page);
    expect(await trailingLit(page)).toBe(true);

    const x = pane.right + 4;
    // PREMISE: beside the pane, and still in the popup.
    expect(x).toBeLessThan(POPUP.width);
    await page.mouse.move(x, y, { steps: 4 });
    await settled(page);
    expect(await trailingLit(page)).toBe(false);
    // Refused: the slot is back at a1's own place.
    await expect(page.locator('[data-drag-landing-slot]')).toHaveCount(1);
    await page.mouse.up();
    // NEGATIVE, so a fixed wait: a move is written on the release.
    await page.waitForTimeout(200);
    expect(await layout(page, 'S1')).toEqual([W1_START, 'b0 b1']);
    expect(await windowIdsOf(page, 'S1')).toEqual(['w1', 'w2']);
  });

  test('a window let go below the list still lands last, and nothing is lit', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId);
    const y = await belowTheList(page, 'w2');
    // CONTROL: a tab held there lights the trailing block.
    await pickUp(page, tabHandle(page, 'a1'));
    await page.mouse.move(400, y, { steps: 8 });
    await settled(page);
    expect(await trailingLit(page)).toBe(true);
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await settled(page);
    expect(await trailingLit(page)).toBe(false);

    const at = await pickUp(page, windowHandle(page, 'w1'));
    await page.mouse.move(at.x, y, { steps: 8 });
    await settled(page);
    expect(await trailingLit(page)).toBe(false);
    await page.mouse.up();

    await expect.poll(() => windowIdsOf(page, 'S1')).toEqual(['w2', 'w1']);
  });
});

// The trailing block's row of room follows the session a carry SHOWS, not
// the one it came from (KAN-366 Q4, ruling 1): each session decides from its
// own overflow at rest, before the pointer can come in.
test.describe('a carry’s room follows the session it shows (KAN-366 Q4)', () => {
  test('from a list that scrolls into one that fits: no room there, and no scroll range', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(
      context,
      extensionId,
      [sixByFour('S6', 'Six', 's'), S1(), S2()],
      'S6'
    );
    await setDetailScroll(page, 1e6);
    await settled(page);
    // Mid-pane at the list's end, clear of both auto-scroll bands.
    const at = await pickUp(page, tabHandle(page, 's4-1'));
    // PREMISE: the drag's own list scrolls, so it took its room.
    expect(await newWindowMarker(page)).toBe('room');
    await carryOutLeft(page, at);
    await springOpen(page, 'S1');
    const phantom = tabHandle(page, 'carried:s4-1');
    await expect(phantom).toBeAttached();
    const rowH = await heightOf(tabHandle(page, 'a0'));

    expect(await newWindowMarker(page)).toBe('');
    // The trailing block is the phantom's row and no more: no border.
    expect(await heightOf(trailingBlock(page))).toBe(rowH);
    expect((await newWindowBox(page, 'last'))?.borderWidth).toBe(0);
    expect(await scrollRange(page)).toBeLessThanOrEqual(0);
    await page.keyboard.press('Escape');
    await page.mouse.up();
  });

  test('from a list that fits into one that scrolls: the room there, decided before the pointer comes in, and nothing moves as it does', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId, [
      S1(),
      sixByFour('S6', 'Six', 's'),
      S2(),
    ]);
    const at = await pickUp(page, tabHandle(page, 'a1'));
    // PREMISE: the drag's own list fits, so it took no room.
    expect(await newWindowMarker(page)).toBe('');
    await carryOutLeft(page, at);
    await springOpen(page, 'S6');
    const phantom = tabHandle(page, 'carried:a1');
    await expect(phantom).toBeAttached();
    const rowH = await heightOf(tabHandle(page, 's0-0'));
    expect(await newWindowMarker(page)).toBe('room');
    // The phantom's row and the room's borders.
    const roomH = await heightOf(trailingBlock(page));
    const border = (await newWindowBox(page, 'last'))?.borderWidth ?? NaN;
    expect(border).toBeGreaterThan(0);
    expect(roomH).toBeCloseTo(rowH + 2 * border, 0);

    // Into the list at the phantom's own height, straight across from the
    // session list, with the pane at its end: nothing moves as the list
    // adopts the carry.
    await setDetailScroll(page, 1e6);
    await settled(page);
    const own = await boxOf(phantom);
    const y = own.y + own.height / 2;
    const list = await boxOf(page.locator('[data-pane="sessions"]'));
    const pane = await detailPane(page);
    await page.mouse.move(list.x + list.width - 30, y, { steps: 3 });
    await logPane(page, []);
    await page.mouse.move(pane.left + 60, y, { steps: 6 });
    await expect(phantom).toHaveAttribute('data-drag-held', '');
    await settled(page);
    const frames = await paneLog(page);
    // PREMISE: logged before and after the adoption.
    expect(frames.some((f) => !f.adopted)).toBe(true);
    expect(frames.some((f) => f.adopted)).toBe(true);
    expect(Object.keys(frames[0]?.rows ?? {}).length).toBeGreaterThan(20);
    expect(rowsThatMoved(frames)).toEqual([]);
    expect(new Set(frames.map((f) => f.trailing))).toEqual(new Set([roomH]));
    await page.keyboard.press('Escape');
    await page.mouse.up();
  });

  // Decided in the commit that draws the session: from the first frame the
  // spring-opened session is painted in, no row of it moves and its
  // trailing block keeps one height -- the room is there before the pointer
  // can come in, not a frame later.
  test('across the spring-open, from the first frame the session is drawn: no row moves and the trailing block keeps its height', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId, [
      S1(),
      sixByFour('S6', 'Six', 's'),
      S2(),
    ]);
    const at = await pickUp(page, tabHandle(page, 'a1'));
    await carryOutLeft(page, at);
    await logPane(page, []);
    await springOpen(page, 'S6');
    await settled(page);
    // Some frames of the opened session at rest.
    await page.waitForTimeout(250);
    const frames = await paneLog(page);
    const first = frames.findIndex((f) => 's0-0' in f.rows);
    const shown = frames.slice(first);
    // PREMISE: logged before the spring-open, and for a while after it.
    expect(first).toBeGreaterThan(0);
    expect(shown.length).toBeGreaterThan(10);
    expect(Object.keys(shown[0]?.rows ?? {}).length).toBeGreaterThan(20);
    expect(rowsThatMoved(shown)).toEqual([]);
    // One height, and it is the room's: S6 scrolls.
    expect(new Set(shown.map((f) => f.trailing)).size).toBe(1);
    expect(await newWindowMarker(page)).toBe('room');
    await page.keyboard.press('Escape');
    await page.mouse.up();
  });
});

// KAN-378 C. While a New window target is lit, the room the row leaves is
// not outlined: next to the lit box it read as the landing.
test.describe('no room outline while a New window target is lit (KAN-378)', () => {
  const SOLO = () =>
    session('S1', 'Source', [
      win(
        'w1',
        [tab('a0'), tab('a1'), tab('s0', 'solo'), tab('a2')],
        [{ groupId: 'solo', title: 'Solo', color: 'red' }]
      ),
      win('w2', [tab('b0'), tab('b1')]),
    ]);
  const outline = (page: Page) => page.locator('[data-drag-source-room]');

  test('a group’s only tab held below the list: lit, no outline', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId, [SOLO(), S2()]);
    const y = await belowTheList(page, 'w2');
    const at = await pickUp(page, tabHandle(page, 's0'));
    await page.mouse.move(at.x, y, { steps: 10 });
    await settled(page);
    // PREMISE: lit.
    expect(await trailingLit(page)).toBe(true);
    await expect(outline(page)).toHaveCount(0);
    await page.keyboard.press('Escape');
    await page.mouse.up();
  });

  test('CONTROL: held over another window, the outline is drawn', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId, [SOLO(), S2()]);
    const b0 = await boxOf(tabHandle(page, 'b0'));
    const at = await pickUp(page, tabHandle(page, 's0'));
    await page.mouse.move(at.x, b0.y + 4, { steps: 10 });
    await settled(page);
    await expect(outline(page)).toHaveCount(1);
    await page.keyboard.press('Escape');
    await page.mouse.up();
  });
});

// KAN-371 A. A group's only tab, carried out and back into its own session.
test.describe("a group's only tab carried out and back (KAN-371)", () => {
  const SOLO = () =>
    session('S1', 'Source', [
      win(
        'w1',
        [tab('a0'), tab('a1'), tab('s0', 'solo'), tab('a2'), tab('a3')],
        [{ groupId: 'solo', title: 'Solo', color: 'red' }]
      ),
      win('w2', [tab('b0')]),
    ]);
  const band = (page: Page) => page.locator('[data-drag-row-id="group:solo"]');

  async function carryOut(page: Page): Promise<Point> {
    const at = await pickUp(page, tabHandle(page, 's0'));
    await carryOutLeft(page, at);
    return at;
  }

  async function releaseAt(page: Page, x: number, y: number): Promise<void> {
    await page.mouse.move(x, y, { steps: 8 });
    await settled(page);
    await page.mouse.up();
    await settled(page);
  }

  test('released in its band: the group is kept', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId, [SOLO(), S2()]);
    const own = await boxOf(tabHandle(page, 's0'));
    const at = await carryOut(page);
    // The band waits while the tab is away.
    await expect(band(page)).toHaveCount(1);
    await releaseAt(page, at.x, own.y + own.height / 2);
    expect(await layout(page, 'S1')).toEqual(['a0 a1 s0* a2 a3', 'b0']);
    expect(await groupEntries(page, 'S1', 0)).toEqual(['solo']);
  });

  test('CONTROL: released between a2 and a3, it lands loose and the group goes', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId, [SOLO(), S2()]);
    const at = await carryOut(page);
    // Measured as the carry draws the list: untransformed until adopted.
    const a2 = await boxOf(tabHandle(page, 'a2'));
    await releaseAt(page, at.x, a2.y + a2.height - 4);
    expect(await layout(page, 'S1')).toEqual(['a0 a1 a2 s0 a3', 'b0']);
    expect(await groupEntries(page, 'S1', 0)).toEqual([]);
  });
});

// ---- a collapsed window opens under a resting tab or group (KAN-379) --------

const blockOf = (id: string) => `[data-drop-window-id="${id}"]`;
const titleOf = (id: string) =>
  `[data-drop-window-id="${id}"] > [data-window-drag-handle]`;

// Folds a saved window shut with its own chevron, then takes the pointer
// off the rows so no hover is painted.
async function collapseWindow(page: Page, windowId: string): Promise<void> {
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
async function ontoTitle(page: Page, windowId: string, x: number) {
  const t = await boxOf(page.locator(titleOf(windowId)));
  await page.mouse.move(x, t.y + t.height / 2, { steps: 8 });
  return t;
}

// Every write of data-spring-dwell or data-window-collapsed on a window
// block from now on, timestamped when the observer hears it.
interface DwellRecord {
  t: number;
  id: string;
  attr: 'dwell' | 'collapsed';
  on: boolean;
}
const isDwellLog = (x: unknown): x is DwellRecord[] => {
  if (!Array.isArray(x)) return false;
  const items: readonly unknown[] = x;
  return items.every(
    (r) =>
      typeof r === 'object' &&
      r !== null &&
      't' in r &&
      typeof r.t === 'number' &&
      'id' in r &&
      typeof r.id === 'string' &&
      'attr' in r &&
      (r.attr === 'dwell' || r.attr === 'collapsed') &&
      'on' in r &&
      typeof r.on === 'boolean'
  );
};
async function watchDwell(page: Page): Promise<void> {
  await page.evaluate(() => {
    const log: unknown[] = [];
    document.body.dataset.dwellLog = '[]';
    new MutationObserver((records) => {
      const t = performance.now();
      for (const r of records) {
        if (!(r.target instanceof HTMLElement) || r.attributeName === null)
          continue;
        log.push({
          t,
          id: r.target.dataset.dropWindowId ?? '?',
          attr: r.attributeName === 'data-spring-dwell' ? 'dwell' : 'collapsed',
          // Added when it had no old value.
          on: r.oldValue === null,
        });
      }
      document.body.dataset.dwellLog = JSON.stringify(log);
    }).observe(document.body, {
      subtree: true,
      attributes: true,
      attributeOldValue: true,
      attributeFilter: ['data-spring-dwell', 'data-window-collapsed'],
    });
  });
}
async function dwellLog(page: Page): Promise<DwellRecord[]> {
  const raw = await page.evaluate(() => document.body.dataset.dwellLog ?? '');
  const log: unknown = JSON.parse(raw);
  if (!isDwellLog(log)) throw new Error(`not a dwell log: ${raw}`);
  return log;
}
// When `windowId` last started dwelling, and when it was next drawn open.
function dwellToOpen(log: DwellRecord[], windowId: string) {
  const opened = log.findIndex(
    (r) => r.id === windowId && r.attr === 'collapsed' && !r.on
  );
  const started = log
    .slice(0, opened < 0 ? log.length : opened)
    .filter((r) => r.id === windowId && r.attr === 'dwell' && r.on)
    .pop();
  return { started: started?.t, opened: log[opened]?.t };
}

// The title row's animations: the sweep, when one runs.
const sweepsOn = (page: Page, windowId: string) =>
  page.locator(titleOf(windowId)).evaluate((el) =>
    el.getAnimations().map((a) => ({
      name: a instanceof CSSAnimation ? a.animationName : '',
      duration: a.effect?.getTiming().duration,
      currentTime: Number(a.currentTime),
    }))
  );
const playSweep = (page: Page, windowId: string) =>
  page.locator(titleOf(windowId)).evaluate((el) => {
    for (const a of el.getAnimations()) a.play();
  });
const isUnlit = (page: Page, windowId: string) =>
  page.locator(titleOf(windowId)).evaluate((el) => {
    const cs = getComputedStyle(el);
    return {
      dwell: el.parentElement?.hasAttribute('data-spring-dwell') ?? null,
      image: cs.backgroundImage,
      animations: el.getAnimations().length,
    };
  });
const UNLIT = { dwell: false, image: 'none', animations: 0 };

// The pointer to `frac` of the way down `rowId`'s own box: where the drag
// measured it, less the shift the preview has given it.
async function aimAtOwn(
  page: Page,
  x: number,
  rowId: string,
  frac: number
): Promise<{ top: number; bottom: number }> {
  const own = await ownBox(page, dragRow(rowId));
  await page.mouse.move(x, own.top + (own.bottom - own.top) * frac, {
    steps: 8,
  });
  await settled(page);
  return own;
}
// Drawn folded: no rows.
const isFolded = async (page: Page, windowId: string) =>
  (await page.locator(`${blockOf(windowId)} [data-window-tabs]`).count()) === 0;

test.describe('a collapsed window opens under a resting tab or group (KAN-379)', () => {
  const views = [
    {
      view: 'popup',
      open: (context: BrowserContext, extensionId: string) =>
        openPopup(context, extensionId),
    },
    {
      view: 'tab view',
      open: (context: BrowserContext, extensionId: string) =>
        openTabView(context, extensionId, false),
    },
  ] as const;

  for (const v of views) {
    test(`tab a1 rests on collapsed w2's title: the sweep holds the open, and played, w2 opens and a1 lands between b0 and b1 (${v.view})`, async ({
      context,
      extensionId,
    }) => {
      const page = await v.open(context, extensionId);
      await collapseWindow(page, 'w2');
      await watchDwell(page);
      const at = await pickUp(page, tabHandle(page, 'a1'));
      await ontoTitle(page, 'w2', at.x);
      // Held at once, so nothing below races the open.
      await holdSweepAt(page, titleOf('w2'), 0);
      expect(
        await page.locator(`${blockOf('w2')}[data-spring-dwell]`).count()
      ).toBe(1);
      expect(await sweepsOn(page, 'w2')).toEqual([
        { name: expect.any(String), duration: SPRING_OPEN_MS, currentTime: 0 },
      ]);

      // Held a millisecond short of its end for a second: still folded (D1).
      await holdSweepAt(page, titleOf('w2'), SPRING_OPEN_MS - 1);
      await page.waitForTimeout(1000);
      expect(await isFolded(page, 'w2')).toBe(true);
      await expect(tabHandle(page, 'b0')).toHaveCount(0);

      // Played to its end: open, its title row unlit (D4).
      await playSweep(page, 'w2');
      await expect(tabHandle(page, 'b0')).toBeVisible();
      await expect(tabHandle(page, 'b1')).toBeVisible();
      expect(await isFolded(page, 'w2')).toBe(false);
      expect(await isUnlit(page, 'w2')).toEqual(UNLIT);
      await settled(page);

      const b1 = await aimAtOwn(page, at.x, 'b1', 0.25);
      expect(
        await page.evaluate(
          () =>
            document
              .querySelector('[data-drag-landing-slot]')
              ?.getBoundingClientRect().top ?? null
        )
      ).toBeCloseTo(b1.top, 0);
      await page.mouse.up();
      await expect
        .poll(() => layout(page, 'S1'))
        .toEqual(['a0 a2 al0* al1*', 'b0 a1 b1']);
    });
  }

  const HOVER_BY_THEME = new Map([
    ['Light', LIGHT_THEME.HOVER_COLOR],
    ['WarmLight', WARM_LIGHT_THEME.HOVER_COLOR],
    ['BBPink', BB_PINK_THEME.HOVER_COLOR],
    ['Darkenheimer', DARKENHEIMER_THEME.HOVER_COLOR],
    ['Blue', BLUE_THEME.HOVER_COLOR],
  ]);
  for (const theme of THEMES) {
    test(`held at half, the title row is swept from the left (${theme})`, async ({
      context,
      extensionId,
    }) => {
      await seedSettings(context, { theme });
      const page = await openPopup(context, extensionId);
      await collapseWindow(page, 'w2');
      const t = await boxOf(page.locator(titleOf('w2')));
      // The row's top strip, clear of its glyphs.
      const y = t.y + 3;
      const xAt = (f: number) => t.x + t.width * f;
      // CONTROL: the ground is the title row's own pixel at rest.
      const [ground] = await pixelsAt(page, [[xAt(0.75), y]]);
      const at = await pickUp(page, tabHandle(page, 'a1'));
      await ontoTitle(page, 'w2', at.x);
      const half = await holdSweepAt(page, titleOf('w2'), SPRING_OPEN_MS / 2);
      // PREMISE: the probes are clear of the card.
      expect(
        (await boxOf(page.locator('[data-drag-card]'))).y - 2
      ).toBeGreaterThan(y);
      const hover = HOVER_BY_THEME.get(theme)?.toUpperCase();
      if (hover === undefined) throw new Error(`no hover token for ${theme}`);
      // The fill is the theme's hover token, as declared and as painted.
      expect(rgbToHex(half.color)).toBe(hover);
      // PREMISE: the two can be told apart.
      expect(hover).not.toBe(ground);
      const [left, right] = await pixelsAt(page, [
        [xAt(0.25), y],
        [xAt(0.75), y],
      ]);
      expect([left, right]).toEqual([hover, ground]);
      expect(half.size).toBe('50% 100%');
      // PREMISE: read before the open.
      expect(await isFolded(page, 'w2')).toBe(true);
      await page.keyboard.press('Escape');
      await page.mouse.up();
    });
  }

  test('group Alpha rests on collapsed w2: w2 opens, and Alpha lands between b0 and b1 as one item', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId);
    await collapseWindow(page, 'w2');
    await watchDwell(page);
    const at = await pickUp(page, groupHandle(page, 'alpha'));
    await ontoTitle(page, 'w2', at.x);
    await expect(tabHandle(page, 'tab:b0')).toBeVisible();
    const { started, opened } = dwellToOpen(await dwellLog(page), 'w2');
    if (started === undefined || opened === undefined)
      throw new Error('w2 never dwelt and opened');
    expect(opened - started).toBeGreaterThanOrEqual(SPRING_OPEN_MS);
    await settled(page);
    await aimAtOwn(page, at.x, 'tab:b1', 0.25);
    await page.mouse.up();
    await expect
      .poll(() => layout(page, 'S1'))
      .toEqual(['a0 a1 a2', 'b0 al0* al1* b1']);
    expect(await groupEntries(page, 'S1', 1)).toEqual(['alpha']);
  });

  // The held row is below the window that opens: the frame it opens in
  // already shows everything where it rests (Task 3's re-measure, before
  // paint), and the title row it rests on does not move (D12).
  async function openAbove(
    page: Page,
    w: {
      opens: string;
      // The id of a row in the window that opens, and its group bands.
      opensRow: string;
      opensBands: string[];
      next: string;
      held: string;
      leaveOut: string[];
    }
  ): Promise<void> {
    const pane = await detailPane(page);
    const heldBox = await boxOf(tabHandle(page, w.held));
    const title = await boxOf(page.locator(titleOf(w.opens)));
    // PREMISE: in a list that scrolls, grabbed and aimed clear of both
    // auto-scroll bands (a list that fits has no auto-scroll).
    const scrolls = (await scrollRange(page)) > 0;
    const aims = [heldBox.y + heldBox.height / 2, title.y + title.height / 2];
    for (const y of scrolls ? aims : []) {
      expect(y).toBeGreaterThan(pane.top + 48);
      expect(y).toBeLessThan(pane.bottom - 48);
    }
    await logPane(page, w.leaveOut);
    const at = await pickUp(page, tabHandle(page, w.held));
    await ontoTitle(page, w.opens, at.x);
    await expect(tabHandle(page, w.opensRow)).toBeVisible();
    await settled(page);
    const frames = await paneLog(page);
    expect((await detailPane(page)).scrollTop).toBe(pane.scrollTop);

    const open = frames.findIndex((f) => w.opensRow in f.rows);
    // PREMISE: logged folded at rest, resting, and open.
    expect(open).toBeGreaterThan(5);
    const last = frames[frames.length - 1];
    const before = frames[open - 1];
    const first = frames[open];
    if (last === undefined || before === undefined || first === undefined)
      throw new Error('no frames');
    const near = (a: number | null | undefined, b: number | null | undefined) =>
      typeof a === 'number' &&
      typeof b === 'number' &&
      Math.abs(a - b) <= SLOT_EDGE_TOLERANCE;
    const atRest = frames.slice(open - 3);
    // The slot, in the first frame the rows are drawn, where it rests.
    expect(
      near(first.slot, last.slot),
      `slot ${first.slot} vs ${last.slot}`
    ).toBe(true);
    // The held row under the pointer, every frame from rest on.
    expect(atRest.filter((f) => !near(f.heldTop, last.heldTop))).toEqual([]);
    // The source room rides with its own window, every frame it is drawn.
    const roomOffsets = frames.flatMap((f) =>
      f.room === null || f.titles[w.next] === undefined
        ? []
        : [f.room - f.titles[w.next]]
    );
    expect(roomOffsets.length).toBeGreaterThan(5);
    expect(
      roomOffsets.filter(
        (d) => Math.abs(d - (roomOffsets[0] ?? NaN)) > SLOT_EDGE_TOLERANCE
      )
    ).toEqual([]);
    // The opened window's own rows and band frames, in the first frame they
    // are drawn, where they rest.
    type Tops = (f: PaneFrame) => Record<string, number>;
    const drawnAtOpen = (of: Tops) =>
      Object.keys(of(first)).filter((id) => !(id in of(before)));
    const misplaced = (of: Tops) =>
      drawnAtOpen(of).flatMap((id) =>
        near(of(first)[id], of(last)[id])
          ? []
          : [{ id, first: of(first)[id], last: of(last)[id] }]
      );
    expect(drawnAtOpen((f) => f.rows)).toContain(w.opensRow);
    expect(drawnAtOpen((f) => f.bands)).toEqual(w.opensBands);
    expect([...misplaced((f) => f.rows), ...misplaced((f) => f.bands)]).toEqual(
      []
    );
    // D12: the title row it rests on does not move at the open.
    expect(
      atRest.filter((f) => !near(f.titles[w.opens], last.titles[w.opens]))
    ).toEqual([]);
    // The next window moves by exactly the opened block's growth.
    const grown =
      (first.heights[w.opens] ?? NaN) - (before.heights[w.opens] ?? NaN);
    expect(grown).toBeGreaterThan(30);
    expect(
      (first.titles[w.next] ?? NaN) - (before.titles[w.next] ?? NaN)
    ).toBeCloseTo(grown, 1);
    await page.keyboard.press('Escape');
    await page.mouse.up();
  }

  test('upward: b1 rests on collapsed w1, and the frame w1 opens in shows the slot, the room and the held row where they rest', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId);
    await collapseWindow(page, 'w1');
    await openAbove(page, {
      opens: 'w1',
      opensRow: 'a0',
      opensBands: ['alpha'],
      next: 'w2',
      held: 'b1',
      leaveOut: ['b1', 'tab:b1'],
    });
  });

  test('upward, from a 6×4 session scrolled to 200 with its third window collapsed: the same', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(
      context,
      extensionId,
      [sixByFour('S6', 'Six', 's'), S2()],
      'S6'
    );
    await setDetailScroll(page, 200);
    await collapseWindow(page, 'sw2');
    // PREMISE: the folded list still scrolls, and stands at 200.
    expect((await detailPane(page)).scrollTop).toBe(200);
    expect(await scrollRange(page)).toBeGreaterThan(200);
    await openAbove(page, {
      opens: 'sw2',
      opensRow: 's2-0',
      opensBands: [],
      next: 'sw3',
      held: 's3-1',
      leaveOut: ['s3-1', 'tab:s3-1'],
    });
  });

  test('reduced motion: lit in full at arrival, and still opens, no sooner than the wait', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await collapseWindow(page, 'w2');
    await watchDwell(page);
    const at = await pickUp(page, tabHandle(page, 'a1'));
    const t = await ontoTitle(page, 'w2', at.x);
    // Held at its start, so the read cannot race the open.
    await holdSweepAt(page, titleOf('w2'), 0);
    const [right] = await pixelsAt(page, [[t.x + t.width * 0.97, t.y + 3]]);
    // PREMISE: read before the open.
    expect(await isFolded(page, 'w2')).toBe(true);
    expect(right).toBe(LIGHT_THEME.HOVER_COLOR.toUpperCase());
    await playSweep(page, 'w2');
    await expect(tabHandle(page, 'b0')).toBeVisible();
    const { started, opened } = dwellToOpen(await dwellLog(page), 'w2');
    if (started === undefined || opened === undefined)
      throw new Error('w2 never dwelt and opened');
    expect(opened - started).toBeGreaterThanOrEqual(SPRING_OPEN_MS);
    await page.keyboard.press('Escape');
    await page.mouse.up();
  });

  // Every move re-renders the title row (the drag state reaches it); its
  // sweep must be the same animation throughout.
  test('moving about the title row does not restart the sweep', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId);
    await collapseWindow(page, 'w2');
    await watchDwell(page);
    const at = await pickUp(page, tabHandle(page, 'a1'));
    const t = await ontoTitle(page, 'w2', at.x);
    await page.locator(titleOf('w2')).evaluate((el) => {
      const [first] = el.getAnimations();
      const log: unknown[] = [];
      const frame = () => {
        const [now] = el.getAnimations();
        if (now === undefined) return;
        log.push({
          same: now === first,
          start: Number(now.startTime),
          current: Number(now.currentTime),
        });
        document.body.dataset.sweepLog = JSON.stringify(log);
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });
    // Across the row's icons and back, inside its box, for half the wait.
    const arrived = Date.now();
    for (let i = 0; Date.now() - arrived < SPRING_OPEN_MS / 2; i++) {
      const f = [0.9, 0.1, 0.6, 0.3][i % 4] ?? 0.5;
      await page.mouse.move(t.x + t.width * f, t.y + t.height * (0.3 + f / 3), {
        steps: 4,
      });
    }
    const lastMove = await page.evaluate(() => performance.now());
    await expect(tabHandle(page, 'b0')).toBeVisible();
    const sweepLog: unknown = JSON.parse(
      await page.evaluate(() => document.body.dataset.sweepLog ?? '[]')
    );
    if (!Array.isArray(sweepLog)) throw new Error('no sweep log');
    const frames: readonly unknown[] = sweepLog;
    expect(frames.length).toBeGreaterThan(5);
    const rows = frames.map((f) =>
      typeof f === 'object' &&
      f !== null &&
      'same' in f &&
      'start' in f &&
      'current' in f
        ? { same: f.same, start: f.start, current: f.current }
        : null
    );
    expect(rows.filter((r) => r === null || r.same !== true)).toEqual([]);
    const starts = new Set(rows.map((r) => r?.start));
    expect(starts.size).toBe(1);
    const currents = rows.map((r) => Number(r?.current));
    expect(
      currents.filter((c, i) => i > 0 && c < (currents[i - 1] ?? 0))
    ).toEqual([]);
    const { started, opened } = dwellToOpen(await dwellLog(page), 'w2');
    if (started === undefined || opened === undefined)
      throw new Error('w2 never dwelt and opened');
    expect(opened - started).toBeGreaterThanOrEqual(SPRING_OPEN_MS);
    // PREMISE: the moves took a good share of the wait.
    expect(lastMove - started).toBeGreaterThan(SPRING_OPEN_MS / 4);
    expect(opened).toBeLessThan(lastMove + SPRING_OPEN_MS);
    await page.keyboard.press('Escape');
    await page.mouse.up();
  });

  test('leaving restarts: back on the title after resting elsewhere, a new sweep from 0, and w2 opens only the wait after the return', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId);
    await collapseWindow(page, 'w2');
    await watchDwell(page);
    const at = await pickUp(page, tabHandle(page, 'a1'));
    await ontoTitle(page, 'w2', at.x);
    // Held, so w2 cannot open first; leaving drops the held sweep.
    await holdSweepAt(page, titleOf('w2'), 300);
    await aimAt(page, 'a2', 0.5);
    expect(await sweepsOn(page, 'w2')).toEqual([]);
    await ontoTitle(page, 'w2', at.x);
    // A fresh sweep: from 0, not from where the first one stopped.
    expect((await sweepsOn(page, 'w2'))[0]?.currentTime ?? NaN).toBeLessThan(
      300
    );
    await expect(tabHandle(page, 'b0')).toBeVisible();
    const log = await dwellLog(page);
    const { started, opened } = dwellToOpen(log, 'w2');
    if (started === undefined || opened === undefined)
      throw new Error('w2 never dwelt and opened');
    // PREMISE: two dwells, the first ended.
    expect(
      log.filter((r) => r.id === 'w2' && r.attr === 'dwell').map((r) => r.on)
    ).toEqual([true, false, true, false]);
    expect(opened - started).toBeGreaterThanOrEqual(SPRING_OPEN_MS);
    await page.keyboard.press('Escape');
    await page.mouse.up();
  });

  // Esc drops the dwell, but no layout is read after it in that task, so
  // the sweep lives until the next frame's style: one that ends there must
  // not open a window for a drag that is over.
  test('a sweep that ends in the task Esc ended the drag in opens nothing', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId);
    await collapseWindow(page, 'w2');
    await watchDwell(page);
    const at = await pickUp(page, tabHandle(page, 'a1'));
    await ontoTitle(page, 'w2', at.x);
    await holdSweepAt(page, titleOf('w2'), SPRING_OPEN_MS - 1);
    const ended = await page.locator(titleOf('w2')).evaluate(async (el) => {
      const [sweep] = el.getAnimations();
      if (sweep === undefined) return 'no sweep';
      const settledAs = sweep.finished.then(
        () => 'finished',
        () => 'cancelled'
      );
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      const dwelling = el.parentElement?.hasAttribute('data-spring-dwell');
      sweep.finish();
      return `${dwelling === true ? 'dwelling' : 'ended'}, ${await settledAs}`;
    });
    // PREMISE: the drag ended, and the sweep did finish rather than cancel.
    expect(ended).toBe('ended, finished');
    await settled(page);
    expect(await isFolded(page, 'w2')).toBe(true);
    expect(
      (await dwellLog(page)).filter((r) => r.attr === 'collapsed')
    ).toEqual([]);
    await page.mouse.up();
  });

  test('Esc after the open: w2 folds back, and nothing moved', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId);
    await collapseWindow(page, 'w2');
    const at = await pickUp(page, tabHandle(page, 'a1'));
    await ontoTitle(page, 'w2', at.x);
    await expect(tabHandle(page, 'b0')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(tabHandle(page, 'b0')).toHaveCount(0);
    expect(await isFolded(page, 'w2')).toBe(true);
    await page.mouse.up();
    await page.waitForTimeout(200);
    expect(await layout(page, 'S1')).toEqual([W1_START, 'b0 b1']);
  });

  test('a refused release beside the pane after the open: w2 folds back, and nothing moved', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId);
    await collapseWindow(page, 'w2');
    const at = await pickUp(page, tabHandle(page, 'a1'));
    await ontoTitle(page, 'w2', at.x);
    await expect(tabHandle(page, 'b0')).toBeVisible();
    await settled(page);
    const y = await belowTheList(page, 'w2');
    const pane = await detailPane(page);
    expect(pane.right + 4).toBeLessThan(POPUP.width);
    await page.mouse.move(pane.right + 4, y, { steps: 4 });
    await page.mouse.up();
    await expect(tabHandle(page, 'b0')).toHaveCount(0);
    expect(await isFolded(page, 'w2')).toBe(true);
    await page.waitForTimeout(200);
    expect(await layout(page, 'S1')).toEqual([W1_START, 'b0 b1']);
  });

  test.describe('a list that starts to scroll when w2 opens', () => {
    test.use({ showScrollbars: true });
    const LONG = () =>
      session('S1', 'Source', [
        win(
          'w1',
          Array.from({ length: 5 }, (_, i) => tab(`a${i}`))
        ),
        win(
          'w2',
          Array.from({ length: 10 }, (_, i) => tab(`b${i}`))
        ),
      ]);
    // The detail pane's scrollbar width, borders aside.
    const barWidth = (page: Page) =>
      page.evaluate(() => {
        let el = document.querySelector(
          '[data-pane="detail"] [data-drop-window-id]'
        )?.parentElement;
        while (
          el &&
          !['auto', 'scroll'].includes(getComputedStyle(el).overflowY)
        )
          el = el.parentElement;
        return el ? el.offsetWidth - el.clientWidth - el.clientLeft * 2 : -1;
      });

    test('the slot is as wide as the narrowed row, and the last row is reached by auto-scroll', async ({
      context,
      extensionId,
    }) => {
      const page = await openPopup(context, extensionId, [LONG(), S2()]);
      await collapseWindow(page, 'w2');
      // PREMISE: folded, the list fits, with no bar.
      expect(await scrollRange(page)).toBe(0);
      expect(await barWidth(page)).toBe(0);
      const at = await pickUp(page, tabHandle(page, 'a1'));
      await ontoTitle(page, 'w2', at.x);
      await expect(tabHandle(page, 'b0')).toBeVisible();
      await settled(page);
      // PREMISE: open, it scrolls, and the bar takes its 10px.
      expect(await barWidth(page)).toBe(10);
      await aimAtOwn(page, at.x, 'b2', 0.25);
      await expectSlotAsWideAs(page, await rowBox(page, 'b2'));

      // Held at the bottom edge, the list scrolls until w2's last row shows.
      const pane = await detailPane(page);
      await page.mouse.move(at.x, pane.bottom - 4, { steps: 4 });
      await expect
        .poll(async () => (await boxOf(tabHandle(page, 'b9'))).y)
        .toBeLessThan(pane.bottom - 40);
      const b9 = await boxOf(tabHandle(page, 'b9'));
      expect(b9.y + b9.height).toBeLessThanOrEqual(pane.bottom);
      await page.mouse.move(at.x, b9.y + b9.height * 0.75, { steps: 2 });
      await page.mouse.up();
      await expect
        .poll(() => layout(page, 'S1'))
        .toEqual(['a0 a2 a3 a4', 'b0 b1 b2 b3 b4 b5 b6 b7 b8 b9 a1']);
    });
  });

  test.describe('nothing dwells', () => {
    async function neverDwelt(page: Page): Promise<void> {
      expect((await dwellLog(page)).filter((r) => r.attr === 'dwell')).toEqual(
        []
      );
    }

    // Quiet without the opt-in too: a window row sits in no window block, so lands in none.
    test('a window drag over collapsed w2', async ({
      context,
      extensionId,
    }) => {
      const page = await openPopup(context, extensionId);
      await collapseWindow(page, 'w2');
      await watchDwell(page);
      const at = await pickUp(page, windowHandle(page, 'w1'));
      await expect(
        page.locator('[data-drag-row-id="w1"][data-drag-held]')
      ).toHaveCount(1);
      await ontoTitle(page, 'w2', at.x);
      await neverDwelt(page);
      await page.keyboard.press('Escape');
      await page.mouse.up();
    });

    // Quiet without the opt-in too: an Open now window is never marked data-window-collapsed.
    test('an Open now tab drag over a collapsed Open now window', async ({
      context,
      extensionId,
      serviceWorker,
    }) => {
      const url = (title: string) =>
        `data:text/html,${encodeURIComponent(`<title>${title}</title>`)}`;
      const yWindow = await serviceWorker.evaluate(async (urls) => {
        await chrome.windows.create({ focused: false, url: urls.slice(0, 2) });
        const y = await chrome.windows.create({
          focused: false,
          url: urls.slice(2),
        });
        return y?.id ?? -1;
      }, ['x0', 'x1', 'y0', 'y1'].map(url));
      const page = await openTabView(context, extensionId, false);
      const yBlock = page.locator(`[data-open-window-id="${yWindow}"]`);
      await expect(yBlock).toContainText('y0');
      await yBlock.getByRole('button', { name: /^Collapse: / }).click();
      // PREMISE: folded, its rows not drawn.
      await expect(
        yBlock.getByRole('button', { name: /^Expand: / })
      ).toBeVisible();
      await expect(yBlock).not.toContainText('y0');
      await page.mouse.move(1, 1);
      await watchDwell(page);
      const x0 = page.locator('[data-pane="open-now"] [data-open-tab-id]', {
        hasText: 'x0',
      });
      const at = await pickUp(page, x0);
      await expect(
        page.locator('[data-pane="open-now"] [data-drag-held]')
      ).toHaveCount(1);
      const row = await boxOf(yBlock.locator('[data-window-row]'));
      await page.mouse.move(at.x, row.y + row.height / 2, { steps: 8 });
      await neverDwelt(page);
      await page.keyboard.press('Escape');
      await page.mouse.up();
    });

    // On the title itself: no tab row sits within the activation distance of it.
    test('a press on the title that never passes the activation distance', async ({
      context,
      extensionId,
    }) => {
      const page = await openPopup(context, extensionId);
      await collapseWindow(page, 'w2');
      await watchDwell(page);
      const t = await boxOf(page.locator(titleOf('w2')));
      const x = t.x + t.width / 2;
      await page.mouse.move(x, t.y + t.height / 2 - 2);
      await page.mouse.down();
      await page.mouse.move(x, t.y + t.height / 2 + 2, { steps: 2 });
      await expect(
        page.locator('[data-pane="detail"] [data-drag-held]')
      ).toHaveCount(0);
      await neverDwelt(page);
      await page.mouse.up();
    });

    test('a tab in the half-gap above collapsed w2 lands in w2, and nothing dwells (D3)', async ({
      context,
      extensionId,
    }) => {
      const page = await openPopup(context, extensionId);
      await collapseWindow(page, 'w2');
      await watchDwell(page);
      const w1 = await boxOf(page.locator(blockOf('w1')));
      const w2 = await boxOf(page.locator(blockOf('w2')));
      const y = w2.y - 1.5;
      // PREMISE: in the gap, nearer w2.
      expect(y).toBeGreaterThan((w1.y + w1.height + w2.y) / 2);
      const at = await pickUp(page, tabHandle(page, 'a1'));
      await page.mouse.move(at.x, y, { steps: 8 });
      await settled(page);
      await neverDwelt(page);
      await page.mouse.up();
      await expect
        .poll(() => layout(page, 'S1'))
        .toEqual(['a0 a2 al0* al1*', 'a1 b0 b1']);
      expect(await isFolded(page, 'w2')).toBe(true);
    });
  });

  test('D5: released on the title with the sweep held at 0, a1 lands first in w2, and w2 stays folded', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId);
    await collapseWindow(page, 'w2');
    const at = await pickUp(page, tabHandle(page, 'a1'));
    await ontoTitle(page, 'w2', at.x);
    await holdSweepAt(page, titleOf('w2'), 0);
    await page.mouse.up();
    await expect
      .poll(() => layout(page, 'S1'))
      .toEqual(['a0 a2 al0* al1*', 'a1 b0 b1']);
    expect(await isFolded(page, 'w2')).toBe(true);
    expect(await isUnlit(page, 'w2')).toEqual(UNLIT);
  });
});

// ---- the window it lands in stays open (KAN-379 Q2, Q3) ---------------------

// Each frame's scrollTop and whether `windowId` is drawn folded, read once
// the frame has painted; `end` is the last frame begun before the drag ended.
interface PaintedFrame {
  frame: number;
  scrollTop: number;
  folded: boolean;
}
const isPaintedLog = (x: unknown): x is PaintedFrame[] => {
  if (!Array.isArray(x)) return false;
  const items: readonly unknown[] = x;
  return items.every(
    (f) =>
      typeof f === 'object' &&
      f !== null &&
      'frame' in f &&
      typeof f.frame === 'number' &&
      'scrollTop' in f &&
      typeof f.scrollTop === 'number' &&
      'folded' in f &&
      typeof f.folded === 'boolean'
  );
};
async function logPainted(page: Page, windowId: string): Promise<void> {
  await page.evaluate((windowId) => {
    const log: unknown[] = [];
    let frame = 0;
    document.body.dataset.paintedLog = '[]';
    // The frame counter as the drag ends: the next frame is the first after it.
    const end = () => {
      document.body.dataset.paintedEnd ??= String(frame);
    };
    window.addEventListener('keydown', end);
    window.addEventListener('pointerup', end);
    const scroller = () => {
      let el = document.querySelector(
        '[data-pane="detail"] [data-drop-window-id]'
      )?.parentElement;
      while (el && !['auto', 'scroll'].includes(getComputedStyle(el).overflowY))
        el = el.parentElement;
      return el ?? null;
    };
    const channel = new MessageChannel();
    // A message posted in a frame's rAF is handled after that frame paints.
    channel.port1.onmessage = (e: MessageEvent<number>) => {
      log.push({
        frame: e.data,
        scrollTop: scroller()?.scrollTop ?? -1,
        folded:
          document.querySelector(
            `[data-drop-window-id="${windowId}"] [data-window-tabs]`
          ) === null,
      });
      document.body.dataset.paintedLog = JSON.stringify(log);
      document.body.dataset.paintedCount = String(log.length);
    };
    const tick = () => {
      channel.port2.postMessage(++frame);
      if (log.length < 600) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, windowId);
}
async function paintedLog(
  page: Page
): Promise<{ end: number; frames: PaintedFrame[] }> {
  const raw = await page.evaluate(() => ({
    end: document.body.dataset.paintedEnd ?? '',
    log: document.body.dataset.paintedLog ?? '[]',
  }));
  const frames: unknown = JSON.parse(raw.log);
  if (raw.end === '' || !isPaintedLog(frames))
    throw new Error(`not a painted log: ${JSON.stringify(raw)}`);
  return { end: Number(raw.end), frames };
}

test.describe('the window it lands in stays open (KAN-379 Q2, Q3)', () => {
  // The 6×4 session with sw2, sw3 and sw4 folded, scrolled to `top`: the
  // folded list still scrolls, and `held` and every folded title sit clear
  // of both auto-scroll bands.
  async function openSix(
    page: Page,
    top: number,
    held: string
  ): Promise<PaneBox> {
    for (const w of ['sw2', 'sw3', 'sw4']) await collapseWindow(page, w);
    expect(await setDetailScroll(page, top)).toBe(top);
    const pane = await detailPane(page);
    expect(await scrollRange(page)).toBeGreaterThanOrEqual(top);
    for (const loc of [
      tabHandle(page, held),
      ...['sw2', 'sw3', 'sw4'].map((w) => page.locator(titleOf(w))),
    ]) {
      const b = await boxOf(loc);
      expect(b.y + b.height / 2).toBeGreaterThan(pane.top + 48);
      expect(b.y + b.height / 2).toBeLessThan(pane.bottom - 48);
    }
    return pane;
  }

  const SIX_START = [
    's0-0 s0-1 s0-2 s0-3',
    's1-0 s1-1 s1-2 s1-3',
    's2-0 s2-1 s2-2 s2-3',
    's3-0 s3-1 s3-2 s3-3',
    's4-0 s4-1 s4-2 s4-3',
    's5-0 s5-1 s5-2 s5-3',
  ];

  // s1-1 rests on sw3 until it opens, then on sw2 until it opens, and is let
  // go between s2-0 and s2-1, with every frame across the release logged.
  async function intoOpenedSw2(page: Page): Promise<PaneFrame[]> {
    const pane = await openSix(page, 160, 's1-1');
    const at = await pickUp(page, tabHandle(page, 's1-1'));
    await ontoTitle(page, 'sw3', at.x);
    await expect(tabHandle(page, 's3-0')).toBeVisible();
    await ontoTitle(page, 'sw2', at.x);
    await expect(tabHandle(page, 's2-0')).toBeVisible();
    await settled(page);
    await aimAtOwn(page, at.x, 's2-1', 0.25);
    expect((await detailPane(page)).scrollTop).toBe(pane.scrollTop);
    await logPane(page, ['s1-1']);
    await page.mouse.up();
    await expect
      .poll(() => layout(page, 'S6'))
      .toEqual([
        's0-0 s0-1 s0-2 s0-3',
        's1-0 s1-2 s1-3',
        's2-0 s1-1 s2-1 s2-2 s2-3',
        ...SIX_START.slice(3),
      ]);
    await settled(page);
    return paneLog(page);
  }

  test('s1-1 let go in sw2, which it opened, with sw3 opened on the way: sw2 stays open in every frame, sw3 folds back, and the rest are as they were', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(
      context,
      extensionId,
      [sixByFour('S6', 'Six', 's'), S2()],
      'S6'
    );
    const frames = await intoOpenedSw2(page);
    // PREMISE: logged held and released.
    expect(frames.findIndex((f) => !f.held)).toBeGreaterThan(0);
    expect(frames.slice(-1)[0]?.held).toBe(false);
    expect(
      frames.flatMap((f, i) => ('s2-0' in f.rows ? [] : [`frame ${i}`]))
    ).toEqual([]);
    expect(await isFolded(page, 'sw2')).toBe(false);
    expect(await isFolded(page, 'sw3')).toBe(true);
    // CONTROLS: never rested on, still folded; open before the drag, still open.
    expect(await isFolded(page, 'sw4')).toBe(true);
    for (const w of ['sw0', 'sw1', 'sw5'])
      expect(await isFolded(page, w)).toBe(false);

    // The stored fold no longer holds sw2: one press of its chevron folds it.
    await collapseWindow(page, 'sw2');
  });

  test('D9: ⌘Z after that drop puts s1-1 back and leaves sw2 open', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(
      context,
      extensionId,
      [sixByFour('S6', 'Six', 's'), S2()],
      'S6'
    );
    const before = await stored(page);
    await intoOpenedSw2(page);
    await expectOneUndoRestores(page, sessionOf(before, 'S6'));
    expect(await isFolded(page, 'sw2')).toBe(false);
    expect(await isFolded(page, 'sw3')).toBe(true);
  });

  test('CONTROL: s1-3 let go in sw4 through its half-gap, never resting on its title, with sw2 opened on the way: sw4 stays folded', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(
      context,
      extensionId,
      [sixByFour('S6', 'Six', 's'), S2()],
      'S6'
    );
    const pane = await openSix(page, 208, 's1-3');
    await watchDwell(page);
    const at = await pickUp(page, tabHandle(page, 's1-3'));
    await ontoTitle(page, 'sw2', at.x);
    await expect(tabHandle(page, 's2-0')).toBeVisible();
    await settled(page);
    const sw3 = await ownBox(page, blockOf('sw3'));
    const sw4 = await ownBox(page, blockOf('sw4'));
    const y = sw4.top - 1.5;
    // PREMISE: in the gap, nearer sw4, clear of the bottom band.
    expect(y).toBeGreaterThan((sw3.bottom + sw4.top) / 2);
    expect(y).toBeLessThan(pane.bottom - 48);
    await page.mouse.move(at.x, y, { steps: 8 });
    await settled(page);
    expect((await detailPane(page)).scrollTop).toBe(pane.scrollTop);
    await page.mouse.up();
    await expect
      .poll(() => layout(page, 'S6'))
      .toEqual([
        's0-0 s0-1 s0-2 s0-3',
        's1-0 s1-1 s1-2',
        ...SIX_START.slice(2, 4),
        's1-3 s4-0 s4-1 s4-2 s4-3',
        SIX_START[5],
      ]);
    // PREMISE: sw4 never dwelt.
    expect(
      (await dwellLog(page)).filter((r) => r.id === 'sw4' && r.attr === 'dwell')
    ).toEqual([]);
    expect(await isFolded(page, 'sw4')).toBe(true);
    expect(await isFolded(page, 'sw2')).toBe(true);
  });

  // a1 or Alpha, w2 folded: out to the list and back, w2 opens under it;
  // out and back again, w2 is still open (D6).
  async function carriedBackOpensW2(
    page: Page,
    handle: Locator,
    phantomId: string,
    rowOf: (tabId: string) => string
  ): Promise<Point> {
    await collapseWindow(page, 'w2');
    const at = await pickUp(page, handle);
    await carryOutLeft(page, at);
    await adoptPhantom(page, phantomId);
    await ontoTitle(page, 'w2', at.x);
    await expect(tabHandle(page, rowOf('b0'))).toBeVisible();
    await carryOutLeft(page, at);
    expect(await isFolded(page, 'w2')).toBe(false);
    // The phantom eases home from where it was held.
    await settled(page);
    await adoptPhantom(page, phantomId);
    expect(await isFolded(page, 'w2')).toBe(false);
    return at;
  }
  const tabRow = (id: string) => id;
  const groupRow = (id: string) => `tab:${id}`;

  test('carried back to its own session, a1 let go in the w2 it opened: w2 stays open in every frame', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId);
    const at = await carriedBackOpensW2(
      page,
      tabHandle(page, 'a1'),
      'carried:a1',
      tabRow
    );
    await aimAtOwn(page, at.x, 'b1', 0.25);
    await logPane(page, ['carried:a1', 'a1']);
    await page.mouse.up();
    await expect
      .poll(() => layout(page, 'S1'))
      .toEqual(['a0 a2 al0* al1*', 'b0 a1 b1']);
    await settled(page);
    const frames = await paneLog(page);
    expect(frames.findIndex((f) => !f.held)).toBeGreaterThan(0);
    expect(
      frames.flatMap((f, i) => ('b0' in f.rows ? [] : [`frame ${i}`]))
    ).toEqual([]);
    expect(await isFolded(page, 'w2')).toBe(false);
    await collapseWindow(page, 'w2');
  });

  test('carried back to its own session, w2 opened: Esc folds it back, and nothing moved', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId);
    await carriedBackOpensW2(page, tabHandle(page, 'a1'), 'carried:a1', tabRow);
    await page.keyboard.press('Escape');
    await expect(tabHandle(page, 'b0')).toHaveCount(0);
    expect(await isFolded(page, 'w2')).toBe(true);
    await page.mouse.up();
    await page.waitForTimeout(200);
    expect(await layout(page, 'S1')).toEqual([W1_START, 'b0 b1']);
  });

  test("carried back to its own session, w2 opened: let go on S3's row, w2 folds back", async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId);
    const at = await carriedBackOpensW2(
      page,
      tabHandle(page, 'a1'),
      'carried:a1',
      tabRow
    );
    await carryOutLeft(page, at);
    await onto(page, 'S3');
    await page.mouse.up();
    await expect.poll(() => layout(page, 'S3')).toEqual(['a1', 'f0']);
    expect(await layout(page, 'S1')).toEqual(['a0 a2 al0* al1*', 'b0 b1']);
    // PREMISE: S1 is still the session on screen.
    expect(await selected(page)).toBe('S1');
    await expect(tabHandle(page, 'b0')).toHaveCount(0);
    expect(await isFolded(page, 'w2')).toBe(true);
  });

  test('carried back to its own session, group Alpha let go in the w2 it opened: w2 stays open', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId);
    const at = await carriedBackOpensW2(
      page,
      groupHandle(page, 'alpha'),
      'group:carried:alpha',
      groupRow
    );
    await aimAtOwn(page, at.x, 'tab:b1', 0.25);
    await page.mouse.up();
    await expect
      .poll(() => layout(page, 'S1'))
      .toEqual(['a0 a1 a2', 'b0 al0* al1* b1']);
    expect(await isFolded(page, 'w2')).toBe(false);
    await collapseWindow(page, 'w2');
  });

  // kw1 folded above a long session scrolled to 300, wholly above the view
  // there even open; the group g mid-pane below it.
  const KEPT = () =>
    session('K', 'Kept', [
      win('kw0', [tab('k0-0')]),
      win(
        'kw1',
        Array.from({ length: 4 }, (_, i) => tab(`k1-${i}`))
      ),
      win(
        'kw2',
        Array.from({ length: 6 }, (_, i) => tab(`k2-${i}`))
      ),
      win(
        'kw3',
        [
          tab('k3-0'),
          tab('k3-1'),
          tab('k3-2', 'g'),
          tab('k3-3', 'g'),
          tab('k3-4', 'g'),
          tab('k3-5'),
        ],
        [{ groupId: 'g', title: 'G', color: 'red' }]
      ),
      win(
        'kw4',
        Array.from({ length: 6 }, (_, i) => tab(`k4-${i}`))
      ),
    ]);

  test('KAN-157: a group drag cancelled after an open comes back to 300 in the first frame after the release, the window folded', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId, [KEPT(), S2()], 'K');
    await collapseWindow(page, 'kw1');
    expect(await setDetailScroll(page, 300)).toBe(300);
    const pane = await detailPane(page);
    const g = await boxOf(groupHandle(page, 'g'));
    // PREMISE: g mid-pane; kw1 above the view.
    expect(g.y + g.height / 2).toBeGreaterThan(pane.top + 48);
    expect(g.y + g.height / 2).toBeLessThan(pane.bottom - 48);
    expect((await boxOf(page.locator(blockOf('kw1')))).y).toBeLessThan(
      pane.top
    );
    // kw1's title where it rests, in content space: the preview shifts it.
    const title = await boxOf(page.locator(titleOf('kw1')));
    const titleMid = title.y + title.height / 2 - pane.top + pane.scrollTop;
    // PREMISE: at the list's top, the title is clear of the top band.
    expect(titleMid).toBeGreaterThan(48 + 8);
    const at = await pickUp(page, groupHandle(page, 'g'));
    // PREMISE: the folded list still scrolls past 300.
    expect(await scrollRange(page)).toBeGreaterThan(300);
    // Up the top band to the list's top, then onto kw1's title.
    await page.mouse.move(at.x, pane.top + 10, { steps: 6 });
    await expect.poll(async () => (await detailPane(page)).scrollTop).toBe(0);
    await page.mouse.move(at.x, pane.top + titleMid, { steps: 8 });
    await expect(tabHandle(page, 'tab:k1-0')).toBeVisible();
    expect((await detailPane(page)).scrollTop).toBe(0);
    // PREMISE: open, kw1 ends above where 300 begins.
    const kw1 = await boxOf(page.locator(blockOf('kw1')));
    expect(kw1.y + kw1.height - pane.top).toBeLessThan(300);
    expect(await isFolded(page, 'kw1')).toBe(false);
    // Down the pane, clear of its bottom band: the row where 300 begins then
    // carries no preview shift, so the browser's scroll anchoring can act.
    await page.mouse.move(at.x, pane.bottom - 70, { steps: 8 });
    await settled(page);
    expect((await detailPane(page)).scrollTop).toBe(0);
    await logPainted(page, 'kw1');
    await expect
      .poll(() =>
        page.evaluate(() => Number(document.body.dataset.paintedCount ?? 0))
      )
      .toBeGreaterThan(3);
    await page.keyboard.press('Escape');
    await expect
      .poll(async () => (await paintedLog(page)).frames.length)
      .toBeGreaterThan(30);
    await page.mouse.up();
    const { end, frames } = await paintedLog(page);
    const first = frames.find((f) => f.frame > end);
    expect(first).toEqual({ frame: end + 1, scrollTop: 300, folded: true });
    expect(frames.filter((f) => f.frame > end && f.scrollTop !== 300)).toEqual(
      []
    );
    expect(await layout(page, 'K')).toEqual(layoutOf(KEPT()));
  });

  test.describe('every other end folds back, and nothing moved', () => {
    // a1 rests on folded w2 until it opens.
    async function openedW2(page: Page): Promise<void> {
      await collapseWindow(page, 'w2');
      const at = await pickUp(page, tabHandle(page, 'a1'));
      await ontoTitle(page, 'w2', at.x);
      await expect(tabHandle(page, 'b0')).toBeVisible();
    }
    async function nothingMoved(page: Page): Promise<void> {
      await page.waitForTimeout(200);
      expect(await layout(page, 'S1')).toEqual([W1_START, 'b0 b1']);
    }

    test('pointercancel', async ({ context, extensionId }) => {
      const page = await openPopup(context, extensionId);
      await openedW2(page);
      await page.evaluate(() =>
        window.dispatchEvent(new PointerEvent('pointercancel'))
      );
      await expect(page.locator('[data-drag-held]')).toHaveCount(0);
      await expect(tabHandle(page, 'b0')).toHaveCount(0);
      expect(await isFolded(page, 'w2')).toBe(true);
      await page.mouse.up();
      await nothingMoved(page);
    });

    test('a saved search starting mid-drag', async ({
      context,
      extensionId,
    }) => {
      const page = await openPopup(context, extensionId);
      await openedW2(page);
      const field = page.getByRole('textbox', {
        name: 'Search saved tabs',
        exact: true,
      });
      await field.focus();
      await page.keyboard.type('Tab b');
      await expect(page.locator('[data-drag-held]')).toHaveCount(0);
      // PREMISE: w2 is among the results, and drawn.
      await expect(page.locator(blockOf('w2'))).toBeVisible();
      await expect(tabHandle(page, 'b0')).toHaveCount(0);
      expect(await isFolded(page, 'w2')).toBe(true);
      await page.mouse.up();
      await field.fill('');
      await expect(tabHandle(page, 'a0')).toBeVisible();
      expect(await isFolded(page, 'w2')).toBe(true);
      await nothingMoved(page);
    });

    // A search nothing matches swaps the detail for its no-match state from
    // the first key, which unmounts the list mid-drag.
    test('the list unmounting', async ({ context, extensionId }) => {
      const page = await openPopup(context, extensionId);
      await openedW2(page);
      const field = page.getByRole('textbox', {
        name: 'Search saved tabs',
        exact: true,
      });
      await field.focus();
      await page.keyboard.type('zzz');
      // PREMISE: the list is gone.
      await expect(page.getByText('No saved tab matches "zzz"')).toBeVisible();
      await expect(page.locator('[data-drop-window-id]')).toHaveCount(0);
      await expect(page.locator('html[data-dragging]')).toHaveCount(0);
      await page.mouse.up();
      await field.fill('');
      await expect(tabHandle(page, 'a0')).toBeVisible();
      expect(await isFolded(page, 'w2')).toBe(true);
      await nothingMoved(page);
    });
  });
});
