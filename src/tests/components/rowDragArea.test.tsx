import { describe, expect, test, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import {
  RowDragArea,
  DraggableRow,
} from '../../components/home/rightpane/rowDrag/RowDragArea';
import { bandAt } from '../../components/home/rightpane/rowDrag/dropRules';
import {
  endDragHold,
  isDragHeld,
  whenDragReleases,
} from '../../redux/dragHold';

// The drag layer alone: when a drag starts, where it lands, which group it joins, and what an abandon does.
// Rows get real boxes (jsdom reports 0): row n spans [n*30, n*30+30), so the midpoints are 15, 45 and 75.
const ROW_H = 30;

const box = (top: number, height: number, left = 0, width = 200): DOMRect => ({
  top,
  bottom: top + height,
  left,
  right: left + width,
  height,
  width,
  x: left,
  y: top,
  toJSON: () => ({}),
});

type OnMove = (tabId: string, toIndex: number, group?: string) => void;

// bandAt answers only the band half of a drop; composed into the wider ResolveDrop shape, as useTabDrop's real one is.
const resolveDrop = (container: HTMLElement | null, x: number, y: number) => ({
  windowId: undefined,
  bandId: bandAt(container, x, y),
});

type OnDropTargetChange = (
  target: string | undefined,
  container: HTMLElement | null
) => void;

const Harness = ({
  onMove,
  onDropTargetChange,
  disabled,
}: {
  onMove: OnMove;
  // Optional: unset, RowDragArea treats it as nobody listening.
  onDropTargetChange?: OnDropTargetChange;
  // Optional for the same reason; RowDragArea defaults it to false.
  disabled?: boolean;
}) => (
  // bandAt is passed in: only the tab list has a membership question.
  <RowDragArea
    rowIds={['a', 'b', 'c']}
    onMove={onMove}
    resolveDrop={resolveDrop}
    onDropTargetChange={onDropTargetChange}
    disabled={disabled}
  >
    {/* Row `a` sits inside a band; `b` and `c` do not. */}
    <div data-band-id="grp" data-testid="band">
      <DraggableRow rowId="a">
        <div>Row A</div>
      </DraggableRow>
    </div>
    <DraggableRow rowId="b">
      <div>Row B</div>
    </DraggableRow>
    <DraggableRow rowId="c">
      <div>Row C</div>
    </DraggableRow>
  </RowDragArea>
);

// The draggable node is the parent of the row content.
const nodeFor = (label: string): HTMLElement => {
  const el = screen.getByText(label).parentElement;
  if (!el) throw new Error(`no row around ${label}`);
  return el;
};

const layout = () => {
  ['Row A', 'Row B', 'Row C'].forEach((label, i) => {
    const el = nodeFor(label);
    el.getBoundingClientRect = () => box(i * ROW_H, ROW_H);
  });
  // The band wraps row A and, per the drop rule, its padding counts as inside.
  const band = screen.getByTestId('band');
  band.getBoundingClientRect = () => box(-2, ROW_H + 4);
};

const press = (label: string, y: number) =>
  fireEvent.pointerDown(nodeFor(label), { clientX: 10, clientY: y, button: 0 });
const moveTo = (y: number) =>
  fireEvent.pointerMove(document, { clientX: 10, clientY: y, button: 0 });
const release = (y: number) =>
  fireEvent.pointerUp(document, { clientX: 10, clientY: y, button: 0 });

// handleSelector names the part of a row that may start a drag, which is what lets one list nest in another (KAN-129).
// The whole area sits inside an element that also matches the selector: the case the containment rule exists for.
describe('handleSelector decides which press starts a drag', () => {
  let onMove: ReturnType<typeof vi.fn<OnMove>>;

  const HandleHarness = () => (
    // An outer match: an unbounded `closest` would find a handle above every press here.
    <div data-handle>
      <RowDragArea
        rowIds={['a', 'b', 'c']}
        onMove={onMove}
        handleSelector="[data-handle]"
      >
        {['a', 'b', 'c'].map((id) => (
          <DraggableRow key={id} rowId={id}>
            <div data-handle>
              <span>Handle {id}</span>
            </div>
            <div>
              <span>Body {id}</span>
            </div>
          </DraggableRow>
        ))}
      </RowDragArea>
    </div>
  );

  const rowFor = (id: string): HTMLElement => {
    const el = document.querySelector<HTMLElement>(
      `[data-drag-row-id="${id}"]`
    );
    if (!el) throw new Error(`no row ${id}`);
    return el;
  };

  beforeEach(() => {
    onMove = vi.fn<OnMove>();
    render(<HandleHarness />);
    ['a', 'b', 'c'].forEach((id, i) => {
      rowFor(id).getBoundingClientRect = () => box(i * ROW_H, ROW_H);
    });
  });

  afterEach(() => {
    document.documentElement.removeAttribute('data-dragging');
  });

  test('a press on the handle starts a drag', () => {
    fireEvent.pointerDown(screen.getByText('Handle c'), {
      clientX: 10,
      clientY: 75,
      button: 0,
    });
    moveTo(40);
    moveTo(5);
    release(5);

    expect(onMove).toHaveBeenCalledTimes(1);
    expect(onMove.mock.calls[0][0]).toBe('c');
    expect(onMove.mock.calls[0][1]).toBe(0);
  });

  // The nesting case at the rule's level: a press off the handle, where a nested list's rows live, starts nothing.
  test('a press outside the handle starts nothing', () => {
    fireEvent.pointerDown(screen.getByText('Body c'), {
      clientX: 10,
      clientY: 75,
      button: 0,
    });
    moveTo(40);
    moveTo(5);
    release(5);

    expect(onMove).not.toHaveBeenCalled();
  });

  // THE CONTAINMENT RULE: a matching ancestor outside this row is not its handle, or the nesting bug returns a level up.
  test('a matching ancestor outside the row does not count as its handle', () => {
    fireEvent.pointerDown(screen.getByText('Body a'), {
      clientX: 10,
      clientY: 15,
      button: 0,
    });
    moveTo(50);
    moveTo(85);
    release(85);

    expect(onMove).not.toHaveBeenCalled();
  });
});

describe('what a drag reports when it lands', () => {
  let onMove: ReturnType<typeof vi.fn<OnMove>>;

  beforeEach(() => {
    onMove = vi.fn<OnMove>();
    render(<Harness onMove={onMove} />);
    layout();
  });

  afterEach(() => {
    document.documentElement.removeAttribute('data-dragging');
  });

  test('dragging to the top of the list lands at index 0, inside the band, so in its group', () => {
    press('Row C', 75);
    moveTo(40);
    moveTo(5);
    release(5);

    expect(onMove).toHaveBeenCalledTimes(1);
    expect(onMove.mock.calls[0][0]).toBe('c');
    expect(onMove.mock.calls[0][1]).toBe(0);
    expect(onMove.mock.calls[0][2]).toBe('grp');
  });

  test('dragging to the bottom lands at the last index, outside every band, so in no group', () => {
    press('Row A', 15);
    moveTo(50);
    moveTo(85);
    release(85);

    expect(onMove.mock.calls[0][1]).toBe(2);
    expect(onMove.mock.calls[0][2]).toBeUndefined();
  });

  // The boundary is the neighbour's midpoint, not its edge.
  test('stopping short of the next midpoint does not advance the index', () => {
    press('Row A', 15);
    moveTo(40); // below Row B's midpoint of 45
    release(40);

    expect(onMove.mock.calls[0][1]).toBe(0);
  });
});

// KAN-132. Compared by `.bandId`, not resolveDrop's object: a fresh object differs on every move and would announce once
// per move instead of once per change (KAN-164).
describe('what onDropTargetChange announces', () => {
  let onMove: ReturnType<typeof vi.fn<OnMove>>;
  let onDropTargetChange: ReturnType<typeof vi.fn<OnDropTargetChange>>;

  beforeEach(() => {
    onMove = vi.fn<OnMove>();
    onDropTargetChange = vi.fn<OnDropTargetChange>();
    render(<Harness onMove={onMove} onDropTargetChange={onDropTargetChange} />);
    layout();
  });

  afterEach(() => {
    document.documentElement.removeAttribute('data-dragging');
  });

  test('fires once for entering a band, not once per move inside it, then once more on leaving', () => {
    press('Row C', 75);
    moveTo(40); // outside every band -- still no target, no call yet
    expect(onDropTargetChange).not.toHaveBeenCalled();

    moveTo(5); // inside the band -- the target CHANGES, first call
    moveTo(4); // still inside the band -- no new call
    moveTo(3); // still inside the band -- no new call

    expect(onDropTargetChange).toHaveBeenCalledTimes(1);
    // The band id ITSELF, a string, not resolveDrop's object: forwarding the object fails here.
    expect(onDropTargetChange.mock.calls[0][0]).toBe('grp');
    expect(typeof onDropTargetChange.mock.calls[0][0]).toBe('string');

    moveTo(50); // leaves the band -- the target changes again, second call
    expect(onDropTargetChange).toHaveBeenCalledTimes(2);
    expect(onDropTargetChange.mock.calls[1][0]).toBeUndefined();

    release(50);
    // Already undefined when the drag ends, so finish's clear-on-end announces nothing more.
    expect(onDropTargetChange).toHaveBeenCalledTimes(2);
  });
});

describe('when a drag should not happen at all', () => {
  let onMove: ReturnType<typeof vi.fn<OnMove>>;

  beforeEach(() => {
    onMove = vi.fn<OnMove>();
    render(<Harness onMove={onMove} />);
    layout();
  });

  afterEach(() => {
    document.documentElement.removeAttribute('data-dragging');
  });

  test('a press that never crosses the threshold reports no move', () => {
    press('Row A', 15);
    moveTo(17); // 2px, under the 5px activation distance
    release(17);

    expect(onMove).not.toHaveBeenCalled();
  });

  test('the Esc that abandons a drag is prevented, so the popup stays open (KAN-403)', () => {
    press('Row A', 15);
    moveTo(85);
    const event = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    });

    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
  });

  test('an Esc with no drag is left alone, so the popup closes (KAN-403)', () => {
    const event = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    });

    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
  });

  test('a right-button press does not begin a drag', () => {
    fireEvent.pointerDown(nodeFor('Row A'), {
      clientX: 10,
      clientY: 15,
      button: 2,
    });
    moveTo(85);
    release(85);

    expect(onMove).not.toHaveBeenCalled();
  });
});

// KAN-335 (O14c). A list turning drag off mid-hold (Open now, a search starting) cancels as Esc does: nothing moves, the
// row goes back, the flag and hold (KAN-279 D12) release with the held change run once, the release click is swallowed.
// Each assertion runs against Esc too.
describe('a drag disabled while held ends as Esc ends it (KAN-335)', () => {
  let clicks: number;
  const onClick = () => {
    clicks += 1;
  };

  beforeEach(() => {
    clicks = 0;
    // Bubble phase on document, where React delegates: a click this misses, no row handler runs on.
    document.addEventListener('click', onClick);
  });

  afterEach(() => {
    document.removeEventListener('click', onClick);
    endDragHold();
    document.documentElement.removeAttribute('data-dragging');
  });

  const ways: Array<'Escape' | 'disabled'> = ['Escape', 'disabled'];

  test.each(ways)(
    '%s: nothing moves, the hold is released once, and the release click is swallowed',
    (way) => {
      const onMove = vi.fn<OnMove>();
      const { rerender } = render(<Harness onMove={onMove} />);
      layout();
      press('Row A', 15);
      moveTo(85);
      // The premise: a started drag, holding, with a change waiting on it.
      expect(isDragHeld()).toBe(true);
      expect(nodeFor('Row A').style.transform).not.toBe('');
      const held = vi.fn();
      whenDragReleases(held);

      if (way === 'Escape') fireEvent.keyDown(window, { key: 'Escape' });
      else rerender(<Harness onMove={onMove} disabled />);

      // Ended at the cancel, before any release.
      expect(isDragHeld()).toBe(false);
      expect(held).toHaveBeenCalledTimes(1);
      expect(document.documentElement.hasAttribute('data-dragging')).toBe(
        false
      );
      expect(nodeFor('Row A').style.transform).toBe('');

      // The release that follows does nothing, and its click opens nothing.
      release(85);
      fireEvent.click(nodeFor('Row A'), { clientX: 10, clientY: 85 });
      expect(onMove).not.toHaveBeenCalled();
      expect(clicks).toBe(0);
    }
  );

  // The cancelled press's own click, however late: no 400ms bound here. Measured on the real artifact: a release 800ms
  // after the cancel opened the tab (e2e/open-now-search.spec.ts).
  test.each(ways)(
    '%s: a release long after the cancel opens nothing, and the next click does',
    (way) => {
      const now = vi.spyOn(performance, 'now').mockReturnValue(1000);
      try {
        const onMove = vi.fn<OnMove>();
        const { rerender } = render(<Harness onMove={onMove} />);
        layout();
        press('Row A', 15);
        moveTo(85);
        expect(isDragHeld()).toBe(true);

        if (way === 'Escape') fireEvent.keyDown(window, { key: 'Escape' });
        else rerender(<Harness onMove={onMove} disabled />);

        // Five seconds on, well past any window a clock would give it.
        now.mockReturnValue(6000);
        release(15);
        fireEvent.click(nodeFor('Row A'), { clientX: 10, clientY: 15 });
        expect(clicks).toBe(0);

        // CONTROL: a new press is a new gesture, and its click goes through.
        press('Row A', 15);
        release(15);
        fireEvent.click(nodeFor('Row A'), { clientX: 10, clientY: 15 });
        expect(clicks).toBe(1);
        expect(onMove).not.toHaveBeenCalled();
      } finally {
        now.mockRestore();
      }
    }
  );

  // From the release it is the usual 400ms, and a click with no press (Enter or Space) does not spend it.
  test.each(ways)(
    '%s: 400ms after the release, a click with no press goes through',
    (way) => {
      const now = vi.spyOn(performance, 'now').mockReturnValue(1000);
      try {
        const onMove = vi.fn<OnMove>();
        const { rerender } = render(<Harness onMove={onMove} />);
        layout();
        press('Row A', 15);
        moveTo(85);
        expect(isDragHeld()).toBe(true);

        if (way === 'Escape') fireEvent.keyDown(window, { key: 'Escape' });
        else rerender(<Harness onMove={onMove} disabled />);

        now.mockReturnValue(6000);
        release(85);
        now.mockReturnValue(6401);
        fireEvent.click(nodeFor('Row A'));
        expect(clicks).toBe(1);
      } finally {
        now.mockRestore();
      }
    }
  );

  // A cancelled pointer is never released, so the suppression waits; a click meanwhile goes through.
  test('after an Esc and a pointercancel, a click goes through', () => {
    const onMove = vi.fn<OnMove>();
    render(<Harness onMove={onMove} />);
    layout();
    press('Row A', 15);
    moveTo(85);
    expect(isDragHeld()).toBe(true);
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.pointerCancel(document, { clientX: 10, clientY: 85 });
    fireEvent.click(nodeFor('Row A'));
    expect(clicks).toBe(1);
  });

  // With the cancelled press still down, a click with no press of its own is the user's (KAN-337).
  test.each(ways)(
    '%s, press still down: a keyboard click on another row goes through',
    (way) => {
      const onMove = vi.fn<OnMove>();
      const { rerender } = render(<Harness onMove={onMove} />);
      layout();
      press('Row A', 15);
      moveTo(85);
      expect(isDragHeld()).toBe(true);

      if (way === 'Escape') fireEvent.keyDown(window, { key: 'Escape' });
      else rerender(<Harness onMove={onMove} disabled />);

      fireEvent.click(nodeFor('Row B'));
      expect(clicks).toBe(1);
      expect(onMove).not.toHaveBeenCalled();
    }
  );

  // A press under the threshold is dropped too, or its next move would start a drag in a list that turned drag off.
  test('a press under the threshold when drag turns off never becomes a drag', () => {
    const onMove = vi.fn<OnMove>();
    const { rerender } = render(<Harness onMove={onMove} />);
    layout();
    press('Row A', 15);
    rerender(<Harness onMove={onMove} disabled />);
    moveTo(85);
    expect(isDragHeld()).toBe(false);
    expect(document.documentElement.hasAttribute('data-dragging')).toBe(false);
    release(85);
    expect(onMove).not.toHaveBeenCalled();
  });
});

// bandAt is the whole membership decision, so it is pinned on its own.
describe('bandAt', () => {
  const container = () => {
    const root = document.createElement('div');
    const band = document.createElement('div');
    band.dataset.bandId = 'grp';
    band.getBoundingClientRect = () => box(10, 40, 0, 100);
    root.appendChild(band);
    return root;
  };

  test('a point inside the band resolves to its group', () => {
    expect(bandAt(container(), 50, 30)).toBe('grp');
  });

  test('a point above the band resolves to no group', () => {
    expect(bandAt(container(), 50, 5)).toBeUndefined();
  });

  test('a point beside the band resolves to no group', () => {
    expect(bandAt(container(), 150, 30)).toBeUndefined();
  });

  test('the boundary counts as inside, so the padding is part of the band', () => {
    expect(bandAt(container(), 50, 10)).toBe('grp');
    expect(bandAt(container(), 50, 50)).toBe('grp');
  });

  test('no container resolves to no group rather than throwing', () => {
    expect(bandAt(null, 50, 30)).toBeUndefined();
  });
});
