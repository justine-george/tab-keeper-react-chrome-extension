import { describe, expect, test, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import {
  RowDragArea,
  DraggableRow,
} from '../../components/home/rightpane/rowDrag/RowDragArea';

// KAN-152. A drag can reach a target that is off screen. Rows are measured ONCE at activation, viewport-relative, so every
// comparison is in content space (viewport y + scrollTop), which scrolling does not move. jsdom has no layout or scrolling, so
// rows and scroller get real metrics and the DECISION is pinned -- how far it scrolls, which index -- not the visual result.

const ROW_H = 30;
const VIEW_H = 90;

const box = (top: number, height: number): DOMRect => ({
  top,
  bottom: top + height,
  left: 0,
  right: 200,
  height,
  width: 200,
  x: 0,
  y: top,
  toJSON: () => ({}),
});

const Harness = ({ onMove }: { onMove: () => void }) => (
  <div data-testid="scroller" style={{ overflowY: 'auto' }}>
    <RowDragArea rowIds={['a', 'b', 'c', 'd']} onMove={onMove}>
      {['a', 'b', 'c', 'd'].map((id) => (
        <DraggableRow key={id} rowId={id}>
          <div>Row {id.toUpperCase()}</div>
        </DraggableRow>
      ))}
    </RowDragArea>
  </div>
);

const nodeFor = (label: string): HTMLElement => {
  const el = screen.getByText(label).parentElement;
  if (!el) throw new Error(`no row around ${label}`);
  return el;
};

const scroller = () => screen.getByTestId('scroller');

// A 90px viewport over a 120px list: one row of travel.
const layout = () => {
  const el = scroller();
  Object.defineProperty(el, 'clientHeight', {
    value: VIEW_H,
    configurable: true,
  });
  Object.defineProperty(el, 'scrollHeight', {
    value: ROW_H * 4,
    configurable: true,
  });
  el.getBoundingClientRect = () => box(0, VIEW_H);
  ['A', 'B', 'C', 'D'].forEach((letter, i) => {
    const row = nodeFor(`Row ${letter}`);
    row.getBoundingClientRect = () => box(i * ROW_H - el.scrollTop, ROW_H);
  });
};

let frames: FrameRequestCallback[] = [];

beforeEach(() => {
  frames = [];
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
    frames.push(cb);
    return frames.length;
  });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  document.documentElement.removeAttribute('data-dragging');
});

// Runs the rAF loop by hand: each frame registers the next.
const runFrames = (n: number) => {
  for (let i = 0; i < n; i++) {
    const due = frames;
    frames = [];
    due.forEach((cb) => cb(0));
  }
};

const startDragAt = (label: string, y: number) => {
  layout();
  fireEvent.pointerDown(nodeFor(label), { clientX: 10, clientY: y, button: 0 });
  // Past ACTIVATION_DISTANCE_PX: a drag, and the rects are measured here.
  fireEvent.pointerMove(document, { clientX: 10, clientY: y + 10 });
};

describe('holding a drag near an edge travels the list', () => {
  test('near the bottom edge it scrolls down', () => {
    render(<Harness onMove={() => {}} />);
    startDragAt('Row A', 10);

    // Deep into the bottom edge zone of a 90px-tall viewport.
    fireEvent.pointerMove(document, { clientX: 10, clientY: 88 });
    runFrames(3);

    expect(scroller().scrollTop).toBeGreaterThan(0);
  });

  test('near the top edge it scrolls back up', () => {
    render(<Harness onMove={() => {}} />);
    startDragAt('Row A', 10);
    scroller().scrollTop = 30;

    fireEvent.pointerMove(document, { clientX: 10, clientY: 2 });
    runFrames(3);

    expect(scroller().scrollTop).toBeLessThan(30);
  });

  // CONTROL: scrolling every frame regardless of the pointer would pass both tests above.
  test('CONTROL: held in the middle, the list does not move', () => {
    render(<Harness onMove={() => {}} />);
    startDragAt('Row A', 10);

    fireEvent.pointerMove(document, { clientX: 10, clientY: VIEW_H / 2 });
    runFrames(5);

    expect(scroller().scrollTop).toBe(0);
  });

  // At scrollTop 0 an upward runaway clamps to 0 and looks still; part-scrolled tells them apart.
  test('CONTROL: held in the middle of a part-scrolled list, it stays put', () => {
    render(<Harness onMove={() => {}} />);
    startDragAt('Row A', 10);
    scroller().scrollTop = 15;

    fireEvent.pointerMove(document, { clientX: 10, clientY: VIEW_H / 2 });
    runFrames(5);

    expect(scroller().scrollTop).toBe(15);
  });

  // The held row's transform EXTENDS the scrollable area, so the end retreated as fast as the pointer approached. Measured in
  // the popup: scrollHeight climbed 820 -> 1393 with scrollTop, never ending. The limit is captured before any transform exists.
  test('a content box that grows while scrolling does not scroll forever', () => {
    render(<Harness onMove={() => {}} />);
    startDragAt('Row A', 10);

    // After the drag begins, as for real, and after layout(), which would redefine it.
    const el = scroller();
    Object.defineProperty(el, 'scrollHeight', {
      // Grows by one pixel per pixel scrolled, exactly like the real transform.
      get: () => ROW_H * 4 + el.scrollTop,
      configurable: true,
    });

    fireEvent.pointerMove(document, { clientX: 10, clientY: 88 });
    runFrames(60);

    expect(el.scrollTop).toBeLessThanOrEqual(ROW_H * 4 - VIEW_H);
  });

  test('the loop is cancelled when the drag ends', () => {
    render(<Harness onMove={() => {}} />);
    startDragAt('Row A', 10);
    fireEvent.pointerMove(document, { clientX: 10, clientY: 88 });
    runFrames(2);

    fireEvent.pointerUp(document, { clientX: 10, clientY: 88 });
    const settled = scroller().scrollTop;
    runFrames(10);

    expect(scroller().scrollTop).toBe(settled);
  });
});

describe('the landing index survives the list scrolling under it', () => {
  // Content-space arithmetic: compared in viewport space, one row of scroll would land the drop a row off.
  test('a drop after scrolling lands where the pointer is', () => {
    const onMove = vi.fn();
    render(<Harness onMove={onMove} />);
    startDragAt('Row A', 10);

    // Travel one row's worth, then release over what is now the last row.
    fireEvent.pointerMove(document, { clientX: 10, clientY: 88 });
    scroller().scrollTop = ROW_H;
    fireEvent.pointerMove(document, { clientX: 10, clientY: 88 });
    fireEvent.pointerUp(document, { clientX: 10, clientY: 88 });

    expect(onMove).toHaveBeenCalledTimes(1);
    // Content y = 88 + 30 = 118, past b (45), c (75) and d (105): last.
    expect(onMove.mock.calls[0][1]).toBe(3);
  });

  // Begun part-scrolled: the measurement itself is lifted into content space, or it is off by the scroll at pick-up.
  test('a drag that starts on an already-scrolled list lands correctly', () => {
    const onMove = vi.fn();
    render(<Harness onMove={onMove} />);
    scroller().scrollTop = ROW_H;
    startDragAt('Row A', 10);

    fireEvent.pointerMove(document, { clientX: 10, clientY: 50 });
    fireEvent.pointerUp(document, { clientX: 10, clientY: 50 });

    // Content mids 15, 45, 75, 105. Content y = 50 + 30 = 80: past b and c, not d.
    expect(onMove.mock.calls[0][1]).toBe(2);
  });

  // CONTROL: with no scrolling the index is unchanged from before.
  test('CONTROL: with no scrolling the index is what it always was', () => {
    const onMove = vi.fn();
    render(<Harness onMove={onMove} />);
    startDragAt('Row A', 10);

    fireEvent.pointerMove(document, { clientX: 10, clientY: 50 });
    fireEvent.pointerUp(document, { clientX: 10, clientY: 50 });

    // y = 50 is past b's midpoint (45) but not c's (75).
    expect(onMove.mock.calls[0][1]).toBe(1);
  });
});

// KAN-155. Releasing unfolds the list, so a row dropped at the bottom of the folded list ends far below the fold.
// Asserted on which element was asked to scroll: jsdom implements no scrolling.
describe('after a drop, the row you placed is brought into view', () => {
  // The argument too: `nearest` leaves a row already on screen where it is.
  const scrolled: {
    rowId: string | undefined;
    options: ScrollIntoViewOptions | boolean | undefined;
  }[] = [];

  beforeEach(() => {
    scrolled.length = 0;
    vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(function (
      this: Element,
      options?: ScrollIntoViewOptions | boolean
    ) {
      scrolled.push({
        rowId: this instanceof HTMLElement ? this.dataset.dragRowId : undefined,
        options,
      });
    });
  });

  const drag = (from: string, toY: number, commit: boolean) => {
    startDragAt(from, 10);
    fireEvent.pointerMove(document, { clientX: 10, clientY: toY });
    if (commit) fireEvent.pointerUp(document, { clientX: 10, clientY: toY });
    else fireEvent.keyDown(document, { key: 'Escape' });
    // Deferred a frame: the reorder must commit and lay out first.
    runFrames(1);
  };

  test('a committed drop scrolls the dropped row into view', () => {
    render(<Harness onMove={() => {}} />);

    drag('Row A', 88, true);

    expect(scrolled).toEqual([{ rowId: 'a', options: { block: 'nearest' } }]);
  });

  // CONTROL: a cancelled drag moved nothing, so nothing scrolls after Esc.
  test('CONTROL: a cancelled drag scrolls nothing', () => {
    render(<Harness onMove={() => {}} />);

    drag('Row A', 88, false);

    expect(scrolled).toEqual([]);
  });

  // CONTROL: a click is the row's own.
  test('CONTROL: a plain click scrolls nothing', () => {
    render(<Harness onMove={() => {}} />);
    layout();

    fireEvent.pointerDown(nodeFor('Row A'), {
      clientX: 10,
      clientY: 10,
      button: 0,
    });
    fireEvent.pointerUp(document, { clientX: 10, clientY: 10 });
    runFrames(1);

    expect(scrolled).toEqual([]);
  });
});
