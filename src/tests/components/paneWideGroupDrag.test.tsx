import { describe, expect, test, afterEach } from 'vitest';
import { fireEvent } from '@testing-library/react';

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

// KAN-132. The group drag is ONE drag area over every window's top-level rows,
// rather than one per window -- the same move the tab list made, one level up.
//
// Each test below pins one way a naive pane-wide list breaks:
//
//   * the index a drop reports must count the items of the window it lands in,
//     not every item above it in the pane
//   * a release over ANOTHER window lands there, previewed in each window's own
//     frame (KAN-132 §11.3); one over NO window is still refused
//   * a row whose window holds a single item must still measure its own
//     footprint, now that its window's list container is gone
//
// The first and third were written against the per-window areas this file's
// task replaced, and passed there. The second was their exact opposite then --
// the interim rule was that a group could not leave its window at all -- and is
// inverted here by the task that wired the cross-window reducer up.
//
// jsdom has no layout and applies no App.css, so every row and block is given a
// box below and the held group does not compress -- every box here is the
// resting one. What these pin (which window's rows the index counts, which
// releases are refused, which box a footprint is measured on) does not depend on
// the fold; the fold itself is e2e/group-drag.

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

// wA holds ONE item, a loose tab -- the shape whose footprint used to be
// measured on its window's own `items` list container. wB holds three:
// a loose tab, the group gb, and another loose tab.
const render = () =>
  renderWithProviders(<TabGroupDetailsContainer />, {
    seedStore: (store) => {
      store.dispatch(setHasTabGroupsPermission(true));
      store.dispatch(
        saveToTabContainerInternal({
          tabGroupId: 'tg',
          title: 'Session',
          createdTime: '2026-09-13 09:00:00',
          windowCount: 2,
          tabCount: 5,
          isAutoSave: false,
          isSelected: true,
          windows: [
            win('wA', [tab('a0')], []),
            win(
              'wB',
              [tab('b0'), tab('b1', 'gb'), tab('b2', 'gb'), tab('b3')],
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

// The layout, in the pane's content space:
//
//   wA  block 0..40    header 0..20,  tab:a0 20..40
//   wB  block 60..184  header 60..80, tab:b0 80..100,
//                      group:gb 100..160 (title 100..120, b1 120..140,
//                      b2 140..160, gb:tail 160), tab:b3 162..182
const ITEMS: Record<string, [number, number]> = {
  'tab:a0': [20, ROW],
  'tab:b0': [80, ROW],
  'group:gb': [100, 60],
  'tab:b3': [162, ROW],
};
const TABS: Record<string, number> = {
  a0: 20,
  b0: 80,
  b1: 120,
  b2: 140,
  b3: 162,
};
const FIXED: Record<string, [number, number]> = {
  gb: [100, ROW],
  'gb:tail': [160, 0],
};
const BLOCKS: Record<string, [number, number]> = {
  wA: [0, 40],
  wB: [60, 124],
};

// wA's tab-list box, given a height NO ROW HAS. In the popup it is exactly as
// tall as the single row inside it, so a footprint measured on it reads the
// same number by luck; here the two are told apart.
const WINDOW_TABS_H = 100;

const layout = (container: HTMLElement) => {
  const q = (selector: string) =>
    container.querySelector<HTMLElement>(selector)!;
  for (const [id, [top, height]] of Object.entries(ITEMS)) {
    q(`[data-drag-row-id="${id}"]`).getBoundingClientRect = () =>
      box(top, height);
  }
  for (const [id, top] of Object.entries(TABS)) {
    q(`[data-drag-row-id="${id}"]`).getBoundingClientRect = () => box(top, ROW);
  }
  for (const [key, [top, height]] of Object.entries(FIXED)) {
    q(`[data-fixed-row-id="${key}"]`).getBoundingClientRect = () =>
      box(top, height);
  }
  q('[data-band-id="gb"]').getBoundingClientRect = () => box(100, 60);
  q('[data-drop-window-id="wA"] [data-window-tabs]').getBoundingClientRect =
    () => box(20, WINDOW_TABS_H);
  // A real getBoundingClientRect includes every transform above the element, so
  // a block the preview has MOVED to make room reports its moved box (KAN-184).
  // jsdom applies no transforms at all, so the double has to add that itself --
  // otherwise windowBlockAt subtracts a shift the box never had, and the moved
  // window claims a pointer nowhere near it.
  for (const [id, [top, height]] of Object.entries(BLOCKS)) {
    const block = q(`[data-drop-window-id="${id}"]`);
    block.getBoundingClientRect = () =>
      box(top + (parseFloat(block.dataset.windowShift ?? '') || 0), height);
  }
  return (id: string) => q(`[data-drag-row-id="${id}"]`);
};

const handleOf = (container: HTMLElement, groupId: string) =>
  container.querySelector<HTMLElement>(
    `[data-drag-row-id="group:${groupId}"] [data-group-drag-handle]`
  )!;

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

const A_START = 'a0';
const B_START = 'b0 b1* b2* b3';

afterEach(() => {
  document.documentElement.removeAttribute('data-dragging');
});

describe('a group drag in a pane-wide items list', () => {
  // The index a drop reports is applied to the group's own window. Counted over
  // the whole pane it would include wA's item above, and gb moved to its own
  // place is the no-op the reducer already refuses -- so the wrong number reads
  // as "nothing happened".
  test('a reorder in the SECOND window lands at its place in that window', async () => {
    const { container, store } = await render();
    const node = layout(container);

    // Above tab:b0's midpoint (90): the top of wB.
    press(handleOf(container, 'gb'), 110);
    moveTo(85);
    release(85);

    expect(tabsOf(store, 1)).toBe('b1* b2* b0 b3');
    expect(tabsOf(store, 0)).toBe(A_START);
    // The other window's row never moved.
    expect(shift(node('tab:a0'))).toBe(0);
  });

  // KAN-132 §11.3, and the reason the pane-wide list exists at all: the group
  // lands in the OTHER window, at an index counted among THAT window's items.
  //
  // wA holds one item, so index 0 and index 1 are the two answers available,
  // and they differ visibly: this releases ABOVE that item's midpoint, so the
  // group goes first and the item steps aside for it. An index counted over the
  // pane instead, or applied to the group's own window, cannot produce this.
  test('a group released over the first window lands there', async () => {
    const { container, store } = await render();
    const node = layout(container);

    // Squarely over wA's block, and above its only row's midpoint (30).
    press(handleOf(container, 'gb'), 110);
    moveTo(25);

    // THE PREVIEW, in each window's own frame: wA opens from its first item
    // down, wB closes up below the group that is leaving it, and nothing else
    // moves.
    const footprint = shift(node('tab:a0'));
    expect(footprint).toBeGreaterThan(0);
    expect(shift(node('tab:b3'))).toBe(-footprint);
    expect(shift(node('tab:b0'))).toBe(0);

    release(25);

    expect(tabsOf(store, 0)).toBe('b1* b2* a0');
    expect(tabsOf(store, 1)).toBe('b0 b3');
  });

  // KAN-185, and this REPLACES "a group released between the two windows
  // commits nothing". The gap between two blocks belongs to the NEARER of
  // them, so the boundary is a point rather than an 8px band that previewed a
  // landing back at the row's own origin -- see the tab list's own version of
  // this test for the measurement.
  test('a group released between the two windows lands in the nearer one', async () => {
    const { container, store } = await render();
    layout(container);

    press(handleOf(container, 'gb'), 110);
    moveTo(45);
    release(45);

    // y 45 is nearer wA's block than wB's, and past every wA row's midpoint,
    // so the group arrives whole at the end of that window.
    expect(tabsOf(store, 0)).toBe(`${A_START} b1* b2*`);
    expect(tabsOf(store, 1)).toBe('b0 b3');
    expect(store.getState().globalState.isDirty).toBe(true);
  });

  // THE CONTROL for the refusal above: the same group, released inside its own
  // window, still moves.
  // THE CONTROL for the rule above: the gap belongs to a window only BETWEEN
  // two blocks. Far below the last one there is no nearer block to claim the
  // release, and it is still refused -- the KAN-132 guard this must not widen.
  test('CONTROL: a group released below the last window still commits nothing', async () => {
    const { container, store } = await render();
    layout(container);

    press(handleOf(container, 'gb'), 110);
    moveTo(400);
    release(400);

    expect(tabsOf(store, 0)).toBe(A_START);
    expect(tabsOf(store, 1)).toBe(B_START);
    expect(store.getState().globalState.isDirty).toBe(false);
  });

  test('CONTROL: the same group still reorders inside its own window', async () => {
    const { container, store } = await render();
    layout(container);

    // Past tab:b3's midpoint (172): the end of wB.
    press(handleOf(container, 'gb'), 110);
    moveTo(175);
    release(175);

    expect(tabsOf(store, 1)).toBe('b0 b3 b1* b2*');
    expect(tabsOf(store, 0)).toBe(A_START);
  });
});

// KAN-163's climb, with the list container it used to stop at gone.
//
// A row's footprint is measured on the outermost wrapper that exists only to
// hold it: a loose tab is a `tabs` row inside an `items` row. While each window
// had an `items` area of its own, that area's container sat directly above the
// item row and stopped the climb there. It is now one pane-wide container, far
// above, so the climb would carry on into the window's own tab-list box -- for a
// window holding a SINGLE item, which is the only shape where anything above the
// row has one child.
describe('a window holding one item', () => {
  test('measures its row, not the box its window draws it in', async () => {
    const { container } = await render();
    const node = layout(container);

    // wA's only tab, dropped into wB above b1: every row of wB from there down
    // steps aside by exactly the held row's footprint.
    press(node('a0'), 30);
    moveTo(95);

    expect(shift(node('b1'))).toBe(ROW);
    expect(shift(node('b3'))).toBe(ROW);

    fireEvent.keyDown(window, { key: 'Escape' });
  });
});
