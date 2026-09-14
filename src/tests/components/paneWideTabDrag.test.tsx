import { describe, expect, test, afterEach } from 'vitest';
import { act, fireEvent } from '@testing-library/react';

import TabGroupDetailsContainer from '../../components/home/rightpane/TabGroupDetailsContainer';
import { renderWithProviders } from '../setup/renderWithProviders';
import type { RenderWithProvidersResult } from '../setup/renderWithProviders';
import {
  saveToTabContainerInternal,
  selectTabContainer,
} from '../../redux/slices/tabContainerDataStateSlice';
import {
  setHasTabGroupsPermission,
  setIsNotDirty,
} from '../../redux/slices/globalStateSlice';

// KAN-132. The tab drag is ONE drag area over every tab in the session, rather
// than one per window, so that a tab can be dropped into another window. Each
// test here pins one way a naive pane-wide list gets that wrong:
//
//   * the index a drop reports must count the rows of the window it lands in,
//     not every row above it in the pane
//   * a release over another window moves the tab there; one in no window at
//     all is refused
//   * a window's groups must not answer for a drop in a different window, where
//     their window-local positions mean nothing
//   * a band lights up in whichever window the pointer is over, and the one it
//     left goes dark
//
// jsdom has no layout, so every row, title row, tail marker and band is given a
// box below. The window blocks are measured only where a test says so
// (measureWindows): unmeasured, no release is over any window, which is what
// the tests that predate the cross-window drop still see.

const box = (top: number, height: number) =>
  ({
    top,
    bottom: top + height,
    left: 0,
    right: 200,
    height,
    width: 200,
    x: 0,
    y: top,
    toJSON: () => ({}),
  }) as DOMRect;

const tab = (id: string, g?: string) => ({
  tabId: id,
  favicon: '',
  title: `Tab ${id}`,
  url: `https://${id}.test`,
  ...(g ? { chromeGroupId: g } : {}),
});

const win = (
  windowId: string,
  tabs: ReturnType<typeof tab>[],
  chromeTabGroups: { groupId: string; title: string; color: string }[]
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

// wA: three loose tabs, then group ga. wB: a LEADING group gb, then two loose
// tabs -- so gb's first member sits at window-local index 0, the same number as
// wA's first tab.
const render = () =>
  renderWithProviders(<TabGroupDetailsContainer />, {
    seedStore: (store) => {
      store.dispatch(setHasTabGroupsPermission(true));
      store.dispatch(
        saveToTabContainerInternal({
          tabGroupId: 'tg',
          title: 'Session',
          createdTime: '2026-09-12 09:00:00',
          windowCount: 2,
          tabCount: 9,
          isAutoSave: false,
          isSelected: true,
          windows: [
            win(
              'wA',
              [
                tab('a0'),
                tab('a1'),
                tab('a2'),
                tab('a3', 'ga'),
                tab('a4', 'ga'),
              ],
              [{ groupId: 'ga', title: 'GA', color: 'blue' }]
            ),
            win(
              'wB',
              [tab('b0', 'gb'), tab('b1', 'gb'), tab('b2'), tab('b3')],
              [{ groupId: 'gb', title: 'GB', color: 'red' }]
            ),
          ],
        })
      );
      store.dispatch(selectTabContainer('tg'));
      store.dispatch(setIsNotDirty());
    },
  });

const ROW = 20;

// Layout order and tops. Bands carry a 2px margin, so the loose row after a
// band starts 2px below its tail.
//
//   wA: a0 0, a1 20, a2 40, [ga title 60, a3 80, a4 100, ga:tail 120]
//   wB: [gb title 200, b0 220, b1 240, gb:tail 260], b2 262, b3 282
const ROWS: Record<string, number> = {
  a0: 0,
  a1: 20,
  a2: 40,
  a3: 80,
  a4: 100,
  b0: 220,
  b1: 240,
  b2: 262,
  b3: 282,
};
const FIXED: Record<string, [number, number]> = {
  ga: [60, ROW],
  'ga:tail': [120, 0],
  gb: [200, ROW],
  'gb:tail': [260, 0],
};
const BANDS: Record<string, [number, number]> = {
  ga: [60, 60],
  gb: [200, 60],
};

const layout = (container: HTMLElement) => {
  const q = (selector: string) =>
    container.querySelector<HTMLElement>(selector)!;
  for (const [id, top] of Object.entries(ROWS)) {
    q(`[data-drag-row-id="${id}"]`).getBoundingClientRect = () => box(top, ROW);
  }
  for (const [key, [top, height]] of Object.entries(FIXED)) {
    q(`[data-fixed-row-id="${key}"]`).getBoundingClientRect = () =>
      box(top, height);
  }
  for (const [id, [top, height]] of Object.entries(BANDS)) {
    q(`[data-band-id="${id}"]`).getBoundingClientRect = () => box(top, height);
  }
  return (id: string) => q(`[data-drag-row-id="${id}"]`);
};

// The window blocks, with a gap between them where the next window's header
// margin sits:
//
//   wA  0..142     wB  180..302 (its header 180..200)
const BLOCKS: Record<string, [number, number]> = {
  wA: [0, 142],
  wB: [180, 122],
};
const GAP_Y = 160;

// A real getBoundingClientRect includes every transform above the element, so
// a block the preview has MOVED to make room reports its moved box (KAN-184).
// jsdom applies no transforms at all, so the double has to add that itself --
// otherwise windowBlockAt subtracts a shift the box never had, and the moved
// window claims a pointer that is nowhere near it.
const measureWindows = (container: HTMLElement) => {
  for (const [id, [top, height]] of Object.entries(BLOCKS)) {
    const el = container.querySelector<HTMLElement>(
      `[data-drop-window-id="${id}"]`
    )!;
    el.getBoundingClientRect = () =>
      box(top + (parseFloat(el.dataset.windowShift ?? '') || 0), height);
  }
};

const press = (el: HTMLElement, y: number) => {
  fireEvent.pointerDown(el, { clientX: 10, clientY: y, button: 0 });
  // Past the activation distance, without leaving the row.
  fireEvent.pointerMove(document, { clientX: 10, clientY: y + 6 });
};
const moveTo = (y: number) =>
  fireEvent.pointerMove(document, { clientX: 10, clientY: y });
const release = (y: number) =>
  fireEvent.pointerUp(document, { clientX: 10, clientY: y });

const shift = (el: HTMLElement) =>
  Number(/translateY\((-?[\d.]+)px\)/.exec(el.style.transform)?.[1] ?? 0);

const tabsOf = (store: RenderWithProvidersResult['store'], i: number) =>
  store
    .getState()
    .tabContainerDataState.tabGroups[0].windows[i].tabs.map(
      (t) => t.tabId + (t.chromeGroupId ? '*' : '')
    )
    .join(' ');

const A_START = 'a0 a1 a2 a3* a4*';
const B_START = 'b0* b1* b2 b3';

afterEach(() => {
  document.documentElement.removeAttribute('data-dragging');
});

describe('a tab drag in a pane-wide list', () => {
  // The index a drop reports is applied to the tab's own window. Counted over
  // the whole pane it would include every row of wA above.
  test('a reorder in the SECOND window lands at its place in that window', async () => {
    const { container, store } = await render();
    const node = layout(container);

    // b3 up past b1's midpoint (250) but not b2's (272), and clear of gb's
    // band (200..260): lands loose, after b1.
    press(node('b3'), 292);
    moveTo(266);
    release(266);

    expect(tabsOf(store, 1)).toBe('b0* b1* b3 b2');
    expect(tabsOf(store, 0)).toBe(A_START);
  });

  test('a tab from the second window released over the first lands there', async () => {
    const { container, store } = await render();
    const node = layout(container);
    measureWindows(container);

    // Past a0's midpoint (10), not a1's (30): after a0.
    press(node('b2'), 272);
    moveTo(28);
    release(28);

    expect(tabsOf(store, 0)).toBe('a0 b2 a1 a2 a3* a4*');
    expect(tabsOf(store, 1)).toBe('b0* b1* b3');
  });

  // KAN-185, and this REPLACES "a release between two windows commits nothing".
  //
  // The 8px between two window blocks used to name no window, so a release
  // there was refused -- and dragging slowly across the boundary showed the
  // landing snap home to the row's own origin and out again, measured over a
  // 6px band in the popup. The gap belongs to the NEARER block now, so the
  // boundary is a point rather than a band, and a release in it lands.
  //
  // GAP_Y is just above the middle of this fixture's gap, so it is the window
  // ABOVE that owns it, and the row lands at that window's end -- past every
  // one of its rows' midpoints.
  test('a release between two windows lands in the nearer one', async () => {
    const { container, store } = await render();
    const node = layout(container);
    measureWindows(container);

    press(node('b2'), 272);
    moveTo(GAP_Y);
    release(GAP_Y);

    expect(tabsOf(store, 0)).toBe(`${A_START} b2`);
    expect(tabsOf(store, 1)).toBe('b0* b1* b3');
    expect(store.getState().globalState.isDirty).toBe(true);
  });

  // THE CONTROL for the rule above: the gap is only between two blocks. Far
  // below the last window there is no nearer block to claim the release, and
  // it is still refused -- the KAN-132 guard this must not have widened.
  test('CONTROL: a release below the last window still commits nothing', async () => {
    const { container, store } = await render();
    const node = layout(container);
    measureWindows(container);

    press(node('b2'), 272);
    moveTo(400);
    release(400);

    expect(tabsOf(store, 0)).toBe(A_START);
    expect(tabsOf(store, 1)).toBe(B_START);
    expect(store.getState().globalState.isDirty).toBe(false);
  });

  // Where the landing gap opens. a1 held at the top of wA lands at index 0, and
  // wB's leading group ALSO starts at index 0 of its own window -- so a rule
  // that asked every window's groups would answer "before gb's title row", and
  // draw the gap at the far end of wA.
  test("a drag to the top of the first window does not answer to the second window's leading group", async () => {
    const { container } = await render();
    const node = layout(container);

    press(node('a1'), 30);
    moveTo(4);

    // The row above steps down into the vacated slot; nothing else moves.
    expect(shift(node('a0'))).toBe(ROW);
    expect(shift(node('a2'))).toBe(0);
    expect(shift(node('a3'))).toBe(0);

    // And nothing at all in the other window.
    for (const id of ['b0', 'b1', 'b2', 'b3']) expect(shift(node(id))).toBe(0);
    const gbTitle = container.querySelector<HTMLElement>(
      '[data-band-id="gb"] [data-group-drag-handle]'
    )!;
    expect(gbTitle.style.transform).toBe('');

    fireEvent.keyDown(window, { key: 'Escape' });
  });
});

describe('a tab drag marks the band of the window it is over', () => {
  const marked = (container: HTMLElement) =>
    [...container.querySelectorAll<HTMLElement>('[data-drop-target]')].map(
      (b) => b.dataset.bandId
    );

  // A release there joins gb, so gb says so -- and ga, marked a move earlier in
  // ANOTHER window, must not stay lit beside it.
  test("hovering another window's band marks it, and clears the one it left", async () => {
    const { container } = await render();
    const node = layout(container);
    measureWindows(container);

    press(node('a0'), 10);
    moveTo(90); // inside ga's band, in wA
    expect(marked(container)).toEqual(['ga']);

    moveTo(230); // squarely inside gb's band, in wB
    expect(marked(container)).toEqual(['gb']);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(marked(container)).toEqual([]);
  });

  // THE CONTROL. A list that never marked anything would pass the test above.
  test("CONTROL: hovering its own window's band marks it", async () => {
    const { container } = await render();
    const node = layout(container);

    press(node('a0'), 10);
    moveTo(90); // inside ga's band, in wA

    expect(marked(container)).toEqual(['ga']);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(marked(container)).toEqual([]);
  });
});

// The pane's tab-list hooks sit ABOVE its nothing-selected early return. Below
// it, the first render with no session runs fewer hooks than the next one, and
// React throws on the transition -- which no render that starts with a session
// selected can show.
describe('the pane across selecting a session', () => {
  test('renders nothing, then the session, without changing its hook count', async () => {
    const { container, store } = await renderWithProviders(
      <TabGroupDetailsContainer />,
      {
        seedStore: (s) => {
          s.dispatch(setHasTabGroupsPermission(true));
        },
      }
    );
    // PREMISE: the first render really had no session to show.
    expect(container.querySelector('[data-window-tabs]')).toBeNull();

    act(() => {
      store.dispatch(
        saveToTabContainerInternal({
          tabGroupId: 'later',
          title: 'Later',
          createdTime: '2026-09-12 10:00:00',
          windowCount: 1,
          tabCount: 1,
          isAutoSave: false,
          isSelected: true,
          windows: [win('wL', [tab('l0')], [])],
        })
      );
      store.dispatch(selectTabContainer('later'));
    });

    expect(container.querySelectorAll('[data-window-tabs]')).toHaveLength(1);
  });
});
