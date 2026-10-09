// KAN-379 on the real artifact: a collapsed window opens under a resting drag, and the one a drop lands in stays open.
// Split from drag-between-sessions.spec.ts (KAN-481); shared helpers in fixtures/betweenSessions.ts.

import { type Page, type BrowserContext, type Locator } from '@playwright/test';
import {
  titleOf,
  settled,
  openPopup,
  openTabView,
  collapseWindow,
  ontoTitle,
  blockOf,
  isFolded,
  layout,
  detailPane,
  logPane,
  paneLog,
  PaneFrame,
  sixByFour,
  S2,
  setDetailScroll,
  W1_START,
  POPUP,
  session,
  win,
  tab,
  PaneBox,
  expectOneUndoRestores,
  sessionOf,
  carryOutLeft,
  selected,
  layoutOf,
} from './fixtures/betweenSessions';
import { grantedTest as test, expect } from './fixtures/grantedExtension';
import {
  pickUp,
  tabHandle,
  boxOf,
  groupHandle,
  windowHandle,
  stored,
  type Point,
} from './fixtures/sessionDrag';
import { holdSweepAt } from './fixtures/dwell';
import { SPRING_OPEN_MS } from '../src/components/common/springOpen';
import {
  LIGHT_THEME,
  WARM_LIGHT_THEME,
  BB_PINK_THEME,
  DARKENHEIMER_THEME,
  BLUE_THEME,
} from '../src/hooks/useThemeColors';
import { seedSettings } from './fixtures/seed';
import { pixelsAt, rgbToHex } from './fixtures/pixels';
import {
  THEMES,
  groupEntries,
  onto,
  adoptPhantom,
  aimAt,
  SLOT_EDGE_TOLERANCE,
  expectSlotAsWideAs,
  rowBox,
  dragRow,
  ownBox,
  belowTheList,
  scrollRange,
} from './fixtures/betweenSessions';

// ---- a collapsed window opens under a resting tab or group (KAN-379) --------

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
  async function expectOpensAbove(
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
    await expectOpensAbove(page, {
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
    await expectOpensAbove(page, {
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
