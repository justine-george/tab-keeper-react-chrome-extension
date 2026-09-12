import { describe, expect, test, afterEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import {
  RowDragArea,
  DraggableRow,
} from '../../components/home/rightpane/rowDrag/RowDragArea';
import { setDragging } from '../../components/home/rightpane/rowDrag/dropRules';

// KAN-153. Dragging a window folds every window shut, so a session of three
// windows and sixty tabs fits on screen while it is being rearranged, and
// unfolds them exactly as they were on release.
//
// NO STATE IS LIFTED AND NOTHING IS RESTORED. The collapse is a CSS rule keyed
// on the drag kind, so each window's own open/closed state is never touched --
// which is what makes "and it comes back how it was" require no bookkeeping at
// all, and what makes it impossible to leave a window collapsed if a drag ends
// in some way nobody anticipated.
//
// jsdom applies no stylesheet from App.css and resolves no cascade, so the
// collapse itself cannot be observed here. What IS pinned is the two halves
// that make it work: the rule exists and is scoped to a window drag, and the
// attribute is published BEFORE the rows are measured. The visual result is a
// browser claim and is checked there.

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

afterEach(() => {
  document.documentElement.removeAttribute('data-dragging');
  vi.restoreAllMocks();
});

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

  // Every existing rule is written `[data-dragging]` with no value, and an
  // attribute selector matches whatever the value is -- so publishing a kind
  // must not have quietly stopped the grabbing cursor or the hidden row actions
  // matching. The rules themselves are asserted in dragStyles.test.ts, which
  // runs in the project that can read CSS text.
  test('CONTROL: a kinded attribute still matches the valueless selector', () => {
    setDragging(true, 'window');
    expect(document.documentElement.matches('[data-dragging]')).toBe(true);
  });
});

describe('the collapse happens before the rows are measured', () => {
  // THE ORDERING BUG THIS EXISTS TO PREVENT. Collapsing changes every row's
  // height. The attribute is written straight to the DOM, so the
  // getBoundingClientRect calls that follow flush style and layout and read the
  // COLLAPSED boxes -- but only if the attribute is set FIRST. Measure first and
  // every midpoint describes a layout that no longer exists, and every drop
  // lands somewhere the user never pointed.
  //
  // Asserted by recording what the document looked like at the moment each row
  // was measured, which is the only way to see an ordering from outside.
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
      const el = screen.getByText(label).parentElement!;
      el.getBoundingClientRect = () => {
        seenAtMeasure.push(
          document.documentElement.getAttribute('data-dragging')
        );
        return box(i * 30, 30);
      };
    });

    fireEvent.pointerDown(screen.getByText('Row A').parentElement!, {
      clientX: 10,
      clientY: 5,
      button: 0,
    });
    fireEvent.pointerMove(document, { clientX: 10, clientY: 20 });

    expect(seenAtMeasure.length).toBeGreaterThan(0);
    expect(seenAtMeasure.every((v) => v === 'window')).toBe(true);
  });
});

// KAN-154. The collapse can make the list SHORTER THAN ITS VIEWPORT, and the
// browser then clamps scrollTop to fit. Measured in the popup on a five-window
// session scrolled to the bottom: content 820 -> 416 (exactly the viewport) and
// scrollTop 404 -> 0.
//
// The scroll origin captured at pointer-down then describes a position that no
// longer exists, and everything derived from it is out by that much: the held
// row was translated 316px up, landing at y=-31 against a pane starting at 124
// -- off screen -- and the drop was computed against a list nobody was pointing
// at, so it committed nothing. Only windows reachable at scrollTop 0 could be
// dragged, which is exactly how it was reported.
//
// jsdom neither collapses nor clamps, so both are simulated here: scrollHeight
// shrinks once the window-drag flag is set, and scrollTop clamps the way a real
// scroller does.
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
      // Clamped on READ as well as on write, which is what a real scroller
      // does: when the content shrinks below the viewport the browser re-clamps
      // at layout rather than waiting to be written to. Clamping only on write
      // made this test disagree with the popup, and the popup was right.
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

    const scroller = container.firstElementChild as HTMLElement;
    const { rowH } = mountClampingScroller(scroller);
    ['a', 'b', 'c', 'd'].forEach((id, i) => {
      const row = screen.getByText(`Row ${id}`).parentElement!;
      row.getBoundingClientRect = () =>
        box(i * rowH() - scroller.scrollTop, rowH());
    });

    // Scrolled to the bottom of the EXPANDED list, which is the only way to
    // reach the last row -- and the state the report came from.
    scroller.scrollTop = 999;
    expect(scroller.scrollTop).toBe(OPEN_H * 4 - VIEW);

    const held = screen.getByText('Row d').parentElement!;
    fireEvent.pointerDown(held, { clientX: 10, clientY: 65, button: 0 });
    fireEvent.pointerMove(document, { clientX: 10, clientY: 20 });
    fireEvent.pointerUp(document, { clientX: 10, clientY: 20 });

    // Collapsed, the four rows span 0..60 inside a 90px viewport, so the
    // browser has clamped the scroll to 0 and the content mids are 7.5, 22.5,
    // 37.5, 52.5. Releasing at 20 is past only the first of the others.
    expect(onMove).toHaveBeenCalledTimes(1);
    expect(onMove.mock.calls[0][1]).toBe(1);
  });
});

// KAN-156. THE SAME ORDERING RULE AT THE OTHER END OF THE DRAG. The rows were
// measured in the collapsed layout, so the drop must be judged in it too --
// before the drag kind is unpublished, not after.
//
// Unpublishing expands every window again, and reading scrollTop then forces
// that layout. Measured in the popup on a twenty-window session, where the
// FOLDED list still overflows so the scroll never reaches 0: scrollTop 1200
// before the drag, 385 while folded, and read straight after unpublishing,
// 1200 again -- the browser re-anchored the expanded list. Judged against that,
// a window released mid-pane (around index 14) landed LAST.
//
// Every five-window probe missed it, because each one folded to scrollTop 0,
// where there is nothing to re-anchor: "the folded list fits" is the new
// "started from scrollTop 0". This fake reproduces the measured sequence,
// nothing more: folded it reads the clamped offset, expanded it reads its
// expanded one.
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

    const scroller = container.firstElementChild as HTMLElement;
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
      screen.getByText(`Row ${id}`).parentElement!.getBoundingClientRect = () =>
        box(i * rowH() - scroller.scrollTop, rowH());
    });

    // Expanded: 180 of content in a 90 view, scrolled to the bottom.
    scroller.scrollTop = 90;
    // Row d's expanded box is content 90..120, so viewport 0..30.
    const held = screen.getByText('Row d').parentElement!;
    fireEvent.pointerDown(held, { clientX: 10, clientY: 15, button: 0 });
    fireEvent.pointerMove(document, { clientX: 10, clientY: 25 });

    // Folded: 120 of content, so the scroll clamps to 30 -- NOT to 0, which is
    // the whole point of this test.
    expect(scroller.scrollTop).toBe(30);

    fireEvent.pointerMove(document, { clientX: 10, clientY: 5 });
    fireEvent.pointerUp(document, { clientX: 10, clientY: 5 });

    // Folded content mids are 10, 30, 50, 70, 90, 110. Released at viewport 5
    // with the folded scroll of 30 is content 35: past a and b, so index 2.
    // Judged after unfolding it reads 5 + 90 = 95, past a, b, c and e -- 4.
    expect(onMove).toHaveBeenCalledTimes(1);
    expect(onMove.mock.calls[0].slice(0, 2)).toEqual(['d', 2]);
  });
});
