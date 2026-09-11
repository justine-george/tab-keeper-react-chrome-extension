import { describe, expect, test, afterEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import {
  RowDragArea,
  DraggableRow,
} from '../../components/home/rightpane/rowDrag/RowDragArea';

// KAN-162. A press in a text field is the start of a selection, not a drag.
// Measured on main: selecting text in the window rename field folded every
// window, collapsed the selection and moved the window. jsdom has no
// isContentEditable (it reads undefined), so the guard is an attribute
// selector, and the real-browser half is checked in E2E.

const box = (top: number) =>
  ({
    top,
    bottom: top + 30,
    left: 0,
    right: 200,
    height: 30,
    width: 200,
    x: 0,
    y: top,
    toJSON: () => ({}),
  }) as DOMRect;

const Harness = ({ onMove }: { onMove: (id: string, i: number) => void }) => (
  <RowDragArea rowIds={['a', 'b', 'c', 'd', 'e']} onMove={onMove}>
    <DraggableRow rowId="a" index={0}>
      <div>
        <input aria-label="field" defaultValue="text" />
        <span>Beside a</span>
      </div>
    </DraggableRow>
    <DraggableRow rowId="b" index={1}>
      <div>
        <textarea aria-label="area" defaultValue="text" />
      </div>
    </DraggableRow>
    <DraggableRow rowId="c" index={2}>
      <div>
        <div contentEditable suppressContentEditableWarning>
          Editable c
        </div>
      </div>
    </DraggableRow>
    <DraggableRow rowId="d" index={3}>
      <div>
        <span contentEditable={false}>Not editable d</span>
      </div>
    </DraggableRow>
    <DraggableRow rowId="e" index={4}>
      <div>
        <span>Plain e</span>
      </div>
    </DraggableRow>
  </RowDragArea>
);

const setup = () => {
  const onMove = vi.fn();
  const { container } = render(<Harness onMove={onMove} />);
  container
    .querySelectorAll<HTMLElement>('[data-drag-row-id]')
    .forEach((row, i) => (row.getBoundingClientRect = () => box(i * 30)));
  return onMove;
};

const dragFrom = (target: Element, y: number) => {
  fireEvent.pointerDown(target, { clientX: 10, clientY: y, button: 0 });
  fireEvent.pointerMove(document, { clientX: 60, clientY: y });
  fireEvent.pointerMove(document, { clientX: 60, clientY: 140 });
};
const dragging = () => document.documentElement.hasAttribute('data-dragging');

afterEach(() => {
  fireEvent.pointerUp(document, { clientX: 60, clientY: 140 });
  document.documentElement.removeAttribute('data-dragging');
});

describe('a press inside an editable field starts no drag', () => {
  test.each([
    ['an input', () => screen.getByLabelText('field'), 15],
    ['a textarea', () => screen.getByLabelText('area'), 45],
    ['a contentEditable element', () => screen.getByText('Editable c'), 75],
  ])('%s', (_label, target, y) => {
    const onMove = setup();
    dragFrom(target(), y);
    expect(dragging()).toBe(false);
    fireEvent.pointerUp(document, { clientX: 60, clientY: 140 });
    expect(onMove).not.toHaveBeenCalled();
  });

  // CONTROL: the same row, pressed beside the field, still drags.
  test('CONTROL: beside the field, the row drags', () => {
    setup();
    dragFrom(screen.getByText('Beside a'), 15);
    expect(dragging()).toBe(true);
  });

  // contenteditable="false" opts a region back out, so it is a handle like
  // any other.
  test('contenteditable="false" does not count as editable', () => {
    setup();
    dragFrom(screen.getByText('Not editable d'), 105);
    expect(dragging()).toBe(true);
  });
});
