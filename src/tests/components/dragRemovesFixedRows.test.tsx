import { describe, expect, test, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

import {
  RowDragArea,
  DraggableRow,
} from '../../components/home/rightpane/rowDrag/RowDragArea';
import { useDragState } from '../../components/home/rightpane/rowDrag/dragContext';
import type { RemovedFixedRows } from '../../components/home/rightpane/rowDrag/dropRules';

// KAN-169. When the list says a drop REMOVES a span of fixed rows, the area has
// to preview the removal: every slot below the span closes up by the room the
// span gives back, the landing slot moves with them when it lands below, and
// the removed rows are published so the list can stop drawing them.
//
// The layout is the ticket's own, in jsdom: two loose rows, a one-member group
// -- title row, member, zero-height tail marker -- and two loose rows under
// it. Measured in the popup the band's chrome is 36px (title row 32 plus 2px
// of margin either side), and that is what the rows below moved when the drop
// was seeded directly.

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
  cleanup();
  document.documentElement.removeAttribute('data-dragging');
  vi.restoreAllMocks();
});

const ROW = 32;
// a0 0, a1 32, [G title 66, s0 98, G:tail 130], a3 132, a4 164.
const TOPS: Record<string, number> = {
  a0: 0,
  a1: 32,
  G: 66,
  s0: 98,
  'G:tail': 130,
  a3: 132,
  a4: 164,
};
const IDS = ['a0', 'a1', 's0', 'a3', 'a4'];
const REMOVES_G: RemovedFixedRows = { first: 'G', last: 'G:tail', gapKept: 0 };

// What the area publishes for the parts of the list it does not draw: the
// removed keys, and the title row's shift (the list, not the area, applies a
// fixed row's shift -- see GroupFrameFollower).
const Probe = () => {
  const drag = useDragState();
  return (
    <>
      <output data-testid="removed">{drag?.removedFixedRows.join(',')}</output>
      <output data-testid="shiftG">{drag?.shifts.G ?? 0}</output>
    </>
  );
};

const Row = ({ id }: { id: string }) => (
  <DraggableRow rowId={id}>
    <div
      ref={(el) => {
        if (el?.parentElement)
          el.parentElement.getBoundingClientRect = () => box(TOPS[id], ROW);
      }}
    >
      Row {id}
    </div>
  </DraggableRow>
);

const Fixed = ({ id, height }: { id: string; height: number }) => (
  <div
    data-fixed-row-id={id}
    ref={(el) => {
      if (el) el.getBoundingClientRect = () => box(TOPS[id], height);
    }}
  >
    {id}
  </div>
);

const Harness = ({ removes }: { removes: RemovedFixedRows | undefined }) => (
  <RowDragArea
    rowIds={IDS}
    onMove={() => {}}
    fixedRowSelector="[data-fixed-row-id]"
    // s0 leaving upward lands before its title row (KAN-168); everything else
    // is described by the index alone.
    landsBesideFixedRow={(rowId, toIndex, target) =>
      rowId === 's0' && toIndex === 2 && target === undefined
        ? { fixedRowId: 'G', side: 'before' }
        : undefined
    }
    fixedRowsRemovedBy={(rowId) => (rowId === 's0' ? removes : undefined)}
  >
    <Probe />
    <Row id="a0" />
    <Row id="a1" />
    <Fixed id="G" height={ROW} />
    <Row id="s0" />
    <Fixed id="G:tail" height={0} />
    <Row id="a3" />
    <Row id="a4" />
  </RowDragArea>
);

const node = (id: string) => screen.getByText(`Row ${id}`).parentElement!;
const translateOf = (el: HTMLElement | null) =>
  Number(
    /translateY\((-?[\d.]+)px\)/.exec(el?.style.transform ?? '')?.[1] ?? 0
  );
const shift = (id: string) => translateOf(node(id));

// Where the landing slot promises the held row will settle, as a delta from
// its own top: the slot counter-transforms out of the held row's translate.
const landingDelta = () => {
  const slot = document.querySelector<HTMLElement>('[data-drag-landing-slot]');
  return translateOf(slot) + shift('s0');
};

const hold = (removes: RemovedFixedRows | undefined, y: number) => {
  render(<Harness removes={removes} />);
  fireEvent.pointerDown(node('s0'), { clientX: 10, clientY: 114, button: 0 });
  fireEvent.pointerMove(document, { clientX: 10, clientY: 124 });
  fireEvent.pointerMove(document, { clientX: 10, clientY: y });
};

describe('a drop that removes the group: the last member leaving upward', () => {
  // y = 60: above the band, in a1's lower half. Index 2 -- its own -- and the
  // list names the title row, so the slot is the title row's top.
  test('the rows below the band close up by the band’s chrome', () => {
    hold(REMOVES_G, 60);
    expect(shift('a3')).toBe(-36);
    expect(shift('a4')).toBe(-36);
  });

  test('the rows above it and the members-to-be do not move', () => {
    hold(REMOVES_G, 60);
    expect(shift('a0')).toBe(0);
    expect(shift('a1')).toBe(0);
  });

  test('the landing slot is where the title row stood, unchanged by the removal', () => {
    hold(REMOVES_G, 60);
    expect(landingDelta()).toBe(TOPS.G - TOPS.s0);
  });

  test('the removed rows are published by key', () => {
    hold(REMOVES_G, 60);
    expect(screen.getByTestId('removed').textContent).toBe('G,G:tail');
  });

  test('CONTROL: the same drag with no removal previews the group surviving', () => {
    hold(undefined, 60);
    expect(shift('a3')).toBe(0);
    expect(shift('a4')).toBe(0);
    expect(screen.getByTestId('shiftG').textContent).toBe(String(ROW));
    expect(screen.getByTestId('removed').textContent).toBe('');
  });
});

describe('a drop that removes the group: the last member leaving downward', () => {
  // y = 150: past a3's midpoint (148). Index 3, landing on a3's slot.
  test('a3 closes up by the held row AND the band; a4 by the band alone', () => {
    hold(REMOVES_G, 150);
    expect(shift('a3')).toBe(-ROW - 36);
    expect(shift('a4')).toBe(-36);
  });

  test('the landing slot follows the rows it lands among', () => {
    hold(REMOVES_G, 150);
    // On a3's top, which has itself come up by the band's chrome.
    expect(landingDelta()).toBe(TOPS.a3 - TOPS.s0 - 36);
  });

  test('CONTROL: without the removal only the passed row steps aside', () => {
    hold(undefined, 150);
    expect(shift('a3')).toBe(-ROW);
    expect(shift('a4')).toBe(0);
    expect(landingDelta()).toBe(TOPS.a3 - TOPS.s0);
  });
});

describe('the gap the list names is honoured', () => {
  test('a wider gap left frees less', () => {
    hold({ ...REMOVES_G, gapKept: 4 }, 60);
    expect(shift('a3')).toBe(-32);
  });
});

describe('a refused release removes nothing', () => {
  test('held far outside the list, the rows below stay where they are', () => {
    // Below every row and outside the list's slack: refused (no pane opt-in).
    hold(REMOVES_G, 400);
    expect(shift('a3')).toBe(0);
    expect(screen.getByTestId('removed').textContent).toBe('');
  });
});
