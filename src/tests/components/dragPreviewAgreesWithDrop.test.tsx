import { describe, expect, test, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

import {
  RowDragArea,
  DraggableRow,
} from '../../components/home/rightpane/rowDrag/RowDragArea';

// KAN-158. The preview must show what the release will do.
//
// While dragging, the other rows move aside to open a gap where the held row
// will land. That gap was computed from the pointer against the row midpoints
// alone, so it always named SOME index -- even where the release would be
// refused. Measured in the popup, five windows: held above the pane the gap
// opened at the top, held below or beside it at the bottom, and releasing did
// nothing each time. The drop was right; the preview promised a move that never
// came.
//
// So the preview asks the same question the release does. Where the release
// would be refused, no row moves aside -- the held row's own slot stays open,
// which is the honest picture of "this goes back where it came from".
//
// Read from the rows' transforms, which is what the user sees: a row shifted
// up by the held row's height has been passed going down, and vice versa.

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

afterEach(() => {
  document.documentElement.removeAttribute('data-dragging');
  vi.restoreAllMocks();
});

const PANE_H = 200;
const ROW_H = 30;
const IDS = ['a', 'b', 'c', 'd'];
const HELD = 1; // row b

// Four 30px rows at 0..120 in a pane 0..200 wide 0..200: dead space under the
// rows, and room outside the pane in every direction.
const Harness = ({
  clamp,
  onMove,
}: {
  clamp: boolean;
  onMove: (id: string, to: number) => void;
}) => (
  <div
    style={{ overflowY: 'auto' }}
    ref={(el) => {
      if (el) el.getBoundingClientRect = () => box(0, PANE_H);
    }}
  >
    <RowDragArea
      rowIds={IDS}
      onMove={onMove}
      dragKind="window"
      clampDropToEnds={clamp}
    >
      {IDS.map((id, i) => (
        <DraggableRow key={id} rowId={id} index={i}>
          <div
            ref={(el) => {
              if (el?.parentElement)
                el.parentElement.getBoundingClientRect = () =>
                  box(i * ROW_H, ROW_H);
            }}
          >
            Row {id}
          </div>
        </DraggableRow>
      ))}
    </RowDragArea>
  </div>
);

const rowNode = (id: string) => screen.getByText(`Row ${id}`).parentElement!;

const shift = (id: string) =>
  Number(
    /translateY\((-?[\d.]+)px\)/.exec(rowNode(id).style.transform)?.[1] ?? 0
  );

// What the preview is showing, as an index: the held row's own slot, moved by
// every row that has stepped aside for it.
const previewIndex = () => {
  const others = IDS.filter((_, i) => i !== HELD);
  const up = others.filter((id) => shift(id) < 0).length;
  const down = others.filter((id) => shift(id) > 0).length;
  return HELD + up - down;
};

const othersShifted = () =>
  IDS.filter((_, i) => i !== HELD).filter((id) => shift(id) !== 0);

// Picks up row b, holds it at (x, y), and reports what the preview showed
// there and what releasing there did.
const holdAt = (clamp: boolean, x: number, y: number) => {
  const onMove = vi.fn();
  render(<Harness clamp={clamp} onMove={onMove} />);
  fireEvent.pointerDown(rowNode('b'), { clientX: 10, clientY: 45, button: 0 });
  fireEvent.pointerMove(document, { clientX: 10, clientY: 55 });
  fireEvent.pointerMove(document, { clientX: x, clientY: y });
  const shown = { index: previewIndex(), shifted: othersShifted() };
  fireEvent.pointerUp(document, { clientX: x, clientY: y });
  const landed: number | undefined = onMove.mock.calls[0]?.[1];
  cleanup();
  document.documentElement.removeAttribute('data-dragging');
  return { shown, landed };
};

describe('where the release will be refused, no gap opens', () => {
  test('held above the pane', () => {
    const { shown, landed } = holdAt(true, 10, -40);
    expect(landed).toBeUndefined();
    expect(shown.shifted).toEqual([]);
  });

  test('held below the pane', () => {
    const { shown, landed } = holdAt(true, 10, PANE_H + 40);
    expect(landed).toBeUndefined();
    expect(shown.shifted).toEqual([]);
  });

  // Beside the pane AND below the rows. Level with the rows a release lands
  // whatever its x -- isInsideList is vertical only, deliberately, since nobody
  // drags perfectly straight -- and there preview and drop already agree.
  test('held beside the pane, below the rows', () => {
    const { shown, landed } = holdAt(true, 260, 190);
    expect(landed).toBeUndefined();
    expect(shown.shifted).toEqual([]);
  });

  // A list that has NOT opted into the pane -- a tab list. Its dead space is
  // "dragged out of this window", which is refused (KAN-132), so it must not
  // preview a landing at the end of the window either.
  test('a list without the opt-in, held in the dead space under its rows', () => {
    const { shown, landed } = holdAt(false, 10, 190);
    expect(landed).toBeUndefined();
    expect(shown.shifted).toEqual([]);
  });
});

describe('CONTROLS: where the release will land, the gap still opens', () => {
  // Without these, a preview that never moved anything would pass every test
  // above -- and would break the feature outright.
  test('held among the rows, the gap is where it lands', () => {
    // 100 is past a (15), c (75) but not d (105): index 2.
    const { shown, landed } = holdAt(true, 10, 100);
    expect(landed).toBe(2);
    expect(shown.index).toBe(2);
  });

  test('held in the pane dead space with the opt-in, the gap opens at the end', () => {
    const { shown, landed } = holdAt(true, 10, 190);
    expect(landed).toBe(3);
    expect(shown.index).toBe(3);
  });
});

// THE CONTRACT, everywhere rather than at a few chosen points: at every place
// the row can be held, the preview shows exactly what releasing there does.
describe('the preview and the release agree at every position', () => {
  const positions: [number, number][] = [];
  for (let y = -60; y <= PANE_H + 60; y += 5) positions.push([10, y]);
  for (let y = 0; y <= PANE_H; y += 40) positions.push([260, y]);

  test.each([true, false])('clampDropToEnds=%s', (clamp) => {
    const disagreements: string[] = [];
    let landedSomewhere = 0;
    let refusedSomewhere = 0;
    for (const [x, y] of positions) {
      const { shown, landed } = holdAt(clamp, x, y);
      if (landed === undefined) {
        refusedSomewhere++;
        if (shown.shifted.length > 0)
          disagreements.push(`(${x},${y}) refused, but rows moved aside`);
      } else {
        landedSomewhere++;
        if (shown.index !== landed)
          disagreements.push(
            `(${x},${y}) previewed ${shown.index}, landed ${landed}`
          );
      }
    }
    // The sweep has to cover BOTH outcomes, or agreement is vacuous.
    expect(landedSomewhere).toBeGreaterThan(0);
    expect(refusedSomewhere).toBeGreaterThan(0);
    expect(disagreements).toEqual([]);
  });
});
