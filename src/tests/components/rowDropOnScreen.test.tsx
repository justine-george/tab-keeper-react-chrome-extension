import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, fireEvent } from '@testing-library/react';

import TabGroupEntryContainer from '../../components/home/leftpane/TabGroupEntryContainer';
import TabGroupDetailsContainer from '../../components/home/rightpane/TabGroupDetailsContainer';
import { CarryLayer } from '../../components/home/CarryLayer';
import { setDragging } from '../../components/home/rightpane/rowDrag/dropRules';
import { endCarry, startCarry, type CarryCard } from '../../redux/carry';
import { beginDragHold, endDragHold } from '../../redux/dragHold';
import {
  saveToTabContainerInternal,
  selectTabContainer,
  type CarriedRef,
  type tabContainerData,
} from '../../redux/slices/tabContainerDataStateSlice';
import {
  selectReopenOfferForKey,
  setIsNotDirty,
  showToast,
} from '../../redux/slices/globalStateSlice';
import { TOAST_MESSAGES } from '../../utils/constants/common';
import { renderWithProviders } from '../setup/renderWithProviders';
import {
  T0,
  group,
  s1,
  s2,
  s3,
  session,
  sessionIn,
  tab,
  tabIds,
  win,
  windowIds,
} from '../fixtures/sessionMoveFixture';

// KAN-350 final review: a carried item let go on a session ROW, the list and
// the detail rendered together.
//   - finding 1: a new window that would rebuild the window the item is
//     already alone in, first, changes nothing, and the carry is cancelled;
//   - finding 2: a window let go on its own session's row while another
//     session is on screen is announced as a tab or group there is;
//   - finding 5: a row drop that lands in the session on screen is followed
//     into view in the detail, as an adopted drop is (KAN-155).
//
// jsdom has no layout. The list's scroller sits at x 0..300, y 100..400,
// with 60px rows; the detail pane beside it at x 400..800.

const LIST_TOP = 100;
const LIST_H = 300;
const ROW_H = 60;
const X = 150;
const HOUR = 3_600_000;

// S9: the lone tab alone in the first window `only`, then w2.
const s9 = (): tabContainerData =>
  session('S9', 'Nine', T0 - 4 * HOUR, [
    win('only', [tab('lone')]),
    win('n2', [tab('x1'), tab('x2')]),
  ]);
// G9: the group gg is all of the first window `gw`, then n3.
const g9 = (): tabContainerData =>
  session('G9', 'Grouped', T0 - 5 * HOUR, [
    win('gw', [tab('gm1', 'gg'), tab('gm2', 'gg')], [group('gg')]),
    win('n3', [tab('y1')]),
  ]);

let frames: FrameRequestCallback[] = [];
const runFrames = (n: number) => {
  for (let i = 0; i < n; i++) {
    const due = frames;
    frames = [];
    due.forEach((cb) => cb(0));
  }
};

// Every element scrollIntoView was called on.
let scrolled: Element[] = [];

beforeEach(() => {
  frames = [];
  scrolled = [];
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
    frames.push(cb);
    return frames.length;
  });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
  vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(function (
    this: Element
  ) {
    scrolled.push(this);
  });
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
const releaseAt = (y: number, x = X) =>
  fireEvent.pointerUp(document, { clientX: x, clientY: y });
const wait = (ms: number) => act(() => vi.advanceTimersByTime(ms));

const targetIds = () =>
  [...document.querySelectorAll<HTMLElement>('[data-carry-target]')].map(
    (t) => t.closest<HTMLElement>('[data-drag-row-id]')?.dataset.dragRowId
  );

// As the engine leaves things at the hand-off: held, kind published,
// carried, the pointer out in the detail.
function handOff(carried: CarriedRef, card: CarryCard, onCancel?: () => void) {
  setDragging(true, carried.kind);
  beginDragHold();
  act(() => startCarry(carried, card, 600, 200, onCancel));
}

const TAB_CARD: CarryCard = { kind: 'tab', title: 't', faviconUrl: '' };
const GROUP_CARD: CarryCard = {
  kind: 'group',
  title: 'g',
  color: '#00f',
  tabCount: 2,
};
const WINDOW_CARD: CarryCard = { kind: 'window', title: 'w', tabCount: 1 };

const toastsOf = (
  store: Awaited<ReturnType<typeof render>>['store']
): { text: string; params: unknown; show: unknown }[] =>
  store.getState().globalState.toasts.map((t) => ({
    text: t.text,
    params: t.params,
    show: t.show,
  }));

describe('finding 1: on its own row, a new window that changes nothing', () => {
  test('a lone tab already alone in the first window: nothing moves, and the carry is cancelled', async () => {
    const { store } = await render([s9(), s3()], 'S9');
    const before = store.getState().tabContainerDataState;
    const onCancel = vi.fn();
    handOff(
      { kind: 'tab', tabGroupId: 'S9', windowId: 'only', tabId: 'lone' },
      TAB_CARD,
      onCancel
    );
    moveTo(rowY(0));
    expect(targetIds()).toEqual(['S9']);
    releaseAt(rowY(0));
    runFrames(1);

    expect(store.getState().tabContainerDataState).toBe(before);
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(store.getState().globalState.toasts).toEqual([]);
  });

  test('a group that is the whole first window: nothing moves, and the carry is cancelled', async () => {
    const { store } = await render([g9(), s3()], 'G9');
    const before = store.getState().tabContainerDataState;
    const onCancel = vi.fn();
    handOff(
      { kind: 'group', tabGroupId: 'G9', windowId: 'gw', groupId: 'gg' },
      GROUP_CARD,
      onCancel
    );
    moveTo(rowY(0));
    releaseAt(rowY(0));
    runFrames(1);

    expect(store.getState().tabContainerDataState).toBe(before);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  test('CONTROL: a lone tab in a window that is not first becomes the first window', async () => {
    const reversed = s9();
    reversed.windows.reverse();
    const { store } = await render([reversed, s3()], 'S9');
    handOff(
      { kind: 'tab', tabGroupId: 'S9', windowId: 'only', tabId: 'lone' },
      TAB_CARD
    );
    moveTo(rowY(0));
    releaseAt(rowY(0));

    const nine = sessionIn(store.getState().tabContainerDataState, 'S9');
    expect(tabIds(nine.windows[0])).toEqual(['lone']);
    expect(windowIds(nine).slice(1)).toEqual(['n2']);
  });
});

// The Show rule, for every kind on its own session's row: the Moved toast
// when the row's session was not on screen at the drop, and its Show while
// it is still not on screen after it. S1 is carried from, S2 is opened by a
// rest on its row, then the item is let go on S1's row.
describe('finding 2: on its own row with another session on screen, every kind is announced', () => {
  const cases: [string, CarriedRef, CarryCard][] = [
    [
      'a window',
      { kind: 'window', tabGroupId: 'S1', windowId: 'w2' },
      WINDOW_CARD,
    ],
    [
      'a tab',
      { kind: 'tab', tabGroupId: 'S1', windowId: 'w1', tabId: 't2' },
      TAB_CARD,
    ],
    [
      'a group',
      { kind: 'group', tabGroupId: 'S1', windowId: 'w1', groupId: 'g1' },
      GROUP_CARD,
    ],
  ];

  test.each(cases)('%s', async (_name, carried, card) => {
    const { store, scroller } = await render([s1(), s2(), s3()], 'S1');
    // A Reopen offer on screen, which a saved change announced takes ⌘Z
    // from (KAN-349 Q1 C′).
    await act(async () => {
      await store.dispatch(
        showToast({
          toastText: TOAST_MESSAGES.TAB_CLOSED,
          duration: 20_000,
          reopenOfferId: 7,
        })
      );
    });
    expect(selectReopenOfferForKey(store.getState())).toBe(7);
    handOff(carried, card);
    moveTo(rowY(1));
    wait(600);
    // PREMISE: S2 is on screen, and S1's row is where it was.
    expect(store.getState().tabContainerDataState.selectedTabGroupId).toBe(
      'S2'
    );
    layOutRows(scroller);
    moveTo(rowY(0));
    expect(targetIds()).toEqual(['S1']);
    releaseAt(rowY(0));

    const state = store.getState().tabContainerDataState;
    // PREMISE: it moved, to S1's first window.
    expect(windowIds(sessionIn(state, 'S1'))).toHaveLength(
      carried.kind === 'window' ? 2 : 3
    );
    const moved = () =>
      toastsOf(store).filter((t) => t.text !== TOAST_MESSAGES.TAB_CLOSED);
    expect(moved()).toEqual([
      {
        text: TOAST_MESSAGES.MOVED_TO_SESSION,
        params: { title: 'Source' },
        show: { tabGroupId: 'S1' },
      },
    ]);
    // The same toast moveToSession sends: a saved change, which takes ⌘Z
    // from the offer, and 8s long.
    expect(selectReopenOfferForKey(store.getState())).toBeNull();
    wait(7_999);
    expect(moved()).toHaveLength(1);
    wait(1);
    expect(moved()).toEqual([]);
  });

  test('CONTROL: a window on its own row with its own session on screen is not announced', async () => {
    const { store } = await render([s1(), s2(), s3()], 'S1');
    handOff({ kind: 'window', tabGroupId: 'S1', windowId: 'w2' }, WINDOW_CARD);
    moveTo(rowY(0));
    releaseAt(rowY(0));

    expect(
      windowIds(sessionIn(store.getState().tabContainerDataState, 'S1'))
    ).toEqual(['w2', 'w1']);
    expect(store.getState().globalState.toasts).toEqual([]);
  });

  test('CONTROL: a window already first on its own row moves nothing, and is not announced', async () => {
    const { store, scroller } = await render([s1(), s2(), s3()], 'S1');
    handOff({ kind: 'window', tabGroupId: 'S1', windowId: 'w1' }, WINDOW_CARD);
    moveTo(rowY(1));
    wait(600);
    layOutRows(scroller);
    moveTo(rowY(0));
    const before = store.getState().tabContainerDataState;
    releaseAt(rowY(0));

    expect(store.getState().tabContainerDataState).toBe(before);
    expect(store.getState().globalState.toasts).toEqual([]);
  });
});

// A row drop that lands in the session on screen puts a new first window at
// the TOP of the detail, which may be scrolled away from it: followed on the
// next frame, as an adopted drop is (KAN-155).
describe('finding 5: a row drop into the session on screen is followed into view', () => {
  const detailRow = (pane: HTMLElement, id: string) => {
    const el = pane.querySelector(`[data-drag-row-id="${CSS.escape(id)}"]`);
    if (el === null) throw new Error(`no detail row ${id}`);
    return el;
  };
  const inDetail = (pane: HTMLElement) =>
    scrolled.filter((el) => pane.contains(el));

  test('a tab on its own row: the new first window, on the next frame', async () => {
    const { store, pane } = await render([s1(), s2(), s3()], 'S1');
    handOff(
      { kind: 'tab', tabGroupId: 'S1', windowId: 'w1', tabId: 't2' },
      TAB_CARD
    );
    moveTo(rowY(0));
    releaseAt(rowY(0));
    const first = sessionIn(store.getState().tabContainerDataState, 'S1')
      .windows[0];
    // PREMISE: a new window, first.
    expect(tabIds(first)).toEqual(['t2']);
    expect(inDetail(pane)).toEqual([]);

    runFrames(1);
    expect(inDetail(pane)).toEqual([detailRow(pane, first.windowId)]);
    const [call] = vi
      .mocked(Element.prototype.scrollIntoView)
      .mock.calls.filter((_, i) => pane.contains(scrolled[i] ?? null));
    expect(call).toEqual([{ block: 'nearest' }]);
  });

  test('a window on its own row: that window, now first', async () => {
    const { store, pane } = await render([s1(), s2(), s3()], 'S1');
    handOff({ kind: 'window', tabGroupId: 'S1', windowId: 'w2' }, WINDOW_CARD);
    moveTo(rowY(0));
    releaseAt(rowY(0));
    runFrames(1);

    expect(
      windowIds(sessionIn(store.getState().tabContainerDataState, 'S1'))
    ).toEqual(['w2', 'w1']);
    expect(inDetail(pane)).toEqual([detailRow(pane, 'w2')]);
  });

  test('after a spring-open, on the opened session’s row: its new first window', async () => {
    const { store, scroller, pane } = await render([s1(), s2(), s3()], 'S1');
    handOff(
      { kind: 'tab', tabGroupId: 'S1', windowId: 'w1', tabId: 't2' },
      TAB_CARD
    );
    moveTo(rowY(1));
    wait(600);
    layOutRows(scroller);
    moveTo(rowY(1));
    releaseAt(rowY(1));
    runFrames(1);

    const first = sessionIn(store.getState().tabContainerDataState, 'S2')
      .windows[0];
    expect(tabIds(first)).toEqual(['t2']);
    expect(inDetail(pane)).toEqual([detailRow(pane, first.windowId)]);
  });

  test('CONTROL: a drop on another session’s row follows nothing in the detail', async () => {
    const { store, pane } = await render([s1(), s2(), s3()], 'S1');
    handOff(
      { kind: 'tab', tabGroupId: 'S1', windowId: 'w1', tabId: 't2' },
      TAB_CARD
    );
    moveTo(rowY(1));
    releaseAt(rowY(1));
    runFrames(2);

    // PREMISE: it moved, into S2, which is not on screen.
    expect(
      tabIds(sessionIn(store.getState().tabContainerDataState, 'S2').windows[0])
    ).toEqual(['t2']);
    expect(store.getState().tabContainerDataState.selectedTabGroupId).toBe(
      'S1'
    );
    expect(inDetail(pane)).toEqual([]);
  });

  // Window ids can repeat across sessions in legacy data and imports: the
  // session on screen holding a window of the landed one's id is still not
  // where the drop landed.
  test('CONTROL: a drop on a row not on screen follows nothing, even a same-id window on screen', async () => {
    const twin = s2();
    twin.windows[1].windowId = 'w2';
    const { store, scroller, pane } = await render([s1(), twin, s3()], 'S1');
    handOff({ kind: 'window', tabGroupId: 'S1', windowId: 'w2' }, WINDOW_CARD);
    moveTo(rowY(1));
    wait(600);
    layOutRows(scroller);
    moveTo(rowY(2));
    expect(targetIds()).toEqual(['S3']);
    releaseAt(rowY(2));
    runFrames(2);

    const state = store.getState().tabContainerDataState;
    // PREMISE: it landed first in S3, and S2 -- on screen -- has a w2 too.
    expect(windowIds(sessionIn(state, 'S3'))).toEqual(['w2', 'x1']);
    expect(state.selectedTabGroupId).toBe('S2');
    expect(pane.querySelector('[data-drag-row-id="w2"]')).not.toBeNull();
    expect(inDetail(pane)).toEqual([]);
  });

  test('CONTROL: a drop that moves nothing follows nothing', async () => {
    const { pane } = await render([s9(), s3()], 'S9');
    handOff(
      { kind: 'tab', tabGroupId: 'S9', windowId: 'only', tabId: 'lone' },
      TAB_CARD
    );
    moveTo(rowY(0));
    releaseAt(rowY(0));
    runFrames(2);

    expect(inDetail(pane)).toEqual([]);
  });
});
