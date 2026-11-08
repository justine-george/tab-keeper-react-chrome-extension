import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import {
  DraggableRow,
  RowDragArea,
} from '../../components/home/rightpane/rowDrag/RowDragArea';
import { endDragHold } from '../../redux/dragHold';
import { setupChromeFake } from '../setup/chrome.fake';

// KAN-949. A list hears which of its rows a drag holds, from the activation on, and once that the drag ended.
const ROW_H = 30;
const box = (top: number): DOMRect => ({
  top,
  bottom: top + ROW_H,
  left: 0,
  right: 200,
  height: ROW_H,
  width: 200,
  x: 0,
  y: top,
  toJSON: () => ({}),
});

let chromeHandle: ReturnType<typeof setupChromeFake> | undefined;
beforeEach(() => {
  chromeHandle = setupChromeFake();
});
afterEach(() => {
  chromeHandle?.restore();
  chromeHandle = undefined;
  endDragHold();
  document.documentElement.removeAttribute('data-dragging');
});

const rowFor = (id: string): HTMLElement => {
  const el = document.querySelector<HTMLElement>(`[data-drag-row-id="${id}"]`);
  if (!el) throw new Error(`no row ${id}`);
  return el;
};

function setUp(onHeldChange: (rowId: string | undefined) => void) {
  const onMove = vi.fn();
  const { unmount } = render(
    <RowDragArea
      rowIds={['a', 'b', 'c']}
      onMove={onMove}
      onHeldChange={onHeldChange}
    >
      {['a', 'b', 'c'].map((id) => (
        <DraggableRow key={id} rowId={id}>
          <div>Row {id}</div>
        </DraggableRow>
      ))}
    </RowDragArea>
  );
  ['a', 'b', 'c'].forEach((id, i) => {
    rowFor(id).getBoundingClientRect = () => box(i * ROW_H);
  });
  return { onMove, unmount };
}

const press = (y: number) =>
  fireEvent.pointerDown(screen.getByText('Row b'), {
    clientX: 10,
    clientY: y,
    button: 0,
  });
const moveTo = (y: number) =>
  fireEvent.pointerMove(document, { clientX: 10, clientY: y, button: 0 });
const release = (y: number) =>
  fireEvent.pointerUp(document, { clientX: 10, clientY: y, button: 0 });

describe('onHeldChange (KAN-949)', () => {
  test('told the row once the drag activates, and before the row is marked held', () => {
    const marks: (string | null)[] = [];
    let held: HTMLElement | null = null;
    const heard = vi.fn((rowId: string | undefined) => {
      marks.push(
        held === null ? 'no row' : held.getAttribute('data-drag-held')
      );
      void rowId;
    });
    setUp(heard);
    held = rowFor('b');

    press(45);
    moveTo(47);
    expect(heard).not.toHaveBeenCalled();
    moveTo(85);

    expect(heard.mock.calls).toEqual([['b']]);
    expect(marks).toEqual([null]);
  });

  test('told undefined once when the drag is released', () => {
    const heard = vi.fn();
    const { onMove } = setUp(heard);

    press(45);
    moveTo(85);
    release(85);

    expect(onMove).toHaveBeenCalled();
    expect(heard.mock.calls).toEqual([['b'], [undefined]]);
  });

  test('told undefined once when Esc ends the drag', () => {
    const heard = vi.fn();
    setUp(heard);

    press(45);
    moveTo(85);
    window.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true,
      })
    );
    release(85);

    expect(heard.mock.calls).toEqual([['b'], [undefined]]);
  });

  test('told undefined when the list unmounts mid-drag', () => {
    const heard = vi.fn();
    const { unmount } = setUp(heard);

    press(45);
    moveTo(85);
    unmount();

    expect(heard.mock.calls).toEqual([['b'], [undefined]]);
  });

  test('never told for a press that never becomes a drag', () => {
    const heard = vi.fn();
    setUp(heard);

    press(45);
    moveTo(47);
    release(47);

    expect(heard).not.toHaveBeenCalled();
  });
});
