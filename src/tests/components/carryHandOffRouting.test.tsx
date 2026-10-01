import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, fireEvent } from '@testing-library/react';

import TabGroupEntryContainer from '../../components/home/leftpane/TabGroupEntryContainer';
import TabGroupDetailsContainer from '../../components/home/rightpane/TabGroupDetailsContainer';
import { CarryLayer } from '../../components/home/CarryLayer';
import { setDragging } from '../../components/home/rightpane/rowDrag/dropRules';
import {
  currentCarry,
  endCarry,
  startCarry,
  type CarryCard,
} from '../../redux/carry';
import { beginDragHold, endDragHold } from '../../redux/dragHold';
import {
  saveToTabContainerInternal,
  selectTabContainer,
  type CarriedRef,
  type tabContainerData,
} from '../../redux/slices/tabContainerDataStateSlice';
import { setIsNotDirty } from '../../redux/slices/globalStateSlice';
import { renderWithProviders } from '../setup/renderWithProviders';
import { T0, s1, s2, s3 } from '../fixtures/sessionMoveFixture';

// KAN-350 final review: how a saved drag reaches the session list, the list
// and the detail rendered together.
//   - finding 8: the move that hands a drag to the carry, or hands an
//     adopted one back, is routed to the list, so the row under it is the
//     target at once;
//   - finding 7: a detail drag reads the list's box once, when it starts,
//     not on every move.
//
// jsdom has no layout. The list's scroller sits at x 0..300, y 100..400,
// with 60px rows; the detail pane beside it at x 400..800.

const LIST_TOP = 100;
const LIST_H = 300;
const ROW_H = 60;
const X = 150;
const HOUR = 3_600_000;

// Frames never run here: nothing below waits on one.
beforeEach(() => {
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1);
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
});

afterEach(() => {
  act(() => endCarry('cancelled'));
  endDragHold();
  document.documentElement.removeAttribute('data-dragging');
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// The list reads, top to bottom, in `order`; `selected` is on screen.
async function render(order: tabContainerData[], selected: string) {
  // Each save a second after the last, so the newest is on top and no two
  // tie (a tie is ordered by id).
  vi.useFakeTimers({ toFake: ['Date'] });
  const result = await renderWithProviders(
    <>
      <TabGroupEntryContainer />
      <TabGroupDetailsContainer />
      <CarryLayer />
    </>,
    {
      seedStore: (store) => {
        // Each save goes on top, so save the last one first.
        [...order].reverse().forEach((s, i) => {
          vi.setSystemTime(T0 + i * 1000);
          store.dispatch(saveToTabContainerInternal(s));
        });
        store.dispatch(selectTabContainer(selected));
        store.dispatch(setIsNotDirty());
      },
    }
  );
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  vi.setSystemTime(T0 + HOUR);
  // PREMISE: the list reads as asked.
  expect(
    result.store
      .getState()
      .tabContainerDataState.tabGroups.map((g) => g.tabGroupId)
  ).toEqual(order.map((s) => s.tabGroupId));
  const [scroller, pane] = [...result.container.children];
  if (!(scroller instanceof HTMLElement) || !(pane instanceof HTMLElement)) {
    throw new Error('no list or pane');
  }
  pane.style.overflowY = 'auto';
  pane.getBoundingClientRect = () =>
    DOMRect.fromRect({ x: 400, y: 0, width: 400, height: 500 });
  scroller.getBoundingClientRect = () =>
    DOMRect.fromRect({ x: 0, y: LIST_TOP, width: 300, height: LIST_H });
  layOutRows(scroller);
  return { ...result, scroller, pane };
}

// The list's rows, in the order drawn -- laid out again after a move
// re-sorts them.
function layOutRows(scroller: HTMLElement) {
  [...scroller.querySelectorAll<HTMLElement>('[data-drag-row-id]')].forEach(
    (row, i) => {
      row.getBoundingClientRect = () =>
        DOMRect.fromRect({
          x: 0,
          y: LIST_TOP + i * ROW_H - scroller.scrollTop,
          width: 300,
          height: ROW_H,
        });
    }
  );
}

// The middle of the i-th row of the list.
const rowY = (i: number) => LIST_TOP + i * ROW_H + ROW_H / 2;

const moveTo = (y: number, x = X) =>
  fireEvent.pointerMove(document, { clientX: x, clientY: y });
const wait = (ms: number) => act(() => vi.advanceTimersByTime(ms));

const targetIds = () =>
  [...document.querySelectorAll<HTMLElement>('[data-carry-target]')].map(
    (t) => t.closest<HTMLElement>('[data-drag-row-id]')?.dataset.dragRowId
  );

// As the engine leaves things at the hand-off: held, kind published,
// carried, the pointer out in the detail.
function handOff(carried: CarriedRef, card: CarryCard) {
  setDragging(true, carried.kind);
  beginDragHold();
  act(() => startCarry(carried, card, 600, 200));
}

const TAB_CARD: CarryCard = { kind: 'tab', title: 't', faviconUrl: '' };
// The layer binds its listeners after the render that a carry starts, so
// the very move that started it reached no receiver: the row under the
// pointer lit, and its dwell began, one move late.
describe('finding 8: the move that hands over is routed to the list', () => {
  test('a drag out of the detail onto a row: that row is the target at once', async () => {
    await render([s1(), s2(), s3()], 'S1');
    const t2 = document.querySelector<HTMLElement>('[data-drag-row-id="t2"]');
    if (t2 === null) throw new Error('no t2');
    fireEvent.pointerDown(t2, { clientX: 420, clientY: 10, button: 0 });
    fireEvent.pointerMove(document, { clientX: 420, clientY: 30 });
    // ONE move, onto S2's row.
    act(() => {
      moveTo(rowY(1));
    });

    // PREMISE: the drag was handed to the carry by that move.
    expect(currentCarry()?.carried).toMatchObject({ tabId: 't2' });
    expect(targetIds()).toEqual(['S2']);
  });

  test('an adopted drag handed back onto a row: that row is the target at once', async () => {
    await render([s1(), s2(), s3()], 'S1');
    handOff(
      { kind: 'tab', tabGroupId: 'S1', windowId: 'w1', tabId: 't2' },
      TAB_CARD
    );
    // Into the detail: the tab list adopts the phantom.
    act(() => {
      moveTo(200, 600);
    });
    // PREMISE: adopted.
    expect(currentCarry()?.owner).toBe('area');
    // ONE move, onto S2's row.
    act(() => {
      moveTo(rowY(1));
    });

    expect(currentCarry()?.owner).toBe('layer');
    expect(targetIds()).toEqual(['S2']);
  });

  test('and the dwell started with it: 600ms later that session opens', async () => {
    const { store } = await render([s1(), s2(), s3()], 'S1');
    const t2 = document.querySelector<HTMLElement>('[data-drag-row-id="t2"]');
    if (t2 === null) throw new Error('no t2');
    fireEvent.pointerDown(t2, { clientX: 420, clientY: 10, button: 0 });
    fireEvent.pointerMove(document, { clientX: 420, clientY: 30 });
    act(() => {
      moveTo(rowY(1));
    });
    wait(600);

    expect(store.getState().tabContainerDataState.selectedTabGroupId).toBe(
      'S2'
    );
  });
});

// Every saved detail drag asked the list for its box on EVERY pointermove --
// a forced layout read per move, the cost the engine's measure-once rule
// exists to avoid -- carry or not. The list's box is read once per drag,
// when the drag starts, and the hand-off still happens where the list is.
describe('finding 7: a detail drag reads the list’s box once, when it starts', () => {
  const pressT2 = () => {
    const t2 = document.querySelector<HTMLElement>('[data-drag-row-id="t2"]');
    if (t2 === null) throw new Error('no t2');
    fireEvent.pointerDown(t2, { clientX: 420, clientY: 10, button: 0 });
  };

  test('ten moves inside the pane read it once; the move onto the list still hands off', async () => {
    const { scroller } = await render([s1(), s2(), s3()], 'S1');
    const box = vi.fn(() =>
      DOMRect.fromRect({ x: 0, y: LIST_TOP, width: 300, height: LIST_H })
    );
    scroller.getBoundingClientRect = box;
    pressT2();
    for (let i = 0; i < 10; i++) {
      fireEvent.pointerMove(document, { clientX: 420, clientY: 30 + i * 10 });
    }
    expect(box).toHaveBeenCalledTimes(1);

    act(() => {
      moveTo(rowY(1));
    });
    expect(currentCarry()?.carried).toMatchObject({ tabId: 't2' });
    expect(targetIds()).toEqual(['S2']);
  });

  test('the next drag measures again: the list where it is now', async () => {
    const { scroller } = await render([s1(), s2(), s3()], 'S1');
    pressT2();
    fireEvent.pointerMove(document, { clientX: 420, clientY: 30 });
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.pointerUp(document, { clientX: 420, clientY: 30 });
    // The list moves away between the two drags.
    scroller.getBoundingClientRect = () =>
      DOMRect.fromRect({ x: 1000, y: LIST_TOP, width: 300, height: LIST_H });

    pressT2();
    fireEvent.pointerMove(document, { clientX: 420, clientY: 30 });
    // Where the list WAS: no longer a receiver.
    act(() => {
      moveTo(rowY(1));
    });
    expect(currentCarry()).toBeNull();
    act(() => {
      moveTo(rowY(1), 1100);
    });
    expect(currentCarry()?.carried).toMatchObject({ tabId: 't2' });
  });
});
