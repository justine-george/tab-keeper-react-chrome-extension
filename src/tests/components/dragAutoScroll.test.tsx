import { describe, expect, test, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import {
  RowDragArea,
  DraggableRow,
} from '../../components/home/rightpane/rowDrag/RowDragArea';

// KAN-152. A drag can reach a target that is off screen.
//
// Before this, the list did not move during a drag, so in a session with three
// windows of twenty tabs the drop target simply could not be reached: the
// pointer had nowhere to go and the gesture had to be abandoned.
//
// THE HARD PART IS NOT THE SCROLLING, IT IS THE ARITHMETIC. The engine measures
// every row ONCE, at activation, because reading rects on every move would
// report positions already displaced by the drag's own shifts. Those
// measurements are viewport-relative, so the moment the list scrolls underneath
// them they describe where rows USED to be. Every comparison is therefore done
// in the list's content space -- viewport y plus scrollTop -- which is
// invariant under scrolling.
//
// jsdom has no layout and no scrolling: rects are all zero and scrollTop is an
// inert stored number. So the rows are given real boxes, the scroller is given
// real metrics, and what is pinned here is the DECISION -- how far it scrolls
// and which index it computes -- not any visual result. That a row visibly
// travels is a real-browser claim and is checked there.

const ROW_H = 30;
const VIEW_H = 90;

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

const Harness = ({ onMove }: { onMove: () => void }) => (
  <div data-testid="scroller" style={{ overflowY: 'auto' }}>
    <RowDragArea rowIds={['a', 'b', 'c', 'd']} onMove={onMove}>
      {['a', 'b', 'c', 'd'].map((id, index) => (
        <DraggableRow key={id} rowId={id} index={index}>
          <div>Row {id.toUpperCase()}</div>
        </DraggableRow>
      ))}
    </RowDragArea>
  </div>
);

const nodeFor = (label: string) => screen.getByText(label).parentElement!;

const scroller = () => screen.getByTestId('scroller');

// A viewport 90px tall showing a 120px list, so there is exactly one row's
// worth of travel available. `scrollTop` is a plain settable number in jsdom,
// which is all the engine needs.
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

// Runs the auto-scroll loop by hand. Each frame re-registers the next one, so
// draining and re-reading is what a real rAF loop does over N frames.
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
  // Past ACTIVATION_DISTANCE_PX, which is what makes it a drag rather than a
  // click and is where the rects are measured.
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

  // THE CONTROL. Without it, an implementation that scrolled on every frame
  // regardless of the pointer would satisfy both tests above -- and would make
  // the list unusable, since any drag at all would run away.
  test('CONTROL: held in the middle, the list does not move', () => {
    render(<Harness onMove={() => {}} />);
    startDragAt('Row A', 10);

    fireEvent.pointerMove(document, { clientX: 10, clientY: VIEW_H / 2 });
    runFrames(5);

    expect(scroller().scrollTop).toBe(0);
  });

  // The middle test above cannot see a runaway on its own: at scrollTop 0 an
  // upward scroll is clamped to 0, so "no movement" and "moving the wrong way,
  // clamped" look identical. Starting part-scrolled is what separates them.
  test('CONTROL: held in the middle of a part-scrolled list, it stays put', () => {
    render(<Harness onMove={() => {}} />);
    startDragAt('Row A', 10);
    scroller().scrollTop = 15;

    fireEvent.pointerMove(document, { clientX: 10, clientY: VIEW_H / 2 });
    runFrames(5);

    expect(scroller().scrollTop).toBe(15);
  });

  test('it stops at the end of the list rather than spinning', () => {
    render(<Harness onMove={() => {}} />);
    startDragAt('Row A', 10);

    fireEvent.pointerMove(document, { clientX: 10, clientY: 88 });
    runFrames(40);

    // scrollHeight - clientHeight. jsdom does not clamp for us, so the engine
    // must not run past it either.
    expect(scroller().scrollTop).toBeLessThanOrEqual(ROW_H * 4 - VIEW_H);
  });

  // THE ONE JSDOM ALMOST MISSED. A transform EXTENDS the scrollable overflow
  // area, and the held row carries one -- so in a real browser every pixel of
  // auto-scroll added a pixel of content and the end of the list retreated as
  // fast as the pointer approached it. Measured in the popup: scrollHeight
  // climbed 820 -> 1393 in step with scrollTop, and the scroll never terminated.
  //
  // Reproduced by making scrollHeight a function of scrollTop, which is what
  // the browser was effectively doing. The limit is captured once at
  // pointer-down, before any transform exists, so a growing content box cannot
  // move it.
  test('a content box that grows while scrolling does not scroll forever', () => {
    render(<Harness onMove={() => {}} />);
    startDragAt('Row A', 10);

    // Installed AFTER the drag has begun, which is when it happens for real:
    // the content only grows once the held row carries a transform. It also has
    // to be after layout(), which would otherwise redefine it straight back.
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
  // THE POINT OF THE CONTENT-SPACE ARITHMETIC. The rects were measured before
  // any scrolling; if they were compared in viewport space, scrolling by one
  // row would shift every midpoint past the pointer and the drop would land a
  // row away from where the user pointed.
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
    // Content y = 88 + 30 = 118, past the midpoints of b (45), c (75) and
    // d (105) -- so the held row lands last.
    expect(onMove.mock.calls[0][1]).toBe(3);
  });

  // A drag that BEGINS on an already-scrolled list. The rects are measured with
  // the list part-scrolled, so the measurement itself has to be lifted into
  // content space -- measuring in viewport space and comparing in content space
  // is off by exactly the scroll position at pick-up, which is the subtlest way
  // this could be wrong and the one no unscrolled test can see.
  test('a drag that starts on an already-scrolled list lands correctly', () => {
    const onMove = vi.fn();
    render(<Harness onMove={onMove} />);
    scroller().scrollTop = ROW_H;
    startDragAt('Row A', 10);

    fireEvent.pointerMove(document, { clientX: 10, clientY: 50 });
    fireEvent.pointerUp(document, { clientX: 10, clientY: 50 });

    // Content mids are 15, 45, 75, 105 whatever the scroll. Content y is
    // 50 + 30 = 80, past b (45) and c (75) but not d (105).
    expect(onMove.mock.calls[0][1]).toBe(2);
  });

  // The mirror: with no scrolling at all the answer must be unchanged from
  // what the engine always gave, or this refactor moved every existing drop.
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

// KAN-155. Releasing ends the collapse, so the list springs back from a third
// of its height to all of it -- and a row dropped at the bottom of the folded
// list is then far below the fold. The user placed it deliberately and cannot
// see where it went.
//
// Asserted on WHICH element was asked to scroll, not on any visual result:
// jsdom implements no scrolling at all (see the stub in componentSetup.ts).
describe('after a drop, the row you placed is brought into view', () => {
  // Both the element AND the argument: `nearest` is what leaves a row that is
  // already on screen exactly where it is, so a drop the user can already see
  // does not jump the list. Recording only the element cannot see that.
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
        rowId: (this as HTMLElement).dataset?.dragRowId,
        options,
      });
    });
  });

  const drag = (from: string, toY: number, commit: boolean) => {
    startDragAt(from, 10);
    fireEvent.pointerMove(document, { clientX: 10, clientY: toY });
    if (commit) fireEvent.pointerUp(document, { clientX: 10, clientY: toY });
    else fireEvent.keyDown(document, { key: 'Escape' });
    // The scroll is deferred a frame, because the reorder has to commit and lay
    // out before there is anything to scroll to.
    runFrames(1);
  };

  test('a committed drop scrolls the dropped row into view', () => {
    render(<Harness onMove={() => {}} />);

    drag('Row A', 88, true);

    expect(scrolled).toEqual([{ rowId: 'a', options: { block: 'nearest' } }]);
  });

  // THE CONTROL. A cancelled drag moved nothing, and yanking the list after an
  // Escape would be the app arguing with the user.
  test('CONTROL: a cancelled drag scrolls nothing', () => {
    render(<Harness onMove={() => {}} />);

    drag('Row A', 88, false);

    expect(scrolled).toEqual([]);
  });

  // The other control: a press that never became a drag is a click, and the
  // row's own handler owns it.
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
