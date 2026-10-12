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
