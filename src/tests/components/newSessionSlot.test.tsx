import { afterEach, describe, expect, test, vi } from 'vitest';
import { act, fireEvent } from '@testing-library/react';

import UserInputContainer from '../../components/home/leftpane/UserInputContainer';
import TabGroupEntryContainer from '../../components/home/leftpane/TabGroupEntryContainer';
import { CarryLayer } from '../../components/home/CarryLayer';
import { setDragging } from '../../components/home/rightpane/rowDrag/dropRules';
import { carryReceiverAt, endCarry, startCarry } from '../../redux/carry';
import { beginDragHold, endDragHold } from '../../redux/dragHold';
import {
  saveToTabContainerInternal,
  selectTabContainer,
  type CarriedRef,
} from '../../redux/slices/tabContainerDataStateSlice';
import { setIsNotDirty } from '../../redux/slices/globalStateSlice';
import { renderWithProviders } from '../setup/renderWithProviders';
import { s1, s2 } from '../fixtures/sessionMoveFixture';

// KAN-394 N1 (revised 2026-10-07). While a carry rests on the New session
// target, the session list slides down one row and opens an empty place at
// its top; leaving slides it back, and a release fills it with the new row.
//
// jsdom has no layout: the save row sits at y 0..58, the list's scroller at
// 100..400, and its rows 60 apart.

const ROW_H = 60;
const ON_TARGET = { clientX: 10, clientY: 20 };
const ON_LIST = { clientX: 10, clientY: 130 };

const T1: CarriedRef = {
  kind: 'tab',
  tabGroupId: 'S1',
  windowId: 'w1',
  tabId: 't1',
};
const GONE: CarriedRef = { ...T1, tabId: 'nowhere' };

afterEach(() => {
  act(() => endCarry('cancelled'));
  endDragHold();
  document.documentElement.removeAttribute('data-dragging');
  vi.restoreAllMocks();
});

async function renderPane(sessions = [s2(), s1()], withLayer = true) {
  const result = await renderWithProviders(
    <>
      <UserInputContainer />
      <TabGroupEntryContainer />
      {withLayer && <CarryLayer />}
    </>,
    {
      seedStore: (store) => {
        for (const s of sessions) store.dispatch(saveToTabContainerInternal(s));
        store.dispatch(selectTabContainer('S1'));
        store.dispatch(setIsNotDirty());
      },
    }
  );
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(
    function (this: Element) {
      if (!(this instanceof HTMLElement)) return DOMRect.fromRect();
      if (this.dataset.saveRow !== undefined)
        return DOMRect.fromRect({ x: 0, y: 0, width: 340, height: 58 });
      const row = this.dataset.dragRowId;
      if (row !== undefined) {
        const i = rowIds().indexOf(row);
        return DOMRect.fromRect({
          x: 0,
          y: 100 + i * ROW_H,
          width: 300,
          height: i === rowIds().length - 1 ? ROW_H - 1 : ROW_H,
        });
      }
      if (this === scroller())
        return DOMRect.fromRect({ x: 0, y: 100, width: 300, height: 300 });
      return DOMRect.fromRect({ x: 0, y: 2000, width: 0, height: 0 });
    }
  );
  return result;
}

const column = () => {
  const el = document.querySelector<HTMLElement>('[data-session-column]');
  if (el === null) throw new Error('no session column');
  return el;
};
const scroller = () =>
  document.querySelector('[data-session-column]')?.parentElement ?? null;
const place = () => document.querySelector('[data-new-session-place]');
const slot = () => column().getAttribute('data-new-session-slot');
const rowIds = () =>
  [
    ...document.querySelectorAll<HTMLElement>(
      '[data-session-column] [data-drag-row-id]'
    ),
  ].map((r) => r.dataset.dragRowId ?? '');
const lit = () =>
  document
    .querySelector('[data-new-session-target]')
    ?.hasAttribute('data-landing');

function carry(carried: CarriedRef = T1) {
  setDragging(true, carried.kind);
  beginDragHold();
  act(() =>
    startCarry(carried, { kind: 'tab', title: 't1', faviconUrl: '' }, 600, 200)
  );
}

describe('the New session place in the session list', () => {
  test('none at rest, nor while the carry is anywhere but the target', async () => {
    await renderPane();
    // PREMISE: two rows, S1 first.
    expect(rowIds()).toEqual(['S1', 'S2']);
    expect(place()).toBeNull();
    carry();
    fireEvent.pointerMove(document, ON_LIST);

    expect(lit()).toBe(false);
    expect(place()).toBeNull();
    expect(slot()).toBeNull();
  });

  test('on the target: lit, the place first in the column, and the column slides down one row', async () => {
    await renderPane();
    carry();
    fireEvent.pointerMove(document, ON_TARGET);

    expect(lit()).toBe(true);
    expect(slot()).toBe('open');
    expect(column().firstElementChild).toBe(place());
    // The distance between the first two rows: a row and its divider.
    expect(column().style.getPropertyValue('--new-session-pitch')).toBe(
      `${ROW_H}px`
    );
  });

  test('leaving the target: the place goes and the column slides back', async () => {
    await renderPane();
    carry();
    fireEvent.pointerMove(document, ON_TARGET);
    // PREMISE: open.
    expect(place()).not.toBeNull();

    fireEvent.pointerMove(document, ON_LIST);

    expect(lit()).toBe(false);
    expect(place()).toBeNull();
    expect(slot()).toBeNull();
  });

  test('Esc on the target slides it back', async () => {
    await renderPane();
    carry();
    fireEvent.pointerMove(document, ON_TARGET);
    expect(place()).not.toBeNull();

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(place()).toBeNull();
    expect(slot()).toBeNull();
  });

  test('a release on it: the new row is first in the same commit the place goes, and the column stops sliding', async () => {
    const { store } = await renderPane();
    carry();
    fireEvent.pointerMove(document, ON_TARGET);
    expect(place()).not.toBeNull();

    fireEvent.pointerUp(document, ON_TARGET);

    const made = store.getState().tabContainerDataState.tabGroups[0];
    expect(rowIds()).toEqual([made.tabGroupId, 'S1', 'S2']);
    expect(place()).toBeNull();
    // At once, not slid: the new row stands where the place was.
    expect(slot()).toBe('filled');
    // At rest once that frame is painted.
    await act(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
          )
        )
    );
    expect(slot()).toBeNull();
  });

  // The worst path: the release makes nothing, so nothing takes the place.
  // The layer's own order at a release: take, then leave. Without the layer,
  // which would end a carry of an item already gone before any release.
  test('a release that moves nothing slides it back', async () => {
    const { store } = await renderPane(undefined, false);
    carry(GONE);
    const r = carryReceiverAt(ON_TARGET.clientX, ON_TARGET.clientY);
    if (r === null) throw new Error('nothing takes a carry on the save row');
    act(() => r.hover(ON_TARGET.clientX, ON_TARGET.clientY));
    expect(place()).not.toBeNull();
    const before = store.getState().tabContainerDataState;

    let taken = true;
    act(() => {
      taken = r.take();
      r.leave();
    });

    expect(taken).toBe(false);
    expect(store.getState().tabContainerDataState).toBe(before);
    expect(rowIds()).toEqual(['S1', 'S2']);
    expect(place()).toBeNull();
    expect(slot()).toBeNull();
  });

  test('one row: the pitch is its height and the divider it gains', async () => {
    await renderPane([s1()]);
    carry();
    fireEvent.pointerMove(document, ON_TARGET);

    expect(slot()).toBe('open');
    // The last row has no divider: 59px, and the new row above it has one.
    expect(column().style.getPropertyValue('--new-session-pitch')).toBe(
      `${ROW_H}px`
    );
  });
});
