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

// KAN-279 D12. A started drag holds changes this page did not make, and every end releases them: drop, Esc, unmount.
// A hold left on queues every later merge for good. onMove is a plain mock, so endDragHold alone flushes the queue here.

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
    // onMove first: in the app its dropOnTop applies the held change, so the drop is re-aimed on top of it.
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

  // A throwing consumer must not leave the hold on: later merges would queue behind an ended drop for the page's life.
  test('an onMove that throws still releases, and the held change runs once', () => {
    const onMove = vi.fn(() => {
      throw new Error('consumer failed');
    });
    // jsdom reports a listener's throw as a window `error` event; caught so the throw is asserted, not printed.
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

  // A second press mid-drag (another finger or pen) must not strand the hold: overwriting `live` made finish() see an
  // UNSTARTED record and skip endDragHold().
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

  // CONTROL: a press under the threshold is a click; it never holds, so a change then applies at once.
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
