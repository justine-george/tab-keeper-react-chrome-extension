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
  test.each(['tab', 'window', 'session'] as const)('says %s', (kind) => {
    setDragging(true, kind);
    expect(document.documentElement.getAttribute('data-dragging')).toBe(kind);
  });

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
        <DraggableRow rowId="a" index={0}>
          <div>Row A</div>
        </DraggableRow>
        <DraggableRow rowId="b" index={1}>
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
