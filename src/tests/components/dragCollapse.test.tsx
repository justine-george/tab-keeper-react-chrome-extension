import { describe, expect, test, afterEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import {
  RowDragArea,
  DraggableRow,
} from '../../components/home/rightpane/rowDrag/RowDragArea';
import { setDragging } from '../../components/home/rightpane/rowDrag/dropRules';

// KAN-153. A window drag folds every window by a CSS rule keyed on the drag kind; no window's state is touched, so it
// comes back as it was with no bookkeeping. jsdom applies no App.css, so this pins the two halves: the rule's scope
// (dragStyles.test.ts) and the kind published BEFORE the rows are measured. The visual result is a browser check.

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

afterEach(() => {
  document.documentElement.removeAttribute('data-dragging');
  vi.restoreAllMocks();
});

// A row's draggable wrapper, found by its text.
const rowOf = (label: string): HTMLElement => {
  const el = screen.getByText(label).parentElement;
  if (!el) throw new Error(`no row around ${label}`);
  return el;
};

// The scrolling box a test renders first.
const scrollerIn = (container: HTMLElement): HTMLElement => {
  const el = container.firstElementChild;
  if (!(el instanceof HTMLElement)) throw new Error('no scroller rendered');
  return el;
};

describe('the published drag kind', () => {
  test.each(['tab', 'window', 'session', 'group'] as const)(
    'says %s',
    (kind) => {
      setDragging(true, kind);
      expect(document.documentElement.getAttribute('data-dragging')).toBe(kind);
    }
  );

  test('and clears on release', () => {
    setDragging(true, 'window');
    setDragging(false);
    expect(document.documentElement.hasAttribute('data-dragging')).toBe(false);
  });
});

describe('the collapse happens before the rows are measured', () => {
  // THE ORDERING BUG: collapsing changes every row's height, and the rects read after the attribute is written are the folded
  // ones -- only if it is written FIRST. Recorded per measurement, the only way to see an order from outside.
  test('the drag kind is already published when each row is measured', () => {
    const seenAtMeasure: (string | null)[] = [];

    render(
      <RowDragArea rowIds={['a', 'b']} onMove={() => {}} dragKind="window">
        <DraggableRow rowId="a">
          <div>Row A</div>
        </DraggableRow>
        <DraggableRow rowId="b">
          <div>Row B</div>
        </DraggableRow>
      </RowDragArea>
    );

    ['Row A', 'Row B'].forEach((label, i) => {
      const el = rowOf(label);
      el.getBoundingClientRect = () => {
        seenAtMeasure.push(
          document.documentElement.getAttribute('data-dragging')
        );
        return box(i * 30, 30);
      };
    });

    fireEvent.pointerDown(rowOf('Row A'), {
      clientX: 10,
      clientY: 5,
      button: 0,
    });
    fireEvent.pointerMove(document, { clientX: 10, clientY: 20 });

    expect(seenAtMeasure.length).toBeGreaterThan(0);
    expect(seenAtMeasure.every((v) => v === 'window')).toBe(true);
  });
});

// KAN-154. The collapse can make the list SHORTER THAN ITS VIEWPORT, and the browser clamps scrollTop. Measured in the popup,
// five windows scrolled to the bottom: content 820 -> 416, scrollTop 404 -> 0. The pick-up's scroll origin was then stale: the
// held row went off screen and the drop committed nothing. jsdom neither collapses nor clamps, so both are simulated.
describe('a drag that starts scrolled, on a list that collapses', () => {
  const VIEW = 90;
  const OPEN_H = 30;
  const SHUT_H = 15;

  const mountClampingScroller = (el: HTMLElement) => {
    const collapsed = () =>
      document.documentElement.getAttribute('data-dragging') === 'window';
    const rowH = () => (collapsed() ? SHUT_H : OPEN_H);
    let top = 0;
    Object.defineProperty(el, 'clientHeight', {
      value: VIEW,
      configurable: true,
    });
    Object.defineProperty(el, 'scrollHeight', {
      get: () => rowH() * 4,
      configurable: true,
    });
    const max = () => Math.max(0, rowH() * 4 - VIEW);
    Object.defineProperty(el, 'scrollTop', {
      // Clamped on READ too, as a real scroller re-clamps at layout; clamping only on write disagreed with the popup.
      get: () => (top = Math.min(top, max())),
      set: (v: number) => (top = Math.max(0, Math.min(v, max()))),
      configurable: true,
    });
    el.getBoundingClientRect = () => box(0, VIEW);
    return { rowH };
  };

  test('the held row stays put and the drop lands where the pointer is', () => {
    const onMove = vi.fn();
    const { container } = render(
      <div style={{ overflowY: 'auto' }}>
        <RowDragArea
          rowIds={['a', 'b', 'c', 'd']}
          onMove={onMove}
          dragKind="window"
        >
          {['a', 'b', 'c', 'd'].map((id) => (
            <DraggableRow key={id} rowId={id}>
              <div>Row {id}</div>
            </DraggableRow>
          ))}
        </RowDragArea>
      </div>
    );

    const scroller = scrollerIn(container);
    const { rowH } = mountClampingScroller(scroller);
    ['a', 'b', 'c', 'd'].forEach((id, i) => {
      const row = rowOf(`Row ${id}`);
      row.getBoundingClientRect = () =>
        box(i * rowH() - scroller.scrollTop, rowH());
    });

    // At the bottom of the EXPANDED list, the only way to reach the last row, as reported.
    scroller.scrollTop = 999;
    expect(scroller.scrollTop).toBe(OPEN_H * 4 - VIEW);

    const held = rowOf('Row d');
    fireEvent.pointerDown(held, { clientX: 10, clientY: 65, button: 0 });
    fireEvent.pointerMove(document, { clientX: 10, clientY: 20 });
    fireEvent.pointerUp(document, { clientX: 10, clientY: 20 });

    // Folded, the rows span 0..60 in a 90px view: scroll clamped to 0, mids 7.5, 22.5, 37.5, 52.5. 20 passes only the first.
    expect(onMove).toHaveBeenCalledTimes(1);
    expect(onMove.mock.calls[0][1]).toBe(1);
  });
});

// KAN-156. The drop is judged in the folded layout too, before the kind is unpublished: reading scrollTop after forces the
// expanded layout. Measured in the popup, twenty windows: scrollTop 1200, 385 folded, 1200 again right after unpublishing, and a
// window released mid-pane landed LAST. Five-window probes folded to 0 and missed it; this fake reproduces the measured sequence.
describe('a drop on a list that is still scrolled while folded', () => {
  const VIEW = 90;
  const OPEN_H = 30;
  const SHUT_H = 20;
  const IDS = ['a', 'b', 'c', 'd', 'e', 'f'];

  test('is judged in the folded layout the rows were measured in', () => {
    const onMove = vi.fn();
    const { container } = render(
      <div style={{ overflowY: 'auto' }}>
        <RowDragArea rowIds={IDS} onMove={onMove} dragKind="window">
          {IDS.map((id) => (
            <DraggableRow key={id} rowId={id}>
              <div>Row {id}</div>
            </DraggableRow>
          ))}
        </RowDragArea>
      </div>
    );

    const scroller = scrollerIn(container);
    const folded = () =>
      document.documentElement.getAttribute('data-dragging') === 'window';
    const rowH = () => (folded() ? SHUT_H : OPEN_H);
    const max = () => Math.max(0, rowH() * IDS.length - VIEW);
    let top = 0;
    Object.defineProperty(scroller, 'clientHeight', {
      value: VIEW,
      configurable: true,
    });
    Object.defineProperty(scroller, 'scrollHeight', {
      get: () => rowH() * IDS.length,
      configurable: true,
    });
    Object.defineProperty(scroller, 'scrollTop', {
      get: () => (folded() ? Math.min(top, max()) : top),
      set: (v: number) => (top = Math.max(0, Math.min(v, max()))),
      configurable: true,
    });
    scroller.getBoundingClientRect = () => box(0, VIEW);
    IDS.forEach((id, i) => {
      rowOf(`Row ${id}`).getBoundingClientRect = () =>
        box(i * rowH() - scroller.scrollTop, rowH());
    });

    // Expanded: 180 of content in a 90 view, scrolled to the bottom.
    scroller.scrollTop = 90;
    // Row d's expanded box is content 90..120, so viewport 0..30.
    const held = rowOf('Row d');
    fireEvent.pointerDown(held, { clientX: 10, clientY: 15, button: 0 });
    fireEvent.pointerMove(document, { clientX: 10, clientY: 25 });

    // Folded: 120 of content, so the scroll clamps to 30, NOT 0 -- the point of this test.
    expect(scroller.scrollTop).toBe(30);

    fireEvent.pointerMove(document, { clientX: 10, clientY: 5 });
    fireEvent.pointerUp(document, { clientX: 10, clientY: 5 });

    // Folded mids 10, 30, 50, 70, 90, 110. Viewport 5 at the folded 30 is content 35: index 2. Unfolded it reads 95: index 4.
    expect(onMove).toHaveBeenCalledTimes(1);
    expect(onMove.mock.calls[0].slice(0, 2)).toEqual(['d', 2]);
  });
});
