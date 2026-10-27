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
import { pickUp } from './fixtures/sessionDrag';

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
// handler), records the top of every element `rows` matches, keyed by `key`.
async function recordFrames(
  page: Page,
  rows: string,
  key: string,
  trigger: 'pointerup' | 'keydown'
): Promise<void> {
  await page.evaluate(
    ({ rows, key, trigger, frames }) => {
      window.__dropFrames = null;
      const read = (): Record<string, number> =>
        Object.fromEntries(
          [...document.querySelectorAll(rows)].map((el) => [
            el.getAttribute(key) ?? '',
            el.getBoundingClientRect().top,
          ])
        );
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
    { rows, key, trigger, frames: FRAMES }
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
// with a pixel of slack for sub-pixel snapping.
function strays(frames: Tops[]): string[] {
  const first = frames[0] ?? {};
  const last = frames[frames.length - 1] ?? {};
  const out: string[] = [];
  for (const [key, end] of Object.entries(last)) {
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
