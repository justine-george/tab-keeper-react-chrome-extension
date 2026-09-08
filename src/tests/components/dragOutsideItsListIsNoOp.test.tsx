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

// KAN-132, interim. Moving a tab BETWEEN windows is not built yet; this is about
// what the gesture does in the meantime.
//
// Each window renders its own drag area over its own tabs, so a drop can only
// ever name an index inside the source window. Dragging a tab out of its window
// therefore did not fail -- it SATURATED: `toIndex` came back as the source
// window's last index, the tab moved to the bottom of the window it came from,
// and the session was stamped and queued for a cloud write. Measured before the
// fix, dragging wA-t0 past every row of window B:
//
//   window A   wA-t1, wA-t2, wA-t0      <- moved, and not where anyone pointed
//   window B   wB-t0, wB-t1             <- untouched
//   isDirty    true
//
// Doing nothing is the honest answer until KAN-132 makes it a real move. The
// drop is bounded by the rows the area MEASURED AT DRAG START -- not by the
// container's rect read at drop time, which by then reflects the shifts the
// drag itself applied, and would be compared against a toIndex derived from
// pre-drag positions.

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

// Window A's three tabs tile [0,60); window B's two tile [200,240). The gap is
// where B's header sits.
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
  const node = (id: string) =>
    container.querySelector<HTMLElement>(`[data-drag-row-id="${id}"]`)!;
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
  document.body.style.cursor = '';
});

describe('a tab released outside its own window', () => {
  test('commits nothing rather than dropping to the bottom of its own window', async () => {
    const { container, store } = await render();
    const node = layout(container);

    // Deep inside window B's rows, well past window A's span.
    drag(node('wA-t0'), 10, 235);

    expect(tabsOf(store, 0)).toEqual(['wA-t0', 'wA-t1', 'wA-t2']);
    expect(tabsOf(store, 1)).toEqual(['wB-t0', 'wB-t1']);
  });

  test('and does not dirty the session', async () => {
    const { container, store } = await render();
    const node = layout(container);

    drag(node('wA-t0'), 10, 235);

    expect(store.getState().globalState.isDirty).toBe(false);
  });

  // THE CONTROL. Without it, an area that refused every drop would pass the two
  // tests above while breaking the feature outright.
  test('CONTROL: the same tab still reorders inside its own window', async () => {
    const { container, store } = await render();
    const node = layout(container);

    drag(node('wA-t0'), 10, 55);

    expect(tabsOf(store, 0)).toEqual(['wA-t1', 'wA-t2', 'wA-t0']);
  });

  // THE OTHER CONTROL, and the one that decides where the boundary sits.
  // "Drag to the end of the list" is a real gesture and people overshoot the
  // last row slightly while doing it. The slack is half the held row, so a drop
  // just past the last row's bottom is still a move, not a no-op.
  test('CONTROL: overshooting the last row slightly still lands at the end', async () => {
    const { container, store } = await render();
    const node = layout(container);

    // Window A's rows end at y=60; half a row of slack takes it to 70.
    drag(node('wA-t0'), 10, 68);

    expect(tabsOf(store, 0)).toEqual(['wA-t1', 'wA-t2', 'wA-t0']);
  });

  // The user dragged. They did not ask to open the tab, so the click Chrome
  // synthesizes afterwards must still be swallowed even though nothing moved --
  // and a refused drop is exactly the case that commits no reorder, which is
  // what makes the click reach the row in the first place.
  test('the click after a refused drop is still swallowed', async () => {
    const { container, chrome } = await render();
    const node = layout(container);
    const row = node('wA-t0');

    drag(row, 10, 235);
    fireEvent.click(row, { clientX: 10, clientY: 235 });

    expect(chrome.createdTabs).toHaveLength(0);
  });
});
