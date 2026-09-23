import { describe, expect, test, afterEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import {
  RowDragArea,
  DraggableRow,
} from '../../components/home/rightpane/rowDrag/RowDragArea';
import {
  endDragHold,
  isDragHeld,
  whenDragReleases,
} from '../../redux/dragHold';

// KAN-279 D12. A started drag holds changes this page did not make, and every
// way a started drag can end releases them: a completed drop, Esc, and the
// area unmounting mid-drag. A hold left on would queue every later sync merge
// for good.
//
// The bare RowDragArea's onMove is a plain mock, so nothing here calls
// dropOnTop: the queue is flushed by endDragHold alone. In the app the
// consumer's dropOnTop flushes it first, and endDragHold then finds it empty.

const ROW_H = 30;
const box = (top: number, height: number): DOMRect =>
  DOMRect.fromRect({ x: 0, y: top, width: 200, height });

afterEach(() => {
  endDragHold();
  document.documentElement.removeAttribute('data-dragging');
  vi.restoreAllMocks();
});

const Area = ({
  ids,
  onMove,
}: {
  ids: string[];
  onMove: (id: string, to: number) => void;
}) => (
  <RowDragArea rowIds={ids} onMove={onMove} dragKind="window">
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

const press = (label: string) => {
  const row = screen.getByText(label).parentElement;
  if (!row) throw new Error(`no row element for ${label}`);
  fireEvent.pointerDown(row, { clientX: 10, clientY: 15, button: 0 });
};

// Past ACTIVATION_DISTANCE_PX, so the drag has started.
const startDrag = (label: string) => {
  press(label);
  fireEvent.pointerMove(document, { clientX: 10, clientY: 30 });
};

describe('a started drag holds, and every way it ends releases (KAN-279 D12)', () => {
  test('a started drag holds', () => {
    render(<Area ids={['a', 'b', 'c']} onMove={() => {}} />);
    startDrag('Row a');
    expect(isDragHeld()).toBe(true);
  });

  test('Esc releases, and the held change runs once', () => {
    render(<Area ids={['a', 'b', 'c']} onMove={() => {}} />);
    startDrag('Row a');
    // The premise: held, so the change below waits rather than running now.
    expect(isDragHeld()).toBe(true);
    const spy = vi.fn();
    whenDragReleases(spy);
    expect(spy).not.toHaveBeenCalled();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(isDragHeld()).toBe(false);
  });

  test('a completed drop releases, after onMove, and the held change runs once', () => {
    const order: string[] = [];
    const onMove = vi.fn(() => order.push('onMove'));
    render(<Area ids={['a', 'b', 'c']} onMove={onMove} />);
    startDrag('Row a');
    // The premise: held, so the change below waits rather than running now.
    expect(isDragHeld()).toBe(true);
    const spy = vi.fn(() => order.push('held'));
    whenDragReleases(spy);

    // 70 is past b (45) but not c (75): index 1.
    fireEvent.pointerMove(document, { clientX: 10, clientY: 70 });
    fireEvent.pointerUp(document, { clientX: 10, clientY: 70 });

    expect(onMove).toHaveBeenCalledWith('a', 1, undefined);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(isDragHeld()).toBe(false);
    // onMove first: in the app it is onMove's dropOnTop that applies the held
    // change, so the drop can be re-aimed on top of it.
    expect(order).toEqual(['onMove', 'held']);
  });

  test('the area unmounting mid-drag releases, and the held change runs once', () => {
    const { unmount } = render(
      <Area ids={['a', 'b', 'c']} onMove={() => {}} />
    );
    startDrag('Row a');
    // The premise: held, so the change below waits rather than running now.
    expect(isDragHeld()).toBe(true);
    const spy = vi.fn();
    whenDragReleases(spy);

    unmount();

    expect(spy).toHaveBeenCalledTimes(1);
    expect(isDragHeld()).toBe(false);
  });

  // A consumer that throws must not leave the hold on: every later merge
  // would queue behind a drop that has already ended, for the life of the
  // page.
  test('an onMove that throws still releases, and the held change runs once', () => {
    const onMove = vi.fn(() => {
      throw new Error('consumer failed');
    });
    // jsdom reports a listener's exception as a window `error` event rather
    // than rethrowing it into the test. Caught here so it is asserted on --
    // proving onMove really threw -- instead of printed.
    const reported: unknown[] = [];
    const onError = (e: ErrorEvent) => {
      reported.push(e.error);
      e.preventDefault();
    };
    window.addEventListener('error', onError);
    render(<Area ids={['a', 'b', 'c']} onMove={onMove} />);
    startDrag('Row a');
    expect(isDragHeld()).toBe(true);
    const spy = vi.fn();
    whenDragReleases(spy);

    try {
      fireEvent.pointerMove(document, { clientX: 10, clientY: 70 });
      fireEvent.pointerUp(document, { clientX: 10, clientY: 70 });
    } finally {
      window.removeEventListener('error', onError);
    }

    expect(onMove).toHaveBeenCalledTimes(1);
    expect(reported).toHaveLength(1);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(isDragHeld()).toBe(false);
  });

  // A second button-0 press while a drag is already started (a second finger
  // or pen on touch) must not strand the hold. `begin` used to overwrite
  // `live.current` unconditionally, so finish() then saw an UNSTARTED record
  // and returned before reaching endDragHold() -- and every later change
  // queued behind a drop that could never happen.
  test('a second press mid-drag does not leak the hold', () => {
    render(<Area ids={['a', 'b', 'c']} onMove={() => {}} />);
    startDrag('Row a');
    expect(isDragHeld()).toBe(true);
    const spy = vi.fn();
    whenDragReleases(spy);

    // A second finger/pen presses row b while row a's drag is still live.
    press('Row b');
    fireEvent.pointerUp(document, { clientX: 10, clientY: 15 });

    expect(isDragHeld()).toBe(false);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(document.documentElement.hasAttribute('data-dragging')).toBe(false);
  });

  // CONTROL: a press that never passes the threshold is a click, not a drag.
  // It never holds, so a change arriving then applies at once.
  test('CONTROL: a click never holds', () => {
    render(<Area ids={['a', 'b', 'c']} onMove={() => {}} />);
    press('Row a');
    expect(isDragHeld()).toBe(false);
    const spy = vi.fn();
    whenDragReleases(spy);
    expect(spy).toHaveBeenCalledTimes(1);
    fireEvent.pointerUp(document, { clientX: 10, clientY: 15 });
    expect(isDragHeld()).toBe(false);
  });
});
