import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, fireEvent } from '@testing-library/react';

import TabGroupDetailsContainer from '../../components/home/rightpane/TabGroupDetailsContainer';
import { CarryLayer } from '../../components/home/CarryLayer';
import {
  setDragNewWindow,
  setDragging,
} from '../../components/home/rightpane/rowDrag/dropRules';
import {
  currentCarry,
  endCarry,
  startCarry,
  type CarryCard,
} from '../../redux/carry';
import * as dragHold from '../../redux/dragHold';
import { beginDragHold, endDragHold, isDragHeld } from '../../redux/dragHold';
import { dropOnTop } from '../../redux/dropOnTop';
import { groupDrop, tabDrop, windowDrop } from '../../redux/dropSpecs';
import {
  deleteTab,
  saveToTabContainerInternal,
  selectTabContainer,
  type CarriedRef,
} from '../../redux/slices/tabContainerDataStateSlice';
import {
  setSearchInputText,
  setHasTabGroupsPermission,
  setIsNotDirty,
} from '../../redux/slices/globalStateSlice';
import { LIGHT_THEME } from '../../hooks/useThemeColors';
import {
  NEW_LAST_WINDOW,
  markNewWindowTarget,
} from '../../components/home/rightpane/newWindowTarget';
import { renderWithProviders } from '../setup/renderWithProviders';
import { standInSessionList } from '../setup/standInSessionList';
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
  windowIn,
} from '../fixtures/sessionMoveFixture';

// KAN-350 Task 5. The session on screen takes a carried item at an EXACT
// spot. While a tab, group or window is carried, the detail draws it as a
// PHANTOM row -- a tab or group in the trailing block after the last window
// (KAN-361/366), a window as the first window -- and when the pointer comes
// into the
// pane the matching drag area ADOPTS that row as an ordinary drag: every
// landing, band, gap and auto-scroll rule is the engine's own, and a release
// commits the move.
//
// S1: w1 [t1, g1a*g1, g1b*g1, t2, t4*g2], w2 [t3]. S2: d1 [u1, u2*h1,
// u3*h1], d2 [u4].
//
// jsdom has no layout. Every box the engine reads is given one here, in the
// pane's content space, less the pane's scrollTop -- as a real layout
// reports it. Anything not listed measures as a zero box.

const PANE_W = 400;
const X = 100;

type Table = Record<string, [top: number, height: number]>;
let table: Table = {};
let pane: HTMLElement | null = null;

// Which entry of the table an element answers to.
function keyOf(el: Element): string | undefined {
  if (!(el instanceof HTMLElement)) return undefined;
  const d = el.dataset;
  if (d.dragRowId !== undefined) return `row:${d.dragRowId}`;
  if (d.dropWindowId !== undefined) return `win:${d.dropWindowId}`;
  if (d.fixedRowId !== undefined) return `fixed:${d.fixedRowId}`;
  if (d.bandId !== undefined) return `band:${d.bandId}`;
  if (d.newWindowTarget === 'first') return 'header:new-window';
  return undefined;
}

function rectOf(el: Element): DOMRect {
  if (el === pane) {
    return DOMRect.fromRect({ x: 0, y: 0, width: PANE_W, height: paneH });
  }
  const key = keyOf(el);
  const entry = key === undefined ? undefined : table[key];
  if (entry === undefined) return DOMRect.fromRect({});
  const [top, height] = entry;
  // A block the preview moved reports its moved box, as a real rect does
  // (see paneWideTabDrag's measureWindows).
  const shift =
    el instanceof HTMLElement
      ? parseFloat(el.dataset.windowShift ?? '') || 0
      : 0;
  const scroll = pane?.scrollTop ?? 0;
  return DOMRect.fromRect({
    x: 0,
    y: top - scroll + shift,
    width: PANE_W,
    height,
  });
}

let paneH = 500;
let frames: FrameRequestCallback[] = [];
const runFrames = (n: number) => {
  for (let i = 0; i < n; i++) {
    const due = frames;
    frames = [];
    due.forEach((cb) => cb(0));
  }
};

// The session list, stood in left of the pane (x < 0), where the app draws
// it: an adopted drag hands its carry back only there (KAN-352).
let unregisterList = () => {};
beforeEach(() => {
  unregisterList = standInSessionList({
    left: -400,
    right: 0,
    top: 0,
    bottom: 1000,
  }).unregister;
  table = {};
  pane = null;
  paneH = 500;
  frames = [];
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
    frames.push(cb);
    return frames.length;
  });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
  // Every store here is seeded and moved at one pinned time, so a move and
  // today's builder from the same start stamp the same values.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(
    function (this: Element) {
      return rectOf(this);
    }
  );
});

afterEach(() => {
  unregisterList();
  act(() => endCarry('cancelled'));
  endDragHold();
  document.documentElement.removeAttribute('data-dragging');
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function renderDetail(shown: string, contentH = 500) {
  const result = await renderWithProviders(
    <>
      <TabGroupDetailsContainer />
      <CarryLayer />
    </>,
    {
      seedStore: (store) => {
        store.dispatch(setHasTabGroupsPermission(true));
        store.dispatch(saveToTabContainerInternal(s3()));
        store.dispatch(saveToTabContainerInternal(s2()));
        store.dispatch(saveToTabContainerInternal(s1()));
        store.dispatch(selectTabContainer(shown));
        store.dispatch(setIsNotDirty());
      },
    }
  );
  const el = result.container.firstElementChild;
  if (!(el instanceof HTMLElement)) throw new Error('no detail pane');
  el.style.overflowY = 'auto';
  Object.defineProperty(el, 'clientHeight', {
    get: () => paneH,
    configurable: true,
  });
  Object.defineProperty(el, 'scrollHeight', {
    value: contentH,
    configurable: true,
  });
  pane = el;
  return { ...result, pane: el };
}

const TAB_T1: CarriedRef = {
  kind: 'tab',
  tabGroupId: 'S1',
  windowId: 'w1',
  tabId: 't1',
};
const TAB_T2: CarriedRef = { ...TAB_T1, tabId: 't2' };
const GROUP_G1: CarriedRef = {
  kind: 'group',
  tabGroupId: 'S1',
  windowId: 'w1',
  groupId: 'g1',
};
const WINDOW_W1: CarriedRef = {
  kind: 'window',
  tabGroupId: 'S1',
  windowId: 'w1',
};
const WINDOW_W2: CarriedRef = { ...WINDOW_W1, windowId: 'w2' };

const cardFor = (carried: CarriedRef): CarryCard =>
  carried.kind === 'tab'
    ? { kind: 'tab', title: carried.tabId, faviconUrl: '' }
    : carried.kind === 'group'
      ? { kind: 'group', title: 'G', color: '#000', tabCount: 2 }
      : { kind: 'window', title: carried.windowId, number: 1, tabCount: 1 };

// As the engine leaves things at the hand-off: the kind published, the hold
// on, the pointer out to the left of the pane, over the session list.
function carry(carried: CarriedRef, onCancel?: () => void) {
  setDragging(true, carried.kind);
  beginDragHold();
  act(() => startCarry(carried, cardFor(carried), -40, 100, onCancel));
}

const moveTo = (y: number, x = X) =>
  act(() => {
    fireEvent.pointerMove(document, { clientX: x, clientY: y });
  });
const release = (y: number, x = X) =>
  act(() => {
    fireEvent.pointerUp(document, { clientX: x, clientY: y });
  });
const esc = () =>
  act(() => {
    fireEvent.keyDown(window, { key: 'Escape' });
  });

function find(selector: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(selector);
  if (el === null) throw new Error(`nothing matches ${selector}`);
  return el;
}
const row = (id: string) => find(`[data-drag-row-id="${id}"]`);
const held = () =>
  document.querySelector<HTMLElement>('[data-drag-held]')?.dataset.dragRowId;
// The trailing block after the last window, where a carried tab's or
// group's phantom rests (KAN-361/366). Always drawn.
const trailing = () => {
  const el = document.querySelector<HTMLElement>(
    '[data-new-window-target="last"]'
  );
  if (el === null) throw new Error('no trailing block');
  return el;
};
// Whether anything between the element and the page hides it. Opacity does
// not inherit in a computed style, so the element's own is not enough: a row
// at opacity 0 hides its every child while each still computes 1.
const seen = (el: Element) => {
  for (let e: Element | null = el; e !== null; e = e.parentElement) {
    const style = getComputedStyle(e);
    if (
      style.opacity === '0' ||
      style.visibility === 'hidden' ||
      style.display === 'none'
    )
      return false;
  }
  return true;
};
const slotOf = (phantomId: string) => {
  const slot = row(phantomId).querySelector('[data-drag-landing-slot]');
  if (slot === null) throw new Error('no landing slot');
  return slot;
};
const shiftOf = (el: HTMLElement) =>
  Number(/translateY\((-?[\d.]+)px\)/.exec(el.style.transform)?.[1] ?? 0);

// S2 on screen while a TAB is carried: d1 and d2 as drawn, then the
// trailing block holding the phantom.
//
//   d1 0..176: header 0..32, u1 32..64, band h1 64..160
//              (title 64..96, u2 96..128, u3 128..160)
//   d2 184..248: header 184..216, u4 216..248
//   new-window:last 256..296  (phantom tab 260..292)
const S2_TAB_LAYOUT = (phantom: string): Table => ({
  'win:d1': [0, 176],
  'row:d1': [0, 176],
  'row:tab:u1': [32, 32],
  'row:u1': [32, 32],
  'row:group:h1': [64, 96],
  'band:h1': [64, 96],
  'fixed:h1': [64, 32],
  'row:u2': [96, 32],
  'row:u3': [128, 32],
  'fixed:h1:tail': [160, 0],
  'win:d2': [184, 64],
  'row:d2': [184, 64],
  'row:tab:u4': [216, 32],
  'row:u4': [216, 32],
  [`win:${NEW_LAST_WINDOW}`]: [256, 40],
  [`row:tab:carried:${phantom}`]: [260, 32],
  [`row:carried:${phantom}`]: [260, 32],
});
// The phantom tab's own middle, in the trailing block.
const PHANTOM_Y = 276;

// The same while a GROUP is carried: the phantom is the group's item row.
const S2_GROUP_LAYOUT: Table = {
  'win:d1': [0, 176],
  'row:tab:u1': [32, 32],
  'row:group:h1': [64, 96],
  'win:d2': [184, 64],
  'row:tab:u4': [216, 32],
  [`win:${NEW_LAST_WINDOW}`]: [256, 40],
  'row:group:carried:g1': [260, 32],
};

// S2 while a WINDOW is carried: every window folded to its header, the
// phantom window first.
const S2_WINDOW_LAYOUT = (phantom: string): Table => ({
  [`row:carried:${phantom}`]: [0, 32],
  [`win:carried:${phantom}`]: [0, 32],
  'row:d1': [40, 32],
  'win:d1': [40, 32],
  'row:d2': [80, 32],
  'win:d2': [80, 32],
});

describe('adoption: the pointer comes into the pane with a carry on', () => {
  test('the phantom is adopted as a started drag, with no press and no second hold', async () => {
    await renderDetail('S2');
    carry(TAB_T1);
    table = S2_TAB_LAYOUT('t1');
    const begin = vi.spyOn(dragHold, 'beginDragHold');

    // The premise: out of the pane, the layer drives.
    expect(currentCarry()?.owner).toBe('layer');
    expect(held()).toBeUndefined();

    moveTo(52);

    expect(held()).toBe('carried:t1');
    expect(currentCarry()?.owner).toBe('area');
    expect(document.documentElement.getAttribute('data-dragging')).toBe('tab');
    expect(isDragHeld()).toBe(true);
    expect(begin).not.toHaveBeenCalled();
  });

  test('CONTROL: above the pane, nothing is adopted', async () => {
    await renderDetail('S2');
    carry(TAB_T1);
    table = S2_TAB_LAYOUT('t1');

    moveTo(-20);

    expect(held()).toBeUndefined();
    expect(currentCarry()?.owner).toBe('layer');
  });

  test('the phantom is invisible, never hit, and keeps its footprint', async () => {
    await renderDetail('S2');
    carry(TAB_T1);
    table = S2_TAB_LAYOUT('t1');

    // Before the pointer comes in: drawn, invisible.
    const phantom = row('carried:t1');
    const content = phantom.lastElementChild;
    if (!(content instanceof HTMLElement)) throw new Error('no content');
    expect(seen(content)).toBe(false);
    // CONTROL: the helper sees an ordinary row.
    expect(seen(row('u1'))).toBe(true);
    expect(getComputedStyle(phantom).pointerEvents).toBe('none');
    // Its content is a stored row's controls: out of the keyboard's reach.
    expect(phantom.inert).toBe(true);
    // CONTROL: an ordinary row is none of that.
    expect(row('u1').inert).not.toBe(true);
    expect(getComputedStyle(row('u1')).pointerEvents).not.toBe('none');

    // Held over d1's first row: the rows of d1 make room by the phantom's
    // own 32px, and d2 moves down by the same.
    moveTo(36);
    expect(held()).toBe('carried:t1');
    expect(seen(content)).toBe(false);
    expect(phantom.style.boxShadow).toBe('');
    expect(shiftOf(row('u1'))).toBe(32);
    expect(shiftOf(find('[data-drop-window-id="d2"]'))).toBe(32);
    // The landing slot is the visible target: not hidden with the row.
    expect(seen(slotOf('carried:t1'))).toBe(true);
  });

  // KAN-354, KAN-355. The held phantom is drawn by the carry's card, so it is
  // marked as such: the attribute App.css keys on to leave it without the
  // held tab's lift shadow, which drew it on main as an empty shadowed box
  // (pinned in the browser, e2e/in-session-card.spec.ts). The card is the
  // carry's own: no drag card is shown beside it.
  test('the adopted phantom is held as drawn by the card, and only the carry’s card shows', async () => {
    await renderDetail('S2');
    carry(TAB_T1);
    table = S2_TAB_LAYOUT('t1');
    // The premise: not held yet, so not marked.
    expect(row('carried:t1').hasAttribute('data-held-as-card')).toBe(false);

    moveTo(52);

    expect(held()).toBe('carried:t1');
    expect(row('carried:t1').hasAttribute('data-held-as-card')).toBe(true);
    expect(document.querySelectorAll('[data-carry-card]')).toHaveLength(1);
    expect(document.querySelector('[data-drag-card]')).toBeNull();
  });

  test('no carry: nothing is drawn for one, and every row is its ordinary self', async () => {
    await renderDetail('S2');
    // The trailing block is always drawn, and with no carry holds no row.
    expect(trailing().querySelector('[data-drag-row-id]')).toBeNull();
    expect(document.querySelector('[data-carry-phantom]')).toBeNull();
  });
});

describe('a carried tab lands at the exact spot', () => {
  test('in another session, between rows', async () => {
    const { store } = await renderDetail('S2');
    const onCancel = vi.fn();
    carry(TAB_T1, onCancel);
    table = S2_TAB_LAYOUT('t1');

    moveTo(52);
    release(52);

    const data = store.getState().tabContainerDataState;
    expect(tabIds(windowIn(data, 'S2', 'd1'))).toEqual([
      'u1',
      't1',
      'u2',
      'u3',
    ]);
    expect(tabIds(windowIn(data, 'S1', 'w1'))).not.toContain('t1');
    expect(currentCarry()).toBeNull();
    expect(isDragHeld()).toBe(false);
    expect(document.documentElement.hasAttribute('data-dragging')).toBe(false);
    // Committed: the source's view is not put back, and no Moved toast.
    runFrames(2);
    expect(onCancel).not.toHaveBeenCalled();
    expect(store.getState().globalState.toasts).toEqual([]);
    expect(data.selectedTabGroupId).toBe('S2');
  });

  test('inside a band, it joins that group', async () => {
    const { store } = await renderDetail('S2');
    carry(TAB_T1);
    table = S2_TAB_LAYOUT('t1');

    moveTo(102);
    // The band answers in its colour while the pointer is in it.
    expect(find('[data-band-id="h1"]').hasAttribute('data-drop-target')).toBe(
      true
    );
    release(102);

    const d1 = windowIn(store.getState().tabContainerDataState, 'S2', 'd1');
    expect(d1.tabs.map((t) => [t.tabId, t.chromeGroupId])).toEqual([
      ['u1', undefined],
      ['t1', 'h1'],
      ['u2', 'h1'],
      ['u3', 'h1'],
    ]);
  });

  test('in its own session: exactly what tabDrop does from its own window', async () => {
    const { store } = await renderDetail('S1');
    carry(TAB_T2);
    // S1 as drawn with t2 carried: w1 without t2, w2, then the trailing
    // block holding the phantom.
    table = {
      'win:w1': [0, 228],
      'win:w2': [236, 64],
      'row:t3': [268, 32],
      'row:tab:t3': [268, 32],
      [`win:${NEW_LAST_WINDOW}`]: [308, 40],
      'row:tab:carried:t2': [312, 32],
      'row:carried:t2': [312, 32],
    };

    moveTo(272);
    release(272);

    // What today's builder gives from the same start, in a store of its own.
    const control = await renderWithProviders(<></>, {
      seedStore: (s) => {
        s.dispatch(setHasTabGroupsPermission(true));
        s.dispatch(saveToTabContainerInternal(s3()));
        s.dispatch(saveToTabContainerInternal(s2()));
        s.dispatch(saveToTabContainerInternal(s1()));
        s.dispatch(selectTabContainer('S1'));
        s.dispatch(setIsNotDirty());
      },
    });
    control.store.dispatch(
      dropOnTop(
        tabDrop({
          tabGroupId: 'S1',
          tabId: 't2',
          fromWindowId: 'w1',
          toWindowId: 'w2',
          toIndex: 0,
        })
      )
    );
    const got = store.getState().tabContainerDataState;
    expect(got.tabGroups).toEqual(
      control.store.getState().tabContainerDataState.tabGroups
    );
    // The premise: it did move.
    expect(tabIds(windowIn(got, 'S1', 'w2'))).toEqual(['t2', 't3']);
  });

  // KAN-366 B. The trailing block the phantom rests in is the new last
  // window: let go at the phantom's own place, lit and with no slot drawn
  // on the way, the tab is a new last window of the session on screen.
  test('at its own place in the trailing block: lit, no slot, and a release there makes a new last window', async () => {
    const { store } = await renderDetail('S2');
    const onCancel = vi.fn();
    carry(TAB_T1, onCancel);
    table = S2_TAB_LAYOUT('t1');

    moveTo(52);
    // PREMISE: adopted, and landing in d1 with its slot drawn.
    expect(held()).toBe('carried:t1');
    expect(seen(slotOf('carried:t1'))).toBe(true);
    // In the box's lower part, 18px off the phantom's middle.
    moveTo(PHANTOM_Y + 18);
    expect(held()).toBe('carried:t1');
    expect(trailing().hasAttribute('data-landing')).toBe(true);
    expect(
      row('carried:t1').querySelector('[data-drag-landing-slot]')
    ).toBeNull();
    // Nothing makes room: d1's rows and d2 are back where they stand.
    expect(shiftOf(row('u2'))).toBe(0);
    expect(
      find('[data-drop-window-id="d2"]').hasAttribute('data-window-shift')
    ).toBe(false);
    release(PHANTOM_Y + 18);

    const s2 = sessionIn(store.getState().tabContainerDataState, 'S2');
    expect(s2.windows.map(tabIds)).toEqual([
      ['u1', 'u2', 'u3'],
      ['u4'],
      ['t1'],
    ]);
    expect(currentCarry()).toBeNull();
    expect(trailing().hasAttribute('data-landing')).toBe(false);
    runFrames(2);
    expect(onCancel).not.toHaveBeenCalled();
    expect(store.getState().globalState.toasts).toEqual([]);
  });
});

describe('a carried group lands at the exact spot', () => {
  test('beside a band, never inside it, even with the pointer in the band', async () => {
    const { store } = await renderDetail('S2');
    carry(GROUP_G1);
    table = S2_GROUP_LAYOUT;

    moveTo(102);
    release(102);

    const d1 = windowIn(store.getState().tabContainerDataState, 'S2', 'd1');
    expect(d1.tabs.map((t) => [t.tabId, t.chromeGroupId])).toEqual([
      ['u1', undefined],
      ['g1a', 'g1'],
      ['g1b', 'g1'],
      ['u2', 'h1'],
      ['u3', 'h1'],
    ]);
  });

  test('in another window of another session', async () => {
    const { store } = await renderDetail('S2');
    carry(GROUP_G1);
    table = S2_GROUP_LAYOUT;

    moveTo(242);
    release(242);

    expect(
      tabIds(windowIn(store.getState().tabContainerDataState, 'S2', 'd2'))
    ).toEqual(['u4', 'g1a', 'g1b']);
  });

  test('in its own session: exactly what groupDrop does from its own window', async () => {
    const { store } = await renderDetail('S1');
    carry(GROUP_G1);
    table = {
      'win:w1': [0, 164],
      'win:w2': [172, 64],
      'row:tab:t3': [204, 32],
      [`win:${NEW_LAST_WINDOW}`]: [244, 40],
      'row:group:carried:g1': [248, 32],
    };

    moveTo(206);
    release(206);

    const control = await renderWithProviders(<></>, {
      seedStore: (s) => {
        s.dispatch(setHasTabGroupsPermission(true));
        s.dispatch(saveToTabContainerInternal(s3()));
        s.dispatch(saveToTabContainerInternal(s2()));
        s.dispatch(saveToTabContainerInternal(s1()));
        s.dispatch(selectTabContainer('S1'));
        s.dispatch(setIsNotDirty());
      },
    });
    control.store.dispatch(
      dropOnTop(
        groupDrop({
          tabGroupId: 'S1',
          groupId: 'g1',
          fromWindowId: 'w1',
          toWindowId: 'w2',
          toIndex: 0,
        })
      )
    );
    const got = store.getState().tabContainerDataState;
    expect(got.tabGroups).toEqual(
      control.store.getState().tabContainerDataState.tabGroups
    );
    expect(tabIds(windowIn(got, 'S1', 'w2'))).toEqual(['g1a', 'g1b', 't3']);
  });

  // The same for a group (KAN-366 B).
  test('at its own place in the trailing block: lit, and a release there makes a new last window', async () => {
    const { store } = await renderDetail('S2');
    carry(GROUP_G1);
    table = S2_GROUP_LAYOUT;

    moveTo(52);
    moveTo(PHANTOM_Y);
    // PREMISE: adopted, and at its own place.
    expect(held()).toBe('group:carried:g1');
    expect(trailing().hasAttribute('data-landing')).toBe(true);
    release(PHANTOM_Y);

    const s2 = sessionIn(store.getState().tabContainerDataState, 'S2');
    expect(s2.windows.map(tabIds)).toEqual([
      ['u1', 'u2', 'u3'],
      ['u4'],
      ['g1a', 'g1b'],
    ]);
    expect(currentCarry()).toBeNull();
  });
});

describe('a carried window lands between windows', () => {
  test('in another session', async () => {
    const { store } = await renderDetail('S2');
    carry(WINDOW_W2);
    table = S2_WINDOW_LAYOUT('w2');

    moveTo(76);
    expect(held()).toBe('carried:w2');
    release(76);

    expect(
      windowIds(sessionIn(store.getState().tabContainerDataState, 'S2'))
    ).toEqual(['d1', 'w2', 'd2']);
    expect(currentCarry()).toBeNull();
  });

  test('in its own session: exactly what windowDrop does', async () => {
    const { store } = await renderDetail('S1');
    carry(WINDOW_W1);
    table = {
      'row:carried:w1': [0, 32],
      'win:carried:w1': [0, 32],
      'row:w2': [40, 32],
      'win:w2': [40, 32],
    };

    moveTo(70);
    release(70);

    const control = await renderWithProviders(<></>, {
      seedStore: (s) => {
        s.dispatch(saveToTabContainerInternal(s3()));
        s.dispatch(saveToTabContainerInternal(s2()));
        s.dispatch(saveToTabContainerInternal(s1()));
        s.dispatch(selectTabContainer('S1'));
        s.dispatch(setIsNotDirty());
      },
    });
    control.store.dispatch(dropOnTop(windowDrop('S1', 'w1', 1)));
    const got = store.getState().tabContainerDataState;
    expect(got.tabGroups).toEqual(
      control.store.getState().tabContainerDataState.tabGroups
    );
    expect(windowIds(sessionIn(got, 'S1'))).toEqual(['w2', 'w1']);
  });

  // A window's phantom is a window row of its own, first: the trailing
  // block holds nothing for it.
  test('nothing rests in the trailing block for a window', async () => {
    await renderDetail('S2');
    carry(WINDOW_W2);
    expect(trailing().querySelector('[data-drag-row-id]')).toBeNull();
    expect(trailing().contains(row('carried:w2'))).toBe(false);
  });
});

describe('an adopted drag that ends with no commit cancels the whole carry', () => {
  test('Esc: nothing moves, the opened session stays on screen, the source view is put back', async () => {
    const { store } = await renderDetail('S2');
    const before = store.getState().tabContainerDataState;
    const onCancel = vi.fn();
    carry(TAB_T1, onCancel);
    table = S2_TAB_LAYOUT('t1');

    moveTo(52);
    esc();

    expect(currentCarry()).toBeNull();
    expect(held()).toBeUndefined();
    expect(isDragHeld()).toBe(false);
    expect(store.getState().tabContainerDataState).toBe(before);
    expect(store.getState().tabContainerDataState.selectedTabGroupId).toBe(
      'S2'
    );
    expect(onCancel).not.toHaveBeenCalled();
    runFrames(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
    // A later release commits nothing.
    release(52);
    expect(store.getState().tabContainerDataState).toBe(before);
  });

  test('a release the engine refuses', async () => {
    const { store } = await renderDetail('S2');
    const before = store.getState().tabContainerDataState;
    const onCancel = vi.fn();
    carry(TAB_T1, onCancel);
    table = S2_TAB_LAYOUT('t1');

    moveTo(52);
    // Beside the pane, far below every window: in the pane, below the last
    // window, is a new last window (KAN-366 B).
    moveTo(480, PANE_W + 30);
    release(480, PANE_W + 30);

    expect(currentCarry()).toBeNull();
    expect(store.getState().tabContainerDataState).toBe(before);
    runFrames(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  test('pointercancel', async () => {
    const { store } = await renderDetail('S2');
    const before = store.getState().tabContainerDataState;
    carry(TAB_T1);
    table = S2_TAB_LAYOUT('t1');

    moveTo(52);
    act(() => {
      fireEvent.pointerCancel(document);
    });

    expect(currentCarry()).toBeNull();
    expect(isDragHeld()).toBe(false);
    expect(store.getState().tabContainerDataState).toBe(before);
  });

  test('a drop back where it came from moves nothing, and cancels', async () => {
    const { store } = await renderDetail('S1');
    const before = store.getState().tabContainerDataState;
    const onCancel = vi.fn();
    carry(WINDOW_W1, onCancel);
    table = {
      'row:carried:w1': [0, 32],
      'win:carried:w1': [0, 32],
      'row:w2': [40, 32],
      'win:w2': [40, 32],
    };

    moveTo(20);
    release(20);

    expect(store.getState().tabContainerDataState.tabGroups).toEqual(
      before.tabGroups
    );
    runFrames(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  test('the carried item taken away mid-drag (⌘Z, a delete) ends the adopted drag too', async () => {
    const { store } = await renderDetail('S2');
    carry(TAB_T1);
    table = S2_TAB_LAYOUT('t1');
    moveTo(52);
    expect(held()).toBe('carried:t1');

    act(() => {
      store.dispatch(
        deleteTab({ tabGroupId: 'S1', windowId: 'w1', tabId: 't1' })
      );
    });
    const after = store.getState().tabContainerDataState;

    expect(currentCarry()).toBeNull();
    expect(held()).toBeUndefined();
    // No drag goes on without its carry: a move previews nothing -- no row
    // makes room, no window moves -- and a release commits nothing.
    moveTo(36);
    expect(shiftOf(row('u1'))).toBe(0);
    expect(
      document
        .querySelector('[data-drop-window-id="d2"]')
        ?.hasAttribute('data-window-shift')
    ).toBe(false);
    release(52);
    expect(store.getState().tabContainerDataState).toBe(after);
  });
});

describe('the rest of an adopted drag', () => {
  test('the click that follows its release is swallowed, and only that one', async () => {
    await renderDetail('S2');
    carry(TAB_T1);
    table = S2_TAB_LAYOUT('t1');
    moveTo(52);
    release(52);

    // The row itself, not a control in it, so the click the suppressor lets
    // through runs no app handler.
    const clicked = vi.fn();
    const u1 = row('u1');
    u1.addEventListener('click', clicked);
    fireEvent.click(u1);
    expect(clicked).not.toHaveBeenCalled();
    fireEvent.pointerDown(u1, { button: 0 });
    fireEvent.click(u1);
    expect(clicked).toHaveBeenCalledTimes(1);
  });

  test('the detail unmounting mid-drag ends the whole carry', async () => {
    const { unmount } = await renderDetail('S2');
    carry(TAB_T1);
    table = S2_TAB_LAYOUT('t1');
    moveTo(52);
    expect(held()).toBe('carried:t1');

    act(() => unmount());

    expect(currentCarry()).toBeNull();
    expect(isDragHeld()).toBe(false);
    expect(document.documentElement.hasAttribute('data-dragging')).toBe(false);
  });
});

describe('what an adoption leaves alone', () => {
  // The CarryLayer ends a carry when a search starts, so in the app this is
  // belt and braces: rendered here WITHOUT the layer, the list alone decides.
  test('a list that has turned drag off (searching) adopts nothing', async () => {
    const { store, container } = await renderWithProviders(
      <TabGroupDetailsContainer />,
      {
        seedStore: (s) => {
          s.dispatch(setHasTabGroupsPermission(true));
          s.dispatch(saveToTabContainerInternal(s2()));
          s.dispatch(saveToTabContainerInternal(s1()));
          s.dispatch(selectTabContainer('S2'));
          s.dispatch(setIsNotDirty());
        },
      }
    );
    const root = container.firstElementChild;
    if (!(root instanceof HTMLElement)) throw new Error('no detail pane');
    root.style.overflowY = 'auto';
    pane = root;
    carry(TAB_T1);
    table = S2_TAB_LAYOUT('t1');
    // Every window is titled 'Window <id>': searching, with every row kept.
    act(() => {
      store.dispatch(setSearchInputText('window'));
    });
    // The premise: the phantom is still drawn, so only the list's own rule
    // stands between it and an adoption.
    expect(row('carried:t1')).not.toBeNull();

    moveTo(52);

    expect(held()).toBeUndefined();
    expect(currentCarry()?.owner).toBe('layer');
  });

  test('Esc after the opened session auto-scrolled leaves its scroll where the drag left it', async () => {
    paneH = 150;
    const { pane: p } = await renderDetail('S2', 400);
    carry(WINDOW_W2);
    table = S2_WINDOW_LAYOUT('w2');

    moveTo(60);
    expect(held()).toBe('carried:w2');
    moveTo(146);
    runFrames(10);
    const scrolled = p.scrollTop;
    // The premise: the drag scrolled the opened session.
    expect(scrolled).toBeGreaterThan(0);
    esc();

    expect(currentCarry()).toBeNull();
    expect(p.scrollTop).toBe(scrolled);
  });
});

describe('out of the pane and back in', () => {
  test('reaching the session list hands the same carry back to the layer', async () => {
    await renderDetail('S2');
    const onCancel = vi.fn();
    carry(TAB_T1, onCancel);
    table = S2_TAB_LAYOUT('t1');
    const before = currentCarry();

    moveTo(52);
    moveTo(52, -30);

    expect(held()).toBeUndefined();
    expect(currentCarry()?.owner).toBe('layer');
    expect(currentCarry()?.carried).toBe(before?.carried);
    expect(currentCarry()?.card).toBe(before?.card);
    expect(isDragHeld()).toBe(true);
    expect(document.documentElement.getAttribute('data-dragging')).toBe('tab');
  });

  // KAN-352, aimed where the old rule fired: out of the pane to the RIGHT,
  // where Open now and its resize grip are, is no receiver. The adopted drag
  // stays this area's -- its carry is not handed back, nothing is unlit or
  // re-measured -- and back in, the release lands where its preview showed:
  // open-now-resize.spec.ts test 8's path, played on an adopted drag.
  test('beside the pane over no receiver: the drag stays adopted, and back in it lands', async () => {
    const { store } = await renderDetail('S2');
    const onCancel = vi.fn();
    carry(TAB_T1, onCancel);
    table = S2_TAB_LAYOUT('t1');

    moveTo(52);
    expect(held()).toBe('carried:t1');
    moveTo(52, PANE_W + 30);

    expect(currentCarry()?.owner).toBe('area');
    expect(held()).toBe('carried:t1');
    moveTo(52);
    release(52);

    expect(
      tabIds(windowIn(store.getState().tabContainerDataState, 'S2', 'd1'))
    ).toEqual(['u1', 't1', 'u2', 'u3']);
    expect(currentCarry()).toBeNull();
    runFrames(2);
    expect(onCancel).not.toHaveBeenCalled();
  });

  // The lit target is the session header's (KAN-361 N1 B), outside the
  // pane: a header stood in above it, where the toolbar row is.
  test('leaving from the lit New window target for the list puts it out', async () => {
    const header = document.createElement('div');
    header.dataset.newWindowTarget = 'first';
    document.body.append(header);
    await renderDetail('S2');
    carry(TAB_T1);
    table = { ...S2_TAB_LAYOUT('t1'), 'header:new-window': [-40, 32] };

    moveTo(52);
    moveTo(-24);
    expect(header.hasAttribute('data-landing')).toBe(true);
    moveTo(52, -30);

    expect(currentCarry()?.owner).toBe('layer');
    expect(header.hasAttribute('data-landing')).toBe(false);
    header.remove();
  });

  test('adopt, leave, then cancel: the source’s view is still put back', async () => {
    await renderDetail('S2');
    const onCancel = vi.fn();
    carry(TAB_T1, onCancel);
    table = S2_TAB_LAYOUT('t1');

    moveTo(52);
    moveTo(52, -30);
    // The layer's Esc now.
    esc();
    runFrames(1);

    expect(currentCarry()).toBeNull();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  // The ruling: a hand-back keeps the carry it came from, so the SOURCE's
  // KAN-157 scroll is still put back by a cancel after it. Played for real: a
  // window pressed in a scrolled S1 and carried out, the fold's clamp, back
  // in (adopted), out again, and Esc.
  test('a real window carry: out, in, out, Esc -- the source’s scroll comes back', async () => {
    paneH = 200;
    const { pane: p } = await renderDetail('S1', 1000);
    p.scrollTop = 300;
    table = {
      'row:w1': [300, 32],
      'win:w1': [300, 32],
      'row:w2': [340, 32],
      'win:w2': [340, 32],
    };
    const handle = row('w2').querySelector('[data-window-drag-handle]');
    if (!(handle instanceof HTMLElement)) throw new Error('no window handle');
    fireEvent.pointerDown(handle, { clientX: 20, clientY: 50, button: 0 });
    fireEvent.pointerMove(document, { clientX: 20, clientY: 70 });
    moveTo(70, -40);
    // The premise: carried out of S1, and the fold clamped the scroll.
    expect(currentCarry()?.carried).toEqual(WINDOW_W2);
    p.scrollTop = 0;

    table = {
      'row:carried:w2': [0, 32],
      'win:carried:w2': [0, 32],
      'row:w1': [40, 32],
      'win:w1': [40, 32],
    };
    moveTo(60);
    expect(held()).toBe('carried:w2');
    moveTo(60, -30);
    expect(currentCarry()?.owner).toBe('layer');
    esc();
    runFrames(1);

    expect(currentCarry()).toBeNull();
    expect(p.scrollTop).toBe(300);
  });

  test('back in, it is adopted again, measured afresh', async () => {
    const { store } = await renderDetail('S2');
    carry(TAB_T1);
    table = S2_TAB_LAYOUT('t1');

    moveTo(52);
    moveTo(52, -30);
    // While it was out, d1's rows moved: u1 now sits 100px lower.
    table = {
      ...S2_TAB_LAYOUT('t1'),
      'win:d1': [0, 276],
      'row:tab:u1': [132, 32],
      'row:u1': [132, 32],
      'row:group:h1': [164, 96],
      'band:h1': [164, 96],
      'row:u2': [196, 32],
      'row:u3': [228, 32],
      'win:d2': [284, 64],
      'row:tab:u4': [316, 32],
      'row:u4': [316, 32],
      [`win:${NEW_LAST_WINDOW}`]: [356, 40],
      'row:tab:carried:t1': [360, 32],
      'row:carried:t1': [360, 32],
    };
    moveTo(52);
    expect(held()).toBe('carried:t1');
    // Past u1's OLD midpoint (48) but above its new one (148): index 0 in
    // the new layout, where the old one says 1.
    release(102);

    expect(
      tabIds(windowIn(store.getState().tabContainerDataState, 'S2', 'd1'))
    ).toEqual(['t1', 'u1', 'u2', 'u3']);
  });
});

// KAN-155. Releasing ends the fold, and a row dropped low in the folded list
// is then below the fold: the engine follows the row it dropped on the next
// frame. An adopted drop is the phantom's, which is gone by then -- so it
// follows the MOVED ITEM's own row, and only when the move committed.
describe('after an adopted drop, the moved item is followed (KAN-155)', () => {
  let scrolled: Element[] = [];
  beforeEach(() => {
    scrolled = [];
    vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(function (
      this: Element
    ) {
      scrolled.push(this);
    });
  });

  test('a window dropped low in a scrolled, folded session: its real row', async () => {
    paneH = 200;
    const { store, pane: p } = await renderDetail('S2', 1000);
    p.scrollTop = 40;
    carry(WINDOW_W2);
    table = S2_WINDOW_LAYOUT('w2');

    moveTo(60);
    expect(held()).toBe('carried:w2');
    // Content 130: past d2's middle, so it lands last.
    release(90);
    runFrames(1);

    expect(
      windowIds(sessionIn(store.getState().tabContainerDataState, 'S2'))
    ).toEqual(['d1', 'd2', 'w2']);
    expect(scrolled).toContain(row('w2'));
  });

  test('a tab dropped into another session: its real row', async () => {
    await renderDetail('S2');
    carry(TAB_T1);
    table = S2_TAB_LAYOUT('t1');

    moveTo(52);
    release(52);
    runFrames(1);

    expect(scrolled).toContain(row('t1'));
  });

  test('a group dropped into another session: its real item row', async () => {
    await renderDetail('S2');
    carry(GROUP_G1);
    table = S2_GROUP_LAYOUT;

    moveTo(102);
    release(102);
    runFrames(1);

    expect(scrolled).toContain(row('group:g1'));
  });

  test('a drop that moves nothing follows nothing', async () => {
    await renderDetail('S1');
    carry(WINDOW_W1);
    table = {
      'row:carried:w1': [0, 32],
      'win:carried:w1': [0, 32],
      'row:w2': [40, 32],
      'win:w2': [40, 32],
    };

    moveTo(20);
    release(20);
    runFrames(1);

    // The premise: it was a release the list judged, and the carry is over.
    expect(currentCarry()).toBeNull();
    expect(scrolled).toEqual([]);
  });
});

describe('a long opened session', () => {
  test('auto-scrolls while adopted, and the drop lands below the fold', async () => {
    paneH = 150;
    const { store, pane: p } = await renderDetail('S2', 300);
    carry(TAB_T1);
    table = S2_TAB_LAYOUT('t1');

    moveTo(52);
    // Deep in the bottom edge zone.
    moveTo(146);
    runFrames(20);
    expect(p.scrollTop).toBeGreaterThan(100);

    // The scroll limit: d2's u4 is now on screen. Let go in its lower half.
    const y = 242 - p.scrollTop;
    moveTo(y);
    release(y);

    expect(
      tabIds(windowIn(store.getState().tabContainerDataState, 'S2', 'd2'))
    ).toEqual(['u4', 't1']);
  });
});

// A colour with nothing in it, as a browser or jsdom names one.
const NO_COLOUR = /^(transparent|rgba\(0, 0, 0, 0\))$/;

// KAN-361/366. The trailing block a carried tab's or group's phantom rests
// in: the last block of the session, blank -- no border colour, its name
// hidden -- until a landing lights it with the header target's look (V2 A).
describe('the trailing block (KAN-361/366)', () => {
  test('drawn last while a tab is carried, holding the phantom, blank and hidden from assistive tech', async () => {
    await renderDetail('S2');
    carry(TAB_T1);

    const el = trailing();
    expect(el.getAttribute('data-drop-window-id')).toBe(NEW_LAST_WINDOW);
    expect(el.getAttribute('aria-hidden')).toBe('true');
    expect(el.contains(row('carried:t1'))).toBe(true);
    // Last in the session.
    const blocks = document.querySelectorAll('[data-drop-window-id]');
    expect(blocks[blocks.length - 1]).toBe(el);
    // Blank: its name is there, unseen, and its border has no colour.
    const name = el.querySelector('[data-new-window-label]');
    if (name === null) throw new Error('no name');
    expect(name.textContent).toContain('New window');
    expect(seen(name)).toBe(false);
    expect(getComputedStyle(el).borderTopColor).toMatch(NO_COLOUR);
  });

  test('in the source session too (Q2 A)', async () => {
    await renderDetail('S1');
    carry(TAB_T2);
    expect(trailing().contains(row('carried:t2'))).toBe(true);
  });

  // Lit here as markNewWindowTarget lights it for a landing in it (KAN-366
  // B), in a session given no room: lit, it draws its borders anyway.
  test('lit: the header target’s look -- the hover fill, a solid border, its name', async () => {
    await renderDetail('S2');
    carry(TAB_T1);

    // PREMISE: no room was given, so unlit it has no border.
    expect(document.documentElement.getAttribute('data-drag-new-window')).toBe(
      ''
    );
    expect(getComputedStyle(trailing()).borderTopWidth).toBe('0px');

    act(() => markNewWindowTarget(NEW_LAST_WINDOW, trailing()));

    const el = trailing();
    const style = getComputedStyle(el);
    expect(style.borderTopWidth).toBe('1.5px');
    expect(style.borderTopStyle).toBe('solid');
    expect(style.borderTopColor).not.toMatch(NO_COLOUR);
    expect(LIGHT_THEME.HOVER_COLOR).toBe('#E4E7EB');
    expect(style.backgroundColor).toMatch(/(#E4E7EB|rgb\(228, ?231, ?235\))/i);
    const name = el.querySelector('[data-new-window-label]');
    if (name === null) throw new Error('no name');
    expect(seen(name)).toBe(true);
  });

  test('a session that already draws one of the carried ids offers no exact spot', async () => {
    const { store } = await renderWithProviders(
      <>
        <TabGroupDetailsContainer />
        <CarryLayer />
      </>,
      {
        seedStore: (s) => {
          s.dispatch(setHasTabGroupsPermission(true));
          s.dispatch(
            saveToTabContainerInternal(
              session('S9', 'Clash', T0, [win('z1', [tab('t1')])])
            )
          );
          s.dispatch(saveToTabContainerInternal(s1()));
          s.dispatch(selectTabContainer('S9'));
          s.dispatch(setIsNotDirty());
        },
      }
    );
    // The premise: S9 is drawn, and it holds a tab with t1's id.
    expect(document.querySelector('[data-drop-window-id="z1"]')).not.toBeNull();
    carry(TAB_T1);

    expect(trailing().querySelector('[data-drag-row-id]')).toBeNull();
    expect(document.querySelector('[data-carry-phantom]')).toBeNull();
    moveTo(20);
    expect(currentCarry()?.owner).toBe('layer');
    expect(store.getState().tabContainerDataState.selectedTabGroupId).toBe(
      'S9'
    );
  });
});

// V1 A. The trailing block is one row tall whatever is carried: a carried
// GROUP's phantom is folded to its header, before the pointer comes in as
// well as after, so nothing in the session jumps on entry. Its band keeps
// its real margins -- the engine measures them into the footprint the
// preview opens, which has to be the band it lands as (final review,
// finding 4) -- and the box that holds it takes them back with a negative
// margin of its own, so the block stays one row tall. jsdom has no layout,
// so what is pinned is what the box's height is made of.
describe('the trailing block is one row tall (V1 A)', () => {
  const folded = (groupRowId: string) => {
    const tabs = row(groupRowId).querySelector('[data-group-tabs]');
    const band = row(groupRowId).querySelector('[data-band-id]');
    const holder = row(groupRowId).parentElement;
    if (tabs === null || band === null || holder === null)
      throw new Error('no group parts');
    return {
      tabs: getComputedStyle(tabs).display,
      margin: [
        getComputedStyle(band).marginTop,
        getComputedStyle(band).marginBottom,
      ],
      held: [
        getComputedStyle(holder).marginTop,
        getComputedStyle(holder).marginBottom,
      ],
    };
  };

  test('a carried group is folded to its header in it, before the pointer comes in and after', async () => {
    await renderDetail('S2');
    carry(GROUP_G1);
    // The premise: the phantom group is in the block, with its tabs drawn.
    expect(trailing().contains(row('group:carried:g1'))).toBe(true);
    expect(
      row('group:carried:g1').querySelectorAll('[data-group-tabs] *').length
    ).toBeGreaterThan(0);

    const oneRow = {
      tabs: 'none',
      margin: ['2px', '2px'],
      held: ['-2px', '-2px'],
    };
    expect(folded('group:carried:g1')).toEqual(oneRow);

    table = S2_GROUP_LAYOUT;
    moveTo(PHANTOM_Y);
    expect(held()).toBe('group:carried:g1');
    expect(folded('group:carried:g1')).toEqual(oneRow);
  });

  // CONTROL: a carried TAB has no margin to take back, so the box that
  // holds it takes none.
  test('CONTROL: a carried tab’s holder keeps no negative margin', async () => {
    await renderDetail('S2');
    carry(TAB_T1);
    const holder = row('carried:t1').parentElement;
    if (holder === null) throw new Error('no holder');
    expect(trailing().contains(holder)).toBe(true);
    // jsdom reports an unset margin as '0', a browser as '0px'.
    expect(
      [
        getComputedStyle(holder).marginTop,
        getComputedStyle(holder).marginBottom,
      ].map(parseFloat)
    ).toEqual([0, 0]);
  });

  // CONTROL: a group in the session itself keeps its tabs and its margin.
  test('CONTROL: a group outside the target is drawn whole', async () => {
    await renderDetail('S2');
    carry(GROUP_G1);
    expect(folded('group:h1').tabs).not.toBe('none');
    expect(folded('group:h1').margin).not.toEqual(['0px', '0px']);
  });
});

// V3 A. A carried window's phantom shows a dashed slot at its own place --
// the top of the session on screen, where a drop starts -- while the pointer
// is outside the pane. On entry the landing slot takes over at the same
// place and strength, so nothing changes.
describe('a carried window shows where a drop starts (V3 A)', () => {
  const resting = () =>
    row('carried:w2').querySelector<HTMLElement>(
      ':scope > [data-phantom-resting-slot]'
    );

  test('a dashed slot, with the landing slot’s corners, at the phantom’s own place, while the pointer is outside', async () => {
    await renderDetail('S2');
    carry(WINDOW_W2);

    const slot = resting();
    if (slot === null) throw new Error('no resting slot');
    expect(seen(slot)).toBe(true);
    const style = getComputedStyle(slot);
    expect(style.display).not.toBe('none');
    expect(style.borderTopStyle).toBe('dashed');
    expect(style.borderTopWidth).toBe('1.5px');
    // Its colour (--drag-landing-slot) is a real browser's to resolve: the
    // e2e reads it against the theme's.
    // The landing slot's corners, so nothing changes on entry (V3 A; the
    // engine's slot has 4px corners on main).
    expect(style.borderRadius).toBe('4px');
    expect(style.position).toBe('absolute');
    expect([style.top, style.right, style.bottom, style.left]).toEqual([
      '0px',
      '0px',
      '0px',
      '0px',
    ]);
    // The phantom's own content stays unseen.
    expect(held()).toBeUndefined();
  });

  test('on entry at its own place, the landing slot takes over there at full strength', async () => {
    await renderDetail('S2');
    carry(WINDOW_W2);
    table = S2_WINDOW_LAYOUT('w2');

    moveTo(16);
    expect(held()).toBe('carried:w2');

    const slot = resting();
    if (slot === null) throw new Error('no resting slot');
    expect(getComputedStyle(slot).display).toBe('none');
    const landing = slotOf('carried:w2');
    expect(seen(landing)).toBe(true);
    expect(landing instanceof HTMLElement && landing.style.opacity).toBe('1');
    // The same corners as the resting slot it took over from.
    expect(landing instanceof HTMLElement && landing.style.borderRadius).toBe(
      getComputedStyle(slot).borderRadius
    );
  });

  // CONTROL: a tab's phantom rests in the trailing block, not as a window
  // row; it has no resting slot.
  test('CONTROL: no resting slot for a carried tab', async () => {
    await renderDetail('S2');
    carry(TAB_T1);
    expect(document.querySelector('[data-phantom-resting-slot]')).toBeNull();
  });
});

// KAN-366 Q4, ruling 1. The trailing block's room follows the session a
// carry SHOWS: decided from that session's own overflow at rest, when the
// carry starts and whenever it shows another session, before the pointer
// comes in. Never the room the carry brought from where it started.
describe('a carry’s room follows the session it shows', () => {
  const marker = () =>
    document.documentElement.getAttribute('data-drag-new-window');
  // The scroller's content height, as the next layout will read it.
  const contentOf = (p: HTMLElement, h: number) =>
    Object.defineProperty(p, 'scrollHeight', {
      value: h,
      configurable: true,
    });

  test('from a list with room, shown in one that fits: no room', async () => {
    await renderDetail('S2', 500);
    // As a drag in a list that scrolls leaves it at the hand-off.
    setDragNewWindow(true, true);
    // PREMISE: the carry's own list took its room.
    expect(marker()).toBe('room');

    carry(TAB_T1);

    expect(marker()).toBe('');
  });

  test('from a list without, shown in one that scrolls: the room', async () => {
    await renderDetail('S2', 900);
    setDragNewWindow(true);
    // PREMISE: the carry's own list took none.
    expect(marker()).toBe('');

    carry(TAB_T1);

    expect(marker()).toBe('room');
  });

  test('a spring-open to another session decides again, from that one', async () => {
    const { store, pane: p } = await renderDetail('S2', 900);
    carry(TAB_T1);
    // PREMISE: S2 scrolls.
    expect(marker()).toBe('room');

    contentOf(p, 400);
    act(() => {
      store.dispatch(selectTabContainer('S3'));
    });
    expect(marker()).toBe('');

    contentOf(p, 900);
    act(() => {
      store.dispatch(selectTabContainer('S2'));
    });
    expect(marker()).toBe('room');
  });
});
