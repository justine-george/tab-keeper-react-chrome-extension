import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import {
  DraggableRow,
  RowDragArea,
} from '../../components/home/rightpane/rowDrag/RowDragArea';
import {
  currentCarry,
  endCarry,
  startCarry,
  type CarryOut,
} from '../../redux/carry';
import {
  endDragHold,
  isDragHeld,
  whenDragReleases,
} from '../../redux/dragHold';
import { standInSessionList } from '../setup/standInSessionList';

// KAN-350. A saved drag that reaches a carry receiver -- the session list --
// is handed to the carry, which outlives the area (the area's unmount would
// otherwise end the drag). ONLY there (KAN-352): beside the pane, over the
// Open now resize grip or Open now itself, nothing changes; above or below
// the pane is how a drag auto-scrolls (KAN-152). The controls below prove it.
//
// jsdom has no layout and computes no emotion class, so the pane's overflow is
// set inline and the pane and rows get boxes, as dragAutoScroll.test.tsx and
// dragDeadSpace.test.tsx do. What is pinned is the DECISION.

const ROW_H = 30;
// The pane: x 0..200, y 0..90, showing three of four 30px rows.
const PANE = { left: 0, right: 200, top: 0, bottom: 90 };
// The session list, stood in to the LEFT of the pane, as in the app. Right
// of the pane is no receiver: where Open now's resize grip is (KAN-352).
const LIST = { left: -300, right: PANE.left, top: 0, bottom: 500 };
const ON_LIST = PANE.left - 30;
const BESIDE = PANE.right + 30;

const box = (top: number, height: number): DOMRect =>
  DOMRect.fromRect({ x: 0, y: top, width: 200, height });

const OUT: CarryOut = {
  carried: { kind: 'tab', tabGroupId: 'S1', windowId: 'w1', tabId: 'a' },
  card: { kind: 'tab', title: 'Row A', faviconUrl: '' },
};

let frames: FrameRequestCallback[] = [];
let unregisterList = () => {};
let listHit: ReturnType<typeof vi.spyOn> | null = null;
beforeEach(() => {
  const list = standInSessionList(LIST);
  unregisterList = list.unregister;
  listHit = vi.spyOn(list.receiver, 'hit');
  frames = [];
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
    frames.push(cb);
    return frames.length;
  });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
});

afterEach(() => {
  unregisterList();
  listHit = null;
  endCarry('cancelled');
  endDragHold();
  document.documentElement.removeAttribute('data-dragging');
  vi.restoreAllMocks();
});

const runFrames = (n: number) => {
  for (let i = 0; i < n; i++) {
    const due = frames;
    frames = [];
    due.forEach((cb) => cb(0));
  }
};

const Harness = ({
  onMove,
  carryOut,
  adoptRowId,
  onRowClick = () => {},
}: {
  onMove: (rowId: string, toIndex: number) => void;
  carryOut?: (rowId: string) => CarryOut | null;
  adoptRowId?: string;
  onRowClick?: (rowId: string) => void;
}) => (
  <div data-testid="pane" style={{ overflowY: 'auto' }}>
    <RowDragArea
      rowIds={['a', 'b', 'c', 'd']}
      onMove={onMove}
      dragKind="tab"
      carryOut={carryOut}
      adoptRowId={adoptRowId}
    >
      {['a', 'b', 'c', 'd'].map((id) => (
        <DraggableRow key={id} rowId={id}>
          <div onClick={() => onRowClick(id)}>Row {id.toUpperCase()}</div>
        </DraggableRow>
      ))}
    </RowDragArea>
  </div>
);

function nodeFor(label: string): HTMLElement {
  const el = screen.getByText(label).parentElement;
  if (el === null) throw new Error(`no row for ${label}`);
  return el;
}

// A 90px pane over a 120px list, so there is a row's worth to auto-scroll.
const layout = () => {
  const pane = screen.getByTestId('pane');
  Object.defineProperty(pane, 'clientHeight', {
    value: PANE.bottom,
    configurable: true,
  });
  Object.defineProperty(pane, 'scrollHeight', {
    value: ROW_H * 4,
    configurable: true,
  });
  pane.getBoundingClientRect = () => box(PANE.top, PANE.bottom);
  ['A', 'B', 'C', 'D'].forEach((letter, i) => {
    nodeFor(`Row ${letter}`).getBoundingClientRect = () =>
      box(i * ROW_H - pane.scrollTop, ROW_H);
  });
  return pane;
};

// Row A picked up at (10, 15) and carried past the activation distance.
const pickUpA = () => {
  fireEvent.pointerDown(nodeFor('Row A'), {
    clientX: 10,
    clientY: 15,
    button: 0,
  });
  fireEvent.pointerMove(document, { clientX: 10, clientY: 25 });
};

const heldMarker = () => document.querySelector('[data-drag-held]');
const kind = () => document.documentElement.getAttribute('data-dragging');

describe('reaching the session list hands the drag to the carry', () => {
  test('onto the list, left of the pane', () => {
    const x = ON_LIST;
    const onMove = vi.fn();
    const carryOut = vi.fn(() => OUT);
    render(<Harness onMove={onMove} carryOut={carryOut} />);
    layout();
    pickUpA();
    // The premise: a live drag, holding, with the kind published.
    expect(heldMarker()).not.toBeNull();
    expect(isDragHeld()).toBe(true);
    // A change another page made, held by the drag.
    const held = vi.fn();
    whenDragReleases(held);

    fireEvent.pointerMove(document, { clientX: x, clientY: 40 });

    expect(carryOut).toHaveBeenCalledWith('a');
    expect(currentCarry()).toEqual({
      ...OUT,
      x,
      y: 40,
      owner: 'layer',
    });
    // Still held, the kind still published: the carry took them over.
    expect(isDragHeld()).toBe(true);
    expect(held).not.toHaveBeenCalled();
    expect(kind()).toBe('tab');
    // The area's own drag is over: no row held, none moved.
    expect(heldMarker()).toBeNull();
    expect(nodeFor('Row A').style.transform).toBe('');
    expect(onMove).not.toHaveBeenCalled();

    // Its release is not the area's either.
    fireEvent.pointerUp(document, { clientX: x, clientY: 40 });
    expect(onMove).not.toHaveBeenCalled();
    expect(isDragHeld()).toBe(true);
  });

  test('the engine arms no click suppression at the hand-off: the carry owns that', () => {
    const rowClicks: string[] = [];
    render(
      <Harness
        onMove={() => {}}
        carryOut={() => OUT}
        onRowClick={(id) => rowClicks.push(id)}
      />
    );
    layout();
    pickUpA();
    fireEvent.pointerMove(document, { clientX: ON_LIST, clientY: 40 });
    expect(currentCarry()).not.toBeNull();
    fireEvent.pointerUp(document, { clientX: ON_LIST, clientY: 40 });
    endCarry('cancelled');

    // With no CarryLayer mounted, nothing swallows this one.
    fireEvent.click(screen.getByText('Row B'));

    expect(rowClicks).toEqual(['b']);
  });

  test('a null carryOut leaves the drag as it was, and it still commits', () => {
    const onMove = vi.fn();
    render(<Harness onMove={onMove} carryOut={() => null} />);
    layout();
    pickUpA();

    fireEvent.pointerMove(document, { clientX: ON_LIST, clientY: 40 });
    expect(currentCarry()).toBeNull();
    expect(heldMarker()).not.toBeNull();

    // Back in, past B's midpoint (45): lands at index 1.
    fireEvent.pointerMove(document, { clientX: 10, clientY: 50 });
    fireEvent.pointerUp(document, { clientX: 10, clientY: 50 });
    expect(onMove).toHaveBeenCalledWith('a', 1, undefined);
  });

  // An adopted drag hands its carry back on the list whether or not its list
  // could start a carry of its own: what it hands is the carry it came from.
  test('an adopted drag hands its carry back on the list, with no carryOut', () => {
    render(<Harness onMove={() => {}} adoptRowId="a" />);
    layout();
    startCarry(OUT.carried, OUT.card, ON_LIST, 40);

    fireEvent.pointerMove(document, { clientX: 10, clientY: 40 });
    // The premise: adopted.
    expect(currentCarry()?.owner).toBe('area');
    expect(heldMarker()).not.toBeNull();

    fireEvent.pointerMove(document, { clientX: ON_LIST, clientY: 40 });

    expect(currentCarry()?.owner).toBe('layer');
    expect(currentCarry()?.carried).toBe(OUT.carried);
    expect(heldMarker()).toBeNull();
  });

  test('a press while a carry is on starts no second drag', () => {
    const onMove = vi.fn();
    render(<Harness onMove={onMove} carryOut={() => OUT} />);
    layout();
    startCarry(OUT.carried, OUT.card, 300, 40);

    fireEvent.pointerDown(nodeFor('Row B'), {
      clientX: 10,
      clientY: 45,
      button: 0,
    });
    fireEvent.pointerMove(document, { clientX: 10, clientY: 80 });

    expect(heldMarker()).toBeNull();
    fireEvent.pointerUp(document, { clientX: 10, clientY: 80 });
    expect(onMove).not.toHaveBeenCalled();
  });
});

describe('any other exit is today’s drag', () => {
  // THE CONTROL for "existing drags unchanged". Below the pane is the
  // auto-scroll overshoot (KAN-152): a hand-off here would take the drag away
  // exactly where the user is reaching for a row off screen.
  test('CONTROL: below the pane, no hand-off, and the list auto-scrolls', () => {
    const carryOut = vi.fn(() => OUT);
    render(<Harness onMove={() => {}} carryOut={carryOut} />);
    const pane = layout();
    pickUpA();

    fireEvent.pointerMove(document, { clientX: 10, clientY: PANE.bottom + 20 });
    runFrames(3);

    expect(carryOut).not.toHaveBeenCalled();
    expect(currentCarry()).toBeNull();
    expect(heldMarker()).not.toBeNull();
    expect(pane.scrollTop).toBeGreaterThan(0);
  });

  test('above the pane, no hand-off', () => {
    const carryOut = vi.fn(() => OUT);
    render(<Harness onMove={() => {}} carryOut={carryOut} />);
    const pane = layout();
    pane.scrollTop = 30;
    pickUpA();

    fireEvent.pointerMove(document, { clientX: 10, clientY: PANE.top - 20 });
    runFrames(3);

    expect(carryOut).not.toHaveBeenCalled();
    expect(currentCarry()).toBeNull();
    expect(heldMarker()).not.toBeNull();
    expect(pane.scrollTop).toBeLessThan(30);
  });

  // KAN-352, aimed where the old rule fired: right of the pane, where Open
  // now's resize grip sits, is a sideways exit -- and no receiver. The drag
  // stays the area's: no carry, its preview still drawn, and the release
  // there lands where that preview showed.
  test('beside the pane over no receiver: no hand-off, and the release still lands', () => {
    const onMove = vi.fn();
    const carryOut = vi.fn(() => OUT);
    render(<Harness onMove={onMove} carryOut={carryOut} />);
    layout();
    pickUpA();

    // Past B's midpoint (45), beside the pane.
    fireEvent.pointerMove(document, { clientX: BESIDE, clientY: 50 });

    expect(carryOut).not.toHaveBeenCalled();
    expect(currentCarry()).toBeNull();
    expect(heldMarker()).not.toBeNull();
    expect(isDragHeld()).toBe(true);
    // The preview is drawn: B has made room above it for A.
    expect(nodeFor('Row B').style.transform).toBe(`translateY(-${ROW_H}px)`);

    fireEvent.pointerUp(document, { clientX: BESIDE, clientY: 50 });
    expect(onMove).toHaveBeenCalledWith('a', 1, undefined);
    expect(isDragHeld()).toBe(false);
  });

  // The session list and Open now pass no carryOut: on a receiver their drag
  // is what it always was -- and they never even ask it (one box read per
  // move is the hand-off's cost, paid only by a list that can hand off).
  test('an area with no carryOut keeps its drag on a receiver, and never asks it', () => {
    const onMove = vi.fn();
    render(<Harness onMove={onMove} />);
    layout();
    pickUpA();

    fireEvent.pointerMove(document, { clientX: ON_LIST, clientY: 40 });
    fireEvent.pointerMove(document, { clientX: ON_LIST, clientY: 60 });

    expect(currentCarry()).toBeNull();
    expect(heldMarker()).not.toBeNull();
    expect(isDragHeld()).toBe(true);
    expect(listHit).not.toBeNull();
    expect(listHit).not.toHaveBeenCalled();
  });
});
