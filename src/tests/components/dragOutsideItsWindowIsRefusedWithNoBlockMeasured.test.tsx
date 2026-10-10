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

// KAN-132. A PROPERTY OF THIS HARNESS, NOT THE PRODUCT (cross-window drops: e2e/cross-window-drag.spec.ts).
// `layout` stubs every row's rect but no window block, so landingBlock finds none and a release falls back to the held row's
// own window (isInsideList). Deep in window B's rows that is outside A's rows-plus-slack, so it is refused. Pinned here: a release
// with nowhere to land is refused, not dropped to the bottom of its own window -- bounded by the rows measured at drag start,
// not the container rect read at drop, which already holds the drag's own shifts.

const box = (top: number, height: number): DOMRect => ({
  top,
  bottom: top + height,
  left: 0,
  right: 200,
  height,
  width: 200,
  x: 0,
  y: top,
  toJSON: () => ({}),
});

const win = (id: string, title: string, n: number) => ({
  windowId: id,
  windowHeight: 800,
  windowWidth: 1200,
  windowOffsetTop: 0,
  windowOffsetLeft: 0,
  tabCount: n,
  title,
  tabs: Array.from({ length: n }, (_, i) => ({
    tabId: `${id}-t${i}`,
    favicon: '',
    title: `${title} tab ${i}`,
    url: `https://${id}-${i}.test`,
  })),
});

const buildSession = () => ({
  tabGroupId: 'g1',
  title: 'Session',
  createdTime: '2026-09-07 09:00:00',
  windowCount: 2,
  tabCount: 5,
  isAutoSave: false,
  isSelected: true,
  windows: [win('wA', 'Window A', 3), win('wB', 'Window B', 2)],
});

// Window A's three tabs tile [0,60); window B's two tile [200,240). B's header sits in the gap.
const TAB_H = 20;
const A_TABS = ['wA-t0', 'wA-t1', 'wA-t2'];
const B_TABS = ['wB-t0', 'wB-t1'];

const render = () =>
  renderWithProviders(<TabGroupDetailsContainer />, {
    seedStore: (store) => {
      store.dispatch(setHasTabGroupsPermission(false));
      store.dispatch(saveToTabContainerInternal(buildSession()));
      store.dispatch(selectTabContainer('g1'));
      store.dispatch(setIsNotDirty());
    },
  });

const layout = (container: HTMLElement) => {
  const node = (id: string): HTMLElement => {
    const el = container.querySelector<HTMLElement>(
      `[data-drag-row-id="${id}"]`
    );
    if (!el) throw new Error(`no row ${id}`);
    return el;
  };
  A_TABS.forEach((id, i) => {
    node(id).getBoundingClientRect = () => box(i * TAB_H, TAB_H);
  });
  B_TABS.forEach((id, i) => {
    node(id).getBoundingClientRect = () => box(200 + i * TAB_H, TAB_H);
  });
  return node;
};

const drag = (from: HTMLElement, startY: number, endY: number) => {
  fireEvent.pointerDown(from, { clientX: 10, clientY: startY, button: 0 });
  fireEvent.pointerMove(document, {
    clientX: 10,
    clientY: (startY + endY) / 2,
  });
  fireEvent.pointerMove(document, { clientX: 10, clientY: endY });
  fireEvent.pointerUp(document, { clientX: 10, clientY: endY });
};

const tabsOf = (store: RenderWithProvidersResult['store'], i: number) =>
  store
    .getState()
    .tabContainerDataState.tabGroups[0].windows[i].tabs.map((t) => t.tabId);

afterEach(() => {
  document.documentElement.removeAttribute('data-dragging');
});

describe('a tab released outside its own window, with no block measured to land in', () => {
  test('commits nothing, refused for lack of a block rather than dropped to the bottom of its own window', async () => {
    const { container, store } = await render();
    const node = layout(container);

    // Deep inside window B's rows, well past window A's span.
    drag(node('wA-t0'), 10, 235);

    expect(tabsOf(store, 0)).toEqual(['wA-t0', 'wA-t1', 'wA-t2']);
    expect(tabsOf(store, 1)).toEqual(['wB-t0', 'wB-t1']);
    expect(store.getState().globalState.isDirty).toBe(false);
  });

  // CONTROL: an area that refused every drop would pass the test above.
  test('CONTROL: the same tab still reorders inside its own window', async () => {
    const { container, store } = await render();
    const node = layout(container);

    drag(node('wA-t0'), 10, 55);

    expect(tabsOf(store, 0)).toEqual(['wA-t1', 'wA-t2', 'wA-t0']);
  });

  // CONTROL, and where the boundary sits: the slack is half the held row, so a slight overshoot past the last row still moves it.
  test('CONTROL: overshooting the last row slightly still lands at the end', async () => {
    const { container, store } = await render();
    const node = layout(container);

    // Window A's rows end at y=60; half a row of slack takes it to 70.
    drag(node('wA-t0'), 10, 68);

    expect(tabsOf(store, 0)).toEqual(['wA-t1', 'wA-t2', 'wA-t0']);
  });

  // The user dragged, not asked to open the tab: a refused drop commits nothing, so its click would reach the row unless swallowed.
  test('the click after a refused drop is still swallowed', async () => {
    const { container, chrome } = await render();
    const node = layout(container);
    const row = node('wA-t0');

    drag(row, 10, 235);
    fireEvent.click(row, { clientX: 10, clientY: 235 });

    expect(chrome.createdTabs).toHaveLength(0);
  });
});
