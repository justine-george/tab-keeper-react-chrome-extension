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

// KAN-159. A drag must survive the list re-rendering underneath it.
//
// The area's listener effect cleared the document's drag flag in its cleanup.
// That was written for UNMOUNT -- "a drag interrupted by unmount must not leave
// the document stuck in grabbing" -- but React runs an effect's cleanup every
// time its inputs change, too. So anything that handed the area a new rowIds
// or onMove mid-drag cleared the flag while the row was still held.
//
// Measured in the popup: the app rewrote the session data ~450ms into a window
// drag (the startup sync landing), all seven drag areas re-ran their effects in
// the same commit, and data-dragging vanished with the row still in hand. The
// windows unfolded under the pointer, the grabbing cursor went, the row actions
// came back, and the drag carried on against rects measured in the folded
// layout. Started after the app settled, the same drag kept its flag
// throughout -- which is why it looked intermittent.
//
// The same cleanup also cleared the flag when a DIFFERENT area re-rendered or
// unmounted, so a tab list unmounting could end a window drag's fold.

const ROW_H = 30;
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
      <DraggableRow key={id} rowId={id} index={i}>
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
  const row = screen.getByText(label).parentElement!;
  fireEvent.pointerDown(row, { clientX: 10, clientY: 15, button: 0 });
  fireEvent.pointerMove(document, { clientX: 10, clientY: 30 });
};

describe('a re-render mid-drag keeps the drag alive', () => {
  // Same ids, NEW ARRAY: exactly what a store update that rebuilds the
  // container does to every memoised id list.
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
  // The tab list of one window unmounting -- deleting it, or the window
  // collapsing by hand -- while a session drag is live elsewhere.
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
  });
});

// CONTROL, and the half the old cleanup existed for: the area that OWNS the
// drag going away mid-drag must not leave the document stuck in a drag. Also
// pinned in dragSetsDocumentFlag.test.tsx; restated here beside the tests that
// narrow when the flag may be cleared, because narrowing it too far is the
// obvious way to break this.
test('CONTROL: the dragging area unmounting clears the flag', () => {
  const { unmount } = render(<Area ids={['a', 'b']} onMove={() => {}} />);
  startDrag('Row a');
  expect(flag()).toBe('window');

  unmount();

  expect(flag()).toBeNull();
});

// The real trigger, through the real component: a store update that rebuilds
// the session data with UNCHANGED content, as a sync that finds nothing new
// does. restoreContainer rebuilds the container and every id list below it.
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
    const node = (id: string) =>
      container.querySelector<HTMLElement>(`[data-drag-row-id="${id}"]`)!;
    node('wA').getBoundingClientRect = () => box(0, 30);
    node('wB').getBoundingClientRect = () => box(30, 30);
    const handle = node('wA').querySelector('[data-window-drag-handle]')!;

    fireEvent.pointerDown(handle, { clientX: 10, clientY: 15, button: 0 });
    fireEvent.pointerMove(document, { clientX: 10, clientY: 30 });
    expect(flag()).toBe('window');

    // A DEEP COPY, because that is what a sync delivers: the cloud document
    // parsed from JSON -- the same content, every object new. Passing the
    // current state back instead keeps the session's identity, the memoised id
    // list never changes, and this test passed against the broken code. The
    // memo in TabGroupDetailsContainer was the earlier mitigation for this
    // exact bug; it only holds while the session object survives.
    const before = store.getState().tabContainerDataState;
    act(() => {
      store.dispatch(restoreContainer(JSON.parse(JSON.stringify(before))));
    });
    // The premise: the selected session really is a new object now. Without
    // it, "still flagged" could just mean nothing re-rendered.
    const selected = (s: typeof before) =>
      s.tabGroups.find((g) => g.tabGroupId === 'g1');
    expect(selected(store.getState().tabContainerDataState)).not.toBe(
      selected(before)
    );

    expect(flag()).toBe('window');
  });
});
