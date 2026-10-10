import { describe, expect, test, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

import {
  RowDragArea,
  DraggableRow,
} from '../../components/home/rightpane/rowDrag/RowDragArea';
import { useDragState } from '../../components/home/rightpane/rowDrag/dragContext';
import type { BandGapChange } from '../../components/home/rightpane/rowDrag/dropRules';

// KAN-187. A loose row between two adjacent bands makes each keep its own margin; the list says which band's top gap
// changed and by how much, and the area moves that band and all below by exactly that, on top of the held row's travel.
//
//   a0 0 | [Beta 34, b0 66, Beta:tail 98] | [Gamma 106, g0 138, Gamma:tail 170] | a3 172   (the 8px gap: 98 to 106)

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
  cleanup();
  document.documentElement.removeAttribute('data-dragging');
  vi.restoreAllMocks();
});

const ROW = 32;
const TOPS: Record<string, number> = {
  a0: 0,
  Beta: 34,
  b0: 66,
  'Beta:tail': 98,
  Gamma: 106,
  g0: 138,
  'Gamma:tail': 170,
  a3: 172,
};
const IDS = ['a0', 'b0', 'g0', 'a3'];
const OPENS: BandGapChange[] = [{ bandId: 'Gamma', delta: -4 }];

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

// A fixed row's shift is PUBLISHED by key for the list to apply, so it is read from the drag state, not the DOM.
const FIXED_KEYS = ['Beta', 'Beta:tail', 'Gamma', 'Gamma:tail'] as const;
const Probe = () => {
  const drag = useDragState();
  return (
    <output data-testid="fixed">
      {JSON.stringify(
        Object.fromEntries(FIXED_KEYS.map((k) => [k, drag?.shifts[k] ?? 0]))
      )}
    </output>
  );
};

const Harness = ({ changes }: { changes: BandGapChange[] }) => (
  <RowDragArea
    rowIds={IDS}
    onMove={() => {}}
    fixedRowSelector="[data-fixed-row-id]"
    // As the real list answers: index 1 is Gamma's head with the held row lifted out, the gap between the bands. Without it the landing is INSIDE Gamma.
    landsBesideFixedRow={(_rowId, toIndex) =>
      toIndex === 1
        ? { fixedRowId: 'Gamma', side: 'before' as const }
        : undefined
    }
    gapChangesBy={() => changes}
  >
    <Probe />
    <Row id="a0" />
    <Fixed id="Beta" height={ROW} />
    <Row id="b0" />
    <Fixed id="Beta:tail" height={0} />
    <Fixed id="Gamma" height={ROW} />
    <Row id="g0" />
    <Fixed id="Gamma:tail" height={0} />
    <Row id="a3" />
  </RowDragArea>
);

// The same fixture, but the drop lands INSIDE Gamma at its head (a join).
const HarnessJoining = ({ changes }: { changes: BandGapChange[] }) => (
  <RowDragArea
    rowIds={IDS}
    onMove={() => {}}
    fixedRowSelector="[data-fixed-row-id]"
    landsBesideFixedRow={(_rowId, toIndex) =>
      toIndex === 1
        ? { fixedRowId: 'Gamma', side: 'after' as const }
        : undefined
    }
    gapChangesBy={() => changes}
  >
    <Probe />
    <Row id="a0" />
    <Fixed id="Beta" height={ROW} />
    <Row id="b0" />
    <Fixed id="Beta:tail" height={0} />
    <Fixed id="Gamma" height={ROW} />
    <Row id="g0" />
    <Fixed id="Gamma:tail" height={0} />
    <Row id="a3" />
  </RowDragArea>
);

const node = (id: string): HTMLElement => {
  const el = screen.getByText(`Row ${id}`).parentElement;
  if (!el) throw new Error(`no row ${id}`);
  return el;
};
const translateOf = (el: HTMLElement | null) =>
  Number(
    /translateY\((-?[\d.]+)px\)/.exec(el?.style.transform ?? '')?.[1] ?? 0
  );

// Every commanded shift, rows and fixed rows, plus where the landing slot promises the held row will settle.
const readAll = (held: string) => {
  const out: Record<string, number> = {};
  for (const id of IDS) if (id !== held) out[id] = translateOf(node(id));
  const published: unknown = JSON.parse(
    screen.getByTestId('fixed').textContent ?? 'null'
  );
  for (const key of FIXED_KEYS) {
    const shift: unknown =
      typeof published === 'object' && published !== null
        ? Object.getOwnPropertyDescriptor(published, key)?.value
        : undefined;
    if (typeof shift !== 'number')
      throw new Error(`no shift published for ${key}`);
    out[key] = shift;
  }
  out.__slot =
    translateOf(document.querySelector('[data-drag-landing-slot]')) +
    translateOf(node(held));
  return out;
};

// Holds `held` at y and reports everything, for a given list answer.
const hold = (changes: BandGapChange[], held: string, y: number) => {
  render(<Harness changes={changes} />);
  const from = TOPS[held] + ROW / 2;
  fireEvent.pointerDown(node(held), { clientX: 10, clientY: from, button: 0 });
  fireEvent.pointerMove(document, {
    clientX: 10,
    clientY: from + (y > from ? 8 : -8),
  });
  fireEvent.pointerMove(document, { clientX: 10, clientY: y });
  const seen = readAll(held);
  cleanup();
  document.documentElement.removeAttribute('data-dragging');
  return seen;
};

// Drives a drag on an ALREADY-RENDERED harness.
const holdOn = (held: string, y: number) => {
  const from = TOPS[held] + ROW / 2;
  fireEvent.pointerDown(node(held), { clientX: 10, clientY: from, button: 0 });
  fireEvent.pointerMove(document, {
    clientX: 10,
    clientY: from + (y > from ? 8 : -8),
  });
  fireEvent.pointerMove(document, { clientX: 10, clientY: y });
  return readAll(held);
};

// The gap change ALONE: what the list's answer adds over the same drag without it.
const attributable = (held: string, y: number) => {
  const without = hold([], held, y);
  const withChange = hold(OPENS, held, y);
  const out: Record<string, number> = {};
  for (const key of Object.keys(withChange)) {
    const d = withChange[key] - without[key];
    if (d !== 0) out[key] = d;
  }
  return out;
};

describe('a drop that opens the gap between two bands', () => {
  // a0 held at 120: between the two bands, above the anchor.
  test('moves the anchor band and everything below it, and nothing above', () => {
    expect(attributable('a0', 120)).toEqual({
      Gamma: -4,
      g0: -4,
      'Gamma:tail': -4,
      a3: -4,
    });
  });
});

describe('where the landing sits relative to the anchor', () => {
  // ABOVE the anchor the row settles among unmoved rows. y=120 is also the GAP at the anchor (side 'before'): the band moves away beneath the row.
  test('landing above it leaves the slot alone', () => {
    expect(attributable('a0', 120).__slot).toBeUndefined();
  });

  // BELOW the anchor (past a3's midpoint, 188) the row settles among moved rows. Measured in the popup: the slot was 4px out too.
  test('landing below it moves the slot with them', () => {
    expect(attributable('a0', 195).__slot).toBe(-4);
  });
});

// AT the anchor is two different things with one index: slotLandingBeside gives both the same slot.
describe('landing at the anchor band itself', () => {
  test('INSIDE it at its head, the row goes with it', () => {
    render(<HarnessJoining changes={OPENS} />);
    const withJoin = holdOn('a0', 120);
    cleanup();
    document.documentElement.removeAttribute('data-dragging');
    render(<HarnessJoining changes={[]} />);
    const without = holdOn('a0', 120);
    cleanup();
    document.documentElement.removeAttribute('data-dragging');
    expect(withJoin.__slot - without.__slot).toBe(-4);
  });
});

describe('a refused release changes no gap', () => {
  test('held far outside the list', () => {
    expect(attributable('a0', 600)).toEqual({});
  });
});
