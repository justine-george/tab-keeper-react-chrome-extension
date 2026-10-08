import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, fireEvent } from '@testing-library/react';

import TabGroupDetailsContainer from '../../components/home/rightpane/TabGroupDetailsContainer';
import { renderWithProviders } from '../setup/renderWithProviders';
import type { RenderWithProvidersResult } from '../setup/renderWithProviders';
import {
  saveToTabContainerInternal,
  selectTabContainer,
} from '../../redux/slices/tabContainerDataStateSlice';
import {
  setAllWindowsCollapsed,
  setHasTabGroupsPermission,
  setIsNotDirty,
} from '../../redux/slices/globalStateSlice';
import {
  foldBackSpringOpened,
  springOpenWindow,
} from '../../redux/springOpenWindows';
import { newWindowFree } from '../../components/home/rightpane/rowDrag/dropRules';
import { DURATION } from '../../styles/scale';

// KAN-379. A drag that opens a window mid-drag previews as a CONTROL drag
// started with it open. Boxes are laid out from the DOM, in content space:
//
//   w1   10..230   a0..a9 at 30, 50 .. 210
//   w2  250..354   b0 270, gb 292 (title), b1 312, b2 332, gb:tail 352
//       250..270   folded: its title row alone, so it grows by 84
//   w3  374..434 | 290..350   c0, c1
//   the trailing block 454..458 | 370..374 ends the content, 458 | 374 tall

const START = 10;
const HEADER = 20;
const TRAILING = 4;
const ROW = 20;
const GAP = 20;
const BAND_MARGIN = 2;
const INDENT = 16;
const WIDTH = 200;
const X = 100;

interface ContentBox {
  top: number;
  height: number;
  left: number;
}

// Every box the engine reads, laid out from what the DOM draws right now.
function layOut(pane: HTMLElement): {
  boxes: Map<Element, ContentBox>;
  height: number;
} {
  const boxes = new Map<Element, ContentBox>();
  const put = (el: Element | null, top: number, height: number, left = 0) => {
    if (el) boxes.set(el, { top, height, left });
  };
  let y = START;
  for (const block of pane.querySelectorAll('[data-drop-window-id]')) {
    const top = y;
    y += block.matches('[data-new-window-target="last"]') ? TRAILING : HEADER;
    const holder = block.querySelector('[data-window-tabs]');
    if (holder) {
      put(holder, y, 0);
      const items = [...holder.querySelectorAll('[data-drag-row-id]')].filter(
        (el) =>
          !holder.contains(
            el.parentElement?.closest('[data-drag-row-id]') ?? null
          )
      );
      for (const item of items) {
        const band = item.querySelector('[data-band-id]');
        if (band === null) {
          put(item, y, ROW);
          put(item.querySelector('[data-drag-row-id]'), y, ROW);
          y += ROW;
          continue;
        }
        y += BAND_MARGIN;
        const bandTop = y;
        put(band.querySelector('[data-group-drag-handle]'), y, ROW);
        y += ROW;
        for (const member of band.querySelectorAll('[data-drag-row-id]')) {
          put(member, y, ROW, INDENT);
          y += ROW;
        }
        put(band.querySelector('[data-fixed-row-id$=":tail"]'), y, 0);
        put(band, bandTop, y - bandTop);
        put(item, bandTop, y - bandTop);
        y += BAND_MARGIN;
      }
    }
    put(block, top, y - top);
    y += GAP;
  }
  const height = y - GAP;
  for (const child of pane.children) put(child, 0, height);
  return { boxes, height };
}

// Every translateY from the element up to the pane, as a real box includes.
function translated(el: Element, pane: HTMLElement): number {
  let sum = 0;
  for (
    let node: Element | null = el;
    node && node !== pane;
    node = node.parentElement
  ) {
    if (node instanceof HTMLElement) {
      const m = /translateY\((-?[\d.]+)px\)/.exec(node.style.transform);
      if (m) sum += Number(m[1]);
    }
  }
  return sum;
}

interface Pane {
  view: number;
  scrollTop: number;
  // The width a scrollbar takes once the content overflows; 0 for none.
  scrollbar: number;
  // Scroll range a transform adds while any row carries one (invariant #2).
  transformOverflow?: number;
}

// A pane that clamps scroll on READ too (#3); logs reads of w2's rows.
function stubLayout(
  pane: HTMLElement,
  { view, scrollTop, scrollbar, transformOverflow = 0 }: Pane
) {
  const w2Reads: { id: string; transform: string }[] = [];
  const transformed = () =>
    [...pane.querySelectorAll<HTMLElement>('[data-drag-row-id]')].some(
      (el) => el.style.transform !== ''
    );
  const contentHeight = () =>
    layOut(pane).height + (transformed() ? transformOverflow : 0);
  const max = () => Math.max(0, contentHeight() - view);
  let top = 0;
  pane.style.overflowY = 'auto';
  Object.defineProperty(pane, 'clientHeight', {
    value: view,
    configurable: true,
  });
  Object.defineProperty(pane, 'scrollHeight', {
    get: contentHeight,
    configurable: true,
  });
  Object.defineProperty(pane, 'scrollTop', {
    get: () => (top = Math.min(top, max())),
    set: (v: number) => (top = Math.max(0, Math.min(v, max()))),
    configurable: true,
  });
  const spy = vi.spyOn(Element.prototype, 'getBoundingClientRect');
  spy.mockImplementation(function (this: Element) {
    if (this === pane) {
      return DOMRect.fromRect({ x: 0, y: 0, width: WIDTH, height: view });
    }
    const { boxes, height } = layOut(pane);
    const box = boxes.get(this);
    if (box === undefined) return DOMRect.fromRect({});
    if (
      this instanceof HTMLElement &&
      this.closest('[data-drop-window-id="w2"]') !== null &&
      this.dataset.dragRowId !== undefined
    ) {
      w2Reads.push({
        id: this.dataset.dragRowId,
        transform: this.style.transform,
      });
    }
    const right = WIDTH - (height > view ? scrollbar : 0);
    return DOMRect.fromRect({
      x: box.left,
      y: box.top - pane.scrollTop + translated(this, pane),
      width: right - box.left,
      height: box.height,
    });
  });
  pane.scrollTop = scrollTop;
  return { w2Reads, restore: () => spy.mockRestore() };
}

const tab = (id: string, g?: string, pinned = false) => ({
  tabId: id,
  favicon: '',
  title: `Tab ${id}`,
  url: `https://${id}.test`,
  ...(g ? { chromeGroupId: g } : {}),
  ...(pinned ? { pinned: true as const } : {}),
});

const win = (
  windowId: string,
  tabs: ReturnType<typeof tab>[],
  chromeTabGroups: { groupId: string; title: string; color: string }[] = []
) => ({
  windowId,
  windowHeight: 1080,
  windowWidth: 1920,
  windowOffsetTop: 0,
  windowOffsetLeft: 0,
  tabCount: tabs.length,
  title: windowId,
  tabs,
  chromeTabGroups,
});

const A = Array.from({ length: 10 }, (_, i) => `a${i}`);

const WINDOWS = [
  win(
    'w1',
    A.map((id) => tab(id))
  ),
  win(
    'w2',
    [tab('b0'), tab('b1', 'gb'), tab('b2', 'gb')],
    [{ groupId: 'gb', title: 'GB', color: 'red' }]
  ),
  win('w3', [tab('c0'), tab('c1')]),
];

async function render(w2Folded: boolean, windows = WINDOWS) {
  const result = await renderWithProviders(<TabGroupDetailsContainer />, {
    seedStore: (store) => {
      store.dispatch(setHasTabGroupsPermission(true));
      store.dispatch(
        saveToTabContainerInternal({
          tabGroupId: 'tg',
          title: 'Session',
          createdTime: '2026-10-02 09:00:00',
          windowCount: windows.length,
          tabCount: windows.reduce((n, w) => n + w.tabs.length, 0),
          isAutoSave: false,
          isSelected: true,
          windows,
        })
      );
      store.dispatch(selectTabContainer('tg'));
      if (w2Folded) {
        store.dispatch(
          setAllWindowsCollapsed({ tabGroupId: 'tg', windowIds: ['w2'] })
        );
      }
      store.dispatch(setIsNotDirty());
    },
  });
  const pane = result.container.firstElementChild;
  if (!(pane instanceof HTMLElement)) throw new Error('no pane');
  return { ...result, pane };
}

const rowEl = (pane: HTMLElement, id: string) => {
  const el = pane.querySelector<HTMLElement>(`[data-drag-row-id="${id}"]`);
  if (el === null) throw new Error(`no row ${id}`);
  return el;
};

const midOf = (el: HTMLElement) => {
  const box = el.getBoundingClientRect();
  return box.top + box.height / 2;
};

const moveTo = (y: number) =>
  fireEvent.pointerMove(document, { clientX: X, clientY: y });

// Everything the preview draws, as the DOM shows it.
function preview(pane: HTMLElement) {
  const style = (el: HTMLElement | null) =>
    el === null
      ? null
      : {
          transform: el.style.transform,
          left: el.style.left,
          right: el.style.right,
        };
  return {
    rows: Object.fromEntries(
      [...pane.querySelectorAll<HTMLElement>('[data-drag-row-id]')].map(
        (el) => [el.dataset.dragRowId, el.style.transform]
      )
    ),
    titles: [...pane.querySelectorAll<HTMLElement>('[data-group-drag-handle]')]
      .map((el) => el.style.transform)
      .join('|'),
    windowShifts: [
      ...pane.querySelectorAll<HTMLElement>('[data-drop-window-id]'),
    ].map((el) => `${el.dataset.dropWindowId}:${el.dataset.windowShift ?? 0}`),
    slot: style(pane.querySelector('[data-drag-landing-slot]')),
    sourceRoom: style(pane.querySelector('[data-drag-source-room]')),
    marked: [...pane.querySelectorAll<HTMLElement>('[data-drop-target]')].map(
      (el) => el.dataset.bandId
    ),
    lit: [...pane.querySelectorAll<HTMLElement>('[data-landing]')].map(
      (el) => el.dataset.dropWindowId
    ),
    free: newWindowFree(),
  };
}

const windowsOf = (store: RenderWithProvidersResult['store']) =>
  store
    .getState()
    .tabContainerDataState.tabGroups[0].windows.map((w) =>
      w.tabs
        .map(
          (t) => t.tabId + (t.chromeGroupId ? '*' : '') + (t.pinned ? '^' : '')
        )
        .join(' ')
    );

interface Run {
  held: string;
  aims: number[];
  release: number;
  pane: Pane;
  windows?: typeof WINDOWS;
  // What the press lands on, when it is not the held row itself (a group's title).
  press?: string;
}

// Holds `held`, rests on w2's title (opening it if folded), aims, releases.
async function drag(w2Folded: boolean, run: Run) {
  const { store, pane, unmount } = await render(w2Folded, run.windows);
  const { restore } = stubLayout(pane, run.pane);
  const y = (content: number) => content - run.pane.scrollTop;
  const held =
    run.press === undefined
      ? rowEl(pane, run.held)
      : pane.querySelector<HTMLElement>(run.press);
  if (held === null) throw new Error(`no ${run.press}`);
  const start = midOf(held);
  fireEvent.pointerDown(held, { clientX: X, clientY: start, button: 0 });
  moveTo(start + 6);
  moveTo(y(260));
  const freeBeforeOpen = newWindowFree();
  if (w2Folded) act(() => springOpenWindow('w2'));

  const previews = run.aims.map((aim) => {
    moveTo(y(aim));
    return {
      aim,
      heldOffPointer: midOf(rowEl(pane, run.held)) - y(aim),
      ...preview(pane),
    };
  });
  // The release lands where the last move put the pointer.
  moveTo(y(run.release));
  fireEvent.pointerUp(document, { clientX: X, clientY: y(run.release) });
  const after = windowsOf(store);
  act(() => foldBackSpringOpened());
  unmount();
  restore();
  return { previews, after, freeBeforeOpen };
}

const START_WINDOWS = [A.join(' '), 'b0 b1* b2*', 'c0 c1'];

let frames: FrameRequestCallback[] = [];
// Runs auto-scroll frames until the list stops moving.
function scrollToRest(pane: HTMLElement) {
  for (let i = 0; i < 200; i++) {
    const before = pane.scrollTop;
    act(() => {
      const due = frames;
      frames = [];
      due.forEach((cb) => cb(0));
    });
    if (pane.scrollTop === before && i > 0) return;
  }
}

const UNSCROLLED: Pane = { view: 600, scrollTop: 0, scrollbar: 0 };
const SCROLLED: Pane = { view: 150, scrollTop: 200, scrollbar: 0 };

// CPU-bound (~0.8s locally, two full renders and drags); CI's shared runner took 5.55s, past the 5s hang guard (KAN-397).
vi.setConfig({ testTimeout: 20_000 });

beforeEach(() => {
  // Frames run only when a test runs them: nothing else moves the list.
  frames = [];
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
    frames.push(cb);
    return frames.length;
  });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
});

afterEach(() => {
  act(() => foldBackSpringOpened());
  document.documentElement.removeAttribute('data-dragging');
  document.documentElement.removeAttribute('data-drag-new-window');
  vi.restoreAllMocks();
});

describe('a window opened mid-drag is measured as if it had been open (KAN-379)', () => {
  // a9: loose after b0 (285), gb's head (300), after b1 (325), gb's end (345).
  describe.each([
    ['from the top', UNSCROLLED],
    ['from scrollTop 200', SCROLLED],
  ])('%s', (_, pane) => {
    test('a tab held above the window previews and lands as in a drag started with it open', async () => {
      const run: Run = {
        held: 'a9',
        aims: [260, 285, 300, 325, 345],
        release: 325,
        pane,
      };
      const control = await drag(false, run);
      const opened = await drag(true, run);

      // PREMISE: the control lands in w2, after b1, in gb.
      expect(control.after[1]).toBe('b0 b1* a9* b2*');
      expect(opened.previews).toEqual(control.previews);
      expect(opened.after).toEqual(control.after);
    });

    test('a tab held below the window stays under the pointer, and previews as in a drag started with it open', async () => {
      const run: Run = {
        held: 'c0',
        aims: [260, 285, 325],
        release: 285,
        pane,
      };
      const control = await drag(false, run);
      const opened = await drag(true, run);

      expect(control.after[1]).toBe('b0 c0 b1* b2*');
      for (const p of opened.previews) expect(p.heldOffPointer).toBe(0);
      expect(opened.previews).toEqual(control.previews);
      expect(opened.after).toEqual(control.after);
    });
  });

  // The open adds a 10px scrollbar; the slot keeps the member box (16, 0).
  test('a list the open makes scroll narrows its rows, and the slot keeps the member box', async () => {
    const run: Run = {
      held: 'a9',
      aims: [325],
      release: 325,
      pane: { view: 450, scrollTop: 0, scrollbar: 10 },
    };
    const control = await drag(false, run);
    const opened = await drag(true, run);

    expect(control.previews[0].slot).toEqual({
      transform: expect.any(String),
      left: '16px',
      right: '0px',
    });
    expect(opened.previews[0].slot).toEqual(control.previews[0].slot);
  });

  // The preview moves w1's rows; w2's, drawn by the open, were in no range.
  // Scrolled, a missing box taken into content space would sit among w1's.
  test.each([
    ['from the top', UNSCROLLED, 35, 'a0'],
    [
      'from scrollTop 150',
      { view: 200, scrollTop: 150, scrollbar: 0 },
      155,
      'a6',
    ],
  ])(
    'an unmeasured row never gets a shift, so the opened rows are measured unmoved (%s)',
    async (_, at, aim, moved) => {
      const { pane } = await render(true);
      const { w2Reads } = stubLayout(pane, at);
      const held = rowEl(pane, 'a9');
      const start = midOf(held);
      fireEvent.pointerDown(held, { clientX: X, clientY: start, button: 0 });
      moveTo(start + 6);
      moveTo(aim - at.scrollTop);
      // PREMISE: the preview is moving rows, from the held row up to `moved`.
      expect(pane.scrollTop).toBe(at.scrollTop);
      expect(rowEl(pane, moved).style.transform).toBe('translateY(20px)');

      act(() => springOpenWindow('w2'));

      // PREMISE: the opened rows were measured.
      expect(new Set(w2Reads.map((r) => r.id))).toEqual(
        new Set(['b0', 'b1', 'b2'])
      );
      expect(w2Reads.filter((r) => r.transform !== '')).toEqual([]);
      for (const id of ['b0', 'b1', 'b2']) {
        expect(rowEl(pane, id).style.transform).toBe('');
      }
      fireEvent.keyDown(window, { key: 'Escape' });
    }
  );
  // Eased in from 0, they would slide out from under the preview they never had.
  test('the opened rows and band title are drawn at their shift at once, and ease again from the next move', async () => {
    const { pane } = await render(true);
    stubLayout(pane, UNSCROLLED);
    const held = rowEl(pane, 'c0');
    const start = midOf(held);
    fireEvent.pointerDown(held, { clientX: X, clientY: start, button: 0 });
    moveTo(start + 6);
    moveTo(260);
    act(() => springOpenWindow('w2'));

    const eased = `transform ${DURATION.MOVE} ease`;
    const opened = ['b0', 'b1', 'b2'].map((id) => rowEl(pane, id));
    const band = pane.querySelector<HTMLElement>('[data-fixed-row-id="gb"]');
    if (band === null) throw new Error('no band title');
    const drawn = () =>
      [...opened, band].map((el) => [el.style.transform, el.style.transition]);
    // PREMISE: the open shifts them.
    expect(drawn().filter(([transform]) => transform === '')).toEqual([]);
    const shifted = drawn().map(([transform]) => transform);
    expect(drawn().map(([, transition]) => transition)).toEqual([
      'none',
      'none',
      'none',
      'none',
    ]);
    // CONTROL: a row measured at the press keeps its easing.
    expect(rowEl(pane, 'c1').style.transition).toBe(eased);

    moveTo(261);
    expect(drawn()).toEqual([
      [shifted[0], eased],
      [shifted[1], eased],
      [shifted[2], eased],
      [shifted[3], ''],
    ]);
    fireEvent.keyDown(window, { key: 'Escape' });
  });

  // Fits open or folded in 460; open, 6px stays free below the last window.
  test('the space free below the last window is read again, so a new window there is refused as when started open', async () => {
    const run: Run = {
      held: 'a9',
      aims: [260, 445],
      release: 445,
      pane: { view: 460, scrollTop: 0, scrollbar: 0 },
    };
    const control = await drag(false, run);
    const opened = await drag(true, run);

    // PREMISE: folded, 90px was free; started open, 6 is under half a row.
    expect(opened.freeBeforeOpen).toBe(90);
    expect(control.previews[1].free).toBe(6);
    expect(control.after).toEqual(START_WINDOWS);
    expect(opened.previews).toEqual(control.previews);
    expect(opened.after).toEqual(control.after);
  });

  // Folded 374 fits in 400; open, 458 does not. A row's transform adds 1000
  // of scroll range, so only a derived limit stops at 58.
  test('a list the open makes scroll auto-scrolls to its derived end', async () => {
    const { pane } = await render(true);
    stubLayout(pane, {
      view: 400,
      scrollTop: 0,
      scrollbar: 0,
      transformOverflow: 1000,
    });
    const held = rowEl(pane, 'a9');
    const start = midOf(held);
    fireEvent.pointerDown(held, { clientX: X, clientY: start, button: 0 });
    moveTo(start + 6);
    moveTo(260);
    // With nothing to scroll the loop stops.
    scrollToRest(pane);
    expect(frames).toEqual([]);

    act(() => springOpenWindow('w2'));
    moveTo(395);
    // PREMISE: a live read would give the transform's range.
    expect(pane.scrollHeight).toBe(458 + 1000);
    scrollToRest(pane);

    expect(pane.scrollTop).toBe(458 - 400);
    fireEvent.keyDown(window, { key: 'Escape' });
  });

  test('a list that scrolled from the start auto-scrolls to its end plus the growth', async () => {
    const { pane } = await render(true);
    stubLayout(pane, {
      view: 150,
      scrollTop: 200,
      scrollbar: 0,
      transformOverflow: 1000,
    });
    const held = rowEl(pane, 'a9');
    const start = midOf(held);
    fireEvent.pointerDown(held, { clientX: X, clientY: start, button: 0 });
    moveTo(start + 6);
    moveTo(60);
    act(() => springOpenWindow('w2'));
    moveTo(145);
    scrollToRest(pane);

    expect(pane.scrollTop).toBe(374 - 150 + 84);
    fireEvent.keyDown(window, { key: 'Escape' });
  });
});

// KAN-458 R1. A window this drag opened draws its rows, so position decides there as in one started open.
describe('a drop into a window this drag opened keeps the pinned rules of an open one (KAN-458)', () => {
  // w2's b0 is pinned; w3 holds a group gc. 275 is above b0's midpoint: index 0, inside the pinned run.
  const pinnedW2 = [
    WINDOWS[0],
    win(
      'w2',
      [tab('b0', undefined, true), tab('b1', 'gb'), tab('b2', 'gb')],
      [{ groupId: 'gb', title: 'GB', color: 'red' }]
    ),
    win(
      'w3',
      [tab('c0', 'gc'), tab('c1', 'gc')],
      [{ groupId: 'gc', title: 'GC', color: 'green' }]
    ),
  ];

  test('a tab dropped above the pinned tab is pinned there, as in a drag started with it open', async () => {
    const run: Run = {
      held: 'a9',
      aims: [275],
      release: 275,
      pane: UNSCROLLED,
      windows: pinnedW2,
    };
    const control = await drag(false, run);
    const opened = await drag(true, run);

    // PREMISE: the control lands first in w2, pinned.
    expect(control.after[1]).toBe('a9^ b0^ b1* b2*');
    expect(opened.previews).toEqual(control.previews);
    expect(opened.after).toEqual(control.after);
  });

  test('a group held above the pinned tab previews and lands after it, as in a drag started with it open', async () => {
    const run: Run = {
      held: 'group:gc',
      press: '[data-drag-row-id="group:gc"] [data-group-drag-handle]',
      aims: [275],
      release: 275,
      pane: UNSCROLLED,
      windows: pinnedW2,
    };
    const control = await drag(false, run);
    const opened = await drag(true, run);

    // PREMISE: the control lands right after the pinned run.
    expect(control.after[1]).toBe('b0^ c0* c1* b1* b2*');
    expect(opened.previews).toEqual(control.previews);
    expect(opened.after).toEqual(control.after);
  });
});
