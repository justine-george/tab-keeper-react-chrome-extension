import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, fireEvent } from '@testing-library/react';

import TabGroupEntryContainer from '../../components/home/leftpane/TabGroupEntryContainer';
import TabGroupDetailsContainer from '../../components/home/rightpane/TabGroupDetailsContainer';
import { CarryLayer } from '../../components/home/CarryLayer';
import { SPRING_OPEN_MS } from '../../components/home/leftpane/springOpen';
import { edgeScrollStep } from '../../components/home/rightpane/rowDrag/edgeScroll';
import { setDragging } from '../../components/home/rightpane/rowDrag/dropRules';
import {
  carryReceiverAt,
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
} from '../../redux/slices/tabContainerDataStateSlice';
import {
  openSearchPanel,
  setIsNotDirty,
} from '../../redux/slices/globalStateSlice';
import { LIGHT_THEME } from '../../hooks/useThemeColors';
import { TOAST_MESSAGES } from '../../utils/constants/common';
import { FakeMediaQueryList } from '../setup/mediaQueryFake';
import { renderWithProviders } from '../setup/renderWithProviders';
import { toastTexts } from '../setup/toasts';
import {
  T0,
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

// KAN-350 Task 4. The saved session list takes a carry: the row under the
// pointer is the target (D2 A), resting on it for 600ms opens that session
// (S1 A), and letting go on it moves the carried item in as a new first
// window (S2 A).
//
// jsdom has no layout, so the list's scroller and rows get boxes here: a
// 300px scroller at y 100..400, 60px rows, six sessions -- the sixth below
// the fold. Rows are laid out against the scroller's scrollTop, as a real
// list is, so a hit read in the wrong space names the wrong row once the list
// has scrolled.

const LIST_TOP = 100;
const LIST_H = 300;
const ROW_H = 60;
const X = 150;

// S1 is shown (selected), and holds the carried items. S4..S6 are extra
// sessions so the list is taller than its scroller.
const s4 = () =>
  session('S4', 'Four', T0 - 4 * 3_600_000, [win('y1', [tab('z1')])]);
const s5 = () =>
  session('S5', 'Five', T0 - 5 * 3_600_000, [win('y2', [tab('z2')])]);
const s6 = () =>
  session('S6', 'Six', T0 - 6 * 3_600_000, [win('y3', [tab('z3')])]);

const TAB: CarriedRef = {
  kind: 'tab',
  tabGroupId: 'S1',
  windowId: 'w1',
  tabId: 't2',
};
const TAB_CARD: CarryCard = { kind: 'tab', title: 't2', faviconUrl: '' };

let frames: FrameRequestCallback[] = [];
const runFrames = (n: number) => {
  for (let i = 0; i < n; i++) {
    const due = frames;
    frames = [];
    due.forEach((cb) => cb(0));
  }
};

beforeEach(() => {
  frames = [];
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
    frames.push(cb);
    return frames.length;
  });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
});

afterEach(() => {
  act(() => endCarry('cancelled'));
  endDragHold();
  document.documentElement.removeAttribute('data-dragging');
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function renderList() {
  const result = await renderWithProviders(
    <>
      <TabGroupEntryContainer />
      <CarryLayer />
    </>,
    {
      seedStore: (store) => {
        // Saved oldest first; each save goes on top, so the list reads
        // S1, S2, S3, S4, S5, S6.
        for (const s of [s6(), s5(), s4(), s3(), s2(), s1()]) {
          store.dispatch(saveToTabContainerInternal(s));
        }
        store.dispatch(selectTabContainer('S1'));
        store.dispatch(setIsNotDirty());
      },
    }
  );
  // Timers are faked after the render: i18n's init must settle first.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  vi.setSystemTime(T0);
  const scroller = result.container.firstElementChild;
  if (!(scroller instanceof HTMLElement)) throw new Error('no list');
  layOut(scroller);
  return { ...result, scroller };
}

function layOut(scroller: HTMLElement, rowH = ROW_H) {
  const rows = rowEls();
  Object.defineProperty(scroller, 'clientHeight', {
    value: LIST_H,
    configurable: true,
  });
  Object.defineProperty(scroller, 'scrollHeight', {
    value: rows.length * rowH,
    configurable: true,
  });
  scroller.getBoundingClientRect = () =>
    DOMRect.fromRect({ x: 0, y: LIST_TOP, width: 300, height: LIST_H });
  rows.forEach((row, i) => {
    row.getBoundingClientRect = () =>
      DOMRect.fromRect({
        x: 0,
        y: LIST_TOP + i * rowH - scroller.scrollTop,
        width: 300,
        height: rowH,
      });
  });
}

const rowEls = () => [
  ...document.querySelectorAll<HTMLElement>('[data-drag-row-id]'),
];
const rowIds = () => rowEls().map((r) => r.dataset.dragRowId);

// The viewport y of the middle of the i-th row, with the list unscrolled.
const rowY = (i: number) => LIST_TOP + i * ROW_H + ROW_H / 2;

function rowOf(id: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-drag-row-id="${id}"]`);
  if (el === null) throw new Error(`no row ${id}`);
  return el;
}

// The element that wears the target look: TabGroupEntry's own container.
function entryOf(id: string): HTMLElement {
  const el = rowOf(id).firstElementChild;
  if (!(el instanceof HTMLElement)) throw new Error(`no entry for ${id}`);
  return el;
}

const targets = () => [
  ...document.querySelectorAll<HTMLElement>('[data-carry-target]'),
];
const targetId = () => {
  const all = targets();
  if (all.length === 0) return null;
  return all.map(
    (t) => t.closest<HTMLElement>('[data-drag-row-id]')?.dataset.dragRowId
  );
};
const sweeps = () => [
  ...document.querySelectorAll<HTMLElement>('[data-carry-dwell]'),
];

// As the engine leaves things at the hand-off: held, kind published, carried,
// the pointer out in the detail pane to the right of the list.
function handOff(
  carried: CarriedRef = TAB,
  card: CarryCard = TAB_CARD,
  onCancel?: () => void
) {
  setDragging(true, carried.kind);
  beginDragHold();
  act(() => startCarry(carried, card, 600, 200, onCancel));
}

const moveTo = (y: number, x = X) =>
  fireEvent.pointerMove(document, { clientX: x, clientY: y });
const releaseAt = (y: number, x = X) =>
  fireEvent.pointerUp(document, { clientX: x, clientY: y });
const wait = (ms: number) => act(() => vi.advanceTimersByTime(ms));

describe('the premise', () => {
  test('six rows, S1 first and selected, S6 below the fold', async () => {
    await renderList();
    expect(rowIds()).toEqual(['S1', 'S2', 'S3', 'S4', 'S5', 'S6']);
    expect(rowY(5)).toBeGreaterThan(LIST_TOP + LIST_H);
  });
});

describe('dwell and spring-open (S1 A)', () => {
  test('599ms on a row opens nothing, and 600ms opens it', async () => {
    const { store } = await renderList();
    handOff();
    moveTo(rowY(2));

    expect(targetId()).toEqual(['S3']);
    wait(599);
    expect(store.getState().tabContainerDataState.selectedTabGroupId).toBe(
      'S1'
    );
    wait(1);
    expect(store.getState().tabContainerDataState.selectedTabGroupId).toBe(
      'S3'
    );
  });

  test('a pass over three rows opens none', async () => {
    const { store } = await renderList();
    handOff();
    moveTo(rowY(1));
    wait(300);
    moveTo(rowY(2));
    wait(300);
    moveTo(rowY(3));
    wait(300);
    // Out of the list, back towards the detail.
    moveTo(200, 600);
    wait(2000);

    expect(store.getState().tabContainerDataState.selectedTabGroupId).toBe(
      'S1'
    );
    expect(targets()).toEqual([]);
  });

  test('moving to another row restarts the wait there', async () => {
    const { store } = await renderList();
    handOff();
    moveTo(rowY(1));
    wait(400);
    moveTo(rowY(2));
    wait(599);
    expect(store.getState().tabContainerDataState.selectedTabGroupId).toBe(
      'S1'
    );
    wait(1);
    expect(store.getState().tabContainerDataState.selectedTabGroupId).toBe(
      'S3'
    );
  });

  test('moving within one row does not restart the wait', async () => {
    const { store } = await renderList();
    handOff();
    moveTo(rowY(2) - 20);
    wait(300);
    moveTo(rowY(2) + 20);
    wait(300);
    expect(store.getState().tabContainerDataState.selectedTabGroupId).toBe(
      'S3'
    );
  });

  test('the sweep is on the target row, from the same change as the attribute', async () => {
    await renderList();
    handOff();
    moveTo(rowY(2));

    expect(sweeps()).toEqual([entryOf('S3')]);

    moveTo(rowY(3));
    expect(sweeps()).toEqual([entryOf('S4')]);
  });

  test('after the spring-open the row is the session shown: its sweep goes and no timer runs', async () => {
    const { store } = await renderList();
    handOff();
    moveTo(rowY(2));
    wait(600);
    expect(store.getState().tabContainerDataState.selectedTabGroupId).toBe(
      'S3'
    );

    // Still the target (the outline stays), but no sweep and no timer.
    expect(targetId()).toEqual(['S3']);
    expect(sweeps()).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  test('the shown session’s row gets the outline, but no sweep and no timer', async () => {
    const { store } = await renderList();
    handOff();
    moveTo(rowY(0));

    expect(targetId()).toEqual(['S1']);
    expect(sweeps()).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
    wait(2000);
    expect(store.getState().tabContainerDataState.selectedTabGroupId).toBe(
      'S1'
    );
  });
});

describe('reduced motion', () => {
  test('no sweep: the row lights in full at once, and still opens at 600ms', async () => {
    vi.spyOn(window, 'matchMedia').mockImplementation(
      (query: string) =>
        new FakeMediaQueryList(
          query,
          query === '(prefers-reduced-motion: reduce)'
        )
    );
    const { store } = await renderList();
    handOff();
    moveTo(rowY(2));

    expect(targetId()).toEqual(['S3']);
    expect(sweeps()).toEqual([]);
    expect(getComputedStyle(entryOf('S3')).boxShadow).toMatch(
      asWritten(LIGHT_THEME.HOVER_COLOR)
    );
    wait(599);
    expect(store.getState().tabContainerDataState.selectedTabGroupId).toBe(
      'S1'
    );
    wait(1);
    expect(store.getState().tabContainerDataState.selectedTabGroupId).toBe(
      'S3'
    );
  });
});

describe('the target look (D2 A)', () => {
  test('the attribute sits on exactly one row, the one under the pointer', async () => {
    await renderList();
    handOff();
    expect(targets()).toEqual([]);

    moveTo(rowY(1));
    expect(targetId()).toEqual(['S2']);
    moveTo(rowY(4));
    expect(targetId()).toEqual(['S5']);
  });

  test('it is gone after Esc', async () => {
    await renderList();
    handOff();
    moveTo(rowY(1));
    expect(targets()).toHaveLength(1);

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(currentCarry()).toBeNull();
    expect(targets()).toEqual([]);
    expect(sweeps()).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  test('it is gone after a release on a row', async () => {
    await renderList();
    handOff();
    moveTo(rowY(1));
    releaseAt(rowY(1));

    expect(currentCarry()).toBeNull();
    expect(targets()).toEqual([]);
    expect(sweeps()).toEqual([]);
  });

  test('it is gone when the pointer leaves the list', async () => {
    await renderList();
    handOff();
    moveTo(rowY(1));
    moveTo(rowY(1), 600);

    expect(targets()).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  test('a selected row shows the hover fill, not the selection fill, with a LABEL_L2 outline', async () => {
    await renderList();
    const selected = entryOf('S1');
    // The premise: the selected row at rest is its selection fill, no shadow
    // fill over it and no outline.
    expect(getComputedStyle(selected).backgroundColor).toBe(
      hexToRgb(LIGHT_THEME.SELECTION_COLOR)
    );
    expect(getComputedStyle(selected).boxShadow).toContain('transparent');
    expect(getComputedStyle(selected).outlineStyle).not.toBe('solid');

    handOff();
    moveTo(rowY(0));

    const style = getComputedStyle(entryOf('S1'));
    // The shadow paints over the background, so the row reads as hover.
    expect(style.boxShadow).toContain('100vw');
    expect(style.boxShadow).toMatch(asWritten(LIGHT_THEME.HOVER_COLOR));
    expect(style.outlineStyle).toBe('solid');
    expect(style.outlineWidth).toBe('2px');
    expect(style.outlineColor).toMatch(asWritten(LIGHT_THEME.LABEL_L2_COLOR));
    expect(style.outlineOffset).toBe('-2px');
  });

  test('an unselected target row sweeps the hover fill in over the dwell, inside the same outline', async () => {
    await renderList();
    handOff();
    moveTo(rowY(2));

    const style = getComputedStyle(entryOf('S3'));
    // The sweep is the only fill: the shadow fill would cover it.
    expect(style.boxShadow).not.toMatch(asWritten(LIGHT_THEME.HOVER_COLOR));
    expect(style.backgroundImage).toMatch(asWritten(LIGHT_THEME.HOVER_COLOR));
    expect(style.backgroundRepeat).toBe('no-repeat');
    // jsdom keeps the shorthand as written; e2e reads the painted sweep.
    expect(style.animation).toMatch(
      new RegExp(` ${SPRING_OPEN_MS}ms linear forwards$`)
    );
    expect(style.outlineStyle).toBe('solid');
    // And the row next to it wears none of it.
    expect(getComputedStyle(entryOf('S2')).outlineStyle).not.toBe('solid');
    expect(getComputedStyle(entryOf('S2')).backgroundImage).not.toMatch(
      asWritten(LIGHT_THEME.HOVER_COLOR)
    );
  });
});

describe('a release on a row moves the item in (S2 A)', () => {
  test('a tab becomes the new first window of that session, with a Moved toast', async () => {
    const { store } = await renderList();
    handOff();
    moveTo(rowY(1));
    releaseAt(rowY(1));

    const state = store.getState().tabContainerDataState;
    const target = sessionIn(state, 'S2');
    expect(target.windows).toHaveLength(3);
    expect(tabIds(target.windows[0])).toEqual(['t2']);
    expect(windowIds(target).slice(1)).toEqual(['d1', 'd2']);
    expect(tabIds(sessionIn(state, 'S1').windows[0])).not.toContain('t2');
    expect(toastTexts(store.getState())).toContain(
      TOAST_MESSAGES.MOVED_TO_SESSION
    );
  });

  test('a group becomes the new first window of that session', async () => {
    const { store } = await renderList();
    handOff(
      { kind: 'group', tabGroupId: 'S1', windowId: 'w1', groupId: 'g1' },
      { kind: 'group', title: 'Group g1', color: '#00f', tabCount: 2 }
    );
    moveTo(rowY(1));
    releaseAt(rowY(1));

    const state = store.getState().tabContainerDataState;
    const target = sessionIn(state, 'S2');
    expect(tabIds(target.windows[0])).toEqual(['g1a', 'g1b']);
    expect(target.windows[0].chromeTabGroups?.map((g) => g.groupId)).toEqual([
      'g1',
    ]);
    expect(tabIds(sessionIn(state, 'S1').windows[0])).toEqual([
      't1',
      't2',
      't4',
    ]);
  });

  test('a window becomes the first window of that session', async () => {
    const { store } = await renderList();
    handOff(
      { kind: 'window', tabGroupId: 'S1', windowId: 'w2' },
      { kind: 'window', title: 'Window w2', tabCount: 1 }
    );
    moveTo(rowY(1));
    releaseAt(rowY(1));

    const state = store.getState().tabContainerDataState;
    expect(windowIds(sessionIn(state, 'S2'))).toEqual(['w2', 'd1', 'd2']);
    expect(windowIds(sessionIn(state, 'S1'))).toEqual(['w1']);
  });

  test('a window on its own session’s row becomes its first window, with no Moved toast', async () => {
    const { store } = await renderList();
    handOff(
      { kind: 'window', tabGroupId: 'S1', windowId: 'w2' },
      { kind: 'window', title: 'Window w2', tabCount: 1 }
    );
    moveTo(rowY(0));
    releaseAt(rowY(0));

    const state = store.getState().tabContainerDataState;
    expect(windowIds(sessionIn(state, 'S1'))).toEqual(['w2', 'w1']);
    expect(toastTexts(store.getState())).not.toContain(
      TOAST_MESSAGES.MOVED_TO_SESSION
    );
  });

  test('a window already first, on its own row: nothing moves, and the carry is cancelled', async () => {
    const { store } = await renderList();
    const onCancel = vi.fn();
    const before = store.getState().tabContainerDataState;
    handOff(
      { kind: 'window', tabGroupId: 'S1', windowId: 'w1' },
      { kind: 'window', title: 'Window w1', tabCount: 5 },
      onCancel
    );
    moveTo(rowY(0));
    releaseAt(rowY(0));
    runFrames(1);

    expect(store.getState().tabContainerDataState).toBe(before);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  test('a committed row drop does not put the source’s view back', async () => {
    await renderList();
    const onCancel = vi.fn();
    handOff(TAB, TAB_CARD, onCancel);
    moveTo(rowY(1));
    releaseAt(rowY(1));
    runFrames(1);

    expect(onCancel).not.toHaveBeenCalled();
  });

  test('a tab on the shown session’s row (its own) becomes a new first window there, with no Moved toast', async () => {
    const { store } = await renderList();
    handOff();
    moveTo(rowY(0));
    releaseAt(rowY(0));

    const state = store.getState().tabContainerDataState;
    const shown = sessionIn(state, 'S1');
    expect(shown.windows).toHaveLength(3);
    expect(tabIds(shown.windows[0])).toEqual(['t2']);
    expect(toastTexts(store.getState())).not.toContain(
      TOAST_MESSAGES.MOVED_TO_SESSION
    );
  });

  test('a row drop after a spring-open is a drop on the session shown: no Moved toast', async () => {
    const { store } = await renderList();
    handOff();
    moveTo(rowY(1));
    wait(600);
    releaseAt(rowY(1));

    const state = store.getState().tabContainerDataState;
    expect(tabIds(sessionIn(state, 'S2').windows[0])).toEqual(['t2']);
    expect(toastTexts(store.getState())).not.toContain(
      TOAST_MESSAGES.MOVED_TO_SESSION
    );
  });

  test('a release in the list but on no row moves nothing', async () => {
    const { store, scroller } = await renderList();
    // Only the first two rows laid out; the rest of the scroller is empty.
    layOut(scroller);
    rowEls()
      .slice(2)
      .forEach((row) => {
        row.getBoundingClientRect = () =>
          DOMRect.fromRect({ x: 0, y: 5000, width: 300, height: ROW_H });
      });
    const before = store.getState().tabContainerDataState;
    handOff();
    moveTo(rowY(3));
    expect(targets()).toEqual([]);
    releaseAt(rowY(3));

    expect(currentCarry()).toBeNull();
    expect(store.getState().tabContainerDataState).toBe(before);
  });
});

describe('auto-scroll', () => {
  test('resting near the bottom edge reaches a row below the fold, and the release lands on it', async () => {
    const { store, scroller } = await renderList();
    handOff();
    // 10px above the scroller's bottom: in the edge zone, over row S5.
    const y = LIST_TOP + LIST_H - 10;
    moveTo(y);
    expect(targetId()).toEqual(['S5']);

    act(() => runFrames(20));
    // Scrolled to the end: 6 rows of 60 in a 300px scroller.
    expect(scroller.scrollTop).toBe(60);
    expect(targetId()).toEqual(['S6']);

    releaseAt(y);
    const state = store.getState().tabContainerDataState;
    expect(tabIds(sessionIn(state, 'S6').windows[0])).toEqual(['t2']);
    expect(sessionIn(state, 'S5').windows).toHaveLength(1);
  });

  test('CONTROL: in the middle of the list, nothing scrolls', async () => {
    const { scroller } = await renderList();
    handOff();
    moveTo(rowY(2));
    act(() => runFrames(20));
    expect(scroller.scrollTop).toBe(0);
  });

  test('the rows are re-measured on the next entry', async () => {
    const { store, scroller } = await renderList();
    handOff();
    moveTo(rowY(1));
    expect(targetId()).toEqual(['S2']);
    // Out, and the rows change height while the pointer is away.
    moveTo(rowY(1), 600);
    layOut(scroller, 30);
    // Back in at the same y: with 30px rows that is the fourth row, S4.
    moveTo(rowY(1));
    expect(targetId()).toEqual(['S4']);
    releaseAt(rowY(1));
    expect(
      tabIds(sessionIn(store.getState().tabContainerDataState, 'S4').windows[0])
    ).toEqual(['t2']);
  });
});

describe('the saved search panel', () => {
  test('while it is open the list is no receiver', async () => {
    const { store } = await renderList();
    // CONTROL: closed, the list is what a point on a row hits.
    expect(carryReceiverAt(X, rowY(1))).not.toBeNull();

    act(() => {
      store.dispatch(openSearchPanel());
    });

    expect(carryReceiverAt(X, rowY(1))).toBeNull();
  });

  test('opened mid-carry, it ends the carry and the target look', async () => {
    const { store } = await renderList();
    const before = store.getState().tabContainerDataState;
    handOff();
    moveTo(rowY(1));
    expect(targets()).toHaveLength(1);

    act(() => {
      store.dispatch(openSearchPanel());
    });

    expect(currentCarry()).toBeNull();
    expect(targets()).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
    releaseAt(rowY(1));
    expect(store.getState().tabContainerDataState.tabGroups).toBe(
      before.tabGroups
    );
  });
});

describe('from a real drag out of the detail', () => {
  // The list at x 0..300 as above; the detail pane beside it at x 400..800.
  async function renderBoth() {
    const result = await renderWithProviders(
      <>
        <TabGroupEntryContainer />
        <TabGroupDetailsContainer />
        <CarryLayer />
      </>,
      {
        seedStore: (store) => {
          for (const s of [s6(), s5(), s4(), s3(), s2(), s1()]) {
            store.dispatch(saveToTabContainerInternal(s));
          }
          store.dispatch(selectTabContainer('S1'));
          store.dispatch(setIsNotDirty());
        },
      }
    );
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    vi.setSystemTime(T0);
    const [scroller, pane] = [...result.container.children];
    if (!(scroller instanceof HTMLElement) || !(pane instanceof HTMLElement)) {
      throw new Error('no list or pane');
    }
    pane.style.overflowY = 'auto';
    pane.getBoundingClientRect = () =>
      DOMRect.fromRect({ x: 400, y: 0, width: 400, height: 500 });
    layOut(scroller);
    return result;
  }

  // Pressed in the detail, past the activation distance, then out of the
  // pane's left edge and over the list.
  function dragTabOutToList(y: number) {
    const t2 = document.querySelector<HTMLElement>('[data-drag-row-id="t2"]');
    if (t2 === null) throw new Error('no t2');
    fireEvent.pointerDown(t2, { clientX: 420, clientY: 10, button: 0 });
    fireEvent.pointerMove(document, { clientX: 420, clientY: 30 });
    act(() => {
      fireEvent.pointerMove(document, { clientX: X, clientY: y });
    });
    moveTo(y);
  }

  test('let go on a row: the tab is that session’s new first window', async () => {
    const { store } = await renderBoth();
    dragTabOutToList(rowY(1));
    expect(currentCarry()?.carried).toMatchObject({ tabId: 't2' });
    expect(targetId()).toEqual(['S2']);

    releaseAt(rowY(1));

    const state = store.getState().tabContainerDataState;
    expect(tabIds(sessionIn(state, 'S2').windows[0])).toEqual(['t2']);
    expect(currentCarry()).toBeNull();
    expect(targets()).toEqual([]);
  });

  test('rest on a row: that session opens in the detail, and the carry goes on', async () => {
    const { store } = await renderBoth();
    dragTabOutToList(rowY(1));
    wait(600);

    expect(store.getState().tabContainerDataState.selectedTabGroupId).toBe(
      'S2'
    );
    expect(document.querySelector('[data-drag-row-id="u1"]')).not.toBeNull();
    expect(currentCarry()?.carried).toMatchObject({ tabId: 't2' });
  });
});

describe('edgeScrollStep', () => {
  const box = { top: 0, bottom: 300, height: 300 };
  test('0 in the middle, up near the top, down near the bottom', () => {
    expect(edgeScrollStep(box, 150)).toBe(0);
    expect(edgeScrollStep(box, 10)).toBeLessThan(0);
    expect(edgeScrollStep(box, 290)).toBeGreaterThan(0);
  });
  test('deeper is faster, capped at the edge', () => {
    expect(edgeScrollStep(box, 280)).toBeLessThan(edgeScrollStep(box, 295));
    expect(edgeScrollStep(box, 300)).toBe(edgeScrollStep(box, 400));
  });
});

/** A colour as emotion writes it, or as jsdom normalises it. */
function asWritten(hex: string): RegExp {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return new RegExp(`(${hex}|rgb\\(${r}, ?${g}, ?${b}\\))`, 'i');
}

function hexToRgb(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `rgb(${r}, ${g}, ${b})`;
}
