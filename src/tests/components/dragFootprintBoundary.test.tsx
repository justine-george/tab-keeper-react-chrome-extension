import { describe, expect, test, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

import {
  RowDragArea,
  DraggableRow,
} from '../../components/home/rightpane/rowDrag/RowDragArea';

// KAN-132. How far a row's footprint climbs, once the list it joins is no longer
// the nearest drag area above it.
//
// A row's footprint is measured on the outermost wrapper that exists only to
// hold it (KAN-163): a loose tab is a `tabs` row inside an `items` row, and the
// margin that spaces it lives on the outer one. The climb used to stop at the
// dragged list's own container, and while every window had its own tab list,
// that container sat directly above the window's `items` list.
//
// With one tab list for the whole pane, the dragged list's container is far
// above that point. A window holding a single loose tab would climb out of its
// `items` list and on up through the window's own wrappers, measuring a box that
// is not the row. So the climb refuses to step ONTO any box that holds a list's
// rows -- another drag area's container, or a box a list marked with
// `markRowContainer` -- because such a box holds a whole list, and on it the
// climb would be measuring that list rather than the row.
//
// "Refuses to step onto", not "stops on": the two differ once the box holding a
// window's item rows is no longer a drag area's container at all, which is what
// collapsing the per-window areas did (KAN-132). `markRowContainer` is how that
// box declares itself, and paneWideGroupDrag's single-item test is what tells
// the two rules apart -- both tests here pass under either.
//
// jsdom reports every rect as zero, so the boxes are given here. The wrapper
// above the nested list is deliberately much taller than the row, so a climb
// that passes the nested list reads as a footprint of 100 instead of 30.

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

const ROW_H = 30;
const WRAPPER_H = 100;

// Row x is the ONLY child of everything between it and the outer list: its own
// wrapper, the nested list's container (or a plain div, for the control), and a
// wrapper above that. Row y is an ordinary row below it.
const Harness = ({ nested }: { nested: boolean }) => {
  const x = (
    <DraggableRow scope="outer" rowId="x">
      <div>Row x</div>
    </DraggableRow>
  );
  return (
    <RowDragArea scope="outer" rowIds={['x', 'y']} onMove={() => undefined}>
      <div data-testid="wrapper">
        {nested ? (
          <RowDragArea scope="inner" rowIds={[]} onMove={() => undefined}>
            {x}
          </RowDragArea>
        ) : (
          <div>{x}</div>
        )}
      </div>
      <DraggableRow scope="outer" rowId="y">
        <div>Row y</div>
      </DraggableRow>
    </RowDragArea>
  );
};

const rowNode = (id: string) => screen.getByText(`Row ${id}`).parentElement!;

const layout = () => {
  const x = rowNode('x');
  x.getBoundingClientRect = () => box(0, ROW_H);
  // Whatever sits between the row and the wrapper: the nested list's container,
  // or the plain div standing in for it.
  x.parentElement!.getBoundingClientRect = () => box(0, ROW_H);
  screen.getByTestId('wrapper').getBoundingClientRect = () => box(0, WRAPPER_H);
  rowNode('y').getBoundingClientRect = () => box(ROW_H, ROW_H);
};

// Drags x past y's midpoint (45) and reports how far y stepped aside, which is
// exactly x's footprint.
const shiftOfYWhenXPasses = (nested: boolean) => {
  render(<Harness nested={nested} />);
  layout();
  fireEvent.pointerDown(rowNode('x'), { clientX: 10, clientY: 15, button: 0 });
  fireEvent.pointerMove(document, { clientX: 10, clientY: 25 });
  fireEvent.pointerMove(document, { clientX: 10, clientY: 50 });
  const transform = rowNode('y').style.transform;
  fireEvent.keyDown(window, { key: 'Escape' });
  cleanup();
  return transform;
};

afterEach(() => {
  document.documentElement.removeAttribute('data-dragging');
});

describe('a footprint never climbs past a nested drag area', () => {
  test('a row alone in a nested list is measured at that list, not above it', () => {
    expect(shiftOfYWhenXPasses(true)).toBe(`translateY(-${ROW_H}px)`);
  });

  // THE CONTROL. Without it, a climb that never left the row would pass the test
  // above -- and would break KAN-163, where the margin that spaces a loose tab
  // lives on a wrapper around it.
  test('CONTROL: a plain single-child wrapper is still climbed', () => {
    expect(shiftOfYWhenXPasses(false)).toBe(`translateY(-${WRAPPER_H}px)`);
  });
});
