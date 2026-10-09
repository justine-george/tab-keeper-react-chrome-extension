import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, fireEvent } from '@testing-library/react';

import TabGroupEntryContainer from '../../components/home/leftpane/TabGroupEntryContainer';
import TabGroupDetailsContainer from '../../components/home/rightpane/TabGroupDetailsContainer';
import { CarryLayer } from '../../components/home/CarryLayer';
import { currentCarry, endCarry } from '../../redux/carry';
import { endDragHold } from '../../redux/dragHold';
import {
  saveToTabContainerInternal,
  selectTabContainer,
} from '../../redux/slices/tabContainerDataStateSlice';
import {
  setIsNotDirty,
  toggleWindowCollapse,
} from '../../redux/slices/globalStateSlice';
import { renderWithProviders } from '../setup/renderWithProviders';
import {
  T0,
  s1,
  s2,
  sessionIn,
  windowIds,
} from '../fixtures/sessionMoveFixture';

// KAN-350 finding 9: a carried window unmounts from its source, so its fold must not be component state. It lives in globalState (KAN-206), keyed by ids
// neither a cancel nor windowDrop changes. jsdom: the list at x 0..300, y 100..400, 60px rows; the detail at x 400..800.

const LIST_TOP = 100;
const ROW_H = 60;

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

async function render() {
  vi.useFakeTimers({ toFake: ['Date'] });
  const result = await renderWithProviders(
    <>
      <TabGroupEntryContainer />
      <TabGroupDetailsContainer />
      <CarryLayer />
    </>,
    {
      seedStore: (store) => {
        [s2(), s1()].forEach((s, i) => {
          vi.setSystemTime(T0 + i * 1000);
          store.dispatch(saveToTabContainerInternal(s));
        });
        store.dispatch(selectTabContainer('S1'));
        store.dispatch(setIsNotDirty());
        // w2 folded shut.
        store.dispatch(
          toggleWindowCollapse({ tabGroupId: 'S1', windowId: 'w2' })
        );
      },
    }
  );
  // The list box holds the search row, then the scroller.
  const [listBox, pane] = [...result.container.children];
  const scroller = listBox?.lastElementChild;
  if (!(scroller instanceof HTMLElement) || !(pane instanceof HTMLElement)) {
    throw new Error('no list or pane');
  }
  pane.style.overflowY = 'auto';
  pane.getBoundingClientRect = () =>
    DOMRect.fromRect({ x: 400, y: 0, width: 400, height: 500 });
  scroller.getBoundingClientRect = () =>
    DOMRect.fromRect({ x: 0, y: LIST_TOP, width: 300, height: 300 });
  [...scroller.querySelectorAll<HTMLElement>('[data-drag-row-id]')].forEach(
    (row, i) => {
      row.getBoundingClientRect = () =>
        DOMRect.fromRect({
          x: 0,
          y: LIST_TOP + i * ROW_H,
          width: 300,
          height: ROW_H,
        });
    }
  );
  return { ...result, pane };
}

// Whether w2 is drawn folded: a folded window draws no tab list.
const isFolded = (pane: HTMLElement, windowId: string) => {
  const row = pane.querySelector(`[data-drag-row-id="${windowId}"]`);
  if (row === null) throw new Error(`no window ${windowId}`);
  return row.querySelector('[data-window-tabs]') === null;
};

// Pressed on w2's header in the detail, past the activation distance, then
// onto S1's own row (the list's first) -- handed to the carry there.
function carryW2Out(pane: HTMLElement) {
  const handle = pane.querySelector<HTMLElement>(
    '[data-drag-row-id="w2"] [data-window-drag-handle]'
  );
  if (handle === null) throw new Error('no w2 handle');
  fireEvent.pointerDown(handle, { clientX: 420, clientY: 10, button: 0 });
  fireEvent.pointerMove(document, { clientX: 420, clientY: 30 });
  act(() => {
    fireEvent.pointerMove(document, {
      clientX: 150,
      clientY: LIST_TOP + ROW_H / 2,
    });
  });
}

describe('a carried window keeps its fold (finding 9)', () => {
  test('cancelled with Esc: back folded', async () => {
    const { pane } = await render();
    // PREMISE: folded, and the other window open.
    expect(isFolded(pane, 'w2')).toBe(true);
    expect(isFolded(pane, 'w1')).toBe(false);

    carryW2Out(pane);
    // PREMISE: carried, and lifted out of the detail.
    expect(currentCarry()?.carried).toMatchObject({ windowId: 'w2' });
    expect(pane.querySelector('[data-drag-row-id="w2"]')).toBeNull();

    act(() => {
      fireEvent.keyDown(document, { key: 'Escape' });
    });
    expect(currentCarry()).toBeNull();
    expect(isFolded(pane, 'w2')).toBe(true);
  });

  test('let go on its own session’s row: first, and still folded', async () => {
    const { pane, store } = await render();
    carryW2Out(pane);
    act(() => {
      fireEvent.pointerUp(document, {
        clientX: 150,
        clientY: LIST_TOP + ROW_H / 2,
      });
    });

    expect(
      windowIds(sessionIn(store.getState().tabContainerDataState, 'S1'))
    ).toEqual(['w2', 'w1']);
    expect(isFolded(pane, 'w2')).toBe(true);
    expect(isFolded(pane, 'w1')).toBe(false);
  });
});
