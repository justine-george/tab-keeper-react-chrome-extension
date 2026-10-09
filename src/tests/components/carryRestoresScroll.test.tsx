import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, fireEvent } from '@testing-library/react';

import TabGroupDetailsContainer from '../../components/home/rightpane/TabGroupDetailsContainer';
import { CarryLayer } from '../../components/home/CarryLayer';
import { currentCarry, endCarry } from '../../redux/carry';
import { endDragHold } from '../../redux/dragHold';
import {
  deleteTabContainerInternal,
  saveToTabContainerInternal,
  selectTabContainer,
} from '../../redux/slices/tabContainerDataStateSlice';
import {
  setHasTabGroupsPermission,
  setIsNotDirty,
} from '../../redux/slices/globalStateSlice';
import { renderWithProviders } from '../setup/renderWithProviders';
import { s1, s2 } from '../fixtures/sessionMoveFixture';
import { standInSessionList } from '../setup/standInSessionList';

// KAN-350 + KAN-157: a window or group drag's fold can clamp the scroll. A refused drag or a cancelled carry puts the press's scroll back; a committed carry does not.
// jsdom: inline overflow, a box and scroll metrics; the clamp is played by hand, and frames are run by hand (the restore runs the frame after the carry ends).

const PRESS_SCROLL = 300;

let frames: FrameRequestCallback[] = [];
// The session list, stood in left of the pane, where a saved drag hands off
// (KAN-352). Below it (y >= 500) is nothing.
let unregisterList = () => {};
beforeEach(() => {
  unregisterList = standInSessionList({
    left: -400,
    right: 0,
    top: 0,
    bottom: 500,
  }).unregister;
  frames = [];
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
    frames.push(cb);
    return frames.length;
  });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
});

afterEach(() => {
  unregisterList();
  endCarry('cancelled');
  endDragHold();
  document.documentElement.removeAttribute('data-dragging');
  vi.restoreAllMocks();
});

const runFrames = () => {
  const due = frames;
  frames = [];
  due.forEach((cb) => cb(0));
};

async function renderScrolled() {
  const result = await renderWithProviders(
    <>
      <TabGroupDetailsContainer />
      <CarryLayer />
    </>,
    {
      seedStore: (store) => {
        store.dispatch(setHasTabGroupsPermission(true));
        store.dispatch(saveToTabContainerInternal(s2()));
        store.dispatch(saveToTabContainerInternal(s1()));
        store.dispatch(selectTabContainer('S1'));
        store.dispatch(setIsNotDirty());
      },
    }
  );
  const pane = result.container.firstElementChild;
  if (!(pane instanceof HTMLElement)) throw new Error('no detail pane');
  pane.style.overflowY = 'auto';
  pane.getBoundingClientRect = () =>
    DOMRect.fromRect({ width: 400, height: 200 });
  Object.defineProperty(pane, 'clientHeight', {
    value: 200,
    configurable: true,
  });
  Object.defineProperty(pane, 'scrollHeight', {
    value: 1000,
    configurable: true,
  });
  pane.scrollTop = PRESS_SCROLL;
  return { ...result, pane };
}

function handleOf(selector: string, handle: string): HTMLElement {
  const el = document.querySelector(selector)?.querySelector(handle);
  if (!(el instanceof HTMLElement))
    throw new Error(`no ${handle} in ${selector}`);
  return el;
}

// Pressed, activated, out to the left onto the list -- and then the fold
// clamps the scroll.
function carryOutLeft(pane: HTMLElement, from: HTMLElement) {
  fireEvent.pointerDown(from, { clientX: 20, clientY: 10, button: 0 });
  fireEvent.pointerMove(document, { clientX: 20, clientY: 30 });
  act(() => {
    fireEvent.pointerMove(document, { clientX: -40, clientY: 30 });
  });
  pane.scrollTop = 0;
}

describe('a cancelled carry puts the press’s scroll back (KAN-157)', () => {
  test('a window carried out, then Esc', async () => {
    const { pane } = await renderScrolled();
    carryOutLeft(
      pane,
      handleOf('[data-drag-row-id="w2"]', '[data-window-drag-handle]')
    );
    // The premise: carried, and clamped.
    expect(currentCarry()?.carried).toMatchObject({ kind: 'window' });
    expect(pane.scrollTop).toBe(0);

    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });
    runFrames();

    expect(currentCarry()).toBeNull();
    expect(pane.scrollTop).toBe(PRESS_SCROLL);
  });

  test('a group carried out, then a release over nothing', async () => {
    const { pane } = await renderScrolled();
    carryOutLeft(
      pane,
      handleOf('[data-drag-row-id="group:g1"]', '[data-group-drag-handle]')
    );
    expect(currentCarry()?.carried).toMatchObject({ kind: 'group' });

    // Off the list, below it: over nothing.
    act(() => {
      fireEvent.pointerMove(window, { clientX: -40, clientY: 600 });
    });
    act(() => {
      fireEvent.pointerUp(window, { clientX: -40, clientY: 600 });
    });
    runFrames();

    expect(pane.scrollTop).toBe(PRESS_SCROLL);
  });

  // KAN-406: a tab carry is put back too, though its list never folds.
  test('a tab carried out, then Esc', async () => {
    const { pane } = await renderScrolled();
    const tab = document.querySelector('[data-drag-row-id="t2"]');
    if (!(tab instanceof HTMLElement)) throw new Error('no tab row');
    carryOutLeft(pane, tab);
    // The premise: carried, so the Esc below ends a carry, not a drag.
    expect(currentCarry()?.carried).toMatchObject({ kind: 'tab' });
    pane.scrollTop = 120;

    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });
    runFrames();

    expect(pane.scrollTop).toBe(PRESS_SCROLL);
  });
});

describe('only a cancelled carry, and only onto its own view', () => {
  test('a committed carry leaves the scroll where the move left it', async () => {
    const { pane } = await renderScrolled();
    carryOutLeft(
      pane,
      handleOf('[data-drag-row-id="w2"]', '[data-window-drag-handle]')
    );
    expect(currentCarry()?.carried).toMatchObject({ kind: 'window' });

    act(() => endCarry('committed'));
    runFrames();

    expect(pane.scrollTop).toBe(0);
  });

  test('a committed carry after a spring-open leaves the opened session on screen', async () => {
    const { pane, store } = await renderScrolled();
    carryOutLeft(
      pane,
      handleOf('[data-drag-row-id="w2"]', '[data-window-drag-handle]')
    );
    act(() => {
      store.dispatch(selectTabContainer('S2'));
    });

    act(() => endCarry('committed'));
    runFrames();

    expect(store.getState().tabContainerDataState.selectedTabGroupId).toBe(
      'S2'
    );
    expect(pane.scrollTop).toBe(0);
  });
});

// KAN-406: a cancel after a spring-open shows the source again, at the
// press's scroll.
describe('a cancel after a spring-open returns to the source', () => {
  test.each([
    ['window', '[data-drag-row-id="w2"]', '[data-window-drag-handle]'],
    ['tab', '[data-drag-row-id="w1"]', '[data-drag-row-id="t2"]'],
  ])('a %s, then Esc', async (kind, row, handle) => {
    const { pane, store } = await renderScrolled();
    carryOutLeft(pane, handleOf(row, handle));
    act(() => {
      store.dispatch(selectTabContainer('S2'));
    });
    // The premise: still carrying, and S2 is what the pane draws.
    expect(currentCarry()?.carried).toMatchObject({ kind });
    expect(document.querySelector('[data-drag-row-id="d1"]')).not.toBeNull();

    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });
    runFrames();

    expect(store.getState().tabContainerDataState.selectedTabGroupId).toBe(
      'S1'
    );
    expect(document.querySelector('[data-drag-row-id="w2"]')).not.toBeNull();
    expect(pane.scrollTop).toBe(PRESS_SCROLL);
  });

  test('the source gone meanwhile: the opened session stays, and nothing throws', async () => {
    const { pane, store } = await renderScrolled();
    carryOutLeft(
      pane,
      handleOf('[data-drag-row-id="w2"]', '[data-window-drag-handle]')
    );
    act(() => {
      store.dispatch(selectTabContainer('S2'));
    });
    // Deleting S1 takes the carried window with it: the carry is cancelled.
    act(() => {
      store.dispatch(deleteTabContainerInternal('S1'));
    });
    runFrames();

    expect(currentCarry()).toBeNull();
    expect(store.getState().tabContainerDataState.selectedTabGroupId).toBe(
      'S2'
    );
    expect(pane.scrollTop).toBe(0);
  });
});
