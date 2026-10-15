import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { liveItem } from '../../redux/carriedItem';
import { live } from '../fixtures/liveSnapshotFixture';
import { fireEvent, render, screen } from '@testing-library/react';

import {
  DraggableRow,
  RowDragArea,
} from '../../components/home/rightpane/rowDrag/RowDragArea';
import { currentCarry, endCarry, type CarryOut } from '../../redux/carry';
import { endDragHold, isDragHeld } from '../../redux/dragHold';
import { standInSessionList } from '../setup/standInSessionList';

// KAN-280 Part F. The engine's two options for a source that is copied, not moved (Open now): a hand-off beside
// the pane (P1), and a list that only carries (P2). Harness as carryHandOff.test.tsx.

const ROW_H = 30;
// The pane: x 0..200, y 0..90, showing three of four 30px rows.
const PANE = { left: 0, right: 200, top: 0, bottom: 90 };
// The session list, stood in to the LEFT of the pane, as in the app. Right
// of the pane is no receiver: where Open now's resize grip is (KAN-352).
const LIST = { left: -300, right: PANE.left, top: 0, bottom: 500 };
const BESIDE = PANE.right + 30;

const box = (top: number, height: number): DOMRect =>
  DOMRect.fromRect({ x: 0, y: top, width: 200, height });

const OUT: CarryOut = {
  item: liveItem({
    pick: { kind: 'tab', windowId: 'live-w', tabId: 'l1' },
    window: live(),
    chromeWindowId: 7,
  }),
  card: { kind: 'tab', title: 'Row A', faviconUrl: '' },
};

let frames: FrameRequestCallback[] = [];
let unregisterList = () => {};
beforeEach(() => {
  const list = standInSessionList(LIST);
  unregisterList = list.unregister;
  frames = [];
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
    frames.push(cb);
    return frames.length;
  });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
});

afterEach(() => {
  unregisterList();
  endCarry('cancelled');
  endDragHold();
  document.documentElement.removeAttribute('data-dragging');
  vi.restoreAllMocks();
});

const Harness = ({
  onMove,
  carryOut,
  onRowClick = () => {},
  handsOffOutside,
  carryOnly,
}: {
  onMove: (rowId: string, toIndex: number) => void;
  carryOut?: (rowId: string) => CarryOut | null;
  onRowClick?: (rowId: string) => void;
  handsOffOutside?: () => Element | null;
  carryOnly?: boolean;
}) => (
  <div data-testid="pane" style={{ overflowY: 'auto' }}>
    <RowDragArea
      rowIds={['a', 'b', 'c', 'd']}
      onMove={onMove}
      dragKind="tab"
      carryOut={carryOut}
      handsOffOutside={handsOffOutside}
      carryOnly={carryOnly}
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

// The harness's pane, the box a hand-off is measured against.
const thePane = () => document.querySelector('[data-testid="pane"]');
const heldMarker = () => document.querySelector('[data-drag-held]');
const kind = () => document.documentElement.getAttribute('data-dragging');

describe('handsOffOutside (P1)', () => {
  test('a box with no width is not laid out: no line to cross, the drag stays', () => {
    const empty = document.createElement('div');
    empty.getBoundingClientRect = () =>
      DOMRect.fromRect({ x: 0, y: 0, width: 0, height: 0 });
    render(
      <Harness
        onMove={() => {}}
        carryOut={() => OUT}
        handsOffOutside={() => empty}
      />
    );
    layout();
    pickUpA();
    fireEvent.pointerMove(document, { clientX: BESIDE, clientY: 25 });
    expect(currentCarry()).toBeNull();
    expect(heldMarker()).not.toBeNull();
  });

  test('leaving the pane to the side hands off, with no receiver there', () => {
    render(
      <Harness
        onMove={() => {}}
        carryOut={() => OUT}
        handsOffOutside={thePane}
      />
    );
    layout();
    pickUpA();
    fireEvent.pointerMove(document, { clientX: BESIDE, clientY: 25 });
    expect(currentCarry()?.item).toBe(OUT.item);
    expect(heldMarker()).toBeNull();
  });

  test('above or below the pane is still the drag (KAN-152)', () => {
    render(
      <Harness
        onMove={() => {}}
        carryOut={() => OUT}
        handsOffOutside={thePane}
      />
    );
    layout();
    pickUpA();
    fireEvent.pointerMove(document, { clientX: 10, clientY: PANE.bottom + 20 });
    expect(currentCarry()).toBeNull();
    expect(heldMarker()).not.toBeNull();
  });

  test('without it, beside the pane is still the drag (the saved lists, KAN-352)', () => {
    render(<Harness onMove={() => {}} carryOut={() => OUT} />);
    layout();
    pickUpA();
    fireEvent.pointerMove(document, { clientX: BESIDE, clientY: 25 });
    expect(currentCarry()).toBeNull();
    expect(heldMarker()).not.toBeNull();
  });
});

describe('carryOnly (P2)', () => {
  test('the pick-up is a carry at once, inside the pane; nothing moves and nothing lands', () => {
    const onMove = vi.fn();
    render(<Harness onMove={onMove} carryOut={() => OUT} carryOnly />);
    layout();
    pickUpA();
    expect(currentCarry()?.item).toBe(OUT.item);
    expect(heldMarker()).toBeNull();
    expect(kind()).toBe('tab');
    fireEvent.pointerUp(document, { clientX: 10, clientY: 60 });
    expect(onMove).not.toHaveBeenCalled();
  });

  test('a row with nothing to carry starts no drag', () => {
    render(<Harness onMove={() => {}} carryOut={() => null} carryOnly />);
    layout();
    pickUpA();
    expect(currentCarry()).toBeNull();
    expect(heldMarker()).toBeNull();
    expect(kind()).toBeNull();
    expect(isDragHeld()).toBe(false);
  });

  test('turning it on mid-drag ends the in-list drag (KAN-335), as disabled does', () => {
    const { rerender } = render(
      <Harness onMove={() => {}} carryOut={() => OUT} />
    );
    layout();
    pickUpA();
    expect(heldMarker()).not.toBeNull();
    rerender(<Harness onMove={() => {}} carryOut={() => OUT} carryOnly />);
    expect(heldMarker()).toBeNull();
    expect(kind()).toBeNull();
    expect(isDragHeld()).toBe(false);
    expect(currentCarry()).toBeNull();
  });

  test('a click with no movement still reaches the row', () => {
    const clicked = vi.fn();
    render(
      <Harness
        onMove={() => {}}
        carryOut={() => OUT}
        carryOnly
        onRowClick={clicked}
      />
    );
    layout();
    fireEvent.pointerDown(nodeFor('Row A'), {
      clientX: 10,
      clientY: 15,
      button: 0,
    });
    fireEvent.pointerUp(document, { clientX: 10, clientY: 15 });
    fireEvent.click(screen.getByText('Row A'));
    expect(clicked).toHaveBeenCalledWith('a');
  });
});
