import { describe, expect, test, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import {
  RowDragArea,
  DraggableRow,
} from '../../components/home/rightpane/rowDrag/RowDragArea';

// KAN-177. A drag swallows the click Chrome synthesizes for its own release, so
// the user does not also open the tab they were dragging (KAN-128). It must
// swallow THAT click and no other.
//
// It used to recognise "the drag's click" by time alone: the first click
// anywhere in the next 400ms. A drag that commits moves its row inside the
// pointerup handler, so Chrome dispatches no click for it at all -- and the
// suppression, still armed, ate the user's NEXT click instead. The control a
// user reaches for straight after a drag is Undo.
//
// What tells the two apart is the gesture, not the clock or the target: the
// drag's own click follows its pointerup with no press in between, and any
// click the user makes afterwards begins with a pointerdown of its own.
//
// jsdom synthesizes no click from a pointer sequence, so every click here is
// dispatched explicitly, in the order Chrome would produce it.

const ROW_H = 30;

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

const Harness = ({
  onMove,
  onUndo,
}: {
  onMove: (rowId: string, toIndex: number) => void;
  onUndo: () => void;
}) => (
  <div>
    {/* Outside the drag area, as the real toolbar is. */}
    <button type="button" onClick={onUndo}>
      Undo
    </button>
    <RowDragArea rowIds={['a', 'b', 'c']} onMove={onMove}>
      <DraggableRow rowId="a">
        <div>Row A</div>
      </DraggableRow>
      <DraggableRow rowId="b">
        <div>Row B</div>
      </DraggableRow>
      <DraggableRow rowId="c">
        <div>Row C</div>
      </DraggableRow>
    </RowDragArea>
  </div>
);

const nodeFor = (label: string) => screen.getByText(label).parentElement!;
const undoButton = () => screen.getByRole('button', { name: 'Undo' });

const layout = () => {
  ['Row A', 'Row B', 'Row C'].forEach((label, i) => {
    nodeFor(label).getBoundingClientRect = () => box(i * ROW_H, ROW_H);
  });
};

// A real drag: row B picked up and carried below row C, which commits a move.
const dragBBelowC = () => {
  fireEvent.pointerDown(nodeFor('Row B'), {
    clientX: 10,
    clientY: 45,
    button: 0,
  });
  fireEvent.pointerMove(document, { clientX: 10, clientY: 60, button: 0 });
  fireEvent.pointerMove(document, { clientX: 10, clientY: 88, button: 0 });
  fireEvent.pointerUp(document, { clientX: 10, clientY: 88, button: 0 });
};

describe('a drag swallows its own click and nothing else (KAN-177)', () => {
  let onMove: ReturnType<
    typeof vi.fn<(rowId: string, toIndex: number) => void>
  >;
  let onUndo: ReturnType<typeof vi.fn<() => void>>;
  let rowClicks: string[];
  let recordRowClick: (e: Event) => void;

  beforeEach(() => {
    onMove = vi.fn();
    onUndo = vi.fn();
    rowClicks = [];
    // Bubble phase on document, behind React's root: a click this never sees is
    // one no row handler could have run on.
    recordRowClick = (e: Event) => {
      const row = (e.target as Element).closest('[data-drag-row-id]');
      if (row) rowClicks.push(row.getAttribute('data-drag-row-id')!);
    };
    document.addEventListener('click', recordRowClick);
    render(<Harness onMove={onMove} onUndo={onUndo} />);
    layout();
  });

  afterEach(() => {
    document.removeEventListener('click', recordRowClick);
  });

  // CONTROL. Without it, a harness in which no click ever reached Undo would
  // make every test below pass for the wrong reason.
  test('CONTROL: with no drag, a press on Undo reaches it', () => {
    fireEvent.pointerDown(undoButton(), { button: 0 });
    fireEvent.pointerUp(undoButton(), { button: 0 });
    fireEvent.click(undoButton());

    expect(onUndo).toHaveBeenCalledTimes(1);
  });

  // CONTROL, and the guarantee KAN-128 depends on: the click Chrome synthesizes
  // for the drag's OWN release -- no press in between -- is still swallowed.
  test("CONTROL: the drag's own click is still swallowed", () => {
    dragBBelowC();
    expect(onMove).toHaveBeenCalledTimes(1);

    fireEvent.click(nodeFor('Row B'));

    expect(rowClicks).toEqual([]);
  });

  // THE DEFECT. A committed drag gets no click from Chrome, so nothing spends
  // the suppression -- and the user's next press lands inside the window.
  test('a new press on Undo straight after a drag reaches Undo', () => {
    dragBBelowC();
    expect(onMove).toHaveBeenCalledTimes(1);

    fireEvent.pointerDown(undoButton(), { button: 0 });
    fireEvent.pointerUp(undoButton(), { button: 0 });
    fireEvent.click(undoButton());

    expect(onUndo).toHaveBeenCalledTimes(1);
  });

  // Not a question of WHERE the click lands: a new press on a row, even the row
  // just dragged, is a new gesture and must open it.
  test('a new press on a row straight after a drag reaches that row', () => {
    dragBBelowC();
    expect(onMove).toHaveBeenCalledTimes(1);

    fireEvent.pointerDown(nodeFor('Row B'), {
      clientX: 10,
      clientY: 45,
      button: 0,
    });
    fireEvent.pointerUp(document, { clientX: 10, clientY: 45, button: 0 });
    fireEvent.click(nodeFor('Row B'));

    expect(rowClicks).toEqual(['b']);
  });
});
