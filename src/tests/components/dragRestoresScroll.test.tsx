import { describe, expect, test, afterEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import {
  RowDragArea,
  DraggableRow,
} from '../../components/home/rightpane/rowDrag/RowDragArea';
import TabGroupDetailsContainer from '../../components/home/rightpane/TabGroupDetailsContainer';
import { renderWithProviders } from '../setup/renderWithProviders';
import {
  saveToTabContainerInternal,
  selectTabContainer,
} from '../../redux/slices/tabContainerDataStateSlice';
import {
  setHasTabGroupsPermission,
  setIsNotDirty,
} from '../../redux/slices/globalStateSlice';

// KAN-157. A window drag that commits nothing puts the view back.
//
// Folding the windows shut makes a short session fit its pane, and the browser
// clamps scrollTop to fit (KAN-154). A committed drop then scrolls the dropped
// row into view (KAN-155) -- but a drag that commits nothing had nothing to put
// it back. Measured in the popup, five windows scrolled to 300: Escape, or a
// release outside the pane, left scrollTop at 0 and the held window at y=589,
// below a pane ending at 541. A drag that changed nothing changed what you were
// looking at.
//
// Opt-in, and on only for the window list: the collapse is the only thing that
// destroys the position, and a tab drag folds nothing. Restoring there would
// only undo auto-scroll the user did on purpose.
//
// jsdom neither folds nor clamps, so the scroller below does both: it clamps
// DESTRUCTIVELY on read while the window-drag flag is set, which is what the
// popup measured for a short session (300 -> 0, and still 0 after unfolding).

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

afterEach(() => {
  document.documentElement.removeAttribute('data-dragging');
  vi.restoreAllMocks();
});

const VIEW = 90;
const OPEN_H = 30;
const SHUT_H = 15;
const IDS = ['a', 'b', 'c', 'd'];

// Returns the writes made to scrollTop, so a test can tell "restored" from
// "happened to be left there".
const mountFoldingScroller = (el: HTMLElement) => {
  const folded = () =>
    document.documentElement.getAttribute('data-dragging') === 'window';
  const rowH = () => (folded() ? SHUT_H : OPEN_H);
  const max = () => Math.max(0, rowH() * IDS.length - VIEW);
  let top = 0;
  const writes: number[] = [];
  Object.defineProperty(el, 'clientHeight', {
    value: VIEW,
    configurable: true,
  });
  Object.defineProperty(el, 'scrollHeight', {
    get: () => rowH() * IDS.length,
    configurable: true,
  });
  Object.defineProperty(el, 'scrollTop', {
    get: () => (top = Math.min(top, max())),
    set: (v: number) => {
      writes.push(v);
      top = Math.max(0, Math.min(v, max()));
    },
    configurable: true,
  });
  el.getBoundingClientRect = () => box(0, VIEW);
  return { rowH, writes };
};

const Harness = ({
  restore,
  onMove = () => {},
}: {
  restore: boolean;
  onMove?: () => void;
}) => (
  <div data-testid="pane" style={{ overflowY: 'auto' }}>
    <RowDragArea
      rowIds={IDS}
      onMove={onMove}
      dragKind="window"
      restoreScrollIfNoDrop={restore}
    >
      {IDS.map((id) => (
        <DraggableRow key={id} rowId={id}>
          <div>Row {id}</div>
        </DraggableRow>
      ))}
    </RowDragArea>
  </div>
);

// Mounted, scrolled to the bottom of the EXPANDED list (30), with row b's
// header picked up -- visible there at viewport 0..30.
const setUp = (restore: boolean, onMove?: () => void) => {
  render(<Harness restore={restore} onMove={onMove} />);
  const scroller = screen.getByTestId('pane');
  const { rowH, writes } = mountFoldingScroller(scroller);
  IDS.forEach((id, i) => {
    screen.getByText(`Row ${id}`).parentElement!.getBoundingClientRect = () =>
      box(i * rowH() - scroller.scrollTop, rowH());
  });
  scroller.scrollTop = 999;
  expect(scroller.scrollTop).toBe(OPEN_H * IDS.length - VIEW);

  fireEvent.pointerDown(screen.getByText('Row b').parentElement!, {
    clientX: 10,
    clientY: 15,
    button: 0,
  });
  fireEvent.pointerMove(document, { clientX: 10, clientY: 30 });
  // The premise: folding clamped the scroll away. Without this, a restore that
  // never ran would pass every test below.
  expect(scroller.scrollTop).toBe(0);
  writes.length = 0;
  return { scroller, writes };
};

describe('a window drag that commits nothing puts the view back', () => {
  test('after Escape, the scroll is where it was when the row was picked up', () => {
    const { scroller } = setUp(true);

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(scroller.scrollTop).toBe(30);
  });

  test('after a release outside the pane, likewise', () => {
    const { scroller } = setUp(true);

    // Below the pane: refused.
    fireEvent.pointerMove(document, { clientX: 10, clientY: VIEW + 40 });
    fireEvent.pointerUp(document, { clientX: 10, clientY: VIEW + 40 });

    expect(scroller.scrollTop).toBe(30);
  });

  // CONTROL. A committed drop has a new place to show, and KAN-155 shows it by
  // scrolling the dropped row into view on the next frame. Restoring the old
  // position as well would fight that. Asserted on WRITES, because in this
  // fake a restore and "left at 0" are otherwise told apart only by value.
  test('CONTROL: a committed drop does not restore', () => {
    const onMove = vi.fn();
    const { writes } = setUp(true, onMove);

    fireEvent.pointerMove(document, { clientX: 10, clientY: 50 });
    fireEvent.pointerUp(document, { clientX: 10, clientY: 50 });

    expect(onMove).toHaveBeenCalledTimes(1);
    expect(writes).toEqual([]);
  });

  // CONTROL. Off by default: every other list keeps the scroll it has.
  test('CONTROL: without the opt-in, Escape leaves the scroll alone', () => {
    const { writes } = setUp(false);

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(writes).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The wiring: on for the window list, off for the tab lists inside it.

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

const renderDetails = async () => {
  const result = await renderWithProviders(<TabGroupDetailsContainer />, {
    seedStore: (store) => {
      store.dispatch(setHasTabGroupsPermission(false));
      store.dispatch(
        saveToTabContainerInternal({
          tabGroupId: 'g1',
          title: 'Session',
          createdTime: '2026-09-07 09:00:00',
          windowCount: 2,
          tabCount: 4,
          isAutoSave: false,
          isSelected: true,
          windows: [win('wA', 2), win('wB', 2)],
        })
      );
      store.dispatch(selectTabContainer('g1'));
      store.dispatch(setIsNotDirty());
    },
  });
  // The component's root is the bordered `overflow: auto` pane. jsdom will not
  // compute the emotion class, so its overflow and metrics are set here.
  const pane = result.container.firstElementChild as HTMLElement;
  pane.style.overflowY = 'auto';
  const { writes } = mountFoldingScroller(pane);
  const node = (id: string) =>
    result.container.querySelector<HTMLElement>(`[data-drag-row-id="${id}"]`)!;
  return { ...result, pane, writes, node };
};

describe('the real lists', () => {
  test('the window list restores the scroll after Escape', async () => {
    const { pane, node } = await renderDetails();
    node('wA').getBoundingClientRect = () => box(0, 30);
    node('wB').getBoundingClientRect = () => box(30, 30);
    pane.scrollTop = 30;
    const handle = node('wA').querySelector('[data-window-drag-handle]')!;

    fireEvent.pointerDown(handle, { clientX: 10, clientY: 15, button: 0 });
    fireEvent.pointerMove(document, { clientX: 10, clientY: 30 });
    expect(pane.scrollTop).toBe(0);
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(pane.scrollTop).toBe(30);
  });

  // A tab drag folds nothing, so there is no lost position to put back -- only
  // auto-scroll the user did while holding the tab, which is theirs to keep.
  // Simulated by moving the scroll mid-drag.
  test('CONTROL: a tab list leaves the scroll alone after Escape', async () => {
    const { pane, node, writes } = await renderDetails();
    ['wA-t0', 'wA-t1'].forEach((id, i) => {
      node(id).getBoundingClientRect = () => box(i * 20, 20);
    });
    pane.scrollTop = 30;

    fireEvent.pointerDown(node('wA-t0'), {
      clientX: 10,
      clientY: 10,
      button: 0,
    });
    fireEvent.pointerMove(document, { clientX: 10, clientY: 25 });
    pane.scrollTop = 10;
    writes.length = 0;
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(writes).toEqual([]);
    expect(pane.scrollTop).toBe(10);
  });
});
