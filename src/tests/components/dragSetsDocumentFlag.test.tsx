import { describe, expect, test, beforeEach, afterEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';

import {
  RowDragArea,
  DraggableRow,
} from '../../components/home/rightpane/rowDrag/RowDragArea';
import WindowEntryContainer from '../../components/home/rightpane/WindowEntryContainer';
import {
  decideNewWindowRoom,
  publishNewWindowFree,
  setDragNewWindow,
  type ResolveDrop,
} from '../../components/home/rightpane/rowDrag/dropRules';
import { renderWithProviders } from '../setup/renderWithProviders';
import { setHasTabGroupsPermission } from '../../redux/slices/globalStateSlice';
import type { tabData } from '../../redux/slices/tabContainerDataStateSlice';
import { currentCarry, type CarryOut } from '../../redux/carry';

// KAN-134 / KAN-135. What a drag publishes to the document, so CSS can react.
//
// The previous mechanism set `document.body.style.cursor` directly, and the
// test asserted exactly that -- and passed while the user saw no change at all,
// because `cursor` inherits and every row declares its own. jsdom resolves no
// cascade, so this layer can only pin that the FLAG is published and cleared
// correctly; that the flag then does anything is `dragStyles.test.ts` (the rule
// exists) plus a browser pass (the rule renders).
//
// Splitting it that way is deliberate: an assertion this layer *can* make
// honestly, rather than one that looks stronger and proves nothing.

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

const Harness = ({
  offersNewWindow,
  carryOut,
  resolveDrop,
}: {
  offersNewWindow?: boolean;
  carryOut?: (rowId: string) => CarryOut | null;
  resolveDrop?: ResolveDrop;
}) => (
  <RowDragArea
    rowIds={['a', 'b', 'c']}
    onMove={() => undefined}
    offersNewWindow={offersNewWindow}
    carryOut={carryOut}
    resolveDrop={resolveDrop}
  >
    {['a', 'b', 'c'].map((id) => (
      <DraggableRow key={id} rowId={id}>
        <div>Row {id}</div>
      </DraggableRow>
    ))}
  </RowDragArea>
);

const nodeFor = (id: string): HTMLElement => {
  const el = document.querySelector<HTMLElement>(`[data-drag-row-id="${id}"]`);
  if (!el) throw new Error(`no row ${id}`);
  return el;
};

const layout = () =>
  ['a', 'b', 'c'].forEach((id, i) => {
    nodeFor(id).getBoundingClientRect = () => box(i * ROW_H, ROW_H);
  });

const press = (id: string, y: number) =>
  fireEvent.pointerDown(nodeFor(id), { clientX: 10, clientY: y, button: 0 });
const moveTo = (y: number) =>
  fireEvent.pointerMove(document, { clientX: 10, clientY: y });
const release = (y: number) =>
  fireEvent.pointerUp(document, { clientX: 10, clientY: y });

const isDragging = () => document.documentElement.hasAttribute('data-dragging');
// KAN-361. The New window marker, published beside the kind by a list that
// offers a new window.
const offersNewWindow = () =>
  document.documentElement.hasAttribute('data-drag-new-window');

afterEach(() => {
  document.documentElement.removeAttribute('data-dragging');
  document.documentElement.removeAttribute('data-drag-new-window');
  document.documentElement.removeAttribute('data-drag-new-session');
});

describe('a drag publishes a flag on the document', () => {
  beforeEach(() => {
    render(<Harness />);
    layout();
  });

  test('set while dragging, cleared on drop', () => {
    expect(isDragging()).toBe(false);

    press('a', 15);
    moveTo(50);
    expect(isDragging()).toBe(true);

    release(50);
    expect(isDragging()).toBe(false);
  });

  test('Escape clears it too', () => {
    press('a', 15);
    moveTo(50);
    expect(isDragging()).toBe(true);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(isDragging()).toBe(false);
  });

  // THE CONTROL. A press that never crosses the activation distance is a
  // click, not a drag -- flagging it would force the grabbing cursor and hide
  // every row's actions on an ordinary click.
  test('CONTROL: a press below the threshold never sets it', () => {
    press('a', 15);
    moveTo(17);

    expect(isDragging()).toBe(false);
    release(17);
    expect(isDragging()).toBe(false);
  });
});

describe('a drag interrupted by unmount', () => {
  // KAN-159's path, for the New window marker too (KAN-361): a list that
  // unmounts mid-drag -- its session removed by a sync or a delete elsewhere
  // -- must not leave the toolbar row's controls hidden behind the target.
  test('does not leave the document flagged', () => {
    const { unmount } = render(<Harness offersNewWindow />);
    layout();

    press('a', 15);
    moveTo(50);
    expect(isDragging()).toBe(true);
    expect(offersNewWindow()).toBe(true);

    unmount();

    expect(isDragging()).toBe(false);
    expect(offersNewWindow()).toBe(false);
  });
});

// KAN-394 N1 (revised). A drag that can become a carry marks New session from its pick-up.
describe('the New session marker', () => {
  const offersNewSession = () =>
    document.documentElement.hasAttribute('data-drag-new-session');
  // A carry for rows `a` and `b`, none for `c`.
  const carryOut = (rowId: string): CarryOut | null =>
    rowId === 'c'
      ? null
      : {
          carried: {
            kind: 'tab',
            tabGroupId: 'S1',
            windowId: 'w1',
            tabId: rowId,
          },
          card: { kind: 'tab', title: rowId, faviconUrl: '' },
        };

  test('on from the pick-up, with no carry yet, and off at the drop', () => {
    render(<Harness carryOut={carryOut} />);
    layout();
    press('a', 15);
    moveTo(17);
    // PREMISE: below the threshold this is still a click.
    expect(offersNewSession()).toBe(false);

    moveTo(50);
    expect(currentCarry()).toBeNull();
    expect(offersNewSession()).toBe(true);

    release(50);
    expect(offersNewSession()).toBe(false);
  });

  test('Escape clears it', () => {
    render(<Harness carryOut={carryOut} />);
    layout();
    press('a', 15);
    moveTo(50);
    expect(offersNewSession()).toBe(true);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(offersNewSession()).toBe(false);
  });

  // Open now's lists and the session list have no carryOut.
  test('CONTROL: a list that cannot carry never sets it', () => {
    render(<Harness offersNewWindow />);
    layout();
    press('a', 15);
    moveTo(50);
    // PREMISE: a drag started.
    expect(isDragging()).toBe(true);
    expect(offersNewSession()).toBe(false);
    release(50);
  });

  test('a row its list has no carry for never sets it', () => {
    render(<Harness carryOut={carryOut} />);
    layout();
    press('c', 75);
    moveTo(20);
    // PREMISE: a drag started.
    expect(isDragging()).toBe(true);
    expect(offersNewSession()).toBe(false);
    release(20);
  });

  test('a list unmounted mid-drag does not leave it set', () => {
    const { unmount } = render(<Harness carryOut={carryOut} />);
    layout();
    press('a', 15);
    moveTo(50);
    expect(offersNewSession()).toBe(true);

    unmount();
    expect(offersNewSession()).toBe(false);
  });

  test('a pointercancel clears it', () => {
    render(<Harness carryOut={carryOut} />);
    layout();
    press('a', 15);
    moveTo(50);
    expect(offersNewSession()).toBe(true);

    fireEvent.pointerCancel(window);
    expect(offersNewSession()).toBe(false);
  });
});

// The worst path at a release: the drop's judge throws. No marker may outlive the drag.
describe('a release whose judge throws', () => {
  test('clears the kind, the New window and the New session markers', () => {
    let boom = false;
    const resolveDrop: ResolveDrop = () => {
      if (boom) throw new Error('judge failed');
      return { bandId: undefined };
    };
    const thrown: unknown[] = [];
    const onError = (e: ErrorEvent) => {
      thrown.push(e.error);
      e.preventDefault();
    };
    window.addEventListener('error', onError);
    render(
      <Harness
        offersNewWindow
        resolveDrop={resolveDrop}
        carryOut={(rowId) => ({
          carried: {
            kind: 'tab',
            tabGroupId: 'S1',
            windowId: 'w1',
            tabId: rowId,
          },
          card: { kind: 'tab', title: rowId, faviconUrl: '' },
        })}
      />
    );
    layout();
    press('a', 15);
    moveTo(50);
    // PREMISE: all three are on.
    expect(isDragging()).toBe(true);
    expect(offersNewWindow()).toBe(true);
    expect(document.documentElement.hasAttribute('data-drag-new-session')).toBe(
      true
    );

    boom = true;
    release(50);
    window.removeEventListener('error', onError);

    // PREMISE: the judge did throw.
    expect(thrown.map((e) => (e instanceof Error ? e.message : e))).toEqual([
      'judge failed',
    ]);
    expect(isDragging()).toBe(false);
    expect(offersNewWindow()).toBe(false);
    expect(document.documentElement.hasAttribute('data-drag-new-session')).toBe(
      false
    );
  });
});

// KAN-135. The stylesheet hides the strips during a drag, so it needs a stable
// hook to find them by -- the reveal itself is an emotion class keyed on React
// state, which no stylesheet can select.
// KAN-366 Q4. The marker's value `room` grows the list's trailing block by a
// row (App.css). Only for a list that already scrolls when the row is
// pressed: in one that fits, the room would make it scroll, and the
// scrollbar that appeared would narrow every row at the pick-up.
describe('the New window marker asks for room only in a list that scrolls', () => {
  const marker = () =>
    document.documentElement.getAttribute('data-drag-new-window');
  const inScroller = (scrollHeight: number) => {
    const { container } = render(
      <div style={{ overflowY: 'auto' }}>
        <Harness offersNewWindow />
      </div>
    );
    const scroller = container.firstElementChild;
    if (!(scroller instanceof HTMLElement)) throw new Error('no scroller');
    Object.defineProperty(scroller, 'clientHeight', { value: 100 });
    Object.defineProperty(scroller, 'scrollHeight', { value: scrollHeight });
    layout();
  };

  test.each([
    ['scrolls at the press: room', 500, 'room'],
    ['fits, to the pixel: none', 100, ''],
  ])('%s', (_what, scrollHeight, value) => {
    inScroller(scrollHeight);
    press('a', 15);
    moveTo(50);
    expect(marker()).toBe(value);
    release(50);
    expect(marker()).toBeNull();
  });
});

// KAN-366 Q4, ruling 1. The list a carry shows decides the room again, from
// its own overflow at rest -- the room taken off first, so a list that
// scrolls only because of the room is a list that fits.
describe('decideNewWindowRoom: the room from the shown list’s own overflow', () => {
  const marker = () =>
    document.documentElement.getAttribute('data-drag-new-window');
  afterEach(() => setDragNewWindow(false));
  // A scroller that overflows by `over` px whatever the marker says, plus
  // the room's 34 while the marker asks for it.
  const scroller = (over: number) => {
    const el = document.createElement('div');
    Object.defineProperty(el, 'clientHeight', { value: 100 });
    Object.defineProperty(el, 'scrollHeight', {
      get: () => 100 + over + (marker() === 'room' ? 34 : 0),
    });
    return el;
  };

  test('a list that scrolls at rest: room', () => {
    setDragNewWindow(true);
    decideNewWindowRoom(scroller(1));
    expect(marker()).toBe('room');
  });
  test('a list that fits, though the room it was given makes it scroll: none', () => {
    setDragNewWindow(true, true);
    // PREMISE: with the room it scrolls.
    expect(scroller(0).scrollHeight).toBeGreaterThan(100);
    decideNewWindowRoom(scroller(0));
    expect(marker()).toBe('');
  });
  test('with no marker, none is written', () => {
    decideNewWindowRoom(scroller(500));
    expect(marker()).toBeNull();
  });
});

// KAN-366 Q4, R3. In a list that fits, the space free below the last window,
// which the engine's under-half-a-row rule reads: from the block's top to the
// bottom of the pane's content box, published on the document.
describe('publishNewWindowFree: the space free below the last window', () => {
  const free = () =>
    document.documentElement.style.getPropertyValue('--new-window-free');
  afterEach(() => setDragNewWindow(false));
  // A pane at 100..400 (inner height 300, a 1px top border) holding a
  // trailing block whose top is at `top`.
  const paneWith = (top: number, over = 0) => {
    const pane = document.createElement('div');
    const block = document.createElement('div');
    block.setAttribute('data-new-window-target', 'last');
    pane.append(block);
    Object.defineProperty(pane, 'clientTop', { value: 1 });
    Object.defineProperty(pane, 'clientHeight', { value: 300 });
    Object.defineProperty(pane, 'scrollHeight', { value: 300 + over });
    pane.getBoundingClientRect = () =>
      DOMRect.fromRect({ y: 100, height: 302 });
    block.getBoundingClientRect = () => DOMRect.fromRect({ y: top });
    return pane;
  };

  test('a list that fits: the space from the block to the pane’s inner bottom', () => {
    setDragNewWindow(true);
    publishNewWindowFree(paneWith(377), false);
    // 100 + 1 + 300 - 377.
    expect(free()).toBe('24px');
  });
  test('a list given room: none, so nothing is capped', () => {
    setDragNewWindow(true);
    publishNewWindowFree(paneWith(377), false);
    // PREMISE: published.
    expect(free()).toBe('24px');
    publishNewWindowFree(paneWith(377), true);
    expect(free()).toBe('');
  });
  test('decideNewWindowRoom publishes it for a shown list that fits, and none for one that scrolls', () => {
    setDragNewWindow(true);
    decideNewWindowRoom(paneWith(301));
    expect(free()).toBe('100px');
    decideNewWindowRoom(paneWith(301, 50));
    expect(free()).toBe('');
  });
  test('the marker going off clears it', () => {
    setDragNewWindow(true);
    publishNewWindowFree(paneWith(377), false);
    // PREMISE: published.
    expect(free()).toBe('24px');
    setDragNewWindow(false);
    expect(free()).toBe('');
  });
});

describe('a tab row marks its action strip for the stylesheet', () => {
  const TABS: tabData[] = [
    { tabId: 't1', favicon: '', title: 'One', url: 'https://one.test' },
    { tabId: 't2', favicon: '', title: 'Two', url: 'https://two.test' },
  ];

  test('the marked strip is the one holding the delete control', async () => {
    const { container } = await renderWithProviders(
      <WindowEntryContainer
        number={1}
        title="Window 1"
        tabGroupId="tg1"
        windowId="w1"
        tabs={TABS}
        onOpenWindow={() => undefined}
        onUpdateWindowGroupTitle={() => undefined}
        onAddCurrTabToWindowClick={() => undefined}
        onDeleteClick={() => undefined}
      />,
      { seedStore: (store) => store.dispatch(setHasTabGroupsPermission(false)) }
    );

    const deleteControls = [
      ...container.querySelectorAll('[aria-label="Delete tab"]'),
    ];
    expect(deleteControls.length).toBe(TABS.length);
    deleteControls.forEach((control) => {
      expect(control.closest('[data-row-actions]')).not.toBeNull();
    });
  });
});
