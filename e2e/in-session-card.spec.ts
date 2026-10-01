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
// Organised by claim, so the cases still to come (the outline of KAN-354 C3,
// the click after a release, the tab view) each add a describe of their own:
//
//   KAN-355  the adopted phantom casts no shadow
//   C1       a saved list's drag is drawn by the card (tab, group, window)
//   C2       the session list keeps its lifted row and shows no card
//   C3       a drag into another window outlines the room it leaves there
//
// Driven as the popup (790x550), with the tabGroups grant (grantedTest) so a
// group band exists at all.

import type { BrowserContext, Locator, Page } from '@playwright/test';

import { grantedTest as test, expect } from './fixtures/grantedExtension';
import { buildContainer, buildSession, seedSessions } from './fixtures/seed';
import type {
  TabMasterContainer,
  tabContainerData,
} from '../src/redux/slices/tabContainerDataStateSlice';
import { isValidTabMasterContainer } from '../src/utils/functions/local';

const POPUP = { width: 790, height: 550 };

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

async function openPopup(
  context: BrowserContext,
  extensionId: string
): Promise<Page> {
  const sessions = [S1(), S2(), S3()];
  await seedSessions(context, {
    ...buildContainer(
      sessions.map((s) => ({ ...s, isSelected: s.tabGroupId === 'S1' }))
    ),
    selectedTabGroupId: 'S1',
  });
  const page = await context.newPage();
  await page.setViewportSize(POPUP);
  await page.goto(`chrome-extension://${extensionId}/index.html`);
  // goto resolves before React mounts (KAN-105). Every test crosses this
  // barrier before its first raw evaluate: S1's first window drawn.
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

// The opacity of each of the held row's own children, slot excluded: what
// hides the row's content while the row keeps its box.
const contentOpacities = (held: Locator): Promise<string[]> =>
  held.evaluate((el) =>
    [...el.children]
      .filter((c) => !c.hasAttribute('data-drag-landing-slot'))
      .map((c) => getComputedStyle(c).opacity)
  );

// The held row's landing slot's computed opacity, or null with none drawn.
const slotOpacity = (held: Locator): Promise<string | null> =>
  held.evaluate((el) => {
    const slot = el.querySelector(':scope > [data-drag-landing-slot]');
    return slot === null ? null : getComputedStyle(slot).opacity;
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
  await settled(page);
  return phantom;
}

// The pointer to `frac` of the way down `rowId`'s box, as it is now.
async function aimAt(page: Page, rowId: string, frac: number): Promise<void> {
  const b = await boxOf(row(page, rowId));
  await page.mouse.move(
    b.x + Math.min(60, b.width / 2),
    b.y + b.height * frac,
    { steps: 8 }
  );
  await settled(page);
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
});

test.describe('C1: a drag inside a saved list is drawn by the card', () => {
  // Mid-drag, at pick-up: the card is up, the held row is marked as drawn by
  // it, paints no shadow and none of its content, and its landing slot --
  // its own place, at distance 0 -- stands at full strength.
  async function expectDrawnByCard(page: Page, held: Locator, kind: string) {
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
    await expect.poll(() => slotOpacity(held)).toBe('1');
    // The card says what is held.
    await expect(
      page.locator(`${DRAG_CARD} [data-carry-card-name]`)
    ).toContainText(kind);
  }

  test('a tab', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId);
    await pickUp(page, row(page, 'a1'));
    await expectDrawnByCard(page, row(page, 'a1'), 'Tab a1');
    await cancel(page);
    await expect(page.locator(DRAG_CARD)).toHaveCount(0);
  });

  test('a group', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId);
    await pickUp(page, groupHandle(page, 'alpha'));
    await expectDrawnByCard(page, row(page, 'group:alpha'), 'Alpha');
    await cancel(page);
    await expect(page.locator(DRAG_CARD)).toHaveCount(0);
  });

  test('a window', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId);
    // The FIRST window: folding the windows (KAN-153) moves every window
    // below it up and away from the pointer, which would put the held row a
    // row or more off its own place -- and its slot is then clear of it
    // with or without the fade this test is about.
    await pickUp(page, windowHandle(page, 'w1'));
    await expectDrawnByCard(page, row(page, 'w1'), 'w1');
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

  // Where an element is drawn, transforms included.
  const drawn = (loc: Locator) =>
    loc.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, height: r.height };
    });

  // How far the preview moved a window's block (KAN-184), as it publishes.
  const windowShift = (page: Page, windowId: string): Promise<number> =>
    page
      .locator(`[data-drop-window-id="${windowId}"]`)
      .evaluate((el: HTMLElement) => Number(el.dataset.windowShift ?? 0));

  // The outline's paint: dotted, at 0.45, not hidden with the held row's
  // content, and the landing slot's colour and line width -- 1.5px, which
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
    const compressed = await held.evaluate((el: HTMLElement) => {
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
});
