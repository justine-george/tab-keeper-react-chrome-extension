import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, fireEvent } from '@testing-library/react';

import TabGroupDetailsContainer from '../../components/home/rightpane/TabGroupDetailsContainer';
import { CarryLayer } from '../../components/home/CarryLayer';
import { currentCarry, endCarry } from '../../redux/carry';
import { endDragHold } from '../../redux/dragHold';
import {
  saveToTabContainerInternal,
  selectTabContainer,
} from '../../redux/slices/tabContainerDataStateSlice';
import {
  setHasTabGroupsPermission,
  setIsNotDirty,
} from '../../redux/slices/globalStateSlice';
import { renderWithProviders } from '../setup/renderWithProviders';
import { s1, s2 } from '../fixtures/sessionMoveFixture';

// KAN-350 + KAN-157. A window or group drag folds the list, and the fold can
// clamp the scroll ("five windows scrolled to 300 ended at 0"). A refused drag
// puts the press's scroll back; a CANCELLED carry of the same drag must too.
// A committed one must not: the view is where the move left it.
//
// jsdom has no layout: the pane gets inline overflow, a box, and scroll
// metrics, and the fold's clamp is played by hand (scrollTop = 0 after the
// hand-off). The restore runs on the frame after the carry ends, once the
// source draws the carried row again, so frames are run by hand too.

const PRESS_SCROLL = 300;

let frames: FrameRequestCallback[] = [];
beforeEach(() => {
  frames = [];
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
    frames.push(cb);
    return frames.length;
  });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
});

afterEach(() => {
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

// Pressed, activated, out to the left -- and then the fold clamps the scroll.
function carryOutLeft(pane: HTMLElement, from: HTMLElement) {
  fireEvent.pointerDown(from, { clientX: 20, clientY: 10, button: 0 });
  fireEvent.pointerMove(document, { clientX: 20, clientY: 30 });
  act(() => {
    fireEvent.pointerMove(document, { clientX: -40, clientY: 30 });
  });
  pane.scrollTop = 0;
}

describe('a cancelled carry puts the press’s scroll back (KAN-157)', () => {
  test('a window carried sideways, then Esc', async () => {
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

  test('a group carried sideways, then a release over nothing', async () => {
    const { pane } = await renderScrolled();
    carryOutLeft(
      pane,
      handleOf('[data-drag-row-id="group:g1"]', '[data-group-drag-handle]')
    );
    expect(currentCarry()?.carried).toMatchObject({ kind: 'group' });

    act(() => {
      fireEvent.pointerUp(window, { clientX: -40, clientY: 30 });
    });
    runFrames();

    expect(pane.scrollTop).toBe(PRESS_SCROLL);
  });

  // CONTROL: the tab list never restores (it does not fold), so a tab carry
  // leaves the scroll alone, as a refused tab drag does.
  test('CONTROL: a tab carried sideways, then Esc, leaves the scroll', async () => {
    const { pane } = await renderScrolled();
    const tab = document.querySelector('[data-drag-row-id="t2"]');
    if (!(tab instanceof HTMLElement)) throw new Error('no tab row');
    carryOutLeft(pane, tab);
    pane.scrollTop = 120;

    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });
    runFrames();

    expect(pane.scrollTop).toBe(120);
  });
});

describe('only a cancelled carry, and only onto its own view', () => {
  test('a committed carry leaves the scroll where the move left it', async () => {
    const { pane } = await renderScrolled();
    carryOutLeft(
      pane,
      handleOf('[data-drag-row-id="w2"]', '[data-window-drag-handle]')
    );

    act(() => endCarry('committed'));
    runFrames();

    expect(pane.scrollTop).toBe(0);
  });

  // Q5 A: a cancel after a spring-open leaves the OTHER session on screen, in
  // the same scroller. The source's scroll is not that view's.
  test('another session on screen by then: its scroll is left alone', async () => {
    const { pane, store } = await renderScrolled();
    carryOutLeft(
      pane,
      handleOf('[data-drag-row-id="w2"]', '[data-window-drag-handle]')
    );
    act(() => {
      store.dispatch(selectTabContainer('S2'));
    });
    // The premise: still carrying, and S2 is what the pane draws.
    expect(currentCarry()).not.toBeNull();
    expect(document.querySelector('[data-drag-row-id="d1"]')).not.toBeNull();

    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });
    runFrames();

    expect(pane.scrollTop).toBe(0);
  });
});
