import { describe, expect, test, afterEach, vi } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';

import {
  RowDragArea,
  DraggableRow,
} from '../../components/home/rightpane/rowDrag/RowDragArea';
import type { RowDragAreaProps } from '../../components/home/rightpane/rowDrag/dropRules';

// KAN-280 Part E, Task 5. Two opt-in limits on the drag engine, for a list
// whose drops move real Chrome tabs: Chrome clamps some drops (the pinned run)
// and refuses others (a pinned tab across windows, normal <-> incognito), so
// the preview must never promise a landing the release will not make.
//
// - `landingRange` clamps the landing index, in the preview AND the release.
// - `acceptsWindow` refuses a window outright: the release there is treated
//   exactly like one outside the list -- nothing steps aside, and nothing moves.
//
// Saved lists pass neither, and every CONTROL below is the old behaviour.
//
// The harness is two windows, one above the other, in one list, as a pane-wide tab list
// draws them. jsdom has no layout, so every row and window block gets a box:
//
//   wA block  0..80    a0 10..30   a1 30..50   a2 50..70
//   (gap      80..88)
//   wB block  88..168  b0 98..118  b1 118..138 b2 138..158

type Limits = Pick<
  RowDragAreaProps,
  'landingRange' | 'acceptsWindow' | 'resolveDrop' | 'onDropTargetChange'
>;

const ROW_H = 20;
const WINDOWS: readonly { id: string; top: number; rows: string[] }[] = [
  { id: 'wA', top: 0, rows: ['a0', 'a1', 'a2'] },
  { id: 'wB', top: 88, rows: ['b0', 'b1', 'b2'] },
];
const BLOCK_H = 80;
const ALL = WINDOWS.flatMap((w) => w.rows);

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

const topOf = (rowId: string): number => {
  for (const w of WINDOWS) {
    const i = w.rows.indexOf(rowId);
    if (i >= 0) return w.top + 10 + i * ROW_H;
  }
  throw new Error(`no row ${rowId}`);
};

const find = (root: ParentNode, selector: string): HTMLElement => {
  const el = root.querySelector<HTMLElement>(selector);
  if (!el) throw new Error(`nothing matches ${selector}`);
  return el;
};

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute('data-dragging');
  vi.restoreAllMocks();
});

const renderWindows = (limits: Limits, onMove: RowDragAreaProps['onMove']) => {
  const { container } = render(
    <RowDragArea rowIds={ALL} onMove={onMove} dropsAcrossWindows {...limits}>
      {WINDOWS.map((w) => (
        <div key={w.id} data-drop-window-id={w.id}>
          {w.rows.map((id) => (
            <DraggableRow key={id} rowId={id}>
              <div>Row {id}</div>
            </DraggableRow>
          ))}
        </div>
      ))}
    </RowDragArea>
  );
  for (const w of WINDOWS) {
    find(container, `[data-drop-window-id="${w.id}"]`).getBoundingClientRect =
      () => box(w.top, BLOCK_H);
    for (const id of w.rows) {
      find(container, `[data-drag-row-id="${id}"]`).getBoundingClientRect =
        () => box(topOf(id), ROW_H);
    }
  }
  return container;
};

const translateOf = (el: HTMLElement): number =>
  Number(/translateY\((-?[\d.]+)px\)/.exec(el.style.transform)?.[1] ?? 0);

interface Preview {
  // Every row that stepped aside, by how much.
  shifted: Record<string, number>;
  // Where the landing slot is drawn, in the list's own coordinates: the held
  // row's resting top, plus its wrapper's translate, plus the slot's own.
  slotTop: number;
}

const previewOf = (container: HTMLElement, held: string): Preview => {
  const shifted: Record<string, number> = {};
  for (const id of ALL) {
    if (id === held) continue;
    const shift = translateOf(find(container, `[data-drag-row-id="${id}"]`));
    if (shift !== 0) shifted[id] = shift;
  }
  const wrapper = find(container, `[data-drag-row-id="${held}"]`);
  const slot = find(wrapper, '[data-drag-landing-slot]');
  return {
    shifted,
    slotTop: topOf(held) + translateOf(wrapper) + translateOf(slot),
  };
};

// Picks `held` up at its middle, activates, holds it at y, reads the preview,
// then releases there and reports what onMove was called with.
const holdAndRelease = (limits: Limits, held: string, y: number) => {
  const onMove = vi.fn();
  const container = renderWindows(limits, onMove);
  const mid = topOf(held) + ROW_H / 2;
  const row = find(container, `[data-drag-row-id="${held}"]`);
  fireEvent.pointerDown(row, { clientX: 10, clientY: mid, button: 0 });
  fireEvent.pointerMove(document, { clientX: 10, clientY: mid + 8 });
  fireEvent.pointerMove(document, { clientX: 10, clientY: y });
  const preview = previewOf(container, held);
  fireEvent.pointerUp(document, { clientX: 10, clientY: y });
  const released = onMove.mock.calls;
  cleanup();
  document.documentElement.removeAttribute('data-dragging');
  return { preview, released };
};

describe('landingRange clamps the landing, in the preview and the release', () => {
  // a2 held just above a0's midpoint: unclamped, it lands first in wA.
  test('CONTROL: without the prop, a2 held at the top of wA lands at 0', () => {
    const { preview, released } = holdAndRelease({}, 'a2', 12);
    expect(preview.shifted).toEqual({ a0: ROW_H, a1: ROW_H });
    expect(preview.slotTop).toBe(topOf('a0'));
    expect(released).toEqual([['a2', 0, undefined, 'wA']]);
  });

  test('clamped to 1..2, the same hold previews and lands at 1', () => {
    const landingRange = vi.fn(() => ({ min: 1, max: 2 }));
    const { preview, released } = holdAndRelease({ landingRange }, 'a2', 12);
    expect(preview.shifted).toEqual({ a1: ROW_H });
    expect(preview.slotTop).toBe(topOf('a1'));
    expect(released).toEqual([['a2', 1, undefined, 'wA']]);
    expect(landingRange).toHaveBeenCalledWith('a2', 'wA');
  });

  // Across windows: a1 held past wB's last row. Unclamped, it lands last.
  test('CONTROL: without the prop, a1 held past wB’s rows lands last in wB', () => {
    const { preview, released } = holdAndRelease({}, 'a1', 155);
    // wA closes up behind it; nothing in wB steps aside, because the slot is
    // the window's end (KAN-182).
    expect(preview.shifted).toEqual({ a2: -ROW_H });
    expect(preview.slotTop).toBe(WINDOWS[1].top + BLOCK_H);
    expect(released).toEqual([['a1', 3, undefined, 'wB']]);
  });

  test('clamped per window, the same hold previews and lands inside the range', () => {
    const landingRange = (_rowId: string, windowId: string | undefined) =>
      windowId === 'wB' ? { min: 0, max: 1 } : { min: 0, max: 2 };
    const { preview, released } = holdAndRelease({ landingRange }, 'a1', 155);
    expect(preview.shifted).toEqual({ a2: -ROW_H, b1: ROW_H, b2: ROW_H });
    expect(preview.slotTop).toBe(topOf('b1'));
    expect(released).toEqual([['a1', 1, undefined, 'wB']]);
  });

  // Off the happy path: a range that contains no index at all is a window
  // nothing can land in, not a clamp to one of its ends.
  test('an empty range refuses the drop: nothing steps aside, nothing moves', () => {
    const landingRange = () => ({ min: 2, max: 1 });
    const { preview, released } = holdAndRelease({ landingRange }, 'a2', 12);
    expect(preview.shifted).toEqual({});
    expect(preview.slotTop).toBe(topOf('a2'));
    expect(released).toEqual([]);
  });
});

describe('acceptsWindow false is a release outside the list', () => {
  const refusesB = (_rowId: string, windowId: string) => windowId !== 'wB';

  test('CONTROL: without the prop, a1 held over b1 lands in wB at 1', () => {
    const { preview, released } = holdAndRelease({}, 'a1', 125);
    expect(preview.shifted).toEqual({ a2: -ROW_H, b1: ROW_H, b2: ROW_H });
    expect(preview.slotTop).toBe(topOf('b1'));
    expect(released).toEqual([['a1', 1, undefined, 'wB']]);
  });

  test('refused: no row steps aside, the slot stays on the origin, and the release moves nothing', () => {
    const acceptsWindow = vi.fn(refusesB);
    const { preview, released } = holdAndRelease({ acceptsWindow }, 'a1', 125);
    expect(preview.shifted).toEqual({});
    expect(preview.slotTop).toBe(topOf('a1'));
    expect(released).toEqual([]);
    expect(acceptsWindow).toHaveBeenCalledWith('a1', 'wB');
  });

  // The gap between two windows belongs to the nearer one (KAN-185). 85 is
  // nearer wB, so the refusal holds there too -- it does not fall back to
  // landing at the end of the row's own window.
  test('refused in the gap nearer the refusing window, too', () => {
    const control = holdAndRelease({}, 'a1', 85);
    expect(control.released).toEqual([['a1', 0, undefined, 'wB']]);

    const { preview, released } = holdAndRelease(
      { acceptsWindow: refusesB },
      'a1',
      85
    );
    expect(preview.shifted).toEqual({});
    expect(released).toEqual([]);
  });

  test('the row’s own window, which accepts, still takes the drop', () => {
    const { preview, released } = holdAndRelease(
      { acceptsWindow: refusesB },
      'a1',
      65
    );
    expect(preview.shifted).toEqual({ a2: -ROW_H });
    expect(released).toEqual([['a1', 2, undefined, 'wA']]);
  });

  // A band in a refused window must not light up as a target either: outside
  // the list, resolveDrop is asked about the held row's own window.
  test('a band in the refused window is never marked as the target', () => {
    const resolveDrop: RowDragAreaProps['resolveDrop'] = (within) => ({
      bandId: within?.dataset.dropWindowId === 'wB' ? 'band-in-wB' : undefined,
    });
    const control = vi.fn();
    holdAndRelease({ resolveDrop, onDropTargetChange: control }, 'a1', 125);
    expect(control.mock.calls.map((c) => c[0])).toContain('band-in-wB');

    const refused = vi.fn();
    holdAndRelease(
      { resolveDrop, onDropTargetChange: refused, acceptsWindow: refusesB },
      'a1',
      125
    );
    expect(refused.mock.calls.map((c) => c[0])).not.toContain('band-in-wB');
  });
});

// The KAN-158 contract, with the limits on: at every place the row can be
// held, the preview shows exactly what releasing there does.
describe('with the limits on, the preview and the release agree at every position', () => {
  // Where a landing at (window, index) draws its slot: in front of that
  // window's index-th row counted with the held one IN, or at the window's
  // end past its last row.
  // (Every row here is the same height, so "in front of" needs no correction
  // for the direction the held row travels.)
  const expectedSlotTop = (windowId: string, index: number) => {
    const w = WINDOWS.find((x) => x.id === windowId);
    if (!w) throw new Error(`no window ${windowId}`);
    const row = w.rows[index];
    return row === undefined ? w.top + BLOCK_H : topOf(row);
  };

  const clampedToOneOrTwo = () => ({ min: 1, max: 2 });
  const cases: [string, Limits][] = [
    ['clamped to 1..2 in both windows', { landingRange: clampedToOneOrTwo }],
    [
      'clamped to 1..2, and wB refused',
      {
        landingRange: clampedToOneOrTwo,
        acceptsWindow: (_rowId, windowId) => windowId !== 'wB',
      },
    ],
  ];

  test.each(cases)('%s', (_name, given) => {
    const disagreements: string[] = [];
    let landed = 0;
    let refused = 0;
    for (let y = -20; y <= 190; y += 3) {
      const { preview, released } = holdAndRelease(given, 'a0', y);
      const call = released[0];
      if (call === undefined) {
        refused++;
        if (Object.keys(preview.shifted).length > 0)
          disagreements.push(`${y}: refused, but rows moved aside`);
        continue;
      }
      landed++;
      const [, index, , windowId] = call;
      if (typeof index !== 'number' || typeof windowId !== 'string') {
        disagreements.push(`${y}: onMove called with ${String(call)}`);
        continue;
      }
      if (index < 1 || index > 2)
        disagreements.push(`${y}: landed at ${index}, outside 1..2`);
      const want = expectedSlotTop(windowId, index);
      if (preview.slotTop !== want)
        disagreements.push(
          `${y}: slot drawn at ${preview.slotTop}, release lands at ${want} (${windowId} ${index})`
        );
    }
    expect(landed).toBeGreaterThan(0);
    expect(refused).toBeGreaterThan(0);
    expect(disagreements).toEqual([]);
  });
});

// A list with no windows -- the saved sessions list, the saved windows list --
// still gets the clamp, asked with no window.
describe('in a list with no windows', () => {
  const IDS = ['a', 'b', 'c', 'd'];

  const renderFlat = (limits: Limits, onMove: RowDragAreaProps['onMove']) => {
    const { container } = render(
      <RowDragArea rowIds={IDS} onMove={onMove} {...limits}>
        {IDS.map((id) => (
          <DraggableRow key={id} rowId={id}>
            <div>Row {id}</div>
          </DraggableRow>
        ))}
      </RowDragArea>
    );
    IDS.forEach((id, i) => {
      find(container, `[data-drag-row-id="${id}"]`).getBoundingClientRect =
        () => box(i * ROW_H, ROW_H);
    });
    return container;
  };

  const drag = (limits: Limits) => {
    const onMove = vi.fn();
    const container = renderFlat(limits, onMove);
    const row = find(container, '[data-drag-row-id="c"]');
    fireEvent.pointerDown(row, { clientX: 10, clientY: 50, button: 0 });
    fireEvent.pointerMove(document, { clientX: 10, clientY: 42 });
    fireEvent.pointerMove(document, { clientX: 10, clientY: 2 });
    fireEvent.pointerUp(document, { clientX: 10, clientY: 2 });
    return onMove.mock.calls;
  };

  test('CONTROL: without the prop, c held at the top lands at 0', () => {
    expect(drag({})).toEqual([['c', 0, undefined]]);
  });

  test('the range is asked with no window, and clamps', () => {
    const landingRange = vi.fn(() => ({ min: 1, max: 3 }));
    expect(drag({ landingRange })).toEqual([['c', 1, undefined]]);
    expect(landingRange).toHaveBeenCalledWith('c', undefined);
  });

  test('acceptsWindow is never asked: there is no window to refuse', () => {
    const acceptsWindow = vi.fn(() => false);
    expect(drag({ acceptsWindow })).toEqual([['c', 0, undefined]]);
    expect(acceptsWindow).not.toHaveBeenCalled();
  });
});

// A clamped landing lands where the pointer is NOT, so the band under the
// pointer is not what it lands on. Before this, the index was clamped but the
// band stayed the target: the band was marked, the list's fixed-row answer
// drew the slot inside it ("joins G at its head"), and the release committed
// the clamped index WITH group G -- a preview and a release that disagree.
//
// A flat list with one group, as a tab list draws it. p0 and p1 are the
// pinned run (range 0..1 for p0); the band G spans its title and members.
//
//   p0 0..20   p1 20..40   p2 40..60   [G title 60..80   g0 80..100   g1 100..120]
describe('a clamped landing does not land on the band under the pointer', () => {
  const TOPS: Record<string, number> = {
    p0: 0,
    p1: 20,
    p2: 40,
    G: 60,
    g0: 80,
    g1: 100,
  };
  const ROWS = ['p0', 'p1', 'p2', 'g0', 'g1'];
  const topIn = (id: string): number => {
    const top = TOPS[id];
    if (top === undefined) throw new Error(`no row ${id}`);
    return top;
  };

  // The band is G's title and members; resolveDrop names it by pointer y.
  const resolveDrop: NonNullable<RowDragAreaProps['resolveDrop']> = (
    _within,
    _x,
    y
  ) => ({ bandId: y >= 60 && y < 120 ? 'G' : undefined });
  // The tab list's head rule: a row landing inside G at or above its first
  // member (index 2, with p0 lifted out) joins it under the title.
  const landsBesideFixedRow: NonNullable<
    RowDragAreaProps['landsBesideFixedRow']
  > = (_rowId, toIndex, target) =>
    target === 'G' && toIndex <= 2
      ? { fixedRowId: 'G', side: 'after' }
      : undefined;

  const hold = (landingRange: Limits['landingRange'], y: number) => {
    const onMove = vi.fn();
    const onDropTargetChange = vi.fn();
    const { container } = render(
      <RowDragArea
        rowIds={ROWS}
        onMove={onMove}
        fixedRowSelector="[data-fixed-row-id]"
        resolveDrop={resolveDrop}
        onDropTargetChange={onDropTargetChange}
        landsBesideFixedRow={landsBesideFixedRow}
        landingRange={landingRange}
      >
        {['p0', 'p1', 'p2'].map((id) => (
          <DraggableRow key={id} rowId={id}>
            <div>Row {id}</div>
          </DraggableRow>
        ))}
        <div data-fixed-row-id="G">G</div>
        {['g0', 'g1'].map((id) => (
          <DraggableRow key={id} rowId={id}>
            <div>Row {id}</div>
          </DraggableRow>
        ))}
      </RowDragArea>
    );
    for (const id of ROWS) {
      find(container, `[data-drag-row-id="${id}"]`).getBoundingClientRect =
        () => box(topIn(id), ROW_H);
    }
    find(container, '[data-fixed-row-id="G"]').getBoundingClientRect = () =>
      box(topIn('G'), ROW_H);

    const row = find(container, '[data-drag-row-id="p0"]');
    fireEvent.pointerDown(row, { clientX: 10, clientY: 10, button: 0 });
    fireEvent.pointerMove(document, { clientX: 10, clientY: 18 });
    fireEvent.pointerMove(document, { clientX: 10, clientY: y });

    const shifted: Record<string, number> = {};
    for (const id of ROWS) {
      if (id === 'p0') continue;
      const shift = translateOf(find(container, `[data-drag-row-id="${id}"]`));
      if (shift !== 0) shifted[id] = shift;
    }
    const wrapper = find(container, '[data-drag-row-id="p0"]');
    const slotTop =
      topIn('p0') +
      translateOf(wrapper) +
      translateOf(find(wrapper, '[data-drag-landing-slot]'));
    const marked = onDropTargetChange.mock.calls.map((c) => c[0]);

    fireEvent.pointerUp(document, { clientX: 10, clientY: y });
    return { shifted, slotTop, marked, released: onMove.mock.calls };
  };

  // y 85: inside G, above g0's midpoint. p1 and p2 are passed: index 2.
  test('CONTROL: without the range, p0 held in G joins G at its head', () => {
    const { shifted, slotTop, marked, released } = hold(undefined, 85);
    expect(marked).toContain('G');
    // p1, p2 and G's title close up; the slot is drawn under the title.
    expect(shifted).toEqual({ p1: -ROW_H, p2: -ROW_H });
    expect(slotTop).toBe(topIn('g0') - ROW_H);
    expect(released).toEqual([['p0', 2, 'G']]);
  });

  test('clamped to 0..1, the same hold marks no band, draws the slot at 1, and releases with no target', () => {
    const { shifted, slotTop, marked, released } = hold(
      () => ({ min: 0, max: 1 }),
      85
    );
    expect(marked).not.toContain('G');
    expect(shifted).toEqual({ p1: -ROW_H });
    expect(slotTop).toBe(topIn('p1'));
    expect(released).toEqual([['p0', 1, undefined]]);
  });

  // A range that does not clamp THIS landing leaves the band its target.
  test('in range, the band is still the target', () => {
    const { marked, released } = hold(() => ({ min: 0, max: 4 }), 85);
    expect(marked).toContain('G');
    expect(released).toEqual([['p0', 2, 'G']]);
  });
});

// The range is bounded to the indices that exist in the landing window: 0 up
// to its row count with the held one lifted out. Past that, in the row's own
// window there is no row to draw the slot in front of, so the preview showed
// nothing moving while the release committed the out-of-range index.
describe('a range past the window’s end', () => {
  test('CONTROL: a range reaching past the end, that also holds a real index, lands on it', () => {
    const { preview, released } = holdAndRelease(
      { landingRange: () => ({ min: 2, max: 9 }) },
      'a0',
      12
    );
    expect(preview.shifted).toEqual({ a1: -ROW_H, a2: -ROW_H });
    expect(preview.slotTop).toBe(topOf('a2'));
    expect(released).toEqual([['a0', 2, undefined, 'wA']]);
  });

  test('a range wholly past the end refuses: nothing steps aside, nothing moves', () => {
    const { preview, released } = holdAndRelease(
      { landingRange: () => ({ min: 3, max: 9 }) },
      'a0',
      12
    );
    expect(preview.shifted).toEqual({});
    expect(preview.slotTop).toBe(topOf('a0'));
    expect(released).toEqual([]);
  });

  test('a range wholly below 0 refuses too', () => {
    const { preview, released } = holdAndRelease(
      { landingRange: () => ({ min: -3, max: -1 }) },
      'a0',
      12
    );
    expect(preview.shifted).toEqual({});
    expect(released).toEqual([]);
  });
});
