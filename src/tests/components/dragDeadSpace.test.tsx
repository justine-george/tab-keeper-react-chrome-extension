import { describe, expect, test, afterEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import {
  RowDragArea,
  DraggableRow,
} from '../../components/home/rightpane/rowDrag/RowDragArea';
import TabGroupDetailsContainer from '../../components/home/rightpane/TabGroupDetailsContainer';
import TabGroupEntryContainer from '../../components/home/leftpane/TabGroupEntryContainer';
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

// KAN-155. A release in the pane's empty space is a drop at the end it is past.
//
// Collapsing during a window drag (KAN-153) leaves the folded list occupying a
// fraction of its pane -- measured, 190px of rows in a 417px pane -- so a
// release at the bottom of the VIEW lands in dead space under the rows, and
// isInsideList refused it. To the user the drag simply did nothing.
//
// The pane is the box the list lives in -- the nearest `overflow: auto` --
// whether or not its content currently overflows. The first cut used the
// scrolling ancestor, which only exists while the list overflows, and measured
// in the popup that left a two-window session refusing exactly this release.
//
// jsdom applies no emotion stylesheet (every ancestor computes `overflow-y:
// visible`) and has no layout, so the integration tests below set the pane's
// overflow inline and give the rows and the pane real boxes. What is pinned is
// the DECISION -- does this release commit, and at which index.

const box = (top: number, height: number, left = 0, width = 200) =>
  ({
    top,
    bottom: top + height,
    left,
    right: left + width,
    height,
    width,
    x: left,
    y: top,
    toJSON: () => ({}),
  }) as DOMRect;

afterEach(() => {
  document.documentElement.removeAttribute('data-dragging');
  vi.restoreAllMocks();
});

const PANE_H = 200;
const ROW_H = 30;

// A pane 200px tall holding four 30px rows, so 80px of dead space sits under
// them. The pane does NOT overflow: this is the short session, the case the
// scrolling-ancestor version could not see.
const Harness = ({
  onMove,
  clamp,
  rowsTop = 0,
}: {
  onMove: (id: string, to: number) => void;
  clamp: boolean;
  rowsTop?: number;
}) => {
  const ids = ['a', 'b', 'c', 'd'];
  return (
    <div
      data-testid="pane"
      style={{ overflowY: 'auto' }}
      ref={(el) => {
        if (el) el.getBoundingClientRect = () => box(0, PANE_H);
      }}
    >
      <RowDragArea
        rowIds={ids}
        onMove={onMove}
        dragKind="window"
        clampDropToEnds={clamp}
      >
        {ids.map((id, i) => (
          <DraggableRow key={id} rowId={id} index={i}>
            <div
              ref={(el) => {
                // The DraggableRow node is what the engine measures.
                if (el?.parentElement)
                  el.parentElement.getBoundingClientRect = () =>
                    box(rowsTop + i * ROW_H, ROW_H);
              }}
            >
              Row {id}
            </div>
          </DraggableRow>
        ))}
      </RowDragArea>
    </div>
  );
};

const drag = (label: string, fromY: number, to: { x?: number; y: number }) => {
  const node = screen.getByText(label).parentElement!;
  fireEvent.pointerDown(node, { clientX: 10, clientY: fromY, button: 0 });
  fireEvent.pointerMove(document, { clientX: 10, clientY: fromY + 10 });
  fireEvent.pointerMove(document, { clientX: to.x ?? 10, clientY: to.y });
  fireEvent.pointerUp(document, { clientX: to.x ?? 10, clientY: to.y });
};

describe('a release in the dead space of its own pane', () => {
  test('below the rows, it lands last', () => {
    const onMove = vi.fn();
    render(<Harness onMove={onMove} clamp />);

    // Rows end at 120; 190 is deep in the dead space, still inside the pane.
    drag('Row a', 15, { y: 190 });

    expect(onMove).toHaveBeenCalledTimes(1);
    expect(onMove.mock.calls[0].slice(0, 2)).toEqual(['a', 3]);
  });

  test('above the rows, it lands first', () => {
    const onMove = vi.fn();
    // Rows pushed down to start at 80, leaving dead space above them.
    render(<Harness onMove={onMove} clamp rowsTop={80} />);

    drag('Row d', 80 + 3 * ROW_H + 15, { y: 5 });

    expect(onMove).toHaveBeenCalledTimes(1);
    expect(onMove.mock.calls[0].slice(0, 2)).toEqual(['d', 0]);
  });

  // THE CONTROL that the clamp is what commits it. Without it the tests above
  // could be passing on isInsideList's own slack -- and 190 is 70px past the
  // last row, far beyond the half-row it allows.
  test('CONTROL: without the opt-in, the same release is refused', () => {
    const onMove = vi.fn();
    render(<Harness onMove={onMove} clamp={false} />);

    drag('Row a', 15, { y: 190 });

    expect(onMove).not.toHaveBeenCalled();
  });

  // The pane is the bound, not the whole screen. A release below the pane or
  // beside it is somewhere else -- another list, the header, the save row --
  // and the drag must still come back as nothing.
  test('CONTROL: released below the pane, it is refused', () => {
    const onMove = vi.fn();
    render(<Harness onMove={onMove} clamp />);

    drag('Row a', 15, { y: PANE_H + 40 });

    expect(onMove).not.toHaveBeenCalled();
  });

  // Above the pane is the session header and the save row in the real popup,
  // and a release there must not land the row first.
  test('CONTROL: released above the pane, it is refused', () => {
    const onMove = vi.fn();
    // Pane spans 0..200, so y=-40 is above it -- and past isInsideList's
    // half-row of slack above the first row at 0.
    render(<Harness onMove={onMove} clamp />);

    drag('Row d', 3 * ROW_H + 15, { y: -40 });

    expect(onMove).not.toHaveBeenCalled();
  });

  test('CONTROL: released beside the pane, it is refused', () => {
    const onMove = vi.fn();
    render(<Harness onMove={onMove} clamp />);

    drag('Row a', 15, { x: 260, y: 190 });

    expect(onMove).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// The wiring. Each engine test above would pass with the opt-in removed from
// every real list, or turned on for the tab lists -- which is the half that
// matters, because that hands back KAN-132.

const win = (id: string, n: number) => ({
  windowId: id,
  windowHeight: 800,
  windowWidth: 1200,
  windowOffsetTop: 0,
  windowOffsetLeft: 0,
  tabCount: n,
  title: `Window ${id}`,
  tabs: Array.from({ length: n }, (_, i) => ({
    tabId: `${id}-t${i}`,
    favicon: '',
    title: `${id} tab ${i}`,
    url: `https://${id}-${i}.test`,
  })),
});

const renderDetails = () =>
  renderWithProviders(<TabGroupDetailsContainer />, {
    seedStore: (store) => {
      store.dispatch(setHasTabGroupsPermission(false));
      store.dispatch(
        saveToTabContainerInternal({
          tabGroupId: 'g1',
          title: 'Session',
          createdTime: '2026-09-07 09:00:00',
          windowCount: 2,
          tabCount: 5,
          isAutoSave: false,
          isSelected: true,
          windows: [win('wA', 3), win('wB', 2)],
        })
      );
      store.dispatch(selectTabContainer('g1'));
      store.dispatch(setIsNotDirty());
    },
  });

// The pane is the component's own root: the bordered `overflow: auto` box.
// Its overflow is set inline because jsdom will not compute the emotion class.
const mountPane = (container: HTMLElement, height = 400) => {
  const pane = container.firstElementChild as HTMLElement;
  pane.style.overflowY = 'auto';
  pane.getBoundingClientRect = () => box(0, height);
  return pane;
};

const nodeIn = (container: HTMLElement, id: string) =>
  container.querySelector<HTMLElement>(`[data-drag-row-id="${id}"]`)!;

const dragFrom = (from: Element, startY: number, endY: number) => {
  fireEvent.pointerDown(from, { clientX: 10, clientY: startY, button: 0 });
  fireEvent.pointerMove(document, { clientX: 10, clientY: startY + 10 });
  fireEvent.pointerMove(document, { clientX: 10, clientY: endY });
  fireEvent.pointerUp(document, { clientX: 10, clientY: endY });
};

const windowOrder = (store: RenderWithProvidersResult['store']) =>
  store
    .getState()
    .tabContainerDataState.tabGroups[0].windows.map((w) => w.windowId);

const tabsOf = (store: RenderWithProvidersResult['store'], i: number) =>
  store
    .getState()
    .tabContainerDataState.tabGroups[0].windows[i].tabs.map((t) => t.tabId);

describe('the window list takes a release in its dead space', () => {
  test('a window released under the folded rows moves to the end', async () => {
    const { container, store } = await renderDetails();
    mountPane(container);
    // Folded, each window is just its header: 0..40 and 40..80.
    nodeIn(container, 'wA').getBoundingClientRect = () => box(0, 40);
    nodeIn(container, 'wB').getBoundingClientRect = () => box(40, 40);
    const handle = nodeIn(container, 'wA').querySelector(
      '[data-window-drag-handle]'
    )!;

    dragFrom(handle, 20, 380);

    expect(windowOrder(store)).toEqual(['wB', 'wA']);
  });
});

// THE CONTROL THIS WHOLE CHANGE HANGS ON. A tab list sits in the SAME pane as
// the window list around it, so for a tab the pane test passes just as easily
// -- and a tab released there has left its window. Committing that is the
// KAN-132 saturation: the tab drops to the bottom of the window it came from,
// and the session is dirtied for a cloud write. See dragOutsideItsListIsNoOp.
//
// That test cannot catch the clamp being turned on for tabs, because in it no
// pane is ever found, so "released in the pane" is never true. This one gives
// the release a real pane to be inside.
describe('a tab list still refuses a release outside its own window', () => {
  test.each([
    ['over the next window', 235],
    ['in the dead space under everything', 380],
  ])('%s', async (_where, endY) => {
    const { container, store } = await renderDetails();
    mountPane(container);
    // Window A's tabs tile [0,60); window B's tile [200,240).
    ['wA-t0', 'wA-t1', 'wA-t2'].forEach((id, i) => {
      nodeIn(container, id).getBoundingClientRect = () => box(i * 20, 20);
    });
    ['wB-t0', 'wB-t1'].forEach((id, i) => {
      nodeIn(container, id).getBoundingClientRect = () => box(200 + i * 20, 20);
    });

    dragFrom(nodeIn(container, 'wA-t0'), 10, endY);

    expect(tabsOf(store, 0)).toEqual(['wA-t0', 'wA-t1', 'wA-t2']);
    expect(store.getState().globalState.isDirty).toBe(false);
  });

  // And the positive control, or a tab area that refused everything would
  // pass both of the above.
  test('CONTROL: the same tab still reorders inside its window', async () => {
    const { container, store } = await renderDetails();
    mountPane(container);
    ['wA-t0', 'wA-t1', 'wA-t2'].forEach((id, i) => {
      nodeIn(container, id).getBoundingClientRect = () => box(i * 20, 20);
    });

    dragFrom(nodeIn(container, 'wA-t0'), 10, 55);

    expect(tabsOf(store, 0)).toEqual(['wA-t1', 'wA-t2', 'wA-t0']);
  });
});

describe('the session list takes a release in its dead space', () => {
  const session = (id: string, createdAt: number) => ({
    tabGroupId: id,
    title: id.toUpperCase(),
    createdTime: '2026-09-09 12:00:00',
    createdAt,
    windowCount: 1,
    tabCount: 1,
    isAutoSave: false,
    isSelected: false,
    windows: [win(`${id}-w`, 1)],
  });

  test('a session released under the list moves to the end', async () => {
    const T0 = Date.UTC(2026, 8, 9, 12, 0, 0);
    const { container, store } = await renderWithProviders(
      <TabGroupEntryContainer />,
      {
        seedStore: (s) => {
          s.dispatch(setHasTabGroupsPermission(false));
          // Pinned per save -- see sessionDragReorder.test.tsx (KAN-141).
          vi.useFakeTimers();
          try {
            for (const [id, at] of [
              ['a', T0 - 2],
              ['b', T0 - 1],
              ['c', T0],
            ] as const) {
              vi.setSystemTime(at);
              s.dispatch(saveToTabContainerInternal(session(id, at)));
            }
          } finally {
            vi.useRealTimers();
          }
          s.dispatch(setIsNotDirty());
        },
      }
    );
    const order = () =>
      store.getState().tabContainerDataState.tabGroups.map((g) => g.tabGroupId);
    // The pane renders newest first, so this is also the rendered order.
    expect(order()).toEqual(['c', 'b', 'a']);

    mountPane(container);
    ['c', 'b', 'a'].forEach((id, i) => {
      nodeIn(container, id).getBoundingClientRect = () => box(i * 40, 40);
    });

    dragFrom(nodeIn(container, 'c'), 20, 380);

    expect(order()).toEqual(['b', 'a', 'c']);
  });
});
