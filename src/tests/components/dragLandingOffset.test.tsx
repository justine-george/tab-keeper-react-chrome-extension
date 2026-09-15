import { describe, expect, test, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

import {
  RowDragArea,
  DraggableRow,
} from '../../components/home/rightpane/rowDrag/RowDragArea';

// KAN-167. When the list says the row settles some way off the slot its
// answer resolves to, the landing slot is drawn there -- and only the landing
// slot: the rows stepping aside are governed by the shifts, which are exact.
//
//   a0 0, a1 32, [G title 66, g0 98, g1 130, G:tail 162], a3 164

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
  a1: 32,
  G: 66,
  g0: 98,
  g1: 130,
  'G:tail': 162,
  a3: 164,
};
const IDS = ['a0', 'a1', 'g0', 'g1', 'a3'];

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

// g0 leaving upward lands before the title row; the list says it settles
// `offset` px from there (undefined: exactly there).
const Harness = ({ offset }: { offset: number | undefined }) => (
  <RowDragArea
    rowIds={IDS}
    onMove={() => {}}
    fixedRowSelector="[data-fixed-row-id]"
    landsBesideFixedRow={(rowId, toIndex, target) =>
      rowId === 'g0' && toIndex === 2 && target === undefined
        ? { fixedRowId: 'G', side: 'before', offset }
        : undefined
    }
  >
    <Row id="a0" />
    <Row id="a1" />
    <Fixed id="G" height={ROW} />
    <Row id="g0" />
    <Row id="g1" />
    <Fixed id="G:tail" height={0} />
    <Row id="a3" />
  </RowDragArea>
);

const node = (id: string) => screen.getByText(`Row ${id}`).parentElement!;
const translateOf = (el: HTMLElement | null) =>
  Number(
    /translateY\((-?[\d.]+)px\)/.exec(el?.style.transform ?? '')?.[1] ?? 0
  );
const shift = (id: string) => translateOf(node(id));
const landingDelta = () =>
  translateOf(document.querySelector('[data-drag-landing-slot]')) + shift('g0');

const hold = (offset: number | undefined) => {
  render(<Harness offset={offset} />);
  fireEvent.pointerDown(node('g0'), { clientX: 10, clientY: 114, button: 0 });
  fireEvent.pointerMove(document, { clientX: 10, clientY: 124 });
  // y = 60: above the band, in a1's lower half. Index 2, its own.
  fireEvent.pointerMove(document, { clientX: 10, clientY: 60 });
};

describe('the landing slot honours the offset the list names', () => {
  test('a negative offset draws the slot that much higher than the title row', () => {
    hold(-2);
    expect(landingDelta()).toBe(TOPS.G - TOPS.g0 - 2);
  });

  test('the rows stepping aside are untouched by it', () => {
    hold(-2);
    expect(shift('a1')).toBe(0);
    expect(shift('g1')).toBe(0);
    expect(shift('a3')).toBe(0);
  });

  test('CONTROL: no offset, the slot is the title row’s top', () => {
    hold(undefined);
    expect(landingDelta()).toBe(TOPS.G - TOPS.g0);
  });
});
