// KAN-394 P3 on the real artifact: a saved tab, group or window dropped on the save row becomes a new session.
// Split from drag-between-sessions.spec.ts (KAN-480); shared helpers in fixtures/betweenSessions.ts.

import {
  type tabContainerData,
  type TabMasterContainer,
} from '../src/redux/slices/tabContainerDataStateSlice';
import { type Page, type Locator, type BrowserContext } from '@playwright/test';
import { expect, grantedTest as test } from './fixtures/grantedExtension';
import {
  type Point,
  saveRowAim,
  pickUp,
  stored,
  tabHandle,
  groupHandle,
  windowHandle,
  boxOf,
  watchSaveRow,
  saveRowSeen,
} from './fixtures/sessionDrag';
import { rgbToHex } from './fixtures/pixels';
import { LIGHT_THEME } from '../src/hooks/useThemeColors';
import {
  tab,
  win,
  session,
  S1,
  S2,
  S3,
  S4,
  W1_START,
  openPopup,
  openTabView,
  sessionOf,
  layoutOf,
  layout,
  SEEDED_WINDOWS,
  sessionIds,
  chromeNow,
  CARD,
  sessionRow,
  detailPane,
  setDetailScroll,
  carryTargets,
  toasts,
  carryOutLeft,
  settled,
  expectOneUndoRestores,
  sixByFour,
  PaneFrame,
  SaveRowShows,
  logPane,
  paneLog,
  collapseWindow,
  ontoTitle,
  isFolded,
} from './fixtures/betweenSessions';

// ---- the save row makes a new session (KAN-394 P3) --------------------------

// S1 with w1 at bounds no other window has, so "w1's bounds" is checkable.
const W1_BOUNDS = {
  windowHeight: 700,
  windowWidth: 900,
  windowOffsetTop: 40,
  windowOffsetLeft: 60,
};
const S1Placed = (): tabContainerData => {
  const s = S1();
  return {
    ...s,
    windows: s.windows.map((w) =>
      w.windowId === 'w1' ? { ...w, ...W1_BOUNDS } : w
    ),
  };
};
const S1UnnamedW2 = (): tabContainerData => {
  const s = S1();
  return {
    ...s,
    windows: s.windows.map((w) =>
      w.windowId === 'w2' ? { ...w, title: '' } : w
    ),
  };
};

const sessionTarget = (page: Page) => page.locator('[data-new-session-target]');

// The save row as drawn now: one frame of the pane log.
async function saveRowNow(page: Page): Promise<SaveRowShows> {
  await logPane(page, []);
  const frames = await paneLog(page);
  const last = frames[frames.length - 1];
  if (last === undefined) throw new Error('no frame logged');
  return last.saveRow;
}

// Until the running pane log holds `n` frames with a carry's card up.
const loggedCarryFrames = (page: Page, n: number) =>
  expect
    .poll(() =>
      page.evaluate(
        () =>
          (document.body.dataset.paneFrames ?? '').split('"card":true').length -
          1
      )
    )
    .toBeGreaterThanOrEqual(n);

// N1 (revised). The target from the pick-up's frame (held row or card), the controls before it.
function expectSwapAtPickUp(frames: PaneFrame[]): number {
  const start = frames.findIndex((f) => f.held || f.card);
  // PREMISE: the log spans the pick-up.
  expect(start).toBeGreaterThan(0);
  expect(frames.slice(0, start).map((f) => f.saveRow)).toEqual(
    frames.slice(0, start).map(() => 'controls')
  );
  expect(
    frames
      .slice(start)
      .filter((f) => f.saveRow !== 'target' && f.saveRow !== 'lit')
  ).toEqual([]);
  return start;
}

// The target, lit: its fill, border and words.
const targetLook = (page: Page) =>
  sessionTarget(page).evaluate((el) => {
    const cs = getComputedStyle(el);
    return {
      landing: el.hasAttribute('data-landing'),
      fill: cs.backgroundColor,
      border: cs.borderTopStyle,
      label:
        el.querySelector('[data-drop-label] > span:last-child')?.textContent ??
        '',
    };
  });

// Picks `handle` up and takes it straight onto the save row in one move, so
// the pointer passes over no other receiver and no auto-scroll band.
async function ontoSaveRow(page: Page, handle: Locator): Promise<Point> {
  const aim = await saveRowAim(page);
  await pickUp(page, handle);
  await page.mouse.move(aim.x, aim.y);
  await expect(page.locator(CARD)).toHaveCount(1);
  return aim;
}

// After a drop: the new session, first in the list, selected.
async function newSession(page: Page, before: TabMasterContainer) {
  await expect
    .poll(async () => (await stored(page)).tabGroups.length)
    .toBe(before.tabGroups.length + 1);
  const after = await stored(page);
  const made = after.tabGroups[0];
  if (made === undefined) throw new Error('no session first');
  expect(before.tabGroups.map((g) => g.tabGroupId)).not.toContain(
    made.tabGroupId
  );
  expect(after.selectedTabGroupId).toBe(made.tabGroupId);
  return { after, made };
}

// Every session but `except`, every field as it was.
function othersUnchanged(
  before: TabMasterContainer,
  after: TabMasterContainer,
  except: string[]
): void {
  const keep = (c: TabMasterContainer) =>
    c.tabGroups
      .filter((g) => !except.includes(g.tabGroupId))
      .map((g) => ({ ...g, isSelected: undefined }));
  // PREMISE: there are others to compare.
  expect(keep(before).length).toBeGreaterThan(0);
  expect(keep(after)).toEqual(keep(before));
}

async function expectSaveRowBack(page: Page): Promise<void> {
  await expect(page.locator('html[data-carrying]')).toHaveCount(0);
  await expect.poll(() => saveRowNow(page)).toBe('controls');
}

test.describe('a carried tab, group or window dropped on the save row makes a new session (KAN-394 P3)', () => {
  const views = [
    {
      name: 'the popup',
      open: (context: BrowserContext, extensionId: string) =>
        openPopup(context, extensionId, [S1Placed(), S2(), S3(), S4()]),
    },
    {
      name: 'the tab view',
      open: (context: BrowserContext, extensionId: string) =>
        openTabView(context, extensionId, false, [
          S1Placed(),
          S2(),
          S3(),
          S4(),
        ]),
    },
    {
      name: 'the tab view folded, the detail peeked',
      open: (context: BrowserContext, extensionId: string) =>
        openTabView(context, extensionId, true, [S1Placed(), S2(), S3(), S4()]),
    },
  ];
  for (const view of views) {
    test(`a tab in ${view.name}: the target from the pick-up's first frame, lit; let go, a1 alone in a new session named for it, shown`, async ({
      context,
      extensionId,
    }) => {
      const page = await view.open(context, extensionId);
      const before = await stored(page);
      const seeded = sessionOf(before, 'S1');
      const a1 = seeded.windows[0]?.tabs.find((t) => t.tabId === 'a1');
      expect(await saveRowNow(page)).toBe('controls');

      await logPane(page, ['a1', 'tab:a1']);
      await ontoSaveRow(page, tabHandle(page, 'a1'));
      await loggedCarryFrames(page, 6);
      expectSwapAtPickUp(await paneLog(page));
      expect(await targetLook(page)).toEqual({
        landing: true,
        fill: expect.any(String),
        border: 'solid',
        label: 'New session',
      });
      expect(rgbToHex((await targetLook(page)).fill)).toBe(
        LIGHT_THEME.HOVER_COLOR
      );
      await page.mouse.up();

      const { after, made } = await newSession(page, before);
      expect(made.title).toBe('Tab a1');
      expect(made.windows).toHaveLength(1);
      const w = made.windows[0];
      expect(w?.title).toBe('');
      expect(SEEDED_WINDOWS.has(w?.windowId ?? '')).toBe(false);
      expect(w?.tabs).toEqual([a1]);
      expect(w).toMatchObject(W1_BOUNDS);
      expect(layoutOf(sessionOf(after, 'S1'))).toEqual([
        'a0 a2 al0* al1*',
        'b0 b1',
      ]);
      othersUnchanged(before, after, [made.tabGroupId, 'S1']);
      // Shown: its one window, drawn "Window 1", holding a1.
      const detail = page.locator('[data-pane="detail"]');
      await expect(detail.locator('[data-drag-row-id="a1"]')).toBeVisible();
      await expect(detail.locator('[data-drag-row-id="a0"]')).toHaveCount(0);
      await expect(detail.getByText('Window 1', { exact: true })).toBeVisible();
      expect(await toasts(page)).toEqual([]);
      await expect(
        page.getByRole('textbox', { name: 'Name the new session', exact: true })
      ).toHaveValue('');
      await expectSaveRowBack(page);
    });
  }

  // F19 (Justine's pick): a typed name names it, and the field empties as
  // after a save; hidden while carrying, the field is back empty.
  test('a name typed in the field names the new session, and the field empties', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId);
    const before = await stored(page);
    const field = page.getByRole('textbox', {
      name: 'Name the new session',
      exact: true,
    });
    await field.fill('Trip');
    await ontoSaveRow(page, tabHandle(page, 'a1'));
    await page.mouse.up();

    const { made } = await newSession(page, before);
    expect(made.title).toBe('Trip');
    expect(layoutOf(made)).toEqual(['a1']);
    await expect(field).toHaveValue('');
    await expectSaveRowBack(page);
  });

  // The most natural path: the carry goes live over the session list (the
  // layer drives it), then moves onto the save row and lets go there.
  test('a tab carried over the session list first, then moved onto the save row and let go: a new session', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId);
    const before = await stored(page);
    const aim = await saveRowAim(page);
    const at = await pickUp(page, tabHandle(page, 'a1'));
    await carryOutLeft(page, at);
    // PREMISE: the carry is live over the list, not yet on the save row.
    await expect(page.locator('html[data-carrying]')).toHaveCount(1);
    expect(await saveRowNow(page)).toBe('target');
    await page.mouse.move(aim.x, aim.y, { steps: 6 });
    await expect.poll(() => saveRowNow(page)).toBe('lit');
    await page.mouse.up();

    const { made } = await newSession(page, before);
    expect(layoutOf(made)).toEqual(['a1']);
    expect(layoutOf(sessionOf(await stored(page), 'S1'))).toEqual([
      'a0 a2 al0* al1*',
      'b0 b1',
    ]);
    expect(await toasts(page)).toEqual([]);
    await expectSaveRowBack(page);
  });

  test('a group: the band moves into the new session’s window, which is named for it', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId);
    const before = await stored(page);
    await ontoSaveRow(page, groupHandle(page, 'alpha'));
    await expect.poll(() => saveRowNow(page)).toBe('lit');
    await page.mouse.up();

    const { after, made } = await newSession(page, before);
    expect(made.title).toBe('Alpha');
    expect(layoutOf(made)).toEqual(['al0* al1*']);
    expect(made.windows[0]?.chromeTabGroups?.map((g) => g.title)).toEqual([
      'Alpha',
    ]);
    expect(layoutOf(sessionOf(after, 'S1'))).toEqual(['a0 a1 a2', 'b0 b1']);
    await expect(
      page.locator('[data-pane="detail"] [data-group-drag-handle]', {
        hasText: 'Alpha',
      })
    ).toBeVisible();
    expect(await toasts(page)).toEqual([]);
    await expectSaveRowBack(page);
  });

  const windows = [
    { name: 'named', seed: S1, title: 'w2', session: 'w2' },
    { name: 'unnamed', seed: S1UnnamedW2, title: '', session: 'Tab b0' },
  ];
  for (const w of windows) {
    test(`a window, ${w.name}: the new session holds it whole, and is named for it`, async ({
      context,
      extensionId,
    }) => {
      const page = await openPopup(context, extensionId, [
        w.seed(),
        S2(),
        S3(),
        S4(),
      ]);
      const before = await stored(page);
      const w2 = sessionOf(before, 'S1').windows[1];
      await ontoSaveRow(page, windowHandle(page, 'w2'));
      await expect.poll(() => saveRowNow(page)).toBe('lit');
      await page.mouse.up();

      const { after, made } = await newSession(page, before);
      expect(made.title).toBe(w.session);
      expect(made.windows).toEqual([w2]);
      expect(made.windows[0]?.title).toBe(w.title);
      expect(layoutOf(sessionOf(after, 'S1'))).toEqual([W1_START]);
      expect(await toasts(page)).toEqual([]);
      await expectSaveRowBack(page);
    });
  }

  test('N5a: a session’s only window empties it: removed with its toast, and the new session holds the window', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(
      context,
      extensionId,
      [S1(), S2(), S3(), S4()],
      'S3'
    );
    const before = await stored(page);
    const f1 = sessionOf(before, 'S3').windows[0];
    await ontoSaveRow(page, windowHandle(page, 'f1'));
    await page.mouse.up();

    await expect.poll(() => sessionIds(page)).not.toContain('S3');
    const after = await stored(page);
    const made = after.tabGroups[0];
    expect(made?.windows).toEqual([f1]);
    expect(made?.title).toBe('f1');
    expect(after.selectedTabGroupId).toBe(made?.tabGroupId);
    expect((after.deletedTabGroups ?? []).map((d) => d.tabGroupId)).toContain(
      'S3'
    );
    await expect
      .poll(() => toasts(page))
      .toEqual([{ text: '“Third” was empty and was removed.', show: false }]);
  });

  test('one ⌘Z puts both sessions back and takes the new one away', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId);
    const before = await stored(page);
    await ontoSaveRow(page, tabHandle(page, 'a1'));
    await page.mouse.up();
    const { made } = await newSession(page, before);

    await expectOneUndoRestores(page, sessionOf(before, 'S1'));
    await expect
      .poll(() => sessionIds(page))
      .toEqual(before.tabGroups.map((g) => g.tabGroupId));
    const back = await stored(page);
    expect((back.deletedTabGroups ?? []).map((d) => d.tabGroupId)).toContain(
      made.tabGroupId
    );
    othersUnchanged(before, back, ['S1']);
  });

  // N7. Each leaves the store as it was, adds no row, and gives the save
  // row back.
  const cancels = [
    {
      name: 'Esc while lit',
      end: async (page: Page) => {
        await page.keyboard.press('Escape');
        await expect(page.locator(CARD)).toHaveCount(0);
        await page.mouse.up();
      },
    },
    {
      name: 'pointercancel',
      end: async (page: Page) => {
        await page.evaluate(() =>
          window.dispatchEvent(new PointerEvent('pointercancel'))
        );
        await expect(page.locator(CARD)).toHaveCount(0);
        await page.mouse.up();
      },
    },
    {
      name: 'a release over nothing',
      end: async (page: Page) => {
        // Below the last session row, in the list's empty space.
        const last = await boxOf(sessionRow(page, 'S4'));
        await page.mouse.move(last.x + 100, last.y + last.height + 60, {
          steps: 4,
        });
        await expect(sessionTarget(page)).not.toHaveAttribute(
          'data-landing',
          ''
        );
        await expect.poll(() => carryTargets(page)).toEqual([]);
        await page.mouse.up();
        await expect(page.locator(CARD)).toHaveCount(0);
      },
    },
  ];
  for (const c of cancels) {
    test(`N7, ${c.name}: nothing changes`, async ({ context, extensionId }) => {
      const page = await openPopup(context, extensionId);
      const before = await stored(page);
      await ontoSaveRow(page, tabHandle(page, 'a1'));
      await expect.poll(() => saveRowNow(page)).toBe('lit');
      await c.end(page);

      await expectSaveRowBack(page);
      await expect(
        page.locator('[data-pane="sessions"] [data-drag-row-id]')
      ).toHaveCount(before.tabGroups.length);
      expect(await stored(page)).toEqual(before);
      await expect(tabHandle(page, 'a1')).toBeVisible();
    });
  }

  // N6. NEGATIVES, each watched over the whole gesture, after its CONTROL:
  // the same watcher sees a tab carried onto the save row.
  async function controlSeesTheTarget(page: Page): Promise<void> {
    await watchSaveRow(page);
    await ontoSaveRow(page, tabHandle(page, 'a1'));
    await page.keyboard.press('Escape');
    await page.mouse.up();
    expect(await saveRowSeen(page)).toEqual({ carrying: '1', target: '1' });
    await expectSaveRowBack(page);
  }

  // N1 (revised): a saved tab, group or window shows the target from its pick-up, before any carry.
  const pickUps = [
    { what: 'tab', handle: (page: Page) => tabHandle(page, 'a1') },
    { what: 'group', handle: (page: Page) => groupHandle(page, 'alpha') },
    { what: 'window', handle: (page: Page) => windowHandle(page, 'w2') },
  ];
  for (const { what, handle } of pickUps) {
    test(`N1: a ${what} picked up in the detail shows it at once`, async ({
      context,
      extensionId,
    }) => {
      const page = await openPopup(context, extensionId);
      // PREMISE: the save row at rest.
      expect(await saveRowNow(page)).toBe('controls');

      await pickUp(page, handle(page));
      await expect(
        page.locator('[data-pane="detail"] [data-drag-held]')
      ).toHaveCount(1);
      expect(await saveRowNow(page)).toBe('target');
      expect(await targetLook(page)).toEqual({
        landing: false,
        fill: expect.any(String),
        border: 'dashed',
        label: 'New session',
      });
      // No carry: the pointer never left the detail.
      await expect(page.locator('html[data-carrying]')).toHaveCount(0);

      await page.keyboard.press('Escape');
      await page.mouse.up();
      await expectSaveRowBack(page);
    });
  }

  test('N1: a tab dropped inside the detail reorders as ever, and the save row comes back', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId);
    const at = await pickUp(page, tabHandle(page, 'a1'));
    await expect(tabHandle(page, 'a1')).toHaveAttribute('data-drag-held', '');
    expect(await saveRowNow(page)).toBe('target');
    const a2 = await boxOf(tabHandle(page, 'a2'));
    await page.mouse.move(at.x, a2.y + a2.height * 0.75, { steps: 6 });
    await page.mouse.up();
    await expect
      .poll(() => layout(page, 'S1'))
      .toEqual(['a0 a2 a1 al0* al1*', 'b0 b1']);
    await expectSaveRowBack(page);
  });

  test('N6: a session row dragged in the session list never draws it', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId);
    await controlSeesTheTarget(page);

    await watchSaveRow(page);
    const at = await pickUp(page, sessionRow(page, 'S2'));
    await expect(sessionRow(page, 'S2')).toHaveAttribute('data-drag-held', '');
    const s3 = await boxOf(sessionRow(page, 'S3'));
    await page.mouse.move(at.x, s3.y + s3.height * 0.75, { steps: 6 });
    await page.mouse.up();
    await expect(page.locator('[data-drag-held]')).toHaveCount(0);
    expect(await saveRowSeen(page)).toEqual({ carrying: '0', target: '0' });
  });

  test('N6: an Open now tab let go on the save row draws nothing and changes nothing', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const url = (title: string) =>
      `data:text/html,${encodeURIComponent(`<title>${title}</title>`)}`;
    await serviceWorker.evaluate(async (urls) => {
      await chrome.windows.create({ focused: false, url: urls });
    }, ['x0', 'x1'].map(url));
    const page = await openTabView(context, extensionId, false);
    await controlSeesTheTarget(page);
    const before = await stored(page);
    const chromeBefore = await chromeNow(serviceWorker);

    await watchSaveRow(page);
    const aim = await saveRowAim(page);
    const x0 = page.locator('[data-pane="open-now"] [data-open-tab-id]', {
      hasText: 'x0',
    });
    await pickUp(page, x0);
    await expect(
      page.locator('[data-pane="open-now"] [data-drag-held]')
    ).toHaveCount(1);
    await page.mouse.move(aim.x, aim.y, { steps: 8 });
    await page.mouse.up();
    await expect(page.locator('[data-drag-held]')).toHaveCount(0);
    expect(await saveRowSeen(page)).toEqual({ carrying: '0', target: '0' });
    expect(await stored(page)).toEqual(before);
    expect(await chromeNow(serviceWorker)).toBe(chromeBefore);
  });

  test('N6: while searching, a press and move on a tab onto the save row draws nothing and changes nothing', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId);
    await controlSeesTheTarget(page);
    const before = await stored(page);
    const aim = await saveRowAim(page);
    const field = page.getByRole('textbox', {
      name: 'Search saved tabs',
      exact: true,
    });
    await field.fill('Tab a');
    await expect(tabHandle(page, 'b0')).toHaveCount(0);

    await watchSaveRow(page);
    const b = await boxOf(tabHandle(page, 'a1'));
    await page.mouse.move(b.x + 60, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + 60, b.y + b.height / 2 + 8, { steps: 2 });
    await page.mouse.move(aim.x, aim.y, { steps: 8 });
    await page.mouse.up();
    expect(await saveRowSeen(page)).toEqual({ carrying: '0', target: '0' });
    await field.fill('');
    await expect(tabHandle(page, 'b0')).toBeVisible();
    expect(await stored(page)).toEqual(before);
  });

  test('N8, reduced motion: lit in the first frame the pointer is on it', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await logPane(page, ['a1', 'tab:a1']);
    await ontoSaveRow(page, tabHandle(page, 'a1'));
    await loggedCarryFrames(page, 4);
    const frames = await paneLog(page);
    const start = expectSwapAtPickUp(frames);
    // The carry starts on the row, in one move: lit from its first frame.
    const on = frames.findIndex((f) => f.carrying);
    expect(on).toBeGreaterThanOrEqual(start);
    expect(frames.slice(on).map((f) => f.saveRow)).toEqual(
      frames.slice(on).map(() => 'lit')
    );
    await page.keyboard.press('Escape');
    await page.mouse.up();
  });

  // N1 (revised): the list slides down to a place on the target, back on leaving; a release fills it.
  const PLACE = '[data-new-session-place]';

  // Each frame until read: every session row's top, the place's box (or null) and the list's scroll.
  async function logSessionList(page: Page): Promise<void> {
    await page.evaluate(() => {
      const frames: unknown[] = [];
      delete document.body.dataset.listFrames;
      document.body.dataset.listLog = 'on';
      const frame = () => {
        const rows: Record<string, number> = {};
        for (const el of document.querySelectorAll<HTMLElement>(
          '[data-pane="sessions"] [data-drag-row-id]'
        ))
          rows[el.dataset.dragRowId ?? ''] = el.getBoundingClientRect().top;
        const p = document.querySelector('[data-new-session-place]');
        const b = p?.getBoundingClientRect();
        frames.push({
          rows,
          place: b === undefined ? null : { top: b.top, height: b.height },
          scroll:
            document.querySelector('[data-session-column]')?.parentElement
              ?.scrollTop ?? -1,
        });
        document.body.dataset.listFrames = JSON.stringify(frames);
        if (document.body.dataset.listLog === 'on')
          requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });
  }
  interface ListFrame {
    rows: Record<string, number>;
    place: { top: number; height: number } | null;
    scroll: number;
  }
  const isListLog = (x: unknown): x is ListFrame[] =>
    Array.isArray(x) &&
    x.every(
      (f: unknown) =>
        typeof f === 'object' &&
        f !== null &&
        'rows' in f &&
        typeof f.rows === 'object' &&
        'place' in f &&
        'scroll' in f &&
        typeof f.scroll === 'number'
    );
  async function listLog(page: Page): Promise<ListFrame[]> {
    const raw = await page.evaluate(() => {
      document.body.dataset.listLog = 'off';
      return document.body.dataset.listFrames ?? '[]';
    });
    const frames: unknown = JSON.parse(raw);
    if (!isListLog(frames)) throw new Error(`not a list log: ${raw}`);
    return frames;
  }
  const topOf = async (page: Page, id: string) =>
    (await boxOf(sessionRow(page, id))).y;
  // The list at rest: S1's top and the pitch from S1 to S2.
  async function listAtRest(page: Page) {
    const s1 = await topOf(page, 'S1');
    return { s1, pitch: (await topOf(page, 'S2')) - s1 };
  }
  // Strictly between two tops, half a pixel clear of each: a frame mid-slide.
  const midSlide = (top: number, a: number, b: number) =>
    top > Math.min(a, b) + 0.5 && top < Math.max(a, b) - 0.5;

  test('N1: on the target the list slides down a row to an empty dashed place at its top; leaving slides it back', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId);
    const rest = await listAtRest(page);
    // PREMISE: a row and its divider apart, and no place at rest.
    expect(rest.pitch).toBeGreaterThan(30);
    await expect(page.locator(PLACE)).toHaveCount(0);

    await logSessionList(page);
    await ontoSaveRow(page, tabHandle(page, 'a1'));
    await expect.poll(() => saveRowNow(page)).toBe('lit');
    await expect
      .poll(() => topOf(page, 'S1'))
      .toBeCloseTo(rest.s1 + rest.pitch, 1);
    const place = await boxOf(page.locator(PLACE));
    expect(place.y).toBeCloseTo(rest.s1, 1);
    expect(place.height).toBeCloseTo(rest.pitch, 1);
    // Dashed, at the width the target's dashed 1.5px draws at (device pixels).
    const border = (selector: string) =>
      page.locator(selector).evaluate((el) => {
        const cs = getComputedStyle(el);
        return `${cs.borderTopWidth} ${cs.borderTopStyle}`;
      });
    expect(await border(PLACE)).toMatch(/ dashed$/);
    expect((await border(PLACE)).split(' ')[0]).toBe(
      (await border('[data-new-session-target]')).split(' ')[0]
    );
    expect(
      rgbToHex(
        await page
          .locator(PLACE)
          .evaluate((el) => getComputedStyle(el).borderTopColor)
      )
    ).toBe(LIGHT_THEME.LABEL_L2_COLOR);
    // Slid, not jumped: some frame drew S1 between its two places.
    const opening = await listLog(page);
    expect(
      opening.some((f) =>
        midSlide(f.rows.S1 ?? NaN, rest.s1, rest.s1 + rest.pitch)
      )
    ).toBe(true);

    // Into the list, off the target.
    await logSessionList(page);
    const s4 = await boxOf(sessionRow(page, 'S4'));
    await page.mouse.move(s4.x + s4.width / 2, s4.y + s4.height / 2);
    await expect(page.locator(PLACE)).toHaveCount(0);
    await expect.poll(() => topOf(page, 'S1')).toBeCloseTo(rest.s1, 1);
    const closing = await listLog(page);
    expect(
      closing.some((f) =>
        midSlide(f.rows.S1 ?? NaN, rest.s1, rest.s1 + rest.pitch)
      )
    ).toBe(true);
    await page.keyboard.press('Escape');
    await page.mouse.up();
  });

  test('N1: a release on it puts the new session first and selected in the place, with no frame that jumps', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId);
    const before = await stored(page);
    const rest = await listAtRest(page);
    await ontoSaveRow(page, tabHandle(page, 'a1'));
    await expect
      .poll(() => topOf(page, 'S1'))
      .toBeCloseTo(rest.s1 + rest.pitch, 1);

    await logSessionList(page);
    // PREMISE: the log is running with the place open.
    await expect
      .poll(() =>
        page
          .evaluate(() => document.body.dataset.listFrames ?? '')
          .then((raw) => raw.length > 2)
      )
      .toBe(true);
    await page.mouse.up();
    const { made } = await newSession(page, before);
    await expect(page.locator(PLACE)).toHaveCount(0);
    const frames = await listLog(page);
    const id = made.tabGroupId;

    // The new row is first, and selected.
    await expect(
      page.locator('[data-pane="sessions"] [data-drag-row-id]').first()
    ).toHaveAttribute('data-drag-row-id', id);
    // Every frame: S1 where the open place put it, never back up.
    const s1Tops = frames.map((f) => f.rows.S1);
    expect(
      s1Tops.filter((t) => Math.abs((t ?? NaN) - (rest.s1 + rest.pitch)) > 0.5)
    ).toEqual([]);
    // From its first frame, the new row stands where the place stood.
    const first = frames.findIndex((f) => f.rows[id] !== undefined);
    // PREMISE: the log spans the drop.
    expect(first).toBeGreaterThan(0);
    expect(
      frames
        .slice(first)
        .filter((f) => Math.abs((f.rows[id] ?? NaN) - rest.s1) > 0.5)
    ).toEqual([]);
    // The place is gone in the frame the row comes in.
    expect(frames[first]?.place).toBeNull();
    expect(frames[first - 1]?.place).not.toBeNull();
  });

  test('N1: from the open place straight onto S2, the session list aims at S2, and the drop lands there', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId);
    const rest = await listAtRest(page);
    const s2 = await boxOf(sessionRow(page, 'S2'));
    await ontoSaveRow(page, tabHandle(page, 'a1'));
    await expect
      .poll(() => topOf(page, 'S1'))
      .toBeCloseTo(rest.s1 + rest.pitch, 1);

    // In one move, onto S2's middle at rest: the list is still slid down.
    await page.mouse.move(s2.x + s2.width / 2, s2.y + s2.height / 2);
    await expect.poll(() => carryTargets(page)).toEqual(['S2']);
    await page.mouse.up();

    await expect
      .poll(async () => layoutOf(sessionOf(await stored(page), 'S2'))[0])
      .toBe('a1');
    expect(layoutOf(sessionOf(await stored(page), 'S1'))).toEqual([
      'a0 a2 al0* al1*',
      'b0 b1',
    ]);
  });

  // Scrolled list (picked A): ten more sessions, so the list scrolls.
  const longList = () => [
    S1(),
    S2(),
    S3(),
    S4(),
    ...Array.from({ length: 10 }, (_, i) =>
      session(`X${i}`, `Extra ${i}`, [win(`xw${i}`, [tab(`x${i}`)])])
    ),
  ];
  const sessionScroller = (page: Page) =>
    page.locator('[data-pane="sessions"] [data-session-column]').locator('..');
  const SCROLLED = 150;
  // Scrolls the list to SCROLLED; returns its box.
  async function scrollList(page: Page) {
    const list = sessionScroller(page);
    // PREMISE: the list can scroll that far.
    expect(
      await list.evaluate((el) => el.scrollHeight - el.clientHeight)
    ).toBeGreaterThan(SCROLLED);
    await list.evaluate((el, top) => {
      el.scrollTop = top;
    }, SCROLLED);
    await expect.poll(() => list.evaluate((el) => el.scrollTop)).toBe(SCROLLED);
    return boxOf(list);
  }
  const inBox = (
    b: { y: number; height: number },
    box: { y: number; height: number }
  ) => b.y >= box.y - 0.5 && b.y + b.height <= box.y + box.height + 0.5;

  test('N1, scrolled list: on the target it jumps to its top with the place in view; the release lands first, selected, in view, and the list never moves', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId, longList());
    const rest = await listAtRest(page);
    const box = await scrollList(page);
    const list = sessionScroller(page);

    await logSessionList(page);
    await ontoSaveRow(page, tabHandle(page, 'a1'));
    await expect.poll(() => list.evaluate((el) => el.scrollTop)).toBe(0);
    await expect
      .poll(() => topOf(page, 'S1'))
      .toBeCloseTo(rest.s1 + rest.pitch, 1);
    expect(inBox(await boxOf(page.locator(PLACE)), box)).toBe(true);
    const opening = await listLog(page);
    // PREMISE: the log saw it scrolled.
    expect(opening[0]?.scroll).toBe(SCROLLED);
    // At once: no frame between the two scrolls.
    expect(opening.filter((f) => f.scroll > 0 && f.scroll < SCROLLED)).toEqual(
      []
    );

    const before = await stored(page);
    await logSessionList(page);
    await expect
      .poll(() =>
        page
          .evaluate(() => document.body.dataset.listFrames ?? '')
          .then((raw) => raw.length > 2)
      )
      .toBe(true);
    await page.mouse.up();
    const { made } = await newSession(page, before);
    const id = made.tabGroupId;
    const row = sessionRow(page, id);
    await expect(
      page.locator('[data-pane="sessions"] [data-drag-row-id]').first()
    ).toHaveAttribute('data-drag-row-id', id);
    expect(inBox(await boxOf(row), box)).toBe(true);
    // Past KAN-143's follow-up frame.
    await page.waitForTimeout(300);
    const frames = await listLog(page);
    expect(frames.filter((f) => f.scroll !== 0)).toEqual([]);
    expect(
      frames.filter(
        (f) => Math.abs((f.rows.S1 ?? NaN) - (rest.s1 + rest.pitch)) > 0.5
      )
    ).toEqual([]);
    const first = frames.findIndex((f) => f.rows[id] !== undefined);
    // PREMISE: the log spans the drop.
    expect(first).toBeGreaterThan(0);
    expect(
      frames
        .slice(first)
        .filter((f) => Math.abs((f.rows[id] ?? NaN) - rest.s1) > 0.5)
    ).toEqual([]);
  });

  test('N1, scrolled list: from the place straight onto S2, the list aims at S2 where it now is, and the drop lands there', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId, longList());
    const rest = await listAtRest(page);
    const s2 = await boxOf(sessionRow(page, 'S2'));
    await scrollList(page);
    await ontoSaveRow(page, tabHandle(page, 'a1'));
    await expect
      .poll(() => sessionScroller(page).evaluate((el) => el.scrollTop))
      .toBe(0);
    await expect
      .poll(() => topOf(page, 'S1'))
      .toBeCloseTo(rest.s1 + rest.pitch, 1);

    // S2's middle at scroll 0, at rest: read before the list was scrolled.
    await page.mouse.move(s2.x + s2.width / 2, s2.y + s2.height / 2);
    await expect.poll(() => carryTargets(page)).toEqual(['S2']);
    await page.mouse.up();

    await expect
      .poll(async () => layoutOf(sessionOf(await stored(page), 'S2'))[0])
      .toBe('a1');
  });

  test('N1, reduced motion: the place opens and closes without a slide', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const rest = await listAtRest(page);
    await logSessionList(page);
    await ontoSaveRow(page, tabHandle(page, 'a1'));
    await expect(page.locator(PLACE)).toHaveCount(1);
    await expect
      .poll(() => topOf(page, 'S1'))
      .toBeCloseTo(rest.s1 + rest.pitch, 1);
    const s4 = await boxOf(sessionRow(page, 'S4'));
    await page.mouse.move(s4.x + s4.width / 2, s4.y + s4.height / 2);
    await expect(page.locator(PLACE)).toHaveCount(0);
    await expect.poll(() => topOf(page, 'S1')).toBeCloseTo(rest.s1, 1);
    const frames = await listLog(page);
    // PREMISE: the log saw it open.
    expect(frames.some((f) => f.place !== null)).toBe(true);
    expect(
      frames.filter((f) =>
        midSlide(f.rows.S1 ?? NaN, rest.s1, rest.s1 + rest.pitch)
      )
    ).toEqual([]);
    await page.keyboard.press('Escape');
    await page.mouse.up();
  });

  test('a window the carry spring-opened on its way folds back after the drop (KAN-379)', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId);
    const before = await stored(page);
    const aim = await saveRowAim(page);
    await collapseWindow(page, 'w2');
    const at = await pickUp(page, tabHandle(page, 'a1'));
    await ontoTitle(page, 'w2', at.x);
    await expect(tabHandle(page, 'b0')).toBeVisible();
    await page.mouse.move(aim.x, aim.y);
    await expect.poll(() => saveRowNow(page)).toBe('lit');
    await page.mouse.up();
    const { made } = await newSession(page, before);
    expect(layoutOf(made)).toEqual(['a1']);

    // By its title: the row's middle is its Open button.
    await sessionRow(page, 'S1').click({ position: { x: 16, y: 16 } });
    await expect(tabHandle(page, 'a0')).toBeVisible();
    expect(await isFolded(page, 'w2')).toBe(true);
  });

  test('scrolled: from a detail scrolled to 200, the scroll stays put until the release', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId, [
      sixByFour('S1', 'Six', 'y'),
      S2(),
    ]);
    const before = await stored(page);
    expect(await setDetailScroll(page, 200)).toBe(200);
    const pane = await detailPane(page);
    // A tab clear of both 48px auto-scroll bands.
    const tabId = await page.evaluate(
      ({ top, bottom }) => {
        for (const row of document.querySelectorAll<HTMLElement>(
          '[data-pane="detail"] [data-drag-row-id^="y"]'
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
    await ontoSaveRow(page, tabHandle(page, tabId));
    await expect.poll(() => saveRowNow(page)).toBe('lit');
    await settled(page);
    expect((await detailPane(page)).scrollTop).toBe(200);
    await page.mouse.up();

    const { made } = await newSession(page, before);
    expect(layoutOf(made)).toEqual([tabId]);
  });
});
