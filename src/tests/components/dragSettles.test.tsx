import { setupChromeFake } from '../setup/chrome.fake';
import { describe, expect, test, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { useState } from 'react';

import {
  RowDragArea,
  DraggableRow,
} from '../../components/home/rightpane/rowDrag/RowDragArea';
import {
  useDragState,
  useRowDragHandle,
} from '../../components/home/rightpane/rowDrag/dragContext';
import { endDragHold } from '../../redux/dragHold';
import { endCarry, startCarry } from '../../redux/carry';
import { savedItem } from '../../redux/carriedItem';

// KAN-835. A committed drop holds its rows where it put them until the list
// draws the move. Here only the hold's life: whether it starts, what it keeps,
// and every way it ends. Whether a row then moves on screen is layout, which
// jsdom has none of: e2e/drop-settles.spec.ts measures it per frame.

const ROW_H = 30;
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

const flag = () => document.documentElement.getAttribute('data-dragging');

// What the area tells its rows: no drag, a live one, or a drop being held.
const Probe = () => {
  const drag = useDragState();
  return (
    <span data-testid="probe">
      {drag === null ? 'none' : drag.settling ? 'settling' : 'dragging'}
    </span>
  );
};
const probe = () => screen.getByTestId('probe').textContent;

// What row a's drag handle is told.
const HandleProbe = () => {
  const { held } = useRowDragHandle('a');
  return <span data-testid="handle">{held ? 'held' : 'free'}</span>;
};

type OnMove = (id: string, to: number) => void | Promise<unknown>;

// `generation` re-keys the rows, so the same order is drawn by new elements:
// a row moved to another window or band.
const Area = ({
  ids,
  onMove,
  kind = 'tab',
  generation = 0,
}: {
  ids: string[];
  onMove: OnMove;
  kind?: 'window' | 'tab';
  generation?: number;
}) => (
  <RowDragArea rowIds={ids} onMove={onMove} dragKind={kind}>
    <Probe />
    <HandleProbe />
    {ids.map((id, i) => (
      <DraggableRow key={`${generation}:${id}`} rowId={id}>
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
);

// A list that commits its move in the drop's own task, as a saved list does.
const SyncList = ({ draws }: { draws: boolean }) => {
  const [ids, setIds] = useState(['a', 'b', 'c']);
  return (
    <Area
      ids={ids}
      onMove={(id, to) => {
        if (!draws) return;
        const rest = ids.filter((x) => x !== id);
        setIds([...rest.slice(0, to), id, ...rest.slice(to)]);
      }}
    />
  );
};

const wrapperOf = (label: string): HTMLElement => {
  const row = screen.getByText(label).parentElement;
  if (!row) throw new Error(`no row around ${label}`);
  return row;
};

// Row a dropped past b (b's middle is 45): index 1, b stood aside by a row.
const dropAPastB = () => {
  fireEvent.pointerDown(wrapperOf('Row a'), {
    clientX: 10,
    clientY: 15,
    button: 0,
  });
  fireEvent.pointerMove(document, { clientX: 10, clientY: 30 });
  fireEvent.pointerMove(document, { clientX: 10, clientY: 70 });
  // PREMISE: b stands aside, so there is a shift for a hold to keep.
  expect(wrapperOf('Row b').style.transform).toBe(`translateY(-${ROW_H}px)`);
  const heldAt = wrapperOf('Row a').style.transform;
  fireEvent.pointerUp(document, { clientX: 10, clientY: 70 });
  return heldAt;
};

// A move that lands when the test says.
function later() {
  let resolve: (moved: unknown) => void = () => {};
  const moving = new Promise<unknown>((r) => {
    resolve = r;
  });
  return { onMove: vi.fn(() => moving), resolve };
}

let chromeHandle: ReturnType<typeof setupChromeFake> | undefined;
beforeEach(() => {
  chromeHandle = setupChromeFake();
});
afterEach(() => {
  chromeHandle?.restore();
  chromeHandle = undefined;
  document.documentElement.removeAttribute('data-dragging');
  endDragHold();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('a move committed in the drop’s own task', () => {
  test('drawn: nothing is held after the drop, and no row keeps a shift', () => {
    render(<SyncList draws />);
    dropAPastB();

    expect(probe()).toBe('none');
    expect(screen.getAllByText(/^Row /).map((r) => r.textContent)).toEqual([
      'Row b',
      'Row a',
      'Row c',
    ]);
    expect(wrapperOf('Row b').style.transform).toBe('');
  });

  test('nothing drawn: the hold ends at once, and the rows ease back', () => {
    render(<SyncList draws={false} />);
    dropAPastB();

    expect(probe()).toBe('none');
    expect(wrapperOf('Row b').style.transform).toBe('');
    expect(wrapperOf('Row b').style.transition).toContain('transform');
  });
});

describe('a move that lands later (Open now)', () => {
  test('held until drawn: the rows keep the drop, the held row stays put with no lift', () => {
    const { onMove } = later();
    const { rerender } = render(<Area ids={['a', 'b', 'c']} onMove={onMove} />);
    const heldAt = dropAPastB();

    expect(probe()).toBe('settling');
    expect(wrapperOf('Row b').style.transform).toBe(`translateY(-${ROW_H}px)`);
    // Where it was let go, still; no shadow.
    const held = wrapperOf('Row a');
    expect(heldAt).not.toBe('');
    expect(held.style.transform).toBe(heldAt);
    expect(held.style.transition).toBe('none');
    expect(held.style.boxShadow).toBe('');
    // Nor does its handle stay shown as held.
    expect(screen.getByTestId('handle').textContent).toBe('free');

    rerender(<Area ids={['b', 'a', 'c']} onMove={onMove} />);

    expect(probe()).toBe('none');
    expect(wrapperOf('Row b').style.transform).toBe('');
    expect(wrapperOf('Row a').style.transform).toBe('');
  });

  test('drawn by new elements in the same order (another window): the hold ends', () => {
    const { onMove } = later();
    const { rerender } = render(<Area ids={['a', 'b', 'c']} onMove={onMove} />);
    dropAPastB();
    expect(probe()).toBe('settling');

    rerender(<Area ids={['a', 'b', 'c']} onMove={onMove} generation={1} />);

    expect(probe()).toBe('none');
  });

  test('a re-render that draws nothing new keeps the hold', () => {
    const { onMove } = later();
    const { rerender } = render(<Area ids={['a', 'b', 'c']} onMove={onMove} />);
    dropAPastB();

    rerender(<Area ids={['a', 'b', 'c']} onMove={onMove} />);

    expect(probe()).toBe('settling');
  });

  test('nothing moved (resolves null): the rows ease back', async () => {
    const { onMove, resolve } = later();
    render(<Area ids={['a', 'b', 'c']} onMove={onMove} />);
    dropAPastB();
    expect(probe()).toBe('settling');

    await act(async () => {
      resolve(null);
      await Promise.resolve();
    });

    expect(probe()).toBe('none');
  });

  test('moved, but never drawn: the rows ease back after a second', async () => {
    vi.useFakeTimers();
    const { onMove, resolve } = later();
    render(<Area ids={['a', 'b', 'c']} onMove={onMove} />);
    dropAPastB();
    await act(async () => {
      resolve([{}]);
      await vi.advanceTimersByTimeAsync(999);
    });
    expect(probe()).toBe('settling');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });

    expect(probe()).toBe('none');
  });

  test('a drop on its own place is not held: it moves nothing, and eases home', () => {
    const { onMove } = later();
    render(<Area ids={['a', 'b', 'c']} onMove={onMove} />);
    fireEvent.pointerDown(wrapperOf('Row a'), {
      clientX: 10,
      clientY: 15,
      button: 0,
    });
    fireEvent.pointerMove(document, { clientX: 10, clientY: 30 });
    fireEvent.pointerUp(document, { clientX: 10, clientY: 30 });

    // PREMISE: the drop was committed, so this is not the refused path.
    expect(onMove).toHaveBeenCalledWith('a', 0, undefined);
    expect(probe()).toBe('none');
  });

  test('a stray Esc or release elsewhere does not end the hold', () => {
    const { onMove } = later();
    render(<Area ids={['a', 'b', 'c']} onMove={onMove} />);
    dropAPastB();

    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.pointerUp(document, { clientX: 500, clientY: 500 });

    expect(probe()).toBe('settling');
    expect(wrapperOf('Row b').style.transform).toBe(`translateY(-${ROW_H}px)`);
  });

  test('a move that fails: the rows ease back at once', async () => {
    vi.useFakeTimers();
    let fail: (e: Error) => void = () => {};
    const onMove = vi.fn(
      () =>
        new Promise<unknown>((_, reject) => {
          fail = reject;
        })
    );
    render(<Area ids={['a', 'b', 'c']} onMove={onMove} />);
    dropAPastB();

    await act(async () => {
      fail(new Error('the window closed'));
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(probe()).toBe('none');
  });

  test('a press during the hold ends it first', () => {
    const { onMove } = later();
    render(<Area ids={['a', 'b', 'c']} onMove={onMove} />);
    dropAPastB();
    expect(probe()).toBe('settling');

    fireEvent.pointerDown(wrapperOf('Row c'), {
      clientX: 10,
      clientY: 75,
      button: 0,
    });

    expect(probe()).toBe('none');
  });

  test('a folding drag keeps its fold through the hold, and drops it when drawn', () => {
    const { onMove } = later();
    const { rerender } = render(
      <Area ids={['a', 'b', 'c']} onMove={onMove} kind="window" />
    );
    dropAPastB();

    expect(flag()).toBe('window');
    expect(wrapperOf('Row a').hasAttribute('data-drag-held')).toBe(true);

    rerender(<Area ids={['b', 'a', 'c']} onMove={onMove} kind="window" />);

    expect(flag()).toBeNull();
    expect(wrapperOf('Row a').hasAttribute('data-drag-held')).toBe(false);
  });

  test('a kept fold comes off if the list unmounts during the hold', () => {
    const { onMove } = later();
    const { unmount } = render(
      <Area ids={['a', 'b', 'c']} onMove={onMove} kind="window" />
    );
    dropAPastB();
    expect(flag()).toBe('window');

    unmount();

    expect(flag()).toBeNull();
  });

  test('a kept fold is not taken off a drag that started since', async () => {
    const { onMove, resolve } = later();
    // Its own rows, so a press there starts nothing in the held area.
    const Other = () => (
      <RowDragArea rowIds={['x']} onMove={() => {}} dragKind="tab">
        <DraggableRow rowId="x">
          <div
            ref={(el) => {
              if (el?.parentElement)
                el.parentElement.getBoundingClientRect = () => box(200, ROW_H);
            }}
          >
            Row x
          </div>
        </DraggableRow>
      </RowDragArea>
    );
    render(
      <>
        <Area ids={['a', 'b', 'c']} onMove={onMove} kind="window" />
        <Other />
      </>
    );
    dropAPastB();
    expect(flag()).toBe('window');
    fireEvent.pointerDown(wrapperOf('Row x'), {
      clientX: 10,
      clientY: 215,
      button: 0,
    });
    fireEvent.pointerMove(document, { clientX: 10, clientY: 235 });
    expect(flag()).toBe('tab');

    await act(async () => {
      resolve(null);
      await Promise.resolve();
    });

    expect(probe()).toBe('none');
    expect(flag()).toBe('tab');
  });

  test('a tab drag keeps no fold: the flag is off at the drop', () => {
    const { onMove } = later();
    render(<Area ids={['a', 'b', 'c']} onMove={onMove} />);
    dropAPastB();

    expect(probe()).toBe('settling');
    expect(flag()).toBeNull();
  });
});

// The slides finished when a held drop's move is drawn (settleSlides). jsdom
// runs no animations, so one running transform slide is stood in for. A drag
// finishes them at pick-up too (KAN-280 Part F), so counts start after it.
describe('the commit that draws the move finishes the slides', () => {
  let finished = 0;
  beforeEach(() => {
    finished = 0;
    vi.spyOn(HTMLElement.prototype, 'getAnimations').mockImplementation(
      () =>
        [
          {
            transitionProperty: 'transform',
            playState: 'running',
            finish: () => {
              finished += 1;
            },
          },
        ] as unknown as Animation[]
    );
  });

  test('drawn: finished', () => {
    const { onMove } = later();
    const { rerender } = render(<Area ids={['a', 'b', 'c']} onMove={onMove} />);
    dropAPastB();
    finished = 0;

    rerender(<Area ids={['b', 'a', 'c']} onMove={onMove} />);

    expect(finished).toBeGreaterThan(0);
  });

  test('CONTROL: eased back (nothing moved): left to ease', async () => {
    const { onMove, resolve } = later();
    render(<Area ids={['a', 'b', 'c']} onMove={onMove} />);
    dropAPastB();
    finished = 0;

    await act(async () => {
      resolve(null);
      await Promise.resolve();
    });

    expect(probe()).toBe('none');
    expect(finished).toBe(0);
  });

  test('a stray Esc during a hold leaves no finish behind for the next cancel', () => {
    const { onMove } = later();
    const { rerender } = render(<Area ids={['a', 'b', 'c']} onMove={onMove} />);
    dropAPastB();
    fireEvent.keyDown(window, { key: 'Escape' });
    rerender(<Area ids={['b', 'a', 'c']} onMove={onMove} />);

    // The next drag, cancelled: its rows ease home.
    fireEvent.pointerDown(wrapperOf('Row b'), {
      clientX: 10,
      clientY: 15,
      button: 0,
    });
    fireEvent.pointerMove(document, { clientX: 10, clientY: 30 });
    fireEvent.pointerMove(document, { clientX: 10, clientY: 70 });
    finished = 0;
    fireEvent.keyDown(window, { key: 'Escape' });

    expect(probe()).toBe('none');
    expect(finished).toBe(0);
  });
});

// KAN-849. A carried item let go in a saved list: its list draws the row it
// lands as in the drop's own task, as a saved list draws a move.
describe('an adopted drop (KAN-849)', () => {
  let finished = 0;
  beforeEach(() => {
    finished = 0;
    vi.spyOn(HTMLElement.prototype, 'getAnimations').mockImplementation(
      () =>
        [
          {
            transitionProperty: 'transform',
            playState: 'running',
            finish: () => {
              finished += 1;
            },
          },
        ] as unknown as Animation[]
    );
  });
  afterEach(() => {
    endCarry('cancelled');
  });

  // Rows a, b, c, then the phantom x the carry is drawn as, in a 300px pane.
  // `draws`: the drop commits the carry as row n where it was let go.
  const CarryList = ({ draws }: { draws: boolean }) => {
    const [ids, setIds] = useState(['a', 'b', 'c', 'x']);
    const phantom = ids.includes('x') ? 'x' : undefined;
    return (
      <div data-testid="pane" style={{ overflowY: 'auto' }}>
        <RowDragArea
          rowIds={ids}
          dragKind="tab"
          adoptRowId={phantom}
          onMove={(id, to) => {
            if (!draws) return void endCarry('cancelled');
            const rest = ids.filter((r) => r !== id);
            setIds([...rest.slice(0, to), 'n', ...rest.slice(to)]);
            endCarry('committed');
          }}
        >
          <Probe />
          {ids.map((id, i) => (
            <DraggableRow key={id} rowId={id}>
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
  };

  // Carried in over the pane, then let go on b's top half: b and c stand
  // aside a row for it.
  const carryInAboveB = () => {
    screen.getByTestId('pane').getBoundingClientRect = () => box(0, 300);
    startCarry(
      savedItem({ kind: 'tab', tabGroupId: 'S2', windowId: 'w9', tabId: 't' }),
      { kind: 'tab', title: 'Carried', faviconUrl: '' },
      300,
      105
    );
    fireEvent.pointerMove(document, { clientX: 100, clientY: 105 });
    fireEvent.pointerMove(document, { clientX: 100, clientY: 70 });
    fireEvent.pointerMove(document, { clientX: 100, clientY: 38 });
    // PREMISE: adopted, and b stands aside, so there is a shift to keep.
    expect(probe()).toBe('dragging');
    expect(wrapperOf('Row b').style.transform).toBe(`translateY(${ROW_H}px)`);
    finished = 0;
    fireEvent.pointerUp(document, { clientX: 100, clientY: 38 });
  };

  test('drawn: the rows that made room are not left to ease over the new row', () => {
    render(<CarryList draws />);
    carryInAboveB();

    expect(screen.getAllByText(/^Row /).map((r) => r.textContent)).toEqual([
      'Row a',
      'Row n',
      'Row b',
      'Row c',
    ]);
    expect(probe()).toBe('none');
    expect(finished).toBeGreaterThan(0);
  });

  test('CONTROL: nothing drawn: the rows ease back', () => {
    render(<CarryList draws={false} />);
    carryInAboveB();

    expect(probe()).toBe('none');
    expect(finished).toBe(0);
    expect(wrapperOf('Row b').style.transform).toBe('');
    expect(wrapperOf('Row b').style.transition).toContain('transform');
  });
});

// KAN-850. A carried item let go in Currently open: the carry ends in the
// drop's own task, so the phantom leaves at once, and Chrome draws the copy
// it opens a few frames later.
describe('an adopted drop that lands later (KAN-850)', () => {
  let finished = 0;
  beforeEach(() => {
    finished = 0;
    vi.spyOn(HTMLElement.prototype, 'getAnimations').mockImplementation(
      () =>
        [
          {
            transitionProperty: 'transform',
            playState: 'running',
            finish: () => {
              finished += 1;
            },
          },
        ] as unknown as Animation[]
    );
  });
  afterEach(() => {
    endCarry('cancelled');
  });

  // Rows a, b, c, then the phantom x the carry is drawn as, in a 300px pane.
  // The drop ends the carry, which takes x out, and resolves when told.
  const CopyList = ({
    ids,
    onMove,
  }: {
    ids: string[];
    onMove: () => Promise<unknown>;
  }) => {
    const [carried, setCarried] = useState(true);
    const rowIds = carried ? [...ids, 'x'] : ids;
    return (
      <div data-testid="pane" style={{ overflowY: 'auto' }}>
        <RowDragArea
          rowIds={rowIds}
          dragKind="tab"
          adoptRowId={carried ? 'x' : undefined}
          onMove={() => {
            endCarry('copied');
            setCarried(false);
            return onMove();
          }}
        >
          <Probe />
          {rowIds.map((id, i) => (
            <DraggableRow key={id} rowId={id}>
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
  };

  // As carryInAboveB above.
  const carryInAboveB = () => {
    screen.getByTestId('pane').getBoundingClientRect = () => box(0, 300);
    startCarry(
      savedItem({ kind: 'tab', tabGroupId: 'S2', windowId: 'w9', tabId: 't' }),
      { kind: 'tab', title: 'Carried', faviconUrl: '' },
      300,
      105
    );
    fireEvent.pointerMove(document, { clientX: 100, clientY: 105 });
    fireEvent.pointerMove(document, { clientX: 100, clientY: 70 });
    fireEvent.pointerMove(document, { clientX: 100, clientY: 38 });
    // PREMISE: adopted, and b stands aside, so there is a shift to keep.
    expect(probe()).toBe('dragging');
    expect(wrapperOf('Row b').style.transform).toBe(`translateY(${ROW_H}px)`);
    finished = 0;
    fireEvent.pointerUp(document, { clientX: 100, clientY: 38 });
  };

  test('the phantom leaving draws nothing: b and c keep the room they made', () => {
    const { onMove } = later();
    render(<CopyList ids={['a', 'b', 'c']} onMove={onMove} />);
    carryInAboveB();

    // PREMISE: the phantom is gone.
    expect(screen.queryByText('Row x')).toBeNull();
    expect(probe()).toBe('settling');
    expect(wrapperOf('Row b').style.transform).toBe(`translateY(${ROW_H}px)`);
    expect(finished).toBe(0);
  });

  test('the copy drawn: the hold ends, and the rows are not left to ease over it', () => {
    const { onMove } = later();
    const { rerender } = render(
      <CopyList ids={['a', 'b', 'c']} onMove={onMove} />
    );
    carryInAboveB();

    rerender(<CopyList ids={['a', 'n', 'b', 'c']} onMove={onMove} />);

    expect(probe()).toBe('none');
    expect(finished).toBeGreaterThan(0);
  });

  test('CONTROL: Chrome opens nothing (resolves null): the rows ease back', async () => {
    const { onMove, resolve } = later();
    render(<CopyList ids={['a', 'b', 'c']} onMove={onMove} />);
    carryInAboveB();

    await act(async () => {
      resolve(null);
      await Promise.resolve();
    });

    expect(probe()).toBe('none');
    expect(finished).toBe(0);
    expect(wrapperOf('Row b').style.transform).toBe('');
    expect(wrapperOf('Row b').style.transition).toContain('transform');
  });
});
