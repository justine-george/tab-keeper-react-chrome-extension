import { describe, expect, test, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

import {
  RowDragArea,
  DraggableRow,
} from '../../components/home/rightpane/rowDrag/RowDragArea';
import { useDragState } from '../../components/home/rightpane/rowDrag/dragContext';
import type { BandGapChange } from '../../components/home/rightpane/rowDrag/dropRules';

// KAN-187. Two adjacent bands share one wide gap; a loose row between them
// makes each keep its own margin instead. The list says which band's top gap
// changed and by how much; the area moves that band and everything below it
// by exactly that, ON TOP OF the held row's own travel.
//
//   a0 0 | [Beta 34, b0 66, Beta:tail 98] | [Gamma 106, g0 138, Gamma:tail 170] | a3 172
//
// Beta's band ends at 98 and Gamma's begins at 106: the 8px adjacent gap.

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

// A fixed row is never transformed by the area: its shift is PUBLISHED by key
// and the list applies it (GroupFrameFollower does, in the app). So they are
// read from the drag state, not from the DOM.
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
    // As the real list answers it: landing index 1 is Gamma's head with the
    // held row lifted out, i.e. the gap between the two bands. Without this
    // the landing resolves to g0's slot -- INSIDE Gamma -- and the fixture
    // cannot express the case at all.
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

// The same fixture, but the list says the drop lands INSIDE Gamma at its head
// (a join) rather than in the gap above it.
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

const node = (id: string) => screen.getByText(`Row ${id}`).parentElement!;
const translateOf = (el: HTMLElement | null) =>
  Number(
    /translateY\((-?[\d.]+)px\)/.exec(el?.style.transform ?? '')?.[1] ?? 0
  );

// Every commanded shift, rows and fixed rows alike, plus where the landing
// slot promises the held row will settle.
const readAll = (held: string) => {
  const out: Record<string, number> = {};
  for (const id of IDS) if (id !== held) out[id] = translateOf(node(id));
  const published = JSON.parse(
    screen.getByTestId('fixed').textContent!
  ) as Record<string, number>;
  for (const key of FIXED_KEYS) out[key] = published[key];
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

// The gap change ALONE: what the list's answer adds on top of the held row's
// own travel, which is what the same drag without it already shows.
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
  // a0 held at 120: inside Gamma's band region, above g0's midpoint -- the
  // landing sits between the two bands, above the anchor.
  test('moves the anchor band and everything below it, and nothing above', () => {
    expect(attributable('a0', 120)).toEqual({
      Gamma: -4,
      g0: -4,
      'Gamma:tail': -4,
      a3: -4,
    });
  });

  test('the bands above the change do not move', () => {
    const seen = attributable('a0', 120);
    expect(seen.Beta).toBeUndefined();
    expect(seen.b0).toBeUndefined();
    expect(seen['Beta:tail']).toBeUndefined();
  });
});

describe('where the landing sits relative to the anchor', () => {
  // Landing ABOVE the anchor: the held row settles among rows that have not
  // moved, so its own slot is untouched by the gap change.
  test('landing above it leaves the slot alone', () => {
    expect(attributable('a0', 120).__slot).toBeUndefined();
  });

  // Landing BELOW the anchor (past a3's midpoint at 188): the row settles
  // among rows the gap change has moved, so the slot moves with them.
  // Measured in the popup: the held row's promised slot was 4px out too.
  test('landing below it moves the slot with them', () => {
    expect(attributable('a0', 195).__slot).toBe(-4);
  });
});

// Landing AT the anchor is two different things, and the index cannot tell
// them apart -- slotLandingBeside gives both the same slot.
describe('landing at the anchor band itself', () => {
  test('in the GAP above it, the band moves away beneath the row', () => {
    // side 'before' -- the row takes the band's old place.
    expect(attributable('a0', 120).__slot).toBeUndefined();
  });

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
