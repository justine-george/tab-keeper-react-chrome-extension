import { describe, expect, test, afterEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import {
  RowDragArea,
  DraggableRow,
} from '../../components/home/rightpane/rowDrag/RowDragArea';

// KAN-160. The group list nests INSIDE the tab list, and a tab row must keep
// joining the tab list through it. Rows used to join the nearest list, so
// `scope` lets a row name the list it belongs to.

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

type OnMove = (id: string, toIndex: number, target?: string) => void;

const Nested = ({ outer, inner }: { outer: OnMove; inner: OnMove }) => (
  <RowDragArea scope="outer" rowIds={['o1', 'o2']} onMove={outer}>
    <RowDragArea rowIds={['i1', 'i2']} onMove={inner}>
      <DraggableRow scope="outer" rowId="o1" index={0}>
        <div>Outer 1</div>
      </DraggableRow>
      <DraggableRow scope="outer" rowId="o2" index={1}>
        <div>Outer 2</div>
      </DraggableRow>
      <DraggableRow rowId="i1" index={0}>
        <div>Inner 1</div>
      </DraggableRow>
      <DraggableRow rowId="i2" index={1}>
        <div>Inner 2</div>
      </DraggableRow>
      <DraggableRow scope="nowhere" rowId="x" index={0}>
        <div>Stray</div>
      </DraggableRow>
    </RowDragArea>
  </RowDragArea>
);

const TOPS: Record<string, number> = {
  'Outer 1': 0,
  'Outer 2': 30,
  'Inner 1': 60,
  'Inner 2': 90,
  Stray: 120,
};

const node = (label: string) => screen.getByText(label).parentElement!;

const setup = () => {
  const outer = vi.fn<OnMove>();
  const inner = vi.fn<OnMove>();
  render(<Nested outer={outer} inner={inner} />);
  for (const [label, top] of Object.entries(TOPS)) {
    node(label).getBoundingClientRect = () => box(top, 30);
  }
  return { outer, inner };
};

const drag = (label: string, from: number, to: number) => {
  fireEvent.pointerDown(node(label), { clientX: 10, clientY: from, button: 0 });
  fireEvent.pointerMove(document, { clientX: 10, clientY: (from + to) / 2 });
  fireEvent.pointerMove(document, { clientX: 10, clientY: to });
  fireEvent.pointerUp(document, { clientX: 10, clientY: to });
};

afterEach(() => document.documentElement.removeAttribute('data-dragging'));

describe('which list a row joins', () => {
  test('a scoped row joins its named list through an intervening one', () => {
    const { outer, inner } = setup();
    drag('Outer 2', 45, 5);
    expect(outer).toHaveBeenCalledWith('o2', 0, undefined);
    expect(inner).not.toHaveBeenCalled();
  });

  // CONTROL: unscoped rows behave exactly as before scopes existed.
  test('CONTROL: an unscoped row joins the nearest list', () => {
    const { outer, inner } = setup();
    drag('Inner 2', 105, 65);
    expect(inner).toHaveBeenCalledWith('i2', 0, undefined);
    expect(outer).not.toHaveBeenCalled();
  });

  // THE WORST PATH. Falling back to the nearest list would drag a row in a
  // list that does not contain it and report an index into the wrong array.
  test('a row naming a scope nobody declared is inert', () => {
    const { outer, inner } = setup();
    fireEvent.pointerDown(node('Stray'), {
      clientX: 10,
      clientY: 135,
      button: 0,
    });
    fireEvent.pointerMove(document, { clientX: 10, clientY: 70 });
    // Checked MID-drag. A stray row that fell back to the nearest list does
    // start a drag there, and its release is then refused only because its id
    // is not in that list -- so checking after release passes against the bug.
    expect(document.documentElement.hasAttribute('data-dragging')).toBe(false);
    fireEvent.pointerUp(document, { clientX: 10, clientY: 70 });
    expect(outer).not.toHaveBeenCalled();
    expect(inner).not.toHaveBeenCalled();
  });
});
