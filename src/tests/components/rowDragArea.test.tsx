import { describe, expect, test, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import {
  RowDragArea,
  DraggableRow,
} from '../../components/home/rightpane/rowDrag/RowDragArea';
import { bandAt } from '../../components/home/rightpane/rowDrag/dropRules';

// The drag layer on its own, without WindowEntryContainer around it. What is
// pinned here is the BEHAVIOUR the pane relies on -- when a drag starts, where
// it says the tab landed, which group it says the tab joined, and what happens
// when it is abandoned.
//
// jsdom reports every rect as zero, so the midpoint arithmetic that decides the
// landing index would be untestable as-is: every row would share a midpoint of
// 0 and every drag would compute the same answer. The rows are given real boxes
// below. Row n occupies [n*30, n*30+30), so the midpoints are 15, 45 and 75.
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

type OnMove = (tabId: string, toIndex: number, group?: string) => void;

const Harness = ({ onMove }: { onMove: OnMove }) => (
  // `bandAt` is passed in rather than known to the area: the tab list is the
  // only caller that has a membership question at all.
  <RowDragArea rowIds={['a', 'b', 'c']} onMove={onMove} resolveDrop={bandAt}>
    {/* Row `a` sits inside a band; `b` and `c` do not. */}
    <div data-band-id="grp" data-testid="band">
      <DraggableRow rowId="a">
        <div>Row A</div>
      </DraggableRow>
    </div>
    <DraggableRow rowId="b">
      <div>Row B</div>
    </DraggableRow>
    <DraggableRow rowId="c">
      <div>Row C</div>
    </DraggableRow>
  </RowDragArea>
);

// The draggable node is the parent of the row content.
const nodeFor = (label: string) => screen.getByText(label).parentElement!;

const layout = () => {
  ['Row A', 'Row B', 'Row C'].forEach((label, i) => {
    const el = nodeFor(label);
    el.getBoundingClientRect = () => box(i * ROW_H, ROW_H);
  });
  // The band wraps row A and, per the drop rule, its padding counts as inside.
  const band = screen.getByTestId('band');
  band.getBoundingClientRect = () => box(-2, ROW_H + 4);
};

const press = (label: string, y: number) =>
  fireEvent.pointerDown(nodeFor(label), { clientX: 10, clientY: y, button: 0 });
const moveTo = (y: number) =>
  fireEvent.pointerMove(document, { clientX: 10, clientY: y, button: 0 });
const release = (y: number) =>
  fireEvent.pointerUp(document, { clientX: 10, clientY: y, button: 0 });

// handleSelector names the part of a row that may start a drag, and it is what
// lets one list nest inside another (KAN-129): a window's draggable node wraps
// its own tabs, so without a handle every tab drag would begin a window drag
// underneath it.
//
// The rows here each carry a handle and a patch of non-handle area, and the
// whole AREA sits inside an element that also matches the selector -- which is
// the case the containment rule exists for.
describe('handleSelector decides which press starts a drag', () => {
  let onMove: ReturnType<typeof vi.fn<OnMove>>;

  const HandleHarness = () => (
    // An outer element matching the same selector. `closest` walks to the
    // document, so an area that only asked "is there a handle above the
    // press?" would answer yes for every press in this tree.
    <div data-handle>
      <RowDragArea
        rowIds={['a', 'b', 'c']}
        onMove={onMove}
        handleSelector="[data-handle]"
      >
        {['a', 'b', 'c'].map((id) => (
          <DraggableRow key={id} rowId={id}>
            <div data-handle>
              <span>Handle {id}</span>
            </div>
            <div>
              <span>Body {id}</span>
            </div>
          </DraggableRow>
        ))}
      </RowDragArea>
    </div>
  );

  const rowFor = (id: string) =>
    document.querySelector<HTMLElement>(`[data-drag-row-id="${id}"]`)!;

  beforeEach(() => {
    onMove = vi.fn<OnMove>();
    render(<HandleHarness />);
    ['a', 'b', 'c'].forEach((id, i) => {
      rowFor(id).getBoundingClientRect = () => box(i * ROW_H, ROW_H);
    });
  });

  afterEach(() => {
    document.documentElement.removeAttribute('data-dragging');
  });

  test('a press on the handle starts a drag', () => {
    fireEvent.pointerDown(screen.getByText('Handle c'), {
      clientX: 10,
      clientY: 75,
      button: 0,
    });
    moveTo(40);
    moveTo(5);
    release(5);

    expect(onMove).toHaveBeenCalledTimes(1);
    expect(onMove.mock.calls[0][0]).toBe('c');
    expect(onMove.mock.calls[0][1]).toBe(0);
  });

  // The nesting case, at the level the rule is implemented rather than through
  // two real components: a press on the part of the row that is NOT the handle
  // -- where a nested list's own rows live -- must start nothing here.
  test('a press outside the handle starts nothing', () => {
    fireEvent.pointerDown(screen.getByText('Body c'), {
      clientX: 10,
      clientY: 75,
      button: 0,
    });
    moveTo(40);
    moveTo(5);
    release(5);

    expect(onMove).not.toHaveBeenCalled();
  });

  // THE CONTAINMENT RULE. The press below has a matching ancestor -- the
  // wrapper around the whole area -- but it is not THIS row's handle, and an
  // unbounded `closest` would accept it. That would put the nesting bug back
  // one level higher up, where it is harder to see.
  test('a matching ancestor outside the row does not count as its handle', () => {
    fireEvent.pointerDown(screen.getByText('Body a'), {
      clientX: 10,
      clientY: 15,
      button: 0,
    });
    moveTo(50);
    moveTo(85);
    release(85);

    expect(onMove).not.toHaveBeenCalled();
  });
});

describe('what a drag reports when it lands', () => {
  let onMove: ReturnType<typeof vi.fn<OnMove>>;

  beforeEach(() => {
    onMove = vi.fn<OnMove>();
    render(<Harness onMove={onMove} />);
    layout();
  });

  afterEach(() => {
    document.documentElement.removeAttribute('data-dragging');
  });

  test('dragging to the top of the list lands at index 0', () => {
    press('Row C', 75);
    moveTo(40);
    moveTo(5);
    release(5);

    expect(onMove).toHaveBeenCalledTimes(1);
    expect(onMove.mock.calls[0][0]).toBe('c');
    expect(onMove.mock.calls[0][1]).toBe(0);
  });

  test('dragging to the bottom lands at the last index', () => {
    press('Row A', 15);
    moveTo(50);
    moveTo(85);
    release(85);

    expect(onMove.mock.calls[0][1]).toBe(2);
  });

  // The midpoint is the boundary, not the row's edge: a tab has to pass the
  // middle of its neighbour before it is considered past it.
  test('stopping short of the next midpoint does not advance the index', () => {
    press('Row A', 15);
    moveTo(40); // below Row B's midpoint of 45
    release(40);

    expect(onMove.mock.calls[0][1]).toBe(0);
  });

  test('releasing inside a band joins that group', () => {
    press('Row C', 75);
    moveTo(40);
    moveTo(5); // inside the band's box
    release(5);

    expect(onMove.mock.calls[0][2]).toBe('grp');
  });

  test('releasing outside every band joins no group', () => {
    press('Row A', 15);
    moveTo(50);
    moveTo(85);
    release(85);

    expect(onMove.mock.calls[0][2]).toBeUndefined();
  });
});

describe('when a drag should not happen at all', () => {
  let onMove: ReturnType<typeof vi.fn<OnMove>>;

  beforeEach(() => {
    onMove = vi.fn<OnMove>();
    render(<Harness onMove={onMove} />);
    layout();
  });

  afterEach(() => {
    document.documentElement.removeAttribute('data-dragging');
  });

  test('a press that never crosses the threshold reports no move', () => {
    press('Row A', 15);
    moveTo(17); // 2px, under the 5px activation distance
    release(17);

    expect(onMove).not.toHaveBeenCalled();
  });

  test('Escape abandons the drag without moving anything', () => {
    press('Row A', 15);
    moveTo(85);
    fireEvent.keyDown(window, { key: 'Escape' });
    release(85);

    expect(onMove).not.toHaveBeenCalled();
  });

  test('a right-button press does not begin a drag', () => {
    fireEvent.pointerDown(nodeFor('Row A'), {
      clientX: 10,
      clientY: 15,
      button: 2,
    });
    moveTo(85);
    release(85);

    expect(onMove).not.toHaveBeenCalled();
  });
});

// MOVED, and the move is the point. These three used to assert
// `document.body.style.cursor === 'grabbing'` -- an assertion that was true
// throughout, while the pointer rendered `pointer` for the whole gesture
// (KAN-134). jsdom resolves no cascade, so the body's own style says nothing
// about what any element shows.
//
// The flag those tests should have been checking is now pinned in
// dragSetsDocumentFlag.test.tsx, the rule it triggers in dragStyles.test.ts,
// and the rendered cursor in a browser. Nothing here asserts a cursor, because
// nothing here can.
describe('the drag flag while dragging', () => {
  let onMove: ReturnType<typeof vi.fn<OnMove>>;

  const dragging = () => document.documentElement.hasAttribute('data-dragging');

  beforeEach(() => {
    onMove = vi.fn<OnMove>();
    render(<Harness onMove={onMove} />);
    layout();
  });

  afterEach(() => {
    document.documentElement.removeAttribute('data-dragging');
  });

  // On the document, not the row: during a drag the pointer travels over other
  // rows and gaps, and anything scoped to the source element stops applying as
  // soon as it leaves, which reads as the drag letting go.
  test('the document is flagged during the drag and cleared after', () => {
    press('Row A', 15);
    moveTo(50);
    expect(dragging()).toBe(true);

    release(50);
    expect(dragging()).toBe(false);
  });

  test('Escape also clears it', () => {
    press('Row A', 15);
    moveTo(50);
    expect(dragging()).toBe(true);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(dragging()).toBe(false);
  });

  test('a press below the threshold never sets it', () => {
    press('Row A', 15);
    moveTo(17);
    expect(dragging()).toBe(false);
    release(17);
  });
});

// bandAt is the whole membership decision, so it is worth pinning on its own
// rather than only through a drag.
describe('bandAt', () => {
  const container = () => {
    const root = document.createElement('div');
    const band = document.createElement('div');
    band.dataset.bandId = 'grp';
    band.getBoundingClientRect = () => box(10, 40, 0, 100);
    root.appendChild(band);
    return root;
  };

  test('a point inside the band resolves to its group', () => {
    expect(bandAt(container(), 50, 30)).toBe('grp');
  });

  test('a point above the band resolves to no group', () => {
    expect(bandAt(container(), 50, 5)).toBeUndefined();
  });

  test('a point beside the band resolves to no group', () => {
    expect(bandAt(container(), 150, 30)).toBeUndefined();
  });

  test('the boundary counts as inside, so the padding is part of the band', () => {
    expect(bandAt(container(), 50, 10)).toBe('grp');
    expect(bandAt(container(), 50, 50)).toBe('grp');
  });

  test('no container resolves to no group rather than throwing', () => {
    expect(bandAt(null, 50, 30)).toBeUndefined();
  });
});
