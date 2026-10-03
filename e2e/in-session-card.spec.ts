// KAN-354 and KAN-355 on the real artifact: a drag inside a saved session's
// tab, group or window list is drawn by the card at the pointer, and the row
// it holds hides but keeps its room.
//
// What jsdom cannot show, and so what this file is for: src/App.css. jsdom
// never loads it, and its `!important` lift shadow on a held TAB is exactly
// what KAN-355 is -- the adopted phantom, invisible since KAN-350, still cast
// that shadow as an empty box at the pointer (measured on main:
// `rgba(0,0,0,0.35) 0 2px 8px`, and over Gamma also
// `rgb(129,201,149) 4px 0 0 inset`, the KAN-164 stripe).
//
// Organised by claim, a describe each:
//
//   KAN-355    the adopted phantom casts no shadow
//   C1         a saved list's drag is drawn by the card (tab, group, window;
//              the popup and the tab view)
//   C2         the session list and Open now keep their lifted row, no card
//   KAN-359    the pick-up, frame by frame: card and hidden row arrive at once
//   C3         a drag into another window outlines the room it leaves there
//              (both directions, a group, Q2, Q3, and none inside one window)
//   hand-off   a carry keeps the drag's card element
//   click      the release's click lands on the hidden row, and is eaten
//   scrolled   auto-scroll, a folded window drag, and the outline, scrolled
//   contrast   the outline and the slot in all five themes, reported
//
// Driven as the popup (790x550) unless the tab view is named, with the
// tabGroups grant (grantedTest) so a group band exists at all.

import type { BrowserContext, Locator, Page } from '@playwright/test';

import { grantedTest as test, expect } from './fixtures/grantedExtension';
import {
  buildContainer,
  buildSession,
  seedSessions,
  seedSettings,
} from './fixtures/seed';
import type {
  TabMasterContainer,
  tabContainerData,
} from '../src/redux/slices/tabContainerDataStateSlice';
import { isValidTabMasterContainer } from '../src/utils/functions/local';

const POPUP = { width: 790, height: 550 };
const TAB_VIEW = { width: 1280, height: 800 };

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
// w2 two loose tabs. S2, the carry's target: d1 holds two loose tabs, the
// group gamma, then one more loose tab; d2 two loose tabs. The same shapes
// drag-between-sessions.spec.ts uses, small enough that no pane scrolls in
// the popup.
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
const S2 = () =>
  session('S2', 'Target', [
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

// S4, Q2: so0 is the ONLY member of the group solo, so carrying it out of w1
// takes the whole band with it (KAN-169) -- a room taller than one row.
const S4 = () =>
  session('S4', 'Lone member', [
    win(
      'w1',
      [tab('x0'), tab('so0', 'solo'), tab('x1')],
      [{ groupId: 'solo', title: 'Solo', color: 'red' }]
    ),
    win('w2', [tab('y0'), tab('y1')]),
  ]);

// S5, Q3 with a non-zero distance: the group beta is NOT its window's last
// item, so the room it leaves is below its own place.
const S5 = () =>
  session('S5', 'Middle group', [
    win(
      'w1',
      [tab('x0'), tab('be0', 'beta'), tab('be1', 'beta'), tab('x1')],
      [{ groupId: 'beta', title: 'Beta', color: 'purple' }]
    ),
    win('w2', [tab('y0'), tab('y1')]),
  ]);

// S6, Review Focus 3: a session far taller than the popup's pane. w1 holds
// 30 loose tabs, w2 two.
const LONG_ROWS = Array.from(
  { length: 30 },
  (_, i) => `t${String(i).padStart(2, '0')}`
);
const S6 = () =>
  session('S6', 'Long', [
    win(
      'w1',
      LONG_ROWS.map((id) => tab(id))
    ),
    win('w2', [tab('u0'), tab('u1')]),
  ]);

// S7, KAN-154/157: five windows of six tabs, scrolled; a window drag folds
// them all, and the browser clamps the scroll.
const S7 = () =>
  session(
    'S7',
    'Many windows',
    ['w1', 'w2', 'w3', 'w4', 'w5'].map((w) =>
      win(
        w,
        [0, 1, 2, 3, 4, 5].map((i) => tab(`${w}t${i}`))
      )
    )
  );

interface Opening {
  // The sessions seeded, and which is open. S1 of S1-S3 unless named.
  sessions?: tabContainerData[];
  selected?: string;
  // The tab view (index.html?view=tab) at 1280x800, instead of the popup.
  tabView?: boolean;
  // The theme, by its stored name (Light, WarmLight, BBPink, Darkenheimer,
  // Blue: Paper, Parchment, Petal, Graphite, Ink).
  theme?: string;
}

async function openPopup(
  context: BrowserContext,
  extensionId: string,
  {
    sessions = [S1(), S2(), S3()],
    selected = 'S1',
    tabView = false,
    theme,
  }: Opening = {}
): Promise<Page> {
  await seedSessions(context, {
    ...buildContainer(
      sessions.map((s) => ({ ...s, isSelected: s.tabGroupId === selected }))
    ),
    selectedTabGroupId: selected,
  });
  // The tab view folds the saved session away by default (KAN-280 O4).
  const settings: Record<string, unknown> = {
    ...(tabView ? { foldSavedSessionInTabView: false } : {}),
    ...(theme === undefined ? {} : { theme }),
  };
  if (Object.keys(settings).length > 0) await seedSettings(context, settings);
  const page = await context.newPage();
  await page.setViewportSize(tabView ? TAB_VIEW : POPUP);
  await page.goto(
    `chrome-extension://${extensionId}/index.html${tabView ? '?view=tab' : ''}`
  );
  // goto resolves before React mounts (KAN-105). Every test crosses this
  // barrier before its first raw evaluate: the open session's first window
  // drawn.
  await expect(page.locator('[data-drag-row-id="w1"]')).toBeVisible();
  return page;
}

// Which session is selected, as the app stores it.
async function selected(page: Page): Promise<string | null> {
  const raw = await page.evaluate(() =>
    localStorage.getItem('tabContainerData')
  );
  const parsed: unknown = JSON.parse(raw ?? 'null');
  if (!isValidTabMasterContainer(parsed)) {
    throw new Error(`tabContainerData is not a container: ${raw}`);
  }
  const container: TabMasterContainer = parsed;
  return container.selectedTabGroupId;
}

// ---- the page ---------------------------------------------------------------

const DRAG_CARD = '[data-drag-card]';
const CARRY_CARD = '[data-carry-card]';

const row = (page: Page, rowId: string): Locator =>
  page.locator(`[data-drag-row-id="${rowId}"]`);
const sessionRow = (page: Page, id: string): Locator =>
  page.locator(`[data-pane="sessions"] [data-drag-row-id="${id}"]`);
const groupHandle = (page: Page, groupId: string): Locator =>
  page.locator(
    `[data-drag-row-id="group:${groupId}"] [data-group-drag-handle]`
  );
const windowHandle = (page: Page, windowId: string): Locator =>
  page.locator(`[data-drag-row-id="${windowId}"] [data-window-drag-handle]`);

async function boxOf(loc: Locator) {
  const b = await loc.boundingBox();
  if (b === null) throw new Error(`no box for ${loc.toString()}`);
  return b;
}

// What a held row paints, read from the browser's own cascade: App.css
// included, which is the point (see the header).
const shadowOf = (held: Locator): Promise<string> =>
  held.evaluate((el) => getComputedStyle(el).boxShadow);

// The opacity of each of the held row's own children, the slots it draws
// excluded (the landing slot, and a cross-window drag's outline of the room
// it leaves): what hides the row's content while the row keeps its box.
const contentOpacities = (held: Locator): Promise<string[]> =>
  held.evaluate((el) =>
    [...el.children]
      .filter(
        (c) =>
          !c.hasAttribute('data-drag-landing-slot') &&
          !c.hasAttribute('data-drag-source-room')
      )
      .map((c) => getComputedStyle(c).opacity)
  );

// The held row's landing slot's computed opacity, or null with none drawn.
const slotOpacity = (held: Locator): Promise<string | null> =>
  held.evaluate((el) => {
    const slot = el.querySelector(':scope > [data-drag-landing-slot]');
    return slot === null ? null : getComputedStyle(slot).opacity;
  });

// Where the card is drawn, relative to the pointer: CarryLayer puts its
// corner 8px right of and 4px below it.
async function expectCardAt(page: Page, at: Point): Promise<void> {
  await expect
    .poll(async () => {
      const b = await boxOf(page.locator(DRAG_CARD));
      return { dx: Math.round(b.x - at.x), dy: Math.round(b.y - at.y) };
    })
    .toEqual({ dx: 8, dy: 4 });
}

// Everything the held row draws of itself, read as it reaches the screen:
// each element under it with a box (its slots excepted), at the product of
// its own and every ancestor's opacity, up to the page. The wrapper itself
// paints only a shadow, a background or a border, so those are read too.
const paintedOfHeld = (held: Locator) =>
  held.evaluate((el) => {
    const effective = (e: Element) => {
      let o = 1;
      for (let a: Element | null = e; a !== null; a = a.parentElement)
        o *= Number(getComputedStyle(a).opacity);
      return o;
    };
    let parts = 0;
    let max = 0;
    let worst = '';
    for (const d of el.querySelectorAll('*')) {
      if (
        d.closest('[data-drag-landing-slot], [data-drag-source-room]') !== null
      )
        continue;
      const r = d.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (getComputedStyle(d).visibility === 'hidden') continue;
      parts++;
      const o = effective(d);
      if (o > max) {
        max = o;
        worst = `${d.tagName} ${d.className}`;
      }
    }
    const own = getComputedStyle(el);
    return {
      parts,
      max,
      worst,
      wrapper: {
        background: own.backgroundColor,
        shadow: own.boxShadow,
        border: own.borderTopWidth,
      },
    };
  });

async function expectNothingOfHeldDrawn(held: Locator): Promise<void> {
  const painted = await paintedOfHeld(held);
  // PREMISE: the row has parts to hide.
  expect(painted.parts).toBeGreaterThan(0);
  expect(painted).toMatchObject({
    max: 0,
    wrapper: { background: 'rgba(0, 0, 0, 0)', shadow: 'none', border: '0px' },
  });
}

// The held row's own place: its box with the pointer's translate taken out.
const ownPlaceOf = (held: Locator) =>
  held.evaluate((el) => {
    if (!(el instanceof HTMLElement)) throw new Error('not an HTMLElement');
    const shift = Number(
      /translateY\((-?[\d.]+)px\)/.exec(el.style.transform)?.[1] ?? 0
    );
    const r = el.getBoundingClientRect();
    return { top: r.top - shift, height: r.height };
  });

// Where an element is drawn, transforms included.
const drawn = (loc: Locator) =>
  loc.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, height: r.height, left: r.left };
  });

// ---- the gesture ------------------------------------------------------------

interface Point {
  x: number;
  y: number;
}

// Presses `handle` and drags it 8px down: past the activation distance (5px),
// and still over the row's own place, where the landing slot is the row's own.
async function pickUp(page: Page, handle: Locator): Promise<Point> {
  const b = await boxOf(handle);
  const x = b.x + Math.min(60, b.width / 2);
  const y = b.y + b.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + 8, { steps: 2 });
  return { x, y: y + 8 };
}

// Out of the detail to the left, at the same height, onto the session list
// -- the only place a saved drag is handed to the carry (KAN-352).
async function carryOutLeft(page: Page, from: Point): Promise<void> {
  const list = await boxOf(page.locator('[data-pane="sessions"]'));
  await page.mouse.move(list.x + list.width / 2, from.y, { steps: 6 });
  await expect(page.locator(CARRY_CARD)).toHaveCount(1);
}

// Rests on a session's row until it opens (KAN-350 S1 A).
async function springOpen(page: Page, sessionId: string): Promise<void> {
  const b = await boxOf(sessionRow(page, sessionId));
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 5 });
  await expect.poll(() => selected(page), { timeout: 3000 }).toBe(sessionId);
}

// Into the opened session, onto the phantom's own place, until the list
// adopts it and nothing is shifted (drag-between-sessions.spec.ts's
// adoptPhantom, which explains the loop).
async function adoptPhantom(page: Page, phantomId: string): Promise<Locator> {
  const phantom = row(page, phantomId);
  await expect(phantom).toBeAttached();
  const b = await boxOf(phantom);
  const x = b.x + Math.min(60, b.width / 2);
  await page.mouse.move(x, b.y + b.height / 2, { steps: 8 });
  await expect(phantom).toHaveAttribute('data-drag-held', '');
  const ownCentre = () =>
    phantom.evaluate((el) => {
      if (!(el instanceof HTMLElement)) throw new Error('not an HTMLElement');
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
  await settled(page);
  return phantom;
}

// The pointer to `frac` of the way down `rowId`'s box, as it is now.
async function aimAt(page: Page, rowId: string, frac: number): Promise<Point> {
  const b = await boxOf(row(page, rowId));
  const at = { x: b.x + Math.min(60, b.width / 2), y: b.y + b.height * frac };
  await page.mouse.move(at.x, at.y, { steps: 8 });
  await settled(page);
  return at;
}

// Until every row the preview moved has arrived: two frames, then each
// running transition's own end, until none is left.
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

// Esc with the press still down, then its release: ends any drag here
// without committing it.
async function cancel(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await page.mouse.up();
}

// ============================================================================

test.describe('KAN-355: the adopted phantom casts no shadow', () => {
  test('held at its own place and over a group band', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId);
    const at = await pickUp(page, row(page, 'a1'));
    await carryOutLeft(page, at);
    await springOpen(page, 'S2');
    const phantom = await adoptPhantom(page, 'carried:a1');

    // At its own place. Soft, so the band below is still measured.
    await expect.soft.poll(() => shadowOf(phantom)).toBe('none');

    // Over Gamma's band: the band is marked, and the phantom wears no
    // stripe (KAN-354 C4 A) and no shadow.
    await aimAt(page, 'ga1', 0.25);
    // PREMISE: the pointer is over the band, and the band is the target.
    await expect(page.locator('[data-band-id="gamma"]')).toHaveAttribute(
      'data-drop-target',
      ''
    );
    await expect.poll(() => shadowOf(phantom)).toBe('none');
    // What App.css keys the exclusion on.
    await expect(phantom).toHaveAttribute('data-held-as-card', '');

    await cancel(page);
  });

  // The polls above wait until `none`, so they cannot see a shadow that
  // lasts a frame or two. And there is a gap to fear: `activate` writes
  // `data-drag-held` straight to the DOM at the adoption, while
  // `data-held-as-card` comes with the engine's next render. Every frame
  // across the adoption is read, from before it until well after.
  const SHADOWED_HELD = (frames: PickUpFrame[]) =>
    frames.filter((f) => f.held && f.shadow !== 'none');
  const frameReport = (frames: PickUpFrame[]) =>
    [
      `${frames.length} frames, ${
        SHADOWED_HELD(frames).length
      } held with a shadow`,
      ...framePictures(frames),
    ].join('\n');

  test('no frame of an adoption, or of a re-adoption, casts it', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId);
    const at = await pickUp(page, row(page, 'a1'));
    await carryOutLeft(page, at);
    await springOpen(page, 'S2');

    await startFrameLog(page, 'carried:a1');
    await adoptPhantom(page, 'carried:a1');
    await frames(page, 10);
    const first = await stopFrameLog(page);
    await test.info().attach('adoption-frames', {
      body: frameReport(first),
      contentType: 'text/plain',
    });

    // Back out onto the session list, below its rows (no session to
    // spring open), which lets the phantom go, and in again onto its own
    // place: adopted afresh (KAN-350).
    const list = await boxOf(page.locator('[data-pane="sessions"]'));
    await page.mouse.move(list.x + list.width / 2, list.y + list.height - 10, {
      steps: 6,
    });
    await expect(row(page, 'carried:a1')).not.toHaveAttribute(
      'data-drag-held',
      ''
    );
    await startFrameLog(page, 'carried:a1');
    const b = await boxOf(row(page, 'carried:a1'));
    await page.mouse.move(b.x + Math.min(60, b.width / 2), b.y + b.height / 2, {
      steps: 8,
    });
    await expect(row(page, 'carried:a1')).toHaveAttribute('data-drag-held', '');
    await frames(page, 10);
    const again = await stopFrameLog(page);
    await test.info().attach('re-adoption-frames', {
      body: frameReport(again),
      contentType: 'text/plain',
    });
    await cancel(page);

    for (const log of [first, again]) {
      // PREMISE: the log spans the adoption -- the phantom not held, then
      // held.
      expect(log.some((f) => !f.held)).toBe(true);
      expect(log.some((f) => f.held && f.asCard)).toBe(true);
      expect(SHADOWED_HELD(log), framePictures(log).join('\n')).toEqual([]);
    }
  });

  test('no frame of an adoption whose first move is over a band casts it', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId);
    const at = await pickUp(page, row(page, 'a1'));
    await carryOutLeft(page, at);
    await springOpen(page, 'S2');

    // Straight from the session list onto Gamma's band, in one move: the
    // adoption's first target is the band.
    await startFrameLog(page, 'carried:a1');
    const b = await boxOf(row(page, 'ga1'));
    await page.mouse.move(b.x + Math.min(60, b.width / 2), b.y + b.height / 4);
    await expect(row(page, 'carried:a1')).toHaveAttribute('data-drag-held', '');
    await frames(page, 10);
    const log = await stopFrameLog(page);
    await test.info().attach('band-adoption-frames', {
      body: frameReport(log),
      contentType: 'text/plain',
    });
    // PREMISE: the band is the target, so the stripe's colour is published.
    await expect(page.locator('[data-band-id="gamma"]')).toHaveAttribute(
      'data-drop-target',
      ''
    );
    await cancel(page);

    expect(log.some((f) => !f.held)).toBe(true);
    expect(log.some((f) => f.held && f.asCard)).toBe(true);
    expect(SHADOWED_HELD(log), framePictures(log).join('\n')).toEqual([]);
  });
});

// `n` animation frames.
async function frames(page: Page, n: number): Promise<void> {
  await page.evaluate(
    (n) =>
      new Promise<void>((resolve) => {
        let i = 0;
        const tick = () => (++i >= n ? resolve() : requestAnimationFrame(tick));
        requestAnimationFrame(tick);
      }),
    n
  );
}

test.describe('C1: a drag inside a saved list is drawn by the card', () => {
  // The card is up at the pointer, the held row is marked as drawn by it and
  // draws nothing of itself -- no shadow, none of its content -- and its
  // landing slot stands at full strength.
  async function expectDrawnByCard(
    page: Page,
    held: Locator,
    kind: string,
    at: Point
  ) {
    await expect(page.locator(DRAG_CARD)).toHaveCount(1);
    // A drag card, not a carry: nothing has reached the session list.
    await expect(page.locator(CARRY_CARD)).toHaveCount(0);
    await expect(held).toHaveAttribute('data-drag-held', '');
    await expect(held).toHaveAttribute('data-held-as-card', '');
    await expect(page.locator('[data-held-as-card]')).toHaveCount(1);
    await expect.poll(() => shadowOf(held)).toBe('none');
    const content = await contentOpacities(held);
    // PREMISE: the row has content to hide.
    expect(content.length).toBeGreaterThan(0);
    expect(content.every((o) => o === '0')).toBe(true);
    await expectNothingOfHeldDrawn(held);
    await expect.poll(() => slotOpacity(held)).toBe('1');
    await expectCardAt(page, at);
    // The card says what is held.
    await expect(
      page.locator(`${DRAG_CARD} [data-carry-card-name]`)
    ).toContainText(kind);
  }

  // At pick-up the slot is the row's own place: "it goes back here".
  async function expectSlotAtOwnPlace(held: Locator) {
    const own = await ownPlaceOf(held);
    const slot = await drawn(held.locator(':scope > [data-drag-landing-slot]'));
    expect(slot.top).toBeCloseTo(own.top, 0);
    expect(slot.height).toBeCloseTo(own.height, 0);
  }

  const CASES: {
    kind: string;
    rowId: string;
    name: string;
    handle: (page: Page) => Locator;
    // Mid-drag: a row to aim at, and where in it.
    aim: [string, number];
  }[] = [
    {
      kind: 'tab',
      rowId: 'a1',
      name: 'Tab a1',
      handle: (page) => row(page, 'a1'),
      aim: ['al0', 0.25],
    },
    {
      kind: 'group',
      rowId: 'group:alpha',
      name: 'Alpha',
      handle: (page) => groupHandle(page, 'alpha'),
      aim: ['a1', 0.25],
    },
    // The FIRST window: folding the windows (KAN-153) moves every window
    // below it up and away from the pointer, which would put the held row a
    // row or more off its own place.
    {
      kind: 'window',
      rowId: 'w1',
      name: 'w1',
      handle: (page) => windowHandle(page, 'w1'),
      aim: ['w2', 0.75],
    },
  ];

  for (const { kind, rowId, name, handle, aim } of CASES) {
    test(`a ${kind}, at pick-up and mid-drag`, async ({
      context,
      extensionId,
    }) => {
      const page = await openPopup(context, extensionId);
      const held = row(page, rowId);
      const at = await pickUp(page, handle(page));
      await expectDrawnByCard(page, held, name, at);
      await expectSlotAtOwnPlace(held);

      // Mid-drag, the rows stepping aside.
      const mid = await aimAt(page, aim[0], aim[1]);
      // PREMISE: the landing moved off the row's own place.
      const own = await ownPlaceOf(held);
      const slot = await drawn(
        held.locator(':scope > [data-drag-landing-slot]')
      );
      expect(Math.abs(slot.top - own.top)).toBeGreaterThan(10);
      await expectDrawnByCard(page, held, name, mid);

      await cancel(page);
      await expect(page.locator(DRAG_CARD)).toHaveCount(0);
    });
  }

  // For a group, its title row and its colour strip are hidden WHEREVER they
  // are drawn, not only under the held row's own node.
  test('a group: its title row and colour strip are not drawn', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId);
    await pickUp(page, groupHandle(page, 'alpha'));
    await expect(row(page, 'group:alpha')).toHaveAttribute(
      'data-held-as-card',
      ''
    );
    const parts = await page.evaluate(() => {
      const effective = (e: Element) => {
        let o = 1;
        for (let a: Element | null = e; a !== null; a = a.parentElement)
          o *= Number(getComputedStyle(a).opacity);
        return o;
      };
      return [
        ...document.querySelectorAll(
          '[data-band-id="alpha"] [data-group-color-strip], [data-band-id="alpha"] [data-group-drag-handle]'
        ),
      ].map((e) => ({
        strip: e.hasAttribute('data-group-color-strip'),
        opacity: effective(e),
      }));
    });
    // PREMISE: both are rendered.
    expect(parts.filter((p) => p.strip).length).toBeGreaterThan(0);
    expect(parts.filter((p) => !p.strip).length).toBeGreaterThan(0);
    expect(parts.every((p) => p.opacity === 0)).toBe(true);
    await cancel(page);
  });

  // The tab view (KAN-279) draws the same lists at another size.
  test('a tab, in the tab view', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId, { tabView: true });
    const held = row(page, 'a1');
    const at = await pickUp(page, held);
    await expectDrawnByCard(page, held, 'Tab a1', at);
    await expectSlotAtOwnPlace(held);
    await cancel(page);
    await expect(page.locator(DRAG_CARD)).toHaveCount(0);
  });
});

test.describe('C2: the session list keeps its lifted row', () => {
  // CONTROL, aimed where a saved list now shows a card: the same press and
  // travel, on a session row. The row stays visible and lifted.
  test('a session-list drag shows no card and keeps the lift shadow', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId);
    const held = sessionRow(page, 'S2');
    await pickUp(page, held);

    await expect(held).toHaveAttribute('data-drag-held', '');
    await expect(page.locator(DRAG_CARD)).toHaveCount(0);
    await expect(page.locator(CARRY_CARD)).toHaveCount(0);
    await expect(held).not.toHaveAttribute('data-held-as-card');
    await expect
      .poll(() => shadowOf(held))
      .toContain('rgba(0, 0, 0, 0.35) 0px 2px 8px');
    // Its content is drawn.
    const content = await contentOpacities(held);
    expect(content.length).toBeGreaterThan(0);
    expect(content.every((o) => o === '1')).toBe(true);

    await cancel(page);
  });
});

// ---- the pick-up, frame by frame --------------------------------------------

// One animation frame as it is about to be painted: the card, and the row
// being picked up. Read in requestAnimationFrame, which runs after the
// frame's input events and the microtasks they queued, and before its style
// and paint -- so a frame's record is the DOM that frame draws.
interface PickUpFrame {
  t: number;
  card: boolean;
  held: boolean;
  asCard: boolean;
  // The most opaque of the row's own children (slots excluded): above 0,
  // something of the row itself is drawn.
  content: number;
  shadow: string;
}

declare global {
  interface Window {
    __kan354Frames?: PickUpFrame[];
    __kan354StopFrames?: boolean;
  }
}

async function startFrameLog(page: Page, rowId: string): Promise<void> {
  await page.evaluate((rowId) => {
    const frames: PickUpFrame[] = [];
    window.__kan354Frames = frames;
    window.__kan354StopFrames = false;
    const sample = (t: number) => {
      const el = document.querySelector(`[data-drag-row-id="${rowId}"]`);
      const content =
        el === null
          ? []
          : [...el.children]
              .filter(
                (c) =>
                  !c.hasAttribute('data-drag-landing-slot') &&
                  !c.hasAttribute('data-drag-source-room')
              )
              .map((c) => Number(getComputedStyle(c).opacity));
      frames.push({
        t,
        card: document.querySelector('[data-drag-card]') !== null,
        held: el?.hasAttribute('data-drag-held') ?? false,
        asCard: el?.hasAttribute('data-held-as-card') ?? false,
        content: content.length === 0 ? -1 : Math.max(...content),
        shadow: el === null ? '' : getComputedStyle(el).boxShadow,
      });
      if (!window.__kan354StopFrames) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  }, rowId);
}

async function stopFrameLog(page: Page): Promise<PickUpFrame[]> {
  return page.evaluate(() => {
    window.__kan354StopFrames = true;
    return window.__kan354Frames ?? [];
  });
}

// Every frame, compressed to the distinct pictures in order, for the report.
const framePictures = (frames: PickUpFrame[]): string[] =>
  frames
    .map(
      (f) =>
        `card=${f.card ? 1 : 0} held=${f.held ? 1 : 0} asCard=${
          f.asCard ? 1 : 0
        } content=${f.content} shadow=${f.shadow === 'none' ? 'none' : 'lift'}`
    )
    .filter((p, i, all) => i === 0 || all[i - 1] !== p);

test.describe('the pick-up, frame by frame', () => {
  // KAN-359. The card used to go up at activation, drawn through
  // useSyncExternalStore, which renders on React's sync lane, while the row
  // is hidden through the engine's setDrag, which a pointermove schedules on
  // the continuous lane -- and two frames painted both the card AND the row
  // it stands for (12 of 12 pick-ups, every kind). The card now goes up in
  // the commit that hides the row. Every frame from before the press through
  // the activation is read.
  const PICK_UPS: {
    kind: string;
    rowId: string;
    handle: (page: Page) => Locator;
  }[] = [
    { kind: 'tab', rowId: 'a1', handle: (page) => row(page, 'a1') },
    {
      kind: 'group',
      rowId: 'group:alpha',
      handle: (page) => groupHandle(page, 'alpha'),
    },
    { kind: 'window', rowId: 'w1', handle: (page) => windowHandle(page, 'w1') },
  ];
  for (const { kind, rowId, handle } of PICK_UPS) {
    test(`a ${kind}: no frame shows the card beside a visible held row`, async ({
      context,
      extensionId,
    }) => {
      const page = await openPopup(context, extensionId);
      await startFrameLog(page, rowId);
      await pickUp(page, handle(page));
      // Some frames past the activation, with the pointer still.
      await expect(page.locator(DRAG_CARD)).toHaveCount(1);
      await page.evaluate(
        () =>
          new Promise<void>((resolve) => {
            let n = 0;
            const tick = () =>
              ++n >= 10 ? resolve() : requestAnimationFrame(tick);
            requestAnimationFrame(tick);
          })
      );
      const frames = await stopFrameLog(page);
      await cancel(page);
      await test.info().attach(`${kind}-frames`, {
        body: framePictures(frames).join('\n'),
        contentType: 'text/plain',
      });

      // PREMISE: the log spans the pick-up -- a frame before it (no card,
      // the row drawn) and frames after it (card, row hidden).
      expect(frames.some((f) => !f.card && !f.held && f.content === 1)).toBe(
        true
      );
      expect(frames.some((f) => f.card && f.asCard && f.content === 0)).toBe(
        true
      );
      // THE CLAIM: no frame paints both.
      const both = frames.filter((f) => f.card && f.content > 0);
      expect(both, framePictures(frames).join('\n')).toEqual([]);
      // Nor neither (KAN-359): the card goes up in the commit that hides the
      // row, so no frame shows the hidden row with no card at the pointer.
      const neither = frames.filter((f) => f.asCard && !f.card);
      expect(neither, framePictures(frames).join('\n')).toEqual([]);
    });
  }
});

test.describe('C3: the outline over the room a cross-window drag leaves', () => {
  const OUTLINE = '[data-drag-source-room]';

  // How far the preview moved a window's block (KAN-184), as it publishes.
  const windowShift = (page: Page, windowId: string): Promise<number> =>
    page.locator(`[data-drop-window-id="${windowId}"]`).evaluate((el) => {
      if (!(el instanceof HTMLElement)) throw new Error('not an HTMLElement');
      return Number(el.dataset.windowShift ?? 0);
    });

  // The outline's paint: dotted, at 0.45 (its own inline opacity, which
  // the held row's `opacity: 0` on its content could not outrank), visible,
  // and the landing slot's colour and line width -- 1.5px, which
  // Chrome snaps to whole device pixels (1px at this DPR) for both alike.
  async function expectOutlineLook(page: Page): Promise<void> {
    const look = await page.locator(OUTLINE).evaluate((el) => {
      const s = getComputedStyle(el);
      const slot = el.parentElement?.querySelector(
        ':scope > [data-drag-landing-slot]'
      );
      const slotStyle = slot ? getComputedStyle(slot) : null;
      return {
        borderStyle: s.borderTopStyle,
        opacity: s.opacity,
        visibility: s.visibility,
        sameWidthAsSlot: s.borderTopWidth === slotStyle?.borderTopWidth,
        sameColourAsSlot: s.borderTopColor === slotStyle?.borderTopColor,
      };
    });
    expect(look).toEqual({
      borderStyle: 'dotted',
      opacity: '0.45',
      visibility: 'visible',
      sameWidthAsSlot: true,
      sameColourAsSlot: true,
    });
  }

  test('downward: a tab from w1 into w2 leaves its room at the bottom of w1', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId);
    // w1's last row, and the held row's own box, at rest.
    const last = await boxOf(row(page, 'al1'));
    const own = await boxOf(row(page, 'a0'));
    await pickUp(page, row(page, 'a0'));
    // PREMISE: nothing outlined while the landing is in the row's own window.
    await expect(page.locator(OUTLINE)).toHaveCount(0);

    // Into w2, between b0 and b1.
    await aimAt(page, 'b1', 0.1);

    // PREMISE: the landing is in w2 -- the slot is drawn there, and w1's
    // last row has closed up under a0.
    const slot = await drawn(page.locator('[data-drag-landing-slot]'));
    const w2 = await drawn(page.locator('[data-drop-window-id="w2"]'));
    expect(slot.top).toBeGreaterThan(w2.top);
    const lastNow = await drawn(row(page, 'al1'));
    expect(lastNow.bottom).toBeLessThan(last.y + last.height - 1);

    await expect(page.locator(OUTLINE)).toHaveCount(1);
    // The row's content stays hidden beside the outline it now draws: the
    // outline is a slot of the row's, not its content.
    const content = await contentOpacities(row(page, 'a0'));
    expect(content.length).toBeGreaterThan(0);
    expect(content.every((o) => o === '0')).toBe(true);
    const outline = await drawn(page.locator(OUTLINE));
    // One row -- the held row's own box -- ending where w1's rows ended.
    expect(outline.height).toBeCloseTo(own.height, 0);
    expect(outline.bottom).toBeCloseTo(last.y + last.height, 0);
    // In the room itself: below the closed-up rows, inside w1's box.
    expect(outline.top).toBeGreaterThanOrEqual(lastNow.bottom - 0.5);
    const w1 = await drawn(page.locator('[data-drop-window-id="w1"]'));
    expect(outline.bottom).toBeLessThanOrEqual(w1.bottom + 0.5);
    await expectOutlineLook(page);

    await cancel(page);
    await expect(page.locator(OUTLINE)).toHaveCount(0);
  });

  // Upward, the source is below the destination, so the preview moves the
  // SOURCE's block down a row (KAN-184), and the room with it.
  test('upward: a tab from w2 into w1 leaves its room at the bottom of the moved w2', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId);
    const last = await boxOf(row(page, 'b1'));
    const own = await boxOf(row(page, 'b0'));
    await pickUp(page, row(page, 'b0'));

    // Into w1, between a0 and a1.
    await aimAt(page, 'a1', 0.1);

    // PREMISE: the landing is in w1, so w2's block has moved down.
    const shift = await windowShift(page, 'w2');
    expect(shift).toBeGreaterThan(0);

    await expect(page.locator(OUTLINE)).toHaveCount(1);
    const outline = await drawn(page.locator(OUTLINE));
    expect(outline.height).toBeCloseTo(own.height, 0);
    // At the MOVED block's bottom row, not the resting one.
    expect(outline.bottom).toBeCloseTo(last.y + last.height + shift, 0);
    const lastNow = await drawn(row(page, 'b1'));
    expect(outline.top).toBeGreaterThanOrEqual(lastNow.bottom - 0.5);
    const w2 = await drawn(page.locator('[data-drop-window-id="w2"]'));
    expect(outline.bottom).toBeLessThanOrEqual(w2.bottom + 0.5);
    await expectOutlineLook(page);

    await cancel(page);
  });

  // Q3. A group gets the outline too: its compressed box (KAN-160). Alpha
  // is w1's last item, so the room it leaves is its own place.
  test('a group from w1 into w2: the group’s compressed box, at the bottom of w1', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId);
    const band = await boxOf(row(page, 'group:alpha'));
    await pickUp(page, groupHandle(page, 'alpha'));
    const held = row(page, 'group:alpha');
    // The compressed box, measured with the drag on.
    const compressed = await held.evaluate((el) => {
      if (!(el instanceof HTMLElement)) throw new Error('not an HTMLElement');
      const shift = Number(
        /translateY\((-?[\d.]+)px\)/.exec(el.style.transform)?.[1] ?? 0
      );
      const r = el.getBoundingClientRect();
      return { top: r.top - shift, height: r.height };
    });
    // PREMISE: compressed, shorter than the band at rest.
    expect(compressed.height).toBeLessThan(band.height - 1);

    await aimAt(page, 'tab:b1', 0.1);

    // PREMISE: the landing is in w2.
    const slot = await drawn(page.locator('[data-drag-landing-slot]'));
    const w2 = await drawn(page.locator('[data-drop-window-id="w2"]'));
    expect(slot.top).toBeGreaterThan(w2.top);

    await expect(page.locator(OUTLINE)).toHaveCount(1);
    const outline = await drawn(page.locator(OUTLINE));
    expect(outline.height).toBeCloseTo(compressed.height, 0);
    expect(outline.top).toBeCloseTo(compressed.top, 0);
    const w1 = await drawn(page.locator('[data-drop-window-id="w1"]'));
    expect(outline.bottom).toBeLessThanOrEqual(w1.bottom + 0.5);
    await expectOutlineLook(page);

    await cancel(page);
  });

  // NEGATIVE, aimed where the outline would sit: the same row on the first
  // half of the same path, still inside w1, down to w1's last place -- the
  // very box the downward drag outlines. A drag inside one window leaves no
  // room behind (C1 A: rows close up as the pointer passes them).
  test('inside one window, along the same path to w1’s bottom: no outline', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId);
    await pickUp(page, row(page, 'a0'));
    for (const [target, frac] of [
      ['a2', 0.75],
      ['al0', 0.75],
      ['al1', 0.9],
    ] satisfies [string, number][]) {
      await aimAt(page, target, frac);
      // PREMISE: the landing is still in w1.
      const slot = await drawn(page.locator('[data-drag-landing-slot]'));
      const w1 = await drawn(page.locator('[data-drop-window-id="w1"]'));
      expect(slot.top).toBeGreaterThanOrEqual(w1.top);
      expect(slot.bottom).toBeLessThanOrEqual(w1.bottom + 0.5);
      await expect(page.locator(OUTLINE)).toHaveCount(0);
    }
    // PREMISE: the last stop is w1's last place, where the outline would be.
    const slot = await drawn(page.locator('[data-drag-landing-slot]'));
    const w2 = await drawn(page.locator('[data-drop-window-id="w2"]'));
    expect(slot.bottom).toBeLessThan(w2.top);
    await cancel(page);
  });

  // Q2. so0 is its group's only member: carried out, the whole band goes
  // (KAN-169), and the room it leaves is taller than a row. The outline is
  // ONE row, at the very bottom; the extra room above it stays bare.
  test('Q2: a group’s only member leaving: one row outlined at the very bottom, the rest bare', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId, {
      sessions: [S4(), S2()],
      selected: 'S4',
    });
    const last = await boxOf(row(page, 'x1'));
    const own = await boxOf(row(page, 'so0'));
    await pickUp(page, row(page, 'so0'));
    await aimAt(page, 'y1', 0.1);

    // PREMISE: the landing is in w2, and the band goes with its member.
    const slot = await drawn(page.locator('[data-drag-landing-slot]'));
    const w2 = await drawn(page.locator('[data-drop-window-id="w2"]'));
    expect(slot.top).toBeGreaterThan(w2.top);
    await expect(page.locator('[data-band-id="solo"]')).toHaveAttribute(
      'data-drag-removed',
      ''
    );
    // PREMISE: the room is taller than a row: x1 rose by more than one.
    const lastNow = await drawn(row(page, 'x1'));
    const room = last.y + last.height - lastNow.bottom;
    expect(room).toBeGreaterThan(own.height + 4);

    await expect(page.locator(OUTLINE)).toHaveCount(1);
    const outline = await drawn(page.locator(OUTLINE));
    // One row, at the very bottom.
    expect(outline.height).toBeCloseTo(own.height, 0);
    expect(outline.bottom).toBeCloseTo(last.y + last.height, 0);
    // The rest of the room, between the risen rows and the outline, is
    // bare: no row, slot, outline or band chrome drawn across it.
    const gap = { top: lastNow.bottom + 0.5, bottom: outline.top - 0.5 };
    expect(gap.bottom - gap.top).toBeGreaterThan(4);
    const across = await page.evaluate(({ top, bottom }) => {
      const effective = (e: Element) => {
        let o = 1;
        for (let a: Element | null = e; a !== null; a = a.parentElement)
          o *= Number(getComputedStyle(a).opacity);
        return o;
      };
      const w1 = document.querySelector('[data-drop-window-id="w1"]');
      if (w1 === null) return ['no w1'];
      return [
        ...w1.querySelectorAll(
          // A group's own row is left out: KAN-169 keeps the vanishing
          // band's box where it was, and fades what it draws -- its title
          // row and strip, read here -- and its fill, read below.
          '[data-drag-row-id]:not([data-drag-held]):not([data-drag-row-id^="group:"]), [data-drag-landing-slot], [data-drag-source-room], [data-group-drag-handle], [data-group-color-strip]'
        ),
      ]
        .filter((e) => {
          const r = e.getBoundingClientRect();
          return (
            r.height > 0 && r.top < bottom && r.bottom > top && effective(e) > 0
          );
        })
        .map(
          (e) =>
            e.getAttribute('data-drag-row-id') ??
            [...e.attributes].map((a) => a.name).join(' ')
        );
    }, gap);
    expect(across).toEqual([]);
    expect(
      await page
        .locator('[data-band-id="solo"]')
        .evaluate((el) => getComputedStyle(el).backgroundColor)
    ).toBe('rgba(0, 0, 0, 0)');
    await cancel(page);
  });

  // Q3 with a non-zero distance: beta is not w1's last item, so the outline
  // is drawn below its own place, and it is the COMPRESSED group's box
  // (KAN-160), at w1's bottom as the drag measured it.
  test('Q3: a group that is not last: its compressed box, at the bottom of w1', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId, {
      sessions: [S5(), S2()],
      selected: 'S5',
    });
    const band = await boxOf(row(page, 'group:beta'));
    await pickUp(page, groupHandle(page, 'beta'));
    const held = row(page, 'group:beta');
    const compressed = await ownPlaceOf(held);
    // PREMISE: compressed, shorter than the band at rest.
    expect(compressed.height).toBeLessThan(band.height - 1);
    // w1's last row in the drag's own (compressed) layout.
    const lastAtPickUp = await drawn(row(page, 'tab:x1'));

    await aimAt(page, 'tab:y1', 0.1);
    // PREMISE: the landing is in w2.
    const slot = await drawn(page.locator('[data-drag-landing-slot]'));
    const w2 = await drawn(page.locator('[data-drop-window-id="w2"]'));
    expect(slot.top).toBeGreaterThan(w2.top);

    await expect(page.locator(OUTLINE)).toHaveCount(1);
    const outline = await drawn(page.locator(OUTLINE));
    expect(outline.height).toBeCloseTo(compressed.height, 0);
    expect(outline.bottom).toBeCloseTo(lastAtPickUp.bottom, 0);
    // PREMISE of this case: the distance is not zero.
    expect(outline.top - compressed.top).toBeGreaterThan(10);
    const lastNow = await drawn(row(page, 'tab:x1'));
    expect(outline.top).toBeGreaterThanOrEqual(lastNow.bottom - 0.5);
    await expectOutlineLook(page);
    await cancel(page);
  });
});

test.describe('C2: Open now keeps its lifted row', () => {
  // CONTROL, aimed where a saved list now shows a card: the same press and
  // travel on an Open now tab row. Open now gets its card in KAN-280 Part F;
  // until then its row stays drawn and lifted.
  test('an Open now drag shows no card and keeps the lift shadow', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const urls = ['o0', 'o1', 'o2'].map(
      (t) => `data:text/html,${encodeURIComponent(`<title>${t}</title>`)}`
    );
    const opened = await serviceWorker.evaluate(async (url: string[]) => {
      const w = await chrome.windows.create({ focused: false, url });
      return (w?.tabs ?? []).flatMap((t) => (t.id === undefined ? [] : [t.id]));
    }, urls);
    expect(opened).toHaveLength(3);
    const page = await openPopup(context, extensionId, { tabView: true });
    const openRow = page.locator(`[data-open-tab-id="${opened[1]}"]`);
    await expect(openRow).toBeVisible();

    await pickUp(page, openRow);
    const held = page.locator('[data-drag-held]');
    // PREMISE: an Open now row is the one held.
    await expect(held).toHaveCount(1);
    await expect(held.locator('[data-open-tab-id]')).toHaveCount(1);

    await expect(page.locator(DRAG_CARD)).toHaveCount(0);
    await expect(page.locator(CARRY_CARD)).toHaveCount(0);
    await expect(held).not.toHaveAttribute('data-held-as-card');
    await expect
      .poll(() => shadowOf(held))
      .toContain('rgba(0, 0, 0, 0.35) 0px 2px 8px');
    const content = await contentOpacities(held);
    expect(content.length).toBeGreaterThan(0);
    expect(content.every((o) => o === '1')).toBe(true);
    await cancel(page);
  });
});

// ---- the hand-off -------------------------------------------------------------

declare global {
  interface Window {
    __kan354Card?: Element | null;
    __kan354Removed?: number;
  }
}

test.describe('the hand-off to a carry keeps the one card', () => {
  // A saved drag carried onto the session list becomes a carry (KAN-352).
  // The card the user is dragging is the same element before and after --
  // nothing is removed and drawn again -- and from then on it is a carry's.
  test('a tab carried onto the session list: the same card node, then a carry', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId);
    const at = await pickUp(page, row(page, 'a1'));
    await expect(page.locator(DRAG_CARD)).toHaveCount(1);
    await page.evaluate(() => {
      const card = document.querySelector('[data-drag-card]');
      window.__kan354Card = card;
      window.__kan354Removed = 0;
      new MutationObserver((records) => {
        for (const r of records)
          for (const n of r.removedNodes)
            if (card !== null && (n === card || n.contains(card)))
              window.__kan354Removed = (window.__kan354Removed ?? 0) + 1;
      }).observe(document.body, { childList: true, subtree: true });
    });

    await carryOutLeft(page, at);

    const after = await page.evaluate(() => ({
      same:
        window.__kan354Card !== null &&
        document.querySelector('[data-carry-card]') === window.__kan354Card,
      connected: window.__kan354Card?.isConnected ?? false,
      removed: window.__kan354Removed ?? -1,
    }));
    expect(after).toEqual({ same: true, connected: true, removed: 0 });
    await expect(page.locator(CARRY_CARD)).toHaveCount(1);
    await expect(page.locator(DRAG_CARD)).toHaveCount(0);
    await cancel(page);
  });
});

// ---- where the release's click lands ------------------------------------------

interface ReleaseRecord {
  // The held row's id at the instant of release, before the engine's own
  // pointerup runs; and whether the point released over is inside it.
  held: string | null;
  hitInHeld: boolean;
  hit: string;
  // Every click the window sees afterwards, whether its target is inside
  // the row that was held, and whether it is inside any row at all.
  clicks: { inHeld: boolean; inRow: boolean; target: string }[];
}

declare global {
  interface Window {
    __kan354Release?: ReleaseRecord;
  }
}

async function recordRelease(page: Page): Promise<void> {
  await page.evaluate(() => {
    const record: ReleaseRecord = {
      held: null,
      hitInHeld: false,
      hit: '',
      clicks: [],
    };
    window.__kan354Release = record;
    let heldEl: Element | null = null;
    const name = (e: Element | null) =>
      e === null
        ? 'null'
        : e.closest('[data-drag-row-id]')?.getAttribute('data-drag-row-id') ??
          e.tagName;
    window.addEventListener(
      'pointerup',
      (e) => {
        heldEl = document.querySelector('[data-drag-held]');
        const hit = document.elementFromPoint(e.clientX, e.clientY);
        record.held = heldEl?.getAttribute('data-drag-row-id') ?? null;
        record.hitInHeld =
          heldEl !== null && hit !== null && heldEl.contains(hit);
        record.hit = name(hit);
      },
      { capture: true, once: true }
    );
    window.addEventListener(
      'click',
      (e) => {
        const target = e.target instanceof Element ? e.target : null;
        record.clicks.push({
          inHeld: heldEl !== null && target !== null && heldEl.contains(target),
          inRow:
            target !== null && target.closest('[data-drag-row-id]') !== null,
          target: name(target),
        });
      },
      true
    );
  });
}

const releaseRecord = (page: Page): Promise<ReleaseRecord | null> =>
  page.evaluate(() => window.__kan354Release ?? null);

// S1's stored windows and tabs, as the app stores them.
async function storedTabs(page: Page): Promise<string> {
  const raw = await page.evaluate(() =>
    localStorage.getItem('tabContainerData')
  );
  const parsed: unknown = JSON.parse(raw ?? 'null');
  if (!isValidTabMasterContainer(parsed)) {
    throw new Error(`tabContainerData is not a container: ${raw}`);
  }
  const s1 = parsed.tabGroups?.find((g) => g.tabGroupId === 'S1');
  return JSON.stringify(
    s1?.windows.map((w) => w.tabs.map((t) => t.tabId)) ?? null
  );
}

test.describe('the click after a release lands on the hidden row', () => {
  // KAN-354 hides the held row with opacity alone, so it still takes hits:
  // Chrome aims the click it synthesizes for a release at the row under the
  // pointer, and the held row tracks the pointer. The click rules (KAN-128,
  // KAN-177, clickSuppressor.ts) eat THAT click. A row that took no hits
  // would hand the click to whatever row is underneath -- and click-after-
  // drag.spec.ts counts clicks, not their target, so only this sees it.

  // CONTROL: a plain click on the row opens its tab, so the probe below can
  // see a tab open at all.
  test('CONTROL: a plain click on a tab row opens that tab', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId);
    const before = context.pages().length;
    const b = await boxOf(row(page, 'a1'));
    await page.mouse.click(b.x + 60, b.y + b.height / 2);
    await expect.poll(() => context.pages().length).toBe(before + 1);
  });

  test('a drag that changes nothing: the click lands on the held row, and opens nothing', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId);
    const start = await storedTabs(page);
    const before = context.pages().length;
    await pickUp(page, row(page, 'a1'));
    // PREMISE: the row is held as the card draws it -- hidden.
    await expect(row(page, 'a1')).toHaveAttribute('data-held-as-card', '');
    await recordRelease(page);
    await page.mouse.up();

    // Chrome sends this release a click (a no-op drag moves no node).
    await expect
      .poll(async () => (await releaseRecord(page))?.clicks.length ?? 0)
      .toBe(1);
    const r = await releaseRecord(page);
    expect(r).toMatchObject({
      held: 'a1',
      hitInHeld: true,
      clicks: [{ inHeld: true, target: 'a1' }],
    });
    // ...and the suppressor eats it (KAN-128): as long as the control above
    // allows a tab to appear in.
    await page.waitForTimeout(1000);
    expect(context.pages().length).toBe(before);
    expect(await storedTabs(page)).toBe(start);
  });

  test('a committed drag: released over the held row, and opens nothing', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId);
    const start = await storedTabs(page);
    const before = context.pages().length;
    await pickUp(page, row(page, 'a0'));
    await aimAt(page, 'a2', 0.75);
    await recordRelease(page);
    await page.mouse.up();

    // PREMISE: the move committed.
    await expect.poll(() => storedTabs(page)).not.toBe(start);
    const r = await releaseRecord(page);
    expect(r).toMatchObject({ held: 'a0', hitInHeld: true });
    // No click reaches anything but the row that was held.
    expect(r?.clicks.every((c) => c.inHeld)).toBe(true);
    await page.waitForTimeout(1000);
    expect(context.pages().length).toBe(before);
  });
});

// Refused: above the pane, where no window is (KAN-158). The release lands
// outside every row -- the held row stays in its list, and the pointer
// does not -- so the click Chrome sends for it is not aimed at the hidden
// row, and this cannot speak for the suppressor (the describe above does).
// What it pins is the refusal itself.
//
// Above the toolbar row too: from pick-up its New window target stands in
// the 40px above the pane, and a release there makes a new first window
// (KAN-361 N1 B).
test.describe('a refused release', () => {
  test('changes nothing and opens nothing', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId);
    const start = await storedTabs(page);
    const before = context.pages().length;
    const at = await pickUp(page, row(page, 'a1'));
    const w1 = await boxOf(row(page, 'w1'));
    await page.mouse.move(at.x, w1.y - 64, { steps: 8 });
    await settled(page);
    await recordRelease(page);
    await page.mouse.up();

    const r = await releaseRecord(page);
    await test.info().attach('refused-release', {
      body: JSON.stringify(r),
      contentType: 'application/json',
    });
    // PREMISE: a1 was held at the release, and the release was outside it.
    expect(r).toMatchObject({ held: 'a1', hitInHeld: false });
    await page.waitForTimeout(1000);
    // No click reached any row, hidden or not.
    expect(r?.clicks.filter((c) => c.inRow)).toEqual([]);
    expect(context.pages().length).toBe(before);
    expect(await storedTabs(page)).toBe(start);
  });
});

// ---- a long, scrolled session (Review Focus 3) --------------------------------

// The pane the detail scrolls in: the nearest scrolling ancestor of w1.
const paneOf = (page: Page) =>
  row(page, 'w1').evaluate((el) => {
    let p = el.parentElement;
    while (
      p !== null &&
      !['auto', 'scroll'].includes(getComputedStyle(p).overflowY)
    )
      p = p.parentElement;
    if (p === null) throw new Error('w1 has no scrolling pane');
    const b = p.getBoundingClientRect();
    return { top: b.top, bottom: b.bottom, scrollTop: p.scrollTop };
  });

const scrollPaneTo = (page: Page, top: number) =>
  row(page, 'w1').evaluate((el, top) => {
    let p = el.parentElement;
    while (
      p !== null &&
      !['auto', 'scroll'].includes(getComputedStyle(p).overflowY)
    )
      p = p.parentElement;
    if (p === null) throw new Error('w1 has no scrolling pane');
    p.scrollTop = top;
    return p.scrollTop;
  }, top);

// The slot as painted in the first frame past `past`: a plain read can land between a commit and its frame (KAN-387).
const slotOnceScrolledPast = (held: Locator, past: number) =>
  held.evaluate(
    (el, past) =>
      new Promise<{
        scrollTop: number;
        slot: { top: number; bottom: number; opacity: string } | null;
      }>((resolve) => {
        let p = el.parentElement;
        while (
          p !== null &&
          !['auto', 'scroll'].includes(getComputedStyle(p).overflowY)
        )
          p = p.parentElement;
        if (p === null) throw new Error('the held row has no scrolling pane');
        const scroller = p;
        const giveUp = performance.now() + 4000;
        const frame = () => {
          if (scroller.scrollTop <= past && performance.now() < giveUp) {
            requestAnimationFrame(frame);
            return;
          }
          const slot = el.querySelector(':scope > [data-drag-landing-slot]');
          const r = slot?.getBoundingClientRect();
          resolve({
            scrollTop: scroller.scrollTop,
            slot:
              slot === null || r === undefined
                ? null
                : {
                    top: r.top,
                    bottom: r.bottom,
                    opacity: getComputedStyle(slot).opacity,
                  },
          });
        };
        requestAnimationFrame(frame);
      }),
    past
  );

test.describe('a long, scrolled session', () => {
  // Auto-scroll (KAN-152) moves the list under a hidden row: the card stays
  // at the pointer -- it is position: fixed -- and the slot, at full
  // strength, stays in the pane.
  test('auto-scrolling under a hidden row: the card at the pointer, the slot in the pane', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId, {
      sessions: [S6(), S2()],
      selected: 'S6',
    });
    const held = row(page, 't02');
    const at = await pickUp(page, held);
    const pane = await paneOf(page);
    const low = { x: at.x, y: pane.bottom - 12 };
    await page.mouse.move(low.x, low.y, { steps: 8 });
    const seen = await slotOnceScrolledPast(held, pane.scrollTop + 120);
    // PREMISE: the list is scrolling under the held row.
    expect(seen.scrollTop).toBeGreaterThan(pane.scrollTop + 120);

    await expectCardAt(page, low);
    await expect(held).toHaveAttribute('data-held-as-card', '');
    await expectNothingOfHeldDrawn(held);
    // PREMISE, not a claim: the slot is drawn. Measured, it sits about a row
    // from the held row here (slot 481..513, row 513..545), where a lifted
    // row's fading slot is near 1 already, so this barely tells the two
    // looks apart; C1's pick-up, at distance 0, does.
    const slot = seen.slot;
    if (slot === null) throw new Error('no landing slot drawn');
    expect(slot.opacity).toBe('1');
    expect(slot.top).toBeGreaterThanOrEqual(pane.top - 0.5);
    expect(slot.bottom).toBeLessThanOrEqual(pane.bottom + 0.5);
    await cancel(page);
    await expect(page.locator(DRAG_CARD)).toHaveCount(0);
  });

  // KAN-154/157: a window drag folds every window, the list gets shorter
  // than its scroll, and the browser clamps it. The card is still at the
  // pointer and the held window still hidden.
  test('a window drag from a scrolled list: the card at the pointer, the window hidden', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId, {
      sessions: [S7(), S2()],
      selected: 'S7',
    });
    const scrolled = await scrollPaneTo(page, 100_000);
    // PREMISE: the list was scrolled.
    expect(scrolled).toBeGreaterThan(0);
    const pane = await paneOf(page);
    // The topmost window header wholly inside the pane.
    const target = await page.evaluate(({ top, bottom }) => {
      for (const h of document.querySelectorAll('[data-window-drag-handle]')) {
        const r = h.getBoundingClientRect();
        if (r.top >= top && r.bottom <= bottom)
          return (
            h.closest('[data-drag-row-id]')?.getAttribute('data-drag-row-id') ??
            null
          );
      }
      return null;
    }, pane);
    if (target === null) throw new Error('no window header in the pane');
    const held = row(page, target);
    const at = await pickUp(page, windowHandle(page, target));

    // PREMISE: the fold clamped the scroll (KAN-154).
    expect((await paneOf(page)).scrollTop).toBeLessThan(scrolled);
    await expect(held).toHaveAttribute('data-held-as-card', '');
    await expectCardAt(page, at);
    await expectNothingOfHeldDrawn(held);
    expect(await slotOpacity(held)).toBe('1');
    const slot = await drawn(held.locator(':scope > [data-drag-landing-slot]'));
    expect(slot.top).toBeGreaterThanOrEqual(pane.top - 0.5);
    expect(slot.bottom).toBeLessThanOrEqual(pane.bottom + 0.5);
    await cancel(page);
  });

  // The outline in a scrolled frame: at the source's bottom as it is drawn
  // there.
  test('a cross-window drag in a scrolled list: the outline at w1’s bottom', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId, {
      sessions: [S6(), S2()],
      selected: 'S6',
    });
    const scrolled = await scrollPaneTo(page, 100_000);
    expect(scrolled).toBeGreaterThan(0);
    const last = await boxOf(row(page, 't29'));
    const own = await boxOf(row(page, 't26'));
    await pickUp(page, row(page, 't26'));
    // u0, not u1: at the list's end u1 sits in the bottom auto-scroll band,
    // and a tab drag gives the list a row of room below its last window
    // (KAN-366 Q4), so the band scrolls there now.
    await aimAt(page, 'u0', 0.1);
    // PREMISE: the landing is in w2, and the list has not moved.
    const slot = await drawn(page.locator('[data-drag-landing-slot]'));
    const w2 = await drawn(page.locator('[data-drop-window-id="w2"]'));
    expect(slot.top).toBeGreaterThan(w2.top);
    expect((await paneOf(page)).scrollTop).toBe(scrolled);

    const outline = page.locator('[data-drag-source-room]');
    await expect(outline).toHaveCount(1);
    const box = await drawn(outline);
    expect(box.height).toBeCloseTo(own.height, 0);
    expect(box.bottom).toBeCloseTo(last.y + last.height, 0);
    const lastNow = await drawn(row(page, 't29'));
    expect(box.top).toBeGreaterThanOrEqual(lastNow.bottom - 0.5);
    await cancel(page);
  });
});

// ---- contrast, held to floors --------------------------------------------------

// The outline (0.45) and the landing slot (1), each drawn as its border colour
// composited at its EFFECTIVE opacity (its own times every ancestor's) over
// what is painted behind it -- the held row excluded, which is invisible --
// against that backdrop.
//
// C5 A (Justine, 2026-10-01) kept the outline faint on purpose: it is
// supplementary (the drop is the same whether it is seen; the dashed slot,
// >= 3:1, says where the row goes), so its floor guards against fading
// further, not WCAG 1.4.11's 3:1. Floors sit a hair under the measured values
// (outline 1.81 Paper, 1.84 Parchment, 1.81 Petal, 1.97 Graphite, 1.97 Ink;
// slot 4.31 to 4.89) so a theme change that fades either fails and rounding
// noise does not.
const OUTLINE_CONTRAST_FLOOR = 1.75;
const SLOT_CONTRAST_FLOOR = 3;
const THEMES: [string, string][] = [
  ['Light', 'Paper'],
  ['WarmLight', 'Parchment'],
  ['BBPink', 'Petal'],
  ['Darkenheimer', 'Graphite'],
  ['Blue', 'Ink'],
];

for (const [theme, label] of THEMES) {
  test(`contrast of the outline and the slot (${label})`, async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId, { theme });
    await pickUp(page, row(page, 'a0'));
    await aimAt(page, 'b1', 0.1);
    await expect(page.locator('[data-drag-source-room]')).toHaveCount(1);

    const measure = (selector: string) =>
      page.evaluate((selector) => {
        const el = document.querySelector(selector);
        if (el === null) throw new Error(`nothing matches ${selector}`);
        const channels = (s: string) => {
          if (!/^rgba?\(/.test(s)) throw new Error(`not an rgb colour: ${s}`);
          const n = (s.match(/\d+(\.\d+)?/g) ?? []).map(Number);
          return { rgb: n.slice(0, 3), alpha: n[3] ?? 1 };
        };
        const cs = getComputedStyle(el);
        const border = channels(cs.borderTopColor);
        let opacity = 1;
        for (let a: Element | null = el; a !== null; a = a.parentElement)
          opacity *= Number(getComputedStyle(a).opacity);
        const held = document.querySelector('[data-drag-held]');
        const r = el.getBoundingClientRect();
        let backdrop: string | null = null;
        for (const e of document.elementsFromPoint(
          r.left + r.width / 2,
          r.top + r.height / 2
        )) {
          if (held !== null && held.contains(e)) continue;
          const bg = getComputedStyle(e).backgroundColor;
          if (bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') {
            backdrop = bg;
            break;
          }
        }
        if (backdrop === null)
          throw new Error(`no backdrop behind ${selector}`);
        const bg = channels(backdrop);
        if (bg.alpha < 1)
          throw new Error(
            `backdrop behind ${selector} is translucent (${backdrop}); contrast would be a guess`
          );
        const lum = (c: number[]) => {
          const [x, y, z] = c.map((v) => {
            const s = v / 255;
            return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
          });
          return 0.2126 * x + 0.7152 * y + 0.0722 * z;
        };
        const strength = opacity * border.alpha;
        const composited = border.rgb.map(
          (v, i) => v * strength + bg.rgb[i] * (1 - strength)
        );
        const L1 = lum(composited);
        const L2 = lum(bg.rgb);
        return {
          border: cs.borderTopColor,
          opacity,
          backdrop,
          contrast:
            Math.round(
              ((Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05)) * 100
            ) / 100,
        };
      }, selector);

    const outline = await measure('[data-drag-source-room]');
    const slot = await measure('[data-drag-landing-slot]');
    await test.info().attach(`contrast-${label}`, {
      body: JSON.stringify({ outline, slot }),
      contentType: 'application/json',
    });
    // THE FLOORS, first, so a faded outline fails on its contrast and not on
    // the premise below naming its opacity.
    expect(outline.contrast).toBeGreaterThanOrEqual(OUTLINE_CONTRAST_FLOOR);
    expect(slot.contrast).toBeGreaterThanOrEqual(SLOT_CONTRAST_FLOOR);
    // PREMISES: both are drawn, at the strengths the product sets, in the
    // theme's colour.
    expect(outline.opacity).toBe(0.45);
    expect(slot.opacity).toBe(1);
    expect(outline.border).not.toBe('rgb(0, 0, 0)');
    await cancel(page);
  });
}
