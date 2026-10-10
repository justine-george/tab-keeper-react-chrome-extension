import { describe, expect, test, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

import {
  RowDragArea,
  DraggableRow,
} from '../../components/home/rightpane/rowDrag/RowDragArea';
import TabGroupDetailsContainer from '../../components/home/rightpane/TabGroupDetailsContainer';
import { renderWithProviders } from '../setup/renderWithProviders';
import {
  restoreContainer,
  saveToTabContainerInternal,
  selectTabContainer,
} from '../../redux/slices/tabContainerDataStateSlice';
import {
  setHasTabGroupsPermission,
  setIsNotDirty,
} from '../../redux/slices/globalStateSlice';
import { isDragHeld } from '../../redux/dragHold';

// KAN-159. A drag must survive the list re-rendering under it. The listener effect's cleanup cleared the drag flag, and React
// runs cleanup on every input change, not only unmount. Measured in the popup: the startup sync rewrote the sessions ~450ms into a
// window drag, every area re-ran its effects, and data-dragging vanished with the row in hand -- the windows unfolded and the drag
// went on against folded rects. A different area re-rendering or unmounting cleared it too.

const ROW_H = 30;
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

afterEach(() => {
  document.documentElement.removeAttribute('data-dragging');
  vi.restoreAllMocks();
});

const flag = () => document.documentElement.getAttribute('data-dragging');

const Area = ({
  ids,
  onMove,
  kind = 'window',
}: {
  ids: string[];
  onMove: (id: string, to: number) => void;
  kind?: 'window' | 'tab';
}) => (
  <RowDragArea rowIds={ids} onMove={onMove} dragKind={kind}>
    {ids.map((id, i) => (
      <DraggableRow key={id} rowId={id}>
        <div
          ref={(el) => {
            if (el?.parentElement)
              el.parentElement.getBoundingClientRect = () =>
                box(i * ROW_H, ROW_H);
          }}
        >
          Row {id}
        </div>
      </DraggableRow>
    ))}
  </RowDragArea>
);

const startDrag = (label: string) => {
  const row = screen.getByText(label).parentElement;
  if (!row) throw new Error(`no row around ${label}`);
  fireEvent.pointerDown(row, { clientX: 10, clientY: 15, button: 0 });
  fireEvent.pointerMove(document, { clientX: 10, clientY: 30 });
};

describe('a re-render mid-drag keeps the drag alive', () => {
  // Same ids, NEW ARRAY: what a store update that rebuilds the container does to every memoised id list.
  test('a new rowIds array: still flagged, and the drop still lands', () => {
    const onMove = vi.fn();
    const { rerender } = render(<Area ids={['a', 'b', 'c']} onMove={onMove} />);
    startDrag('Row a');
    expect(flag()).toBe('window');

    rerender(<Area ids={['a', 'b', 'c']} onMove={onMove} />);
    expect(flag()).toBe('window');

    // 70 is past b (45) but not c (75): index 1.
    fireEvent.pointerMove(document, { clientX: 10, clientY: 70 });
    fireEvent.pointerUp(document, { clientX: 10, clientY: 70 });
    expect(onMove).toHaveBeenCalledWith('a', 1, undefined);
    expect(flag()).toBeNull();
  });

  test('a new onMove: still flagged', () => {
    const { rerender } = render(<Area ids={['a', 'b']} onMove={() => {}} />);
    startDrag('Row a');

    rerender(<Area ids={['a', 'b']} onMove={() => {}} />);

    expect(flag()).toBe('window');
  });
});

describe('another area cannot end this drag', () => {
  // One window's tab list unmounting (deleted, or collapsed by hand) while a session drag is live elsewhere.
  test('an area that is not dragging unmounts: the flag stays', () => {
    const Page = ({ showOther }: { showOther: boolean }) => (
      <>
        <Area ids={['a', 'b']} onMove={() => {}} />
        {showOther && <Area ids={['x', 'y']} onMove={() => {}} kind="tab" />}
      </>
    );
    const { rerender } = render(<Page showOther />);
    startDrag('Row a');
    expect(flag()).toBe('window');

    rerender(<Page showOther={false} />);

    expect(flag()).toBe('window');
    // KAN-279 D12. Nor can it end this drag's hold on outside changes.
    expect(isDragHeld()).toBe(true);
  });
});

// The real trigger: a store update rebuilding the sessions with UNCHANGED content, as a sync that finds nothing new does.
describe('a store update landing mid-drag', () => {
  const win = (id: string) => ({
    windowId: id,
    windowHeight: 800,
    windowWidth: 1200,
    windowOffsetTop: 0,
    windowOffsetLeft: 0,
    tabCount: 1,
    title: `Window ${id}`,
    tabs: [
      { tabId: `${id}-t0`, favicon: '', title: 't', url: `https://${id}.test` },
    ],
  });

  test('does not unfold the windows under the held row', async () => {
    const { container, store } = await renderWithProviders(
      <TabGroupDetailsContainer />,
      {
        seedStore: (s) => {
          s.dispatch(setHasTabGroupsPermission(false));
          s.dispatch(
            saveToTabContainerInternal({
              tabGroupId: 'g1',
              title: 'Session',
              createdTime: '2026-09-07 09:00:00',
              windowCount: 2,
              tabCount: 2,
              isAutoSave: false,
              isSelected: true,
              windows: [win('wA'), win('wB')],
            })
          );
          s.dispatch(selectTabContainer('g1'));
          s.dispatch(setIsNotDirty());
        },
      }
    );
    const node = (id: string): HTMLElement => {
      const el = container.querySelector<HTMLElement>(
        `[data-drag-row-id="${id}"]`
      );
      if (!el) throw new Error(`no row ${id}`);
      return el;
    };
    node('wA').getBoundingClientRect = () => box(0, 30);
    node('wB').getBoundingClientRect = () => box(30, 30);
    const handle = node('wA').querySelector('[data-window-drag-handle]');
    if (!handle) throw new Error('no drag handle on wA');

    fireEvent.pointerDown(handle, { clientX: 10, clientY: 15, button: 0 });
    fireEvent.pointerMove(document, { clientX: 10, clientY: 30 });
    expect(flag()).toBe('window');

    // A DEEP COPY, as a sync delivers: passing current state back keeps the session's identity, the id list never changes,
    // and this test passed against the broken code.
    const before = store.getState().tabContainerDataState;
    act(() => {
      store.dispatch(restoreContainer(JSON.parse(JSON.stringify(before))));
    });
    // PREMISE: the selected session is a new object, or "still flagged" could mean nothing re-rendered.
    const selected = (s: typeof before) =>
      s.tabGroups.find((g) => g.tabGroupId === 'g1');
    expect(selected(store.getState().tabContainerDataState)).not.toBe(
      selected(before)
    );

    expect(flag()).toBe('window');
  });
});
