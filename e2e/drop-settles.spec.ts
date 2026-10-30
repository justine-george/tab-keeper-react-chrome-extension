import type { Locator, Page, Worker } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { grantedTest } from './fixtures/grantedExtension';
import { buildSession } from './fixtures/seed';
import {
  bandHandle,
  boxOf,
  groupedWindow,
  header,
  openSaved,
  savedWindow,
  session,
  stored,
} from './fixtures/savedWindows';
import {
  groupHandle,
  pickUp,
  tabHandle,
  windowHandle,
} from './fixtures/sessionDrag';
import { carryTo, topOf } from './fixtures/liveWindows';
import { elementLanded } from './fixtures/landed';
import {
  CARD,
  aimAt,
  onto,
  openPopup as openSessionsPopup,
  openTabView as openSessionsTabView,
  selected,
  sessionOf,
} from './fixtures/betweenSessions';

// KAN-835. After a drop every row goes straight from where the drag showed it
// to where the list now draws it. Before, the rows that had stepped aside
// eased their stale shift out over the new order (saved lists: drawn a slot
// too far, then gliding back), and Open now eased back toward the OLD order
// until Chrome's re-read landed, then snapped.
//
// Measured per frame, on the real layout: each row's top from the instant of
// release (a capture-phase pointerup, before the engine's handler) and on
// every animation frame after it. No row may leave the span between its top
// at release and its settled top. The controls hold the other half: a drag
// that moves nothing still eases its rows home.

// Frames recorded after the release: past DURATION.MOVE (280ms) and Open
// now's re-read.
const FRAMES = 40;

type Tops = Record<string, number>;

declare global {
  interface Window {
    __dropFrames?: Tops[] | null;
    __dropTops?: () => Tops;
  }
}

// From the next `trigger` event on (capture, before the engine's own
// handler), records the top of every element `rows` matches, keyed by `key`,
// and of every window block in `blocks`: its top keyed `window <id>`, its
// bottom `window <id> end`, in the blocks' order (KAN-836).
async function recordFrames(
  page: Page,
  rows: string,
  key: string,
  trigger: 'pointerup' | 'keydown',
  blocks?: string
): Promise<void> {
  await page.evaluate(
    ({ rows, key, trigger, frames, blocks }) => {
      window.__dropFrames = null;
      const read = (): Record<string, number> => ({
        ...Object.fromEntries(
          [...document.querySelectorAll(rows)].map((el) => [
            el.getAttribute(key) ?? '',
            el.getBoundingClientRect().top,
          ])
        ),
        ...(blocks === undefined
          ? {}
          : Object.fromEntries(
              [...document.querySelectorAll(blocks)].flatMap((el) => {
                const id = el.getAttribute('data-drop-window-id') ?? '';
                const box = el.getBoundingClientRect();
                return [
                  [`window ${id}`, box.top],
                  [`window ${id} end`, box.bottom],
                ];
              })
            )),
      });
      window.__dropTops = read;
      window.addEventListener(
        trigger,
        () => {
          const out = [read()];
          const tick = () => {
            out.push(read());
            if (out.length <= frames) requestAnimationFrame(tick);
            else window.__dropFrames = out;
          };
          requestAnimationFrame(tick);
        },
        { capture: true, once: true }
      );
    },
    { rows, key, trigger, frames: FRAMES, blocks }
  );
}

// The frames, then the list once more, past the 1s a held drop can wait for
// its move (RowDragArea's SETTLE_TIMEOUT_MS).
async function framesRecorded(page: Page): Promise<Tops[]> {
  await expect
    .poll(() => page.evaluate(() => window.__dropFrames != null), {
      message: 'no frames were recorded',
    })
    .toBe(true);
  await page.waitForTimeout(1200);
  return page.evaluate(() => [
    ...(window.__dropFrames ?? []),
    window.__dropTops?.() ?? {},
  ]);
}

// Every frame where a row is outside [its top at release, its settled top],
// with a pixel of slack for sub-pixel snapping. Not a block's end (KAN-836),
// which moves at once when the block gains or loses a row.
function strays(frames: Tops[]): string[] {
  const first = frames[0] ?? {};
  const last = frames[frames.length - 1] ?? {};
  const out: string[] = [];
  for (const [key, end] of Object.entries(last)) {
    if (key.endsWith(' end')) continue;
    const start = first[key];
    if (start === undefined) continue;
    const lo = Math.min(start, end) - 1;
    const hi = Math.max(start, end) + 1;
    frames.forEach((tops, i) => {
      const top = tops[key];
      if (top !== undefined && (top < lo || top > hi))
        out.push(`${key} frame ${i}: ${top} outside ${start}..${end}`);
    });
  }
  return out;
}

// The rows seen on their way from their top at release to their settled top:
// a frame strictly between the two, 1px clear of both.
function eased(frames: Tops[]): string[] {
  const first = frames[0] ?? {};
  const last = frames[frames.length - 1] ?? {};
  return Object.entries(last).flatMap(([key, end]) => {
    const start = first[key];
    if (start === undefined || Math.abs(end - start) < 4) return [];
    const lo = Math.min(start, end) + 1;
    const hi = Math.max(start, end) - 1;
    return frames.some((tops) => {
      const top = tops[key];
      return top !== undefined && top > lo && top < hi;
    })
      ? [key]
      : [];
  });
}

// KAN-836. Every top that steps more than half a row between two frames: an
// ease over DURATION.MOVE steps a few pixels a frame, a snap a whole row. Not
// a block's end, which moves at once when the block gains or loses a row.
function jumps(frames: Tops[]): string[] {
  const out: string[] = [];
  frames.slice(1).forEach((tops, i) => {
    for (const [key, top] of Object.entries(tops)) {
      if (key.endsWith(' end')) continue;
      const was = frames[i]?.[key];
      if (was !== undefined && Math.abs(top - was) > 16)
        out.push(`${key} frame ${i + 1}: ${was} -> ${top}`);
    }
  });
  return out;
}

// Every frame where a window block starts above the end of the one before
// it. Blocks drawn with no height (the New window block at rest) are skipped.
function overlaps(frames: Tops[]): string[] {
  return frames.flatMap((tops, i) => {
    const blocks = Object.keys(tops).filter(
      (k) =>
        k.startsWith('window ') &&
        !k.endsWith(' end') &&
        (tops[`${k} end`] ?? 0) - (tops[k] ?? 0) >= 1
    );
    return blocks.slice(1).flatMap((k, j) => {
      const above = tops[`${blocks[j]} end`];
      const top = tops[k];
      return above !== undefined && top !== undefined && top < above - 1
        ? [`frame ${i}: ${k} at ${top}, above ${blocks[j]} ends ${above}`]
        : [];
    });
  });
}

// How far `key` went, release to settled.
const travel = (frames: Tops[], key: string): number =>
  (frames[frames.length - 1]?.[key] ?? NaN) - (frames[0]?.[key] ?? NaN);

// PREMISE for every case: the last frames are the settled list (nothing still
// moving), and nothing scrolled, which would move every row at once.
function expectSettled(frames: Tops[]) {
  expect(frames.length).toBe(FRAMES + 2);
  expect(frames[frames.length - 2]).toEqual(frames[frames.length - 3]);
  // And still there a second later: nothing was left waiting.
  expect(frames[frames.length - 1]).toEqual(frames[frames.length - 2]);
}

async function scrollerOf(row: Locator) {
  return row.evaluate((el) => {
    let s: HTMLElement | null = el.parentElement;
    while (s && !['auto', 'scroll'].includes(getComputedStyle(s).overflowY))
      s = s.parentElement;
    return s === null ? null : s.scrollHeight - s.clientHeight;
  });
}

async function expectFits(row: Locator) {
  // PREMISE: the list does not scroll, so no drop scrolls it into view.
  expect(await scrollerOf(row)).toBeLessThanOrEqual(0);
}

// Moves to `y` and rests past DURATION.MOVE, so the rows stand aside.
async function moveTo(page: Page, x: number, y: number) {
  await page.mouse.move(x, y, { steps: 10 });
  await page.waitForTimeout(350);
}

// ---- Saved lists (onMove commits in the drop's own task) ---------------------

const S1 = session('S1', 'Reading', [savedWindow('w1', 'Window one', 6)]);
const sessions = (n: number) =>
  Array.from({ length: n }, (_, i) =>
    buildSession({
      tabGroupId: `L${i}`,
      title: `List ${i}`,
      createdAt: Date.UTC(2026, 8, 1) - i * 60_000,
    })
  );

const savedTabRows = '[data-pane="detail"] [data-drag-row-id^="w1-t"]';
const savedTab = (page: Page, i: number) =>
  page.locator(`[data-pane="detail"] [data-drag-row-id="w1-t${i}"]`);
const storedTabs = async (page: Page) =>
  (await stored(page)).tabGroups
    .find((g) => g.tabGroupId === 'S1')
    ?.windows[0]?.tabs.map((t) => t.tabId);

test.describe('a saved list (KAN-835)', () => {
  test('a tab dropped two rows down: no row strays past where it lands', async ({
    context,
    extensionId,
  }) => {
    const page = await openSaved(context, extensionId, 'popup', {
      sessions: [S1],
    });
    await expectFits(savedTab(page, 0));
    const { x } = await pickUp(page, savedTab(page, 1));
    const below = await boxOf(savedTab(page, 3));
    await moveTo(page, x, below.y + below.height - 6);
    await recordFrames(page, savedTabRows, 'data-drag-row-id', 'pointerup');
    await page.mouse.up();

    const frames = await framesRecorded(page);
    expectSettled(frames);
    expect(await storedTabs(page)).toEqual([
      'w1-t0',
      'w1-t2',
      'w1-t3',
      'w1-t1',
      'w1-t4',
      'w1-t5',
    ]);
    expect(strays(frames)).toEqual([]);
  });

  test('CONTROL: Esc puts the rows back, easing', async ({
    context,
    extensionId,
  }) => {
    const page = await openSaved(context, extensionId, 'popup', {
      sessions: [S1],
    });
    const { x } = await pickUp(page, savedTab(page, 1));
    const below = await boxOf(savedTab(page, 3));
    await moveTo(page, x, below.y + below.height - 6);
    await recordFrames(page, savedTabRows, 'data-drag-row-id', 'keydown');
    await page.keyboard.press('Escape');
    await page.mouse.up();

    const frames = await framesRecorded(page);
    expectSettled(frames);
    expect(await storedTabs(page)).toEqual(
      Array.from({ length: 6 }, (_, i) => `w1-t${i}`)
    );
    // The held row and the two that stood aside glide back.
    expect(eased(frames).sort()).toEqual(['w1-t1', 'w1-t2', 'w1-t3']);
  });

  test('CONTROL: a drop on its own place eases the row home', async ({
    context,
    extensionId,
  }) => {
    const page = await openSaved(context, extensionId, 'popup', {
      sessions: [S1],
    });
    await pickUp(page, savedTab(page, 1));
    await page.waitForTimeout(350);
    await recordFrames(page, savedTabRows, 'data-drag-row-id', 'pointerup');
    await page.mouse.up();

    const frames = await framesRecorded(page);
    expectSettled(frames);
    expect(await storedTabs(page)).toEqual(
      Array.from({ length: 6 }, (_, i) => `w1-t${i}`)
    );
    expect(eased(frames)).toEqual(['w1-t1']);
  });

  test('a window dropped one down, from the folded list', async ({
    context,
    extensionId,
  }) => {
    const S = session('S1', 'Reading', [
      savedWindow('w1', 'One', 2),
      savedWindow('w2', 'Two', 2),
      savedWindow('w3', 'Three', 2),
    ]);
    const page = await openSaved(context, extensionId, 'popup', {
      sessions: [S],
    });
    await expectFits(header(page, 'w1'));
    const { x } = await pickUp(page, header(page, 'w1'));
    // Aimed in the folded list the drag shows.
    const two = await boxOf(header(page, 'w2'));
    await moveTo(page, x, two.y + two.height - 4);
    await recordFrames(
      page,
      '[data-pane="detail"] [data-drag-row-id]',
      'data-drag-row-id',
      'pointerup'
    );
    await page.mouse.up();

    const frames = await framesRecorded(page);
    expectSettled(frames);
    expect(
      (await stored(page)).tabGroups[0]?.windows.map((w) => w.windowId)
    ).toEqual(['w2', 'w1', 'w3']);
    expect(strays(frames)).toEqual([]);
  });

  test('the session list: a session dropped two rows down', async ({
    context,
    extensionId,
  }) => {
    const list = sessions(4);
    const page = await openSaved(context, extensionId, 'popup', {
      sessions: [S1, ...list],
    });
    const row = (id: string) =>
      page.locator(`[data-pane="sessions"] [data-drag-row-id="${id}"]`);
    await expectFits(row('L0'));
    const { x } = await pickUp(page, row('L1'));
    const below = await boxOf(row('L3'));
    await moveTo(page, x, below.y + below.height - 6);
    await recordFrames(
      page,
      '[data-pane="sessions"] [data-drag-row-id]',
      'data-drag-row-id',
      'pointerup'
    );
    await page.mouse.up();

    const frames = await framesRecorded(page);
    expectSettled(frames);
    expect(
      (await stored(page)).tabGroups
        .map((g) => g.tabGroupId)
        .filter((id) => id !== 'S1')
    ).toEqual(['L0', 'L2', 'L3', 'L1']);
    expect(strays(frames)).toEqual([]);
  });
});

// ---- Open now (onMove resolves once Chrome has moved the tabs) ---------------

const dataUrl = (title: string) =>
  `data:text/html,${encodeURIComponent(`<title>${title}</title>`)}`;

async function openWindow(worker: Worker, titles: string[]) {
  const made = await worker.evaluate(async (urls: string[]) => {
    const win = await chrome.windows.create({ focused: false, url: urls });
    return {
      windowId: win?.id ?? -1,
      tabIds: (win?.tabs ?? []).map((t) => t.id ?? -1),
    };
  }, titles.map(dataUrl));
  if (made.windowId === -1 || made.tabIds.length !== titles.length)
    throw new Error('Chrome gave no window or tab ids');
  return {
    windowId: made.windowId,
    // The id of the tab made `i`th.
    tab: (i: number): number => {
      const id = made.tabIds[i];
      if (id === undefined || id === -1) throw new Error(`no tab ${i}`);
      return id;
    },
  };
}

const chromeOrder = (worker: Worker, windowId: number) =>
  worker.evaluate(
    async (windowId) =>
      (await chrome.tabs.query({ windowId })).map((t) => t.id ?? -1),
    windowId
  );

const openTabRows = '[data-pane="open-now"] [data-open-tab-id]';
const openTab = (page: Page, id: number) =>
  page.locator(`[data-pane="open-now"] [data-open-tab-id="${id}"]`);

async function openTabView(
  context: import('@playwright/test').BrowserContext,
  extensionId: string
) {
  const page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`chrome-extension://${extensionId}/index.html?view=tab`);
  // goto resolves before React mounts.
  await page.getByRole('button', { name: 'Sort sessions' }).waitFor();
  return page;
}

async function pickUpOpen(page: Page, row: Locator) {
  const b = await boxOf(row);
  const x = b.x + 60;
  const y = b.y + b.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + 10, { steps: 3 });
  await expect
    .poll(() =>
      page.evaluate(() => document.querySelector('[data-drag-held]') !== null)
    )
    .toBe(true);
  return { x, y: y + 10 };
}

grantedTest.describe('Currently open (KAN-835)', () => {
  grantedTest(
    'a tab dropped two rows down: no row eases back toward the old order',
    async ({ context, extensionId, serviceWorker: worker }) => {
      const page = await openTabView(context, extensionId);
      const a = await openWindow(worker, ['a0', 'a1', 'a2', 'a3', 'a4']);
      const [a0, a1, a2, a3, a4] = [
        a.tab(0),
        a.tab(1),
        a.tab(2),
        a.tab(3),
        a.tab(4),
      ];
      await expect(openTab(page, a4)).toBeVisible();
      await expectFits(openTab(page, a0));
      const { x } = await pickUpOpen(page, openTab(page, a1));
      const below = await boxOf(openTab(page, a3));
      await moveTo(page, x, below.y + below.height - 6);
      await recordFrames(page, openTabRows, 'data-open-tab-id', 'pointerup');
      await page.mouse.up();

      const frames = await framesRecorded(page);
      expectSettled(frames);
      expect(await chromeOrder(worker, a.windowId)).toEqual([
        a0,
        a2,
        a3,
        a1,
        a4,
      ]);
      expect(strays(frames)).toEqual([]);
    }
  );

  grantedTest(
    'a tab dropped into another window: no row eases back toward the old order',
    async ({ context, extensionId, serviceWorker: worker }) => {
      const page = await openTabView(context, extensionId);
      const a = await openWindow(worker, ['a0', 'a1', 'a2']);
      const b = await openWindow(worker, ['b0', 'b1', 'b2']);
      const a1 = a.tab(1);
      const [b0, b1, b2] = [b.tab(0), b.tab(1), b.tab(2)];
      await expect(openTab(page, b2)).toBeVisible();
      await expectFits(openTab(page, b0));
      const { x } = await pickUpOpen(page, openTab(page, a1));
      await moveTo(page, x, (await boxOf(openTab(page, b1))).y + 6);
      await recordFrames(page, openTabRows, 'data-open-tab-id', 'pointerup');
      await page.mouse.up();

      const frames = await framesRecorded(page);
      expectSettled(frames);
      expect(await chromeOrder(worker, b.windowId)).toEqual([b0, a1, b1, b2]);
      expect(strays(frames)).toEqual([]);
    }
  );

  // The flat order stays a0 a1 a2 b0 b1 b2: only the element drawing a2 changes.
  grantedTest(
    "a window's last tab dropped at the head of the next window",
    async ({ context, extensionId, serviceWorker: worker }) => {
      const page = await openTabView(context, extensionId);
      const a = await openWindow(worker, ['a0', 'a1', 'a2']);
      const b = await openWindow(worker, ['b0', 'b1', 'b2']);
      const a2 = a.tab(2);
      const [b0, b1, b2] = [b.tab(0), b.tab(1), b.tab(2)];
      await expect(openTab(page, b2)).toBeVisible();
      await expectFits(openTab(page, b0));
      const { x } = await pickUpOpen(page, openTab(page, a2));
      await moveTo(page, x, (await boxOf(openTab(page, b0))).y + 6);
      await recordFrames(page, openTabRows, 'data-open-tab-id', 'pointerup');
      await page.mouse.up();

      const frames = await framesRecorded(page);
      expectSettled(frames);
      expect(await chromeOrder(worker, b.windowId)).toEqual([a2, b0, b1, b2]);
      expect(strays(frames)).toEqual([]);
    }
  );

  grantedTest(
    'CONTROL: Esc puts the rows back, easing',
    async ({ context, extensionId, serviceWorker: worker }) => {
      const page = await openTabView(context, extensionId);
      const a = await openWindow(worker, ['a0', 'a1', 'a2', 'a3', 'a4']);
      const [a1, a2, a3, a4] = [a.tab(1), a.tab(2), a.tab(3), a.tab(4)];
      await expect(openTab(page, a4)).toBeVisible();
      const { x } = await pickUpOpen(page, openTab(page, a1));
      const below = await boxOf(openTab(page, a3));
      await moveTo(page, x, below.y + below.height - 6);
      await recordFrames(page, openTabRows, 'data-open-tab-id', 'keydown');
      await page.keyboard.press('Escape');
      await page.mouse.up();

      const frames = await framesRecorded(page);
      expectSettled(frames);
      expect(eased(frames).sort()).toEqual(
        [String(a1), String(a2), String(a3)].sort()
      );
    }
  );

  grantedTest(
    'CONTROL: a drop on its own place eases the row home',
    async ({ context, extensionId, serviceWorker: worker }) => {
      const page = await openTabView(context, extensionId);
      const a = await openWindow(worker, ['a0', 'a1', 'a2']);
      const [a0, a1, a2] = [a.tab(0), a.tab(1), a.tab(2)];
      await expect(openTab(page, a2)).toBeVisible();
      await pickUpOpen(page, openTab(page, a1));
      await page.waitForTimeout(350);
      await recordFrames(page, openTabRows, 'data-open-tab-id', 'pointerup');
      await page.mouse.up();

      const frames = await framesRecorded(page);
      expectSettled(frames);
      expect(await chromeOrder(worker, a.windowId)).toEqual([a0, a1, a2]);
      expect(eased(frames)).toEqual([String(a1)]);
    }
  );
});

grantedTest.describe('folding drags (KAN-835)', () => {
  grantedTest(
    'a saved group dropped below the next one',
    async ({ context, extensionId }) => {
      const groups = [
        { groupId: 'alpha', title: 'Alpha', color: 'blue' as const },
        { groupId: 'beta', title: 'Beta', color: 'red' as const },
        { groupId: 'gamma', title: 'Gamma', color: 'green' as const },
      ];
      const page = await openSaved(context, extensionId, 'popup', {
        sessions: [
          session('S1', 'Reading', [groupedWindow('w1', 'One', groups)]),
        ],
      });
      await expectFits(bandHandle(page, 'alpha'));
      const { x } = await pickUp(page, bandHandle(page, 'alpha'));
      const beta = await boxOf(
        page.locator('[data-pane="detail"] [data-band-id="beta"]')
      );
      await moveTo(page, x, beta.y + beta.height - 4);
      await recordFrames(
        page,
        '[data-pane="detail"] [data-drag-row-id]',
        'data-drag-row-id',
        'pointerup'
      );
      await page.mouse.up();

      const frames = await framesRecorded(page);
      expectSettled(frames);
      expect(
        (await stored(page)).tabGroups[0]?.windows[0]?.tabs.map((t) => t.tabId)
      ).toEqual([
        'beta-t0',
        'beta-t1',
        'alpha-t0',
        'alpha-t1',
        'gamma-t0',
        'gamma-t1',
      ]);
      expect(strays(frames)).toEqual([]);
    }
  );

  grantedTest(
    'an Open now group dropped two rows down',
    async ({ context, extensionId, serviceWorker: worker }) => {
      const page = await openTabView(context, extensionId);
      const a = await openWindow(worker, ['a0', 'a1', 'a2', 'a3', 'a4']);
      const [a0, a1, a2, a3, a4] = [
        a.tab(0),
        a.tab(1),
        a.tab(2),
        a.tab(3),
        a.tab(4),
      ];
      await worker.evaluate(
        async ({
          windowId,
          tabIds,
        }: {
          windowId: number;
          tabIds: [number, ...number[]];
        }) => {
          const groupId = await chrome.tabs.group({
            tabIds,
            createProperties: { windowId },
          });
          await chrome.tabGroups.update(groupId, { title: 'G', color: 'blue' });
        },
        { windowId: a.windowId, tabIds: [a1, a2] satisfies [number, number] }
      );
      const title = page
        .locator(`[data-open-window-id="${a.windowId}"]`)
        .getByText('G', { exact: true });
      await expect(title).toBeVisible();
      const { x } = await pickUpOpen(page, title);
      const below = await boxOf(openTab(page, a4));
      await moveTo(page, x, below.y + below.height - 6);
      await recordFrames(page, openTabRows, 'data-open-tab-id', 'pointerup');
      await page.mouse.up();

      const frames = await framesRecorded(page);
      expectSettled(frames);
      expect(await chromeOrder(worker, a.windowId)).toEqual([
        a0,
        a3,
        a4,
        a1,
        a2,
      ]);
      expect(strays(frames)).toEqual([]);
    }
  );
});

// ---- KAN-836: a drop into a window below its own ---------------------------
//
// The source window keeps the dropped row's room until the move is drawn
// (KAN-184); then it closes, and every block below it moves up a row. Window
// blocks carry no transition, so that used to be a snap, headers and all:
// b0 440 -> 408 in one frame. Now the blocks below glide up, and the dropped
// row from where it was let go.

const savedBlocks = '[data-pane="detail"] [data-drop-window-id]';
const savedRowsIn = (ids: string[]) =>
  ids
    .map((w) => `[data-pane="detail"] [data-drag-row-id^="${w}-t"]`)
    .join(', ');
const openBlocks = '[data-pane="open-now"] [data-drop-window-id]';

// Picks up `from`, releases at `y` (by default, at the top of w2's first
// tab), recording frames.
async function savedDrop(
  page: Page,
  from: Locator,
  y?: () => Promise<number>
): Promise<Tops[]> {
  const { x } = await pickUp(page, from);
  await moveTo(
    page,
    x,
    y === undefined ? (await boxOf(savedTabIn(page, 'w2', 0))).y + 6 : await y()
  );
  await recordFrames(
    page,
    savedRowsIn(['w1', 'w2', 'w3']),
    'data-drag-row-id',
    'pointerup',
    savedBlocks
  );
  await page.mouse.up();
  const frames = await framesRecorded(page);
  expectSettled(frames);
  return frames;
}

const savedTabsByWindow = async (page: Page) =>
  (await stored(page)).tabGroups
    .find((g) => g.tabGroupId === 'S1')
    ?.windows.map((w) => w.tabs.map((t) => t.tabId));

async function dropIntoLowerSavedWindow(page: Page) {
  await expectFits(savedTabIn(page, 'w3', 1));
  const frames = await savedDrop(page, savedTabIn(page, 'w1', 2));
  expect(await savedTabsByWindow(page)).toEqual([
    ['w1-t0', 'w1-t1'],
    ['w1-t2', 'w2-t0', 'w2-t1', 'w2-t2'],
    ['w3-t0', 'w3-t1'],
  ]);
  return frames;
}

const S3 = session('S1', 'Reading', [
  savedWindow('w1', 'One', 3),
  savedWindow('w2', 'Two', 3),
  savedWindow('w3', 'Three', 2),
]);
const savedTabIn = (page: Page, w: string, i: number) =>
  page.locator(`[data-pane="detail"] [data-drag-row-id="${w}-t${i}"]`);

test.describe('a drop into a lower window (KAN-836)', () => {
  test('saved: the windows below glide up a row, and the dropped row from where it was let go', async ({
    context,
    extensionId,
  }) => {
    const page = await openSaved(context, extensionId, 'popup', {
      sessions: [S3],
    });
    const frames = await dropIntoLowerSavedWindow(page);
    // PREMISE: the source's room closed, so the blocks below moved up a row.
    expect(travel(frames, 'window w2')).toBeLessThan(-20);
    expect(travel(frames, 'window w3')).toBeLessThan(-20);
    expect(jumps(frames)).toEqual([]);
    expect(strays(frames)).toEqual([]);
  });

  // Every block after the target steps down while the drag runs, the source
  // included (windowShiftsAcross); the source keeps its room, so the blocks
  // below it move up a row when the move is drawn.
  test('saved, into a window above: the windows below the source glide up', async ({
    context,
    extensionId,
  }) => {
    const page = await openSaved(context, extensionId, 'popup', {
      sessions: [S3],
    });
    await expectFits(savedTabIn(page, 'w3', 1));
    const frames = await savedDrop(
      page,
      savedTabIn(page, 'w2', 2),
      async () => (await boxOf(savedTabIn(page, 'w1', 0))).y + 6
    );
    expect(await savedTabsByWindow(page)).toEqual([
      ['w2-t2', 'w1-t0', 'w1-t1', 'w1-t2'],
      ['w2-t0', 'w2-t1'],
      ['w3-t0', 'w3-t1'],
    ]);
    // PREMISE: w3 moved up a row.
    expect(travel(frames, 'window w3')).toBeLessThan(-20);
    expect(jumps(frames)).toEqual([]);
    expect(strays(frames)).toEqual([]);
  });

  // The trailing New window block (KAN-361) becomes a new window, with an id
  // no frame before the drop had.
  test('saved, into the New window block below the last: no window is drawn over another', async ({
    context,
    extensionId,
  }) => {
    const page = await openSaved(context, extensionId, 'popup', {
      sessions: [S3],
    });
    await expectFits(savedTabIn(page, 'w3', 1));
    const frames = await savedDrop(
      page,
      savedTabIn(page, 'w1', 2),
      async () => {
        const box = await boxOf(
          page.locator('[data-pane="detail"] [data-new-window-target="last"]')
        );
        return box.y + box.height / 2;
      }
    );
    const windows = await savedTabsByWindow(page);
    // PREMISE: a fourth window, holding the dropped tab.
    expect(windows?.length).toBe(4);
    expect(windows?.[3]).toEqual(['w1-t2']);
    expect(overlaps(frames)).toEqual([]);
    expect(jumps(frames)).toEqual([]);
  });

  // A window the drag opened by resting on it (KAN-379) folds back when the
  // drop lands elsewhere: its rows go at once, so the blocks below it move at
  // once too, as every fold does, rather than glide through the gap.
  test('saved, past a window the drag opened: the fold back is not a glide', async ({
    context,
    extensionId,
  }) => {
    const page = await openSaved(context, extensionId, 'popup', {
      sessions: [S3],
    });
    await page
      .locator('[data-pane="detail"] [data-drop-window-id="w2"]')
      .getByRole('button', { name: /^Collapse(: |$)/ })
      .click();
    await expect(savedTabIn(page, 'w2', 0)).toHaveCount(0);
    const { x } = await pickUp(page, savedTabIn(page, 'w1', 2));
    const w2 = await boxOf(
      page.locator('[data-pane="detail"] [data-drop-window-id="w2"]')
    );
    await page.mouse.move(x, w2.y + w2.height / 2, { steps: 10 });
    // PREMISE: resting there opened it.
    await expect(savedTabIn(page, 'w2', 0)).toBeVisible({ timeout: 3000 });
    await moveTo(page, x, (await boxOf(savedTabIn(page, 'w3', 0))).y + 6);
    await recordFrames(
      page,
      savedRowsIn(['w1', 'w3']),
      'data-drag-row-id',
      'pointerup',
      savedBlocks
    );
    await page.mouse.up();
    const frames = await framesRecorded(page);
    expectSettled(frames);
    // PREMISE: the drop landed in w3, and w2 kept its tabs.
    const windows = await savedTabsByWindow(page);
    expect(windows?.[1]).toEqual(['w2-t0', 'w2-t1', 'w2-t2']);
    expect(windows?.[2]).toContain('w1-t2');
    // PREMISE: w2 folded back, so w3 rose by more than a row.
    expect(travel(frames, 'window w3')).toBeLessThan(-60);
    // Never seen between where it was and where it goes: a glide always is
    // (a long one can step past `jumps`' half row in its fastest frame).
    expect(eased(frames)).not.toContain('window w3');
  });

  test('CONTROL: with Reduce motion on, the windows below move at once', async ({
    context,
    extensionId,
  }) => {
    const page = await openSaved(context, extensionId, 'popup', {
      sessions: [S3],
    });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const frames = await dropIntoLowerSavedWindow(page);
    expect(
      jumps(frames).filter((j) => j.startsWith('window w2 frame'))
    ).toHaveLength(1);
    expect(strays(frames)).toEqual([]);
  });

  grantedTest(
    'Currently open: the windows below glide up a row, and the dropped row from where it was let go',
    async ({ context, extensionId, serviceWorker: worker }) => {
      const page = await openTabView(context, extensionId);
      const a = await openWindow(worker, ['a0', 'a1', 'a2']);
      const b = await openWindow(worker, ['b0', 'b1', 'b2']);
      const c = await openWindow(worker, ['c0', 'c1']);
      const a2 = a.tab(2);
      const [b0, b1, b2] = [b.tab(0), b.tab(1), b.tab(2)];
      await expect(openTab(page, c.tab(1))).toBeVisible();
      await expectFits(openTab(page, b0));
      const { x } = await pickUpOpen(page, openTab(page, a2));
      await moveTo(page, x, (await boxOf(openTab(page, b0))).y + 6);
      await recordFrames(
        page,
        openTabRows,
        'data-open-tab-id',
        'pointerup',
        openBlocks
      );
      await page.mouse.up();

      const frames = await framesRecorded(page);
      expectSettled(frames);
      expect(await chromeOrder(worker, b.windowId)).toEqual([a2, b0, b1, b2]);
      // PREMISE: the source's room closed, so B and C moved up a row.
      expect(travel(frames, `window ${b.windowId}`)).toBeLessThan(-20);
      expect(travel(frames, `window ${c.windowId}`)).toBeLessThan(-20);
      expect(jumps(frames)).toEqual([]);
      expect(strays(frames)).toEqual([]);
    }
  );
});

// ---- A tab carried from Currently open into a saved session (KAN-849) -------

// The saved detail's rows: the phantom the carry is drawn as while adopted is
// one of them until the drop, then the row it lands as.
const detailRows = '[data-pane="detail"] [data-drag-row-id]';

// Presses `handle` in Currently open and carries it out past the pane's left
// edge: the carry card shows.
async function carryOutOfOpenNow(page: Page, handle: Locator) {
  const b = await boxOf(handle);
  const x = b.x + Math.min(40, b.width / 2);
  const y = b.y + b.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + 10, { steps: 3 });
  const pane = await boxOf(page.locator('[data-pane="open-now"]'));
  await page.mouse.move(pane.x - 40, y + 10, { steps: 6 });
  await expect(page.locator(CARD)).toHaveCount(1);
}

// betweenSessions' spring-open wait for a session row (KAN-379).
const SPRING_OPEN_MS = 600;

grantedTest.describe('carried into a saved session (KAN-849)', () => {
  grantedTest(
    'an open tab dropped above a1: no row below is drawn a row too low, then glides back',
    async ({ context, extensionId, serviceWorker: worker }) => {
      const page = await openSessionsTabView(context, extensionId, false);
      const live = await openWindow(worker, ['Live A']);
      const row = openTab(page, live.tab(0));
      await expect(row).toBeVisible();
      await expectFits(
        page.locator('[data-pane="detail"] [data-drag-row-id="a0"]')
      );
      await carryOutOfOpenNow(page, row);
      await aimAt(page, 'a1', 0.25);
      await recordFrames(page, detailRows, 'data-drag-row-id', 'pointerup');
      await page.mouse.up();

      const frames = await framesRecorded(page);
      expectSettled(frames);
      await expect
        .poll(async () =>
          sessionOf(await stored(page), 'S1').windows[0]?.tabs.map((t) => t.url)
        )
        .toEqual([
          'https://a0.test/',
          dataUrl('Live A'),
          'https://a1.test/',
          'https://a2.test/',
          'https://al0.test/',
          'https://al1.test/',
        ]);
      // PREMISE: a1 stood aside for the slot and keeps that place, so a stale
      // shift eased out over the new row would draw it a row too low.
      expect(Math.abs(travel(frames, 'a1'))).toBeLessThan(1);
      expect(strays(frames)).toEqual([]);
    }
  );

  grantedTest(
    "narrow: an open tab carried out of Currently open's drawer above a1: no row below jumps",
    async ({ context, extensionId, serviceWorker: worker }) => {
      const page = await openSessionsTabView(
        context,
        extensionId,
        false,
        undefined,
        { width: 1024, height: 768 }
      );
      const live = await openWindow(worker, ['Live A']);
      await page.getByRole('button', { name: /^Currently open/ }).click();
      const drawer = page.getByRole('dialog');
      const row = page.locator(`[data-open-tab-id="${live.tab(0)}"]`);
      await expect(row).toBeVisible();
      // KAN-810. It slides in: pressed where it comes to rest.
      await elementLanded(drawer, 'subtree');
      await expectFits(page.locator('[data-drag-row-id="a0"]'));
      const drawerBox = await boxOf(drawer);
      const b = await boxOf(row);
      const y = b.y + b.height / 2;
      await page.mouse.move(b.x + 40, y);
      await page.mouse.down();
      await page.mouse.move(b.x + 40, y + 10, { steps: 3 });
      await page.mouse.move(drawerBox.x - 30, y + 10, { steps: 6 });
      await expect(drawer).toHaveAttribute('data-carry-away', '');
      await aimAt(page, 'a1', 0.25);
      await recordFrames(page, detailRows, 'data-drag-row-id', 'pointerup');
      await page.mouse.up();

      const frames = await framesRecorded(page);
      expectSettled(frames);
      await expect
        .poll(
          async () =>
            sessionOf(await stored(page), 'S1').windows[0]?.tabs[1]?.url
        )
        .toBe(dataUrl('Live A'));
      // PREMISE: a1 stood aside for the slot and keeps that place.
      expect(Math.abs(travel(frames, 'a1'))).toBeLessThan(1);
      expect(strays(frames)).toEqual([]);
    }
  );

  // The popup has no Currently open (KAN-280): its carry into a saved
  // session is from another one, adopted once that session springs open.
  test('the popup: a saved tab carried to another session and dropped above e1: no row below jumps', async ({
    context,
    extensionId,
  }) => {
    const page = await openSessionsPopup(context, extensionId);
    await pickUp(page, page.locator('[data-drag-row-id="a1"]'));
    await onto(page, 'S2');
    await page.waitForTimeout(SPRING_OPEN_MS + 200);
    await expect.poll(() => selected(page)).toBe('S2');
    await expectFits(page.locator('[data-drag-row-id="c0"]'));
    await aimAt(page, 'e1', 0.25);
    await recordFrames(page, detailRows, 'data-drag-row-id', 'pointerup');
    await page.mouse.up();

    const frames = await framesRecorded(page);
    expectSettled(frames);
    await expect
      .poll(async () =>
        sessionOf(await stored(page), 'S2').windows[1]?.tabs.map((t) => t.tabId)
      )
      .toEqual(['e0', expect.any(String), 'e1']);
    // PREMISE: e1 stood aside for the slot and keeps that place.
    expect(Math.abs(travel(frames, 'e1'))).toBeLessThan(1);
    expect(strays(frames)).toEqual([]);
  });

  // A group's and a window's drag fold rows, which unfold at the drop: those
  // rows may travel, but never past where they end.
  grantedTest(
    'an open group carried to another session and dropped between e0 and e1: no row strays',
    async ({ context, extensionId, serviceWorker: worker }) => {
      const page = await openSessionsTabView(context, extensionId, false);
      const live = await openWindow(worker, ['G1', 'G2', 'Loose']);
      const tabIds: [number, number] = [live.tab(0), live.tab(1)];
      await worker.evaluate(
        async ({ windowId, tabIds }) => {
          const groupId = await chrome.tabs.group({
            tabIds,
            createProperties: { windowId },
          });
          await chrome.tabGroups.update(groupId, { title: 'Reading' });
        },
        { windowId: live.windowId, tabIds }
      );
      const handle = page.locator(
        `[data-open-window-id="${live.windowId}"] [data-group-drag-handle]`
      );
      await expect(handle).toBeVisible();
      await carryOutOfOpenNow(page, handle);
      await onto(page, 'S2');
      await page.waitForTimeout(SPRING_OPEN_MS + 200);
      await expect.poll(() => selected(page)).toBe('S2');
      await aimAt(page, 'e1', 0.25);
      await recordFrames(page, detailRows, 'data-drag-row-id', 'pointerup');
      await page.mouse.up();

      const frames = await framesRecorded(page);
      expectSettled(frames);
      await expect
        .poll(async () =>
          sessionOf(await stored(page), 'S2').windows[1]?.tabs.map((t) => t.url)
        )
        .toEqual([
          'https://e0.test/',
          dataUrl('G1'),
          dataUrl('G2'),
          'https://e1.test/',
        ]);
      expect(strays(frames)).toEqual([]);
    }
  );

  grantedTest(
    'an open window carried in above w2: no row strays',
    async ({ context, extensionId, serviceWorker: worker }) => {
      const page = await openSessionsTabView(context, extensionId, false);
      const live = await openWindow(worker, ['W A', 'W B']);
      const handle = page.locator(
        `[data-open-window-id="${live.windowId}"] [data-open-window-drag-handle]`
      );
      await expect(handle).toBeVisible();
      await carryOutOfOpenNow(page, handle);
      await aimAt(page, 'w2', 0.25);
      await recordFrames(page, detailRows, 'data-drag-row-id', 'pointerup');
      await page.mouse.up();

      const frames = await framesRecorded(page);
      expectSettled(frames);
      await expect
        .poll(async () =>
          sessionOf(await stored(page), 'S1').windows.map((w) =>
            w.tabs.map((t) => t.url)
          )
        )
        .toEqual([
          [
            'https://a0.test/',
            'https://a1.test/',
            'https://a2.test/',
            'https://al0.test/',
            'https://al1.test/',
          ],
          [dataUrl('W A'), dataUrl('W B')],
          ['https://b0.test/', 'https://b1.test/'],
        ]);
      expect(strays(frames)).toEqual([]);
    }
  );
});

// KAN-850. A saved item let go in Currently open opens a copy in Chrome, a
// few frames later. The rows that stood aside for it hold there until the
// copy is drawn, and none snaps up a row while the phantom leaves.
grantedTest.describe('carried into Currently open (KAN-850)', () => {
  // A live window A B C D, the carry let go on C's top half: the copy opens
  // between B and C, and C and D keep the place they stood aside to.
  async function carryIntoOpenWindow(
    page: Page,
    worker: Worker,
    handle: Locator
  ) {
    const live = await openWindow(worker, ['A', 'B', 'C', 'D']);
    await expect(openTab(page, live.tab(3))).toBeVisible();
    await expectFits(openTab(page, live.tab(0)));
    await pickUp(page, handle);
    await carryTo(page, await topOf(openTab(page, live.tab(2))));
    await page.waitForTimeout(350);
    return live;
  }

  grantedTest(
    'a saved tab let go between B and C: C and D never leave the place they stood aside to',
    async ({ context, extensionId, serviceWorker: worker }) => {
      const page = await openSessionsTabView(context, extensionId, false);
      const live = await carryIntoOpenWindow(
        page,
        worker,
        tabHandle(page, 'a1')
      );
      await recordFrames(page, openTabRows, 'data-open-tab-id', 'pointerup');
      await page.mouse.up();

      const frames = await framesRecorded(page);
      expectSettled(frames);
      const order = await chromeOrder(worker, live.windowId);
      expect(order).toHaveLength(5);
      expect(order.slice(0, 2)).toEqual([live.tab(0), live.tab(1)]);
      expect(order.slice(3)).toEqual([live.tab(2), live.tab(3)]);
      // PREMISE: C and D stood aside for the slot and keep that place.
      expect(Math.abs(travel(frames, String(live.tab(2))))).toBeLessThan(1);
      expect(Math.abs(travel(frames, String(live.tab(3))))).toBeLessThan(1);
      expect(strays(frames)).toEqual([]);
    }
  );

  grantedTest(
    'a saved group let go between B and C: C and D never leave the place they stood aside to',
    async ({ context, extensionId, serviceWorker: worker }) => {
      const page = await openSessionsTabView(context, extensionId, false);
      const live = await carryIntoOpenWindow(
        page,
        worker,
        groupHandle(page, 'alpha')
      );
      await recordFrames(page, openTabRows, 'data-open-tab-id', 'pointerup');
      await page.mouse.up();

      const frames = await framesRecorded(page);
      expectSettled(frames);
      const order = await chromeOrder(worker, live.windowId);
      expect(order).toHaveLength(6);
      expect(order.slice(4)).toEqual([live.tab(2), live.tab(3)]);
      // PREMISE: the copy draws taller than the row C and D stood aside for,
      // so they end lower, and a snap up would leave that span.
      expect(travel(frames, String(live.tab(2)))).toBeGreaterThan(30);
      expect(travel(frames, String(live.tab(3)))).toBeGreaterThan(30);
      expect(strays(frames)).toEqual([]);
    }
  );

  // Never adopted (r1 3 A): it opens as a new window, and no row stood aside.
  grantedTest(
    'a saved window let go over the list: no row moves',
    async ({ context, extensionId, serviceWorker: worker }) => {
      const page = await openSessionsTabView(context, extensionId, false);
      const live = await openWindow(worker, ['A', 'B', 'C', 'D']);
      await expect(openTab(page, live.tab(3))).toBeVisible();
      await expectFits(openTab(page, live.tab(0)));
      await pickUp(page, windowHandle(page, 'w1'));
      await carryTo(page, await topOf(openTab(page, live.tab(2))));
      await page.waitForTimeout(350);
      const windowIds = () =>
        worker.evaluate(async () =>
          (await chrome.windows.getAll()).map((w) => w.id ?? -1)
        );
      const before = await windowIds();
      // KAN-872. Only the rows already open: the new window draws its tabs,
      // then its group header, for most of a second after the release.
      const rowsBefore = before
        .map((id) => `[data-open-window-id="${id}"] [data-open-tab-id]`)
        .join(', ');
      await recordFrames(page, rowsBefore, 'data-open-tab-id', 'pointerup');
      await page.mouse.up();

      await expect
        .poll(async () => (await windowIds()).length)
        .toBe(before.length + 1);
      const added = (await windowIds()).find((id) => !before.includes(id));
      // PREMISE: the new window is drawn whole (a0 a1 a2, Alpha's header
      // over al0 al1) before the last read, so that read covers its arrival.
      const block = page.locator(
        `[data-pane="open-now"] [data-open-window-id="${added}"]`
      );
      await expect(block.locator('[data-open-tab-id]')).toHaveCount(5);
      await expect(block.locator('[data-band-id]')).toHaveCount(1);
      const frames = await framesRecorded(page);
      expectSettled(frames);
      // PREMISE: the read holds the test page's row and A B C D.
      expect(Object.keys(frames[0] ?? {})).toHaveLength(5);
      for (const key of Object.keys(frames[0] ?? {}))
        expect(Math.abs(travel(frames, key)), key).toBeLessThan(1);
      expect(strays(frames)).toEqual([]);
    }
  );

  // Chrome refuses the tab (as for a window closed mid-carry): nothing is
  // drawn, so the rows ease back.
  grantedTest(
    'CONTROL: a copy Chrome refuses eases C and D back',
    async ({ context, extensionId, serviceWorker: worker }) => {
      const page = await openSessionsTabView(context, extensionId, false);
      const live = await carryIntoOpenWindow(
        page,
        worker,
        tabHandle(page, 'a1')
      );
      await page.evaluate(() => {
        const refuse = (
          _props: chrome.tabs.CreateProperties,
          done?: (tab?: chrome.tabs.Tab) => void
        ) => done?.(undefined);
        Object.defineProperty(chrome.tabs, 'create', { value: refuse });
      });
      await recordFrames(page, openTabRows, 'data-open-tab-id', 'pointerup');
      await page.mouse.up();

      const frames = await framesRecorded(page);
      expectSettled(frames);
      expect(await chromeOrder(worker, live.windowId)).toEqual([
        live.tab(0),
        live.tab(1),
        live.tab(2),
        live.tab(3),
      ]);
      expect(eased(frames).sort()).toEqual(
        [String(live.tab(2)), String(live.tab(3))].sort()
      );
    }
  );
});
