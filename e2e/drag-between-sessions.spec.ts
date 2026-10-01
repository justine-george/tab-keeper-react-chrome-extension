// KAN-350 on the real artifact: a saved tab, group or window dragged out of
// the session on screen and into another saved session -- a MOVE, saved to
// saved, that never touches Chrome.
//
// What jsdom could not show, and so what this file is for: real geometry
// (the pane's box, the hand-off where the pointer reaches the session list
// (KAN-352), the list's rows and its auto-scroll), real timing (the 0.6s
// dwell, the frame the KAN-157 scroll comes back on, the frame KAN-155
// follows the dropped row on), and real paint (the target's outline and fill
// line against the row's actual fill, the card over the list, the toast at a
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
import type {
  TabMasterContainer,
  tabContainerData,
} from '../src/redux/slices/tabContainerDataStateSlice';
import { isValidTabMasterContainer } from '../src/utils/functions/local';
import { LIGHT_THEME } from '../src/hooks/useThemeColors';

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
//
// The New window target read here and below is the LIST's: a window block
// (`[data-drop-window-id][data-new-window-target]`). The toolbar row's target
// (KAN-361) is always in the DOM, hidden at rest, and is no window block.
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
        document.querySelector('[data-drop-window-id][data-new-window-target]')
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
    await expect(
      page.locator('[data-drop-window-id][data-new-window-target]')
    ).toHaveCount(1);
    await adoptPhantom(page, 'carried:a1');
    await expect(
      page.locator('[data-drop-window-id][data-new-window-target]')
    ).toHaveAttribute('data-landing', '');
    await page.mouse.up();

    await expect
      .poll(() => layout(page, 'S2'))
      .toEqual(['a1', D1_START, 'e0 e1']);
    expect(await windowIdsOf(page, 'S2')).toEqual(['new', 'd1', 'd2']);
    expect(await toasts(page)).toEqual([]);
    await expect(
      page.locator('[data-drop-window-id][data-new-window-target]')
    ).toHaveCount(0);
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
    await expect(
      page.locator('[data-drop-window-id][data-new-window-target]')
    ).toHaveCount(1);
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
    await expect(
      page.locator('[data-drop-window-id][data-new-window-target]')
    ).toHaveCount(0);
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

  test('the shown row: an outline but no line and no opening, and a drop there is a row drop with no Moved toast (Q3 A)', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId);
    const at = await pickUp(page, tabHandle(page, 'a1'));
    await carryOutLeft(page, at);
    await onto(page, 'S1');
    await expect(page.locator('[data-carry-dwell-line]')).toHaveCount(0);
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
    // PREMISE: carried, the scroll is still not the press's -- the group
    // left the source, and the New window target came in at the top -- so
    // it has to be put back, not merely left alone.
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

// The box a drop lands in: its height inside the borders, and its look.
const newWindowTarget = (page: Page) =>
  page.evaluate(() => {
    const el = document.querySelector<HTMLElement>(
      '[data-drop-window-id][data-new-window-target]'
    );
    if (el === null) return null;
    const style = getComputedStyle(el);
    return {
      inner: el.clientHeight,
      fill: style.backgroundColor,
      border: style.borderTopStyle,
      landing: el.hasAttribute('data-landing'),
      transition: style.transitionDuration,
      animations: el.getAnimations().length,
    };
  });

const heightOf = async (loc: Locator) => (await boxOf(loc)).height;

test.describe('the target visuals (V1-V4)', () => {
  // V1 A. One row tall whatever is carried, before the pointer comes in and
  // after: a carried group's phantom is held folded to its header.
  for (const kind of ['tab', 'group'] as const) {
    test(`V1: the New window target is one tab row tall for a ${kind}, before and after entry`, async ({
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

      // Over the list, carried: the target is in the source (Q2 A).
      await expect(page.locator(CARD)).toHaveCount(1);
      const before = await newWindowTarget(page);
      expect(before?.inner).toBe(rowH);

      await adoptPhantom(
        page,
        kind === 'tab' ? 'carried:a1' : 'group:carried:alpha'
      );
      const after = await newWindowTarget(page);
      expect(after?.landing).toBe(true);
      expect(after?.inner).toBe(rowH);
      await page.keyboard.press('Escape');
      await page.mouse.up();
    });
  }

  // V2 A, already built: the box lights up -- the hover fill and a solid
  // border -- and no landing slot is seen inside it.
  test('V2: a landing in the target lights the box, with no dashed slot inside', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId);
    const at = await pickUp(page, tabHandle(page, 'a1'));
    await carryOutLeft(page, at);
    // CONTROL: unlit, it is dashed and unfilled.
    const unlit = await newWindowTarget(page);
    expect(unlit?.border).toBe('dashed');
    expect(rgbToHex(unlit?.fill ?? '')).not.toBe(LIGHT_THEME.HOVER_COLOR);

    await adoptPhantom(page, 'carried:a1');
    const lit = await newWindowTarget(page);
    expect(lit?.landing).toBe(true);
    expect(rgbToHex(lit?.fill ?? '')).toBe(LIGHT_THEME.HOVER_COLOR);
    expect(lit?.border).toBe('solid');
    // The landing slot exists -- the drag is live -- and is not seen.
    const slots = await page
      .locator('[data-new-window-target] [data-drag-landing-slot]')
      .evaluateAll((els) =>
        els.map((el) =>
          el.checkVisibility({ checkVisibilityCSS: true, checkOpacity: true })
        )
      );
    expect(slots).toEqual([false]);
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

  // V4 A, already built: the target appears at once in the source as the
  // carry starts -- no transition, no animation, its height the same from
  // the first frame it is drawn.
  test('V4: the target appears at once, with no slide', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId);
    // Every frame's height of the target, from the first it is drawn in.
    await page.evaluate(() => {
      const heights: number[] = [];
      const tick = () => {
        const el = document.querySelector(
          '[data-drop-window-id][data-new-window-target]'
        );
        if (el !== null) {
          heights.push(el.getBoundingClientRect().height);
          document.body.dataset.targetHeights = heights.join(' ');
        }
        if (heights.length < 30) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    const at = await pickUp(page, tabHandle(page, 'a1'));
    await carryOutLeft(page, at);
    // Until the sampler has its 30 frames.
    const sampled = () =>
      page.evaluate(() =>
        (document.body.dataset.targetHeights ?? '')
          .split(' ')
          .filter((h) => h !== '')
          .map(Number)
      );
    await expect.poll(async () => (await sampled()).length).toBe(30);
    const heights = await sampled();
    // PREMISE: sampled from its first frame on, for a while.
    expect(heights.length).toBeGreaterThan(10);
    expect(new Set(heights).size).toBe(1);
    const now = await newWindowTarget(page);
    expect(now?.transition).toBe('0s');
    expect(now?.animations).toBe(0);
    await page.keyboard.press('Escape');
    await page.mouse.up();
  });
});

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
  for (const [name, above, below, want] of spots) {
    test(`${name}`, async ({ context, extensionId }) => {
      const sessions = () => [S1(), S2_TWO_BANDS(), S3()];
      // The engine's own group drag to the spot, then cancelled.
      const control = await openPopup(context, extensionId, sessions(), 'S2');
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

      const page = await openPopup(context, extensionId, sessions(), 'S1');
      const at = await pickUp(page, groupHandle(page, 'alpha'));
      await carryOutLeft(page, at);
      await springOpen(page, 'S2');
      await adoptPhantom(page, 'group:carried:alpha');
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
// is the phantom in the New window target, which takes no window's indent, so
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
// lit as a drop target is another colour, and meant. Also any group's rename
// control revealed, which the same hover rule shows (KAN-100).
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
      ...document.querySelectorAll<HTMLElement>('.group-rename-reveal'),
    ]
      .filter((e) => getComputedStyle(e).opacity === '1')
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
    // nothing inside the New window target.
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
    // PREMISE: it starts at the top, with room to scroll down.
    expect(before).toBe(0);
    expect(
      await page.evaluate(() => {
        let el = document.querySelector(
          '[data-pane="detail"] [data-drop-window-id]'
        )?.parentElement;
        while (
          el &&
          !['auto', 'scroll'].includes(getComputedStyle(el).overflowY)
        )
          el = el.parentElement;
        return el ? el.scrollHeight - el.clientHeight : 0;
      })
    ).toBeGreaterThan(200);
    await page.mouse.wheel(0, 200);
    await expect
      .poll(async () => (await detailPane(page)).scrollTop)
      .toBeGreaterThan(before);
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
  test('a member refused below the list keeps its own box, at its own place', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId);
    const own = await rowBox(page, 'al0');
    const ownTop = (await boxOf(page.locator('[data-drag-row-id="al0"]'))).y;
    const at = await pickUp(page, tabHandle(page, 'al0'));
    const pane = await detailPane(page);
    await page.mouse.move(at.x, pane.bottom - 30, { steps: 8 });
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

// Below the last row, an adopted carry's release is refused and moves
// nothing: the item goes back to its source, which is not a place in this
// list. So nothing is drawn as a landing -- on main the slot sat at the
// phantom's own place, inside the unlit New window target, 1px inside its
// border, and the target's indent on the KAN-362 branch made it show.
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
      typeof f.inTarget === 'boolean'
  );
};

test.describe('below the last row, a carried item draws no slot (KAN-365)', () => {
  const kinds = [
    { kind: 'tab', handle: 'a0', phantom: 'carried:a0' },
    { kind: 'group', handle: 'alpha', phantom: 'group:carried:alpha' },
  ] as const;
  for (const k of kinds) {
    test(`a carried ${k.kind}: no slot, the target unlit, and a release moves nothing`, async ({
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
      await page.mouse.move(at.x, pane.bottom - 30, { steps: 8 });
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
  // draws a slot inside the New window target, the frame the landing is
  // refused on included.
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
      const log: { slot: boolean; inTarget: boolean }[] = [];
      document.body.dataset.slotLog = 'on';
      const frame = () => {
        const target = document
          .querySelector('[data-drop-window-id][data-new-window-target]')
          ?.getBoundingClientRect();
        const slots = [
          ...document.querySelectorAll('[data-drag-landing-slot]'),
        ].filter((el) => getComputedStyle(el).visibility !== 'hidden');
        log.push({
          slot: slots.length > 0,
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
    // PREMISE: the log saw the slot drawn, over the rows.
    expect(frames.some((f) => f.slot)).toBe(true);
    expect(
      frames.filter((f) => f.inTarget).length,
      'frames with a slot inside the target'
    ).toBe(0);
    // And it ended with none at all.
    expect(frames[frames.length - 1]?.slot).toBe(false);
    await page.keyboard.press('Escape');
    await page.mouse.up();
  });

  test('CONTROL: an ordinary drag below the last row keeps its slot at its own place', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId);
    const own = await boxOf(page.locator('[data-drag-row-id="a0"]'));
    const at = await pickUp(page, tabHandle(page, 'a0'));
    const pane = await detailPane(page);
    await page.mouse.move(at.x, pane.bottom - 30, { steps: 8 });
    await settled(page);
    expect(await slotsDrawn(page)).toBe(1);
    const slot = await boxOf(page.locator('[data-drag-landing-slot]'));
    expect(Math.abs(slot.y - own.y)).toBeLessThanOrEqual(1);
    await page.keyboard.press('Escape');
    await page.mouse.up();
  });
});
